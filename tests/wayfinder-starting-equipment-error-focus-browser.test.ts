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
const focusServiceScript = readFileSync(
  resolve("scripts/wayfinder/application/starting-equipment-error-focus-service.js"),
  "utf8"
)
  .replace(/^import .*;$/gmu, "")
  .replaceAll("export ", "")
  .replace(
    "class StartingEquipmentErrorFocusCoordinator",
    'const STARTING_EQUIPMENT_STATUS_FOCUS_ID = "starting-equipment-status";\nclass StartingEquipmentErrorFocusCoordinator'
  )
  .concat("\nwindow.StartingEquipmentErrorFocusCoordinator = StartingEquipmentErrorFocusCoordinator;");

browserIt(
  "refocuses the same error after full and status-part replacement without stealing connected focus",
  async () => {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(fixture("Apply failed"));
      await page.addScriptTag({ content: focusServiceScript });

      const first = await page.evaluate(() => {
        window.errorFocus = new window.StartingEquipmentErrorFocusCoordinator();
        const root = document.querySelector<HTMLElement>("[data-root]")!;
        const alert = window.errorFocus.restore(root, { errorMessage: "Apply failed", pending: true });
        return { focused: document.activeElement === alert, tag: document.activeElement?.tagName };
      });
      expect(first).toEqual({ focused: true, tag: "DIV" });

      const fullReplacement = await page.evaluate(() => {
        const oldAlert = document.activeElement;
        const root = document.querySelector<HTMLElement>("[data-root]")!;
        root.innerHTML = window.errorFixture("Apply failed");
        const focusBeforeRestore = document.activeElement?.tagName;
        const alert = window.errorFocus.restore(root, { errorMessage: "Apply failed", pending: false });
        return {
          focusBeforeRestore,
          focused: document.activeElement === alert,
          oldAlertConnected: oldAlert?.isConnected,
        };
      });
      expect(fullReplacement).toEqual({ focusBeforeRestore: "BODY", focused: true, oldAlertConnected: false });

      const partialReplacement = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("[data-root]")!;
        const deliberateTarget = root.querySelector<HTMLButtonElement>("[data-other]")!;
        deliberateTarget.focus();
        root.querySelector<HTMLElement>("[data-status]")!.outerHTML = window.errorStatus("Apply failed");
        const restored = window.errorFocus.restore(root, { errorMessage: "Apply failed", pending: false });
        return {
          restored: restored !== null,
          retainedDeliberateFocus: document.activeElement === deliberateTarget,
        };
      });
      expect(partialReplacement).toEqual({ restored: false, retainedDeliberateFocus: true });
    } finally {
      await browser.close();
    }
  }
);

browserIt("clears durable error focus state and still honors a newly pending error", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture("Apply failed"));
    await page.addScriptTag({ content: focusServiceScript });

    const result = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-root]")!;
      const coordinator = new window.StartingEquipmentErrorFocusCoordinator();
      coordinator.restore(root, { errorMessage: "Apply failed", pending: true });
      coordinator.restore(root, { errorMessage: null, pending: false });
      root.innerHTML = window.errorFixture("Apply failed");
      const afterClear = coordinator.restore(root, { errorMessage: "Apply failed", pending: false });
      const activeAfterClear = document.activeElement?.tagName;
      const newlyPending = coordinator.restore(root, { errorMessage: "Different failure", pending: true });
      return {
        activeAfterClear,
        focusedAfterClear: afterClear !== null,
        focusedNewPending: document.activeElement === newlyPending,
      };
    });
    expect(result).toEqual({ activeAfterClear: "BODY", focusedAfterClear: false, focusedNewPending: true });
  } finally {
    await browser.close();
  }
});

function fixture(message: string): string {
  return `<main data-root>${errorFixture(message)}</main><script>
    window.errorStatus = ${errorStatus.toString()};
    window.errorFixture = ${errorFixture.toString()};
  </script>`;
}

function errorFixture(message: string): string {
  return `${errorStatus(message)}<button type="button" data-other>Continue elsewhere</button>`;
}

function errorStatus(message: string): string {
  return `<div data-status role="alert" tabindex="-1" data-wayfinder-focus-id="starting-equipment-status">${message}</div>`;
}

declare global {
  interface Window {
    StartingEquipmentErrorFocusCoordinator: new () => {
      restore(
        root: HTMLElement,
        options: { readonly errorMessage: string | null; readonly pending: boolean }
      ): HTMLElement | null;
    };
    errorFocus: InstanceType<Window["StartingEquipmentErrorFocusCoordinator"]>;
    errorFixture(message: string): string;
    errorStatus(message: string): string;
  }
}
