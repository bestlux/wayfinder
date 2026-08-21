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
