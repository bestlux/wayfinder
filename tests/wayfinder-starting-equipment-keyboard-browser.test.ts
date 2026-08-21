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
  .concat(
    "\nwindow.restoreEquipmentFocus = restoreEquipmentFocus;",
    "\nwindow.startingEquipmentFocusCandidates = startingEquipmentFocusCandidates;"
  );
const experienceBrowserScript = readFileSync(resolve("tools/foundry-smoke/wf43-experience-browser-suite.js"), "utf8");

browserIt(
  "supports a keyboard-only acquisition path with named controls, announcements, and deterministic relocation",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(keyboardFixture);
      await page.addScriptTag({ content: accessibilityScript });
      await page.addScriptTag({ content: experienceBrowserScript });
      const traversalDiagnostic = await page.evaluate(() =>
        globalThis.__inspectWayfinderWf43TabTraversal({
          key: "Tab",
          limit: 180,
          observedTraversal: [{ focusId: "starting-equipment-line:line-1", name: "Adventurer's Pack" }],
          observedTraversalCount: 180,
          scopeSelector: ".starting-equipment-pane",
          targetSelector: "[data-action='preview']",
        })
      );
      expect(traversalDiagnostic).toMatchObject({
        active: { tag: "BODY" },
        key: "Tab",
        limit: 180,
        localOrderIndex: 3,
        localTabOrderCount: 4,
        localTabOrderTruncated: false,
        observedTraversalCount: 180,
        observedTraversalTruncated: true,
        target: { present: true, visible: true, disabled: false, tabIndex: 0 },
      });
      await page.evaluate(() => {
        const preview = document.querySelector<HTMLButtonElement>("[data-action='preview']")!;
        preview.addEventListener("click", () => {
          const detail = document.querySelector<HTMLElement>("[data-detail]")!;
          detail.innerHTML = `<button aria-label="Buy Adventurer's Pack with coin" data-action="buy" data-wayfinder-focus-id="starting-equipment-item:item:coin">Buy with coin</button>`;
          detail.querySelector<HTMLButtonElement>("[data-action='buy']")!.addEventListener("click", () => {
            detail.replaceChildren();
            const cart = document.querySelector<HTMLElement>("[data-cart]")!;
            renderCart(1);
            window.restoreEquipmentFocus(document, ["starting-equipment-line:line-1"]);

            function renderCart(quantity: number): void {
              cart.innerHTML = `
                <p data-cart-status role="status" aria-live="polite" aria-atomic="true">Cart quantity ${quantity}</p>
                <article tabindex="-1" data-wayfinder-focus-id="starting-equipment-line:line-1">
                  <strong>Adventurer's Pack</strong>
                  <button aria-label="Decrease quantity of Adventurer's Pack" data-action="decrease" data-wayfinder-focus-id="starting-equipment-line:line-1:decrease">−</button>
                  <strong data-quantity>${quantity}</strong>
                  <button aria-label="Increase quantity of Adventurer's Pack" data-action="increase" data-wayfinder-focus-id="starting-equipment-line:line-1:increase">+</button>
                </article>`;
              cart.querySelector<HTMLButtonElement>("[data-action='increase']")!.addEventListener("click", () => {
                renderCart(quantity + 1);
                window.restoreEquipmentFocus(document, ["starting-equipment-line:line-1:increase"]);
              });
              cart.querySelector<HTMLButtonElement>("[data-action='decrease']")!.addEventListener("click", () => {
                if (quantity === 1) {
                  cart.replaceChildren();
                  window.restoreEquipmentFocus(document, [
                    "starting-equipment-line:line-1",
                    "starting-equipment-review",
                  ]);
                  return;
                }
                renderCart(quantity - 1);
                window.restoreEquipmentFocus(document, ["starting-equipment-line:line-1:decrease"]);
              });
            }
          });
        });
      });

      await page.keyboard.press("Tab");
      await expectFocused(page, "Search equipment");
      for (const expected of ["Clear filters", "Common", "Preview Adventurer's Pack"]) {
        await page.keyboard.press("Tab");
        await expectFocused(page, expected);
      }

      await page.keyboard.press("Enter");
      await expectFocused(page, "Preview Adventurer's Pack");
      await page.keyboard.press("Tab");
      await expectFocused(page, "Buy Adventurer's Pack with coin");
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-wayfinder-focus-id"))).toBe(
        "starting-equipment-line:line-1"
      );
      expect(await page.locator("[data-cart-status]").textContent()).toBe("Cart quantity 1");

      await page.keyboard.press("Tab");
      await expectFocused(page, "Decrease quantity of Adventurer's Pack");
      await page.keyboard.press("Tab");
      await expectFocused(page, "Increase quantity of Adventurer's Pack");
      await page.keyboard.press("Enter");
      await expectFocused(page, "Increase quantity of Adventurer's Pack");
      await expect(page.locator("[data-quantity]").textContent()).resolves.toBe("2");
      await page.keyboard.press("Shift+Tab");
      await expectFocused(page, "Decrease quantity of Adventurer's Pack");
      await page.keyboard.press("Enter");
      await expectFocused(page, "Decrease quantity of Adventurer's Pack");
      await expect(page.locator("[data-quantity]").textContent()).resolves.toBe("1");
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

      await page.evaluate(() => {
        document.body.innerHTML = `
          <main class="starting-equipment-pane" data-policy>
            <button data-wayfinder-action="activate-equipment-policy" data-wayfinder-focus-id="starting-equipment-activate:replacement-character">Activate replacement policy</button>
          </main>`;
        const policy = document.querySelector<HTMLElement>("[data-policy]")!;
        const activate = policy.querySelector<HTMLButtonElement>(
          "[data-wayfinder-action='activate-equipment-policy']"
        )!;
        activate.addEventListener("click", () => {
          const candidates = window.startingEquipmentFocusCandidates(activate)!;
          policy.innerHTML = `
            <input aria-label="Search equipment" data-wayfinder-focus-id="starting-equipment-search">
            <button data-wayfinder-focus-id="starting-equipment-clear-filters">Clear filters</button>`;
          window.restoreEquipmentFocus(document, candidates);
        });
      });
      await page.locator("[data-wayfinder-action='activate-equipment-policy']").focus();
      await page.keyboard.press("Enter");
      await expectFocusId(page, "starting-equipment-search");
      await page.keyboard.press("Tab");
      await expectFocusId(page, "starting-equipment-clear-filters");

      await page.evaluate(() => {
        const policy = document.querySelector<HTMLElement>("[data-policy]")!;
        policy.innerHTML = `
          <section tabindex="-1" data-wayfinder-focus-id="starting-equipment-authority">
            <button data-wayfinder-action="approve-equipment-policy-request" data-wayfinder-focus-id="starting-equipment-approve-request:request-1">Approve request</button>
          </section>`;
        const approve = policy.querySelector<HTMLButtonElement>(
          "[data-wayfinder-action='approve-equipment-policy-request']"
        )!;
        approve.addEventListener("click", () => {
          const candidates = window.startingEquipmentFocusCandidates(approve)!;
          policy.innerHTML = `
            <input aria-label="Search equipment" data-wayfinder-focus-id="starting-equipment-search">
            <button data-wayfinder-focus-id="starting-equipment-clear-filters">Clear filters</button>`;
          window.restoreEquipmentFocus(document, candidates);
        });
      });
      await page.locator("[data-wayfinder-action='approve-equipment-policy-request']").focus();
      await page.keyboard.press("Enter");
      await expectFocusId(page, "starting-equipment-search");
      await page.keyboard.press("Tab");
      await expectFocusId(page, "starting-equipment-clear-filters");

      await page.evaluate(() => {
        const policy = document.querySelector<HTMLElement>("[data-policy]")!;
        policy.innerHTML = `
          <input data-wayfinder-focus-id="starting-equipment-search">
          <button data-wayfinder-action="revoke-equipment-policy-judgment" data-wayfinder-focus-id="starting-equipment-revoke-approval">Revoke approval</button>
          <button data-wayfinder-focus-id="starting-equipment-clear-filters">Clear filters</button>`;
        const revoke = policy.querySelector<HTMLButtonElement>(
          "[data-wayfinder-action='revoke-equipment-policy-judgment']"
        )!;
        revoke.addEventListener("click", () => {
          const candidates = window.startingEquipmentFocusCandidates(revoke)!;
          policy.innerHTML = `
            <section tabindex="-1" data-wayfinder-focus-id="starting-equipment-authority">Authority required</section>`;
          window.restoreEquipmentFocus(document, candidates);
        });
      });
      await page.locator("[data-wayfinder-action='revoke-equipment-policy-judgment']").focus();
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
      <button aria-label="Preview Adventurer's Pack" data-action="preview">Adventurer's Pack</button>
    </div>
    <aside data-detail></aside>
    <section data-cart>
      <p data-cart-status role="status" aria-live="polite" aria-atomic="true">Cart: 0 lines, 0 gp spent, 10 gp remaining.</p>
    </section>
    <footer tabindex="-1" data-wayfinder-focus-id="starting-equipment-review">Review purchases</footer>
    <div data-failure-status role="alert" aria-live="assertive" aria-atomic="true" tabindex="-1" data-wayfinder-focus-id="starting-equipment-status">Typed localized failure detail</div>
  </main>`;

declare global {
  interface Window {
    restoreEquipmentFocus(root: ParentNode, candidateIds: readonly string[]): HTMLElement | null;
    startingEquipmentFocusCandidates(target: HTMLElement | null): string[] | null;
    __inspectWayfinderWf43TabTraversal(payload: {
      key: string;
      limit: number;
      observedTraversal: Array<{ focusId: string; name: string }>;
      observedTraversalCount: number;
      scopeSelector: string;
      targetSelector: string;
    }): Record<string, unknown>;
  }
}
