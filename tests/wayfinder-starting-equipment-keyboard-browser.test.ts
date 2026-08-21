import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
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
const accessibilityScript = readFileSync(resolve("scripts/wayfinder/application/equipment-accessibility.js"), "utf8")
  .replaceAll("export ", "")
  .concat("\nwindow.restoreEquipmentFocus = restoreEquipmentFocus;");

browserIt(
  "supports a keyboard-only acquisition path with named controls, announcements, and deterministic relocation",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(keyboardFixture);
      await page.addScriptTag({ content: accessibilityScript });
      await page.evaluate(() => {
        const buy = document.querySelector<HTMLButtonElement>("[data-action='buy']")!;
        buy.addEventListener("click", () => {
          buy.remove();
          const cart = document.querySelector<HTMLElement>("[data-cart]")!;
          cart.innerHTML = `
            <p data-cart-status role="status" aria-live="polite" aria-atomic="true"></p>
            <article tabindex="-1" data-wayfinder-focus-id="starting-equipment-line:line-1">
              <strong>Adventurer's Pack</strong>
              <button aria-label="Decrease quantity of Adventurer's Pack" data-action="decrease" data-wayfinder-focus-id="starting-equipment-line:line-1:decrease">−</button>
              <button aria-label="Increase quantity of Adventurer's Pack" data-wayfinder-focus-id="starting-equipment-line:line-1:increase">+</button>
            </article>`;
          document.querySelector<HTMLElement>("[data-cart-status]")!.textContent =
            "Cart: 1 lines, 1 gp spent, 9 gp remaining.";
          window.restoreEquipmentFocus(document, ["starting-equipment-line:line-1"]);
          document.querySelector<HTMLButtonElement>("[data-action='decrease']")!.addEventListener("click", () => {
            cart.replaceChildren();
            window.restoreEquipmentFocus(document, ["starting-equipment-line:line-1", "starting-equipment-review"]);
          });
        });
      });

      await page.keyboard.press("Tab");
      await expectFocused(page, "Search equipment");
      for (const expected of [
        "Clear filters",
        "Common",
        "Preview Adventurer's Pack",
        "Buy Adventurer's Pack with coin",
      ]) {
        await page.keyboard.press("Tab");
        await expectFocused(page, expected);
      }

      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-wayfinder-focus-id"))).toBe(
        "starting-equipment-line:line-1"
      );
      expect(await page.locator("[data-cart-status]").textContent()).toBe("Cart: 1 lines, 1 gp spent, 9 gp remaining.");

      await page.keyboard.press("Tab");
      await expectFocused(page, "Decrease quantity of Adventurer's Pack");
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-wayfinder-focus-id"))).toBe(
        "starting-equipment-review"
      );

      const failure = page.locator("[data-failure-status]");
      await expect(failure.getAttribute("role")).resolves.toBe("alert");
      await expect(failure.getAttribute("aria-live")).resolves.toBe("assertive");
      await expect(failure.getAttribute("aria-atomic")).resolves.toBe("true");
      await expect(failure.getAttribute("tabindex")).resolves.toBe("-1");

      await page.evaluate(() => {
        document.body.innerHTML = `
          <main class="starting-equipment-pane" data-setup>
            <button data-action="start" data-wayfinder-focus-id="starting-equipment-start">Start Shopping</button>
          </main>`;
        const setup = document.querySelector<HTMLElement>("[data-setup]")!;
        document.querySelector<HTMLButtonElement>("[data-action='start']")!.addEventListener("click", () => {
          renderAuthority(setup);
          window.restoreEquipmentFocus(document, [
            "starting-equipment-start",
            "starting-equipment-authority",
            "starting-equipment-clear-filters",
          ]);
        });

        function renderAuthority(root: HTMLElement): void {
          root.innerHTML = `
            <section tabindex="-1" data-wayfinder-focus-id="starting-equipment-authority">
              <button data-action="recipe" data-wayfinder-focus-id="starting-equipment-recipe:lump-sum">Lump sum</button>
              <button data-action="request" data-wayfinder-focus-id="starting-equipment-request:new-campaign">Request start</button>
            </section>`;
          root.querySelector<HTMLButtonElement>("[data-action='recipe']")!.addEventListener("click", () => {
            renderAuthority(root);
            window.restoreEquipmentFocus(document, [
              "starting-equipment-recipe:lump-sum",
              "starting-equipment-authority",
            ]);
          });
          root.querySelector<HTMLButtonElement>("[data-action='request']")!.addEventListener("click", () => {
            root.innerHTML = `
              <section tabindex="-1" data-wayfinder-focus-id="starting-equipment-authority">
                <p>Request pending</p>
              </section>`;
            window.restoreEquipmentFocus(document, [
              "starting-equipment-request:new-campaign",
              "starting-equipment-authority",
            ]);
          });
        }
      });

      await page.locator("[data-action='start']").focus();
      await page.keyboard.press("Enter");
      await expectFocusId(page, "starting-equipment-authority");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expectFocusId(page, "starting-equipment-recipe:lump-sum");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expectFocusId(page, "starting-equipment-authority");
    } finally {
      await browser.close();
    }
  },
  20_000
);

async function expectFocused(page: Page, accessibleName: string): Promise<void> {
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent)
  ).toBe(accessibleName);
}

async function expectFocusId(page: Page, focusId: string): Promise<void> {
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-wayfinder-focus-id"))).toBe(focusId);
}

const keyboardFixture = `
  <main class="starting-equipment-pane">
    <label>Search <input aria-label="Search equipment" /></label>
    <button aria-label="Clear filters">Clear filters</button>
    <div role="group" aria-label="Equipment filters" aria-controls="results">
      <button aria-label="Common" aria-pressed="false">Common</button>
    </div>
    <p role="status" aria-live="polite" aria-atomic="true">Showing 1 of 1 matching items</p>
    <div id="results">
      <button aria-label="Preview Adventurer's Pack">Adventurer's Pack</button>
      <button aria-label="Buy Adventurer's Pack with coin" data-action="buy" data-wayfinder-focus-id="starting-equipment-item:item:coin">Buy with coin</button>
    </div>
    <section data-cart>
      <p data-cart-status role="status" aria-live="polite" aria-atomic="true">Cart: 0 lines, 0 gp spent, 10 gp remaining.</p>
    </section>
    <footer tabindex="-1" data-wayfinder-focus-id="starting-equipment-review">Review purchases</footer>
    <div data-failure-status role="alert" aria-live="assertive" aria-atomic="true" tabindex="-1" data-wayfinder-focus-id="starting-equipment-status">Typed localized failure detail</div>
  </main>`;

declare global {
  interface Window {
    restoreEquipmentFocus(root: ParentNode, candidateIds: readonly string[]): HTMLElement | null;
  }
}
