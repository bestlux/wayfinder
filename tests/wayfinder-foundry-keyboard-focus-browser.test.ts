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
const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
const keyboardFocusScript = readFileSync(
  resolve("scripts/wayfinder/application/foundry-keyboard-focus-service.js"),
  "utf8"
)
  .replaceAll("export ", "")
  .concat(`
    window.markWayfinderKeyboardFocus = markWayfinderKeyboardFocus;
    window.withWayfinderApplyConfirmationFocus = withWayfinderApplyConfirmationFocus;
  `);

it("wires the DialogV2 focus hook only around Wayfinder Apply confirmation", () => {
  const applyStart = appShell.indexOf("async function confirmWayfinderApply");
  const applyEnd = appShell.indexOf("interface SpellRarityAttestationInput", applyStart);
  const clearStart = appShell.indexOf("async function confirmWayfinderClear");
  const clearEnd = appShell.indexOf("function fallbackEscapeHtml", clearStart);
  const applyConfirmation = appShell.slice(applyStart, applyEnd);
  const clearConfirmation = appShell.slice(clearStart, clearEnd);
  expect(applyConfirmation).toContain("withWayfinderApplyConfirmationFocus(Hooks, focusMarker");
  expect(applyConfirmation).toContain('data-wayfinder-apply-confirmation="${focusMarker}"');
  expect(applyConfirmation).toContain('no: { label: "wayfinder-pf2e.App.ApplyConfirmNo"');
  expect(applyConfirmation).toContain("default: true");
  expect(clearConfirmation).not.toContain("withWayfinderApplyConfirmationFocus");
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

browserIt(
  "scopes native Tab restoration and safe default focus to Wayfinder's Apply DialogV2",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(dialogFixture);
      await page.addScriptTag({ content: foundryKeyboardInterception });
      await page.addScriptTag({ content: keyboardFocusScript });
      await page.addScriptTag({ content: `window.createDialogHooks = ${createDialogHooks.toString()};` });

      await page.evaluate(() => {
        window.dialogHooks = window.createDialogHooks();
        window.dialogResult = window.withWayfinderApplyConfirmationFocus(
          window.dialogHooks,
          "active-apply",
          () =>
            new Promise<boolean>((resolve) => {
              window.resolveDialog = resolve;
            })
        );
      });
      await page.evaluate(() => window.dialogHooks.emit(document.querySelector("#unrelated")!));
      expect(await page.locator("#unrelated-save").getAttribute("data-keyboard-focus")).toBeNull();
      expect(await page.evaluate(() => window.dialogHooks.offCount)).toBe(0);
      await page.evaluate(() => window.dialogHooks.emit(document.querySelector("#stale-apply-dialog")!));
      expect(await page.locator("#stale-apply-no").getAttribute("data-keyboard-focus")).toBeNull();
      expect(await page.evaluate(() => window.dialogHooks.offCount)).toBe(0);

      await page.evaluate(() => {
        const safeDefault = document.querySelector<HTMLButtonElement>("#apply-no")!;
        safeDefault.focus = () => undefined;
        window.dialogHooks.emit(document.querySelector("#apply-dialog")!);
      });
      expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("apply-no");
      expect(await page.evaluate(() => window.dialogHooks.offCount)).toBe(0);

      await page.evaluate(() => {
        const safeDefault = document.querySelector<HTMLButtonElement>("#apply-no")!;
        safeDefault.focus = () => {
          throw new Error("detached control");
        };
        window.dialogHooks.emit(document.querySelector("#apply-dialog")!);
      });
      expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("apply-no");
      expect(await page.evaluate(() => window.dialogHooks.offCount)).toBe(0);

      await page.evaluate(() => {
        document.querySelector<HTMLButtonElement>("#apply-no")!.focus = HTMLElement.prototype.focus;
      });
      await page.evaluate(() => window.dialogHooks.emit(document.querySelector("#apply-dialog")!));
      expect(await page.locator("#apply-no").getAttribute("data-keyboard-focus")).toBe("true");
      expect(await page.locator("#apply-yes").getAttribute("data-keyboard-focus")).toBe("true");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("apply-no");
      expect(await page.evaluate(() => window.dialogHooks.offCount)).toBe(1);

      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("apply-yes");
      expect(await page.evaluate(() => window.cycleViewCount)).toBe(0);
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => window.applyCount)).toBe(1);
      await page.evaluate(() => window.resolveDialog(true));
      expect(await page.evaluate(() => window.dialogResult)).toBe(true);
      expect(await page.evaluate(() => window.dialogHooks.offCount)).toBe(1);

      const cleanup = await page.evaluate(async () => {
        const successHooks = window.createDialogHooks();
        const success = await window.withWayfinderApplyConfirmationFocus(successHooks, "success", async () => "closed");
        const errorHooks = window.createDialogHooks();
        const error = await window
          .withWayfinderApplyConfirmationFocus(errorHooks, "error", async () => {
            throw new Error("render failed");
          })
          .catch((caught: Error) => caught.message);
        return {
          success,
          successOffCount: successHooks.offCount,
          error,
          errorOffCount: errorHooks.offCount,
        };
      });
      expect(cleanup).toEqual({
        success: "closed",
        successOffCount: 1,
        error: "render failed",
        errorOffCount: 1,
      });
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

const dialogFixture = `
  <section id="unrelated" class="application dialog-v2">
    <button id="unrelated-save" type="button">Save</button>
  </section>
  <section id="stale-apply-dialog" class="application dialog-v2">
    <div data-wayfinder-apply-confirmation="stale-apply"></div>
    <button id="stale-apply-no" type="button" data-action="no">Cancel stale Apply</button>
  </section>
  <section id="apply-dialog" class="application dialog-v2" role="dialog" aria-modal="true">
    <div data-wayfinder-apply-confirmation="active-apply"><p>Apply these choices?</p></div>
    <footer>
      <button id="apply-no" type="button" data-action="no">Cancel</button>
      <button id="apply-yes" type="button" data-action="yes">Apply</button>
    </footer>
  </section>`;

// Mirrors Foundry 14.366 KeyboardManager.hasFocus and the consumed core cycleView Tab binding.
const foundryKeyboardInterception = `
  window.cycleViewCount = 0;
  window.modalSubmitCount = 0;
  window.applyCount = 0;
  document.querySelector("#modal-save")?.addEventListener("click", () => window.modalSubmitCount += 1);
  document.querySelector("#apply-yes")?.addEventListener("click", () => window.applyCount += 1);
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
    createDialogHooks: typeof createDialogHooks;
    cycleViewCount: number;
    dialogHooks: ReturnType<typeof createDialogHooks>;
    dialogResult: Promise<boolean>;
    modalSubmitCount: number;
    markWayfinderKeyboardFocus(root: ParentNode): number;
    resolveDialog(value: boolean): void;
    withWayfinderApplyConfirmationFocus<T>(
      hooks: ReturnType<typeof createDialogHooks>,
      marker: string,
      openDialog: () => Promise<T>
    ): Promise<T>;
  }
}

function createDialogHooks() {
  let nextId = 1;
  const callbacks = new Map<number, (application: unknown, html: unknown) => void>();
  return {
    offCount: 0,
    on(_event: "renderDialogV2", callback: (application: unknown, html: unknown) => void) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    off(_event: "renderDialogV2", hookId: number) {
      this.offCount += 1;
      callbacks.delete(hookId);
    },
    emit(html: unknown) {
      for (const callback of [...callbacks.values()]) callback({}, html);
    },
  };
}
