import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWf43ExperienceArtifactDirectory,
  writeWf43ExperienceArtifacts,
} from "../tools/foundry-smoke/wf43-experience-artifacts.mjs";
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
const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
const keyboardFocusService = readFileSync(
  resolve("src/wayfinder/application/foundry-keyboard-focus-service.ts"),
  "utf8"
);
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
    expect(browserSuite).toContain("__enterWayfinderWf43KeyboardScope");
    expect(browserSuite).toContain("localTabOrder");
    expect(browserSuite).toContain("const descriptor = wf43FocusDescriptor(active)");
    expect(browserSuite).toContain("visibleWindows: wf43VisibleWindowEvidence()");
    expect(runner).toContain("assertKeyboardEntry(keyboard.entry)");
    expect(frozenWave2).toContain("equipment-l1-owner-common-purchase-retry");
  });

  it("selects the compact catalogue leaf before keyboard-adding from exact item detail", () => {
    const itemSelector = runner.indexOf('data-wayfinder-action="preview-equipment-item"');
    const selectStage = runner.indexOf('interactionStage("browse-cart", "select-item")', itemSelector);
    const selectTab = runner.indexOf("await appTabTo(itemSelector)", selectStage);
    const selectAction = runner.indexOf('pressAndRecord(playerPage, keyboard, "select-item", "Enter")', selectStage);
    const detailSelector = runner.indexOf('data-application-part="equipment-detail"', selectAction);
    const currencySelector = runner.indexOf('data-funding="currency"', detailSelector);
    const detailWait = runner.indexOf("await waitFor(playerPage, currencyActionSelector)", currencySelector);
    const addTab = runner.indexOf("await appTabTo(currencyActionSelector)", detailWait);
    const addAction = runner.indexOf('pressAndRecord(playerPage, keyboard, "add-item", "Enter")', detailWait);

    expect(itemSelector).toBeGreaterThan(-1);
    expect(selectStage).toBeGreaterThan(itemSelector);
    expect(selectTab).toBeGreaterThan(selectStage);
    expect(selectAction).toBeGreaterThan(selectTab);
    expect(detailSelector).toBeGreaterThan(selectAction);
    expect(currencySelector).toBeGreaterThan(detailSelector);
    expect(detailWait).toBeGreaterThan(currencySelector);
    expect(addTab).toBeGreaterThan(detailWait);
    expect(addAction).toBeGreaterThan(addTab);
    expect(runner).not.toContain('`${itemSelector} [data-wayfinder-action="add-equipment-item"]');
  });

  it("uses forward Tab into cart controls and Shift+Tab after quantity focus restoration", () => {
    const quantityEntry = runner.indexOf('interactionStage("browse-cart", "quantity-entry")');
    const decrementEntry = runner.indexOf("await appTabTo(decreaseQuantitySelector)", quantityEntry);
    const increment = runner.indexOf("await appTabTo(increaseQuantitySelector)", decrementEntry);
    const increaseAction = runner.indexOf(
      'pressAndRecord(playerPage, keyboard, "increase-quantity", "Enter")',
      increment
    );
    const decrementReturn = runner.indexOf(
      'await appTabTo(decreaseQuantitySelector, { key: "Shift+Tab" })',
      increaseAction
    );
    const decreaseAction = runner.indexOf(
      'pressAndRecord(playerPage, keyboard, "decrease-quantity", "Enter")',
      decrementReturn
    );

    expect(quantityEntry).toBeGreaterThan(-1);
    expect(decrementEntry).toBeGreaterThan(quantityEntry);
    expect(increment).toBeGreaterThan(decrementEntry);
    expect(increaseAction).toBeGreaterThan(increment);
    expect(decrementReturn).toBeGreaterThan(increaseAction);
    expect(decreaseAction).toBeGreaterThan(decrementReturn);
  });

  it("bounds and persists active, target, local-order, and observed Tab failure evidence", () => {
    expect(runner).toContain("const tabTraversalFailures = []");
    expect(runner).toContain("tabTraversalFailures,");
    expect(runner).toContain("if (boundedTraversal.length > 24) boundedTraversal.shift()");
    expect(browserSuite).toContain("__inspectWayfinderWf43TabTraversal");
    expect(browserSuite).toContain("active: wf43FocusDescriptor(document.activeElement)");
    expect(browserSuite).toContain("localTabOrderLimit = 80");
    expect(browserSuite).toContain("observedTraversalTruncated");
  });

  it("records the app-local keyboard entry target instead of traversing arbitrary Foundry chrome", () => {
    const result = passingResult();
    result.locales[0].keyboard.entry.target.disabled = true;
    result.locales[0].keyboard.entry.target.tabIndex = -1;
    result.locales[0].keyboard.entry.target.keyboardFocus = null;
    delete result.locales[0].keyboard.entry.visibleWindows;
    result.locales[1].keyboard.entry.target.localOrderIndex = -1;
    result.locales[1].keyboard.entry.observedTraversal = [];
    result.locales[1].keyboard.entry.visibleWindows[0].title = "x".repeat(161);
    expect(qualifyWf43ExperienceResult(result).failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/visible enabled target in the app-local tab order/i),
        expect.stringMatching(/visibly traverse to Start Shopping/i),
        expect.stringMatching(/unbounded accessible names/i),
        expect.stringMatching(/missing visible-window diagnostics/i),
      ])
    );
  });

  it("marks Foundry keyboard focus centrally before both full and partial render branches", () => {
    expect(keyboardFocusService).toContain('"button, input, select, textarea, a[href], [tabindex]"');
    const markerCall = appShell.indexOf("markWayfinderKeyboardFocus(root);");
    expect(markerCall).toBeGreaterThan(appShell.indexOf("async _onRender"));
    expect(markerCall).toBeLessThan(appShell.indexOf('context.wayfinderRenderScope === "picker-search"', markerCall));
    expect(markerCall).toBeLessThan(appShell.indexOf('context.wayfinderRenderScope === "equipment"', markerCall));
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

  it("rejects duplicated, reordered, or non-Enter compact catalogue actions", () => {
    const result = passingResult();
    const actions = result.locales[0].keyboard.actions;
    const selectIndex = actions.findIndex((item) => item.action === "select-item");
    actions.splice(selectIndex, 0, { action: "add-item", key: "Enter" });
    result.locales[1].keyboard.actions.find((item) => item.action === "select-item").key = "Space";

    expect(qualifyWf43ExperienceResult(result).failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/en: compact catalogue flow did not keyboard-search/i),
        expect.stringMatching(/cn: compact catalogue flow did not keyboard-search/i),
      ])
    );
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

  it("writes truthful partial artifacts for setup or interaction failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf43-experience-failure-"));
    try {
      const result = {
        schemaVersion: 1,
        evidenceId: "failure-1",
        status: "fail",
        startedAt: "2026-08-21T00:00:00.000Z",
        finishedAt: "2026-08-21T00:00:01.000Z",
        stage: { id: "keyboard-entry", locale: "en", state: "policy", action: "initialize" },
        error: { name: "Error", message: "Keyboard traversal failed", stack: null },
        runtime: null,
        users: null,
        viewport: WF43_VIEWPORT,
        appWidths: WF43_APP_WIDTHS,
        locales: [],
        keyboardEntries: [
          {
            locale: "en",
            mode: "scoped-app-entry",
            focusMethod: "programmatic-harness-anchor-before-keyboard-actions",
            target: { visible: true, disabled: false, tabIndex: 0, localOrderIndex: 31 },
          },
        ],
        tabTraversalFailures: [
          {
            active: { focusId: "starting-equipment-item:item:coin", name: "Buy Dagger with coin" },
            key: "Tab",
            limit: 180,
            localOrderIndex: 12,
            localTabOrder: [{ focusId: "starting-equipment-line:line-1", name: "Dagger" }],
            localTabOrderCount: 24,
            localTabOrderTruncated: false,
            observedTraversal: [{ focusId: "starting-equipment-line:line-1", name: "Dagger" }],
            observedTraversalCount: 180,
            observedTraversalTruncated: true,
            target: { present: true, visible: true, disabled: false, tabIndex: 0 },
            targetSelector: "[data-delta='-1']",
          },
        ],
        samples: [{ locale: "en", state: "policy", width: 1240, screenshot: "screenshots/en-policy-1240.png" }],
        cleanup: {
          attempted: true,
          setupCompleted: true,
          actorsDeleted: 2,
          actorCountRestored: true,
          policyRestored: true,
          packsRestored: true,
          languageRestored: true,
          restorationFailures: [],
        },
      };
      await writeWf43ExperienceArtifacts(root, result, {
        ok: false,
        failures: ["WF-080-43 runner failed during keyboard-entry/en/policy/initialize."],
      });
      const written = JSON.parse(readFileSync(join(root, "wf43-experience-results.json"), "utf8"));
      const summary = readFileSync(join(root, "wf43-experience-summary.md"), "utf8");
      expect(written).toMatchObject({
        status: "fail",
        stage: result.stage,
        error: result.error,
        keyboardEntries: result.keyboardEntries,
        tabTraversalFailures: result.tabTraversalFailures,
        samples: result.samples,
        cleanup: result.cleanup,
      });
      expect(summary).toContain("Result: FAIL");
      expect(summary).toContain("Stage: keyboard-entry/en/policy/initialize");
      expect(summary).toContain("Completed samples: 1");
      expect(summary).toContain("Keyboard entry diagnostics: 1");
      expect(summary).toContain("Tab traversal failure diagnostics: 1");
      expect(summary).toContain("Keyboard traversal failed");
      expect(summary).toContain("Cleanup attempted: true");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("guards artifact preparation and converts cleanup-only failures into a staged run error", () => {
    const mainStart = runner.indexOf("async function main()");
    const guardedTry = runner.indexOf("  try {", mainStart);
    const screenshotPreparation = runner.indexOf('await mkdir(path.join(outDir, "screenshots")', mainStart);
    expect(screenshotPreparation).toBeGreaterThan(guardedTry);
    expect(runner).toContain("cleanupEvidenceFailures(cleanup, wf43ExperienceCases.length)");
    expect(runner).toContain('failedStage = { id: "cleanup-restoration" }');
  });

  it("emits a failed artifact when guarded option validation stops the runner before browser launch", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf43-experience-runner-failure-"));
    const outDir = join(root, "artifacts");
    try {
      const execution = spawnSync(
        process.execPath,
        [resolve("tools/foundry-smoke/run-wf43-experience-smoke.mjs"), "--out", outDir],
        {
          cwd: resolve("."),
          encoding: "utf8",
          env: {
            ...process.env,
            FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE: "false",
            FOUNDRY_SMOKE_PLAYER_USER: "",
            FOUNDRY_SMOKE_WORLD_ID: "",
            FOUNDRY_USER: "",
          },
        }
      );
      expect(execution.status).toBe(1);
      const written = JSON.parse(readFileSync(join(outDir, "wf43-experience-results.json"), "utf8"));
      expect(written).toMatchObject({
        status: "fail",
        stage: { id: "option-validation" },
        cleanup: { attempted: false, setupCompleted: false, restorationFailures: [] },
      });
      expect(written.error.message).toContain("An existing GM user is required");
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
        entry: {
          mode: "scoped-app-entry",
          focusMethod: "programmatic-harness-anchor-before-keyboard-actions",
          before: { focusId: "", action: "", name: "", tag: "BODY" },
          visibleWindows: [
            {
              id: "user-config-player",
              classes: ["application", "user-config"],
              title: "User Configuration: wf-smoke-player",
              ariaModal: null,
              zIndex: "100",
            },
            {
              id: "wayfinder-player",
              classes: ["application", "wayfinder-app"],
              title: "Wayfinder",
              ariaModal: null,
              zIndex: "101",
            },
          ],
          anchor: {
            focusId: "",
            action: "",
            name: "Starting equipment",
            tag: "H3",
            keyboardFocus: "true",
            focused: true,
          },
          target: {
            focusId: "starting-equipment-start",
            action: "initialize-starting-equipment",
            name: "Start Shopping",
            tag: "BUTTON",
            present: true,
            visible: true,
            disabled: false,
            tabIndex: 0,
            keyboardFocus: "true",
            localOrderIndex: 31,
          },
          localTabOrder: [],
          observedTraversal: [
            { focusId: "previous-step", name: "Previous step", visible: true },
            { focusId: "starting-equipment-start", name: "Start Shopping", visible: true },
          ],
        },
        actions: [
          "initialize",
          "search",
          "select-item",
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
