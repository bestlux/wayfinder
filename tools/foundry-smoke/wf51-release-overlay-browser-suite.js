/* global Actor, CONFIG, CONST, document, fromUuid, game, getComputedStyle, HTMLButtonElement, HTMLElement, MutationObserver, ui */

const WF51_PURPOSE = "wf51-release-overlay";
const DAGGER_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
const HUMAN_UUID = "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX";
const DWARF_UUID = "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6";
const ACOLYTE_UUID = "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy";
const INVESTIGATOR_UUID = "Compendium.pf2e.classes.Item.4wrSCyX6akmyo7Wj";
const METHODOLOGY_UUID = "Compendium.pf2e.classfeatures.Item.ln2Y1a4SxlU9sizX";
const METHODOLOGY_SELECTOR_UUID = "Compendium.pf2e.classfeatures.Item.uhHg9BXBiHpL5ndS";
const FORMULA_BOOK_UUID = "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx";
const MIND_READING_UUID = "Compendium.pf2e.spells-srd.Item.KHnhPHL4x1AQHfbC";
const ANCESTRY_STEP_ID = "ancestry-level-1";
const EXISTING_IMPORT_LEVEL = 7;
const EXISTING_IMPORT_SOURCES = [
  { uuid: HUMAN_UUID, name: "Human", type: "ancestry", historySlotId: "ancestry-level-1" },
  {
    uuid: "Compendium.pf2e.heritages.Item.KO33MNyY9VqNQmbZ",
    name: "Wintertouched Human",
    type: "heritage",
    historySlotId: "heritage-level-1",
  },
  {
    uuid: "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy",
    name: "Acolyte",
    type: "background",
    historySlotId: "background-level-1",
  },
  {
    uuid: "Compendium.pf2e.classes.Item.8zn3cD6GSmoo1LW4",
    name: "Fighter",
    type: "class",
    historySlotId: "class-level-1",
  },
  {
    uuid: "Compendium.pf2e.feats-srd.Item.lwLcUHQMOqfaNND4",
    name: "Cooperative Nature",
    type: "feat",
    location: "ancestry-1",
    historySlotId: "ancestry-feat-level-1",
  },
  {
    uuid: "Compendium.pf2e.feats-srd.Item.w8Ycgeq2zfyshtoS",
    name: "Reactive Shield",
    type: "feat",
    location: "class-1",
    historySlotId: "class-feat-level-1",
  },
  {
    uuid: "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath",
    name: "Toughness",
    type: "feat",
    location: "general-3",
    historySlotId: "general-feat-level-3",
  },
  {
    uuid: "Compendium.pf2e.feats-srd.Item.LQw0yIMDUJJkq1nD",
    name: "Cat Fall",
    type: "feat",
    location: "skill-2",
    historySlotId: "skill-feat-level-2",
  },
];

function assertWorld(expectedWorldId) {
  if (!expectedWorldId || game.world?.id !== expectedWorldId) {
    throw new Error(`WF-080-51 expected world ${expectedWorldId || "<missing>"}.`);
  }
}

function assertUser(expectedUserId, isGM) {
  if (!game.user || game.user.id !== expectedUserId || Boolean(game.user.isGM) !== isGM) {
    throw new Error(`WF-080-51 requires the exact ${isGM ? "GM" : "non-GM owner"} executor.`);
  }
}

async function loadModules(moduleId) {
  const [
    draftService,
    commands,
    steps,
    policyService,
    baselineService,
    grants,
    coverage,
    execution,
    spell,
    appShell,
    actorUpdater,
    draftLifecycle,
    permissions,
    planService,
    acquisitionDraft,
  ] =
    await Promise.all([
      import(`/modules/${moduleId}/scripts/draft-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/application/starting-equipment-command-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/domain/step-types.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-policy-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/application/economic-baseline-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/application/class-grant-projection-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/domain/physical-grant-coverage.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/application/acquisition-execution-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/spell-choice/rarity-attestation.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/app-shell.js`),
      import(`/modules/${moduleId}/scripts/actor-updater.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/application/draft-lifecycle-service.js`),
      import(`/modules/${moduleId}/scripts/permissions.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/plan-service.js`),
      import(`/modules/${moduleId}/scripts/wayfinder/domain/acquisition-draft.js`),
    ]);
  return {
    createEmptyDraft: draftService.createEmptyDraft,
    normalizeDraft: draftService.normalizeDraft,
    normalizeState: draftService.normalizeState,
    execute: commands.executeStartingEquipmentCommand,
    createStep: steps.createStartingEquipmentStep,
    resolveActorAbpSnapshot: policyService.resolveActorAbpSnapshot,
    assertApplyAuthority: policyService.assertEquipmentApplyAuthority,
    getRuntime: (await import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-acquisition-runtime-service.js`))
      .getFoundryEquipmentAcquisitionRuntime,
    captureBaseline: baselineService.captureActorEconomicBaseline,
    evaluateAdmission: baselineService.evaluateActorEconomicAdmission,
    createExecutionSession: execution.createAcquisitionExecutionSession,
    createPreparedPlan: (
      await import(`/modules/${moduleId}/scripts/wayfinder/domain/class-grant-reconciliation.js`)
    ).createPreparedClassGrantPlan,
    reconcilePreparedGrants: (
      await import(`/modules/${moduleId}/scripts/wayfinder/domain/class-grant-reconciliation.js`)
    ).reconcilePreparedClassGrants,
    applyDraftLifecycle: draftLifecycle.applyDraftLifecycle,
    applyDraftToActor: actorUpdater.applyDraftToActor,
    finalizeRecoveredDraftOnActor: actorUpdater.finalizeRecoveredDraftOnActor,
    canUseWayfinder: permissions.canUseWayfinder,
    assertCanUseWayfinder: permissions.assertCanUseWayfinder,
    evaluateWayfinderStep: planService.evaluateWayfinderStep,
    recordCurrencyWitness: acquisitionDraft.recordAcquisitionCurrencyConvergenceWitness,
    projectGrants: grants.projectPlannedClassGrants,
    prepareCurrentClassGrantPlan: grants.prepareCurrentClassGrantPlan,
    captureGrantItems: grants.captureObservedClassGrantItems,
    findUnsupportedRoutes: coverage.findUnsupportedPhysicalGrantRoutes,
    createSpellAttestation: spell.createSpellRarityAttestation,
    buildAppliedSpellAttestations: spell.buildAppliedSpellRarityAttestations,
    buildSpellReviewLines: spell.buildSpellRarityAttestationReviewLines,
    spellBasisLabel: spell.spellRarityAttestationBasisLabel,
    WayfinderApp: appShell.WayfinderApp,
  };
}

function userEvidence() {
  return { id: game.user.id, name: game.user.name, role: Number(game.user.role), isGM: Boolean(game.user.isGM) };
}

function runtimeEvidence(moduleId) {
  const module = game.modules.get(moduleId);
  if (!module?.active) throw new Error(`${moduleId} is not active.`);
  return {
    foundryVersion: String(game.version ?? ""),
    pf2eVersion: String(game.system?.id === "pf2e" ? game.system.version ?? "" : ""),
    moduleVersion: String(module.version ?? module.manifest?.version ?? ""),
    worldId: String(game.world?.id ?? ""),
  };
}

function fixtureActor(fixtures, caseId, moduleId, runId, ordinal = 0) {
  const fixture = fixtures.filter((entry) => entry.caseId === caseId)[ordinal];
  const actor = fixture ? game.actors.get(fixture.actorId) : null;
  const marker = actor?.getFlag(moduleId, "smokeWf51Overlay");
  if (
    !fixture ||
    !actor ||
    actor.name !== fixture.fixtureName ||
    marker?.purpose !== WF51_PURPOSE ||
    marker?.runId !== runId ||
    marker?.caseId !== caseId ||
    marker?.definitionFingerprint !== fixture.definitionFingerprint
  ) {
    throw new Error("WF-080-51 refused a fixture with changed guarded identity.");
  }
  return actor;
}

async function executeAndPersist(actor, draft, command, modules, moduleId, activeSteps = null) {
  const result = await modules.execute(command, {
    actor,
    draft,
    moduleState: modules.normalizeState(actor.getFlag(moduleId, "state")),
    steps: activeSteps ?? [modules.createStep(draft.targetLevel)],
    userId: game.user.id,
    user: game.user,
    now: () => new Date().toISOString(),
  });
  draft.acquisition = result.acquisition;
  draft.equipmentPolicyRequests = [...result.policyRequests];
  draft.updatedAt = new Date().toISOString();
  await actor.setFlag(moduleId, "draft", draft);
  return result;
}

function emptyPlan(modules, actor, draftId, batchId, targetLevel) {
  return modules.createPreparedPlan({ actorId: actor.id, draftId, batchId, targetLevel, grants: [] });
}

function history(previousTargetLevel = null) {
  return {
    previousCharacterAppliedAt: null,
    previousTargetLevel,
    completedAcquisitionManifestId: null,
    completedAcquisitionManifestCorrupt: false,
  };
}

function executionSession({ modules, runtime, actor, moduleId, inventory, transformPolicy, transformSource, afterSourceHealth }) {
  return modules.createExecutionSession({
    resolveSource: async ({ draft, entry }) => {
      const resolved = await runtime.resolveSourceForApply({
        actor,
        characterDraft: modules.normalizeDraft(actor.getFlag(moduleId, "draft"), draft.targetLevel),
        acquisition: draft,
        entry,
      });
      return transformSource ? transformSource(structuredClone(resolved)) : resolved;
    },
    readHistory: () => modules.normalizeState(actor.getFlag(moduleId, "state")),
    resolveCurrentPolicySnapshot: async ({ draft }) => {
      const current = await runtime.resolveCurrentPolicySnapshot(actor, draft);
      return transformPolicy ? transformPolicy(structuredClone(current)) : current;
    },
    assertSourceHealth: async ({ draft }) => {
      await runtime.assertCurrentSourceHealth({
        actor,
        characterDraft: modules.normalizeDraft(actor.getFlag(moduleId, "draft"), draft.targetLevel),
        acquisition: draft,
      });
      if (afterSourceHealth) await afterSourceHealth();
    },
    assertApplyAuthority: ({ draft }) => modules.assertApplyAuthority({ actor, acquisition: draft, user: game.user }),
    readApplyingUser: () => ({ userId: game.user.id, userName: game.user.name }),
    readEnvironment: () => {
      const runtimeFacts = runtimeEvidence(moduleId);
      return {
        foundryVersion: runtimeFacts.foundryVersion,
        pf2eVersion: runtimeFacts.pf2eVersion,
        moduleVersion: runtimeFacts.moduleVersion,
      };
    },
    inventory,
  });
}

function snapshotActor(actor) {
  return canonicalJson(actor.toObject(true));
}

function snapshotEconomic(modules, actor) {
  const baseline = modules.captureBaseline(actor);
  return canonicalJson({
    actorId: baseline.actorId,
    currencyCopper: baseline.currencyCopper,
    physicalItems: baseline.physicalItems,
    fingerprint: baseline.fingerprint,
  });
}

function snapshotItems(actor) {
  return canonicalJson(
    actor.items
      .map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        sourceUuid: item.sourceId ?? item.flags?.core?.sourceId ?? null,
        location:
          typeof item.system?.location === "string" ? item.system.location : (item.system?.location?.value ?? null),
        quantity: Number(item.system?.quantity ?? 0),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function snapshotUnrelatedFlags(actor, moduleId, runId, caseId, ordinal) {
  const actual = {
    pf2e: actor.getFlag("pf2e", "wf51OverlaySentinel"),
    wayfinderSmoke: actor.getFlag(moduleId, "smokeWf51Overlay"),
  };
  const expected = {
    purpose: WF51_PURPOSE,
    runId,
    caseId,
    definitionFingerprint: actual.wayfinderSmoke?.definitionFingerprint,
    ordinal,
  };
  const expectedPf2e = { purpose: WF51_PURPOSE, runId, caseId, ordinal };
  if (
    typeof expected.definitionFingerprint !== "string" ||
    expected.definitionFingerprint.length === 0 ||
    canonicalJson(actual.pf2e) !== canonicalJson(expectedPf2e) ||
    canonicalJson(actual.wayfinderSmoke) !== canonicalJson(expected)
  ) {
    throw new Error(`WF-080-51 unrelated actor flags drifted for ${caseId}/${ordinal}.`);
  }
  return canonicalJson(actual);
}

function acquisitionMaterial(draft) {
  return {
    acquisition: draft.acquisition
      ? {
          draftId: draft.acquisition.draftId,
          batchId: draft.acquisition.batchId,
          targetLevel: draft.acquisition.targetLevel,
          disposition: draft.acquisition.disposition?.kind ?? null,
        }
      : null,
    acquisitionCorrupt: draft.acquisitionCorrupt,
    policyRequestIds: draft.equipmentPolicyRequests.map((entry) => entry.requestId),
    applyAttemptStepIds: [...draft.applyAttemptStepIds],
    applyCompletedStepIds: [...draft.applyCompletedStepIds],
    applyRecoveryActorUpdate: structuredClone(draft.applyRecoveryActorUpdate),
    selections: structuredClone(draft.selections),
  };
}

function equipmentSurface(root) {
  const selectors = {
    steps: '[data-step-id^="starting-equipment-level-"]',
    pane: ".starting-equipment-pane",
    catalogue: ".equipment-catalogue, .equipment-catalogue-projection",
    cart: ".equipment-cart",
    initialize: '[data-wayfinder-action="initialize-starting-equipment"]',
  };
  return Object.fromEntries(
    Object.entries(selectors).map(([key, selector]) => [key, root?.querySelectorAll(selector)?.length ?? 0]),
  );
}

async function waitForValue(read, label, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`WF-080-51 timed out waiting for ${label}.`);
}

async function withTimeout(operation, label, timeoutMs = 15_000) {
  let timeoutId = null;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`WF-080-51 timed out waiting for ${label}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function openConnectedWayfinderApp(modules, actor, label) {
  modules.WayfinderApp.open(actor);
  const app = await waitForValue(
    () =>
      Object.values(actor.apps ?? {}).find(
        (candidate) => candidate instanceof modules.WayfinderApp && candidate.actor?.id === actor.id,
      ) ?? null,
    `${label} actor-bound Wayfinder app`,
  );
  await waitForValue(
    () => (app.element instanceof HTMLElement && app.element.isConnected ? app : null),
    `${label} connected render lifecycle`,
  );
  return app;
}

async function importExistingHistoryThroughUi(modules, actor, moduleId) {
  const app = await openConnectedWayfinderApp(modules, actor, "the existing-character");
  const before = equipmentSurface(app.element);
  const action = app.element?.querySelector('[data-wayfinder-action="import-existing-history"]');
  if (!(action instanceof HTMLElement)) throw new Error("WF-080-51 existing-history UI action is missing.");
  action.click();
  const history = await waitForValue(
    () => modules.normalizeState(actor.getFlag(moduleId, "state")).existingCharacterHistory,
    "persisted existing-character history",
  );
  await waitForValue(
    () => app.element?.querySelector(".history-report") && app.element,
    "the rerendered existing-character report",
  );
  const after = equipmentSurface(app.element);
  const status = app.element?.querySelector(".status-note")?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  await app.close();
  return { before, after, history: structuredClone(history), status };
}

async function renderExistingImportAfterReload(modules, actor) {
  const app = await openConnectedWayfinderApp(modules, actor, "the reloaded existing-character");
  const report = await waitForValue(
    () => app.element?.querySelector(".history-report"),
    "the reloaded existing-character report",
  );
  const apply = app.element?.querySelector('[data-wayfinder-action="apply-draft"]') ?? null;
  const evidence = {
    equipment: equipmentSurface(app.element),
    historyVisible: report instanceof HTMLElement && report.isConnected,
    historyText: report.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    apply: {
      present: apply instanceof HTMLElement,
      enabled: apply instanceof HTMLButtonElement ? !apply.disabled : false,
    },
  };
  await app.close();
  return evidence;
}

function draftSelectionUuids(modules, actor, moduleId, targetLevel = 1) {
  const draft = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), targetLevel);
  return Object.fromEntries(
    Object.entries(draft.selections)
      .map(([slotId, value]) => [slotId, value.uuid])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function draftAlerts(app) {
  return [...(app.element?.querySelectorAll('[role="alert"], .status-note.error, [data-wayfinder-save-status][data-phase="error"]') ?? [])]
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .map((entry) => entry.textContent?.replace(/\s+/gu, " ").trim() ?? "")
    .filter(Boolean);
}

function interceptIntegrityNotifications() {
  const calls = [];
  const originals = {};
  for (const level of ["error", "warn"]) {
    const original = ui.notifications[level];
    originals[level] = original;
    ui.notifications[level] = function intercepted(message, ...args) {
      calls.push({ level, message: String(message ?? "") });
      return original.call(this, message, ...args);
    };
  }
  return {
    calls,
    restore() {
      for (const [level, original] of Object.entries(originals)) ui.notifications[level] = original;
    },
  };
}

function watchDraftSaveGeneration(app, label) {
  const root = app.element;
  if (!(root instanceof HTMLElement) || !root.isConnected) {
    throw new Error(`WF-080-51 cannot observe ${label} on a disconnected Wayfinder app.`);
  }
  let observedPhaseMutation = false;
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === "attributes" &&
          record.attributeName === "data-phase" &&
          record.target instanceof HTMLElement &&
          record.target.matches("[data-wayfinder-save-status]"),
      )
    ) {
      observedPhaseMutation = true;
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-phase"], subtree: true });
  return {
    disconnect: () => observer.disconnect(),
    wait: () =>
      waitForValue(
        () => {
          const status = app.element?.querySelector("[data-wayfinder-save-status]");
          return observedPhaseMutation && status?.dataset?.phase === "saved" ? status : null;
        },
        `${label} save generation`,
      ),
  };
}

async function manualSaveDraft(app) {
  const save = await waitForValue(
    () => app.element?.querySelector('[data-wayfinder-action="save-draft"]'),
    "the production Save Draft control",
  );
  if (!(save instanceof HTMLButtonElement) || save.disabled) {
    throw new Error("WF-080-51 production Save Draft control is unavailable.");
  }
  const generation = watchDraftSaveGeneration(app, "the manual draft save");
  try {
    save.click();
    await generation.wait();
  } finally {
    generation.disconnect();
  }
}

function connectedPickerSurface(app, stepId) {
  const results = app.element?.querySelector(
    `[data-application-part="picker-results"][data-step-id="${stepId}"]`,
  );
  return results instanceof HTMLElement && results.isConnected ? results : null;
}

async function activatePickerStep(app, stepId) {
  const previous = app.element?.querySelector('[data-application-part="picker-results"]') ?? null;
  const step = await waitForValue(
    () =>
      app.element?.querySelector(
        `[data-wayfinder-action="select-step"][data-step-id="${stepId}"]`,
      ),
    `the production ${stepId} step control`,
  );
  step.click();
  return waitForValue(
    () => {
      const results = connectedPickerSurface(app, stepId);
      const heading = app.element?.querySelector(`[data-wayfinder-step-heading="${stepId}"]`);
      return results && results !== previous && document.activeElement === heading ? results : null;
    },
    `the production ${stepId} picker render`,
  );
}

function pickerSurfaceDiagnostic(app) {
  const results = app.element?.querySelector('[data-application-part="picker-results"]');
  if (!(results instanceof HTMLElement)) return "picker=missing";
  const stepId = results.dataset.stepId ?? "<missing>";
  const query = results.dataset.wayfinderRenderedQuery ?? "<missing>";
  const viewRevision = results.dataset.wayfinderViewRevision ?? "<missing>";
  const sourceRevision = results.dataset.wayfinderSourceRevision ?? "<missing>";
  const resultCount = results.dataset.wayfinderResultCount ?? "<missing>";
  const options = [...results.querySelectorAll('[data-wayfinder-action="preview-option"]')].map((option) => ({
    value: option.dataset.value ?? "<missing>",
    name: option.querySelector(".option-name")?.textContent?.trim() ?? "<missing>",
  }));
  return `picker step=${stepId} query=${JSON.stringify(query)} view=${viewRevision} source=${sourceRevision} count=${resultCount} options=${JSON.stringify(options)}`;
}

function pickerValueFromUuid(uuid) {
  const match = /^Compendium\.(.+)\.Item\.([^.]+)$/u.exec(uuid);
  if (!match) throw new Error(`WF-080-51 cannot derive a picker value from ${uuid}.`);
  return `${match[1]}:${match[2]}`;
}

async function choosePickerOption(app, actor, modules, moduleId, uuid, query) {
  const pickerValue = pickerValueFromUuid(uuid);
  await activatePickerStep(app, ANCESTRY_STEP_ID);
  const search = await waitForValue(
    () => app.element?.querySelector(`input[data-wayfinder-search][data-step-id="${ANCESTRY_STEP_ID}"]`),
    "the production ancestry search input",
  );
  search.value = query;
  search.dispatchEvent(new Event("input", { bubbles: true }));
  let preview;
  try {
    preview = await waitForValue(
      () => {
        const settled = app.element?.querySelector(
          `[data-application-part="picker-results"][data-step-id="${ANCESTRY_STEP_ID}"][data-wayfinder-rendered-query="${query}"]`,
        );
        const candidate = settled?.querySelector(
          `[data-wayfinder-action="preview-option"][data-value="${pickerValue}"]`,
        );
        return settled?.isConnected && candidate?.isConnected ? candidate : null;
      },
      `the settled production picker option ${uuid}`,
    );
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} Observed ${pickerSurfaceDiagnostic(app)}.`, {
      cause: error,
    });
  }
  preview.click();
  const select = await waitForValue(
    () => app.element?.querySelector(`[data-wayfinder-action="select-option"][data-value="${pickerValue}"]`),
    `the production picker selection ${uuid}`,
  );
  const generation = watchDraftSaveGeneration(app, `the picker selection ${uuid}`);
  try {
    select.click();
    await waitForValue(
      () => draftSelectionUuids(modules, actor, moduleId)["ancestry-level-1"] === uuid,
      `the autosaved picker selection ${uuid}`,
    );
    await generation.wait();
  } finally {
    generation.disconnect();
  }
}

async function clearAncestryPickerOption(app, actor, modules, moduleId) {
  await activatePickerStep(app, ANCESTRY_STEP_ID);
  const clear = await waitForValue(
    () => app.element?.querySelector('[data-wayfinder-action="clear-option"][data-step-id="ancestry-level-1"]'),
    "the production ancestry clear control",
  );
  const generation = watchDraftSaveGeneration(app, "the ancestry clear");
  try {
    clear.click();
    await waitForValue(
      () => !Object.hasOwn(draftSelectionUuids(modules, actor, moduleId), "ancestry-level-1"),
      "the persisted ancestry-key deletion",
    );
    await generation.wait();
  } finally {
    generation.disconnect();
  }
}

async function exerciseDraftReplacementUi(modules, actor, moduleId) {
  const draft = modules.createEmptyDraft(1);
  draft.selections["background-level-1"] = selection(
    "background-level-1",
    ACOLYTE_UUID,
    "Acolyte",
    "background",
  );
  await actor.setFlag(moduleId, "draft", draft);
  const app = await openConnectedWayfinderApp(modules, actor, "the draft-replacement");
  const notifications = interceptIntegrityNotifications();
  try {
    const initial = draftSelectionUuids(modules, actor, moduleId);
    await choosePickerOption(app, actor, modules, moduleId, HUMAN_UUID, "Human");
    await manualSaveDraft(app);
    const chosen = draftSelectionUuids(modules, actor, moduleId);
    await clearAncestryPickerOption(app, actor, modules, moduleId);
    await manualSaveDraft(app);
    const cleared = draftSelectionUuids(modules, actor, moduleId);
    await choosePickerOption(app, actor, modules, moduleId, DWARF_UUID, "Dwarf");
    await manualSaveDraft(app);
    const replaced = draftSelectionUuids(modules, actor, moduleId);
    return { initial, chosen, cleared, replaced, alerts: draftAlerts(app), notifications: notifications.calls };
  } finally {
    notifications.restore();
    await app.close();
  }
}

async function verifyDraftReplacementAfterReload(modules, actor, moduleId) {
  const notifications = interceptIntegrityNotifications();
  let app = null;
  try {
    app = await openConnectedWayfinderApp(modules, actor, "the reloaded draft-replacement");
    await manualSaveDraft(app);
    const root = app.element;
    return {
      selections: draftSelectionUuids(modules, actor, moduleId),
      alerts: draftAlerts(app),
      notifications: notifications.calls,
      usable:
        root?.querySelector(".wayfinder-shell") instanceof HTMLElement &&
        root.querySelector('[data-wayfinder-action="save-draft"]') instanceof HTMLButtonElement,
    };
  } finally {
    notifications.restore();
    await app?.close();
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function selection(slotId, uuid, name, itemType, featType = null) {
  const parts = uuid.split(".");
  return {
    slotId,
    packId: parts[0] === "Compendium" && parts[1] && parts[2] ? `${parts[1]}.${parts[2]}` : "pf2e.unknown",
    documentId: parts.at(-1),
    uuid,
    itemType,
    featType,
    level: itemType === "feat" ? 1 : null,
    name,
  };
}

async function renderAttestationReceipt(modules, actor) {
  const app = await openConnectedWayfinderApp(modules, actor, "the attestation-receipt");
  const receipt = await waitForValue(
    () => app.element?.querySelector(".wayfinder-attestation-receipt"),
    "the attestation receipt",
  );
  const disclaimer = receipt?.querySelector(".attestation-disclaimer")?.textContent?.trim() ?? "";
  const definitionTerms = [...(receipt?.querySelectorAll("dt") ?? [])];
  const basisTerm = definitionTerms.find((entry) => entry.textContent?.trim() === "Claimed under") ?? null;
  const basisLabel = basisTerm?.nextElementSibling?.textContent?.trim() ?? "";
  const style = receipt ? getComputedStyle(receipt) : null;
  const evidence = {
    appId: app.id,
    visible:
      receipt instanceof HTMLElement &&
      receipt.isConnected &&
      style?.display !== "none" &&
      style?.visibility !== "hidden" &&
      receipt.getBoundingClientRect().width > 0 &&
      receipt.getBoundingClientRect().height > 0,
    ariaLabel: receipt?.getAttribute("aria-label") ?? "",
    disclaimer,
    basisLabel,
    text: receipt?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
  };
  await app.close();
  return evidence;
}

function spellStep() {
  const slotId = "spell-choice-wizard-spellbook-level-5";
  return {
    id: slotId,
    level: 5,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Wizard spellbook",
    description: "",
    required: true,
    slotId,
    filters: { itemType: "spell" },
    spellChoice: {
      slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "wizard-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
      sourceName: "Wizard Spellcasting",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "spellbook",
        key: "wizard-spellbook",
        label: "Wizard spellbook",
        entryName: "Wizard Spellcasting",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 1,
      minRank: 1,
      maxRank: 3,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

function recipeEvidence(policy) {
  return policy.resolvedRecipe.kind === "permanent-items"
    ? {
        kind: "permanent-items",
        currencyCopper: policy.budgetCopper,
        allowances: structuredClone(policy.allowances),
      }
    : { ...structuredClone(policy.resolvedRecipe), budgetCopper: policy.budgetCopper };
}

function investigatorSteps(modules) {
  return [
    {
      id: ANCESTRY_STEP_ID,
      level: 1,
      kind: "pick-item",
      slotKind: "ancestry",
      title: "Choose an ancestry",
      description: "",
      required: true,
      slotId: ANCESTRY_STEP_ID,
      filters: { itemType: "ancestry" },
    },
    {
      id: "class-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "class",
      title: "Choose a class",
      description: "",
      required: true,
      slotId: "class-level-1",
      filters: { itemType: "class" },
    },
    {
      id: "class-branch-methodology-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Methodology",
      description: "Choose an investigator methodology.",
      required: true,
      slotId: "class-branch-methodology-level-1",
      filters: { itemType: "feat", featTypes: ["classfeature"], maxLevel: 1 },
      branch: {
        slotId: "class-branch-methodology-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: METHODOLOGY_SELECTOR_UUID.split(".").at(-1),
        selectorUuid: METHODOLOGY_SELECTOR_UUID,
        selectorName: "Methodology",
        selectorRuleIndex: 0,
        flag: "methodology",
        optionTag: "investigator-methodology",
        classSlug: "investigator",
        dependsOn: "class",
      },
    },
    modules.createStep(1),
  ];
}

function actorItemsBySource(actor, sourceUuid) {
  return actor.items.filter((item) => (item.sourceId ?? item.flags?.core?.sourceId) === sourceUuid);
}

async function seedPassiveInvestigatorGrantParents(actor, moduleId) {
  const investigator = await fromUuid(INVESTIGATOR_UUID);
  const methodology = await fromUuid(METHODOLOGY_SELECTOR_UUID);
  if (!investigator || !methodology) {
    throw new Error("WF-080-51 Investigator native-grant parent sources are unavailable.");
  }
  const classSource = passiveExistingHistorySource(investigator, {
    uuid: INVESTIGATOR_UUID,
    name: "Investigator",
    type: "class",
  });
  classSource.flags[moduleId] = { ...(classSource.flags[moduleId] ?? {}), slotId: "class-level-1" };
  const [classItem] = await actor.createEmbeddedDocuments("Item", [classSource]);
  if (!classItem) throw new Error("WF-080-51 could not seed the passive Investigator parent.");

  const methodologySource = passiveExistingHistorySource(methodology, {
    uuid: METHODOLOGY_SELECTOR_UUID,
    name: "Methodology",
    type: "feat",
  });
  methodologySource.system.location = classItem.id;
  const [methodologyItem] = await actor.createEmbeddedDocuments("Item", [methodologySource]);
  if (!methodologyItem) throw new Error("WF-080-51 could not seed the passive Methodology parent.");
  return { classItemId: classItem.id, methodologyItemId: methodologyItem.id };
}

async function materializeInvestigatorFormulaBook({ actor, moduleId, modules }) {
  const projectionSteps = investigatorSteps(modules);
  const applySteps = projectionSteps.filter(
    (step) => step.id === "class-branch-methodology-level-1" || step.kind === "starting-equipment",
  );
  const draft = modules.createEmptyDraft(1);
  draft.selections[ANCESTRY_STEP_ID] = selection(ANCESTRY_STEP_ID, HUMAN_UUID, "Human", "ancestry");
  draft.selections["class-level-1"] = selection("class-level-1", INVESTIGATOR_UUID, "Investigator", "class");
  draft.branchSelections["class-branch-methodology-level-1"] = selection(
    "class-branch-methodology-level-1",
    METHODOLOGY_UUID,
    "Alchemical Sciences",
    "feat",
    "classfeature",
  );
  await seedPassiveInvestigatorGrantParents(actor, moduleId);
  await executeAndPersist(
    actor,
    draft,
    { type: "initialize", selectedRecipe: "permanent-items" },
    modules,
    moduleId,
    projectionSteps,
  );
  await executeAndPersist(actor, draft, { type: "retain-all" }, modules, moduleId, projectionSteps);
  const reviewed = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), 1);
  const runtime = modules.getRuntime();
  const classGrantPlan = await modules.prepareCurrentClassGrantPlan(actor, reviewed, projectionSteps, {
    fetchDocumentByUuid: (uuid) => fromUuid(uuid),
    resolveCharacterAccessRef: (sourceUuid) =>
      runtime.resolveCurrentCharacterAccessRef({
        actor,
        characterDraft: reviewed,
        acquisition: reviewed.acquisition,
        sourceUuid,
      }),
  });
  const applyWithSession = async ({ applyDraft, injectFinalGrantFailure }) => {
    const session = executionSession({ modules, runtime, actor, moduleId });
    let workingDraft = applyDraft;
    const checkpoints = [];
    let injected = false;
    try {
      const result = await modules.applyDraftLifecycle({
        actorName: actor.name,
        currentLevel: 1,
        draft: applyDraft,
        acquisitionExecutionAvailable: true,
        assertAcquisitionApplyAuthority: () =>
          modules.assertApplyAuthority({ actor, acquisition: applyDraft.acquisition, user: game.user }),
        steps: applySteps,
        evaluateStep: (step) => modules.evaluateWayfinderStep(step, applyDraft, new Set(), {}),
        confirmApply: async () => true,
        beforeApply: async (applyAttemptDraft) => actor.setFlag(moduleId, "draft", applyAttemptDraft),
        applyDraftToActor: (buildFinalActorUpdate) =>
          modules.applyDraftToActor(actor, applyDraft, applySteps, {
          resolveFinalActorUpdate: (evidence) =>
            buildFinalActorUpdate(modules.normalizeState(actor.getFlag(moduleId, "state")), evidence),
          beforeFinalActorUpdate: () => modules.assertCanUseWayfinder(actor),
          validateActorAuthority: modules.canUseWayfinder,
          assertAcquisitionApplyAuthority: (currentActor, currentDraft) =>
            modules.assertApplyAuthority({ actor: currentActor, acquisition: currentDraft.acquisition, user: game.user }),
          spellRarityCeiling: "common",
          validateSelectionEligibility: async (candidate) => Boolean(await fromUuid(candidate.uuid)),
          validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
          prepareClassGrantPlan: async () => classGrantPlan,
          executeAcquisitionItems: session.executeAcquisitionItems,
          executeAcquisitionCurrency: session.executeAcquisitionCurrency,
          verifyAcquisitionOutcome: session.verifyAcquisitionOutcome,
          readCurrentAcquisitionHistory: session.readCurrentAcquisitionHistory,
          persistAcquisitionCurrencyConvergenceWitness: async (witness) => {
            workingDraft = {
              ...workingDraft,
              acquisition: modules.recordCurrencyWitness(workingDraft.acquisition, witness),
            };
            await actor.setFlag(moduleId, "draft", workingDraft);
          },
            onCheckpoint: (checkpoint) => {
              checkpoints.push({
                checkpointId: checkpoint.checkpointId,
                phase: checkpoint.phase,
                operation: checkpoint.operation ?? null,
              });
              if (
                injectFinalGrantFailure &&
                !injected &&
                checkpoint.checkpointId === "phase:class-grant-reconcile-final:after"
              ) {
                injected = true;
                throw new Error("Intentional WF-080-51 Investigator native-grant retry failure.");
              }
            },
          }),
      });
      return { checkpoints, injected, result, workingDraft };
    } catch (error) {
      error.wf51Checkpoints = checkpoints;
      throw error;
    }
  };

  let firstFailure = null;
  try {
    await applyWithSession({ applyDraft: reviewed, injectFinalGrantFailure: true });
  } catch (error) {
    firstFailure = error;
  }
  const afterFailure = actorItemsBySource(actor, FORMULA_BOOK_UUID);
  const retryDraft = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), 1);
  const retry = await applyWithSession({ applyDraft: retryDraft, injectFinalGrantFailure: false });
  const afterRetry = actorItemsBySource(actor, FORMULA_BOOK_UUID);
  const methodologyItems = actorItemsBySource(actor, METHODOLOGY_UUID);
  const state = modules.normalizeState(actor.getFlag(moduleId, "state"));
  const manifest = state.completedAcquisitionManifest;
  const formula = afterRetry[0];
  const materializationDiagnostic = {
    firstFailure: firstFailure
      ? {
          message: firstFailure.message ?? String(firstFailure),
          phase: firstFailure.phase ?? null,
          failureKind: firstFailure.failureKind ?? null,
          checkpoint: firstFailure.checkpoint?.checkpointId ?? null,
          observedCheckpoints: (firstFailure.wf51Checkpoints ?? []).map((entry) => entry.checkpointId),
        }
      : null,
    retryKind: retry.result.kind,
    afterFailure: afterFailure.map((item) => item.id),
    afterRetry: afterRetry.map((item) => item.id),
    methodologyItems: methodologyItems.map((item) => item.id),
    formulaGrantedById: formula?.flags?.pf2e?.grantedBy?.id ?? null,
    acquisitionStamped: formula?.getFlag?.(moduleId, "acquisition") != null,
    manifestPresent: Boolean(manifest),
  };
  if (
    !firstFailure ||
    firstFailure.checkpoint?.checkpointId !== "phase:class-grant-reconcile-final:after" ||
    retry.result.kind !== "applied" ||
    afterFailure.length !== 1 ||
    afterRetry.length !== 1 ||
    afterFailure[0].id !== formula?.id ||
    methodologyItems.length !== 1 ||
    formula?.flags?.pf2e?.grantedBy?.id !== methodologyItems[0].id ||
    formula?.getFlag?.(moduleId, "acquisition") != null ||
    !manifest
  ) {
    throw new Error(
      `WF-080-51 Investigator Formula Book materialization or retry evidence is incomplete: ${JSON.stringify(materializationDiagnostic)}.`,
    );
  }
  const grant = manifest.classGrants.find(
    (entry) => entry.grant.grantId === "class-grant:investigator-formula-book:class-branch-methodology-level-1",
  );
  return {
    executor: userEvidence(),
    disposition: manifest.disposition,
    batchId: manifest.batchId,
    draftCleared: actor.getFlag(moduleId, "draft") == null,
    handoff: manifest.disposition === "handoff",
    forcedFailureCheckpoint: firstFailure.checkpoint.checkpointId,
    formulaBookIdsAfterFailure: afterFailure.map((item) => item.id),
    formulaBookIdsAfterRetry: afterRetry.map((item) => item.id),
    formulaBookCount: afterRetry.length,
    methodologyCount: methodologyItems.length,
    grantedById: formula.flags.pf2e.grantedBy.id,
    methodologyId: methodologyItems[0].id,
    acquisitionStampCount: afterRetry.filter((item) => item.getFlag?.(moduleId, "acquisition") != null).length,
    acquisitionItemWriteCount: [...(firstFailure.wf51Checkpoints ?? []), ...retry.checkpoints].filter(
      (checkpoint) => checkpoint.phase === "acquisition-items" && checkpoint.operation === "embedded-item-create",
    ).length,
    grant: structuredClone(grant),
    manifest: structuredClone(manifest),
    spentCopper: manifest.currency.spentCopper,
    remainingCopper: manifest.currency.remainingCopper,
    budgetCopper: manifest.currency.budgetCopper,
    observedCopper: manifest.currency.observedCopper,
    targetCopper: manifest.currency.targetCopper,
  };
}

function passiveExistingHistorySource(document, expected) {
  const source = document.toObject(false);
  delete source._id;
  source.flags = source.flags ?? {};
  source.flags.core = { ...(source.flags.core ?? {}), sourceId: expected.uuid };
  source._stats = { ...(source._stats ?? {}), compendiumSource: expected.uuid };
  source.system = source.system ?? {};
  source.system.rules = [];
  if (Object.hasOwn(source.system, "items")) source.system.items = {};
  if (expected.location) source.system.location = expected.location;
  return source;
}

function assertPassiveExistingHistoryItems(actor) {
  const observed = EXISTING_IMPORT_SOURCES.map((expected) => {
    const matches = actor.items.filter(
      (item) =>
        (item.sourceId ?? item.flags?.core?.sourceId) === expected.uuid &&
        item.name === expected.name &&
        item.type === expected.type,
    );
    const item = matches[0] ?? null;
    const location =
      typeof item?.system?.location === "string" ? item.system.location : (item?.system?.location?.value ?? null);
    if (matches.length !== 1 || (expected.location && location !== expected.location)) {
      throw new Error(`WF-080-51 existing-import passive source drifted: ${expected.uuid}.`);
    }
    return {
      historySlotId: expected.historySlotId,
      location: expected.location ?? null,
      name: item.name,
      type: item.type,
      uuid: item.sourceId ?? item.flags?.core?.sourceId,
    };
  });
  if (actor.items.size !== EXISTING_IMPORT_SOURCES.length) {
    throw new Error("WF-080-51 existing-import passive seed triggered unexpected PF2E item grants.");
  }
  return observed;
}

async function seedExistingImportActor(actor) {
  const itemSources = [];
  for (const expected of EXISTING_IMPORT_SOURCES) {
    const document = await fromUuid(expected.uuid);
    if (!document || document.name !== expected.name || document.type !== expected.type) {
      throw new Error(`WF-080-51 existing-import source drifted: ${expected.uuid}.`);
    }
    itemSources.push(passiveExistingHistorySource(document, expected));
  }
  await withTimeout(
    actor.createEmbeddedDocuments("Item", itemSources, { render: false }),
    "the passive existing-character history items",
    20_000,
  );
  await actor.update(
    {
      "system.details.level.value": EXISTING_IMPORT_LEVEL,
      "system.build.attributes.boosts": {
        1: ["str", "dex", "con", "int"],
        5: ["dex", "con", "wis", "cha"],
      },
    },
    { render: false },
  );
  const observedSources = assertPassiveExistingHistoryItems(actor);
  if (Number(actor.system?.details?.level?.value) !== EXISTING_IMPORT_LEVEL) {
    throw new Error("WF-080-51 existing-import actor did not prepare the pinned level-7 source documents.");
  }
  return observedSources;
}

function snapshotUser(user) {
  return {
    id: String(user?.id ?? ""),
    isGM: Boolean(user?.isGM),
    name: String(user?.name ?? ""),
    role: Number(user?.role ?? 0),
  };
}

function assertPriorActorsAbsent(priorActorIds) {
  const normalized = (Array.isArray(priorActorIds) ? priorActorIds : []).map(String);
  const remaining = normalized.filter((actorId) => game.actors.has(actorId));
  if (remaining.length > 0) {
    throw new Error(`WF-080-51 prior child cleanup left actors: ${remaining.join(", ")}.`);
  }
  return normalized;
}

function resolveBoundaryPlayer(playerName) {
  const matches = game.users.filter(
    (candidate) => candidate.name === playerName && !candidate.isGM && candidate.id !== game.user?.id,
  );
  if (matches.length !== 1) {
    throw new Error("WF-080-51 requires one exact configured non-GM player.");
  }
  return matches[0];
}

function captureWf51Boundary({
  abpSetting,
  expectedWorldId,
  judgmentSetting,
  moduleId,
  playerName,
  policySetting,
  priorActorIds = [],
  runId,
}) {
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-51 boundary capture requires a GM.");
  if (!runId) throw new Error("WF-080-51 boundary capture requires an exact run id.");
  const normalizedPriorActorIds = assertPriorActorsAbsent(priorActorIds);
  const player = resolveBoundaryPlayer(playerName);
  const snapshots = {
    moduleId,
    runId,
    worldId: game.world.id,
    gm: snapshotUser(game.user),
    player: snapshotUser(player),
    runtime: runtimeEvidence(moduleId),
    priorActorIds: normalizedPriorActorIds,
    policy: structuredClone(game.settings.get(moduleId, policySetting)),
    judgments: structuredClone(game.settings.get(moduleId, judgmentSetting)),
    abp: structuredClone(game.settings.get("pf2e", abpSetting)),
    actorCount: game.actors.size,
    actorIds: game.actors.map((actor) => actor.id).sort(),
  };
  return { ...snapshots, snapshots: structuredClone(snapshots) };
}

function normalizeWf51Boundary(value) {
  if (!value || typeof value !== "object") return null;
  return value.snapshots && typeof value.snapshots === "object" ? value.snapshots : value;
}

function validateWf51Boundary(value, payload) {
  const boundary = normalizeWf51Boundary(value);
  if (!boundary) {
    throw new Error("WF-080-51 prepare requires a captured pre-mutation boundary.");
  }
  assertWorld(payload.expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-51 boundary validation requires a GM.");
  const player = resolveBoundaryPlayer(payload.playerName);
  const currentActorIds = game.actors.map((actor) => actor.id).sort();
  const identityMatches =
    boundary.moduleId === payload.moduleId &&
    boundary.runId === payload.runId &&
    boundary.worldId === game.world.id &&
    canonicalJson(boundary.gm) === canonicalJson(snapshotUser(game.user)) &&
    canonicalJson(boundary.player) === canonicalJson(snapshotUser(player)) &&
    canonicalJson(boundary.runtime) === canonicalJson(runtimeEvidence(payload.moduleId)) &&
    canonicalJson(boundary.priorActorIds) === canonicalJson(assertPriorActorsAbsent(payload.priorActorIds)) &&
    canonicalJson(boundary.actorIds) === canonicalJson(currentActorIds) &&
    boundary.actorCount === game.actors.size &&
    canonicalJson(boundary.policy) ===
      canonicalJson(game.settings.get(payload.moduleId, payload.policySetting)) &&
    canonicalJson(boundary.judgments) ===
      canonicalJson(game.settings.get(payload.moduleId, payload.judgmentSetting)) &&
    canonicalJson(boundary.abp) === canonicalJson(game.settings.get("pf2e", payload.abpSetting));
  if (!identityMatches) {
    throw new Error("WF-080-51 captured boundary no longer matches the exact pre-mutation world state.");
  }
  return { boundary, player, snapshots: structuredClone(boundary) };
}

function exactRunActors(moduleId, runId, fixturePrefix = "") {
  return game.actors.filter((actor) => {
    const moduleMarker = actor.getFlag(moduleId, "smokeWf51Overlay");
    const pf2eMarker = actor.getFlag("pf2e", "wf51OverlaySentinel");
    return (
      moduleMarker?.purpose === WF51_PURPOSE &&
      moduleMarker?.runId === runId &&
      pf2eMarker?.purpose === WF51_PURPOSE &&
      pf2eMarker?.runId === runId &&
      (!fixturePrefix || actor.name.startsWith(`${fixturePrefix} - ${runId} - `))
    );
  });
}

async function recoverWf51Boundary({
  abpSetting,
  allowDestructive,
  expectedWorldId,
  fixturePrefix = "",
  judgmentSetting,
  markerPurpose,
  moduleId,
  policySetting,
  runId,
  snapshots: suppliedSnapshots,
}) {
  if (!allowDestructive) throw new Error("WF-080-51 recovery requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-51 recovery requires a GM.");
  if (markerPurpose !== WF51_PURPOSE) {
    throw new Error("WF-080-51 recovery refused a changed marker purpose.");
  }
  const boundary = normalizeWf51Boundary(suppliedSnapshots);
  if (
    !boundary ||
    boundary.moduleId !== moduleId ||
    boundary.runId !== runId ||
    boundary.worldId !== game.world.id ||
    canonicalJson(boundary.gm) !== canonicalJson(snapshotUser(game.user))
  ) {
    throw new Error("WF-080-51 recovery refused a boundary with changed guarded identity.");
  }
  const boundaryPlayer = game.users.get(boundary.player?.id);
  if (canonicalJson(boundary.player) !== canonicalJson(snapshotUser(boundaryPlayer)) || boundaryPlayer?.isGM) {
    throw new Error("WF-080-51 recovery refused a changed configured player.");
  }
  const restorationFailures = [];
  const actors = exactRunActors(moduleId, runId, fixturePrefix);
  let actorsDeleted = 0;
  for (const actor of actors) {
    try {
      await actor.delete();
      actorsDeleted += 1;
    } catch (error) {
      restorationFailures.push(`actor ${actor.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const [scope, key, value] of [
    [moduleId, judgmentSetting, boundary.judgments],
    [moduleId, policySetting, boundary.policy],
    ["pf2e", abpSetting, boundary.abp],
  ]) {
    try {
      await game.settings.set(scope, key, value);
    } catch (error) {
      restorationFailures.push(`${scope}.${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    attempted: true,
    actorsDeleted,
    actorsMissingAfterCleanup: exactRunActors(moduleId, runId, fixturePrefix).length === 0,
    actorCountRestored: game.actors.size === boundary.actorCount,
    actorIdsRestored:
      canonicalJson(game.actors.map((actor) => actor.id).sort()) === canonicalJson(boundary.actorIds),
    policyRestored:
      canonicalJson(game.settings.get(moduleId, policySetting)) === canonicalJson(boundary.policy),
    judgmentsRestored:
      canonicalJson(game.settings.get(moduleId, judgmentSetting)) === canonicalJson(boundary.judgments),
    abpRestored: canonicalJson(game.settings.get("pf2e", abpSetting)) === canonicalJson(boundary.abp),
    restorationFailures,
  };
}

globalThis.__captureWf51ReleaseOverlayBoundary = async function captureBoundary(payload) {
  return captureWf51Boundary(payload);
};

globalThis.__recoverWf51ReleaseOverlay = async function recover(payload) {
  return recoverWf51Boundary(payload);
};

globalThis.__prepareWf51ReleaseOverlay = async function prepare({
  abpSetting,
  allowDestructive,
  boundary,
  cases,
  expectedWorldId,
  fixturePrefix,
  judgmentSetting,
  moduleId,
  playerName,
  policySetting,
  priorActorIds,
  runId,
  snapshots: suppliedSnapshots,
}) {
  if (!allowDestructive) throw new Error("WF-080-51 setup requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-51 setup requires a GM.");
  const validatedBoundary = validateWf51Boundary(suppliedSnapshots ?? boundary, {
    abpSetting,
    expectedWorldId,
    judgmentSetting,
    moduleId,
    playerName,
    policySetting,
    priorActorIds,
    runId,
  });
  const { player, snapshots } = validatedBoundary;
  const guardedPolicy = {
    ...snapshots.policy,
    version: 1,
    enabledRecipes: ["permanent-items", "lump-sum"],
    defaultRecipe: "permanent-items",
    recipeChoiceAuthority: "actor-owner",
    higherLevelStartAuthority: "gm-confirmation",
    blanketRarity: "common",
    allowedEquipmentPackFamilies: ["pf2e"],
    applyAuthority: "actor-owner",
    recipeDecision: {
      version: 1,
      configuredBy: { userId: game.user.id, userName: game.user.name },
      configuredAt: new Date().toISOString(),
    },
  };
  const dagger = await fromUuid(DAGGER_UUID);
  if (!dagger) throw new Error("WF-080-51 could not resolve the exact foreign Dagger fixture.");
  const fixtures = [];
  let existingImportSources;
  try {
    await game.settings.set(moduleId, policySetting, guardedPolicy);
    for (const definition of cases) {
      for (let ordinal = 0; ordinal < definition.actorCount; ordinal += 1) {
        const fixtureName = `${fixturePrefix} - ${runId} - ${definition.id} - ${ordinal}`;
        const actor = await Actor.create({
          name: fixtureName,
          type: "character",
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
          system: { details: { level: { value: definition.targetLevel } } },
          flags: {
            [moduleId]: {
              smokeWf51Overlay: {
                purpose: WF51_PURPOSE,
                runId,
                caseId: definition.id,
                definitionFingerprint: definition.definitionFingerprint,
                ordinal,
              },
            },
            pf2e: {
              wf51OverlaySentinel: {
                purpose: WF51_PURPOSE,
                runId,
                caseId: definition.id,
                ordinal,
              },
            },
          },
        });
        if (!actor) throw new Error(`WF-080-51 could not create ${definition.id}/${ordinal}.`);
        fixtures.push({
          actorId: actor.id,
          caseId: definition.id,
          definitionFingerprint: definition.definitionFingerprint,
          fixtureName,
          ordinal,
        });
      }
    }
    const itemActor = fixtureActor(fixtures, "foreign-economic-handoffs", moduleId, runId, 0);
    const currencyActor = fixtureActor(fixtures, "foreign-economic-handoffs", moduleId, runId, 1);
    const existingImportActor = fixtureActor(fixtures, "higher-level-start-boundary", moduleId, runId, 1);
    const source = dagger.toObject(false);
    delete source._id;
    await itemActor.createEmbeddedDocuments("Item", [source], { render: false });
    await currencyActor.inventory.addCoins({ cp: 25 });
    existingImportSources = await seedExistingImportActor(existingImportActor);
  } catch (error) {
    const recovery = await recoverWf51Boundary({
      abpSetting,
      allowDestructive,
      expectedWorldId,
      fixturePrefix,
      judgmentSetting,
      markerPurpose: WF51_PURPOSE,
      moduleId,
      policySetting,
      runId,
      snapshots,
    }).catch((recoveryError) => ({
      restorationFailures: [recoveryError instanceof Error ? recoveryError.message : String(recoveryError)],
    }));
    const cleanupFailures = recovery.restorationFailures ?? [];
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${cleanupFailures.length > 0 ? ` Setup cleanup failures: ${cleanupFailures.join("; ")}` : ""}`, {
      cause: error,
    });
  }
  return {
    fixtures,
    boundary: snapshots,
    existingImportSources,
    gm: userEvidence(),
    playerId: player.id,
    priorActorCleanup: {
      actorIdsChecked: priorActorIds.length,
      allMissing: true,
    },
    runtime: runtimeEvidence(moduleId),
    snapshots,
  };
};

globalThis.__runWf51PlayerInitial = async function playerInitial({
  expectedUserId,
  expectedWorldId,
  fixtures,
  judgmentSetting,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadModules(moduleId);
  const startActor = fixtureActor(fixtures, "higher-level-start-boundary", moduleId, runId);
  const startDraft = modules.createEmptyDraft(5);
  await executeAndPersist(startActor, startDraft, { type: "initialize", selectedRecipe: "permanent-items" }, modules, moduleId);
  await executeAndPersist(
    startActor,
    startDraft,
    { type: "request-higher-level-start", startKind: "replacement-character", reason: `WF-080-51 ${runId}` },
    modules,
    moduleId,
  );
  const request = startDraft.equipmentPolicyRequests.find((entry) => entry.facts.kind === "higher-level-start");
  if (!request) throw new Error("WF-080-51 player start request is missing.");
  const beforeUnauthorized = {
    actor: snapshotActor(startActor),
    judgments: canonicalJson(game.settings.get(moduleId, judgmentSetting)),
  };
  let denial = "";
  try {
    await modules.execute(
      { type: "approve-policy-request", requestId: request.requestId, reason: "unauthorized" },
      {
        actor: startActor,
        draft: startDraft,
        moduleState: modules.normalizeState(startActor.getFlag(moduleId, "state")),
        steps: [modules.createStep(5)],
        userId: game.user.id,
        user: game.user,
        now: () => new Date().toISOString(),
      },
    );
  } catch (error) {
    denial = error instanceof Error ? error.message : String(error);
  }
  const afterUnauthorized = {
    actor: snapshotActor(startActor),
    judgments: canonicalJson(game.settings.get(moduleId, judgmentSetting)),
  };

  const existingImportActor = fixtureActor(fixtures, "higher-level-start-boundary", moduleId, runId, 1);
  const existingImportDraft = modules.createEmptyDraft(EXISTING_IMPORT_LEVEL);
  existingImportDraft.selections["ancestry-level-1"] = selection(
    "ancestry-level-1",
    HUMAN_UUID,
    "Human",
    "ancestry",
  );
  await executeAndPersist(
    existingImportActor,
    existingImportDraft,
    { type: "initialize", selectedRecipe: "permanent-items" },
    modules,
    moduleId,
  );
  await executeAndPersist(
    existingImportActor,
    existingImportDraft,
    { type: "request-higher-level-start", startKind: "replacement-character", reason: `WF-080-51 import ${runId}` },
    modules,
    moduleId,
  );
  const importBefore = {
    draft: acquisitionMaterial(modules.normalizeDraft(existingImportActor.getFlag(moduleId, "draft"), EXISTING_IMPORT_LEVEL)),
    economic: snapshotEconomic(modules, existingImportActor),
    items: snapshotItems(existingImportActor),
    manifest: structuredClone(modules.normalizeState(existingImportActor.getFlag(moduleId, "state")).completedAcquisitionManifest),
    unrelatedFlags: snapshotUnrelatedFlags(existingImportActor, moduleId, runId, "higher-level-start-boundary", 1),
  };
  const importedUi = await importExistingHistoryThroughUi(modules, existingImportActor, moduleId);
  const importedState = modules.normalizeState(existingImportActor.getFlag(moduleId, "state"));
  const importAfterDraft = modules.normalizeDraft(
    existingImportActor.getFlag(moduleId, "draft"),
    EXISTING_IMPORT_LEVEL,
  );
  const importAfter = {
    draft: acquisitionMaterial(importAfterDraft),
    economic: snapshotEconomic(modules, existingImportActor),
    items: snapshotItems(existingImportActor),
    manifest: structuredClone(importedState.completedAcquisitionManifest),
    unrelatedFlags: snapshotUnrelatedFlags(existingImportActor, moduleId, runId, "higher-level-start-boundary", 1),
  };

  const draftReplacementActor = fixtureActor(fixtures, "draft-replacement-semantics", moduleId, runId);
  const draftReplacementBefore = {
    economic: snapshotEconomic(modules, draftReplacementActor),
    items: snapshotItems(draftReplacementActor),
    unrelatedFlags: snapshotUnrelatedFlags(draftReplacementActor, moduleId, runId, "draft-replacement-semantics", 0),
  };
  const draftReplacementUi = await exerciseDraftReplacementUi(modules, draftReplacementActor, moduleId);
  const draftReplacementAfter = {
    economic: snapshotEconomic(modules, draftReplacementActor),
    items: snapshotItems(draftReplacementActor),
    unrelatedFlags: snapshotUnrelatedFlags(draftReplacementActor, moduleId, runId, "draft-replacement-semantics", 0),
  };

  const handoffs = {};
  for (const [key, ordinal] of [
    ["item", 0],
    ["currency", 1],
  ]) {
    const actor = fixtureActor(fixtures, "foreign-economic-handoffs", moduleId, runId, ordinal);
    const handoffDraft = modules.createEmptyDraft(1);
    await executeAndPersist(actor, handoffDraft, { type: "initialize", selectedRecipe: "permanent-items" }, modules, moduleId);
    const admission = handoffDraft.acquisition?.disposition;
    if (admission?.kind !== "handoff") throw new Error(`WF-080-51 ${key} fixture did not enter handoff.`);
    await executeAndPersist(actor, handoffDraft, { type: "acknowledge-handoff" }, modules, moduleId);
    const acquisition = handoffDraft.acquisition;
    const plan = emptyPlan(modules, actor, acquisition.draftId, acquisition.batchId, 1);
    const writeAttempts = [];
    const session = executionSession({
      modules,
      runtime: modules.getRuntime(),
      actor,
      moduleId,
      inventory: {
        add: async () => {
          writeAttempts.push("item");
          throw new Error("WF-080-51 handoff reached an item write.");
        },
        addCurrency: async () => {
          writeAttempts.push("currency-add");
          throw new Error("WF-080-51 handoff reached a currency write.");
        },
        removeCurrency: async () => {
          writeAttempts.push("currency-remove");
          throw new Error("WF-080-51 handoff reached a currency write.");
        },
      },
    });
    const before = snapshotActor(actor);
    await session.executeAcquisitionItems({
      actor,
      draft: handoffDraft,
      classGrantPlan: plan,
      emitWriteCheckpoint: async () => undefined,
    });
    await session.executeAcquisitionCurrency({
      actor,
      draft: handoffDraft,
      classGrantPlan: plan,
      emitWriteCheckpoint: async () => undefined,
      persistCurrencyConvergenceWitness: async () => undefined,
    });
    handoffs[key] = {
      subject: { actorId: actor.id, draftId: acquisition.draftId, batchId: acquisition.batchId, targetLevel: 1 },
      baseline: structuredClone(modules.captureBaseline(actor)),
      admission: structuredClone({ kind: admission.kind, handoff: admission.handoff }),
      acknowledgedByUserId: acquisition.disposition.acknowledgedByUserId,
      execution: { itemsCompleted: true, currencyCompleted: true, writeAttempts },
      unchanged: before === snapshotActor(actor),
    };
  }

  const trustActor = fixtureActor(fixtures, "abp-and-spell-trust", moduleId, runId);
  const trustDraft = modules.createEmptyDraft(5);
  const step = spellStep();
  trustDraft.spellRarityAttestations[step.slotId] = modules.createSpellAttestation({
    actorId: trustActor.id,
    step,
    targetLevel: 5,
    worldRarityCeiling: "common",
    claimedBasis: "reported-gm-permission",
    reason: "The player reports campaign permission for this restricted spell.",
    authorUserId: game.user.id,
    authorName: game.user.name,
    attestedAt: new Date().toISOString(),
  });
  trustDraft.spellChoices[step.slotId] = [
    selection(step.slotId, MIND_READING_UUID, "Mind Reading", "spell"),
  ];
  await trustActor.setFlag(moduleId, "draft", trustDraft);
  const appliedAttestations = modules.buildAppliedSpellAttestations(trustActor.id, trustDraft, [step], "common");
  const reviewLines = modules.buildSpellReviewLines(appliedAttestations);
  const priorTrustState = modules.normalizeState(trustActor.getFlag(moduleId, "state"));
  const applyResult = await modules.applyDraftLifecycle({
    actorName: trustActor.name,
    currentLevel: 5,
    draft: trustDraft,
    existingCompletedStepIds: priorTrustState.completedStepIds,
    existingCharacterHistory: priorTrustState.existingCharacterHistory,
    appliedSpellRarityAttestations: appliedAttestations,
    reviewLines,
    steps: [step],
    evaluateStep: (currentStep) => modules.evaluateWayfinderStep(currentStep, trustDraft, new Set(), {}),
    confirmApply: async () => true,
    beforeApply: async (applyAttemptDraft) => {
      modules.assertCanUseWayfinder(trustActor);
      await trustActor.setFlag(moduleId, "draft", applyAttemptDraft);
    },
    applyDraftToActor: (buildFinalActorUpdate) =>
      modules.applyDraftToActor(trustActor, trustDraft, [step], {
        resolveFinalActorUpdate: (evidence) =>
          buildFinalActorUpdate(modules.normalizeState(trustActor.getFlag(moduleId, "state")), evidence),
        beforeFinalActorUpdate: () => modules.assertCanUseWayfinder(trustActor),
        validateActorAuthority: modules.canUseWayfinder,
        spellRarityCeiling: "common",
        validateSelectionEligibility: async (candidate) => Boolean(await fromUuid(candidate.uuid)),
        validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
      }),
  });
  const appliedTrustState = modules.normalizeState(trustActor.getFlag(moduleId, "state"));
  if (
    applyResult.kind !== "applied" ||
    trustActor.getFlag(moduleId, "draft") != null ||
    appliedTrustState.lastAppliedSpellRarityAttestations.length !== 1 ||
    appliedTrustState.lastAppliedSpellRarityAttestations[0].authorUserId !== game.user.id
  ) {
    throw new Error("WF-080-51 spell attestation did not persist through Apply and draft clearing.");
  }
  const investigatorActor = fixtureActor(fixtures, "planned-grant-routes", moduleId, runId, 0);
  const investigatorMaterialization = await materializeInvestigatorFormulaBook({
    actor: investigatorActor,
    moduleId,
    modules,
  });
  return {
    player: userEvidence(),
    start: {
      request: structuredClone(request),
      unauthorizedApproval: {
        denied: /gm/i.test(denial),
        message: denial,
        unchanged: canonicalJson(beforeUnauthorized) === canonicalJson(afterUnauthorized),
      },
      existingImport: {
        subject: {
          actorId: existingImportActor.id,
          actorLevel: Number(existingImportActor.system?.details?.level?.value),
        },
        expectedSources: EXISTING_IMPORT_SOURCES.map((entry) => ({
          historySlotId: entry.historySlotId,
          location: entry.location ?? null,
          name: entry.name,
          type: entry.type,
          uuid: entry.uuid,
        })),
        before: importBefore,
        after: importAfter,
        ui: importedUi,
      },
    },
    draftReplacement: {
      subject: { actorId: draftReplacementActor.id, targetLevel: 1 },
      before: draftReplacementBefore,
      after: draftReplacementAfter,
      ui: draftReplacementUi,
    },
    handoffs,
    trustApply: {
      kind: applyResult.kind,
      draftCleared: trustActor.getFlag(moduleId, "draft") == null,
      persistedAttestationCount: appliedTrustState.lastAppliedSpellRarityAttestations.length,
    },
    investigatorMaterialization,
  };
};

globalThis.__runWf51GmPhase = async function gmPhase({
  abpSetting,
  cases,
  expectedUserId,
  expectedWorldId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, true);
  const modules = await loadModules(moduleId);
  const startActor = fixtureActor(fixtures, "higher-level-start-boundary", moduleId, runId);
  const startDraft = modules.normalizeDraft(startActor.getFlag(moduleId, "draft"), 5);
  const request = startDraft.equipmentPolicyRequests.find((entry) => entry.facts.kind === "higher-level-start");
  if (!request) throw new Error("WF-080-51 GM could not resolve the start request.");
  await executeAndPersist(
    startActor,
    startDraft,
    { type: "approve-policy-request", requestId: request.requestId, reason: `WF-080-51 approved ${runId}` },
    modules,
    moduleId,
  );
  const approval = startDraft.acquisition?.policySnapshot?.material?.gmJudgments.find(
    (entry) => entry.kind === "higher-level-start",
  );
  if (!approval) throw new Error("WF-080-51 GM approval did not become durable policy evidence.");

  await game.settings.set("pf2e", abpSetting, cases.find((entry) => entry.id === "abp-and-spell-trust").abpMode);
  const trustActor = fixtureActor(fixtures, "abp-and-spell-trust", moduleId, runId);
  const worldAbp = modules.resolveActorAbpSnapshot(trustActor);
  await trustActor.update({ "flags.pf2e.disableABP": true }, { render: false });
  const actorOverride = modules.resolveActorAbpSnapshot(trustActor);
  const trustState = modules.normalizeState(trustActor.getFlag(moduleId, "state"));
  const reviewedAttestations = trustState.lastAppliedSpellRarityAttestations;
  const reviewLines = modules.buildSpellReviewLines(reviewedAttestations);
  if (!reviewedAttestations[0] || !reviewLines[0]) {
    throw new Error("WF-080-51 GM review could not see the player's spell attestation.");
  }
  const gmReceiptDom = await renderAttestationReceipt(modules, trustActor);

  const driftActor = fixtureActor(fixtures, "material-drift-zero-write", moduleId, runId);
  const driftDraft = modules.createEmptyDraft(1);
  driftDraft.selections[ANCESTRY_STEP_ID] = selection(ANCESTRY_STEP_ID, HUMAN_UUID, "Human", "ancestry");
  await executeAndPersist(driftActor, driftDraft, { type: "initialize", selectedRecipe: "lump-sum" }, modules, moduleId);
  const driftRuntime = modules.getRuntime();
  const preparedDriftLine = await driftRuntime.uiAdapter.prepareLine({
    actor: driftActor,
    draft: driftDraft,
    step: modules.createStep(1),
    query: "",
    filters: {},
    previewSourceUuid: null,
    funding: { lane: "currency" },
    sourceUuid: DAGGER_UUID,
  });
  await executeAndPersist(driftActor, driftDraft, { type: "add-line", line: preparedDriftLine }, modules, moduleId);
  await executeAndPersist(driftActor, driftDraft, { type: "review-purchases" }, modules, moduleId);
  const reviewedDriftDraft = modules.normalizeDraft(driftActor.getFlag(moduleId, "draft"), 1);
  const driftAcquisition = reviewedDriftDraft.acquisition;
  const driftPlan = emptyPlan(
    modules,
    driftActor,
    driftAcquisition.draftId,
    driftAcquisition.batchId,
    driftAcquisition.targetLevel,
  );
  const writeAttempts = [];
  const guardedInventory = {
    add: async () => {
      writeAttempts.push("item");
      throw new Error("WF-080-51 drift guard reached an item write.");
    },
    addCurrency: async () => {
      writeAttempts.push("currency-add");
      throw new Error("WF-080-51 drift guard reached a currency write.");
    },
    removeCurrency: async () => {
      writeAttempts.push("currency-remove");
      throw new Error("WF-080-51 drift guard reached a currency write.");
    },
  };
  const beforeDrift = snapshotEconomic(modules, driftActor);
  const runDrift = async (options) => {
    const session = executionSession({
      modules,
      runtime: driftRuntime,
      actor: driftActor,
      moduleId,
      inventory: guardedInventory,
      ...options,
    });
    try {
      await session.executeAcquisitionItems({
        actor: driftActor,
        draft: reviewedDriftDraft,
        classGrantPlan: driftPlan,
        emitWriteCheckpoint: async () => undefined,
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const failures = {
    policy: await runDrift({
      transformPolicy: (current) => ({
        ...current,
        material: { ...current.material, budgetCopper: current.material.budgetCopper + 1 },
      }),
    }),
    price: await runDrift({
      transformSource: (resolved) => ({ ...resolved, priceFingerprint: `${resolved.priceFingerprint}:wf51-drift` }),
    }),
    baseline: "",
  };
  let injectedBaselineCopper = false;
  try {
    failures.baseline = await runDrift({
      afterSourceHealth: async () => {
        await driftActor.inventory.addCoins({ cp: 1 });
        injectedBaselineCopper = true;
      },
    });
  } finally {
    if (injectedBaselineCopper) await driftActor.inventory.removeCoins({ cp: 1 });
  }
  const reasons = [
    ...(/policy differs/i.test(failures.policy) ? ["policy"] : []),
    ...(/price drifted/i.test(failures.price) ? ["price"] : []),
    ...(/wealth changed/i.test(failures.baseline) ? ["baseline"] : []),
  ];

  const grantActor = fixtureActor(fixtures, "planned-grant-routes", moduleId, runId, 1);
  const grants = await collectGrantEvidence({ modules, actor: grantActor, moduleId });
  return {
    gm: userEvidence(),
    approval: {
      ...structuredClone(approval),
      authorIsGm: game.users.get(approval.authorUserId)?.isGM === true,
    },
    abp: { world: structuredClone(worldAbp), actorOverride: structuredClone(actorOverride) },
    spellReview: {
      reviewedByUserId: game.user.id,
      reviewedByIsGm: game.user.isGM === true,
      attestation: structuredClone(reviewedAttestations[0]),
      reviewLine: reviewLines[0],
      receiptDom: gmReceiptDom,
    },
    drift: {
      reasons,
      failures,
      writeAttempts: writeAttempts.length,
      unchanged: beforeDrift === snapshotEconomic(modules, driftActor),
      subject: {
        draftId: driftDraft.acquisition.draftId,
        batchId: driftDraft.acquisition.batchId,
        lineId: preparedDriftLine.lineId,
        policyFingerprint: driftDraft.acquisition.policySnapshot.fingerprint,
        documentFingerprint: preparedDriftLine.documentFingerprint,
        priceFingerprint: preparedDriftLine.priceFingerprint,
      },
    },
    grants,
  };
};

globalThis.__runWf51PlayerVerification = async function playerVerification({
  expectedUserId,
  expectedWorldId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadModules(moduleId);
  const startActor = fixtureActor(fixtures, "higher-level-start-boundary", moduleId, runId);
  const startDraft = modules.normalizeDraft(startActor.getFlag(moduleId, "draft"), 5);
  const acquisition = startDraft.acquisition;
  const policy = acquisition?.policySnapshot?.material;
  if (!acquisition || !policy) throw new Error("WF-080-51 approved start policy is missing after role reload.");
  const plan = emptyPlan(modules, startActor, acquisition.draftId, acquisition.batchId, 5);
  const approvedAdmission = modules.evaluateAdmission({
    actor: startActor,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: 5,
    higherLevelStartEvidence: policy.higherLevelStartEvidence,
    history: history(),
    preparedClassGrantPlan: plan,
    classGrantPhase: "before-acquisition",
  });
  const progressionAdmission = modules.evaluateAdmission({
    actor: startActor,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: 5,
    higherLevelStartEvidence: policy.higherLevelStartEvidence,
    history: history(1),
    preparedClassGrantPlan: plan,
    classGrantPhase: "before-acquisition",
  });

  const existingImportActor = fixtureActor(fixtures, "higher-level-start-boundary", moduleId, runId, 1);
  const existingImportState = modules.normalizeState(existingImportActor.getFlag(moduleId, "state"));
  const existingImportDraft = modules.normalizeDraft(
    existingImportActor.getFlag(moduleId, "draft"),
    EXISTING_IMPORT_LEVEL,
  );
  const existingImportReload = {
    subject: {
      actorId: existingImportActor.id,
      actorLevel: Number(existingImportActor.system?.details?.level?.value),
    },
    draft: acquisitionMaterial(existingImportDraft),
    economic: snapshotEconomic(modules, existingImportActor),
    items: snapshotItems(existingImportActor),
    manifest: structuredClone(existingImportState.completedAcquisitionManifest),
    history: structuredClone(existingImportState.existingCharacterHistory),
    unrelatedFlags: snapshotUnrelatedFlags(existingImportActor, moduleId, runId, "higher-level-start-boundary", 1),
    ui: await renderExistingImportAfterReload(modules, existingImportActor),
  };
  const draftReplacementActor = fixtureActor(fixtures, "draft-replacement-semantics", moduleId, runId);
  const draftReplacementReload = {
    subject: { actorId: draftReplacementActor.id, targetLevel: 1 },
    economic: snapshotEconomic(modules, draftReplacementActor),
    items: snapshotItems(draftReplacementActor),
    unrelatedFlags: snapshotUnrelatedFlags(draftReplacementActor, moduleId, runId, "draft-replacement-semantics", 0),
    ui: await verifyDraftReplacementAfterReload(modules, draftReplacementActor, moduleId),
  };

  const trustActor = fixtureActor(fixtures, "abp-and-spell-trust", moduleId, runId);
  const trustState = modules.normalizeState(trustActor.getFlag(moduleId, "state"));
  const applied = trustState.lastAppliedSpellRarityAttestations;
  const reviewLines = modules.buildSpellReviewLines(applied);
  const attestation = applied[0];
  if (!attestation || !reviewLines[0]) throw new Error("WF-080-51 spell attestation did not survive reload.");
  const receiptDom = await renderAttestationReceipt(modules, trustActor);
  const grantActor = fixtureActor(fixtures, "planned-grant-routes", moduleId, runId, 1);
  const grantState = modules.normalizeState(grantActor.getFlag(moduleId, "state"));
  const durableManifest = grantState.completedAcquisitionManifest;
  const grantCurrency = Number(grantActor.inventory?.currency?.copperValue ?? 0);
  return {
    player: userEvidence(),
    start: {
      approvedAdmission,
      progressionAdmission,
      recipe: recipeEvidence(policy),
      subject: {
        actorId: startActor.id,
        draftId: acquisition.draftId,
        batchId: acquisition.batchId,
      },
      recipeSelection: structuredClone(acquisition.recipeSelection),
      higherLevelStartEvidence: structuredClone(policy.higherLevelStartEvidence),
      existingImportReload,
    },
    trust: {
      spellAttestation: structuredClone(attestation),
      reviewLine: reviewLines[0],
      receiptDom,
      draftCleared: trustActor.getFlag(moduleId, "draft") == null,
      persistedAttestationCount: applied.length,
    },
    draftReplacementReload,
    grantsDurability: {
      draftCleared: grantActor.getFlag(moduleId, "draft") == null,
      manifestCorrupt: grantState.completedAcquisitionManifestCorrupt,
      manifest: structuredClone(durableManifest),
      observedCurrencyCopper: grantCurrency,
      itemIds: (durableManifest?.entries ?? []).flatMap((entry) => entry.observedItems?.map((item) => item.actualItemId) ?? []).sort(),
    },
  };
};

globalThis.__collectWf51ServedModuleFiles = async function collectServed({ moduleId, paths }) {
  const module = game.modules.get(moduleId);
  if (!module?.active) throw new Error(`${moduleId} is not active.`);
  const normalizedPaths = (Array.isArray(paths) ? paths : [])
    .map((entry) => String(entry).replace(/^\/+|^modules\/[^/]+\//gu, ""))
    .filter((entry, index, values) => entry && values.indexOf(entry) === index)
    .sort();
  if (!normalizedPaths.includes("module.json") || !normalizedPaths.some((entry) => entry.startsWith("scripts/") && entry.endsWith(".js"))) {
    throw new Error("WF-080-51 candidate module-file list is incomplete.");
  }
  const files = [];
  for (const path of normalizedPaths) {
    const response = await fetch(`/modules/${moduleId}/${path}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`WF-080-51 could not fetch served module file ${path}: ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    files.push({ path, bytes: bytes.byteLength, sha256: hex(digest) });
  }
  return files;
};

globalThis.__cleanupWf51ReleaseOverlay = async function cleanup({
  abpSetting,
  allowDestructive,
  expectedWorldId,
  fixtures,
  judgmentSetting,
  moduleId,
  policySetting,
  runId,
  snapshots,
}) {
  const restorationFailures = [];
  const result = {
    attempted: true,
    actorsDeleted: 0,
    actorsMissingAfterCleanup: false,
    actorCountRestored: false,
    policyRestored: false,
    judgmentsRestored: false,
    abpRestored: false,
    restorationFailures,
  };
  if (!allowDestructive) throw new Error("WF-080-51 cleanup requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-51 cleanup requires a GM.");
  for (const [scope, key, value] of [
    [moduleId, judgmentSetting, snapshots.judgments],
    [moduleId, policySetting, snapshots.policy],
    ["pf2e", abpSetting, snapshots.abp],
  ]) {
    try {
      await game.settings.set(scope, key, value);
    } catch (error) {
      restorationFailures.push(`${scope}.${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const fixture of fixtures) {
    try {
      const actor = fixtureActor(fixtures, fixture.caseId, moduleId, runId, fixture.ordinal);
      await actor.delete();
      result.actorsDeleted += 1;
    } catch (error) {
      restorationFailures.push(`actor ${fixture.actorId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.actorsMissingAfterCleanup = fixtures.every((fixture) => !game.actors.has(fixture.actorId));
  result.actorCountRestored = game.actors.size === snapshots.actorCount;
  result.policyRestored = canonicalJson(game.settings.get(moduleId, policySetting)) === canonicalJson(snapshots.policy);
  result.judgmentsRestored =
    canonicalJson(game.settings.get(moduleId, judgmentSetting)) === canonicalJson(snapshots.judgments);
  result.abpRestored = canonicalJson(game.settings.get("pf2e", abpSetting)) === canonicalJson(snapshots.abp);
  return result;
};

async function collectGrantEvidence({ modules, actor, moduleId }) {
  const u = (
    await import(`/modules/${moduleId}/scripts/wayfinder/domain/class-grant-reconciliation.js`)
  ).CLASS_GRANT_PROFILE_UUIDS;
  const fetchDocumentByUuid = (uuid) => fromUuid(uuid);
  const before = snapshotEconomic(modules, actor);
  const subject = {
    actorId: actor.id,
    draftId: "draft-grants",
    batchId: "batch-grants",
    targetLevel: 1,
    observedActorItems: [],
    fetchDocumentByUuid,
  };
  const projectionSteps = [
    { slotId: "ancestry-level-1" },
    { slotId: "heritage-level-1" },
    { slotId: "class-level-1" },
    { slotId: "class-branch-methodology-level-1" },
    { slotId: "class-branch-instinct-level-1" },
    { slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1" },
  ];
  const commandSteps = [...projectionSteps, modules.createStep(1)];
  const alchemist = modules.createEmptyDraft(1);
  alchemist.selections["class-level-1"] = selection("class-level-1", u.alchemistClass, "Alchemist", "class");
  const alchemistResult = await modules.projectGrants({ ...subject, draft: alchemist, activeSteps: projectionSteps });

  const investigator = modules.createEmptyDraft(1);
  investigator.selections["class-level-1"] = selection(
    "class-level-1",
    u.investigatorClass,
    "Investigator",
    "class",
  );
  investigator.branchSelections["class-branch-methodology-level-1"] = selection(
    "class-branch-methodology-level-1",
    u.alchemicalSciences,
    "Alchemical Sciences",
    "feat",
    "classfeature",
  );
  const investigatorResult = await modules.projectGrants({
    ...subject,
    draft: investigator,
    activeSteps: projectionSteps,
  });

  const ancientElf = modules.createEmptyDraft(1);
  ancientElf.selections["heritage-level-1"] = selection(
    "heritage-level-1",
    "Compendium.pf2e.heritages.Item.Nd9hdX8rdYyRozw8",
    "Ancient Elf",
    "heritage",
  );
  ancientElf.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"] = selection(
    "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
    "Compendium.pf2e.feats-srd.Item.CJMkxlxHiHZQYDCz",
    "Alchemist Dedication",
    "feat",
    "archetype",
  );
  const rejected = modules.findUnsupportedRoutes(ancientElf, projectionSteps);

  const titanDraft = modules.createEmptyDraft(1);
  titanDraft.selections["ancestry-level-1"] = selection("ancestry-level-1", HUMAN_UUID, "Human", "ancestry");
  titanDraft.selections["class-level-1"] = selection("class-level-1", u.barbarianClass, "Barbarian", "class");
  titanDraft.branchSelections["class-branch-instinct-level-1"] = selection(
    "class-branch-instinct-level-1",
    u.giantInstinct,
    "Giant Instinct",
    "feat",
    "classfeature",
  );
  await executeAndPersist(
    actor,
    titanDraft,
    { type: "initialize", selectedRecipe: "permanent-items" },
    modules,
    moduleId,
    commandSteps,
  );
  const runtime = modules.getRuntime();
  const line = await runtime.uiAdapter.prepareTitanMaulerLine({
    actor,
    draft: titanDraft,
    step: modules.createStep(1),
    query: "",
    filters: {},
    previewSourceUuid: null,
    funding: { lane: "currency" },
    sourceUuid: DAGGER_UUID,
  });
  await executeAndPersist(actor, titanDraft, { type: "add-line", line }, modules, moduleId, commandSteps);
  const material = titanDraft.acquisition.policySnapshot.material;
  const policy = effectivePolicyFromMaterial(material);
  const titanSubject = {
    ...subject,
    draftId: titanDraft.acquisition.draftId,
    batchId: titanDraft.acquisition.batchId,
    targetLevel: titanDraft.acquisition.targetLevel,
  };
  const titanResult = await modules.projectGrants({
    ...titanSubject,
    draft: titanDraft,
    activeSteps: projectionSteps,
    currentEquipmentPolicy: policy,
    actorSize: "medium",
  });
  const alchemistGrant = alchemistResult.grants.find((entry) => entry.profileId === "alchemist-formula-book");
  const investigatorGrant = investigatorResult.grants.find(
    (entry) => entry.profileId === "investigator-alchemical-sciences-formula-book",
  );
  const titanGrant = titanResult.grants.find((entry) => entry.profileId === "giant-instinct-titan-mauler");
  const rejectedRoute = rejected.find((entry) => entry.routeId === "ancient-elf-alchemist-formula-book");
  if (!alchemistGrant || !investigatorGrant || !titanGrant || !rejectedRoute) {
    throw new Error(
      `WF-080-51 planned grant route evidence is incomplete: ${JSON.stringify({
        alchemist: {
          profiles: alchemistResult.grants.map((entry) => entry.profileId),
          blockers: alchemistResult.blockers,
        },
        investigator: {
          profiles: investigatorResult.grants.map((entry) => entry.profileId),
          blockers: investigatorResult.blockers,
        },
        titan: { profiles: titanResult.grants.map((entry) => entry.profileId), blockers: titanResult.blockers },
        rejectedRoutes: rejected.map((entry) => entry.routeId),
      })}.`,
    );
  }
  const projectionEconomicWritesUnchanged = before === snapshotEconomic(modules, actor);
  await executeAndPersist(actor, titanDraft, { type: "retain-all" }, modules, moduleId, commandSteps);
  const reviewedTitanDraft = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), 1);
  const reviewedTitanAcquisition = reviewedTitanDraft.acquisition;
  const titanPlan = modules.createPreparedPlan({
    actorId: actor.id,
    draftId: reviewedTitanAcquisition.draftId,
    batchId: reviewedTitanAcquisition.batchId,
    targetLevel: reviewedTitanAcquisition.targetLevel,
    grants: reviewedTitanAcquisition.plannedClassGrants,
  });
  const firstTitanSession = executionSession({ modules, runtime, actor, moduleId });
  await firstTitanSession.executeAcquisitionItems({
    actor,
    draft: reviewedTitanDraft,
    classGrantPlan: titanPlan,
    emitWriteCheckpoint: async () => undefined,
  });
  const partialTitanItemCount = actor.items.filter(
    (item) => item.isOfType?.("physical") && (item.sourceId ?? item.flags?.core?.sourceId) === DAGGER_UUID,
  ).length;
  let recoveryTitanDraft = {
    ...reviewedTitanDraft,
    applyAttemptStepIds: ["starting-equipment-level-1"],
  };
  await actor.setFlag(moduleId, "draft", recoveryTitanDraft);
  const retryTitanSession = executionSession({ modules, runtime, actor, moduleId });
  await retryTitanSession.executeAcquisitionItems({
    actor,
    draft: recoveryTitanDraft,
    classGrantPlan: titanPlan,
    emitWriteCheckpoint: async () => undefined,
  });
  await retryTitanSession.executeAcquisitionCurrency({
    actor,
    draft: recoveryTitanDraft,
    classGrantPlan: titanPlan,
    emitWriteCheckpoint: async () => undefined,
    persistCurrencyConvergenceWitness: async (witness) => {
      recoveryTitanDraft = {
        ...recoveryTitanDraft,
        acquisition: modules.recordCurrencyWitness(recoveryTitanDraft.acquisition, witness),
      };
      await actor.setFlag(moduleId, "draft", recoveryTitanDraft);
    },
  });
  let recoveredTitanOutcome = null;
  const titanLifecycle = await modules.applyDraftLifecycle({
    actorName: actor.name,
    currentLevel: 1,
    draft: recoveryTitanDraft,
    acquisitionExecutionAvailable: true,
    assertAcquisitionApplyAuthority: () =>
      modules.assertApplyAuthority({ actor, acquisition: recoveryTitanDraft.acquisition, user: game.user }),
    steps: [],
    evaluateStep: async () => {
      throw new Error("WF-080-51 recovery-only Titan finalization evaluated a pending step.");
    },
    confirmApply: async () => true,
    beforeApply: async (applyAttemptDraft) => actor.setFlag(moduleId, "draft", applyAttemptDraft),
    finalizeRecoveredDraft: (recoveryActorUpdate, buildFinalActorUpdate) =>
      modules.finalizeRecoveredDraftOnActor(actor, {
        recoveryActorUpdate,
        resolveFinalActorUpdate: (evidence) =>
          buildFinalActorUpdate(modules.normalizeState(actor.getFlag(moduleId, "state")), evidence),
        beforeFinalize: () => modules.assertCanUseWayfinder(actor),
        beforeFinalActorUpdate: () => modules.assertCanUseWayfinder(actor),
        validateActorAuthority: modules.canUseWayfinder,
        assertAcquisitionApplyAuthority: (currentActor) =>
          modules.assertApplyAuthority({
            actor: currentActor,
            acquisition: recoveryTitanDraft.acquisition,
            user: game.user,
          }),
        classGrantRecovery: {
          kind: "required",
          preparePlan: async () => titanPlan,
          verifyAcquisitionRecovery: async ({ actor: currentActor, plan, finalClassGrantReconciliation }) => {
            const recoverySession = executionSession({ modules, runtime, actor: currentActor, moduleId });
            recoveredTitanOutcome = await recoverySession.prepareRecoveredAcquisitionOutcome({
              actor: currentActor,
              draft: recoveryTitanDraft,
              classGrantPlan: plan,
              finalClassGrantReconciliation,
            });
            return recoveredTitanOutcome;
          },
        },
      }),
  });
  const durableTitanState = modules.normalizeState(actor.getFlag(moduleId, "state"));
  const titanManifest = durableTitanState.completedAcquisitionManifest;
  if (
    titanLifecycle.kind !== "applied" ||
    actor.getFlag(moduleId, "draft") != null ||
    durableTitanState.completedAcquisitionManifestCorrupt ||
    !recoveredTitanOutcome ||
    !titanManifest ||
    titanManifest.id !== recoveredTitanOutcome.manifest.id
  ) {
    throw new Error("WF-080-51 Titan manifest did not persist through recovery finalization.");
  }
  const titanItems = actor.items.filter(
    (item) =>
      item.isOfType?.("physical") &&
      (item.sourceId ?? item.flags?.core?.sourceId) === DAGGER_UUID &&
      item.getFlag?.(moduleId, "acquisition")?.batchId === reviewedTitanAcquisition.batchId,
  );
  return {
    subject: { actorId: actor.id, draftId: subject.draftId, batchId: subject.batchId, targetLevel: 1 },
    routes: [
      routeEvidence("alchemist-formula-book", alchemistGrant),
      routeEvidence("giant-instinct-titan-mauler", titanGrant),
      routeEvidence("investigator-alchemical-sciences-formula-book", investigatorGrant),
      {
        routeId: rejectedRoute.routeId,
        status: "rejected",
        materializer: null,
        blockerCode: rejectedRoute.code,
        reasonCode: rejectedRoute.reasonCode,
      },
    ],
    projectionEconomicWritesUnchanged,
    titanMaterialization: {
      disposition: reviewedTitanAcquisition.disposition.kind,
      batchId: reviewedTitanAcquisition.batchId,
      lineId: line.lineId,
      itemIds: titanItems.map((item) => item.id).sort(),
      partialItemCount: partialTitanItemCount,
      itemCount: titanItems.length,
      acquisitionStampCount: titanItems.filter((item) => item.getFlag?.(moduleId, "acquisition")).length,
      identityPlan: structuredClone(recoveredTitanOutcome.identityPlan),
      manifest: structuredClone(titanManifest),
      lifecycleKind: titanLifecycle.kind,
      draftCleared: actor.getFlag(moduleId, "draft") == null,
      manifestCorrupt: durableTitanState.completedAcquisitionManifestCorrupt,
      budgetCopper: titanManifest.currency.budgetCopper,
      spentCopper: titanManifest.currency.spentCopper,
      remainingCopper: titanManifest.currency.remainingCopper,
      observedCopper: titanManifest.currency.observedCopper,
    },
  };
}

function routeEvidence(routeId, grant) {
  return {
    routeId,
    status: "supported",
    profileId: grant.profileId,
    materializer: grant.materializer,
    grantId: grant.grantId,
    sourceUuid: grant.expected.sourceUuid,
    quantity: grant.expected.quantity,
    lineId: grant.eligibilityEvidence?.lineId ?? null,
    resaleRule: grant.resaleRule,
  };
}

function effectivePolicyFromMaterial(material) {
  return {
    version: 1,
    actorId: material.subject.actorId,
    draftId: material.subject.draftId,
    targetLevel: material.subject.targetLevel,
    rules: { wealth: material.numericPolicyRef, semantics: material.semanticPolicyRef },
    recipe:
      material.resolvedRecipe.kind === "permanent-items"
        ? { kind: "permanent-items", currencyCopper: material.budgetCopper, allowances: structuredClone(material.allowances) }
        : { ...structuredClone(material.resolvedRecipe), budgetCopper: material.budgetCopper },
    worldRecipePolicy: structuredClone(material.worldRecipePolicy),
    sourcePolicy: structuredClone(material.sourcePolicy),
    rarityPolicy: structuredClone(material.rarityPolicy),
    authorityPolicy: structuredClone(material.authorityPolicy),
    higherLevelStartEvidence: structuredClone(material.higherLevelStartEvidence),
    abp: structuredClone(material.abp),
    gmJudgments: structuredClone(material.gmJudgments),
    fingerprint: `wf51:${material.subject.actorId}:${material.subject.draftId}`,
    explanations: [],
  };
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
