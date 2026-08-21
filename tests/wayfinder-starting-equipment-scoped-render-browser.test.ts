import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;

browserIt("keeps the equipment search node, focus, and caret while stale part work rolls back", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="equipment-catalogue">
        <div class="equipment-search-row">
          <input type="search" data-wayfinder-equipment-search data-step-id="starting-equipment-level-5" />
        </div>
        <div data-application-part="equipment-catalogue" data-step-id="starting-equipment-level-5">initial</div>
      </section>
      <aside data-application-part="equipment-detail" data-step-id="starting-equipment-level-5">initial detail</aside>
    `);

    const outcome = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>("[data-wayfinder-equipment-search]")!;
      const originalInput = input;
      input.value = "spray pellets";
      input.focus();
      input.setSelectionRange(5, 5);
      const currentViewRevision = 2;

      const replaceParts = async (viewRevision: number, delay: number, label: string) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (viewRevision !== currentViewRevision) return false;
        const catalogue = document.querySelector<HTMLElement>('[data-application-part="equipment-catalogue"]')!;
        const detail = document.querySelector<HTMLElement>('[data-application-part="equipment-detail"]')!;
        catalogue.outerHTML = `<div data-application-part="equipment-catalogue" data-step-id="starting-equipment-level-5">${label}</div>`;
        detail.outerHTML = `<aside data-application-part="equipment-detail" data-step-id="starting-equipment-level-5">${label} detail</aside>`;
        return true;
      };

      const stale = replaceParts(1, 20, "stale");
      const current = replaceParts(2, 0, "current");
      const [staleCommitted, currentCommitted] = await Promise.all([stale, current]);

      return {
        staleCommitted,
        currentCommitted,
        sameInput: originalInput === document.querySelector("[data-wayfinder-equipment-search]"),
        focused: document.activeElement === originalInput,
        selectionStart: originalInput.selectionStart,
        value: originalInput.value,
        catalogue: document.querySelector('[data-application-part="equipment-catalogue"]')?.textContent,
      };
    });

    expect(outcome).toEqual({
      staleCommitted: false,
      currentCommitted: true,
      sameInput: true,
      focused: true,
      selectionStart: 5,
      value: "spray pellets",
      catalogue: "current",
    });
  } finally {
    await browser.close();
  }
});

browserIt("keeps focus on a leaf result when the selected preview is activated again", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="equipment-result-list">
        <button class="equipment-result is-previewing" aria-pressed="true" data-source-uuid="item-1">Dagger · Level 0 · Common · 2 sp · Available</button>
      </div>
      <aside data-application-part="equipment-detail">Dagger detail</aside>
    `);
    await page.evaluate(() => {
      let selectedSourceUuid = "item-1";
      let renderCount = 0;
      const button = document.querySelector<HTMLButtonElement>("[data-source-uuid='item-1']")!;
      button.addEventListener("click", () => {
        if (selectedSourceUuid === button.dataset.sourceUuid) return;
        selectedSourceUuid = button.dataset.sourceUuid ?? "";
        renderCount += 1;
      });
      Object.assign(window, { compactPreviewRenderCount: () => renderCount });
    });

    const result = page.locator("[data-source-uuid='item-1']");
    await result.focus();
    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-source-uuid"))).toBe("item-1");
    expect(await page.evaluate(() => window.compactPreviewRenderCount())).toBe(0);
    await expect(result.getAttribute("aria-pressed")).resolves.toBe("true");
  } finally {
    await browser.close();
  }
});

declare global {
  interface Window {
    compactPreviewRenderCount(): number;
  }
}
