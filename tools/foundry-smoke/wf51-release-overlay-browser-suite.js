/* global Actor, CONFIG, CONST, fromUuid, game, getComputedStyle, HTMLElement */

const WF51_PURPOSE = "wf51-release-overlay";
const DAGGER_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
const HUMAN_UUID = "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX";
const INVESTIGATOR_UUID = "Compendium.pf2e.classes.Item.4wrSCyX6akmyo7Wj";
const METHODOLOGY_UUID = "Compendium.pf2e.classfeatures.Item.ln2Y1a4SxlU9sizX";
const METHODOLOGY_SELECTOR_UUID = "Compendium.pf2e.classfeatures.Item.uhHg9BXBiHpL5ndS";
const FORMULA_BOOK_UUID = "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx";
const MIND_READING_UUID = "Compendium.pf2e.spells-srd.Item.KHnhPHL4x1AQHfbC";

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
  modules.WayfinderApp.open(actor);
  const app = Object.values(actor.apps ?? {}).find((candidate) => candidate instanceof modules.WayfinderApp);
  if (!app) throw new Error("WF-080-51 could not resolve the actor-bound Wayfinder app.");
  await app.render(true);
  const receipt = app.element?.querySelector(".wayfinder-attestation-receipt") ?? null;
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

async function materializeInvestigatorFormulaBook({ actor, moduleId, modules }) {
  const steps = investigatorSteps(modules);
  const draft = modules.createEmptyDraft(1);
  draft.selections["class-level-1"] = selection("class-level-1", INVESTIGATOR_UUID, "Investigator", "class");
  draft.branchSelections.methodology = selection(
    "class-branch-methodology-level-1",
    METHODOLOGY_UUID,
    "Alchemical Sciences",
    "feat",
    "classfeature",
  );
  await executeAndPersist(actor, draft, { type: "initialize", selectedRecipe: "permanent-items" }, modules, moduleId, steps);
  await executeAndPersist(actor, draft, { type: "retain-all" }, modules, moduleId, steps);
  const reviewed = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), 1);
  const runtime = modules.getRuntime();
  const classGrantPlan = await modules.prepareCurrentClassGrantPlan(actor, reviewed, steps, {
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
        steps,
        evaluateStep: (step) => modules.evaluateWayfinderStep(step, applyDraft, new Set(), {}),
        confirmApply: async () => true,
        beforeApply: async (applyAttemptDraft) => actor.setFlag(moduleId, "draft", applyAttemptDraft),
        applyDraftToActor: (buildFinalActorUpdate) =>
          modules.applyDraftToActor(actor, applyDraft, steps, {
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
    throw new Error("WF-080-51 Investigator Formula Book materialization or retry evidence is incomplete.");
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

globalThis.__prepareWf51ReleaseOverlay = async function prepare({
  abpSetting,
  allowDestructive,
  cases,
  expectedWorldId,
  fixturePrefix,
  judgmentSetting,
  moduleId,
  playerName,
  policySetting,
  priorActorIds,
  runId,
}) {
  if (!allowDestructive) throw new Error("WF-080-51 setup requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-51 setup requires a GM.");
  const remainingPriorActorIds = (priorActorIds ?? []).filter((actorId) => game.actors.has(actorId));
  if (remainingPriorActorIds.length > 0) {
    throw new Error(`WF-080-51 prior child cleanup left actors: ${remainingPriorActorIds.join(", ")}.`);
  }
  const player = game.users.find((candidate) => candidate.name === playerName && !candidate.isGM && candidate.id !== game.user.id);
  if (!player) throw new Error("WF-080-51 configured non-GM player is unavailable.");
  const snapshots = {
    policy: structuredClone(game.settings.get(moduleId, policySetting)),
    judgments: structuredClone(game.settings.get(moduleId, judgmentSetting)),
    abp: structuredClone(game.settings.get("pf2e", abpSetting)),
    actorCount: game.actors.size,
  };
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
    const source = dagger.toObject(false);
    delete source._id;
    await itemActor.createEmbeddedDocuments("Item", [source], { render: false });
    await currencyActor.inventory.addCoins({ cp: 25 });
  } catch (error) {
    const cleanupFailures = [];
    for (const fixture of fixtures) {
      try {
        await game.actors.get(fixture.actorId)?.delete();
      } catch (cleanupError) {
        cleanupFailures.push(`actor ${fixture.actorId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    for (const [scope, key, value] of [
      [moduleId, judgmentSetting, snapshots.judgments],
      [moduleId, policySetting, snapshots.policy],
      ["pf2e", abpSetting, snapshots.abp],
    ]) {
      try {
        await game.settings.set(scope, key, value);
      } catch (cleanupError) {
        cleanupFailures.push(`${scope}.${key}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${cleanupFailures.length > 0 ? ` Setup cleanup failures: ${cleanupFailures.join("; ")}` : ""}`, {
      cause: error,
    });
  }
  return {
    fixtures,
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
    },
    trust: {
      spellAttestation: structuredClone(attestation),
      reviewLine: reviewLines[0],
      receiptDom,
      draftCleared: trustActor.getFlag(moduleId, "draft") == null,
      persistedAttestationCount: applied.length,
    },
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
  const activeSteps = [
    { slotId: "ancestry-level-1" },
    { slotId: "heritage-level-1" },
    { slotId: "class-level-1" },
    { slotId: "class-branch-methodology-level-1" },
    { slotId: "class-branch-instinct-level-1" },
    { slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1" },
  ];
  const alchemist = modules.createEmptyDraft(1);
  alchemist.selections["class-level-1"] = selection("class-level-1", u.alchemistClass, "Alchemist", "class");
  const alchemistResult = await modules.projectGrants({ ...subject, draft: alchemist, activeSteps });

  const investigator = modules.createEmptyDraft(1);
  investigator.selections["class-level-1"] = selection(
    "class-level-1",
    u.investigatorClass,
    "Investigator",
    "class",
  );
  investigator.branchSelections.methodology = selection(
    "class-branch-methodology-level-1",
    u.alchemicalSciences,
    "Alchemical Sciences",
    "feat",
    "classfeature",
  );
  const investigatorResult = await modules.projectGrants({ ...subject, draft: investigator, activeSteps });

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
  const rejected = modules.findUnsupportedRoutes(ancientElf, activeSteps);

  const titanDraft = modules.createEmptyDraft(1);
  titanDraft.selections["ancestry-level-1"] = selection("ancestry-level-1", HUMAN_UUID, "Human", "ancestry");
  titanDraft.selections["class-level-1"] = selection("class-level-1", u.barbarianClass, "Barbarian", "class");
  titanDraft.branchSelections.instinct = selection(
    "class-branch-instinct-level-1",
    u.giantInstinct,
    "Giant Instinct",
    "feat",
    "classfeature",
  );
  await executeAndPersist(actor, titanDraft, { type: "initialize", selectedRecipe: "permanent-items" }, modules, moduleId);
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
  await executeAndPersist(actor, titanDraft, { type: "add-line", line }, modules, moduleId);
  const material = titanDraft.acquisition.policySnapshot.material;
  const policy = effectivePolicyFromMaterial(material);
  const titanResult = await modules.projectGrants({
    ...subject,
    draft: titanDraft,
    activeSteps,
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
    throw new Error("WF-080-51 planned grant route evidence is incomplete.");
  }
  const projectionEconomicWritesUnchanged = before === snapshotEconomic(modules, actor);
  await executeAndPersist(actor, titanDraft, { type: "review-purchases" }, modules, moduleId);
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
