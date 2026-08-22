import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { parseMaterializedEquipmentQuantity } from "../src/wayfinder/application/equipment-quantity-entry";

const chromePath = [
  process.env.FOUNDRY_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((entry): entry is string => Boolean(entry && existsSync(entry)));

describe("equipment quantity entry", () => {
  it("converts the displayed materialized stack into one absolute requested quantity", () => {
    expect(parseMaterializedEquipmentQuantity("36", 12)).toEqual({ ok: true, requestedQuantity: 3 });
    expect(parseMaterializedEquipmentQuantity("40", 1)).toEqual({ ok: true, requestedQuantity: 40 });
  });

  it("rejects blank, fractional, unsafe, and non-materializable quantities", () => {
    expect(parseMaterializedEquipmentQuantity("", 1)).toMatchObject({ ok: false, reason: "invalid-integer" });
    expect(parseMaterializedEquipmentQuantity("1.5", 1)).toMatchObject({
      ok: false,
      reason: "invalid-integer",
    });
    expect(parseMaterializedEquipmentQuantity(String(Number.MAX_SAFE_INTEGER + 1), 1)).toMatchObject({
      ok: false,
      reason: "invalid-integer",
    });
    expect(parseMaterializedEquipmentQuantity("13", 12)).toEqual({
      ok: false,
      reason: "invalid-stack-multiple",
      multiple: 12,
    });
  });
});

const browserIt = chromePath ? it : it.skip;

browserIt("deduplicates the native change followed by blur for one typed commit", async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section>
        <input type="number" value="12" data-wayfinder-equipment-quantity data-step-id="step-1" data-line-id="line-1" />
      </section>
    `);
    const actionsScript = readFileSync(resolve("scripts/wayfinder/actions.js"), "utf8")
      .replaceAll("export ", "")
      .concat("\nwindow.bindWayfinderInteractions = bindWayfinderInteractions;");
    await page.addScriptTag({ content: actionsScript });

    const observed = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("input")!;
      const commits: string[] = [];
      const noop = () => undefined;
      window.bindWayfinderInteractions(
        document.querySelector("section")!,
        {
          onActionClick: noop,
          onSearchInput: noop,
          onEquipmentSearchInput: noop,
          onEquipmentSourceSearchInput: noop,
          onEquipmentQuantityCommit: (event: Event) => {
            commits.push((event.currentTarget as HTMLInputElement).value);
          },
          onScrollableScroll: noop,
          onManualChange: noop,
          onLoreInputChange: noop,
        },
        new Map(),
        null
      );

      input.value = "36";
      input.dispatchEvent(new Event("change"));
      input.dispatchEvent(new FocusEvent("blur"));
      input.value = "48";
      input.dispatchEvent(new FocusEvent("blur"));
      return commits;
    });

    expect(observed).toEqual(["36", "48"]);
  } finally {
    await browser.close();
  }
});

declare global {
  interface Window {
    bindWayfinderInteractions(
      root: HTMLElement,
      handlers: Record<string, (event: Event) => void>,
      scrollById: Map<string, number>,
      pendingSearchFocus: null
    ): unknown;
  }
}
