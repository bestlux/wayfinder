import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it, vi } from "vitest";
import type { EquipmentStableCatalogue as StableCatalogue } from "../src/wayfinder/application/equipment-stable-catalogue";
import type { EquipmentStableCatalogueHost as StableCatalogueHost } from "../src/wayfinder/application/equipment-stable-catalogue-host";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;
const BROWSER_INTEGRATION_TEST_TIMEOUT_MS = 20_000;
vi.setConfig({ testTimeout: BROWSER_INTEGRATION_TEST_TIMEOUT_MS });
const productionStyles = readFileSync(resolve("styles/wayfinder/starting-equipment.css"), "utf8");
const stableCatalogueScript = readFileSync(
  resolve("scripts/wayfinder/application/equipment-stable-catalogue.js"),
  "utf8"
)
  .replaceAll("export ", "")
  .concat("\nwindow.EquipmentStableCatalogue = EquipmentStableCatalogue;");
const stableCatalogueHostScript = readFileSync(
  resolve("scripts/wayfinder/application/equipment-stable-catalogue-host.js"),
  "utf8"
)
  .replace(/^import[^\n]+\n/u, "")
  .replaceAll("export ", "")
  .concat("\nwindow.EquipmentStableCatalogueHost = EquipmentStableCatalogueHost;");

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
      const host = viewport.closest<HTMLElement>("[data-stable-host]")!;
      const previousPageButton = document.querySelector<HTMLButtonElement>("[data-stable-page='previous']")!;
      const nextPageButton = document.querySelector<HTMLButtonElement>("[data-stable-page='next']")!;
      let previewedSourceUuid: string | null = null;
      const controller = new window.EquipmentStableCatalogue({
        host,
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
        priceLabel: index === 5 ? "View for exact price" : `${index + 1} cp`,
        pricePending: index === 5,
        canAdd: index !== 5 && index !== 6,
        previewing: false,
      }));
      let rowProjectionCalls = 0;
      controller.setProjection({
        key: "fixture",
        orderKey: "fixture-order",
        stepId: "starting-equipment-level-1",
        renderedQuery: "",
        totalResultCount: rows.length,
        resultOffset: 0,
        resultLimit: 120,
        viewRevision: 1,
        sourceRevision: 1,
        criteriaRevision: 0,
        sourceUuids: rows.map((row) => row.sourceUuid),
        rowAt: (index) => {
          rowProjectionCalls += 1;
          return rows[index]!;
        },
      });
      await nextFrame();
      const initialRowProjectionCalls = rowProjectionCalls;
      const firstRoot = viewport.querySelector<HTMLElement>("[data-result-index='0']")!;
      const initialKeyboardFocusMarker = firstRoot.querySelector("button")?.getAttribute("data-keyboard-focus");
      const updatedRows = [...rows];
      updatedRows[0] = { ...rows[0]!, name: "Updated Equipment 0" };
      controller.setProjection({
        key: "fixture:preview",
        orderKey: "fixture-order",
        stepId: "starting-equipment-level-1",
        renderedQuery: "",
        totalResultCount: updatedRows.length,
        resultOffset: 0,
        resultLimit: 120,
        viewRevision: 2,
        sourceRevision: 1,
        criteriaRevision: 0,
        sourceUuids: updatedRows.map((row) => row.sourceUuid),
        rowAt: (index) => {
          rowProjectionCalls += 1;
          return updatedRows[index]!;
        },
      });
      const volatilePatchProjectionCalls = rowProjectionCalls - initialRowProjectionCalls;
      const stableOrderUpdate = {
        indexBuilds: viewport.dataset.orderIndexBuildCount,
        nodePreserved: firstRoot === viewport.querySelector("[data-result-index='0']"),
        updatedName: firstRoot.querySelector(".equipment-result-name")?.textContent,
      };
      const pendingRoot = viewport.querySelector<HTMLElement>("[data-result-index='5']")!;
      const blockedRoot = viewport.querySelector<HTMLElement>("[data-result-index='6']")!;
      const pendingPresentation = {
        blocked: pendingRoot.classList.contains("is-blocked"),
        pricePending: pendingRoot.dataset.pricePending,
        unaffordable: pendingRoot.querySelector(".equipment-result-price")!.classList.contains("is-unaffordable"),
      };
      const blockedPresentation = {
        blocked: blockedRoot.classList.contains("is-blocked"),
        unaffordable: blockedRoot.querySelector(".equipment-result-price")!.classList.contains("is-unaffordable"),
      };
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
      const destinationKeyboardFocusMarker = destination.querySelector("button")?.getAttribute("data-keyboard-focus");
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
        destinationKeyboardFocusMarker,
        expandedGapPx,
        focusPinnedAfterFrame,
        focusPinnedImmediately,
        immediateGapPx,
        immediateRows,
        initialKeyboardFocusMarker,
        mountedAfterFrame: viewport.querySelectorAll("[role='listitem']").length,
        pagingAtStart,
        pendingPresentation,
        blockedPresentation,
        pagingFocusedPosition,
        pagingScrollTop,
        pinnedRemovedAfterBlur: !focusButton.isConnected,
        previewedSourceUuid,
        initialRowProjectionCalls,
        volatilePatchProjectionCalls,
        stableViewport: stableViewport === document.querySelector("[data-stable-list]"),
        stableOrderUpdate,
        totalCanvasHeight: canvas.style.height,
      };
      controller.dispose();
      return outcome;
    });

    expect(evidence).toMatchObject({
      destinationA11y: { position: "721", setSize: "1138" },
      destinationKeyboardFocusMarker: "true",
      expandedGapPx: 0,
      focusPinnedAfterFrame: true,
      focusPinnedImmediately: true,
      immediateGapPx: 0,
      initialKeyboardFocusMarker: "true",
      pagingAtStart: { previousDisabled: true, nextDisabled: false },
      pendingPresentation: { blocked: false, pricePending: "true", unaffordable: false },
      blockedPresentation: { blocked: true, unaffordable: true },
      pinnedRemovedAfterBlur: true,
      previewedSourceUuid: "Compendium.pf2e.equipment-srd.Item.720",
      stableViewport: true,
      stableOrderUpdate: { indexBuilds: "1", nodePreserved: true, updatedName: "Updated Equipment 0" },
      totalCanvasHeight: `${1_138 * 48}px`,
    });
    expect(evidence.immediateRows).toBeLessThanOrEqual(20);
    expect(evidence.mountedAfterFrame).toBeLessThanOrEqual(48);
    expect(evidence.initialRowProjectionCalls).toBeGreaterThan(0);
    expect(evidence.initialRowProjectionCalls).toBeLessThanOrEqual(48);
    expect(evidence.volatilePatchProjectionCalls).toBeGreaterThan(0);
    expect(evidence.volatilePatchProjectionCalls).toBeLessThanOrEqual(48);
    expect(Number(evidence.pagingFocusedPosition)).toBeGreaterThan(0);
    expect(evidence.pagingScrollTop).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

browserIt("keeps long localized rows bounded across narrow layouts, text zoom, and restored scroll", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(responsiveFixture());
    await page.addScriptTag({ content: stableCatalogueScript });

    const evidence = await page.evaluate(async () => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const stage = document.querySelector<HTMLElement>("[data-responsive-stage]")!;
      const viewport = document.querySelector<HTMLElement>("[data-stable-list]")!;
      const canvas = document.querySelector<HTMLElement>("[data-stable-canvas]")!;
      const host = viewport.closest<HTMLElement>("[data-stable-host]")!;
      const rows = Array.from({ length: 200 }, (_, index) => ({
        stepId: "starting-equipment-level-1",
        sourceUuid: `Compendium.pf2e.equipment-srd.Item.localized-${index}`,
        name:
          index % 2 === 0
            ? `超长的中文装备名称用于验证在放大和狭窄布局中不会被无声裁切 ${index}`
            : `An extraordinarily long localized equipment name for narrow and magnified layouts ${index}`,
        previewAriaLabel: `查看超长的中文装备名称 ${index}`,
        previewFocusId: `localized-preview:${index}`,
        levelLabel: `等级 ${index % 21}`,
        rarity: "uncommon",
        rarityLabel: "罕见",
        itemType: "equipment",
        itemTypeLabel: "装备",
        typeIcon: "fa-box",
        sourceLabel:
          index % 2 === 0
            ? "极其冗长的规则书与补充资料来源名称"
            : "An Extremely Long Rules Source and Supplemental Publication Name",
        unavailableReason:
          index % 2 === 0
            ? "此物品需要游戏主持人批准一个同样非常长的例外理由"
            : "This item requires Game Master approval for a deliberately long exception reason",
        priceLabel: "查看以核对准确价格",
        canAdd: false,
        previewing: false,
      }));
      const controller = new window.EquipmentStableCatalogue({ host, viewport, canvas });
      const projection = {
        key: "localized",
        orderKey: "localized-order",
        stepId: "starting-equipment-level-1",
        renderedQuery: "",
        totalResultCount: rows.length,
        resultOffset: 0,
        resultLimit: 120,
        viewRevision: 1,
        sourceRevision: 1,
        criteriaRevision: 0,
        sourceUuids: rows.map((row) => row.sourceUuid),
        rowAt: (index: number) => rows[index]!,
      };
      controller.setProjection(projection);
      await nextFrame();
      await nextFrame();

      const geometry = () => {
        const mounted = [...viewport.querySelectorAll<HTMLElement>("[role='listitem']")];
        const buttons = mounted.map((row) => row.querySelector<HTMLElement>("button")!);
        return {
          canvasHeight: Number.parseFloat(canvas.style.height),
          rowHeight: mounted[0]?.getBoundingClientRect().height ?? 0,
          rowsBounded: buttons.every((button) => button.scrollHeight <= button.clientHeight),
          pricesBounded: mounted.every((row) => {
            const price = row.querySelector<HTMLElement>(".equipment-result-price")!;
            return getComputedStyle(price).overflowWrap === "anywhere" && price.scrollHeight <= price.clientHeight;
          }),
        };
      };

      const at980 = geometry();
      stage.style.width = "760px";
      await nextFrame();
      await nextFrame();
      controller.setProjection(projection);
      const at760 = geometry();

      document.documentElement.style.fontSize = "32px";
      controller.setProjection(projection);
      const at200Percent = geometry();
      const restoredTarget = 80 * at200Percent.rowHeight;
      controller.restoreScrollTop(restoredTarget);
      const restoredIndex = Math.floor(viewport.scrollTop / at200Percent.rowHeight);
      const restoredHasDestination = Boolean(viewport.querySelector(`[data-result-index='${restoredIndex}']`));
      const restoredScrollTop = viewport.scrollTop;
      controller.dispose();
      return { at980, at760, at200Percent, restoredHasDestination, restoredIndex, restoredScrollTop };
    });

    expect(evidence.at980).toMatchObject({ rowHeight: 72, rowsBounded: true, pricesBounded: true });
    expect(evidence.at980.canvasHeight).toBe(200 * 72);
    expect(evidence.at760).toMatchObject({ rowHeight: 80, rowsBounded: true, pricesBounded: true });
    expect(evidence.at760.canvasHeight).toBe(200 * 80);
    expect(evidence.at200Percent).toMatchObject({ rowHeight: 160, rowsBounded: true, pricesBounded: true });
    expect(evidence.at200Percent.canvasHeight).toBe(200 * 160);
    expect(evidence.restoredIndex).toBe(80);
    expect(evidence.restoredHasDestination).toBe(true);
    expect(evidence.restoredScrollTop).toBe(80 * 160);
  } finally {
    await browser.close();
  }
});

browserIt("preserves the durable host across projections and disposes it only after full replacement", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(hostLifecycleFixture());
    await page.addScriptTag({ content: stableCatalogueScript });
    await page.addScriptTag({ content: stableCatalogueHostScript });

    const evidence = await page.evaluate(async () => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const root = document.querySelector<HTMLElement>("[data-lifecycle-root]")!;
      const controllerHost = new window.EquipmentStableCatalogueHost();
      const row = (sourceUuid: string, name = sourceUuid) => ({
        sourceUuid,
        name,
        previewAriaLabel: `Preview ${name}`,
        previewFocusId: `preview:${sourceUuid}`,
        levelLabel: "Level 1",
        rarity: "common",
        rarityLabel: "Common",
        itemType: "equipment",
        itemTypeLabel: "Equipment",
        typeIcon: "fa-box",
        sourceLabel: "Player Core",
        unavailableReason: null,
        priceLabel: "1 gp",
        canAdd: true,
        previewing: false,
      });
      const projection = (
        key: string,
        orderKey: string,
        rows: ReturnType<typeof row>[],
        revisions: {
          view: number;
          source?: number;
          criteria?: number;
          query?: string;
          offset?: number;
          total?: number;
        } = {
          view: 1,
        }
      ) => ({
        key,
        orderKey,
        stepId: "starting-equipment-level-1",
        renderedQuery: revisions.query ?? "",
        totalResultCount: revisions.total ?? rows.length,
        resultOffset: revisions.offset ?? 0,
        resultLimit: 120,
        viewRevision: revisions.view,
        sourceRevision: revisions.source ?? 4,
        criteriaRevision: revisions.criteria ?? 0,
        sourceUuids: rows.map((entry) => entry.sourceUuid),
        rowAt: (index: number) => rows[index]!,
      });
      const initialRows = [row("a", "Alpha"), row("b", "Beta"), row("c", "Gamma")];
      controllerHost.update({ root, projection: projection("initial", "abc", initialRows) });
      await nextFrame();
      const initialHost = root.querySelector<HTMLElement>("[data-equipment-stable-host]")!;
      const initialViewport = root.querySelector<HTMLElement>("[data-wayfinder-equipment-virtual-list]")!;
      const initialCanvas = root.querySelector<HTMLElement>("[data-equipment-stable-canvas]")!;
      const betaButton = initialViewport.querySelector<HTMLButtonElement>("[data-source-uuid='b'] button")!;
      betaButton.focus({ preventScroll: true });

      root.querySelector("[data-application-part='equipment-catalogue']")!.outerHTML =
        `<div data-application-part="equipment-catalogue"><button data-filter aria-pressed="true">Available <span data-count>2</span></button></div>`;
      const updatedRows = [initialRows[0]!, row("b", "Beta revised"), initialRows[2]!];
      controllerHost.update({
        root,
        projection: projection("updated", "abc", updatedRows, {
          view: 7,
          source: 5,
          criteria: 3,
          query: "beta",
          offset: 12,
          total: 47,
        }),
      });
      const sameOrder = {
        filterCount: root.querySelector("[data-count]")?.textContent,
        filterPressed: root.querySelector("[data-filter]")?.getAttribute("aria-pressed"),
        focused: document.activeElement === betaButton,
        hostPreserved: root.querySelector("[data-equipment-stable-host]") === initialHost,
        name: betaButton.querySelector(".equipment-result-name")?.textContent,
        nodePreserved: initialViewport.querySelector("[data-source-uuid='b'] button") === betaButton,
        viewportPreserved: root.querySelector("[data-wayfinder-equipment-virtual-list]") === initialViewport,
      };
      const hostDatasets = { ...initialHost.dataset };
      const viewportDatasets = { ...initialViewport.dataset };

      controllerHost.update({
        root,
        projection: projection("reordered", "cab", [initialRows[2]!, initialRows[0]!, updatedRows[1]!], {
          view: 8,
          source: 5,
          criteria: 3,
          query: "beta",
        }),
      });
      const reordered = {
        focused: document.activeElement === betaButton,
        index: betaButton.closest<HTMLElement>("[data-result-index]")?.dataset.resultIndex,
        nodePreserved: initialViewport.querySelector("[data-source-uuid='b'] button") === betaButton,
      };

      controllerHost.update({ root, projection: projection("empty", "empty", [], { view: 9, criteria: 4 }) });
      const empty = {
        canvasChildren: initialCanvas.childElementCount,
        focusedViewport: document.activeElement === initialViewport,
        total: initialViewport.dataset.totalResults,
      };
      controllerHost.update({
        root,
        projection: projection("restored", "ca", [initialRows[2]!, initialRows[0]!], { view: 10, criteria: 5 }),
      });
      const restored = {
        hasAlpha: Boolean(initialViewport.querySelector("[data-source-uuid='a']")),
        hasGamma: Boolean(initialViewport.querySelector("[data-source-uuid='c']")),
        viewportPreserved: root.querySelector("[data-wayfinder-equipment-virtual-list]") === initialViewport,
      };

      const replacementHost = initialHost.cloneNode(true) as HTMLElement;
      replacementHost.querySelector("[data-equipment-stable-canvas]")?.replaceChildren();
      initialHost.replaceWith(replacementHost);
      const nextViewport = root.querySelector<HTMLElement>("[data-wayfinder-equipment-virtual-list]")!;
      nextViewport.classList.remove("is-stable-catalogue");
      controllerHost.update({
        root,
        projection: projection("full-replacement", "d", [row("d", "Delta")], { view: 11, source: 6 }),
      });
      const fullReplacement = {
        newHostMounted: nextViewport.classList.contains("is-stable-catalogue"),
        oldCanvasCleared: initialCanvas.childElementCount === 0,
        oldControllerDisposed: !initialViewport.classList.contains("is-stable-catalogue"),
        viewportReplaced: nextViewport !== initialViewport,
      };
      controllerHost.dispose();
      return { empty, fullReplacement, hostDatasets, reordered, restored, sameOrder, viewportDatasets };
    });

    expect(evidence.sameOrder).toEqual({
      filterCount: "2",
      filterPressed: "true",
      focused: true,
      hostPreserved: true,
      name: "Beta revised",
      nodePreserved: true,
      viewportPreserved: true,
    });
    expect(evidence.hostDatasets).toMatchObject({
      orderKey: "abc",
      projectionKey: "updated",
      resultLimit: "120",
      resultOffset: "12",
      totalResults: "47",
      wayfinderCriteriaRevision: "3",
      wayfinderRenderedQuery: "beta",
      wayfinderSourceRevision: "5",
      wayfinderViewRevision: "7",
    });
    expect(evidence.viewportDatasets).toMatchObject({
      orderKey: evidence.hostDatasets.orderKey,
      projectionKey: evidence.hostDatasets.projectionKey,
      resultLimit: evidence.hostDatasets.resultLimit,
      resultOffset: evidence.hostDatasets.resultOffset,
      stepId: evidence.hostDatasets.stepId,
      totalResults: evidence.hostDatasets.totalResults,
      wayfinderCriteriaRevision: evidence.hostDatasets.wayfinderCriteriaRevision,
      wayfinderRenderedQuery: evidence.hostDatasets.wayfinderRenderedQuery,
      wayfinderSourceRevision: evidence.hostDatasets.wayfinderSourceRevision,
      wayfinderViewRevision: evidence.hostDatasets.wayfinderViewRevision,
    });
    expect(evidence.reordered).toEqual({ focused: true, index: "2", nodePreserved: true });
    expect(evidence.empty).toEqual({ canvasChildren: 0, focusedViewport: true, total: "0" });
    expect(evidence.restored).toEqual({ hasAlpha: true, hasGamma: true, viewportPreserved: true });
    expect(evidence.fullReplacement).toEqual({
      newHostMounted: true,
      oldCanvasCleared: true,
      oldControllerDisposed: true,
      viewportReplaced: true,
    });
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
    <div data-stable-host>
      <div class="equipment-result-list" role="list" tabindex="-1" data-stable-list>
        <div class="equipment-stable-catalogue-canvas" role="presentation" data-stable-canvas></div>
      </div>
    </div>
    <button type="button" data-stable-page="previous">Previous</button>
    <button type="button" data-stable-page="next">Next</button>
  </div>`;
}

function responsiveFixture(): string {
  return `<style>${productionStyles}
    .wayfinder-app, .wayfinder-app * { box-sizing: border-box; }
    .wayfinder-stage { container: wayfinder-stage / inline-size; width:980px; }
    .wayfinder-app .equipment-result-list { flex:none; width:100%; height:480px; }
  </style>
  <div class="wayfinder-stage" data-responsive-stage>
    <div class="wayfinder-app">
      <div data-stable-host>
        <div class="equipment-result-list" role="list" tabindex="-1" data-stable-list>
          <div class="equipment-stable-catalogue-canvas" role="presentation" data-stable-canvas></div>
        </div>
      </div>
    </div>
  </div>`;
}

function hostLifecycleFixture(): string {
  return `<style>${productionStyles}
    .wayfinder-app, .wayfinder-app * { box-sizing: border-box; }
    .wayfinder-app .equipment-result-list { flex:none; width:700px; height:128px; }
  </style>
  <div class="wayfinder-app" data-lifecycle-root>
    <div data-application-part="equipment-catalogue"><button data-filter aria-pressed="false">Available <span data-count>3</span></button></div>
    ${stableHostMarkup()}
  </div>`;
}

function stableHostMarkup(): string {
  return `<div data-equipment-stable-host data-step-id="starting-equipment-level-1">
    <div class="equipment-result-list" role="list" tabindex="-1" data-wayfinder-equipment-virtual-list data-step-id="starting-equipment-level-1">
      <div class="equipment-stable-catalogue-canvas" role="presentation" data-equipment-stable-canvas></div>
    </div>
    <button type="button" data-equipment-stable-page="previous">Previous</button>
    <button type="button" data-equipment-stable-page="next">Next</button>
  </div>`;
}

declare global {
  interface Window {
    EquipmentStableCatalogue: typeof StableCatalogue;
    EquipmentStableCatalogueHost: typeof StableCatalogueHost;
  }
}
