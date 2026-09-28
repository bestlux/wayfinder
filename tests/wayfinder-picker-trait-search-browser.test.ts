import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import type { PickerTraitSearch } from "../src/wayfinder/application/picker-trait-search.js";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].find((path): path is string => Boolean(path && existsSync(path)));
const browserIt = chromePath ? it : it.skip;
const script = readFileSync(resolve("scripts/wayfinder/application/picker-trait-search.js"), "utf8")
  .replaceAll("export ", "")
  .concat("\nwindow.traitSearch = new PickerTraitSearch();");

declare global {
  interface Window {
    traitSearch: PickerTraitSearch;
  }
}

browserIt(
  "filters trait labels locally, retains caret, active controls and query across binds",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(fixture());
      await page.addStyleTag({ content: readFileSync(resolve("styles/wayfinder/picker-preview.css"), "utf8") });
      await page.addScriptTag({ content: script });
      await page.evaluate(() => window.traitSearch.bind(document.body));
      const search = page.getByRole("searchbox", { name: "Search traits" });
      await search.focus();
      await search.pressSequentially("dediction");
      await search.press("Home");
      await search.press("ArrowRight");
      await search.press("ArrowRight");
      await search.press("ArrowRight");
      await search.press("ArrowRight");
      await search.press("ArrowRight");
      await search.pressSequentially("a");
      expect(await search.inputValue()).toBe("dedication");
      expect(
        await search.evaluate((input) => ({
          focused: document.activeElement === input,
          caret: (input as HTMLInputElement).selectionStart,
        }))
      ).toEqual({ focused: true, caret: 6 });
      expect(await page.locator("[data-picker-trait-option]:visible").count()).toBe(2);
      expect(await page.locator("[data-picker-trait-count]").textContent()).toBe("2");
      expect(await page.locator("#feat-results").textContent()).toBe("unchanged feats");
      const original = await search.elementHandle();
      await page.evaluate(() => window.traitSearch.bind(document.body));
      expect(await search.evaluate((node, previous) => node === previous, original)).toBe(true);
      expect(await search.evaluate((input) => (input as HTMLInputElement).selectionStart)).toBe(6);
      await page.setContent(fixture());
      await page.evaluate(() => window.traitSearch.bind(document.body));
      expect(await search.inputValue()).toBe("dedication");
      expect(await page.locator("[data-picker-trait-option]:visible").count()).toBe(2);
      await search.fill("absent");
      expect(await page.locator("[data-picker-trait-option]:visible").count()).toBe(1);
      const focusRecovered = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[data-picker-trait-option][data-active="true"]')!;
        const button = row.querySelector("button")!;
        button.dataset.wayfinderFocusId = "picker-trait-include:fighter";
        button.focus();
        row.dataset.active = "false";
        window.traitSearch.bind(document.body);
        window.traitSearch.focusTarget(document.body, "picker-trait-include:fighter")?.focus();
        return document.activeElement?.matches("[data-picker-trait-search]");
      });
      expect(focusRecovered).toBe(true);
      await page.evaluate(() =>
        document.querySelector(".picker-filter-trigger")?.addEventListener("click", () => {
          document.body.dataset.closed = "true";
        })
      );
      await search.press("Escape");
      expect(await page.locator("body").getAttribute("data-closed")).toBe("true");
      await page.evaluate(() => {
        window.traitSearch.clear("feat-2");
        window.traitSearch.bind(document.body);
      });
      expect(await search.inputValue()).toBe("");
      expect(await page.locator("[data-picker-trait-option]:visible").count()).toBe(3);
    } finally {
      await browser.close();
    }
  },
  20_000
);

function fixture(): string {
  return `<section data-wayfinder-filter-menu><button type="button" class="picker-filter-trigger">Traits</button><div data-picker-trait-panel><input type="search" data-picker-trait-search data-step-id="feat-2" aria-label="Search traits"><p role="status"><span data-picker-trait-count></span> traits</p><div class="picker-trait-option" data-picker-trait-option data-search="Dedication dedication" data-active="false">Dedication</div><div class="picker-trait-option" data-picker-trait-option data-search="Press press" data-active="false">Press</div><div class="picker-trait-option" data-picker-trait-option data-search="Fighter fighter" data-active="true">Fighter <button aria-pressed="true">Include</button></div></div></section><div id="feat-results">unchanged feats</div>`;
}
