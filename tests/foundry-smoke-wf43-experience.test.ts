import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createWf43ExperienceArtifactDirectory } from "../tools/foundry-smoke/wf43-experience-artifacts.mjs";
import {
  validateWf43ExperienceCaseDefinition,
  WF43_APP_WIDTHS,
  WF43_STATE_IDS,
  WF43_VIEWPORT,
  wf43ExperienceCases,
} from "../tools/foundry-smoke/wf43-experience-cases.mjs";
import { qualifyWf43ExperienceResult } from "../tools/foundry-smoke/wf43-experience-evidence.mjs";

const runner = readFileSync(resolve("tools/foundry-smoke/run-wf43-experience-smoke.mjs"), "utf8");
const browserSuite = readFileSync(resolve("tools/foundry-smoke/wf43-experience-browser-suite.js"), "utf8");
const frozenWave2 = readFileSync(resolve("tools/foundry-smoke/acquisition-cases.mjs"), "utf8");
const english = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8"));
const chinese = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"));

describe("WF-080-43 live experience qualifier", () => {
  it("freezes both locales, the 1440x1000 viewport, release widths, and all six states", () => {
    expect(wf43ExperienceCases.map((entry) => entry.id)).toEqual(["en", "cn"]);
    expect(WF43_VIEWPORT).toEqual({ width: 1440, height: 1000 });
    expect(WF43_APP_WIDTHS).toEqual([1240, 1180, 980, 760]);
    expect(WF43_STATE_IDS).toEqual(["policy", "browse-cart", "review", "handoff", "forced-failure", "receipt"]);
    expect(wf43ExperienceCases.every((entry) => validateWf43ExperienceCaseDefinition(entry).length === 0)).toBe(true);
  });

  it("keeps the owner path keyboard-only and the frozen Wave 2 tracer separate", () => {
    expect(runner).toContain("page.keyboard.press");
    expect(runner).toContain("keyboard.type");
    expect(runner).not.toContain(".click(");
    expect(runner).not.toContain("__runWayfinderAcquisitionTracer");
    expect(browserSuite).not.toContain("__runWayfinderAcquisitionTracer");
    expect(browserSuite).toContain("__prepareWayfinderWf43Handoff");
    expect(browserSuite).toContain("__inspectWayfinderWf43Focus");
    expect(frozenWave2).toContain("equipment-l1-owner-common-purchase-retry");
  });

  it("guards exact actor, policy, pack, and language restoration", () => {
    expect(browserSuite).toContain("smokeWf43Experience");
    expect(browserSuite).toContain('game.settings.get("core", "language")');
    expect(browserSuite).toContain("game.settings.set(moduleId, policySetting, snapshots.policy)");
    expect(browserSuite).toContain('game.settings.set("pf2e", packsSetting, snapshots.packs)');
    expect(browserSuite).toContain("actorCountRestored");
    expect(runner).toContain("setFoundryLanguage(gmPage");
    expect(runner).toContain("setup.snapshots.language");
  });

  it("binds Chinese key parity and exact live anchors instead of accepting English fallback", () => {
    expect(flattenKeys(chinese["wayfinder-pf2e"].StartingEquipment)).toEqual(
      flattenKeys(english["wayfinder-pf2e"].StartingEquipment)
    );
    expect(flattenKeys(chinese["wayfinder-pf2e"].AcquisitionReceipt)).toEqual(
      flattenKeys(english["wayfinder-pf2e"].AcquisitionReceipt)
    );
    const chineseCase = wf43ExperienceCases.find((entry) => entry.id === "cn")!;
    expect(Object.keys(chineseCase.stateAnchors)).toEqual(WF43_STATE_IDS);
    expect((Object.values(chineseCase.stateAnchors) as string[]).every((value) => /[\u3400-\u9fff]/u.test(value))).toBe(
      true
    );
  });

  it("accepts exact responsive, accessible, localized evidence", () => {
    expect(qualifyWf43ExperienceResult(passingResult())).toEqual({ ok: true, failures: [] });
  });

  it("rejects overflow, clipping, raw keys, generic names, stale announcements, and hidden focus", () => {
    const result = passingResult();
    result.locales[0].states[1].widths[3].stageOverflow = 2;
    result.locales[0].states[2].widths[2].clippedCriticalNodes.push("review");
    result.locales[1].states[4].rawLocalizationKeys.push("wayfinder-pf2e.StartingEquipment.Apply.Failed");
    result.locales[1].item.accessibleNames.increase = "Increase quantity";
    result.locales[0].liveRegionChanges.cart.after = result.locales[0].liveRegionChanges.cart.before;
    result.locales[1].keyboard.focus[0].visible = false;
    result.locales[1].failure.text = "Wayfinder could not apply this starting-equipment draft.";
    const failures = qualifyWf43ExperienceResult(result).failures;
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/stageOverflow/i),
        expect.stringMatching(/clipped/i),
        expect.stringMatching(/raw localization/i),
        expect.stringMatching(/item-specific accessible name/i),
        expect.stringMatching(/cart live region/i),
        expect.stringMatching(/visible focus/i),
        expect.stringMatching(/forced failure was not localized/i),
      ])
    );
  });

  it("rejects duplicate/reordered locale, state, width, and top-level width evidence", () => {
    const result = passingResult();
    result.appWidths = [...WF43_APP_WIDTHS].reverse();
    result.locales.push(structuredClone(result.locales[1]));
    result.locales[0].states.push(structuredClone(result.locales[0].states[5]));
    result.locales[2].states[0].widths.push(structuredClone(result.locales[2].states[0].widths[3]));
    const failures = qualifyWf43ExperienceResult(result).failures;
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/top-level app widths/i),
        expect.stringMatching(/locale evidence is duplicated/i),
        expect.stringMatching(/state matrix/i),
        expect.stringMatching(/width evidence/i),
      ])
    );
  });

  it("requires a fresh ignored artifact directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf43-experience-"));
    try {
      const directory = await createWf43ExperienceArtifactDirectory(root, "", "evidence-1");
      expect(directory).toBe(join(root, ".wayfinder-smoke", "wf43-experience-evidence-1"));
      await expect(createWf43ExperienceArtifactDirectory(root, "", "evidence-1")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function passingResult(): any {
  return {
    schemaVersion: 1,
    runtime: {
      foundryVersion: "14.366",
      pf2eVersion: "8.4.1",
      moduleVersion: "0.7.5",
      worldId: "testing-world",
    },
    users: {
      gm: { id: "gm-1", name: "smoke", role: 4, isGM: true },
      player: { id: "player-1", name: "wf-smoke-player", role: 1, isGM: false },
    },
    viewport: WF43_VIEWPORT,
    appWidths: WF43_APP_WIDTHS,
    locales: wf43ExperienceCases.map((definition) => ({
      id: definition.id,
      status: "pass",
      definitionFingerprint: definition.definitionFingerprint,
      observedLocale: definition.id,
      item: {
        name: "Dagger",
        accessibleNames: {
          preview: "Preview Dagger",
          buy: "Buy Dagger with coin",
          decrease: "Decrease quantity of Dagger",
          increase: "Increase quantity of Dagger",
          remove: "Remove Dagger",
        },
      },
      keyboard: {
        inputMode: "keyboard-events-only",
        pointerActionCount: 0,
        actions: [
          "initialize",
          "search",
          "add-item",
          "increase-quantity",
          "decrease-quantity",
          "review-purchases",
          "acknowledge-handoff",
          "forced-apply",
          "forced-apply-confirm",
          "retry-apply",
          "retry-apply-confirm",
        ].map((action) => ({ action, key: action === "search" ? "Dagger" : "Enter" })),
        focus: Array.from({ length: 6 }, (_, index) => ({ focusId: `focus-${index}`, name: "Dagger", visible: true })),
      },
      liveRegionChanges: {
        catalogue: { before: "Showing 12", after: "Showing 1" },
        cart: { before: "Cart empty", after: "Cart has Dagger" },
        review: { before: "Added", after: "Kit confirmed" },
        failure: { before: "Kit confirmed", after: "Apply failed" },
      },
      failure: {
        role: "alert",
        ariaLive: "assertive",
        focusId: "starting-equipment-status",
        focused: true,
        text: definition.stateAnchors["forced-failure"] ?? "Apply failed",
      },
      receipt: { rendered: true, accessibleName: "Starting equipment receipt", itemRowCount: 1 },
      rawLocalizationKeys: [],
      states: WF43_STATE_IDS.map((stateId) => ({
        id: stateId,
        observedLocale: definition.id,
        text: `${definition.name} ${definition.stateAnchors[stateId] ?? ""} ${stateId}`,
        rawLocalizationKeys: [],
        widths: WF43_APP_WIDTHS.map((width) => ({
          requestedAppWidth: width,
          observedAppWidth: width,
          rootOverflow: 0,
          stageOverflow: 0,
          paneOverflow: 0,
          criticalNodeCount: 2,
          clippedCriticalNodes: [],
        })),
      })),
    })),
    cleanup: {
      actorsDeleted: 2,
      actorsMissingAfterCleanup: true,
      actorCountRestored: true,
      exactFixturesMatched: true,
      policyRestored: true,
      packsRestored: true,
      languageRestored: true,
      restorationFailures: [],
    },
  };
}

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}
