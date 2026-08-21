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
import {
  restoreFoundryClientLanguages,
  snapshotFoundryClientLanguages,
  switchFoundryClientLanguages,
} from "../tools/foundry-smoke/wf43-experience-language.mjs";

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
    expect(browserSuite).not.toContain("reviewedDrafts");
    expect(browserSuite).toContain("__inspectWayfinderWf43Focus");
    expect(browserSuite).toContain("__enterWayfinderWf43KeyboardScope");
    expect(browserSuite).toContain("localTabOrder");
    expect(browserSuite).toContain("const descriptor = wf43FocusDescriptor(active)");
    expect(browserSuite).toContain("visibleWindows: wf43VisibleWindowEvidence()");
    expect(runner).toContain("assertKeyboardEntry(entry, { action, mode, state })");
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

  it("uses the safe Cancel default and adjacent backward traversal for Apply confirmation", () => {
    const applyHelper = runner.slice(
      runner.indexOf("async function applyWithKeyboard"),
      runner.indexOf("async function pressAndRecord")
    );
    expect(applyHelper).toContain('button[data-action="yes"]');
    expect(applyHelper).toContain('`${action}-confirm-focus`, "Shift+Tab"');
    expect(applyHelper).toContain('pressAndRecord(page, keyboard, `${action}-confirm`, "Enter")');
    expect(applyHelper).toContain("activationTarget");
    expect(runner).toContain("applyBoundary.confirmation = await applyWithKeyboard");
    expect(runner).toContain("retryBoundary.confirmation = await applyWithKeyboard");
    expect(browserSuite).toContain("dialogAction: element.dataset.action");
    expect(runner).toContain("const persistedEntry = { locale: definition.id, ...entry }");
    expect(runner).toContain("keyboardEntries.push(persistedEntry)");
    expect(runner).toContain("return persistedEntry");
    expect(runner).not.toContain("keyboardEntries.push({ locale: definition.id, ...entry })");
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

  it("re-enters the scoped app boundary after every programmatic reopen followed by keyboard action", () => {
    const handoffOpen = runner.indexOf("__prepareWayfinderWf43Handoff");
    const handoffBoundary = runner.indexOf('state: "handoff"', handoffOpen);
    const handoffTarget = runner.indexOf(
      "targetSelector: '[data-wayfinder-action=\"acknowledge-equipment-handoff\"]'",
      handoffBoundary
    );
    const handoffAction = runner.indexOf(
      'pressAndRecord(playerPage, keyboard, "acknowledge-handoff", "Enter")',
      handoffTarget
    );
    const forcedRestore = runner.indexOf("__restoreWayfinderWf43ReviewedDraft", handoffAction);
    const forcedOpen = runner.indexOf("__openWayfinderWf43Experience", forcedRestore);
    const forcedBoundary = runner.indexOf('state: "forced-failure"', forcedOpen);
    const forcedAnchor = runner.indexOf(
      'anchorSelector: `[data-wayfinder-step-heading="${definition.fixture.stepId}"]`',
      forcedOpen
    );
    const forcedTarget = runner.indexOf("targetSelector: '[data-wayfinder-action=\"apply-draft\"]'", forcedBoundary);
    const forcedAction = runner.indexOf("applyBoundary.confirmation = await applyWithKeyboard", forcedTarget);
    const errorFocus = runner.indexOf('interactionStage("forced-failure", "error-focus")', forcedAction);
    const failureCapture = runner.indexOf('"forced-failure", definition, outDir', errorFocus);
    const retryBoundary = runner.indexOf('action: "retry-apply"', failureCapture);
    const retryAnchor = runner.indexOf(
      'anchorSelector: \'[data-wayfinder-focus-id="starting-equipment-status"][role="alert"]\'',
      retryBoundary
    );
    const retryAction = runner.indexOf("retryBoundary.confirmation = await applyWithKeyboard", retryAnchor);

    expect(handoffOpen).toBeGreaterThan(-1);
    expect(handoffBoundary).toBeGreaterThan(handoffOpen);
    expect(handoffTarget).toBeGreaterThan(handoffBoundary);
    expect(handoffAction).toBeGreaterThan(handoffTarget);
    expect(forcedRestore).toBeGreaterThan(handoffAction);
    expect(forcedOpen).toBeGreaterThan(forcedRestore);
    expect(forcedBoundary).toBeGreaterThan(forcedOpen);
    expect(forcedAnchor).toBeGreaterThan(forcedOpen);
    expect(forcedBoundary).toBeGreaterThan(forcedAnchor);
    expect(forcedTarget).toBeGreaterThan(forcedBoundary);
    expect(forcedAction).toBeGreaterThan(forcedTarget);
    expect(errorFocus).toBeGreaterThan(forcedAction);
    expect(failureCapture).toBeGreaterThan(errorFocus);
    expect(retryBoundary).toBeGreaterThan(failureCapture);
    expect(retryAnchor).toBeGreaterThan(retryBoundary);
    expect(retryAction).toBeGreaterThan(retryAnchor);
  });

  it("waits for and persists the product-owned failure alert focus before viewport capture", () => {
    const apply = runner.indexOf("applyBoundary.confirmation = await applyWithKeyboard");
    const focusStage = runner.indexOf('interactionStage("forced-failure", "error-focus")', apply);
    const focusWait = runner.indexOf("document.activeElement === document.querySelector(selector)", focusStage);
    const persisted = runner.indexOf("failureFocusEntries.push", focusWait);
    const capture = runner.indexOf('"forced-failure", definition, outDir', persisted);

    expect(apply).toBeGreaterThan(-1);
    expect(focusStage).toBeGreaterThan(apply);
    expect(focusWait).toBeGreaterThan(focusStage);
    expect(persisted).toBeGreaterThan(focusWait);
    expect(capture).toBeGreaterThan(persisted);
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
    expect(runner).toContain("snapshotFoundryClientLanguages(languageTargets(gmPage, playerPage)");
    expect(runner).toContain("setFoundryLanguage(gmPage, playerPage");
    expect(runner).toContain("restoreFoundryClientLanguages(targets, snapshots");
    expect(runner).toContain('role: "gm"');
    expect(runner).toContain('role: "player"');
    expect(runner).toContain("setup.snapshots.language");
  });

  it("switches and initializes the client-scoped Foundry language in both browser contexts", async () => {
    const gm = new FakeLanguagePage("en");
    const player = new FakeLanguagePage("en");
    const targets = [
      { role: "gm", page: gm },
      { role: "player", page: player },
    ];
    const snapshots = await snapshotFoundryClientLanguages(targets, "wayfinder-pf2e");
    const evidence = await switchFoundryClientLanguages(targets, "cn", {
      moduleId: "wayfinder-pf2e",
      reload: async (page: FakeLanguagePage) => page.reloadLanguage(),
    });

    expect(snapshots).toEqual([
      { role: "gm", setting: "en", locale: "en" },
      { role: "player", setting: "en", locale: "en" },
    ]);
    expect(evidence).toEqual([
      expect.objectContaining({
        role: "gm",
        requestedLanguage: "cn",
        setting: "cn",
        locale: "cn",
        supported: true,
        moduleActive: true,
        moduleLanguageDeclared: true,
        moduleLanguagePath: "modules/wayfinder-pf2e/lang/cn.json",
      }),
      expect.objectContaining({
        role: "player",
        requestedLanguage: "cn",
        setting: "cn",
        locale: "cn",
        supported: true,
        moduleActive: true,
        moduleLanguageDeclared: true,
        moduleLanguagePath: "modules/wayfinder-pf2e/lang/cn.json",
      }),
    ]);
    expect(gm.reloadCount).toBe(1);
    expect(player.reloadCount).toBe(1);
  });

  it("fails closed with per-client provider evidence before mutating an unavailable locale", async () => {
    const gm = new FakeLanguagePage("en");
    const player = new FakeLanguagePage("en", { declaredLanguages: ["en"] });
    const operation = switchFoundryClientLanguages(
      [
        { role: "gm", page: gm },
        { role: "player", page: player },
      ],
      "cn",
      {
        moduleId: "wayfinder-pf2e",
        reload: async (page: FakeLanguagePage) => page.reloadLanguage(),
      }
    );

    await expect(operation).rejects.toMatchObject({
      message: expect.stringContaining("player client cannot switch to cn"),
      languageEvidence: [
        expect.objectContaining({ role: "gm", moduleLanguageDeclared: true }),
        expect.objectContaining({ role: "player", moduleLanguageDeclared: false }),
      ],
    });
    expect(gm.setting).toBe("en");
    expect(player.setting).toBe("en");
    expect(gm.reloadCount).toBe(0);
    expect(player.reloadCount).toBe(0);
  });

  it("restores each client to its own exact snapshot and continues after a peer failure", async () => {
    const gm = new FakeLanguagePage("cn", { failSet: true });
    const player = new FakeLanguagePage("en");
    const restoration = await restoreFoundryClientLanguages(
      [
        { role: "gm", page: gm },
        { role: "player", page: player },
      ],
      [
        { role: "gm", setting: "en", locale: "en" },
        { role: "player", setting: "cn", locale: "cn" },
      ],
      {
        moduleId: "wayfinder-pf2e",
        reload: async (page: FakeLanguagePage) => page.reloadLanguage(),
      }
    );

    expect(restoration.restored).toBe(false);
    expect(restoration.failures).toEqual(expect.arrayContaining([expect.stringMatching(/gm client language setting/)]));
    expect(gm.setting).toBe("cn");
    expect(player.setting).toBe("cn");
    expect(player.locale).toBe("cn");
  });

  it("restores distinct GM and player client languages exactly", async () => {
    const gm = new FakeLanguagePage("cn");
    const player = new FakeLanguagePage("en");
    const restoration = await restoreFoundryClientLanguages(
      [
        { role: "gm", page: gm },
        { role: "player", page: player },
      ],
      [
        { role: "gm", setting: "en", locale: "en" },
        { role: "player", setting: "cn", locale: "cn" },
      ],
      {
        moduleId: "wayfinder-pf2e",
        reload: async (page: FakeLanguagePage) => page.reloadLanguage(),
      }
    );

    expect(restoration).toMatchObject({ restored: true, failures: [] });
    expect({ setting: gm.setting, locale: gm.locale }).toEqual({ setting: "en", locale: "en" });
    expect({ setting: player.setting, locale: player.locale }).toEqual({ setting: "cn", locale: "cn" });
  });

  it("binds Chinese key parity and exact live anchors instead of accepting English fallback", () => {
    expect(flattenKeys(chinese["wayfinder-pf2e"].StartingEquipment)).toEqual(
      flattenKeys(english["wayfinder-pf2e"].StartingEquipment)
    );
    expect(flattenKeys(chinese["wayfinder-pf2e"].AcquisitionReceipt)).toEqual(
      flattenKeys(english["wayfinder-pf2e"].AcquisitionReceipt)
    );
    const chineseCase = wf43ExperienceCases.find((entry) => entry.id === "cn")!;
    const englishCase = wf43ExperienceCases.find((entry) => entry.id === "en")!;
    expect(Object.keys(chineseCase.stateAnchors)).toEqual(WF43_STATE_IDS);
    expect((Object.values(chineseCase.stateAnchors) as string[]).every((value) => /[\u3400-\u9fff]/u.test(value))).toBe(
      true
    );
    expect(englishCase.stateAnchors["forced-failure"]).toBe("Wayfinder partially applied this draft");
    expect(chineseCase.stateAnchors["forced-failure"]).toBe("寻路仪已部分应用此起始装备草稿");
    expect(englishCase.confirmationLabels).toEqual({ cancel: "Cancel", apply: "Apply" });
    expect(chineseCase.confirmationLabels).toEqual({ cancel: "取消", apply: "应用" });
  });

  it("accepts exact responsive, accessible, localized evidence", () => {
    expect(qualifyWf43ExperienceResult(passingResult())).toEqual({ ok: true, failures: [] });
  });

  it("rejects missing or drifted per-client language persistence and provider evidence", () => {
    const missing = passingResult();
    missing.languageSwitches.pop();
    expect(qualifyWf43ExperienceResult(missing).failures).toContain(
      "WF-080-43 per-client language switch evidence is duplicated, incomplete, or reordered."
    );

    const drifted = passingResult();
    drifted.languageSwitches[1].locale = "cn";
    drifted.languageSwitches[2].supported = false;
    drifted.languageSwitches[3].moduleLanguagePath = "lang/en.json";
    expect(qualifyWf43ExperienceResult(drifted).failures).toEqual(
      expect.arrayContaining([
        "en/player: Foundry client language was not supported, module-declared, persisted, and initialized exactly.",
        "cn/gm: Foundry client language was not supported, module-declared, persisted, and initialized exactly.",
        "cn/player: Foundry client language was not supported, module-declared, persisted, and initialized exactly.",
      ])
    );
  });

  it("rejects incomplete, mislabeled, or non-traversed keyboard reopen boundaries", () => {
    const incomplete = passingResult();
    incomplete.keyboardEntries.splice(1, 1);
    expect(qualifyWf43ExperienceResult(incomplete).failures).toContain(
      "WF-080-43 keyboard boundary evidence is duplicated, incomplete, or reordered."
    );

    const drifted = passingResult();
    drifted.keyboardEntries[1].mode = "scoped-app-entry";
    drifted.keyboardEntries[1].target.action = "apply-draft";
    drifted.keyboardEntries[1].observedTraversal = [];
    drifted.keyboardEntries[2].anchor = {
      ...drifted.keyboardEntries[2].anchor,
      action: "apply-draft",
      stepHeading: "",
      tag: "BUTTON",
    };
    drifted.keyboardEntries[5].observedTraversal[0] = {
      ...drifted.keyboardEntries[5].observedTraversal[0],
      focusId: "",
      keyboardFocus: null,
    };
    expect(qualifyWf43ExperienceResult(drifted).failures).toContain(
      "en: handoff keyboard boundary did not prove scoped visible Tab traversal to acknowledge-equipment-handoff."
    );
    expect(qualifyWf43ExperienceResult(drifted).failures).toEqual(
      expect.arrayContaining([
        "en: forced-failure keyboard boundary did not prove scoped visible Tab traversal to apply-draft.",
        "cn: handoff keyboard boundary did not prove scoped visible Tab traversal to acknowledge-equipment-handoff.",
      ])
    );
  });

  it("rejects missing, stale, hidden, or unfocused forced-failure focus evidence", () => {
    const missing = passingResult();
    missing.failureFocusEntries.pop();
    expect(qualifyWf43ExperienceResult(missing).failures).toContain(
      "WF-080-43 forced-failure focus evidence is duplicated, incomplete, or reordered."
    );

    const drifted = passingResult();
    drifted.failureFocusEntries[0].focused = false;
    drifted.failureFocusEntries[1].visible = false;
    drifted.failureFocusEntries[1].text = "Apply failed";
    expect(qualifyWf43ExperienceResult(drifted).failures).toEqual(
      expect.arrayContaining([
        "en: forced-failure render did not move focus to the visible localized alert.",
        "cn: forced-failure render did not move focus to the visible localized alert.",
      ])
    );
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

  it("rejects Apply confirmation evidence that jumps to Apply without the Cancel Shift+Tab transition", () => {
    const result = passingResult();
    for (const entry of result.locales) {
      entry.keyboard.actions = entry.keyboard.actions.filter((item) => !item.action.endsWith("-confirm-focus"));
    }
    delete result.keyboardEntries.find((item) => item.locale === "en" && item.action === "apply").confirmation;
    for (const entry of result.keyboardEntries.filter(
      (item) => ["apply", "retry-apply"].includes(item.action) && item.confirmation
    )) {
      entry.confirmation.traversalKey = "programmatic-focus";
    }

    expect(qualifyWf43ExperienceResult(result).failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/en: keyboard flow is missing forced-apply-confirm-focus/i),
        expect.stringMatching(/cn: Apply confirmations did not prove ordered Cancel, Shift\+Tab, Apply, Enter/i),
        expect.stringMatching(/en: apply confirmation did not prove focused Cancel, Shift\+Tab/i),
        expect.stringMatching(/cn: retry-apply confirmation did not prove focused 取消, Shift\+Tab/i),
      ])
    );
  });

  it("rejects overflow, clipping, raw keys, generic names, stale announcements, and hidden focus", () => {
    const result = passingResult();
    result.locales[0].reviewedSnapshotProvenance.draft = { acquisition: "must not leak" };
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
        expect.stringMatching(/snapshot provenance is missing, unbounded, or exposes draft state/i),
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
        failureFocusEntries: [
          {
            locale: "en",
            state: "forced-failure",
            action: "error-focus",
            focusId: "starting-equipment-status",
            focused: true,
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
        languageSwitches: [],
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
        failureFocusEntries: result.failureFocusEntries,
        tabTraversalFailures: result.tabTraversalFailures,
        samples: result.samples,
        cleanup: result.cleanup,
      });
      expect(summary).toContain("Result: FAIL");
      expect(summary).toContain("Stage: keyboard-entry/en/policy/initialize");
      expect(summary).toContain("Completed samples: 1");
      expect(summary).toContain("Keyboard entry diagnostics: 1");
      expect(summary).toContain("Forced-failure focus diagnostics: 1");
      expect(summary).toContain("Tab traversal failure diagnostics: 1");
      expect(summary).toContain("Per-client language switch diagnostics: 0");
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

  it("stages guarded draft clear/set failures before the exact fixture cleanup finally path", () => {
    const mainStart = runner.indexOf("async function main()");
    const guardedTry = runner.indexOf("  try {", mainStart);
    const awaitedLocale = runner.indexOf("await runLocale({", guardedTry);
    const mainCatch = runner.indexOf("  } catch (error) {", awaitedLocale);
    const mainFinally = runner.indexOf("  } finally {", mainCatch);
    const guardedCleanup = runner.indexOf("__cleanupWayfinderWf43Experience", mainFinally);
    const mainEnd = runner.indexOf("\n}\n\nasync function runLocale", mainFinally);
    const localeStart = runner.indexOf("async function runLocale");
    const localeEnd = runner.indexOf("async function captureState", localeStart);
    const restoreStage = runner.indexOf('interactionStage("forced-failure", "restore-reviewed-draft")', localeStart);
    const restoreCall = runner.indexOf("__restoreWayfinderWf43ReviewedDraft", restoreStage);
    expect(awaitedLocale).toBeGreaterThan(guardedTry);
    expect(mainCatch).toBeGreaterThan(awaitedLocale);
    expect(mainFinally).toBeGreaterThan(mainCatch);
    expect(guardedCleanup).toBeGreaterThan(mainFinally);
    expect(mainEnd).toBeGreaterThan(guardedCleanup);
    expect(restoreStage).toBeGreaterThan(localeStart);
    expect(restoreCall).toBeGreaterThan(restoreStage);
    expect(localeEnd).toBeGreaterThan(restoreCall);
    expect(runner.slice(mainCatch, mainFinally)).toContain("failedStage = { ...stage }");
    expect(runner).toContain("cleanupEvidenceFailures(cleanup, wf43ExperienceCases.length)");
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
    languageSwitches: wf43ExperienceCases.flatMap((definition) =>
      ["gm", "player"].map((role) => ({
        role,
        requestedLanguage: definition.id,
        setting: definition.id,
        locale: definition.id,
        supported: true,
        moduleId: "wayfinder-pf2e",
        moduleActive: true,
        moduleLanguageDeclared: true,
        moduleLanguagePath: `modules/wayfinder-pf2e/lang/${definition.id}.json`,
      }))
    ),
    keyboardEntries: wf43ExperienceCases.flatMap((definition) => [
      passingKeyboardBoundary(definition.id, definition.fixture.stepId, {
        action: "initialize",
        mode: "scoped-app-entry",
        state: "policy",
        targetAction: "initialize-starting-equipment",
        targetFocusId: "starting-equipment-start",
        targetName: "Start Shopping",
      }),
      passingKeyboardBoundary(definition.id, definition.fixture.stepId, {
        action: "acknowledge",
        mode: "scoped-app-reentry",
        state: "handoff",
        targetAction: "acknowledge-equipment-handoff",
        targetFocusId: "starting-equipment-acknowledge-handoff",
        targetName: "Got It",
      }),
      passingKeyboardBoundary(definition.id, definition.fixture.stepId, {
        action: "apply",
        mode: "scoped-app-reentry",
        state: "forced-failure",
        targetAction: "apply-draft",
        targetFocusId: "",
        targetName: "Apply Changes",
        confirmationLabels: definition.confirmationLabels,
      }),
      passingKeyboardBoundary(definition.id, definition.fixture.stepId, {
        action: "retry-apply",
        mode: "scoped-alert-reentry",
        state: "forced-failure",
        targetAction: "apply-draft",
        targetFocusId: "",
        targetName: "Apply Changes",
        anchorFocusId: "starting-equipment-status",
        anchorName: definition.stateAnchors["forced-failure"] ?? "Apply failed",
        anchorStepHeading: "",
        anchorTag: "DIV",
        confirmationLabels: definition.confirmationLabels,
      }),
    ]),
    failureFocusEntries: wf43ExperienceCases.map((definition) => ({
      locale: definition.id,
      state: "forced-failure",
      action: "error-focus",
      role: "alert",
      ariaLive: "assertive",
      focusId: "starting-equipment-status",
      focused: true,
      visible: true,
      keyboardFocus: "true",
      tabIndex: -1,
      text: definition.stateAnchors["forced-failure"] ?? "Apply failed",
      textLength: (definition.stateAnchors["forced-failure"] ?? "Apply failed").length,
      textTruncated: false,
    })),
    tabTraversalFailures: [],
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
      reviewedSnapshotProvenance: {
        schemaVersion: 1,
        purpose: "wf08043-reviewed-draft-snapshot",
        actorId: `actor-${definition.id}`,
        dispositionKind: "purchase-ledger",
        locale: definition.id,
        profileId: `profile-${definition.id}`,
        runId: "run-1",
        worldId: "testing-world",
        draftFingerprint: "fnv1a64:0123456789abcdef",
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
          "forced-apply-confirm-focus",
          "forced-apply-confirm",
          "retry-apply",
          "retry-apply-confirm-focus",
          "retry-apply-confirm",
        ].map((action) => ({
          action,
          key: action === "search" ? "Dagger" : action.endsWith("-confirm-focus") ? "Shift+Tab" : "Enter",
          ...(action.endsWith("-confirm-focus")
            ? {
                before: {
                  dialogAction: "no",
                  name: definition.confirmationLabels.cancel,
                  tag: "BUTTON",
                  keyboardFocus: "true",
                  visible: true,
                },
                after: {
                  dialogAction: "yes",
                  name: definition.confirmationLabels.apply,
                  tag: "BUTTON",
                  keyboardFocus: "true",
                  visible: true,
                },
              }
            : {}),
        })),
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

class FakeLanguagePage {
  setting: string;
  locale: string;
  reloadCount = 0;
  private readonly declaredLanguages: string[];
  private readonly failSet: boolean;

  constructor(language: string, options: { declaredLanguages?: string[]; failSet?: boolean } = {}) {
    this.setting = language;
    this.locale = language;
    this.declaredLanguages = options.declaredLanguages ?? ["en", "cn"];
    this.failSet = options.failSet ?? false;
  }

  async evaluate(callback: (argument?: any) => any, argument?: any): Promise<any> {
    const previousGame = (globalThis as any).game;
    const previousConfig = (globalThis as any).CONFIG;
    (globalThis as any).game = {
      settings: {
        get: () => this.setting,
        set: async (_scope: string, _key: string, value: string) => {
          if (this.failSet) throw new Error("synthetic set failure");
          this.setting = value;
        },
      },
      i18n: { lang: this.locale },
      modules: new Map([
        [
          "wayfinder-pf2e",
          {
            active: true,
            languages: this.declaredLanguages.map((lang) => ({
              lang,
              path: `modules/wayfinder-pf2e/lang/${lang}.json`,
            })),
          },
        ],
      ]),
    };
    (globalThis as any).CONFIG = { supportedLanguages: { en: "English", cn: "Simplified Chinese" } };
    try {
      return await callback(argument);
    } finally {
      (globalThis as any).game = previousGame;
      (globalThis as any).CONFIG = previousConfig;
    }
  }

  async reloadLanguage(): Promise<void> {
    this.reloadCount += 1;
    this.locale = this.setting;
  }
}

function passingKeyboardBoundary(
  locale: string,
  stepId: string,
  boundary: {
    action: string;
    mode: string;
    state: string;
    targetAction: string;
    targetFocusId: string;
    targetName: string;
    anchorFocusId?: string;
    anchorName?: string;
    anchorStepHeading?: string;
    anchorTag?: string;
    confirmationLabels?: { cancel: string; apply: string };
  }
): any {
  const target = {
    focusId: boundary.targetFocusId,
    action: boundary.targetAction,
    name: boundary.targetName,
    tag: "BUTTON",
    present: true,
    visible: true,
    disabled: false,
    tabIndex: 0,
    keyboardFocus: "true",
    localOrderIndex: 34,
  };
  const confirmationControl = (dialogAction: string, name: string) => ({
    focusId: "BUTTON",
    action: "",
    dialogAction,
    name,
    nameLength: name.length,
    nameTruncated: false,
    stepHeading: "",
    tag: "BUTTON",
    keyboardFocus: "true",
    visible: true,
  });
  return {
    locale,
    action: boundary.action,
    mode: boundary.mode,
    state: boundary.state,
    focusMethod: "programmatic-harness-anchor-before-keyboard-actions",
    before: { focusId: "", action: "", name: "", tag: "BODY" },
    visibleWindows: [],
    anchor: {
      focusId: boundary.anchorFocusId ?? "",
      action: "",
      name: boundary.anchorName ?? "Starting equipment",
      stepHeading: boundary.anchorStepHeading ?? stepId,
      tag: boundary.anchorTag ?? "H3",
      keyboardFocus: "true",
      focused: true,
    },
    target,
    localTabOrder: [target],
    observedTraversal: [{ ...target, focusId: boundary.targetFocusId || boundary.targetAction, visible: true }],
    ...(boundary.confirmationLabels
      ? {
          confirmation: {
            before: confirmationControl("no", boundary.confirmationLabels.cancel),
            traversalKey: "Shift+Tab",
            after: confirmationControl("yes", boundary.confirmationLabels.apply),
            activationKey: "Enter",
            activationTarget: confirmationControl("yes", boundary.confirmationLabels.apply),
          },
        }
      : {}),
  };
}

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}
