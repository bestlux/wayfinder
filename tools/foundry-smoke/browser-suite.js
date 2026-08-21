/* global Actor, CONFIG, CONST, Hooks, document, game */

globalThis.__runWayfinderSmokeSuite = async function runWayfinderSmokeSuite({
  cases,
  allowDestructive = false,
  expectedWorldId = "",
  fixturePrefix,
  incrementalCases = [],
  keepActors,
  moduleId,
}) {
  const startedAt = new Date().toISOString();
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) {
    throw new Error(`${moduleId} is not active in this world.`);
  }
  if (!keepActors && !String(expectedWorldId ?? "").trim()) {
    throw new Error("Foundry smoke cleanup/deletion requires an expected world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!keepActors && !allowDestructive) {
    throw new Error("Foundry smoke cleanup/deletion requires destructive opt-in.");
  }

  if (!keepActors) {
    await cleanupActors(fixturePrefix);
  }
  const modules = await loadWayfinderModules(moduleId);
  const results = [];

  for (const smokeCase of cases) {
    console.log(`WFSMOKE case start ${smokeCase.id}`);
    const result = await runSmokeCase(smokeCase, modules, { keepActors, moduleId, prefix: fixturePrefix });
    console.log(`WFSMOKE case ${result.status} ${smokeCase.id}`);
    results.push(result);
  }

  for (const smokeCase of incrementalCases) {
    console.log(`WFSMOKE incremental case start ${smokeCase.id}`);
    const result = await runIncrementalExistingCase(smokeCase, modules, {
      keepActors,
      moduleId,
      prefix: fixturePrefix,
    });
    console.log(`WFSMOKE incremental case ${result.status} ${smokeCase.id}`);
    results.push(result);
  }

  const summary = {
    classified: results.filter((entry) => entry.status === "classified").length,
    failed: results.filter((entry) => entry.status === "fail").length,
    passed: results.filter((entry) => entry.status === "pass").length,
  };

  return {
    schemaVersion: 4,
    startedAt,
    finishedAt: new Date().toISOString(),
    foundryVersion: game.version ?? null,
    moduleActive: true,
    moduleId,
    moduleVersion: moduleRecord.version ?? moduleRecord.manifest?.version ?? null,
    pf2eVersion: game.system?.version ?? null,
    summary,
    user: {
      id: game.user?.id ?? null,
      name: game.user?.name ?? null,
      role: Number(game.user?.role),
      isGM: Boolean(game.user?.isGM),
    },
    world: game.world?.id ?? null,
    cases: results,
  };
};

globalThis.__prepareWayfinderPickerProfile = async function prepareWayfinderPickerProfile({
  allowDestructive = false,
  expectedWorldId = "",
  fixturePrefix,
  moduleId,
  profile,
  smokeCase,
}) {
  const normalizedWorldId = String(expectedWorldId ?? "").trim();
  if (!allowDestructive || !normalizedWorldId) {
    throw new Error(
      "Picker profiling requires destructive fixture cleanup opt-in and an exact expected Foundry world id.",
    );
  }
  assertExpectedWorldId(game.world?.id, normalizedWorldId);

  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) {
    throw new Error(`${moduleId} is not active in this world.`);
  }
  await cleanupActors(fixturePrefix);
  const actorCountBefore = game.actors.size;

  const modules = await loadWayfinderModules(moduleId);
  let actor = null;
  try {
    actor = await Actor.create({
      name: `${fixturePrefix} - ${profile.id}`,
      type: "character",
      ownership: fixtureOwnershipFor(game.user),
      system: { details: { level: { value: 1 } } },
    });
    await enforceFixtureOwnership(actor, game.user);
    const failures = [];
    await seedActorSkillRanks(actor, smokeCase);
    await seedActorItems(actor, smokeCase, failures);
    if (failures.length > 0) {
      throw new Error(failures.join(" "));
    }

    const draft = modules.createEmptyDraft(smokeCase.targetLevel);
    await seedCreationDraft(draft, smokeCase);
    const fillResult = await completeDraft(actor, draft, smokeCase, modules, {
      skipStepIds: new Set([profile.stepId]),
    });
    if (fillResult.classifications.length > 0 || fillResult.warnings.length > 0) {
      throw new Error(
        `Picker profile fixture did not fill deterministically: ${[
          ...fillResult.classifications,
          ...fillResult.warnings,
        ].join(" ")}`,
      );
    }

    const plan = await buildPlan(actor, draft, modules);
    const step = plan.steps.find((entry) => entry.slotId === profile.stepId);
    if (step?.kind !== "spell-choice") {
      throw new Error(`Picker profile step ${profile.stepId} is not a live spell-choice step.`);
    }
    const incomplete = await incompleteSteps(actor, draft, plan.steps, modules);
    const unexpectedIncomplete = incomplete.filter((entry) => entry.slotId !== profile.stepId);
    if (unexpectedIncomplete.length > 0) {
      throw new Error(
        `Picker profile has unexpected incomplete steps: ${unexpectedIncomplete.map((entry) => entry.slotId).join(", ")}.`,
      );
    }

    const optionContext = await buildPickerContext(actor, draft, step, plan.steps, modules);
    const spellRarityCeiling = modules.getSpellRarityCeilingSetting();
    const restrictedSpellRarityAccess = modules.evaluateSpellRarityAttestation(
      actor.id,
      draft,
      step,
      spellRarityCeiling,
    ).granted;
    const optionStep = modules.withRestrictedSpellRarityAccess(
      step,
      spellRarityCeiling,
      restrictedSpellRarityAccess,
    );
    const options = await modules.getOptionsForStep(optionStep, optionContext);
    const finalQuery = profile.querySequence.at(-1) ?? "";
    const normalizedQuery = finalQuery.trim().toLowerCase();
    const expectedResults = options
      .filter((option) =>
        [option.name, option.source ?? "", option.rarity ?? ""].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        ),
      )
      .map((option) => ({ name: option.name, value: option.value }));
    if (options.length === 0 || expectedResults.length === 0) {
      throw new Error(
        `Picker profile needs non-empty live options and final results; options=${options.length}, final=${expectedResults.length}.`,
      );
    }

    await actor.setFlag(moduleId, "draft", draft);
    modules.WayfinderApp.open(actor);
    const app = Object.values(actor.apps ?? {}).find((candidate) => candidate instanceof modules.WayfinderApp);
    if (!app) {
      throw new Error("Picker profile could not resolve the actor-bound Wayfinder app.");
    }
    await app.render(true);
    app.element?.setAttribute("data-wayfinder-profile-actor-id", actor.id);

    return {
      appElementId: app.element?.id ?? app.id,
      actorId: actor.id,
      actorName: actor.name,
      actorCountBefore,
      actorCountAfterCreate: game.actors.size,
      stepId: step.slotId,
      restrictedSpellRarityAccess,
      optionCount: options.length,
      expectedResultCount: expectedResults.length,
      expectedResultNames: expectedResults.map((entry) => entry.name),
      expectedResultValues: expectedResults.map((entry) => entry.value),
      packPolicy: {
        officialSpellPack: "pf2e.spells-srd",
        additionalSourcePacks: String(game.settings.get(moduleId, "additionalSourcePacks") ?? ""),
        spellRarityCeiling,
        observedPackIds: [...new Set(options.map((option) => option.packId))].sort(),
      },
      runtime: {
        foundryVersion: game.version ?? null,
        locale: game.i18n?.lang ?? null,
        moduleVersion: moduleRecord.version ?? moduleRecord.manifest?.version ?? null,
        pf2eVersion: game.system?.version ?? null,
        worldId: game.world?.id ?? null,
      },
    };
  } catch (error) {
    if (actor) {
      await actor.delete();
    }
    throw error;
  }
};

globalThis.__cleanupWayfinderPickerProfile = async function cleanupWayfinderPickerProfile({
  actorId,
  allowDestructive = false,
  expectedWorldId = "",
}) {
  if (!allowDestructive) {
    throw new Error("Picker profile fixture deletion requires destructive opt-in.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  const actor = game.actors.get(actorId);
  if (!actor) {
    return { deleted: false };
  }

  for (const app of Object.values(actor.apps ?? {})) {
    await app.close?.({ animate: false });
  }
  await actor.delete();
  return { deleted: true, actorCountAfter: game.actors.size };
};

globalThis.__prepareWayfinderOwnerProbe = async function prepareWayfinderOwnerProbe({
  allowDestructive = false,
  expectedWorldId = "",
  fixturePrefix,
  moduleId,
  playerName,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Owner probe setup requires destructive cleanup opt-in and an exact expected world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) {
    throw new Error("Owner probe setup must run as a current GM.");
  }
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) {
    throw new Error(`${moduleId} is not active in this world.`);
  }
  const player = game.users.find((user) => user.name === playerName);
  if (!player || player.isGM || player.id === game.user.id) {
    throw new Error("Owner probe requires a distinct, pre-existing non-GM player.");
  }
  const fixtureName = `${fixturePrefix} - owner-probe-${runId}`;
  const actor = await Actor.create({
    name: fixtureName,
    type: "character",
    ownership: fixtureOwnershipFor(player),
    system: { details: { level: { value: 1 } } },
  });
  try {
    await enforceFixtureOwnership(actor, player);
    await actor.setFlag(moduleId, "smokeOwnerProbe", { runId });
    return {
      actorId: actor.id,
      fixtureName,
      playerId: player.id,
      runId,
      session: {
        role: Number(game.user.role),
        isGM: Boolean(game.user.isGM),
        distinctPlayerResolved: true,
      },
      runtime: smokeRuntime(moduleRecord, expectedWorldId),
    };
  } catch (error) {
    await actor.delete();
    throw error;
  }
};

globalThis.__runWayfinderOwnerProbe = async function runWayfinderOwnerProbe({
  actorId,
  expectedPlayerId,
  expectedWorldId,
  moduleId,
  runId,
}) {
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (game.user?.isGM || game.user?.id !== expectedPlayerId) {
    throw new Error("Owner probe UI lane must run as the exact prepared non-GM player.");
  }
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) {
    throw new Error(`${moduleId} is not active in this world.`);
  }
  const actor = game.actors.get(actorId);
  if (!actor || actor.getFlag(moduleId, "smokeOwnerProbe")?.runId !== runId) {
    throw new Error("Owner probe player session could not resolve the exact guarded actor.");
  }
  const modules = await loadWayfinderModules(moduleId);
  const sheet = actor.sheet;
  let app = null;
  let probeError = null;
  let renderedApp = null;
  const renderHookId = Hooks.on("renderWayfinderApp", (candidate) => {
    if (candidate instanceof modules.WayfinderApp && candidate.actor?.id === actor.id) {
      renderedApp = candidate;
    }
  });
  const ui = {
    actorSheetOpened: false,
    launchControlFound: false,
    launchControlClicked: false,
    actorBoundAppOpened: false,
    renderLifecycleCompleted: false,
    appClosed: false,
    actorSheetClosed: false,
  };
  try {
    await sheet.render(true);
    const sheetRoot = await waitForCondition(() => rootElementOf(sheet.element), 10000, "Actor sheet did not open.");
    ui.actorSheetOpened = true;
    const launchControl = await waitForCondition(
      () => sheetRoot.querySelector(".wayfinder-launch"),
      10000,
      "Wayfinder launch control did not render on the actor sheet.",
    );
    ui.launchControlFound = true;
    launchControl.click();
    ui.launchControlClicked = true;
    app = await waitForCondition(
      () =>
        Object.values(actor.apps ?? {}).find(
          (candidate) => candidate instanceof modules.WayfinderApp && candidate.actor?.id === actor.id,
        ) ?? null,
      10000,
      "Actor-bound Wayfinder app did not open from the sheet control.",
    );
    await waitForCondition(
      () => (renderedApp === app && rootElementOf(app.element)?.isConnected ? true : null),
      10000,
      "Actor-bound Wayfinder app did not complete its render lifecycle.",
    );
    ui.renderLifecycleCompleted = true;
    ui.actorBoundAppOpened = true;
  } catch (error) {
    probeError = error;
  } finally {
    try {
      if (app) {
        await app.close({ animate: false });
        ui.appClosed = !rootElementOf(app.element)?.isConnected;
      }
    } catch (error) {
      probeError ??= error;
    }
    try {
      await sheet.close();
      ui.actorSheetClosed = await waitForCondition(
        () => (!rootElementOf(sheet.element)?.isConnected ? true : null),
        10000,
        "Actor sheet did not finish closing.",
      );
    } catch (error) {
      probeError ??= error;
    }
    Hooks.off("renderWayfinderApp", renderHookId);
  }
  if (probeError) throw probeError;

  return {
    session: { role: Number(game.user.role), isGM: Boolean(game.user.isGM) },
    authority: {
      noneLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      defaultOwnershipLevel: Number(actor.ownership?.default),
      explicitOwnershipLevel: Number(actor.ownership?.[game.user.id]),
      isOwner: Boolean(actor.isOwner),
      ownerPermission: Boolean(actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)),
      canUpdate: Boolean(actor.canUserModify(game.user, "update")),
    },
    ui,
    runtime: smokeRuntime(moduleRecord, expectedWorldId),
  };
};

globalThis.__cleanupWayfinderOwnerProbe = async function cleanupWayfinderOwnerProbe({
  actorId,
  allowDestructive = false,
  expectedWorldId = "",
  fixtureName,
  moduleId,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Owner probe cleanup requires destructive opt-in and an exact expected world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) {
    throw new Error("Owner probe cleanup must run as a current GM.");
  }
  const actor = game.actors.get(actorId);
  const exactFixtureMatched = Boolean(
    actor && actor.name === fixtureName && actor.getFlag(moduleId, "smokeOwnerProbe")?.runId === runId,
  );
  if (!exactFixtureMatched) {
    throw new Error("Owner probe cleanup refused an actor that did not match the exact guarded fixture.");
  }
  await actor.delete();
  return {
    exactFixtureMatched: true,
    actorDeleted: true,
    actorMissingAfterCleanup: !game.actors.has(actorId),
  };
};

globalThis.__prepareWayfinderDraftPersistenceTracer = async function prepareWayfinderDraftPersistenceTracer({
  allowDestructive = false,
  expectedWorldId = "",
  fixturePrefix,
  moduleId,
  playerName,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Draft persistence tracer setup requires destructive cleanup opt-in and an exact world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) throw new Error("Draft persistence tracer setup must run as a current GM.");
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) throw new Error(`${moduleId} is not active in this world.`);
  const player = game.users.find((user) => user.name === playerName);
  if (!player || player.isGM || player.id === game.user.id) {
    throw new Error("Draft persistence tracer requires a distinct, pre-existing non-GM player.");
  }
  const fixtureName = `${fixturePrefix} - draft-persistence-${runId}`;
  const actor = await Actor.create({
    name: fixtureName,
    type: "character",
    ownership: fixtureOwnershipFor(player),
    system: { details: { level: { value: 1 } } },
  });
  try {
    await enforceFixtureOwnership(actor, player);
    await actor.setFlag(moduleId, "smokeDraftPersistence", { runId });
    return {
      actorId: actor.id,
      fixtureName,
      playerId: player.id,
      setupUserId: game.user.id,
      runId,
      runtime: smokeRuntime(moduleRecord, expectedWorldId),
    };
  } catch (error) {
    await actor.delete();
    throw error;
  }
};

globalThis.__runWayfinderDraftPersistenceTracer = async function runWayfinderDraftPersistenceTracer({
  actorId,
  expectedRole,
  expectedUserId,
  expectedWorldId,
  moduleId,
  runId,
}) {
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  const isExpectedRole = expectedRole === "gm" ? game.user?.isGM : !game.user?.isGM;
  if (!isExpectedRole || game.user?.id !== expectedUserId) {
    throw new Error(`Draft persistence tracer did not run as the expected ${expectedRole} user.`);
  }
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) throw new Error(`${moduleId} is not active in this world.`);
  const actor = game.actors.get(actorId);
  if (!actor || actor.getFlag(moduleId, "smokeDraftPersistence")?.runId !== runId) {
    throw new Error("Draft persistence tracer could not resolve the exact guarded actor.");
  }
  if (!actor.isOwner || !actor.canUserModify(game.user, "update")) {
    throw new Error("Draft persistence tracer user cannot update the guarded actor.");
  }
  const modules = await loadWayfinderModules(moduleId);
  const repeated = await runDraftPersistenceRoundTrip(actor, modules, moduleId);
  const faultCases = expectedRole === "owner" ? await runDraftPersistenceFaultCases(actor, modules, moduleId) : null;
  return {
    session: { id: game.user.id, name: game.user.name, role: Number(game.user.role), isGM: Boolean(game.user.isGM) },
    repeated,
    faultCases,
    runtime: smokeRuntime(moduleRecord, expectedWorldId),
  };
};

globalThis.__cleanupWayfinderDraftPersistenceTracer = async function cleanupWayfinderDraftPersistenceTracer({
  actorId,
  allowDestructive = false,
  expectedWorldId = "",
  fixtureName,
  moduleId,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Draft persistence tracer cleanup requires destructive opt-in and an exact world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) throw new Error("Draft persistence tracer cleanup must run as a current GM.");
  const actor = game.actors.get(actorId);
  const exactFixtureMatched = Boolean(
    actor && actor.name === fixtureName && actor.getFlag(moduleId, "smokeDraftPersistence")?.runId === runId,
  );
  if (!exactFixtureMatched) {
    throw new Error("Draft persistence tracer cleanup refused an actor that did not match the guarded fixture.");
  }
  for (const app of Object.values(actor.apps ?? {})) await app.close?.({ animate: false });
  await actor.delete();
  return { exactFixtureMatched: true, actorDeleted: true, actorMissingAfterCleanup: !game.actors.has(actorId) };
};

async function runDraftPersistenceRoundTrip(actor, modules, moduleId) {
  let app = await openDraftPersistenceApp(actor, modules);
  await clickDraftAction(app, "target-up");
  await waitForPersistedDraftTarget(actor, moduleId, 2);
  await waitForDraftSavePhase(app, "saved");
  await closeDraftPersistenceApp(app);

  app = await openDraftPersistenceApp(actor, modules);
  const firstReopenTarget = readDraftTargetFromApp(app);
  await clickDraftAction(app, "target-down");
  await waitForPersistedDraftTarget(actor, moduleId, 1);
  await waitForDraftSavePhase(app, "saved");
  await closeDraftPersistenceApp(app);

  app = await openDraftPersistenceApp(actor, modules);
  const secondReopenTarget = readDraftTargetFromApp(app);
  await closeDraftPersistenceApp(app);
  return {
    savedTargets: [2, 1],
    reopenedTargets: [firstReopenTarget, secondReopenTarget],
    exactPersistence: firstReopenTarget === 2 && secondReopenTarget === 1,
  };
}

async function runDraftPersistenceFaultCases(actor, modules, moduleId) {
  const transient = await runTransientDraftPersistenceCase(actor, modules, moduleId);
  const permanent = await runPermanentDraftPersistenceCase(actor, modules, moduleId);
  const malformed = await runMalformedDraftPersistenceCase(actor, modules, moduleId);
  return { transient, permanent, malformed };
}

async function runTransientDraftPersistenceCase(actor, modules, moduleId) {
  const durableBefore = structuredClone(actor.getFlag(moduleId, "draft"));
  let updateAttempts = 0;
  let restoreUpdate = () => undefined;
  restoreUpdate = interceptActorUpdate(actor, async ({ callOriginal, operation, updates }) => {
    if (Object.hasOwn(updates, `flags.${moduleId}.draft`) && updateAttempts++ === 0) {
      restoreUpdate();
      throw new Error("Network timeout forced by the Wayfinder draft persistence tracer.");
    }
    return callOriginal(updates, operation);
  });
  let app = await openDraftPersistenceApp(actor, modules);
  try {
    await clickDraftAction(app, "target-up");
    const error = await waitForDraftSavePhase(app, "error");
    const durableAfterFailure = structuredClone(actor.getFlag(moduleId, "draft"));
    const retry = rootElementOf(app.element)?.querySelector("[data-wayfinder-action='retry-draft-save']");
    const retryVisible = Boolean(retry && !retry.hidden);
    retry?.click();
    try {
      await waitForPersistedDraftTarget(actor, moduleId, 2);
    } catch (retryError) {
      const status = rootElementOf(app.element)?.querySelector("[data-wayfinder-save-status]");
      const phase = status?.dataset.phase ?? "missing";
      const message = status?.querySelector("[data-wayfinder-save-message]")?.textContent?.trim() ?? "missing";
      throw new Error(
        `Transient retry did not persist (visible ${retryVisible}; attempts ${updateAttempts}; phase ${phase}; message ${message}; durable ${JSON.stringify(actor.getFlag(moduleId, "draft"))}).`,
        { cause: retryError },
      );
    }
    await waitForDraftSavePhase(app, "saved");
    const closeUpdates = [];
    const restoreCloseObserver = interceptActorUpdate(actor, ({ callOriginal, operation, updates }) => {
      closeUpdates.push(structuredClone(updates));
      return callOriginal(updates, operation);
    });
    try {
      await closeDraftPersistenceApp(app);
    } catch (closeError) {
      throw new Error(
        `${closeError instanceof Error ? closeError.message : String(closeError)} Close updates: ${JSON.stringify(closeUpdates)}. Durable: ${JSON.stringify(actor.getFlag(moduleId, "draft"))}.`,
        { cause: closeError },
      );
    } finally {
      restoreCloseObserver();
    }
    app = null;
    return {
      durableUnchangedAfterFailure: JSON.stringify(durableAfterFailure) === JSON.stringify(durableBefore),
      failureMessage: error.message,
      retryVisible,
      updateAttempts,
      newestTargetPersisted: actor.getFlag(moduleId, "draft")?.targetLevel === 2,
    };
  } finally {
    restoreUpdate();
    await closeDraftPersistenceApp(app).catch(() => undefined);
  }
}

async function runPermanentDraftPersistenceCase(actor, modules, moduleId) {
  const durableBefore = structuredClone(actor.getFlag(moduleId, "draft"));
  let updateAttempts = 0;
  const restoreUpdate = interceptActorUpdate(actor, async ({ callOriginal, operation, updates }) => {
    if (Object.hasOwn(updates, `flags.${moduleId}.draft`)) {
      updateAttempts += 1;
      const error = new Error("Actor sheet validation rejected flags.wayfinder-pf2e.draft (forced tracer case).");
      error.name = "DataModelValidationError";
      throw error;
    }
    return callOriginal(updates, operation);
  });
  const app = await openDraftPersistenceApp(actor, modules);
  try {
    await clickDraftAction(app, "target-down");
    const error = await waitForDraftSavePhase(app, "error");
    const root = rootElementOf(app.element);
    const retry = root?.querySelector("[data-wayfinder-action='retry-draft-save']");
    const retryHidden = !retry || retry.hidden;
    const durableAfterFailure = structuredClone(actor.getFlag(moduleId, "draft"));
    root?.querySelector("[data-wayfinder-action='save-draft']")?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.close({ animate: false });
    const windowStayedOpen = Boolean(rootElementOf(app.element)?.isConnected);
    return {
      durableUnchangedAfterFailure: JSON.stringify(durableAfterFailure) === JSON.stringify(durableBefore),
      failureMessage: error.message,
      retryHidden,
      updateAttempts,
      noRetryLoop: updateAttempts === 1,
      windowStayedOpen,
    };
  } finally {
    restoreUpdate();
    await clickDraftAction(app, "target-up");
    await waitForPersistedDraftTarget(actor, moduleId, 2);
    await waitForDraftSavePhase(app, "saved");
    await closeDraftPersistenceApp(app);
  }
}

async function runMalformedDraftPersistenceCase(actor, modules, moduleId) {
  const durableBefore = structuredClone(actor.getFlag(moduleId, "draft"));
  let alteredWrites = 0;
  let restoreUpdate = () => undefined;
  restoreUpdate = interceptActorUpdate(actor, async ({ callOriginal, operation, updates }) => {
    const draftKey = `flags.${moduleId}.draft`;
    if (Object.hasOwn(updates, draftKey) && alteredWrites++ === 0) {
      const altered = structuredClone(updates);
      altered[draftKey].targetLevel = 20;
      delete altered[draftKey].selections;
      const result = await callOriginal(altered, operation);
      restoreUpdate();
      return result;
    }
    return callOriginal(updates, operation);
  });
  const app = await openDraftPersistenceApp(actor, modules);
  try {
    await clickDraftAction(app, "target-down");
    const error = await waitForDraftSavePhase(app, "error");
    const durableAfterFailure = structuredClone(actor.getFlag(moduleId, "draft"));
    const retry = rootElementOf(app.element)?.querySelector("[data-wayfinder-action='retry-draft-save']");
    return {
      alteredWrites,
      durableRestoredExactly: JSON.stringify(durableAfterFailure) === JSON.stringify(durableBefore),
      failureMessage: error.message,
      retryHidden: !retry || retry.hidden,
    };
  } finally {
    restoreUpdate();
    await clickDraftAction(app, "target-up");
    await waitForPersistedDraftTarget(actor, moduleId, 2);
    await waitForDraftSavePhase(app, "saved");
    await closeDraftPersistenceApp(app);
  }
}

function interceptActorUpdate(actor, interceptor) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(actor, "update");
  const originalUpdate = actor.update;
  let restored = false;
  Object.defineProperty(actor, "update", {
    configurable: true,
    value(updates, operation) {
      return interceptor({
        callOriginal: (nextUpdates, nextOperation) => originalUpdate.call(actor, nextUpdates, nextOperation),
        operation,
        updates,
      });
    },
    writable: true,
  });
  return () => {
    if (restored) return;
    restored = true;
    if (ownDescriptor) Object.defineProperty(actor, "update", ownDescriptor);
    else delete actor.update;
  };
}

async function openDraftPersistenceApp(actor, modules) {
  modules.WayfinderApp.open(actor);
  const app = await waitForCondition(
    () =>
      Object.values(actor.apps ?? {}).find(
        (candidate) => candidate instanceof modules.WayfinderApp && candidate.actor?.id === actor.id,
      ) ?? null,
    10000,
    "Draft persistence tracer could not open the actor-bound Wayfinder app.",
  );
  await waitForCondition(
    () => (rootElementOf(app.element)?.isConnected ? true : null),
    10000,
    "Draft persistence tracer app did not complete its render lifecycle.",
  );
  return app;
}

async function closeDraftPersistenceApp(app) {
  if (!app || !rootElementOf(app.element)?.isConnected) return;
  await new Promise((resolve) => setTimeout(resolve, 250));
  await app.close({ animate: false });
  try {
    await waitForCondition(
      () => (!rootElementOf(app.element)?.isConnected ? true : null),
      10000,
      "Draft persistence tracer app did not close.",
    );
  } catch (error) {
    const status = rootElementOf(app.element)?.querySelector("[data-wayfinder-save-status]");
    const phase = status?.dataset.phase ?? "missing";
    const message = status?.querySelector("[data-wayfinder-save-message]")?.textContent?.trim() ?? "missing";
    throw new Error(`Draft persistence tracer app did not close (phase ${phase}; message ${message}).`, {
      cause: error,
    });
  }
}

async function clickDraftAction(app, action) {
  const control = await waitForCondition(
    () => rootElementOf(app.element)?.querySelector(`[data-wayfinder-action='${action}']`) ?? null,
    10000,
    `Draft persistence tracer could not find ${action}.`,
  );
  control.click();
}

async function waitForPersistedDraftTarget(actor, moduleId, targetLevel) {
  return waitForCondition(
    () => (actor.getFlag(moduleId, "draft")?.targetLevel === targetLevel ? true : null),
    10000,
    `Draft persistence tracer did not persist target level ${targetLevel}.`,
  );
}

async function waitForDraftSavePhase(app, phase) {
  const status = await waitForCondition(
    () => {
      const candidate = rootElementOf(app.element)?.querySelector("[data-wayfinder-save-status]");
      return candidate?.dataset.phase === phase ? candidate : null;
    },
    10000,
    `Draft persistence tracer did not reach save phase ${phase}.`,
  );
  return { message: status.querySelector("[data-wayfinder-save-message]")?.textContent?.trim() ?? "" };
}

function readDraftTargetFromApp(app) {
  return Number(rootElementOf(app.element)?.querySelector(".level-badge.target strong")?.textContent?.trim());
}

const ACQUISITION_BASE_BUILD = Object.freeze([
  {
    uuid: "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX",
    name: "Human",
    slotId: "ancestry-level-1",
  },
  {
    uuid: "Compendium.pf2e.heritages.Item.KO33MNyY9VqNQmbZ",
    name: "Wintertouched Human",
    slotId: "heritage-level-1",
  },
  {
    uuid: "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy",
    name: "Acolyte",
    slotId: "background-level-1",
  },
  {
    uuid: "Compendium.pf2e.classes.Item.8zn3cD6GSmoo1LW4",
    name: "Fighter",
    slotId: "class-level-1",
    keyAbility: "str",
    rulesSelections: { fighterSkill: "athletics" },
  },
  {
    uuid: "Compendium.pf2e.feats-srd.Item.lwLcUHQMOqfaNND4",
    name: "Cooperative Nature",
    slotId: "ancestry-feat-level-1",
  },
  {
    uuid: "Compendium.pf2e.feats-srd.Item.qQt3CMrhLkUV1wCv",
    name: "Sudden Charge",
    slotId: "class-feat-level-1",
  },
]);

function acquisitionBaseBuildForCase(smokeCase) {
  const native = smokeCase.acquisitionCase?.nativeGrant;
  if (!native) return ACQUISITION_BASE_BUILD;
  return [
    { uuid: native.ancestry.sourceUuid, name: native.ancestry.name, slotId: "ancestry-level-1", nativeAncestry: true },
    { uuid: native.heritage.sourceUuid, name: native.heritage.name, slotId: "heritage-level-1" },
    ACQUISITION_BASE_BUILD[2],
    ACQUISITION_BASE_BUILD[3],
    { uuid: native.ancestryFeat.sourceUuid, name: native.ancestryFeat.name, slotId: "ancestry-feat-level-1" },
    ACQUISITION_BASE_BUILD[5],
  ];
}

async function prepareAcquisitionFixtureDraft(smokeCase, modules) {
  const native = smokeCase.acquisitionCase?.nativeGrant;
  if (!native) return modules.createEmptyDraft(1);
  const fixture = native.fixture;
  const draft = modules.createEmptyDraft(1);
  const selections = [
    ["ancestry-level-1", "pf2e.ancestries", native.ancestry],
    ["heritage-level-1", "pf2e.heritages", native.heritage],
    ["background-level-1", "pf2e.backgrounds", fixture.background],
    ["class-level-1", "pf2e.classes", fixture.class],
    ["ancestry-feat-level-1", "pf2e.feats-srd", native.ancestryFeat],
    ["class-feat-level-1", "pf2e.feats-srd", fixture.classFeat],
  ];
  for (const [slotId, packId, expected] of selections) {
    const selection = await selectionRef(packId, expected.name, slotId);
    if (selection.uuid !== expected.sourceUuid) {
      throw new Error(`Acquisition tracer native fixture source drifted: ${expected.name}.`);
    }
    draft.selections[slotId] = selection;
  }
  draft.boosts.ancestry.modeTouched = true;
  draft.boosts.ancestry.selectedBoosts = structuredClone(fixture.ancestryBoosts);
  draft.boosts.background.selectedBoosts = structuredClone(fixture.backgroundBoosts);
  draft.boosts.class.keyAbility = fixture.keyAbility;
  draft.boosts.levels["1"] = [...fixture.levelOneBoosts];
  return draft;
}

async function prepareAcquisitionBaseBuild(actor, modules, moduleId, smokeCase) {
  const fixtureDraft = await prepareAcquisitionFixtureDraft(smokeCase, modules);
  for (const anchor of acquisitionBaseBuildForCase(smokeCase)) {
    const document = await modules.resolveUuid(anchor.uuid);
    if (!document || document.name !== anchor.name || typeof document.toObject !== "function") {
      throw new Error(`Acquisition tracer base-build source drifted: ${anchor.name}.`);
    }
    const source = anchor.nativeAncestry
      ? await modules.createEmbeddedSource(fixtureDraft.selections[anchor.slotId], fixtureDraft, [])
      : document.toObject();
    if (!source) throw new Error(`Acquisition tracer could not prepare ${anchor.name}.`);
    delete source._id;
    source.flags = {
      ...(source.flags ?? {}),
      [moduleId]: { ...(source.flags?.[moduleId] ?? {}), slotId: anchor.slotId },
    };
    if (anchor.keyAbility && source.system?.keyAbility) {
      source.system.keyAbility.selected = anchor.keyAbility;
    }
    if (anchor.rulesSelections) {
      for (const rule of Array.isArray(source.system?.rules) ? source.system.rules : []) {
        if (rule?.key === "ChoiceSet" && typeof rule.flag === "string" && rule.flag in anchor.rulesSelections) {
          rule.selection = anchor.rulesSelections[rule.flag];
        }
      }
      source.flags.pf2e = {
        ...(source.flags.pf2e ?? {}),
        rulesSelections: { ...(source.flags.pf2e?.rulesSelections ?? {}), ...anchor.rulesSelections },
      };
      source.flags.system = {
        ...(source.flags.system ?? {}),
        rulesSelections: { ...(source.flags.system?.rulesSelections ?? {}), ...anchor.rulesSelections },
      };
    }
    const created = await actor.createEmbeddedDocuments("Item", [source], { render: false });
    const createdAnchors = Array.isArray(created)
      ? created.filter((item) => item?.sourceId === anchor.uuid && item?.name === anchor.name)
      : [];
    if (createdAnchors.length !== 1) {
      throw new Error(`Acquisition tracer could not seed ${anchor.name}.`);
    }
    if (anchor.nativeAncestry) {
      await modules.createSingletonSystemGrantItems(actor, fixtureDraft, []);
    }
  }

  const nativeFixture = smokeCase.acquisitionCase?.nativeGrant?.fixture ?? null;
  if (nativeFixture) {
    const completion = await completeDraft(
      actor,
      fixtureDraft,
      {
        ...nativeFixture,
        ancestryName: smokeCase.acquisitionCase.nativeGrant.ancestry.name,
        heritageName: smokeCase.acquisitionCase.nativeGrant.heritage.name,
        className: nativeFixture.class.name,
      },
      modules,
      { skipStepIds: new Set(["starting-equipment-level-1"]) },
    );
    if (completion.classifications.length > 0 || completion.warnings.length > 0) {
      throw new Error(
        `Acquisition tracer native fixture did not complete deterministically: ${[
          ...completion.classifications,
          ...completion.warnings,
        ].join(" ")}`,
      );
    }
  }

  const physicalItems = modules.listActorItems(actor).filter((item) => item.isOfType?.("physical"));
  const nativeTarget = smokeCase.acquisitionCase?.nativeGrant?.target ?? null;
  const exactNativePhysical =
    nativeTarget &&
    physicalItems.length === 1 &&
    physicalItems[0]?.sourceId === nativeTarget.sourceUuid &&
    physicalItems[0]?.name === nativeTarget.name &&
    Number(physicalItems[0]?.quantity) === nativeTarget.quantity;
  if ((!nativeTarget && physicalItems.length > 0) || (nativeTarget && !exactNativePhysical) || Number(actor.inventory?.currency?.copperValue) !== 0) {
    throw new Error("Acquisition tracer base build must remain economically empty.");
  }
  const equipmentDraft = nativeTarget ? modules.createEmptyDraft(1) : fixtureDraft;
  if (nativeTarget) {
    equipmentDraft.selections["ancestry-level-1"] = structuredClone(
      fixtureDraft.selections["ancestry-level-1"],
    );
  }
  const initialPlan = await buildPlan(actor, equipmentDraft, modules);
  const nativeSkillStep = nativeFixture
    ? initialPlan.steps.find((step) => step.id === "skill-training-fighter-level-1" && step.kind === "skill-training")
    : null;
  if (nativeSkillStep && !fixtureDraft.skillTrainings[nativeSkillStep.slotId]) {
    await fillSkillTraining(
      actor,
      fixtureDraft,
      nativeSkillStep,
      {
        preferredSkills: nativeFixture.preferredSkills,
        preferredRuleChoices: nativeFixture.ruleSelections,
      },
      modules,
    );
  }
  const equipmentSteps = initialPlan.steps.filter(
    (step) => step.kind === "starting-equipment" && step.id === "starting-equipment-level-1",
  );
  if (equipmentSteps.length !== 1) {
    throw new Error("Acquisition tracer base build did not produce the exact level-1 equipment step.");
  }
  const precompletedStepIds = initialPlan.steps
    .filter((step) => step.id !== "starting-equipment-level-1")
    .map((step) => step.id)
    .sort();
  const state = modules.normalizeState(actor.getFlag(moduleId, "state"));
  if (state.lastAppliedAt !== null || state.completedAcquisitionManifest !== null) {
    throw new Error("Acquisition tracer base build unexpectedly contains prior Apply history.");
  }
  await actor.setFlag(moduleId, "state", {
    ...state,
    completedStepIds: [...new Set([...state.completedStepIds, ...precompletedStepIds])].sort(),
  });
  if (nativeTarget) await actor.setFlag(moduleId, "draft", equipmentDraft);
  const equipmentOnlyPlan = await buildPlan(actor, nativeTarget ? equipmentDraft : modules.createEmptyDraft(1), modules);
  if (
    equipmentOnlyPlan.steps.length !== 1 ||
    equipmentOnlyPlan.steps[0]?.id !== "starting-equipment-level-1" ||
    equipmentOnlyPlan.steps[0]?.kind !== "starting-equipment"
  ) {
    const shape = equipmentOnlyPlan.steps.map((step) => `${step.id}:${step.kind}`).join(", ");
    throw new Error(
      `Acquisition tracer fixture is not equipment-only after deterministic base-build setup: ${shape || "no steps"}.`,
    );
  }
  return precompletedStepIds;
}

globalThis.__prepareWayfinderAcquisitionTracer = async function prepareWayfinderAcquisitionTracer({
  allowDestructive = false,
  cases,
  expectedWorldId = "",
  fixturePrefix,
  moduleId,
  playerName,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Acquisition tracer setup requires destructive opt-in and an exact expected world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) throw new Error("Acquisition tracer setup must run as a current GM.");
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) throw new Error(`${moduleId} is not active in this world.`);
  const player = game.users.find(
    (candidate) => candidate.name === playerName && candidate.id !== game.user.id && !candidate.isGM,
  );
  if (!player) throw new Error("Acquisition tracer setup could not resolve the configured distinct non-GM player.");
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("Acquisition tracer setup requires cases.");
  const modules = await loadWayfinderModules(moduleId);
  const runtime = {
    foundryVersion: String(game.version ?? ""),
    pf2eVersion: String(game.system?.id === "pf2e" ? game.system.version ?? "" : ""),
    moduleVersion: String(moduleRecord.version ?? moduleRecord.manifest?.version ?? ""),
  };
  if (Object.values(runtime).some((value) => !value)) {
    throw new Error("Acquisition tracer setup requires exact Foundry, PF2E, and module versions.");
  }

  const fixtures = [];
  try {
    for (const smokeCase of cases) {
      const executorRole = smokeCase.acquisitionCase?.executorRole;
      const executorUser = executorRole === "gm-reviewer" ? game.user : player;
      if (!executorUser || !["non-gm-owner", "gm-reviewer"].includes(executorRole)) {
        throw new Error(`Acquisition tracer case ${smokeCase.id} has an unsupported executor role.`);
      }
      const fixtureName = `${fixturePrefix} - acquisition - ${runId} - ${smokeCase.id}`;
      const actor = await Actor.create({
        name: fixtureName,
        type: "character",
        ownership: {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
          [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        },
        system: { details: { level: { value: 1 } } },
        flags: {
          [moduleId]: {
            smokeAcquisitionTracer: {
              schemaVersion: 1,
              purpose: "acquisition-ui-smoke",
              runId,
              caseId: smokeCase.id,
              definitionFingerprint: smokeCase.definitionFingerprint,
              fixtureName,
              executorUserId: executorUser.id,
              executorRole,
              preparedByUserId: game.user.id,
              worldId: expectedWorldId,
              runtime,
            },
          },
        },
      });
      if (!actor) throw new Error(`Acquisition tracer could not create fixture ${smokeCase.id}.`);
      const fixture = {
        actorId: actor.id,
        caseId: smokeCase.id,
        definitionFingerprint: smokeCase.definitionFingerprint,
        fixtureName,
        executorUserId: executorUser.id,
        executorRole,
      };
      fixtures.push(fixture);
      const precompletedStepIds = await prepareAcquisitionBaseBuild(actor, modules, moduleId, smokeCase);
      fixture.precompletedStepIds = precompletedStepIds;
    }
  } catch (error) {
    for (const fixture of fixtures) {
      const actor = game.actors.get(fixture.actorId);
      const marker = actor?.getFlag(moduleId, "smokeAcquisitionTracer");
      if (actor && marker?.runId === runId && marker?.caseId === fixture.caseId) await actor.delete();
    }
    throw error;
  }
  return {
    fixtures,
    playerId: player.id,
    reviewSession: {
      userId: game.user.id,
      role: Number(game.user.role),
      isGM: Boolean(game.user.isGM),
      runtime: smokeRuntime(moduleRecord, expectedWorldId),
      reviewedCaseIds: [],
    },
    runtime: smokeRuntime(moduleRecord, expectedWorldId),
  };
};

globalThis.__runWayfinderAcquisitionTracer = async function runWayfinderAcquisitionTracer({
  cases,
  expectedExecutorId,
  expectedExecutorRole,
  expectedWorldId = "",
  fixtures,
  moduleId,
  runId,
}) {
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) throw new Error(`${moduleId} is not active in this world.`);
  const expectedIsGM = expectedExecutorRole === "gm-reviewer";
  if (
    !game.user ||
    game.user.id !== expectedExecutorId ||
    (expectedIsGM ? !game.user.isGM || Number(game.user.role) < 3 : game.user.isGM || Number(game.user.role) >= 3) ||
    !["non-gm-owner", "gm-reviewer"].includes(expectedExecutorRole) ||
    (cases ?? []).some((smokeCase) => smokeCase.acquisitionCase?.executorRole !== expectedExecutorRole) ||
    (fixtures ?? []).some(
      (fixture) =>
        fixture.executorRole !== expectedExecutorRole || fixture.executorUserId !== expectedExecutorId
    )
  ) {
    throw new Error("Acquisition tracer execution requires the exact configured owner or GM-review executor.");
  }
  const startedAt = new Date().toISOString();
  const modules = await loadWayfinderModules(moduleId);
  const fixturesByCase = new Map((fixtures ?? []).map((fixture) => [fixture.caseId, fixture]));
  const results = [];
  const driver = globalThis.__wayfinderAcquisitionSmokeDriver;
  try {
    for (const smokeCase of cases ?? []) {
      const fixture = fixturesByCase.get(smokeCase.id);
      const actor = fixture ? game.actors.get(fixture.actorId) : null;
      results.push(
        await runAcquisitionTracerCase({
          actor,
          fixture,
          moduleId,
          moduleRecord,
          modules,
          runId,
          smokeCase,
        }),
      );
    }
  } finally {
    driver?.revoke?.();
  }
  const summary = {
    classified: 0,
    failed: results.filter((entry) => entry.status === "fail").length,
    passed: results.filter((entry) => entry.status === "pass").length,
  };
  return {
    schemaVersion: 4,
    startedAt,
    finishedAt: new Date().toISOString(),
    foundryVersion: game.version ?? null,
    moduleActive: true,
    moduleId,
    moduleVersion: moduleRecord.version ?? moduleRecord.manifest?.version ?? null,
    pf2eVersion: game.system?.version ?? null,
    summary,
    user: {
      id: game.user.id,
      name: game.user.name,
      role: Number(game.user.role),
      isGM: Boolean(game.user.isGM),
    },
    world: game.world?.id ?? null,
    cases: results,
  };
};

globalThis.__collectWayfinderAcquisitionDurability = async function collectWayfinderAcquisitionDurability({
  cases,
  expectedWorldId = "",
  fixtures,
  moduleId,
  runId,
}) {
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) {
    throw new Error("Acquisition durability collection must run in the reloaded GM context.");
  }
  const moduleRecord = game.modules.get(moduleId);
  if (!moduleRecord?.active) throw new Error(`${moduleId} is not active in this world.`);
  const modules = await loadWayfinderModules(moduleId);
  const fixturesByCase = new Map((fixtures ?? []).map((fixture) => [fixture.caseId, fixture]));
  return (cases ?? []).map((smokeCase) => {
    const fixture = fixturesByCase.get(smokeCase.id);
    const actor = fixture ? game.actors.get(fixture.actorId) : null;
    const marker = actor?.getFlag(moduleId, "smokeAcquisitionTracer");
    if (
      !actor ||
      actor.name !== fixture?.fixtureName ||
      marker?.runId !== runId ||
      marker?.caseId !== smokeCase.id ||
      marker?.definitionFingerprint !== smokeCase.definitionFingerprint ||
      marker?.executorRole !== fixture?.executorRole ||
      marker?.executorUserId !== fixture?.executorUserId
    ) {
      throw new Error("Acquisition durability collection refused a fixture with changed guarded identity.");
    }
    const actorEvidence = collectActorEvidence(actor, modules, moduleId);
    const manifest = structuredClone(
      actorEvidence.moduleStateAfterApply?.completedAcquisitionManifest ?? null,
    );
    const durableItemIds = new Set([
      ...(manifest?.entries ?? []).flatMap((entry) =>
        (entry?.observedItems ?? []).map((observed) => observed?.actualItemId),
      ),
      ...(manifest?.classGrants ?? []).flatMap((classGrant) => classGrant?.observedItemIds ?? []),
    ]);
    const batchItems = actorEvidence.items.filter((item) => durableItemIds.has(item.id));
    return {
      schemaVersion: 1,
      source: "gm-context-page-reload",
      caseId: smokeCase.id,
      definitionFingerprint: smokeCase.definitionFingerprint,
      actorId: actor.id,
      runtime: smokeRuntime(moduleRecord, expectedWorldId),
      draft: structuredClone(actorEvidence.moduleDraftAfterApply),
      manifest,
      manifestCorrupt:
        actorEvidence.moduleStateAfterApply?.completedAcquisitionManifestCorrupt ?? null,
      currencyCopper: actorEvidence.currencyCopper,
      items: structuredClone(batchItems),
    };
  });
};

globalThis.__cleanupWayfinderAcquisitionTracer = async function cleanupWayfinderAcquisitionTracer({
  allowDestructive = false,
  expectedWorldId = "",
  fixtures,
  moduleId,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Acquisition tracer cleanup requires destructive opt-in and an exact expected world id.");
  }
  assertExpectedWorldId(game.world?.id, expectedWorldId);
  if (!game.user?.isGM) throw new Error("Acquisition tracer cleanup must run as a current GM.");
  const actors = (fixtures ?? []).map((fixture) => {
    const actor = game.actors.get(fixture.actorId);
    const marker = actor?.getFlag(moduleId, "smokeAcquisitionTracer");
    if (
      !actor ||
      actor.name !== fixture.fixtureName ||
      marker?.runId !== runId ||
      marker?.caseId !== fixture.caseId ||
      marker?.definitionFingerprint !== fixture.definitionFingerprint ||
      marker?.executorRole !== fixture.executorRole ||
      marker?.executorUserId !== fixture.executorUserId
    ) {
      throw new Error("Acquisition tracer cleanup refused a fixture that did not match its exact guarded identity.");
    }
    return actor;
  });
  for (const actor of actors) await actor.delete();
  return {
    exactFixturesMatched: true,
    actorsDeleted: actors.length,
    actorsMissingAfterCleanup: actors.every((actor) => !game.actors.has(actor.id)),
  };
};

async function runAcquisitionTracerCase({ actor, fixture, moduleId, moduleRecord, modules, runId, smokeCase }) {
  const failures = [];
  const warnings = [];
  if (!actor || !fixture) {
    return failedAcquisitionTracerCase(smokeCase, null, "Acquisition tracer fixture is missing.");
  }
  const marker = actor.getFlag(moduleId, "smokeAcquisitionTracer");
  if (
    marker?.runId !== runId ||
    marker?.caseId !== smokeCase.id ||
    marker?.definitionFingerprint !== smokeCase.definitionFingerprint ||
    marker?.executorRole !== smokeCase.acquisitionCase?.executorRole ||
    marker?.executorUserId !== game.user?.id
  ) {
    return failedAcquisitionTracerCase(smokeCase, collectActorEvidence(actor, modules, moduleId), "Acquisition tracer fixture identity changed.");
  }
  if (
    !actor.isOwner ||
    !actor.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) ||
    !actor.canUserModify?.(game.user, "update")
  ) {
    failures.push("Acquisition tracer actor is not updateable by the exact current smoke executor.");
  }
  const driver = globalThis.__wayfinderAcquisitionSmokeDriver;
  if (!driver || typeof driver.runCase !== "function") {
    failures.push("The installed feature build did not expose the acquisition UI smoke driver.");
  }
  const preCopper = Number(actor.inventory?.currency?.copperValue);
  let failureCapture = null;
  const retryCheckpoints = [];
  let driverResult = null;
  if (failures.length === 0) {
    try {
      driverResult = await driver.runCase({
        actor,
        caseDefinition: structuredClone(smokeCase),
        checkpointTarget: structuredClone(smokeCase.acquisitionCase?.failure ?? null),
        moduleId,
        onFailure: async (error) => {
          if (failureCapture) throw new Error("Acquisition UI smoke driver reported more than one failure boundary.");
          failureCapture = captureAcquisitionFailure(actor, modules, moduleId, error);
        },
        onRetryCheckpoint: (checkpoint) => {
          const summary = checkpointSummary(checkpoint);
          if (!summary || summary.kind !== "write") {
            throw new Error("Acquisition UI smoke driver reported a malformed retry write checkpoint.");
          }
          retryCheckpoints.push(summary);
        },
      });
    } catch (error) {
      failures.push(errorToString(error));
    }
  }
  const ui = driverResult?.ui;
  const requiredUiFields = [
    "actorSheetOpened",
    "launchControlClicked",
    "equipmentPaneOpened",
    "dispositionReviewed",
    "applyClicked",
    "completed",
  ];
  if (!ui || requiredUiFields.some((field) => ui[field] !== true)) {
    failures.push("Acquisition tracer did not prove the required actor-sheet and Wayfinder UI path.");
  }
  const lateAcknowledgement = smokeCase.acquisitionCase?.failure?.expectedPoint === "final-state-after";
  if (smokeCase.acquisitionCase?.failure && !lateAcknowledgement && ui?.retryClicked !== true) {
    failures.push("Acquisition tracer did not prove the UI retry action after its forced failure.");
  }
  if (
    smokeCase.acquisitionCase?.failure &&
    !lateAcknowledgement &&
    ["failureVisible", "partialStateVisible", "draftRecoveryVisible"].some(
      (field) => ui?.[field] !== true,
    )
  ) {
    failures.push(
      "Acquisition tracer did not prove that the owner saw the failure, partial state, and durable recovery state before retry.",
    );
  }
  if (
    lateAcknowledgement &&
    (ui?.lateAcknowledgementConverged !== true || ui?.retryClicked === true || ui?.draftRecoveryVisible === true)
  ) {
    failures.push("Acquisition tracer did not prove truthful durable convergence after the lost final acknowledgement.");
  }
  if (smokeCase.acquisitionCase?.failure && !failureCapture) {
    failures.push("Acquisition tracer did not observe its configured typed failure boundary.");
  }
  if (!smokeCase.acquisitionCase?.failure && failureCapture) {
    failures.push("Acquisition tracer observed an unexpected failure boundary.");
  }

  const actorEvidence = collectActorEvidence(actor, modules, moduleId);
  const manifest = structuredClone(actorEvidence.moduleStateAfterApply?.completedAcquisitionManifest ?? null);
  const runtime = smokeRuntime(moduleRecord, game.world?.id ?? "");
  const acquisition = acquisitionEvidenceFromActor({
    actorEvidence,
    failureCapture,
    manifest,
    preCopper,
    retryCheckpoints,
    runtime,
    smokeCase,
  });
  return {
    id: smokeCase.id,
    label: smokeCase.label,
    status: failures.length > 0 ? "fail" : "pass",
    actor: actorEvidence,
    classifications: [],
    evidence: {
      acquisition,
      acquisitionUi: structuredClone(ui ?? null),
      applyReview: emptyApplyReviewEvidence(),
    },
    failures,
    warnings,
  };
}

function captureAcquisitionFailure(actor, modules, moduleId, error) {
  const actorEvidence = collectActorEvidence(actor, modules, moduleId);
  const persistedDraft = actor.getFlag(moduleId, "draft");
  const manifest = actorEvidence.moduleStateAfterApply?.completedAcquisitionManifest ?? null;
  const batchId = persistedDraft?.acquisition?.batchId ?? manifest?.batchId ?? null;
  const actualItemIds = actorEvidence.items
    .filter((item) => item.acquisition?.batchId === batchId)
    .map((item) => item.id)
    .sort();
  const checkpoint = checkpointSummary(error?.checkpoint);
  return {
    checkpoint,
    point: acquisitionFailurePoint(checkpoint),
    batchId,
    afterItemIndex: checkpoint?.operation === "embedded-item-create" ? checkpoint.ordinal : null,
    currencyOperationIndex: checkpoint?.operation === "currency-convergence" && checkpoint.boundary === "after" ? checkpoint.ordinal : null,
    message: errorToString(error),
    actualItemIds,
    observedCurrencyCopper: actorEvidence.currencyCopper,
    manifestId: manifest?.id ?? null,
    draftPresent: persistedDraft !== null,
  };
}

function acquisitionEvidenceFromActor({ actorEvidence, failureCapture, manifest, preCopper, retryCheckpoints, runtime, smokeCase }) {
  const currency = manifest?.currency
    ? structuredClone(manifest.currency)
    : {
        preCopper,
        budgetCopper: null,
        targetCopper: null,
        observedCopper: actorEvidence.currencyCopper,
        spentCopper: null,
        remainingCopper: null,
      };
  const policy = manifest?.policy
    ? {
        source: "completed-acquisition-manifest",
        version: manifest.policy.version,
        fingerprint: manifest.policy.fingerprint,
        snapshot: structuredClone(manifest.policy),
      }
    : null;
  const finalBatchItemIds = manifest?.batchId
    ? actorEvidence.items
        .filter((item) => item.acquisition?.batchId === manifest.batchId)
        .map((item) => item.id)
        .sort()
    : [];
  const retry = failureCapture
    ? {
        attempted: failureCapture.point !== "final-state-after",
        converged: Boolean(manifest),
        batchId: failureCapture.batchId,
        manifestId: manifest?.id ?? null,
        draftPresentBeforeRetry: failureCapture.draftPresent,
        draftClearedAfterRetry: actorEvidence.moduleDraftAfterApply === null,
        preRetryItemIds: [...failureCapture.actualItemIds],
        postRetryItemIds: finalBatchItemIds,
        preRetryCurrencyCopper: failureCapture.observedCurrencyCopper,
        postRetryCurrencyCopper: actorEvidence.currencyCopper,
        checkpoints: retryCheckpoints.map((checkpoint) => structuredClone(checkpoint)),
      }
    : null;
  return {
    binding: {
      schemaVersion: 1,
      caseId: smokeCase.id,
      definitionFingerprint: smokeCase.definitionFingerprint,
      executorRole: smokeCase.acquisitionCase.executorRole,
      executorUserId: game.user.id,
      runtime: {
        foundryVersion: runtime.foundryVersion,
        pf2eVersion: runtime.pf2eVersion,
        moduleVersion: runtime.moduleVersion,
      },
    },
    policy,
    currency,
    durability: null,
    manifest,
    failureSnapshot: failureCapture ? structuredClone(failureCapture) : null,
    retry,
  };
}

function acquisitionFailurePoint(checkpoint) {
  if (checkpoint?.operation === "embedded-item-create" && checkpoint.boundary === "after") return "item-after";
  if (checkpoint?.operation === "currency-convergence") {
    return checkpoint.boundary === "before" ? "currency-before" : "currency-after";
  }
  if (checkpoint?.operation === "final-actor-update") {
    return checkpoint.boundary === "before" ? "final-state-before" : "final-state-after";
  }
  return null;
}

function failedAcquisitionTracerCase(smokeCase, actor, message) {
  return {
    id: smokeCase.id,
    label: smokeCase.label,
    status: "fail",
    actor,
    classifications: [],
    evidence: { acquisition: emptyAcquisitionEvidence(), applyReview: emptyApplyReviewEvidence() },
    failures: [message],
    warnings: [],
  };
}

async function loadWayfinderModules(moduleId) {
  const [
    draftService,
    actorInspector,
    planBuilder,
    buildState,
    packAccess,
    packOptions,
    pickerState,
    optionContext,
    skillPane,
    planService,
    actorUpdater,
    draftLifecycle,
    slotIds,
    slug,
    sourceId,
    spellRarityAccess,
    spellRarityAttestation,
    permissions,
    settings,
    wayfinderApp,
    foundryCompat,
    selectionApplication,
  ] = await Promise.all([
    import(`/modules/${moduleId}/scripts/draft-service.js`),
    import(`/modules/${moduleId}/scripts/actor-inspector.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/wayfinder-plan-builder-service.js`),
    import(`/modules/${moduleId}/scripts/build-state.js`),
    import(`/modules/${moduleId}/scripts/pack/access.js`),
    import(`/modules/${moduleId}/scripts/pack/options.js`),
    import(`/modules/${moduleId}/scripts/pack/picker-state.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/option-context-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/build-skill-pane-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/plan-service.js`),
    import(`/modules/${moduleId}/scripts/actor-updater.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/draft-lifecycle-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/slot-ids.js`),
    import(`/modules/${moduleId}/scripts/shared/slug.js`),
    import(`/modules/${moduleId}/scripts/shared/source-id.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/spell-choice/rarity-access.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/spell-choice/rarity-attestation.js`),
    import(`/modules/${moduleId}/scripts/permissions.js`),
    import(`/modules/${moduleId}/scripts/settings.js`),
    import(`/modules/${moduleId}/scripts/wayfinder-app.js`),
    import(`/modules/${moduleId}/scripts/shared/foundry-compat.js`),
    import(`/modules/${moduleId}/scripts/actor-updater/selection-application.js`),
  ]);

  return {
    applyDraftLifecycle: draftLifecycle.applyDraftLifecycle,
    applyDraftToActor: actorUpdater.applyDraftToActor,
    finalizeRecoveredDraftOnActor: actorUpdater.finalizeRecoveredDraftOnActor,
    buildAppliedSpellRarityAttestations: spellRarityAttestation.buildAppliedSpellRarityAttestations,
    buildApplyAttemptDraft: draftLifecycle.buildApplyAttemptDraft,
    buildSpellRarityAttestationReviewLines: spellRarityAttestation.buildSpellRarityAttestationReviewLines,
    buildOptionContext: optionContext.buildOptionContext,
    buildSkillPane: skillPane.buildSkillPane,
    buildWayfinderAppPlan: planBuilder.buildWayfinderAppPlan,
    createEmptyDraft: draftService.createEmptyDraft,
    createSpellRarityAttestation: spellRarityAttestation.createSpellRarityAttestation,
    assertCanUseWayfinder: permissions.assertCanUseWayfinder,
    canUseWayfinder: permissions.canUseWayfinder,
    evaluateSpellRarityAttestation: spellRarityAttestation.evaluateSpellRarityAttestation,
    frozenSpellRarityAttestationForStep: spellRarityAttestation.frozenSpellRarityAttestationForStep,
    extractDocumentSlug: slug.extractDocumentSlug,
    fetchSelectionDocument: packAccess.fetchSelectionDocument,
    getEffectiveBuildState: buildState.getEffectiveBuildState,
    getEffectiveSingletonDocument: buildState.getEffectiveSingletonDocument,
    getOptionsForStep: packOptions.getOptionsForStep,
    getSpellRarityCeilingSetting: settings.getSpellRarityCeilingSetting,
    hasApplyRecoveryState: draftLifecycle.hasApplyRecoveryState,
    getPickerBlockedState: pickerState.getPickerBlockedState,
    inspectActor: actorInspector.inspectActor,
    evaluateWayfinderStep: planService.evaluateWayfinderStep,
    isWizardArcaneSchoolSlotId: slotIds.isWizardArcaneSchoolSlotId,
    listActorItems: buildState.listActorItems,
    normalizeDraft: draftService.normalizeDraft,
    normalizeState: draftService.normalizeState,
    resolveUuid: foundryCompat.resolveUuid,
    createEmbeddedSource: selectionApplication.createEmbeddedSource,
    createSingletonSystemGrantItems: selectionApplication.createSingletonSystemGrantItems,
    listSpellRarityAttestationProblems: spellRarityAttestation.listSpellRarityAttestationProblems,
    listSpellRarityRecoveryProblems: spellRarityAttestation.listSpellRarityRecoveryProblems,
    resolveSelection: packOptions.resolveSelection,
    sourceIdOf: sourceId.sourceIdOf,
    withRestrictedSpellRarityAccess: spellRarityAccess.withRestrictedSpellRarityAccess,
    WayfinderApp: wayfinderApp.WayfinderApp,
  };
}

async function runSmokeCase(smokeCase, modules, { keepActors, moduleId, prefix }) {
  let actor = null;
  const warnings = [];
  const classifications = [];
  const failures = [];
  let applySafetyEvidence = null;

  try {
    actor = await Actor.create({
      name: `${prefix} - ${smokeCase.id}`,
      type: "character",
      ownership: fixtureOwnershipFor(game.user),
      system: { details: { level: { value: 1 } } },
    });
    await enforceFixtureOwnership(actor, game.user);
    await seedActorSkillRanks(actor, smokeCase);
    await seedActorItems(actor, smokeCase, failures);

    const draft = modules.createEmptyDraft(smokeCase.targetLevel);
    let draftForApply = draft;
    await seedCreationDraft(draft, smokeCase);
    console.log(`WFSMOKE ${smokeCase.id} fill start`);
    const fillResult = await completeDraft(actor, draft, smokeCase, modules);
    warnings.push(...fillResult.warnings);
    classifications.push(...fillResult.classifications);

    console.log(`WFSMOKE ${smokeCase.id} plan/apply start`);
    const plan = await buildPlan(actor, draft, modules);
    let stepsForApply = plan.steps;
    validateDraftPlanExpectations(plan.steps, draft, smokeCase, failures);
    const incompleteBeforeApply = await incompleteSteps(actor, draft, plan.steps, modules);
    if (incompleteBeforeApply.length > 0) {
      failures.push(`Incomplete before apply: ${incompleteBeforeApply.map((step) => step.slotId).join(", ")}`);
    }

    const dialogsBefore = dialogCount();
    await actor.setFlag(moduleId, "draft", draft);
    if (smokeCase.applySafetyFailureCheckpoint && failures.length === 0) {
      const probe = await runApplySafetyFailureProbe({
        actor,
        draft,
        failures,
        moduleId,
        modules,
        target: smokeCase.applySafetyFailureCheckpoint,
        steps: plan.steps,
        timeoutMs: smokeCase.applyTimeoutMs ?? 45000,
      });
      applySafetyEvidence = probe.evidence;
      if (probe.retryDraft) {
        draftForApply = probe.retryDraft;
        if (probe.evidence?.failureState?.expected === "pre-final") {
          const retryPlan = await buildPlan(actor, draftForApply, modules);
          stepsForApply = retryPlan.steps;
          draftForApply = modules.buildApplyAttemptDraft(draftForApply, stepsForApply);
          await actor.setFlag(moduleId, "draft", draftForApply);
          probe.evidence.failureState.recoveredPlanStepIds = stepsForApply.map((step) => step.slotId);
          probe.evidence.retryPlan = {
            strategy: "rebuild-from-recovered-draft",
            stepIds: stepsForApply.map((step) => step.slotId),
          };
        } else {
          probe.evidence.retryPlan = {
            strategy: "lost-ack-replay",
            stepIds: stepsForApply.map((step) => step.slotId),
          };
        }
      }
    }
    const applyOutcome = failures.length
      ? {
          lifecycleResult: { kind: "warning", warning: "missing-selections" },
          applyReview: emptyApplyReviewEvidence(),
        }
      : await applyCompletedDraft(actor, draftForApply, stepsForApply, modules, moduleId, {
          timeoutMs: smokeCase.applyTimeoutMs ?? 45000,
        });
    const { applyReview, lifecycleResult } = applyOutcome;

    await wait(1500);
    console.log(`WFSMOKE ${smokeCase.id} rerun check`);
    const dialogsAfter = dialogCount();
    const rerunDraft = modules.createEmptyDraft(smokeCase.targetLevel);
    const rerunPlan = await buildPlan(actor, rerunDraft, modules);
    const actorEvidence = collectActorEvidence(actor, modules, moduleId);
    if (applySafetyEvidence) {
      applySafetyEvidence.retry = {
        lifecycleKind: lifecycleResult.kind,
        draftCleared: actorEvidence.moduleDraftAfterApply === null,
        targetLevelReached: actorEvidence.levelAfterApply === smokeCase.targetLevel,
        rerunStepCount: rerunPlan.steps.length,
        preRetryItemIds: [...(applySafetyEvidence.failureState?.observedItemIds ?? [])],
        postRetryItemIds: actorEvidence.items.map((item) => item.id).sort(),
      };
    }
    validateAppliedCase({
      actorEvidence,
      dialogsAfter,
      dialogsBefore,
      failures,
      lifecycleResult,
      preStepIds: plan.steps.map((step) => step.slotId),
      rerunPlan,
      smokeCase,
    });
    validateApplyReviewEvidence(applyReview, smokeCase.expectedAppliedSpellRarityAttestations ?? [], failures);

    return {
      id: smokeCase.id,
      label: smokeCase.label,
      status: statusFor(failures, classifications),
      actor: actorEvidence,
      classifications,
      evidence: {
        acquisition: emptyAcquisitionEvidence(),
        dialogsAfter,
        dialogsBefore,
        fillIterations: fillResult.iterations,
        applyReview,
        applySafety: applySafetyEvidence,
        incompleteBeforeApply: incompleteBeforeApply.map(stepSummary),
        preStepIds: plan.steps.map((step) => step.slotId),
        rerunStepIds: rerunPlan.steps.map((step) => step.slotId),
        warnings,
      },
      failures,
      warnings,
    };
  } catch (error) {
    return {
      id: smokeCase.id,
      label: smokeCase.label,
      status: "fail",
      actor: actor ? collectActorEvidence(actor, modules, moduleId) : null,
      classifications,
      evidence: { acquisition: emptyAcquisitionEvidence(), applyReview: emptyApplyReviewEvidence() },
      failures: [errorToString(error)],
      warnings,
    };
  } finally {
    if (actor && !keepActors) {
      await actor.delete();
    }
  }
}

async function runApplySafetyFailureProbe({ actor, draft, failures, moduleId, modules, target, steps, timeoutMs }) {
  const checkpointId = String(target?.checkpointId ?? "");
  const occurrence = Number(target?.occurrence);
  const writeTarget = checkpointId.startsWith("write:");
  if (!checkpointId || !Number.isInteger(occurrence) || occurrence < 1 || (!writeTarget && occurrence !== 1)) {
    failures.push("Apply safety probe has an invalid checkpoint target.");
    return { evidence: null, retryDraft: null };
  }
  const preApplyLevelValue = actor.system?.details?.level?.value;
  const preApplyLevel = typeof preApplyLevelValue === "number" ? preApplyLevelValue : null;
  if (preApplyLevel === null) {
    failures.push("Apply safety probe could not capture the actor's pre-apply level.");
    return { evidence: null, retryDraft: null };
  }
  const preApplyModuleState = structuredClone(modules.normalizeState(actor.getFlag(moduleId, "state")));
  const preApplyItems = actorItemSnapshots(actor, modules);
  const preApplyItemIds = [...preApplyItems.keys()].sort();
  const applyContext = buildSpellRarityApplyContext(actor, draft, steps, modules);
  let matchingOccurrence = 0;
  let injectedCheckpoint = null;
  let caught = null;
  try {
    await withTimeout(
      modules.applyDraftLifecycle({
        actorName: actor.name,
        currentLevel: preApplyLevel,
        draft,
        steps,
        evaluateStep: (step) => evaluateStep(actor, draft, step, modules),
        additionalBlockers: applyContext.additionalBlockers,
        appliedSpellRarityAttestations: applyContext.appliedSpellRarityAttestations,
        reviewLines: applyContext.reviewLines,
        confirmApply: applyContext.confirmApply,
        beforeApply: async (applyAttemptDraft) => {
          modules.assertCanUseWayfinder(actor);
          await actor.setFlag(moduleId, "draft", applyAttemptDraft);
        },
        applyDraftToActor: (buildFinalActorUpdate) =>
          modules.applyDraftToActor(actor, draft, steps, {
            resolveFinalActorUpdate: buildFinalActorUpdate,
            beforeFinalActorUpdate: () => modules.assertCanUseWayfinder(actor),
            validateActorAuthority: modules.canUseWayfinder,
            spellRarityCeiling: modules.getSpellRarityCeilingSetting(),
            validateSelectionEligibility: (selection, step) =>
              validateSmokeSelectionEligibility(actor, draft, steps, selection, step, modules, moduleId),
            validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
            onCheckpoint: (checkpoint) => {
              if (checkpoint.checkpointId !== checkpointId) return;
              matchingOccurrence += 1;
              if (!injectedCheckpoint && matchingOccurrence === occurrence) {
                if (checkpoint.kind === "write" && checkpoint.ordinal !== occurrence) {
                  failures.push("Apply safety checkpoint occurrence did not match its write ordinal.");
                  return;
                }
                injectedCheckpoint = checkpointSummary(checkpoint);
                throw new Error("Intentional Wayfinder smoke failure.");
              }
            },
          }),
        now: () => new Date().toISOString(),
      }),
      timeoutMs,
      `${actor.name} intentional failure timed out`,
    );
  } catch (error) {
    caught = error;
  }

  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  const observedCheckpoint = checkpointSummary(caught?.checkpoint);
  const persistedDraft = actor.getFlag(moduleId, "draft");
  const persistedDraftHasIdentity =
    persistedDraft !== null &&
    typeof persistedDraft === "object" &&
    persistedDraft.version === draft.version &&
    persistedDraft.targetLevel === draft.targetLevel;
  const recoveredDraft =
    persistedDraftHasIdentity
      ? modules.normalizeDraft(persistedDraft, preApplyLevel)
      : null;
  const expectedDraft = modules.normalizeDraft(
    {
      ...draft,
      applyAttemptStepIds: Array.from(
        new Set([...(draft.applyAttemptStepIds ?? []), ...steps.map((step) => step.id)])
      ),
    },
    preApplyLevel
  );
  const draftRecovered = recoveredDraft !== null && JSON.stringify(recoveredDraft) === JSON.stringify(expectedDraft);
  const levelValue = actor.system?.details?.level?.value;
  const observedLevel = typeof levelValue === "number" ? levelValue : null;
  const observedModuleState = structuredClone(modules.normalizeState(actor.getFlag(moduleId, "state")));
  const stateLastTargetLevel =
    typeof observedModuleState.lastTargetLevel === "number" ? observedModuleState.lastTargetLevel : null;
  const observedItems = actorItemSnapshots(actor, modules);
  const observedItemIds = [...observedItems.keys()].sort();
  const postFinalCheckpoint =
    checkpointId === "write:final-actor-update:after" || checkpointId === "phase:finalize-actor:after";
  const failureState = {
    expected: postFinalCheckpoint ? "post-final" : "pre-final",
    preApplyLevel,
    observedLevel,
    draftPresent: persistedDraft !== null,
    draftMatchesAttempt: draftRecovered,
    preApplyItemIds,
    observedItemIds,
    changedItemIds: changedActorItemIds(preApplyItems, observedItems),
    preApplyModuleState,
    observedModuleState,
    stateLastTargetLevel,
  };
  if (
    !injectedCheckpoint ||
    observedCheckpoint?.checkpointId !== checkpointId ||
    !message.includes(`at ${checkpointId}`)
  ) {
    failures.push(`Apply safety probe did not report the injected ${checkpointId} checkpoint.`);
  }
  if (postFinalCheckpoint) {
    const completedStepIds = Array.isArray(observedModuleState.completedStepIds)
      ? observedModuleState.completedStepIds
      : [];
    if (
      persistedDraft !== null ||
      observedLevel !== draft.targetLevel ||
      stateLastTargetLevel !== draft.targetLevel ||
      typeof observedModuleState.lastAppliedAt !== "string" ||
      !Number.isFinite(Date.parse(observedModuleState.lastAppliedAt)) ||
      !steps.every((step) => completedStepIds.includes(step.id))
    ) {
      failures.push("Apply safety post-final checkpoint did not observe the durable finalized actor state.");
    }
  } else {
    if (
      !draftRecovered ||
      observedLevel === null ||
      observedLevel !== preApplyLevel ||
      JSON.stringify(observedModuleState) !== JSON.stringify(preApplyModuleState)
    ) {
      failures.push("Apply safety pre-final checkpoint did not recover the exact unchanged persisted draft state.");
    }
  }

  return {
    evidence: {
      target: { checkpointId, occurrence },
      matchingOccurrence,
      injectedCheckpoint,
      observedCheckpoint,
      failureKind: typeof caught?.failureKind === "string" ? caught.failureKind : null,
      completedReceipts: Array.isArray(caught?.completedReceipts)
        ? caught.completedReceipts.map(applyPhaseReceiptSummary)
        : [],
      partialReceipt: applyPhaseReceiptSummary(caught?.partialReceipt),
      failureState,
      message,
    },
    retryDraft: postFinalCheckpoint ? expectedDraft : draftRecovered ? recoveredDraft : null,
  };
}

function checkpointSummary(value) {
  if (
    !value ||
    typeof value.checkpointId !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.phase !== "string" ||
    typeof value.boundary !== "string"
  ) {
    return null;
  }
  const phaseCheckpoint = value.kind === "phase";
  const writeCheckpoint = value.kind === "write";
  if (
    (!phaseCheckpoint && !writeCheckpoint) ||
    (phaseCheckpoint &&
      value.operation !== undefined &&
      value.operation !== null) ||
    (phaseCheckpoint && value.ordinal !== undefined && value.ordinal !== null) ||
    (writeCheckpoint && (typeof value.operation !== "string" || !Number.isInteger(value.ordinal)))
  ) {
    return null;
  }
  return {
    checkpointId: value.checkpointId,
    kind: value.kind,
    phase: value.phase,
    boundary: value.boundary,
    operation: writeCheckpoint ? value.operation : null,
    ordinal: writeCheckpoint ? value.ordinal : null,
  };
}

function applyPhaseReceiptSummary(value) {
  if (!value || typeof value.phase !== "string") return null;
  const identityFields = [
    value.createdItemIds,
    value.deletedItemIds,
    value.updatedItemIds,
    value.actorUpdatePaths,
  ];
  if (
    identityFields.some(
      (entries) => !Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")
    )
  ) {
    return null;
  }
  return {
    phase: value.phase,
    createdItemIds: [...value.createdItemIds],
    deletedItemIds: [...value.deletedItemIds],
    updatedItemIds: [...value.updatedItemIds],
    actorUpdatePaths: [...value.actorUpdatePaths],
  };
}

function actorItemSnapshots(actor, modules) {
  return new Map(
    modules
      .listActorItems(actor)
      .flatMap((item) => {
        const id = item?.id;
        if (typeof id !== "string" || id.length === 0) return [];
        const source = typeof item.toObject === "function" ? item.toObject() : item;
        return [[id, JSON.stringify(source)]];
      })
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
  );
}

function changedActorItemIds(before, after) {
  return [...before.keys()]
    .filter((itemId) => after.has(itemId) && before.get(itemId) !== after.get(itemId))
    .sort();
}

async function runIncrementalExistingCase(smokeCase, modules, { keepActors, moduleId, prefix }) {
  let actor = null;
  const warnings = [];
  const classifications = [];
  const failures = [];

  try {
    actor = await Actor.create({
      name: `${prefix} - incremental - ${smokeCase.id}`,
      type: "character",
      ownership: fixtureOwnershipFor(game.user),
      system: { details: { level: { value: 1 } } },
    });
    await enforceFixtureOwnership(actor, game.user);

    const initialCase = { ...smokeCase, targetLevel: 1 };
    const initialDraft = modules.createEmptyDraft(initialCase.targetLevel);
    await seedCreationDraft(initialDraft, initialCase);
    const initialFill = await completeDraft(actor, initialDraft, initialCase, modules);
    warnings.push(...initialFill.warnings.map((entry) => `initial: ${entry}`));
    classifications.push(...initialFill.classifications.map((entry) => `initial: ${entry}`));

    const initialPlan = await buildPlan(actor, initialDraft, modules);
    const initialIncomplete = await incompleteSteps(actor, initialDraft, initialPlan.steps, modules);
    if (initialIncomplete.length > 0) {
      failures.push(`Initial incomplete before apply: ${initialIncomplete.map((step) => step.slotId).join(", ")}`);
    }

    const dialogsBefore = dialogCount();
    await actor.setFlag(moduleId, "draft", initialDraft);
    const initialApplyOutcome = failures.length
      ? {
          lifecycleResult: { kind: "warning", warning: "missing-selections" },
          applyReview: emptyApplyReviewEvidence(),
        }
      : await applyCompletedDraft(actor, initialDraft, initialPlan.steps, modules, moduleId);
    const initialLifecycleResult = initialApplyOutcome.lifecycleResult;
    if (initialLifecycleResult.kind !== "applied") {
      failures.push(`Initial apply lifecycle returned ${initialLifecycleResult.kind}`);
    }

    const incrementalDraft = modules.createEmptyDraft(smokeCase.targetLevel);
    const incrementalFill = await completeDraft(actor, incrementalDraft, smokeCase, modules);
    warnings.push(...incrementalFill.warnings.map((entry) => `incremental: ${entry}`));
    classifications.push(...incrementalFill.classifications.map((entry) => `incremental: ${entry}`));

    const incrementalPlan = await buildPlan(actor, incrementalDraft, modules);
    console.log(
      `WFSMOKE ${smokeCase.id} incremental plan ${incrementalPlan.steps.map((step) => step.slotId).join(",")}`,
    );
    const incrementalIncomplete = await incompleteSteps(actor, incrementalDraft, incrementalPlan.steps, modules);
    if (incrementalIncomplete.length > 0) {
      failures.push(
        `Incremental incomplete before apply: ${incrementalIncomplete.map((step) => step.slotId).join(", ")}`,
      );
    }
    if (incrementalPlan.steps.length === 0) {
      failures.push("Incremental rerun produced no level-up steps.");
    }

    await actor.setFlag(moduleId, "draft", incrementalDraft);
    const incrementalApplyOutcome = failures.length
      ? {
          lifecycleResult: { kind: "warning", warning: "missing-selections" },
          applyReview: emptyApplyReviewEvidence(),
        }
      : await applyCompletedDraft(actor, incrementalDraft, incrementalPlan.steps, modules, moduleId);
    const incrementalLifecycleResult = incrementalApplyOutcome.lifecycleResult;
    validateApplyReviewEvidence(
      incrementalApplyOutcome.applyReview,
      (smokeCase.expectedAppliedSpellRarityAttestations ?? []).filter(
        (attestation) => attestation.stepLevel > 1,
      ),
      failures,
    );

    await wait(1500);
    const dialogsAfter = dialogCount();
    const rerunDraft = modules.createEmptyDraft(smokeCase.targetLevel);
    const rerunPlan = await buildPlan(actor, rerunDraft, modules);
    const actorEvidence = collectActorEvidence(actor, modules, moduleId);
    validateIncrementalCase({
      actorEvidence,
      dialogsAfter,
      dialogsBefore,
      failures,
      initialLifecycleResult,
      initialStepIds: initialPlan.steps.map((step) => step.slotId),
      incrementalLifecycleResult,
      incrementalStepIds: incrementalPlan.steps.map((step) => step.slotId),
      rerunPlan,
      smokeCase,
    });

    return {
      id: `${smokeCase.id}-incremental-existing`,
      label: `${smokeCase.label} incremental existing-character rerun`,
      status: statusFor(failures, classifications),
      actor: actorEvidence,
      classifications,
      evidence: {
        acquisition: emptyAcquisitionEvidence(),
        applyReview: incrementalApplyOutcome.applyReview,
        dialogsAfter,
        dialogsBefore,
        incrementalIncompleteBeforeApply: incrementalIncomplete.map(stepSummary),
        incrementalStepIds: incrementalPlan.steps.map((step) => step.slotId),
        initialIncompleteBeforeApply: initialIncomplete.map(stepSummary),
        initialStepIds: initialPlan.steps.map((step) => step.slotId),
        rerunStepIds: rerunPlan.steps.map((step) => step.slotId),
        warnings,
      },
      failures,
      warnings,
    };
  } catch (error) {
    return {
      id: `${smokeCase.id}-incremental-existing`,
      label: `${smokeCase.label} incremental existing-character rerun`,
      status: "fail",
      actor: actor ? collectActorEvidence(actor, modules, moduleId) : null,
      classifications,
      evidence: { acquisition: emptyAcquisitionEvidence(), applyReview: emptyApplyReviewEvidence() },
      failures: [errorToString(error)],
      warnings,
    };
  } finally {
    if (actor && !keepActors) {
      await actor.delete();
    }
  }
}

async function seedCreationDraft(draft, smokeCase) {
  draft.selections["ancestry-level-1"] = await selectionRef(
    "pf2e.ancestries",
    smokeCase.ancestryName ?? "Human",
    "ancestry-level-1",
  );
  draft.selections["heritage-level-1"] = await selectionRef(
    "pf2e.heritages",
    smokeCase.heritageName ?? "Wintertouched Human",
    "heritage-level-1",
  );
  draft.selections["background-level-1"] = await selectionRef(
    "pf2e.backgrounds",
    smokeCase.backgroundName ?? "Acolyte",
    "background-level-1",
  );
  draft.selections["class-level-1"] = await selectionRef("pf2e.classes", smokeCase.className, "class-level-1");
  if (smokeCase.deityName) {
    draft.selections["deity-level-1"] = await selectionRef("pf2e.deities", smokeCase.deityName, "deity-level-1");
  }

  const ancestryBoosts = uniqueAbilities([smokeCase.keyAbility, "dex", "con"]);
  draft.boosts.ancestry.modeTouched = true;
  draft.boosts.ancestry.selectedBoosts = smokeCase.ancestryBoosts ?? {
    "0": ancestryBoosts[0],
    "1": ancestryBoosts[1],
  };
  draft.boosts.background.selectedBoosts = smokeCase.backgroundBoosts ?? {
    "0": "wis",
    "1": "con",
  };
  draft.boosts.class.keyAbility = smokeCase.keyAbility;
  draft.boosts.levels["1"] = levelBoosts(smokeCase.keyAbility);
  if (draft.targetLevel >= 5 && !smokeCase.gradualBoostsVariant) {
    draft.boosts.levels["5"] = levelBoosts(smokeCase.keyAbility);
  }
}

async function completeDraft(actor, draft, smokeCase, modules, { skipStepIds = new Set() } = {}) {
  const warnings = [];
  let classifications = [];
  let iterations = 0;

  for (; iterations < 12; iterations += 1) {
    classifications = [];
    const plan = await buildPlan(actor, draft, modules);
    let changed = false;
    let refreshAfterStep = null;

    for (const step of plan.steps) {
      if (skipStepIds.has(step.slotId) || (await isStepComplete(actor, draft, step, modules))) {
        continue;
      }

      const before = JSON.stringify(draft);
      await fillStep(actor, draft, step, plan.steps, smokeCase, modules, { classifications, warnings });
      const stepChanged = before !== JSON.stringify(draft);
      changed = changed || stepChanged;
      if (stepChanged && requiresPlanRefresh(step)) {
        refreshAfterStep = step;
        break;
      }
    }

    const nextPlan = await buildPlan(actor, draft, modules);
    if (refreshAfterStep) {
      await logCurriculumPlanRefresh(
        actor,
        draft,
        plan.steps,
        nextPlan.steps,
        refreshAfterStep,
        smokeCase,
        modules,
      );
    }
    const remaining = (await incompleteSteps(actor, draft, nextPlan.steps, modules)).filter(
      (step) => !skipStepIds.has(step.slotId),
    );
    if (remaining.length === 0) {
      return { classifications, iterations: iterations + 1, warnings };
    }

    if (!changed) {
      warnings.push(`Could not auto-complete: ${remaining.map((step) => step.slotId).join(", ")}`);
      return { classifications, iterations: iterations + 1, warnings };
    }
  }

  warnings.push("Draft fill reached iteration limit.");
  return { classifications, iterations, warnings };
}

function requiresPlanRefresh(step) {
  return ["class-archetype", "class-branch", "class-choice", "singleton-choice"].includes(step.kind);
}

async function fillStep(actor, draft, step, planSteps, smokeCase, modules, notes) {
  switch (step.kind) {
    case "pick-item":
    case "class-branch": {
      const optionContext = await buildPickerContext(actor, draft, step, planSteps, modules);
      const blocked = modules.getPickerBlockedState(step, optionContext);
      if (blocked) {
        notes.classifications.push(`${step.slotId}: picker blocked: ${blocked.title}`);
        return;
      }
      const options = await modules.getOptionsForStep(step, optionContext);
      assertExpectedPickerOptions(options, step, smokeCase, optionContext, draft);
      const option = pickOption(options, step, smokeCase);
      if (!option) {
        notes.classifications.push(`${step.slotId}: no live compendium option matched supported filters`);
        return;
      }

      const resolved = await modules.resolveSelection(option.value, step, optionContext);
      if (!resolved) {
        notes.warnings.push(`${step.slotId}: option ${option.name} could not resolve`);
        return;
      }

      if (step.kind === "class-branch") {
        draft.branchSelections[step.slotId] = resolved;
      } else {
        draft.selections[step.slotId] = resolved;
      }
      return;
    }
    case "class-choice": {
      const option = pickInlineOption(step.classChoice.options, step, smokeCase);
      if (option) {
        draft.classChoices[step.slotId] = option.value;
      }
      return;
    }
    case "class-archetype": {
      const option = pickInlineOption(step.classArchetype.options, step, smokeCase);
      if (option) {
        draft.classArchetypeChoices[step.slotId] = option.value;
      }
      return;
    }
    case "singleton-choice": {
      const option = pickInlineOption(step.singletonChoice.options, step, smokeCase);
      if (option) {
        draft.singletonChoices[step.slotId] = option.value;
      }
      return;
    }
    case "language-choice": {
      const values = step.languageChoice.options.map((option) => option.value).slice(0, step.languageChoice.count);
      if (values.length === step.languageChoice.count) {
        draft.languageChoices[step.slotId] = values;
      }
      return;
    }
    case "spell-choice": {
      assertExpectedSpellChoiceCount(step, smokeCase);
      const optionContext = await buildPickerContext(actor, draft, step, planSteps, modules);
      const attestationConfig = smokeCase.spellRarityAttestations?.[step.slotId];
      const worldRarityCeiling = modules.getSpellRarityCeilingSetting();
      if (attestationConfig && !draft.spellRarityAttestations[step.slotId]) {
        if (worldRarityCeiling !== attestationConfig.expectedWorldRarityCeiling) {
          throw new Error(
            `${step.slotId}: expected spell rarity ceiling ${attestationConfig.expectedWorldRarityCeiling}, observed ${worldRarityCeiling}.`,
          );
        }
        const restrictedSpellUuid = String(attestationConfig.expectedRestrictedSpellUuid ?? "").toLowerCase();
        const optionsBeforeAttestation = await modules.getOptionsForStep(step, optionContext);
        if (
          !restrictedSpellUuid ||
          optionsBeforeAttestation.some((option) => option.uuid.toLowerCase() === restrictedSpellUuid)
        ) {
          throw new Error(`${step.slotId}: restricted spell was eligible before the player attestation.`);
        }
        draft.spellRarityAttestations[step.slotId] = modules.createSpellRarityAttestation({
          actorId: actor.id,
          step,
          targetLevel: draft.targetLevel,
          worldRarityCeiling,
          claimedBasis: attestationConfig.claimedBasis,
          reason: attestationConfig.reason,
          authorUserId: game.user.id,
          authorName: game.user.name,
          attestedAt: new Date().toISOString(),
        });
      }
      const effectiveStep = modules.withRestrictedSpellRarityAccess(
        step,
        worldRarityCeiling,
        modules.evaluateSpellRarityAttestation(actor.id, draft, step, worldRarityCeiling).granted,
      );
      const blocked = modules.getPickerBlockedState(effectiveStep, optionContext);
      if (blocked) {
        notes.classifications.push(`${step.slotId}: picker blocked: ${blocked.title}`);
        return;
      }
      const options = await modules.getOptionsForStep(effectiveStep, optionContext);
      if (
        attestationConfig?.expectedRestrictedSpellUuid &&
        !options.some(
          (option) =>
            option.uuid.toLowerCase() === String(attestationConfig.expectedRestrictedSpellUuid).toLowerCase(),
        )
      ) {
        throw new Error(`${step.slotId}: attested restricted spell did not become eligible.`);
      }
      if (isCurriculumSpellChoiceStep(step)) {
        console.log(
          `WFSMOKE ${smokeCase.id} curriculum fill ${step.slotId} ${JSON.stringify({
            curriculumSpellNames: step.spellChoice.curriculumSpellNames,
            optionsLength: options.length,
          })}`,
        );
      }
      if (options.length === 0) {
        notes.classifications.push(`${step.slotId}: spell progression is PF2E-native/manual for this live data shape`);
        return;
      }

      const selectedOptions = pickOptions(options, step, smokeCase, step.spellChoice.count);
      const selections = (
        await Promise.all(
          selectedOptions.map((option) => modules.resolveSelection(option.value, effectiveStep, optionContext)),
        )
      ).filter(Boolean);
      if (selections.length === step.spellChoice.count) {
        draft.spellChoices[step.slotId] = selections;
      } else {
        notes.warnings.push(`${step.slotId}: only ${selections.length} of ${step.spellChoice.count} spells resolved`);
      }
      return;
    }
    case "skill-training":
      await fillSkillTraining(actor, draft, step, smokeCase, modules);
      return;
    case "skill-increase":
      await fillSkillIncrease(actor, draft, step, smokeCase, modules);
      return;
    case "boost": {
      const batchLevel = String(step.boost?.batchLevel ?? step.level);
      const requiredCount = Number(step.boost?.requiredCount ?? 4);
      const selected = [...(draft.boosts.levels[batchLevel] ?? [])];
      for (const ability of levelBoosts(smokeCase.keyAbility)) {
        if (selected.length >= requiredCount) break;
        if (!selected.includes(ability)) selected.push(ability);
      }
      draft.boosts.levels[batchLevel] = selected.slice(0, requiredCount);
      return;
    }
    case "manual":
      notes.classifications.push(`${step.slotId}: manual PF2E-native checkpoint`);
      return;
  }
}

async function logCurriculumPlanRefresh(
  actor,
  draft,
  staleSteps,
  refreshedSteps,
  refreshedAfterStep,
  smokeCase,
  modules,
) {
  const staleStepsBySlotId = new Map(staleSteps.map((step) => [step.slotId, step]));

  for (const refreshedStep of refreshedSteps) {
    if (!isCurriculumSpellChoiceStep(refreshedStep)) {
      continue;
    }

    const staleStep = staleStepsBySlotId.get(refreshedStep.slotId);
    if (!isCurriculumSpellChoiceStep(staleStep)) {
      continue;
    }

    const staleNames = staleStep.spellChoice.curriculumSpellNames;
    const refreshedNames = refreshedStep.spellChoice.curriculumSpellNames;
    if (JSON.stringify(staleNames) === JSON.stringify(refreshedNames)) {
      continue;
    }

    const [staleContext, refreshedContext] = await Promise.all([
      buildPickerContext(actor, draft, staleStep, staleSteps, modules),
      buildPickerContext(actor, draft, refreshedStep, refreshedSteps, modules),
    ]);
    const [staleOptions, refreshedOptions] = await Promise.all([
      modules.getOptionsForStep(staleStep, staleContext),
      modules.getOptionsForStep(refreshedStep, refreshedContext),
    ]);
    console.log(
      `WFSMOKE ${smokeCase.id} curriculum refresh ${refreshedStep.slotId} ${JSON.stringify({
        refreshedAfterStep: refreshedAfterStep.slotId,
        stale: {
          curriculumSpellNames: staleNames,
          optionsLength: staleOptions.length,
        },
        refreshed: {
          curriculumSpellNames: refreshedNames,
          optionsLength: refreshedOptions.length,
        },
      })}`,
    );
  }
}

function assertExpectedSpellChoiceCount(step, smokeCase) {
  const expected = smokeCase.expectedSpellChoiceCounts?.[step.slotId];
  if (expected === undefined) {
    return;
  }

  if (step.spellChoice.count !== expected) {
    throw new Error(`${step.slotId} requires ${step.spellChoice.count} spells, expected ${expected}.`);
  }
}

function isCurriculumSpellChoiceStep(step) {
  return (
    step?.kind === "spell-choice" &&
    step.spellChoice.dependsOn === "class-branch" &&
    step.spellChoice.requiresCurriculum !== false
  );
}

function assertExpectedPickerOptions(options, step, smokeCase, optionContext, draft) {
  const expectation = smokeCase.expectedPickerOptions?.[step.slotId];
  if (!expectation) {
    return;
  }

  const optionNames = new Set(options.map((option) => option.name));
  const missing = (expectation.present ?? []).filter((name) => !optionNames.has(name));
  const forbidden = (expectation.absent ?? []).filter((name) => optionNames.has(name));
  if (missing.length > 0 || forbidden.length > 0) {
    const available = Array.from(optionNames).sort((left, right) => left.localeCompare(right));
    throw new Error(
      [
        `${step.slotId} picker legality expectation failed.`,
        missing.length > 0 ? `Missing: ${missing.join(", ")}.` : "",
        forbidden.length > 0 ? `Unexpected: ${forbidden.join(", ")}.` : "",
        `Available (${available.length}): ${available.join(", ") || "none"}.`,
        `Projected archetypes: ${JSON.stringify(optionContext.projectedArchetypeFeats ?? [])}.`,
        `Draft feats: ${JSON.stringify(
          Object.fromEntries(
            Object.entries(draft.selections)
              .filter(([, selection]) => selection?.itemType === "feat")
              .map(([slotId, selection]) => [slotId, selection.name]),
          ),
        )}.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  if (step.kind !== "spell-choice") {
    return;
  }

  const optionRanks = options
    .map((option) => Number(option.level))
    .filter((rank) => Number.isInteger(rank) && rank >= 0);
  const highestRank = optionRanks.length > 0 ? Math.max(...optionRanks) : null;
  const rankFailures = [
    expectation.minRank !== undefined && step.spellChoice.minRank !== expectation.minRank
      ? `step min rank ${step.spellChoice.minRank}, expected ${expectation.minRank}`
      : "",
    expectation.maxRank !== undefined && step.spellChoice.maxRank !== expectation.maxRank
      ? `step max rank ${step.spellChoice.maxRank}, expected ${expectation.maxRank}`
      : "",
    expectation.highestRank !== undefined && highestRank !== expectation.highestRank
      ? `highest offered rank ${highestRank ?? "missing"}, expected ${expectation.highestRank}`
      : "",
  ].filter(Boolean);
  if (rankFailures.length > 0) {
    throw new Error(`${step.slotId} spell-rank expectation failed: ${rankFailures.join("; ")}.`);
  }
}

async function buildPlan(actor, draft, modules) {
  const snapshot = modules.inspectActor(actor);
  return modules.buildWayfinderAppPlan({
    actor,
    snapshot,
    draft,
    resolveArcaneSchoolDocument: () => resolveArcaneSchoolDocument(actor, draft, modules),
    resolveDocument: (itemType) => modules.getEffectiveSingletonDocument(actor, draft, itemType),
    localize: (value) => game.i18n.localize(value),
  });
}

async function resolveArcaneSchoolDocument(actor, draft, modules) {
  const draftSelection = Object.values(draft.branchSelections).find((selection) =>
    modules.isWizardArcaneSchoolSlotId(selection.slotId),
  );
  if (draftSelection) {
    return modules.fetchSelectionDocument(draftSelection);
  }

  return (
    modules.listActorItems(actor).find((item) => {
      const tags = Array.isArray(item?.system?.traits?.otherTags) ? item.system.traits.otherTags : [];
      return tags.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "wizard-arcane-school");
    }) ?? null
  );
}

async function buildPickerContext(actor, draft, step, planSteps, modules) {
  const snapshot = modules.inspectActor(actor);
  return modules.buildOptionContext({
    draft,
    steps: planSteps,
    excludedFeatSlotId: step.slotId,
    maximumFeatLevel: step.level,
    skillRanks: snapshot.skillRanks,
    resolveDocument: (itemType) => modules.getEffectiveSingletonDocument(actor, draft, itemType),
    listActorItems: () => modules.listActorItems(actor),
    fetchSelectionDocument: modules.fetchSelectionDocument,
    extractDocumentSlug: modules.extractDocumentSlug,
  });
}

async function isStepComplete(actor, draft, step, modules) {
  return (await evaluateStep(actor, draft, step, modules)).complete;
}

async function evaluateStep(actor, draft, step, modules) {
  const effectiveBuildState = await modules.getEffectiveBuildState(actor, draft);
  return modules.evaluateWayfinderStep(step, draft, new Set(), effectiveBuildState);
}

async function incompleteSteps(actor, draft, steps, modules) {
  const results = [];
  for (const step of steps) {
    if (!(await isStepComplete(actor, draft, step, modules))) {
      results.push(step);
    }
  }
  return results;
}

function buildSpellRarityApplyContext(actor, draft, steps, modules) {
  const worldRarityCeiling = modules.getSpellRarityCeilingSetting();
  const recovering = modules.hasApplyRecoveryState(draft);
  const computed = modules.buildAppliedSpellRarityAttestations(
    actor.id,
    draft,
    recovering ? undefined : steps,
    recovering ? undefined : worldRarityCeiling,
  );
  const appliedSpellRarityAttestations =
    recovering && draft.applySpellRarityAttestations.length > 0
      ? structuredClone(draft.applySpellRarityAttestations)
      : computed;
  const problems = recovering
    ? modules.listSpellRarityRecoveryProblems(actor.id, draft)
    : modules.listSpellRarityAttestationProblems(actor.id, draft, steps, worldRarityCeiling);
  const additionalBlockers = problems.map((problem) => ({
    code: "access-attestation",
    stepId: problem.stepId,
    slotId: problem.slotId,
    title: problem.title,
    message: problem.message,
  }));
  const reviewLines = modules.buildSpellRarityAttestationReviewLines(appliedSpellRarityAttestations);
  const applyReview = emptyApplyReviewEvidence(reviewLines);
  return {
    additionalBlockers,
    appliedSpellRarityAttestations,
    applyReview,
    confirmApply(message) {
      applyReview.confirmationMessage = typeof message === "string" ? message : null;
      return true;
    },
    reviewLines,
  };
}

function emptyApplyReviewEvidence(reviewLines = []) {
  return {
    confirmationMessage: null,
    reviewLines: [...reviewLines],
  };
}

function validateApplyReviewEvidence(applyReview, expectedAttestations, failures) {
  const expectedCount = Array.isArray(expectedAttestations) ? expectedAttestations.length : 0;
  if (
    typeof applyReview?.confirmationMessage !== "string" ||
    !Array.isArray(applyReview?.reviewLines) ||
    applyReview.reviewLines.length !== expectedCount ||
    !applyReview.reviewLines.every((line) => applyReview.confirmationMessage.includes(line)) ||
    (expectedCount > 0 && !applyReview.confirmationMessage.includes("Player attestation — not GM authorization"))
  ) {
    failures.push("Apply confirmation did not prove the complete spell-attestation review disclosure.");
  }
}

async function validateSmokeSelectionEligibility(actor, draft, steps, selection, step, modules, moduleId) {
  const normalizedUuid = String(selection?.uuid ?? "").trim().toLowerCase();
  if (!normalizedUuid) return false;
  const alreadyApplied = modules.listActorItems(actor).some((item) => {
    if (String(modules.sourceIdOf(item) ?? "").trim().toLowerCase() !== normalizedUuid) return false;
    return item.flags?.[moduleId]?.slotId === selection.slotId;
  });
  if (alreadyApplied) return true;
  if ((step.kind !== "pick-item" && step.kind !== "class-branch" && step.kind !== "spell-choice") || !step.filters) {
    return true;
  }

  const recovering = modules.hasApplyRecoveryState(draft);
  let spellRarityCeiling = modules.getSpellRarityCeilingSetting();
  if (recovering && step.kind === "spell-choice" && draft.spellRarityAttestations[step.slotId]) {
    const frozen = modules.frozenSpellRarityAttestationForStep(actor.id, draft, step);
    if (frozen) {
      spellRarityCeiling = frozen.subject.worldRarityCeiling;
    } else if (spellRarityCeiling !== "unique") {
      return false;
    }
  }
  const optionContext = await buildPickerContext(actor, draft, step, steps, modules);
  const effectiveStep =
    step.kind === "spell-choice"
      ? modules.withRestrictedSpellRarityAccess(
          step,
          spellRarityCeiling,
          modules.evaluateSpellRarityAttestation(actor.id, draft, step, spellRarityCeiling).granted,
        )
      : step;
  const options = await modules.getOptionsForStep(effectiveStep, optionContext);
  return options.some((option) => option.uuid.trim().toLowerCase() === normalizedUuid);
}

async function applyCompletedDraft(actor, draft, steps, modules, moduleId, { timeoutMs = 45000 } = {}) {
  const snapshot = modules.inspectActor(actor);
  const applyContext = buildSpellRarityApplyContext(actor, draft, steps, modules);
  const lifecycleResult = await withTimeout(
    modules.applyDraftLifecycle({
      actorName: actor.name,
      currentLevel: snapshot.level,
      draft,
      existingCompletedStepIds: readActorCompletedStepIds(actor, moduleId),
      steps,
      evaluateStep: (step) => evaluateStep(actor, draft, step, modules),
      additionalBlockers: applyContext.additionalBlockers,
      appliedSpellRarityAttestations: applyContext.appliedSpellRarityAttestations,
      reviewLines: applyContext.reviewLines,
      confirmApply: applyContext.confirmApply,
      beforeApply: async (applyAttemptDraft) => {
        modules.assertCanUseWayfinder(actor);
        await actor.setFlag(moduleId, "draft", applyAttemptDraft);
      },
      applyDraftToActor: (buildFinalActorUpdate) =>
        modules.applyDraftToActor(actor, draft, steps, {
          resolveFinalActorUpdate: () =>
            buildFinalActorUpdate(modules.normalizeState(actor.getFlag(moduleId, "state"))),
          beforeFinalActorUpdate: () => modules.assertCanUseWayfinder(actor),
          validateActorAuthority: modules.canUseWayfinder,
          spellRarityCeiling: modules.getSpellRarityCeilingSetting(),
          validateSelectionEligibility: (selection, step) =>
            validateSmokeSelectionEligibility(actor, draft, steps, selection, step, modules, moduleId),
          validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
        }),
      finalizeRecoveredDraft: (recoveryActorUpdate, buildFinalActorUpdate) =>
        modules.finalizeRecoveredDraftOnActor(actor, {
          beforeFinalize: () => modules.assertCanUseWayfinder(actor),
          beforeFinalActorUpdate: () => modules.assertCanUseWayfinder(actor),
          recoveryActorUpdate,
          resolveFinalActorUpdate: () =>
            buildFinalActorUpdate(modules.normalizeState(actor.getFlag(moduleId, "state"))),
          validateActorAuthority: modules.canUseWayfinder,
        }),
      now: () => new Date().toISOString(),
    }),
    timeoutMs,
    `${actor.name} apply timed out`,
  );
  return { applyReview: applyContext.applyReview, lifecycleResult };
}

function readActorCompletedStepIds(actor, moduleId) {
  const completedStepIds = actor.getFlag(moduleId, "state")?.completedStepIds;
  return Array.isArray(completedStepIds)
    ? completedStepIds.filter((stepId) => typeof stepId === "string")
    : [];
}

async function fillSkillTraining(actor, draft, step, smokeCase, modules) {
  const preferred = smokeCase.preferredSkills ?? [];
  const used = new Set([...step.training.fixedSkills]);
  const ruleChoices = {};
  const loreChoices = {};
  const additional = [];
  const pane = await buildCurrentSkillPane(actor, draft, step, modules);
  const choiceSections = new Map((pane?.choiceSections ?? []).map((section) => [section.key, section]));
  const availableAdditional = new Set(
    (pane?.additionalSkills ?? []).filter((option) => !option.disabled).map((option) => option.slug),
  );

  for (const choice of step.training.choiceRules) {
    const section = choiceSections.get(choice.key);
    const options = section
      ? section.options.filter((option) => !option.disabled || option.selected).map((option) => option.slug)
      : choice.options.map((option) => option.slug);
    const explicitSelection =
      smokeCase.preferredRuleChoices?.[choice.key] ?? smokeCase.preferredRuleChoices?.[choice.flag];
    const selection =
      (options.includes(explicitSelection) && !used.has(explicitSelection) ? explicitSelection : null) ??
      preferred.find((skill) => options.includes(skill) && !used.has(skill)) ??
      options[0];
    if (selection) {
      ruleChoices[choice.key] = selection;
      used.add(selection);
    }
  }

  for (const choice of step.training.loreChoices) {
    loreChoices[choice.key] = "Wayfinding Lore";
  }

  for (const skill of preferred) {
    if (additional.length >= step.training.additionalCount) {
      break;
    }

    if (!used.has(skill) && availableAdditional.has(skill)) {
      additional.push(skill);
      used.add(skill);
    }
  }

  for (const option of Object.keys(CONFIG.PF2E?.skills ?? {})) {
    if (additional.length >= step.training.additionalCount) {
      break;
    }

    if (!used.has(option) && availableAdditional.has(option)) {
      additional.push(option);
      used.add(option);
    }
  }

  draft.skillTrainings[step.slotId] = { additional, loreChoices, ruleChoices };
}

async function buildCurrentSkillPane(actor, draft, step, modules) {
  return modules.buildSkillPane(step, draft, {
    baseSkillRanks: Object.fromEntries(
      Object.entries(actor.system?.skills ?? {}).map(([slug, data]) => [slug, Number(data?.rank ?? 0)]),
    ),
    resolveDocument: async (itemType) => {
      const selection = draft.selections[`${itemType}-level-1`];
      return selection ? modules.fetchSelectionDocument(selection) : null;
    },
    configSkills: CONFIG.PF2E?.skills ?? null,
    localize: (value) => game.i18n.localize(value),
    isTrainingStepComplete: () => false,
  });
}

async function fillSkillIncrease(actor, draft, step, smokeCase, modules) {
  const pane = await buildCurrentSkillPane(actor, draft, step, modules);
  const available = new Set((pane?.skills ?? []).filter((skill) => !skill.disabled).map((skill) => skill.slug));
  const explicit = smokeCase.expectedSkillIncreaseSelections?.[step.slotId];
  if (typeof explicit === "string" && explicit.length > 0 && available.has(explicit)) {
    draft.skillIncreases[step.slotId] = explicit;
    return;
  }

  const preferred = smokeCase.preferredSkills ?? [];
  const existing = new Set(Object.values(draft.skillIncreases));
  const selection = preferred.find((skill) => available.has(skill) && !existing.has(skill));
  if (selection) {
    draft.skillIncreases[step.slotId] = selection;
  }
}

function validateDraftPlanExpectations(steps, draft, smokeCase, failures) {
  const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));

  for (const [slotId, expectation] of Object.entries(smokeCase.expectedBoostSteps ?? {})) {
    const step = stepsBySlotId.get(slotId);
    if (step?.kind !== "boost") {
      failures.push(`Expected boost step did not render as a boost: ${slotId}`);
      continue;
    }

    for (const field of ["batchLevel", "requiredCount", "grantCount"]) {
      if (expectation[field] !== undefined && step.boost[field] !== expectation[field]) {
        failures.push(
          `${slotId} ${field} is ${step.boost[field] ?? "missing"}, expected ${expectation[field]}`,
        );
      }
    }

    if (expectation.selectedCount !== undefined) {
      const selectedCount = draft.boosts.levels[String(step.boost.batchLevel)]?.length ?? 0;
      if (selectedCount !== expectation.selectedCount) {
        failures.push(`${slotId} selected ${selectedCount} boosts, expected ${expectation.selectedCount}`);
      }
    }
  }

  for (const [slotId, expectedSlug] of Object.entries(smokeCase.expectedSkillIncreaseSelections ?? {})) {
    const step = stepsBySlotId.get(slotId);
    if (step?.kind !== "skill-increase") {
      failures.push(`Expected skill-increase step did not render: ${slotId}`);
      continue;
    }

    const actualSlug = draft.skillIncreases[slotId];
    if (actualSlug !== expectedSlug) {
      failures.push(`${slotId} selected ${actualSlug ?? "nothing"}, expected ${expectedSlug}`);
    }
  }
}

function pickOption(options, step, smokeCase) {
  const required = smokeCase.preferredSelections?.[step.slotId] ?? [];
  const preferred = [...required, ...(smokeCase.preferredSelections?.[step.slotKind] ?? [])];
  for (const name of preferred) {
    const found = options.find((option) => namesMatch(option.name, name));
    if (found) {
      return found;
    }
  }

  if (required.length > 0) {
    return null;
  }

  if (step.slotKind === "class-feat") {
    const classOption = options.find((option) => option.traits.includes(smokeCase.classSlug));
    if (classOption) {
      return classOption;
    }
  }

  if (step.slotKind === "deity" && smokeCase.deityName) {
    const deity = options.find((option) => namesMatch(option.name, smokeCase.deityName));
    if (deity) {
      return deity;
    }
  }

  return options[0] ?? null;
}

function pickOptions(options, step, smokeCase, count) {
  const preferred = [
    ...(smokeCase.preferredSelections?.[step.slotId] ?? []),
    ...(smokeCase.preferredSelections?.[step.slotKind] ?? []),
  ];
  const selected = [];
  for (const name of preferred) {
    const found = options.find(
      (option) => namesMatch(option.name, name) && !selected.some((entry) => entry.uuid === option.uuid),
    );
    if (found) {
      selected.push(found);
    }
    if (selected.length >= count) {
      return selected;
    }
  }

  for (const option of options) {
    if (!selected.some((entry) => entry.uuid === option.uuid)) {
      selected.push(option);
    }
    if (selected.length >= count) {
      break;
    }
  }
  return selected;
}

function pickInlineOption(options, step, smokeCase) {
  const preferred = [
    ...(smokeCase.preferredSelections?.[step.slotId] ?? []),
    ...(smokeCase.preferredSelections?.[step.slotKind] ?? []),
  ];
  for (const name of preferred) {
    const found = options.find((option) => namesMatch(option.label, name));
    if (found) {
      return found;
    }
  }

  return options[0] ?? null;
}

function collectActorEvidence(actor, modules, moduleId) {
  const rawItems = modules.listActorItems(actor);
  const itemsById = new Map(rawItems.flatMap((item) => (item.id ? [[item.id, item]] : [])));
  const items = rawItems.map((item) => {
    const isPhysical = Boolean(item.isOfType?.("physical"));
    const isCurrency = Boolean(
      item.isCoinage || (item.type === "treasure" && ["coins", "coin"].includes(item.system?.stackGroup)),
    );
    const acquisition = normalizeAcquisitionIdentity(item.flags?.[moduleId]?.acquisition);
    return {
      id: item.id,
      name: item.name,
      slotId: item.flags?.[moduleId]?.slotId ?? null,
      destinationKey: item.flags?.[moduleId]?.destinationKey ?? null,
      grantedById: item.flags?.pf2e?.grantedBy?.id ?? null,
      grantAncestryIds: collectGrantAncestryIds(item, itemsById),
      grantRules: (Array.isArray(item.system?.rules) ? item.system.rules : []).flatMap((rule) =>
        rule?.key === "GrantItem"
          ? [
              {
                allowDuplicate: rule.allowDuplicate ?? null,
                flag: rule.flag ?? null,
                uuid: rule.uuid ?? null,
              },
            ]
          : [],
      ),
      acquisition,
      containerId: typeof item.system?.containerId === "string" ? item.system.containerId || null : null,
      isCurrency,
      isPhysical,
      location:
        typeof item.system?.location === "string" ? item.system.location : (item.system?.location?.value ?? null),
      quantity: isPhysical ? Number(item.quantity ?? item.system?.quantity) : null,
      ruleSelections: item.flags?.pf2e?.rulesSelections ?? {},
      sourceId: modules.sourceIdOf(item),
      traits: Array.isArray(item.system?.traits?.value) ? item.system.traits.value : [],
      spellcasting:
        item.type === "spellcastingEntry"
          ? {
              ability: item.system?.ability?.value ?? null,
              prepared: item.system?.prepared?.value ?? null,
              proficiencyRank: Number(item.system?.proficiency?.value ?? 0),
              proficiencySlug: item.system?.proficiency?.slug ?? null,
              slots: Object.fromEntries(
                Object.entries(item.system?.slots ?? {}).map(([slotKey, group]) => [
                  slotKey,
                  {
                    max: Number(group?.max ?? 0),
                    prepared: Array.isArray(group?.prepared)
                      ? group.prepared.map((slot) => slot?.id ?? null)
                      : [],
                  },
                ]),
              ),
              tradition: item.system?.tradition?.value ?? null,
            }
          : null,
      trainingKey: item.flags?.[moduleId]?.trainingKey ?? null,
      type: item.type,
    };
  });
  // Lore items are identified by slotId + trainingKey in the apply-side
  // reconciler, so multiple lores may legitimately share one training slot.
  const slotIds = items
    .map((item) => (item.trainingKey ? `${item.slotId}:${item.trainingKey}` : item.slotId))
    .filter(Boolean);
  const abilityBoosts = actor.toObject?.().system?.build?.attributes?.boosts ?? {};

  return {
    abilityBoosts,
    authority: {
      canUpdate: Boolean(actor.canUserModify?.(game.user, "update")),
      explicitOwnershipLevel: Number(actor.ownership?.[game.user?.id] ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE),
      defaultOwnershipLevel: Number(actor.ownership?.default ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE),
      isOwner: Boolean(actor.isOwner),
      ownerPermission: Boolean(
        actor.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER),
      ),
    },
    currencyCopper: Number(actor.inventory?.currency?.copperValue),
    id: actor.id,
    duplicateSlotIds: duplicates(slotIds),
    itemCount: items.length,
    items: items.sort((left, right) =>
      `${left.slotId ?? ""}:${left.name}`.localeCompare(`${right.slotId ?? ""}:${right.name}`),
    ),
    levelAfterApply: Number(actor.system?.details?.level?.value ?? 0),
    moduleDraftAfterApply: actor.getFlag(moduleId, "draft") ?? null,
    moduleStateAfterApply: actor.getFlag(moduleId, "state") ?? null,
    skillRanks: Object.fromEntries(
      Object.entries(actor.system?.skills ?? {}).map(([slug, value]) => [slug, value?.rank ?? 0]),
    ),
  };
}

function collectGrantAncestryIds(item, itemsById) {
  const ancestry = [];
  const visited = new Set();
  let parentId = item.flags?.pf2e?.grantedBy?.id ?? null;
  while (typeof parentId === "string" && parentId.length > 0 && !visited.has(parentId)) {
    ancestry.push(parentId);
    visited.add(parentId);
    parentId = itemsById.get(parentId)?.flags?.pf2e?.grantedBy?.id ?? null;
  }
  return ancestry;
}

function normalizeAcquisitionIdentity(value) {
  if (!value || typeof value !== "object") return null;
  return {
    version: value.version ?? null,
    draftId: value.draftId ?? null,
    batchId: value.batchId ?? null,
    manifestId: value.manifestId ?? null,
    lineId: value.lineId ?? null,
    entryId: value.entryId ?? null,
    plannedItemId: value.plannedItemId ?? null,
    plannedContainerId: value.plannedContainerId ?? null,
    plannedGrantId: value.plannedGrantId ?? null,
    stackingIntent: value.stackingIntent ?? null,
  };
}

function emptyAcquisitionEvidence() {
  return {
    binding: null,
    policy: null,
    currency: {
      preCopper: null,
      budgetCopper: null,
      targetCopper: null,
      observedCopper: null,
      spentCopper: null,
      remainingCopper: null,
    },
    durability: null,
    manifest: null,
    failureSnapshot: null,
    retry: null,
  };
}

function smokeRuntime(moduleRecord, expectedWorldId) {
  return {
    foundryVersion: game.version ?? null,
    moduleVersion: moduleRecord.version ?? moduleRecord.manifest?.version ?? null,
    pf2eVersion: game.system?.version ?? null,
    guardedWorldMatched: String(game.world?.id ?? "") === String(expectedWorldId ?? ""),
  };
}

function rootElementOf(value) {
  if (value?.querySelector) return value;
  if (value?.[0]?.querySelector) return value[0];
  return null;
}

function validateAppliedCase({
  actorEvidence,
  dialogsAfter,
  dialogsBefore,
  failures,
  lifecycleResult,
  preStepIds,
  rerunPlan,
  smokeCase,
}) {
  const expectedStepIds = Array.isArray(smokeCase.expectedStepIds) ? smokeCase.expectedStepIds : [];
  const missingExpectedStepIds = expectedStepIds.filter((slotId) => !preStepIds.includes(slotId));
  if (missingExpectedStepIds.length > 0) {
    failures.push(`Expected steps did not render: ${missingExpectedStepIds.join(", ")}`);
  }

  const forbiddenStepIds = Array.isArray(smokeCase.forbiddenStepIds) ? smokeCase.forbiddenStepIds : [];
  const renderedForbiddenStepIds = forbiddenStepIds.filter((slotId) => preStepIds.includes(slotId));
  if (renderedForbiddenStepIds.length > 0) {
    failures.push(`Forbidden steps rendered: ${renderedForbiddenStepIds.join(", ")}`);
  }

  validateActorExpectations(actorEvidence, smokeCase, failures);

  if (lifecycleResult.kind !== "applied") {
    failures.push(`Apply lifecycle returned ${lifecycleResult.kind}`);
  }

  if (actorEvidence.levelAfterApply !== smokeCase.targetLevel) {
    failures.push(`Actor level is ${actorEvidence.levelAfterApply}, expected ${smokeCase.targetLevel}`);
  }

  if (actorEvidence.moduleDraftAfterApply !== null) {
    failures.push("Draft flag was not cleared after apply.");
  }

  const unexpectedDuplicateSlotIds = actorEvidence.duplicateSlotIds.filter(
    (slotId) =>
      !slotId.startsWith("class-archetype-") &&
      !slotId.startsWith("class-branch-") &&
      !slotId.startsWith("deity-level-") &&
      !slotId.startsWith("grant-choice-") &&
      !slotId.startsWith("spell-choice-"),
  );
  if (unexpectedDuplicateSlotIds.length > 0) {
    failures.push(`Duplicate Wayfinder slot ids: ${unexpectedDuplicateSlotIds.join(", ")}`);
  }

  if (dialogsAfter > dialogsBefore) {
    failures.push(`Native dialog count increased from ${dialogsBefore} to ${dialogsAfter}`);
  }

  if (rerunPlan.steps.length > 0) {
    failures.push(`Rerun still has pending steps: ${rerunPlan.steps.map((step) => step.slotId).join(", ")}`);
  }

}

function validateIncrementalCase({
  actorEvidence,
  dialogsAfter,
  dialogsBefore,
  failures,
  initialLifecycleResult,
  initialStepIds,
  incrementalLifecycleResult,
  incrementalStepIds,
  rerunPlan,
  smokeCase,
}) {
  if (initialLifecycleResult.kind !== "applied") {
    failures.push(`Initial apply lifecycle returned ${initialLifecycleResult.kind}`);
  }

  if (incrementalLifecycleResult.kind !== "applied") {
    failures.push(`Incremental apply lifecycle returned ${incrementalLifecycleResult.kind}`);
  }

  if (initialStepIds.length === 0) {
    failures.push("Initial creation produced no Wayfinder steps.");
  }

  if (incrementalStepIds.length === 0) {
    failures.push("Incremental level-up produced no Wayfinder steps.");
  }

  const expectedStepIds = Array.isArray(smokeCase.expectedStepIds) ? smokeCase.expectedStepIds : [];
  const plannedStepIds = new Set([...initialStepIds, ...incrementalStepIds]);
  const missingExpectedStepIds = expectedStepIds.filter((slotId) => !plannedStepIds.has(slotId));
  if (missingExpectedStepIds.length > 0) {
    failures.push(`Expected steps did not render: ${missingExpectedStepIds.join(", ")}`);
  }

  const forbiddenStepIds = Array.isArray(smokeCase.forbiddenStepIds) ? smokeCase.forbiddenStepIds : [];
  const renderedForbiddenStepIds = forbiddenStepIds.filter((slotId) => plannedStepIds.has(slotId));
  if (renderedForbiddenStepIds.length > 0) {
    failures.push(`Forbidden steps rendered: ${renderedForbiddenStepIds.join(", ")}`);
  }

  validateActorExpectations(actorEvidence, smokeCase, failures);

  if (actorEvidence.levelAfterApply !== smokeCase.targetLevel) {
    failures.push(`Actor level is ${actorEvidence.levelAfterApply}, expected ${smokeCase.targetLevel}`);
  }

  if (actorEvidence.moduleDraftAfterApply !== null) {
    failures.push("Draft flag was not cleared after incremental apply.");
  }

  const unexpectedDuplicateSlotIds = actorEvidence.duplicateSlotIds.filter(
    (slotId) =>
      !slotId.startsWith("class-archetype-") &&
      !slotId.startsWith("class-branch-") &&
      !slotId.startsWith("deity-level-") &&
      !slotId.startsWith("grant-choice-") &&
      !slotId.startsWith("spell-choice-"),
  );
  if (unexpectedDuplicateSlotIds.length > 0) {
    failures.push(`Duplicate Wayfinder slot ids: ${unexpectedDuplicateSlotIds.join(", ")}`);
  }

  if (dialogsAfter > dialogsBefore) {
    failures.push(`Native dialog count increased from ${dialogsBefore} to ${dialogsAfter}`);
  }

  if (rerunPlan.steps.length > 0) {
    failures.push(`Rerun still has pending steps: ${rerunPlan.steps.map((step) => step.slotId).join(", ")}`);
  }

}

function validateActorExpectations(actorEvidence, smokeCase, failures) {
  if (Number.isSafeInteger(smokeCase.expectedItemCount) && actorEvidence.itemCount !== smokeCase.expectedItemCount) {
    failures.push(`Actor item count is ${actorEvidence.itemCount}, expected ${smokeCase.expectedItemCount}`);
  }

  const expectedItemNames = Array.isArray(smokeCase.expectedItemNames) ? smokeCase.expectedItemNames : [];
  const missingItemNames = expectedItemNames.filter(
    (name) => !actorEvidence.items.some((item) => item.name === name),
  );
  if (missingItemNames.length > 0) {
    failures.push(`Expected actor items are missing: ${missingItemNames.join(", ")}`);
  }

  const forbiddenItemNames = Array.isArray(smokeCase.forbiddenItemNames) ? smokeCase.forbiddenItemNames : [];
  const presentForbiddenItemNames = forbiddenItemNames.filter((name) =>
    actorEvidence.items.some((item) => item.name === name),
  );
  if (presentForbiddenItemNames.length > 0) {
    failures.push(`Forbidden actor items are present: ${presentForbiddenItemNames.join(", ")}`);
  }

  for (const [name, expectedCount] of Object.entries(smokeCase.expectedItemNameCounts ?? {})) {
    const actualCount = actorEvidence.items.filter((item) => item.name === name).length;
    if (actualCount !== expectedCount) {
      failures.push(`Actor item count for ${name} is ${actualCount}, expected ${expectedCount}`);
    }
  }

  for (const [trait, expectedCount] of Object.entries(smokeCase.expectedItemTraitCounts ?? {})) {
    const actualCount = actorEvidence.items.filter((item) => item.traits.includes(trait)).length;
    if (actualCount !== expectedCount) {
      failures.push(`Actor item count for trait ${trait} is ${actualCount}, expected ${expectedCount}`);
    }
  }

  for (const [slug, expectedRank] of Object.entries(smokeCase.expectedSkillRanks ?? {})) {
    const actualRank = actorEvidence.skillRanks[slug] ?? 0;
    if (actualRank !== expectedRank) {
      failures.push(`Actor skill rank for ${slug} is ${actualRank}, expected ${expectedRank}`);
    }
  }

  for (const [batchLevel, expectedCount] of Object.entries(smokeCase.expectedBoostBatchCounts ?? {})) {
    const actualCount = Array.isArray(actorEvidence.abilityBoosts?.[batchLevel])
      ? actorEvidence.abilityBoosts[batchLevel].length
      : 0;
    if (actualCount !== expectedCount) {
      failures.push(`Actor boost batch ${batchLevel} has ${actualCount} choices, expected ${expectedCount}`);
    }
  }
  for (const batchLevel of smokeCase.forbiddenBoostBatchLevels ?? []) {
    if (Object.hasOwn(actorEvidence.abilityBoosts ?? {}, String(batchLevel))) {
      failures.push(`Actor boost storage unexpectedly contains intervening level ${batchLevel}`);
    }
  }

  for (const [itemName, expectedSelections] of Object.entries(smokeCase.expectedItemRuleSelections ?? {})) {
    const item = actorEvidence.items.find((candidate) => candidate.name === itemName);
    for (const [flag, expectedValue] of Object.entries(expectedSelections)) {
      const actualValue = item?.ruleSelections?.[flag];
      if (actualValue !== expectedValue) {
        failures.push(`${itemName} rule selection ${flag} is ${actualValue ?? "missing"}, expected ${expectedValue}`);
      }
    }
  }

  for (const [itemName, expectedLocation] of Object.entries(smokeCase.expectedItemLocations ?? {})) {
    const item = actorEvidence.items.find((candidate) => candidate.name === itemName);
    if (!item || item.location !== expectedLocation) {
      failures.push(`${itemName} location is ${item?.location ?? "missing"}, expected ${expectedLocation}`);
    }
  }

  for (const expectation of smokeCase.expectedGrantReplacements ?? []) {
    const source = actorEvidence.items.find((item) => item.name === expectation.sourceItemName);
    const rule = source?.grantRules?.find((candidate) => candidate.flag === expectation.flag);
    if (!source?.id || !rule?.uuid || expectation.originalUuids.includes(rule.uuid)) {
      failures.push(`${expectation.sourceItemName} did not replace the ${expectation.flag} GrantItem rule`);
      continue;
    }

    const grantedItem = actorEvidence.items.find(
      (item) => item.sourceId === rule.uuid && item.grantedById === source.id,
    );
    if (!grantedItem) {
      failures.push(`${expectation.sourceItemName} did not natively grant its ${expectation.flag} replacement`);
    }
  }

  for (const [destinationKey, expectation] of Object.entries(smokeCase.expectedSpellcastingEntries ?? {})) {
    const entry = actorEvidence.items.find(
      (item) => item.type === "spellcastingEntry" && item.destinationKey === destinationKey,
    );
    if (!entry?.spellcasting) {
      failures.push(`Expected spellcasting entry is missing: ${destinationKey}`);
      continue;
    }

    for (const [slotKey, expectedMax] of Object.entries(expectation.slots ?? {})) {
      const actualMax = entry.spellcasting.slots?.[slotKey]?.max;
      if (actualMax !== expectedMax) {
        failures.push(`${destinationKey} ${slotKey} max is ${actualMax ?? "missing"}, expected ${expectedMax}`);
      }
    }
    for (const [slotKey, expectedPrepared] of Object.entries(expectation.preparedSlots ?? {})) {
      const actualPrepared = entry.spellcasting.slots?.[slotKey]?.prepared ?? null;
      if (JSON.stringify(actualPrepared) !== JSON.stringify(expectedPrepared)) {
        failures.push(
          `${destinationKey} ${slotKey} prepared slots are ${JSON.stringify(actualPrepared)}, expected ${JSON.stringify(expectedPrepared)}`,
        );
      }
    }
    for (const slotKey of expectation.forbiddenSlots ?? []) {
      if (entry.spellcasting.slots?.[slotKey]) {
        failures.push(`${destinationKey} unexpectedly contains ${slotKey}`);
      }
    }
    if (expectation.proficiencySlug !== undefined && entry.spellcasting.proficiencySlug !== expectation.proficiencySlug) {
      failures.push(
        `${destinationKey} proficiency slug is ${entry.spellcasting.proficiencySlug ?? "missing"}, expected ${expectation.proficiencySlug}`,
      );
    }
    if (expectation.proficiencyRank !== undefined && entry.spellcasting.proficiencyRank !== expectation.proficiencyRank) {
      failures.push(
        `${destinationKey} proficiency rank is ${entry.spellcasting.proficiencyRank ?? "missing"}, expected ${expectation.proficiencyRank}`,
      );
    }
    for (const field of ["ability", "prepared", "tradition"]) {
      if (expectation[field] !== undefined && entry.spellcasting[field] !== expectation[field]) {
        failures.push(
          `${destinationKey} ${field} is ${entry.spellcasting[field] ?? "missing"}, expected ${expectation[field]}`,
        );
      }
    }
  }

  for (const [itemName, expectedDestinations] of Object.entries(smokeCase.expectedItemDestinations ?? {})) {
    const destinationKeys = Array.isArray(expectedDestinations) ? expectedDestinations : [expectedDestinations];
    for (const destinationKey of destinationKeys) {
      const entry = actorEvidence.items.find(
        (item) => item.type === "spellcastingEntry" && item.destinationKey === destinationKey,
      );
      const item = actorEvidence.items.find(
        (candidate) => candidate.name === itemName && candidate.type === "spell" && candidate.location === entry?.id,
      );
      if (!entry?.id || !item) {
        failures.push(`${itemName} is not located in ${destinationKey}`);
      }
    }
  }
}

async function seedActorItems(actor, smokeCase, failures) {
  const uuids = Array.isArray(smokeCase.preseedItemUuids) ? smokeCase.preseedItemUuids : [];
  for (const uuid of uuids) {
    const document = await globalThis.fromUuid(uuid);
    if (!document?.toObject) {
      failures.push(`Could not preseed actor item: ${uuid}`);
      continue;
    }
    await actor.createEmbeddedDocuments("Item", [document.toObject()]);
  }
}

async function seedActorSkillRanks(actor, smokeCase) {
  const ranks = smokeCase.preseedSkillRanks ?? {};
  const updates = Object.fromEntries(
    Object.entries(ranks).map(([slug, rank]) => [`system.skills.${slug}.rank`, rank]),
  );
  if (Object.keys(updates).length > 0) {
    await actor.update(updates);
  }
}

function statusFor(failures, classifications) {
  if (failures.length > 0) {
    return "fail";
  }

  return classifications.length > 0 ? "classified" : "pass";
}

function assertExpectedWorldId(actualWorldId, expectedWorldId) {
  const expected = String(expectedWorldId ?? "").trim();
  if (!expected) {
    return;
  }

  const actual = String(actualWorldId ?? "").trim();
  if (actual !== expected) {
    throw new Error(`Foundry smoke expected world ${expected}, but connected to ${actual || "<unknown>"}.`);
  }
}

function fixtureOwnershipFor(user) {
  if (!user?.id) {
    throw new Error("Foundry smoke fixture creation requires a current user id.");
  }
  return {
    default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
  };
}

async function enforceFixtureOwnership(actor, user) {
  const ownership = fixtureOwnershipFor(user);
  if (
    actor.ownership?.default !== ownership.default ||
    actor.ownership?.[user.id] !== ownership[user.id]
  ) {
    await actor.update({ ownership });
  }
  if (
    actor.ownership?.default !== ownership.default ||
    actor.ownership?.[user.id] !== ownership[user.id]
  ) {
    throw new Error("Foundry smoke fixture ownership did not reach the requested explicit-owner state.");
  }
}

async function cleanupActors(prefix) {
  const actors = game.actors.filter((actor) => actor.name.startsWith(prefix));
  for (const actor of actors) {
    await actor.delete();
  }
}

async function selectionRef(packId, name, slotId) {
  const entry = await findPackEntry(packId, name);
  return {
    slotId,
    packId,
    documentId: entry._id,
    featType: entry.system?.featType?.value ?? entry.system?.category ?? null,
    itemType: entry.type,
    level: entry.system?.level?.value ?? null,
    name: entry.name,
    uuid: entry.uuid ?? `Compendium.${packId}.Item.${entry._id}`,
  };
}

async function findPackEntry(packId, name) {
  const pack = game.packs.get(packId);
  if (!pack) {
    throw new Error(`Missing compendium pack ${packId}`);
  }

  const index = await pack.getIndex({
    fields: ["name", "type", "system.category", "system.featType.value", "system.level.value"],
  });
  const found = index.find((entry) => namesMatch(entry.name, name));
  if (!found) {
    throw new Error(`Missing ${name} in ${packId}`);
  }

  return found;
}

function levelBoosts(primary) {
  return uniqueAbilities([primary, "dex", "con", "wis", "int", "cha", "str"]).slice(0, 4);
}

function uniqueAbilities(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    } else {
      seen.add(value);
    }
  }
  return Array.from(duplicateValues).sort();
}

function dialogCount() {
  return document.querySelectorAll('.application.dialog, [role="dialog"]').length;
}

function stepSummary(step) {
  return {
    id: step.id,
    kind: step.kind,
    level: step.level,
    slotId: step.slotId,
    slotKind: step.slotKind,
    title: step.title,
  };
}

function namesMatch(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "accent" }) === 0;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(read, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value) return value;
    await wait(50);
  }
  throw new Error(label);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

function errorToString(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}
