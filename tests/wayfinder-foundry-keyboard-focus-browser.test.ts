import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const keyboardFocusScript = readFileSync(
  resolve("scripts/wayfinder/application/foundry-keyboard-focus-service.js"),
  "utf8"
)
  .replaceAll("export ", "")
  .concat("\nwindow.markWayfinderKeyboardFocus = markWayfinderKeyboardFocus;");

browserIt(
  "preserves native Tab traversal against Foundry's canvas keybinding without changing external modal behavior",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(fixture);
      await page.addScriptTag({ content: foundryKeyboardInterception });
      await page.addScriptTag({ content: keyboardFocusScript });

      await page.locator("#heading").focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("heading");
      expect(await page.evaluate(() => window.cycleViewCount)).toBe(1);

      expect(await page.evaluate(() => window.markWayfinderKeyboardFocus(document.querySelector("#wayfinder")!))).toBe(
        5
      );
      await page.locator("#heading").focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("previous");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("start");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("search");
      await page.keyboard.type("Dagger");
      expect(await page.locator("#search").inputValue()).toBe("Dagger");
      expect(await page.evaluate(() => window.cycleViewCount)).toBe(1);

      expect(await page.locator("#modal-save").getAttribute("data-keyboard-focus")).toBeNull();
      await page.locator("#modal-save").focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("previous");
      expect(await page.evaluate(() => window.cycleViewCount)).toBe(1);
      await page.locator("#modal-save").focus();
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => window.modalSubmitCount)).toBe(1);
    } finally {
      await browser.close();
    }
  },
  20_000
);

const fixture = `
  <section class="application user-config" aria-label="User Configuration">
    <form><button id="modal-save" type="button">Save</button></form>
  </section>
  <main id="wayfinder">
    <h3 id="heading" tabindex="-1">Starting equipment</h3>
    <button id="previous" type="button">Previous step</button>
    <button id="next" type="button" disabled>Next step</button>
    <button id="start" type="button">Start Shopping</button>
    <input id="search" aria-label="Search equipment" />
  </main>`;

// Mirrors Foundry 14.366 KeyboardManager.hasFocus and the consumed core cycleView Tab binding.
const foundryKeyboardInterception = `
  window.cycleViewCount = 0;
  window.modalSubmitCount = 0;
  document.querySelector("#modal-save").addEventListener("click", () => window.modalSubmitCount += 1);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focused = document.activeElement;
    const explicitFocus = ["", "true"].includes(focused?.dataset?.keyboardFocus);
    const textInputFocus = ["INPUT", "SELECT", "TEXTAREA"].includes(focused?.tagName);
    const formButtonFocus = focused?.tagName === "BUTTON" && Boolean(focused.form);
    if (explicitFocus || textInputFocus || formButtonFocus) return;
    window.cycleViewCount += 1;
    event.preventDefault();
    event.stopPropagation();
  });`;

declare global {
  interface Window {
    cycleViewCount: number;
    modalSubmitCount: number;
    markWayfinderKeyboardFocus(root: ParentNode): number;
  }
}
