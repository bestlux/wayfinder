import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import type { EquipmentStableCatalogue as StableCatalogue } from "../src/wayfinder/application/equipment-stable-catalogue";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;
const productionStyles = readFileSync(resolve("styles/wayfinder/starting-equipment.css"), "utf8");
const stableCatalogueScript = readFileSync(
  resolve("scripts/wayfinder/application/equipment-stable-catalogue.js"),
  "utf8"
)
  .replaceAll("export ", "")
  .concat("\nwindow.EquipmentStableCatalogue = EquipmentStableCatalogue;");

browserIt("mounts real rows synchronously across jumps and pins the focused row", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(fixture());
    await page.addScriptTag({ content: stableCatalogueScript });

    const evidence = await page.evaluate(async () => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const maximumVisibleGap = (viewport: HTMLElement): number => {
        const bounds = viewport.getBoundingClientRect();
        const coverage = [...viewport.querySelectorAll<HTMLElement>("[role='listitem']")]
          .map((row) => row.getBoundingClientRect())
          .filter((row) => row.bottom > bounds.top && row.top < bounds.bottom)
          .map((row) => ({ start: Math.max(bounds.top, row.top), end: Math.min(bounds.bottom, row.bottom) }))
          .sort((left, right) => left.start - right.start);
        let cursor = bounds.top;
        let gap = 0;
        for (const interval of coverage) {
          gap = Math.max(gap, interval.start - cursor);
          cursor = Math.max(cursor, interval.end);
        }
        return Math.max(gap, bounds.bottom - cursor);
      };
      const viewport = document.querySelector<HTMLElement>("[data-stable-list]")!;
      const canvas = document.querySelector<HTMLElement>("[data-stable-canvas]")!;
      const previousPageButton = document.querySelector<HTMLButtonElement>("[data-stable-page='previous']")!;
      const nextPageButton = document.querySelector<HTMLButtonElement>("[data-stable-page='next']")!;
      let previewedSourceUuid: string | null = null;
      const controller = new window.EquipmentStableCatalogue({
        viewport,
        canvas,
        rowHeightPx: 48,
        previousPageButton,
        nextPageButton,
        onPreview: (row) => {
          previewedSourceUuid = row.sourceUuid;
        },
      });
      const rows = Array.from({ length: 1_138 }, (_, index) => ({
        stepId: "starting-equipment-level-1",
        sourceUuid: `Compendium.pf2e.equipment-srd.Item.${index}`,
        name: `Equipment ${index}`,
        previewAriaLabel: `Preview Equipment ${index}`,
        previewFocusId: `preview:${index}`,
        levelLabel: `Level ${index % 21}`,
        rarity: index % 11 === 0 ? "uncommon" : "common",
        rarityLabel: "Uncommon",
        itemType: index % 3 === 0 ? "weapon" : "equipment",
        itemTypeLabel: index % 3 === 0 ? "Weapon" : "Equipment",
        typeIcon: "fa-box",
        sourceLabel: "Player Core",
        unavailableReason: null,
        priceLabel: `${index + 1} cp`,
        canAdd: true,
        previewing: false,
      }));
      controller.setProjection({ key: "fixture", rows });
      await nextFrame();
      const pagingAtStart = { previousDisabled: previousPageButton.disabled, nextDisabled: nextPageButton.disabled };
      nextPageButton.click();
      await nextFrame();
      const pagingFocusedPosition =
        document.activeElement?.closest<HTMLElement>("[data-result-index]")?.dataset.resultIndex;
      const pagingScrollTop = viewport.scrollTop;
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
      await nextFrame();
      viewport.style.height = "960px";
      await nextFrame();
      await nextFrame();
      const expandedGapPx = maximumVisibleGap(viewport);
      viewport.style.height = "480px";
      await nextFrame();

      const stableViewport = viewport;
      viewport.scrollTop = 720 * 48;
      viewport.dispatchEvent(new Event("scroll"));
      const immediateGapPx = maximumVisibleGap(viewport);
      const immediateRows = viewport.querySelectorAll("[role='listitem']").length;
      const destination = viewport.querySelector<HTMLElement>("[data-result-index='720']")!;
      destination.querySelector<HTMLButtonElement>("button")!.click();
      const destinationA11y = {
        position: destination.getAttribute("aria-posinset"),
        setSize: destination.getAttribute("aria-setsize"),
      };
      await nextFrame();

      const focusButton = viewport.querySelector<HTMLButtonElement>("[data-result-index='720'] button")!;
      focusButton.focus({ preventScroll: true });
      viewport.scrollTop = 950 * 48;
      viewport.dispatchEvent(new Event("scroll"));
      const focusPinnedImmediately = document.activeElement === focusButton && focusButton.isConnected;
      await nextFrame();
      const focusPinnedAfterFrame = document.activeElement === focusButton && focusButton.isConnected;
      viewport.focus({ preventScroll: true });
      await nextFrame();
      await nextFrame();

      const outcome = {
        destinationA11y,
        expandedGapPx,
        focusPinnedAfterFrame,
        focusPinnedImmediately,
        immediateGapPx,
        immediateRows,
        mountedAfterFrame: viewport.querySelectorAll("[role='listitem']").length,
        pagingAtStart,
        pagingFocusedPosition,
        pagingScrollTop,
        pinnedRemovedAfterBlur: !focusButton.isConnected,
        previewedSourceUuid,
        stableViewport: stableViewport === document.querySelector("[data-stable-list]"),
        totalCanvasHeight: canvas.style.height,
      };
      controller.dispose();
      return outcome;
    });

    expect(evidence).toMatchObject({
      destinationA11y: { position: "721", setSize: "1138" },
      expandedGapPx: 0,
      focusPinnedAfterFrame: true,
      focusPinnedImmediately: true,
      immediateGapPx: 0,
      pagingAtStart: { previousDisabled: true, nextDisabled: false },
      pinnedRemovedAfterBlur: true,
      previewedSourceUuid: "Compendium.pf2e.equipment-srd.Item.720",
      stableViewport: true,
      totalCanvasHeight: `${1_138 * 48}px`,
    });
    expect(evidence.immediateRows).toBeLessThanOrEqual(20);
    expect(evidence.mountedAfterFrame).toBeLessThanOrEqual(48);
    expect(Number(evidence.pagingFocusedPosition)).toBeGreaterThan(0);
    expect(evidence.pagingScrollTop).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

function fixture(): string {
  return `<style>${productionStyles}
    .wayfinder-app, .wayfinder-app * { box-sizing: border-box; }
    .wayfinder-app .equipment-result-list { flex:none; width:700px; height:480px; }
  </style>
  <div class="wayfinder-app">
    <div class="equipment-result-list" role="list" tabindex="-1" data-stable-list>
      <div class="equipment-stable-catalogue-canvas" role="presentation" data-stable-canvas></div>
    </div>
    <button type="button" data-stable-page="previous">Previous</button>
    <button type="button" data-stable-page="next">Next</button>
  </div>`;
}

declare global {
  interface Window {
    EquipmentStableCatalogue: typeof StableCatalogue;
  }
}
