import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import type {
  coverEquipmentResultViewport as coverResultViewport,
  renderEquipmentResultSkeletonBand as renderSkeletonBand,
  equipmentResultAnchorAtViewport as resultAnchorAtViewport,
  transferEquipmentResultFocusToSentinel as transferFocusToSentinel,
} from "../src/wayfinder/application/equipment-virtual-list-dom";
import type { PickerSearchScheduler as PickerSearchSchedulerType } from "../src/wayfinder/application/picker-search-scheduler";
import type { STARTING_EQUIPMENT_RESULT_WINDOW as resultWindowContract } from "../src/wayfinder/starting-equipment-result-window";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;
const productionEquipmentStyles = readFileSync(resolve("styles/wayfinder/starting-equipment.css"), "utf8");
const productionCatalogueTemplate = readFileSync(
  resolve("templates/wayfinder/starting-equipment-catalogue.hbs"),
  "utf8"
).concat(readFileSync(resolve("templates/wayfinder/starting-equipment-catalogue-host.hbs"), "utf8"));
const resultWindowScript = readFileSync(resolve("scripts/wayfinder/starting-equipment-result-window.js"), "utf8")
  .replaceAll("export ", "")
  .concat("\nwindow.STARTING_EQUIPMENT_RESULT_WINDOW = STARTING_EQUIPMENT_RESULT_WINDOW;");
const virtualListScript = readFileSync(resolve("scripts/wayfinder/application/equipment-virtual-list-dom.js"), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\.\/starting-equipment-result-window\.js";\s*/u, "")
  .replaceAll("export ", "")
  .concat(
    "\nwindow.equipmentResultAnchorAtViewport = equipmentResultAnchorAtViewport;",
    "\nwindow.coverEquipmentResultViewport = coverEquipmentResultViewport;",
    "\nwindow.renderEquipmentResultSkeletonBand = renderEquipmentResultSkeletonBand;",
    "\nwindow.transferEquipmentResultFocusToSentinel = transferEquipmentResultFocusToSentinel;"
  );
const pickerSchedulerScript = readFileSync(resolve("scripts/wayfinder/application/picker-search-scheduler.js"), "utf8")
  .replaceAll("export ", "")
  .concat("\nwindow.PickerSearchScheduler = PickerSearchScheduler;");

it("binds the production virtual list to stable canvas and render identity contracts", () => {
  for (const contract of [
    "data-equipment-focus-sentinel",
    "data-wayfinder-rendered-query",
    "data-wayfinder-view-revision",
    "data-wayfinder-source-revision",
    "data-wayfinder-criteria-revision",
    "data-result-offset",
    "data-equipment-stable-canvas",
    'data-equipment-stable-page="previous"',
    'data-equipment-stable-page="next"',
  ]) {
    expect(productionCatalogueTemplate, contract).toContain(contract);
  }
  expect(productionCatalogueTemplate).not.toContain("{{#each activePane.catalogue.items}}");
  expect(productionEquipmentStyles).toMatch(/\.equipment-stable-result-row\s*\{[\s\S]*?position: absolute;/);
});

browserIt("covers a rapid full-screen jump before the first animation frame", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1600 } });
    await page.setContent(fixture(1500));
    await page.addScriptTag({ content: resultWindowScript });
    await page.addScriptTag({ content: virtualListScript });

    const evidence = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>("[data-wayfinder-equipment-virtual-list]")!;
      let frameRan = false;
      list.addEventListener(
        "scroll",
        () => {
          window.coverEquipmentResultViewport({
            list,
            total: 500,
            measurements: { estimatedRowPx: 48, measuredRows: new Map() },
            pending: true,
          });
          requestAnimationFrame(() => {
            frameRan = true;
          });
        },
        { passive: true }
      );

      list.scrollTop = 80 * 48;
      list.dispatchEvent(new Event("scroll"));

      const viewport = list.getBoundingClientRect();
      const coverage = [...list.querySelectorAll<HTMLElement>("[data-result-index], [data-equipment-result-skeleton]")]
        .map((element) => element.getBoundingClientRect())
        .filter((bounds) => bounds.bottom > viewport.top && bounds.top < viewport.bottom)
        .map((bounds) => ({
          start: Math.max(viewport.top, bounds.top),
          end: Math.min(viewport.bottom, bounds.bottom),
        }))
        .sort((left, right) => left.start - right.start);
      let cursor = viewport.top;
      let maximumVisibleGapPx = 0;
      for (const interval of coverage) {
        maximumVisibleGapPx = Math.max(maximumVisibleGapPx, interval.start - cursor);
        cursor = Math.max(cursor, interval.end);
      }
      maximumVisibleGapPx = Math.max(maximumVisibleGapPx, viewport.bottom - cursor);

      const immediateAriaBusy = list.getAttribute("aria-busy");
      list.scrollTop = 0;
      window.coverEquipmentResultViewport({
        list,
        total: 500,
        measurements: { estimatedRowPx: 48, measuredRows: new Map() },
        pending: false,
      });

      return {
        immediateAriaBusy,
        frameRan,
        maximumVisibleGapPx,
        mountedRows: list.querySelectorAll("[data-result-index]").length,
        settledAriaBusy: list.getAttribute("aria-busy"),
        settledSkeletonBandHidden: list.querySelector<HTMLElement>("[data-equipment-skeleton-band]")!.hidden,
        visibleCoverageRows: coverage.length,
      };
    });

    expect(evidence).toEqual({
      immediateAriaBusy: "true",
      frameRan: false,
      maximumVisibleGapPx: 0,
      mountedRows: 36,
      settledAriaBusy: "false",
      settledSkeletonBandHidden: true,
      visibleCoverageRows: 32,
    });
  } finally {
    await browser.close();
  }
});

browserIt(
  "keeps mounted rows while rapid multi-screen scroll renders indexed noninteractive loading rows",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      await page.setContent(fixture());
      await page.addScriptTag({ content: resultWindowScript });
      await page.addScriptTag({ content: virtualListScript });

      const evidence = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("[data-wayfinder-equipment-virtual-list]")!;
        list.scrollTop = 24 * 48;
        const mountedAnchor = window.equipmentResultAnchorAtViewport(list);
        list.scrollTop = 40 * 48;
        const outrunAnchor = window.equipmentResultAnchorAtViewport(list);
        list.scrollTop = 80 * 48;
        const beforeRows = list.querySelectorAll("[data-result-index]").length;
        const loadingIndices = window.renderEquipmentResultSkeletonBand({
          list,
          total: 500,
          measurements: { estimatedRowPx: 48, measuredRows: new Map() },
        });
        const skeletons = [...list.querySelectorAll<HTMLElement>("[data-equipment-result-skeleton]")];
        const firstVisibleSkeleton = skeletons.find((row) => {
          const rowRect = row.getBoundingClientRect();
          const listRect = list.getBoundingClientRect();
          return rowRect.bottom > listRect.top && rowRect.top < listRect.bottom;
        });
        const band = list.querySelector<HTMLElement>("[data-equipment-skeleton-band]")!;
        const bandStyle = getComputedStyle(band);
        const skeletonStyle = getComputedStyle(firstVisibleSkeleton!);
        const skeletonPosition = skeletonStyle.position;
        list.scrollTop = 300 * 48;
        const focusedRow = list.querySelector<HTMLButtonElement>("[data-result-index='0'] button")!;
        focusedRow.focus({ preventScroll: true });
        const transferred = window.transferEquipmentResultFocusToSentinel(list);
        const sentinelScrollIndex = Math.floor(list.scrollTop / 48);
        list.style.height = "4000px";
        list.scrollTop = 0;
        const tallLoadingIndices = window.renderEquipmentResultSkeletonBand({
          list,
          total: 500,
          measurements: { estimatedRowPx: 48, measuredRows: new Map() },
        });
        return {
          afterRows: list.querySelectorAll("[data-result-index]").length,
          bandPointerEvents: bandStyle.pointerEvents,
          bandPosition: bandStyle.position,
          beforeRows,
          bandHidden: list.querySelector<HTMLElement>("[data-equipment-skeleton-band]")!.hidden,
          focusedSentinel: document.activeElement === list,
          firstVisibleLoadingIndex: firstVisibleSkeleton?.dataset.equipmentLoadingIndex,
          loadingIndices,
          mountedAnchor,
          noninteractive: skeletons.every(
            (row) => row.getAttribute("aria-hidden") === "true" && !row.querySelector("button, input, [tabindex]")
          ),
          outrunAnchor,
          sentinelScrollIndex,
          skeletonPosition,
          tallLoadingIndices,
          transferred,
        };
      });

      expect(evidence).toMatchObject({
        beforeRows: 36,
        afterRows: 36,
        bandPointerEvents: "none",
        bandPosition: "absolute",
        bandHidden: false,
        focusedSentinel: true,
        noninteractive: true,
        transferred: true,
        mountedAnchor: { index: 24, sourceUuid: "item-24", offsetFromViewportTopPx: 0 },
        outrunAnchor: null,
        skeletonPosition: "absolute",
      });
      expect(evidence.loadingIndices).toContain(80);
      expect(Number(evidence.firstVisibleLoadingIndex)).toBeGreaterThanOrEqual(79);
      expect(evidence.tallLoadingIndices).toContain(36);
      expect(evidence.tallLoadingIndices).toContain(84);
      expect(evidence.sentinelScrollIndex).toBe(300);
    } finally {
      await browser.close();
    }
  }
);

browserIt("keeps focus and commits only the latest equipment lifecycle after preemption and rejection", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(fixture());
    await page.addScriptTag({ content: resultWindowScript });
    await page.addScriptTag({ content: virtualListScript });
    await page.addScriptTag({ content: pickerSchedulerScript });

    const outcome = await page.evaluate(async () => {
      const list = document.querySelector<HTMLElement>("[data-wayfinder-equipment-virtual-list]")!;
      const focusedRow = list.querySelector<HTMLButtonElement>("[data-result-index='0'] button")!;
      focusedRow.focus({ preventScroll: true });
      window.transferEquipmentResultFocusToSentinel(list);
      let releaseObsolete!: () => void;
      const obsoleteGate = new Promise<void>((resolve) => {
        releaseObsolete = resolve;
      });
      const events: string[] = [];
      const signals: AbortSignal[] = [];
      let errors = 0;
      const scheduler = new window.PickerSearchScheduler({
        delayMs: 0,
        preemptInFlight: true,
        render: async (request, context) => {
          events.push(`start:${request.viewRevision}`);
          signals.push(context.signal);
          if (request.viewRevision === 1) await obsoleteGate;
          if (request.query === "reject") throw new Error("current rejection");
          if (!context.isCurrent()) {
            events.push(`stale:${request.viewRevision}`);
            return;
          }
          list.dataset.resultOffset = String(request.viewRevision * 12);
          events.push(`commit:${request.viewRevision}`);
        },
        onError: () => {
          errors += 1;
        },
      });
      const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

      scheduler.schedule("starting-equipment-level-1", "");
      await settle();
      // A facet/window revision can replace work without changing the query.
      scheduler.schedule("starting-equipment-level-1", "");
      await settle();
      const latestOffset = list.dataset.resultOffset;
      const obsoleteAborted = signals[0]?.aborted;
      releaseObsolete();
      await settle();

      scheduler.schedule("starting-equipment-level-1", "reject");
      await settle();
      scheduler.schedule("starting-equipment-level-1", "retry");
      await settle();

      return {
        errors,
        events,
        focusedSentinel: document.activeElement === list,
        latestOffset,
        obsoleteAborted,
        recoveredOffset: list.dataset.resultOffset,
      };
    });

    expect(outcome).toEqual({
      errors: 1,
      events: ["start:1", "start:2", "commit:2", "stale:1", "start:3", "start:4", "commit:4"],
      focusedSentinel: true,
      latestOffset: "24",
      obsoleteAborted: true,
      recoveredOffset: "48",
    });
  } finally {
    await browser.close();
  }
});

function fixture(height = 480): string {
  const rows = Array.from(
    { length: 36 },
    (_, index) =>
      `<article data-result-index="${index}" data-source-uuid="item-${index}" style="height:48px;flex:0 0 48px"><button>Item ${index}</button></article>`
  ).join("");
  return `<style>${productionEquipmentStyles}
    .wayfinder-app, .wayfinder-app * { box-sizing: border-box; }
    .wayfinder-app .equipment-result-list { flex: none; width: 700px; height: ${height}px; }
  </style>
  <div class="wayfinder-app">
    <div class="equipment-result-list" id="starting-equipment-level-1-equipment-results" role="list" aria-label="Equipment results" aria-busy="false" tabindex="-1" data-equipment-focus-sentinel data-wayfinder-equipment-virtual-list data-total-results="500" data-result-offset="0" data-wayfinder-rendered-query="" data-wayfinder-view-revision="1" data-wayfinder-source-revision="1" data-wayfinder-criteria-revision="0" data-step-id="starting-equipment-level-1" data-wayfinder-scroll-id="starting-equipment-level-1:equipment-results">
      <div class="equipment-result-spacer" style="height:0;flex:0 0 0" data-equipment-leading-spacer aria-hidden="true"></div>
      <div class="equipment-result-skeleton-band" data-equipment-skeleton-band aria-hidden="true" hidden></div>
      ${rows}
      <div class="equipment-result-spacer" style="height:${(500 - 36) * 48}px;flex:0 0 ${(500 - 36) * 48}px" data-equipment-trailing-spacer aria-hidden="true"></div>
    </div>
  </div>`;
}

declare global {
  interface Window {
    STARTING_EQUIPMENT_RESULT_WINDOW: typeof resultWindowContract;
    coverEquipmentResultViewport: typeof coverResultViewport;
    equipmentResultAnchorAtViewport: typeof resultAnchorAtViewport;
    renderEquipmentResultSkeletonBand: typeof renderSkeletonBand;
    transferEquipmentResultFocusToSentinel: typeof transferFocusToSentinel;
    PickerSearchScheduler: typeof PickerSearchSchedulerType;
  }
}
