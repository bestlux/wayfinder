import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { expect, it } from "vitest";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

const browserIt = chromePath ? it : it.skip;
const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
const keyboardFocusScript = readFileSync(
  resolve("scripts/wayfinder/application/foundry-keyboard-focus-service.js"),
  "utf8"
)
  .replaceAll("export ", "")
  .concat(`
    window.markWayfinderKeyboardFocus = markWayfinderKeyboardFocus;
    window.createWayfinderApplyConfirmationFocusHandoff = createWayfinderApplyConfirmationFocusHandoff;
  `);

it("wires the DialogV2 post-render handoff only around Wayfinder Apply confirmation", () => {
  const applyStart = appShell.indexOf("async function confirmWayfinderApply");
  const applyEnd = appShell.indexOf("interface SpellRarityAttestationInput", applyStart);
  const clearStart = appShell.indexOf("async function confirmWayfinderClear");
  const clearEnd = appShell.indexOf("function fallbackEscapeHtml", clearStart);
  const applyConfirmation = appShell.slice(applyStart, applyEnd);
  const clearConfirmation = appShell.slice(clearStart, clearEnd);
  expect(applyConfirmation).toContain("createWayfinderApplyConfirmationFocusHandoff()");
  expect(applyConfirmation).toContain('data-wayfinder-apply-confirmation="${focusHandoff.marker}"');
  expect(applyConfirmation).toContain("render: (_event, renderedDialog) => focusHandoff.onRender(renderedDialog)");
  expect(applyConfirmation).toContain("finally");
  expect(applyConfirmation).toContain("focusHandoff.cancel()");
  expect(applyConfirmation).toContain("await focusHandoff.waitForClose()");
  expect(applyConfirmation.indexOf("await dialog.confirm")).toBeLessThan(
    applyConfirmation.indexOf("await focusHandoff.waitForClose()")
  );
  expect(applyConfirmation.indexOf("await focusHandoff.waitForClose()")).toBeLessThan(
    applyConfirmation.indexOf("return result === true")
  );
  expect(applyConfirmation).toContain('no: { label: "wayfinder-pf2e.App.ApplyConfirmNo"');
  expect(applyConfirmation).toContain("default: true");
  expect(clearConfirmation).not.toContain("createWayfinderApplyConfirmationFocusHandoff");
  expect(clearConfirmation).not.toContain("data-wayfinder-apply-confirmation");
});

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
        6
      );
      await page.locator("#heading").focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("previous");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("start");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("policy-details");
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

browserIt(
  "hands off safe DialogV2 focus after Foundry's late bringToFront window focus",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(dialogFixture);
      await page.addScriptTag({ content: foundryKeyboardInterception });
      await page.addScriptTag({ content: keyboardFocusScript });

      const marker = await page.evaluate(() => {
        document.body.tabIndex = -1;
        window.focusHandoff = window.createWayfinderApplyConfirmationFocusHandoff();
        document
          .querySelector("#active-apply-marker")!
          .setAttribute("data-wayfinder-apply-confirmation", window.focusHandoff.marker);
        return window.focusHandoff.marker;
      });
      expect(marker).toMatch(/^wayfinder-apply-\d+$/u);
      await page.evaluate(() => window.focusHandoff.onRender({ element: document.querySelector("#unrelated") }));
      expect(await page.locator("#unrelated-save").getAttribute("data-keyboard-focus")).toBeNull();
      await page.evaluate(() =>
        window.focusHandoff.onRender({ element: document.querySelector("#stale-apply-dialog") })
      );
      expect(await page.locator("#stale-apply-no").getAttribute("data-keyboard-focus")).toBeNull();

      await page.evaluate(() => {
        const dialog = document.querySelector<HTMLDialogElement>("#apply-dialog")!;
        if (!dialog.open) dialog.showModal();
        const safeDefault = document.querySelector<HTMLButtonElement>("#apply-no")!;
        window.focusAttempts = 0;
        safeDefault.focus = function focusAfterNoOp(options?: FocusOptions) {
          window.focusAttempts += 1;
          if (window.focusAttempts === 1) return;
          HTMLElement.prototype.focus.call(this, options);
        };
        window.focusHandoff.onRender({ element: document.querySelector("#apply-dialog") });
        queueMicrotask(() => (document.activeElement as HTMLElement | null)?.blur());
      });
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
      await waitForAnimationFrames(page, 3);
      expect(await page.evaluate(() => window.focusAttempts)).toBe(2);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("apply-no");
      expect(await page.locator("#apply-no").getAttribute("data-keyboard-focus")).toBe("true");
      expect(await page.locator("#apply-yes").getAttribute("data-keyboard-focus")).toBe("true");
      await page.evaluate(() => window.focusHandoff.cancel());

      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.focusHandoff = window.createWayfinderApplyConfirmationFocusHandoff();
        document
          .querySelector("#active-apply-marker")!
          .setAttribute("data-wayfinder-apply-confirmation", window.focusHandoff.marker);
        const safeDefault = document.querySelector<HTMLButtonElement>("#apply-no")!;
        window.focusAttempts = 0;
        safeDefault.focus = function focusAfterThrow(options?: FocusOptions) {
          window.focusAttempts += 1;
          if (window.focusAttempts === 1) throw new Error("replaced control");
          HTMLElement.prototype.focus.call(this, options);
        };
        window.focusHandoff.onRender({ element: document.querySelector("#apply-dialog") });
        queueMicrotask(() => (document.activeElement as HTMLElement | null)?.blur());
      });
      await waitForAnimationFrames(page, 3);
      expect(await page.evaluate(() => window.focusAttempts)).toBe(2);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("apply-no");

      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("apply-yes");
      expect(await page.evaluate(() => window.cycleViewCount)).toBe(0);
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => window.applyCount)).toBe(1);

      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.focusHandoff = window.createWayfinderApplyConfirmationFocusHandoff();
        document
          .querySelector("#active-apply-marker")!
          .setAttribute("data-wayfinder-apply-confirmation", window.focusHandoff.marker);
        document.querySelector<HTMLButtonElement>("#apply-no")!.focus = HTMLElement.prototype.focus;
        window.focusHandoff.onRender({ element: document.querySelector("#apply-dialog") });
        window.focusHandoff.cancel();
        window.focusHandoff.cancel();
      });
      await waitForAnimationFrames(page, 2);
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
    } finally {
      await browser.close();
    }
  },
  20_000
);

browserIt("waits for the exact Apply dialog close before failure focus can begin", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <dialog id="apply-close-race">
        <div data-wayfinder-apply-confirmation="placeholder"></div>
        <button type="button" data-action="yes">Apply</button>
        <button type="button" data-action="no">Cancel</button>
      </dialog>
      <div id="failure-alert" role="alert" tabindex="-1">Apply failed</div>`);
    await page.addScriptTag({ content: keyboardFocusScript });

    const evidence = await page.evaluate(async () => {
      document.body.tabIndex = -1;
      const dialogElement = document.querySelector<HTMLDialogElement>("#apply-close-race")!;
      const application = Object.assign(new EventTarget(), { element: dialogElement });
      const handoff = window.createWayfinderApplyConfirmationFocusHandoff();
      dialogElement
        .querySelector("[data-wayfinder-apply-confirmation]")!
        .setAttribute("data-wayfinder-apply-confirmation", handoff.marker);
      handoff.onRender(application);

      let applyStarted = false;
      const startApply = handoff.waitForClose().then(() => {
        applyStarted = true;
        document.querySelector<HTMLElement>("#failure-alert")!.focus();
      });
      await Promise.resolve();
      const startedBeforeClose = applyStarted;

      document.body.focus();
      application.dispatchEvent(new Event("close"));
      await startApply;
      const focusedAfterClose = document.activeElement?.id;
      handoff.cancel();
      return { focusedAfterClose, startedBeforeClose };
    });
    expect(evidence).toEqual({ focusedAfterClose: "failure-alert", startedBeforeClose: false });
  } finally {
    await browser.close();
  }
});

const fixture = `
  <section class="application user-config" aria-label="User Configuration">
    <form><button id="modal-save" type="button">Save</button></form>
  </section>
  <main id="wayfinder">
    <h3 id="heading" tabindex="-1">Starting equipment</h3>
    <button id="previous" type="button">Previous step</button>
    <button id="next" type="button" disabled>Next step</button>
    <button id="start" type="button">Start Shopping</button>
    <details><summary id="policy-details">How this works</summary><p>Policy details.</p></details>
    <input id="search" aria-label="Search equipment" />
  </main>`;

const dialogFixture = `
  <section id="unrelated" class="application dialog-v2">
    <button id="unrelated-save" type="button">Save</button>
  </section>
  <section id="stale-apply-dialog" class="application dialog-v2">
    <div data-wayfinder-apply-confirmation="stale-apply"></div>
    <button id="stale-apply-no" type="button" data-action="no">Cancel stale Apply</button>
  </section>
  <dialog id="apply-dialog" class="application dialog-v2">
    <header><button id="apply-close" type="button" aria-label="Close Window">Close</button></header>
    <form class="dialog-form standard-form">
      <div id="active-apply-marker"><p>Apply these choices?</p></div>
      <footer class="form-footer">
        <button id="apply-yes" type="submit" data-action="yes">Apply</button>
        <button id="apply-no" type="button" data-action="no" autofocus>Cancel</button>
      </footer>
    </form>
  </dialog>`;

// Mirrors Foundry 14.366 KeyboardManager.hasFocus and the consumed core cycleView Tab binding.
const foundryKeyboardInterception = `
  window.cycleViewCount = 0;
  window.modalSubmitCount = 0;
  window.applyCount = 0;
  document.querySelector("#modal-save")?.addEventListener("click", () => window.modalSubmitCount += 1);
  document.querySelector("#apply-yes")?.addEventListener("click", () => window.applyCount += 1);
  document.querySelector("#apply-dialog form")?.addEventListener("submit", event => event.preventDefault());
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
    applyCount: number;
    createWayfinderApplyConfirmationFocusHandoff(): {
      readonly marker: string;
      cancel(): void;
      onRender(application: unknown): void;
      waitForClose(): Promise<void>;
    };
    cycleViewCount: number;
    focusAttempts: number;
    focusHandoff: ReturnType<Window["createWayfinderApplyConfirmationFocusHandoff"]>;
    modalSubmitCount: number;
    markWayfinderKeyboardFocus(root: ParentNode): number;
  }
}

async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    }
  }, count);
}
