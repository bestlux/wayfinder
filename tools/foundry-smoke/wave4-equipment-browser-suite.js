/* global Actor, CONFIG, CONST, foundry, fromUuid, game */

const WF4_PURPOSE = "wave4-equipment-live-gate";

function assertWorld(expectedWorldId) {
  if (!expectedWorldId || game.world?.id !== expectedWorldId) {
    throw new Error(`Wave 4 equipment smoke expected world ${expectedWorldId || "<missing>"}.`);
  }
}

function assertUser(expectedUserId, isGM) {
  if (!game.user || game.user.id !== expectedUserId || Boolean(game.user.isGM) !== isGM) {
    throw new Error(`Wave 4 equipment smoke requires the exact ${isGM ? "GM" : "non-GM player"} executor.`);
  }
}

async function loadModules(moduleId) {
  const [draftService, commands, steps, runtime, policy, sourcePolicy, execution, grants, catalogue] = await Promise.all([
    import(`/modules/${moduleId}/scripts/draft-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/starting-equipment-command-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/domain/step-types.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-acquisition-runtime-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-policy-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-source-policy.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/acquisition-execution-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/domain/class-grant-reconciliation.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-catalogue-service.js`),
  ]);
  return {
    createEmptyDraft: draftService.createEmptyDraft,
    normalizeDraft: draftService.normalizeDraft,
    normalizeState: draftService.normalizeState,
    execute: commands.executeStartingEquipmentCommand,
    createStep: steps.createStartingEquipmentStep,
    getRuntime: runtime.getFoundryEquipmentAcquisitionRuntime,
    createRuntime: runtime.createEquipmentAcquisitionRuntime,
    saveWorldPolicy: policy.saveEquipmentWorldPolicy,
    discoverPacks: sourcePolicy.discoverInstalledEquipmentPackDescriptors,
    normalizeSources: sourcePolicy.normalizePf2eEquipmentSources,
    createExecutionSession: execution.createAcquisitionExecutionSession,
    createClassGrantPlan: grants.createPreparedClassGrantPlan,
    assertApplyAuthority: policy.assertEquipmentApplyAuthority,
    createCatalogue: catalogue.createEquipmentCatalogueService,
    createCatalogueDraftContext: catalogue.createEquipmentCatalogueDraftContext,
  };
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

function userEvidence() {
  return { id: game.user.id, name: game.user.name, role: Number(game.user.role), isGM: Boolean(game.user.isGM) };
}

function fixtureActor(fixtures, caseId, moduleId, runId) {
  const fixture = fixtures.find((entry) => entry.caseId === caseId);
  const actor = fixture ? game.actors.get(fixture.actorId) : null;
  const marker = actor?.getFlag(moduleId, "smokeWave4Equipment");
  if (
    !fixture ||
    !actor ||
    actor.name !== fixture.fixtureName ||
    marker?.purpose !== WF4_PURPOSE ||
    marker?.runId !== runId ||
    marker?.caseId !== caseId ||
    marker?.definitionFingerprint !== fixture.definitionFingerprint
  ) {
    throw new Error("Wave 4 equipment smoke refused a fixture with changed guarded identity.");
  }
  return actor;
}

async function selectionRef(ancestry) {
  const document = await fromUuid(ancestry.sourceUuid);
  if (!document || document.name !== ancestry.name || document.type !== "ancestry") {
    throw new Error(`Wave 4 ancestry source drifted: ${ancestry.name}.`);
  }
  return {
    slotId: "ancestry-level-1",
    packId: "pf2e.ancestries",
    documentId: document.id,
    uuid: ancestry.sourceUuid,
    itemType: "ancestry",
    featType: null,
    level: null,
    name: ancestry.name,
  };
}

async function executeAndPersist(actor, draft, command, modules, moduleId) {
  const result = await modules.execute(command, {
    actor,
    draft,
    moduleState: modules.normalizeState(actor.getFlag(moduleId, "state")),
    steps: [modules.createStep(draft.targetLevel)],
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

function requestFor(actor, draft, sourceUuid = null) {
  return {
    actor,
    draft,
    step: {
      slotId: `starting-equipment-level-${draft.targetLevel}`,
      level: draft.targetLevel,
      kind: "starting-equipment",
      title: "Starting Equipment",
    },
    query: "",
    filters: {},
    previewSourceUuid: null,
    funding: { lane: "currency" },
    ...(sourceUuid ? { sourceUuid } : {}),
  };
}

function inventorySnapshot(actor) {
  return {
    currencyCopper: Number(actor.inventory?.currency?.copperValue ?? 0),
    items: actor.items
      .filter((item) => item.isOfType?.("physical"))
      .map((item) => ({
        id: item.id,
        sourceUuid: item.sourceId ?? item.flags?.core?.sourceId ?? null,
        type: item.type,
        quantity: Number(item.quantity ?? item.system?.quantity ?? 0),
        containerId: item.system?.containerId ?? null,
        acquisition: structuredClone(item.getFlag?.("wayfinder-pf2e", "acquisition") ?? null),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function durableSnapshot(actor, moduleId, policySetting, packsSetting, sourcesSetting) {
  return {
    inventory: inventorySnapshot(actor),
    draft: structuredClone(actor.getFlag(moduleId, "draft") ?? null),
    state: structuredClone(actor.getFlag(moduleId, "state") ?? null),
    policy: structuredClone(game.settings.get(moduleId, policySetting)),
    packs: structuredClone(game.settings.get("pf2e", packsSetting)),
    sources: structuredClone(game.settings.get("pf2e", sourcesSetting)),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function effectivePolicyFromMaterial(material) {
  const recipe =
    material.resolvedRecipe.kind === "permanent-items"
      ? {
          kind: "permanent-items",
          currencyCopper: material.budgetCopper,
          allowances: structuredClone(material.allowances),
        }
      : {
          ...structuredClone(material.resolvedRecipe),
          budgetCopper: material.budgetCopper,
          maxItemLevel: material.subject.targetLevel - 1,
        };
  return {
    version: 1,
    actorId: material.subject.actorId,
    draftId: material.subject.draftId,
    targetLevel: material.subject.targetLevel,
    rules: { wealth: material.numericPolicyRef, semantics: material.semanticPolicyRef },
    recipe,
    worldRecipePolicy: structuredClone(material.worldRecipePolicy),
    sourcePolicy: structuredClone(material.sourcePolicy),
    rarityPolicy: structuredClone(material.rarityPolicy),
    authorityPolicy: structuredClone(material.authorityPolicy),
    higherLevelStartEvidence: structuredClone(material.higherLevelStartEvidence),
    abp: structuredClone(material.abp),
    gmJudgments: structuredClone(material.gmJudgments),
    fingerprint: `wave4-live:${material.subject.actorId}:${material.subject.draftId}`,
    explanations: [],
  };
}

function sourceProbe(modules, allowedFamilies, packsSetting, sourcesSetting, sourceCase) {
  const rawPacks = game.settings.get("pf2e", packsSetting);
  const descriptors = modules.discoverPacks({ packs: game.packs });
  const normalized = modules.normalizeSources({
    installedEquipmentPacks: descriptors,
    allowedPackFamilies: allowedFamilies,
    compendiumBrowserPacks: game.settings.get("pf2e", packsSetting),
    compendiumBrowserSources: game.settings.get("pf2e", sourcesSetting),
  });
  return {
    effectivePackIds: [...normalized.effectivePackIds],
    enabledSourceSlugs: [...normalized.enabledSourceSlugs],
    knownSourceSlugs: [...normalized.knownSourceSlugs],
    showEmptySources: normalized.showEmptySources,
    showUnknownSources: normalized.showUnknownSources,
    ignoreAsGM: game.settings.get("pf2e", sourcesSetting)?.ignoreAsGM === true,
    defaultLoadAbsent: !Object.hasOwn(rawPacks?.equipment ?? {}, sourceCase.supplemental.packId),
    equipmentDescriptors: descriptors.filter((entry) => entry.equipmentTab).map((entry) => entry.id).sort(),
  };
}

function actorAcquisitionItems(actor, moduleId) {
  return actor.items.filter((item) => item.isOfType?.("physical") && item.getFlag?.(moduleId, "acquisition"));
}

function classGrantPlan(modules, actor, acquisition) {
  return modules.createClassGrantPlan({
    actorId: actor.id,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    grants: acquisition.plannedClassGrants ?? [],
  });
}

function finalReconciliation(acquisition) {
  return {
    version: 1,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    phase: "final",
    entries: [],
    ignoredItemIds: [],
    unresolvedGrantIds: [],
    ambiguousGrantIds: [],
  };
}

function executionSession(modules, runtime, actor, moduleId, options = {}) {
  return modules.createExecutionSession({
    resolveSource: async ({ draft, entry }) => {
      const resolved = await runtime.resolveSourceForApply({
        actor,
        characterDraft: modules.normalizeDraft(actor.getFlag(moduleId, "draft"), draft.targetLevel),
        acquisition: draft,
        entry,
      });
      return options.transformResolvedSource ? options.transformResolvedSource({ entry, resolved }) : resolved;
    },
    readHistory: () => modules.normalizeState(actor.getFlag(moduleId, "state")),
    resolveCurrentPolicySnapshot: ({ draft }) => runtime.resolveCurrentPolicySnapshot(actor, draft),
    assertSourceHealth: ({ draft }) =>
      runtime.assertCurrentSourceHealth({
        actor,
        characterDraft: modules.normalizeDraft(actor.getFlag(moduleId, "draft"), draft.targetLevel),
        acquisition: draft,
      }),
    assertApplyAuthority: ({ draft }) => modules.assertApplyAuthority({ actor, acquisition: draft, user: game.user }),
    readApplyingUser: () => ({ userId: game.user.id, userName: game.user.name }),
    readEnvironment: () => {
      const runtime = runtimeEvidence(moduleId);
      return {
        foundryVersion: runtime.foundryVersion,
        pf2eVersion: runtime.pf2eVersion,
        moduleVersion: runtime.moduleVersion,
      };
    },
  });
}

function preparePhysicalWithOverlay(overlay) {
  return ({ actor, targetLevel, targetSize, source }) => {
    const itemSource = structuredClone(source);
    if (itemSource._stats?.compendiumSource === overlay.sourceUuid || itemSource.flags?.core?.sourceId === overlay.sourceUuid) {
      itemSource.system = { ...itemSource.system, material: structuredClone(overlay.material) };
    }
    const actorSource = actor.toObject(true);
    actorSource._id = foundry.utils.randomID(16);
    actorSource.name = `Wave 4 overlay preparation ${targetLevel}`;
    actorSource.system.details.level.value = targetLevel;
    const itemId = foundry.utils.randomID(16);
    itemSource._id = itemId;
    itemSource.system.size = targetSize === "large" ? "lg" : targetSize === "huge" ? "huge" : "med";
    actorSource.items = [itemSource];
    const temporary = new CONFIG.Actor.documentClass(actorSource, { temporary: true });
    const item = temporary.items.get(itemId);
    if (!item) throw new Error("PF2E did not prepare the Wave 4 precious-material overlay.");
    return item;
  };
}

globalThis.__prepareWayfinderWave4EquipmentSmoke = async function prepareWave4({
  allowDestructive,
  cases,
  expectedWorldId,
  fixturePrefix,
  moduleId,
  packsSetting,
  playerName,
  policySetting,
  runId,
  sourcesSetting,
}) {
  if (!allowDestructive) throw new Error("Wave 4 equipment smoke requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("Wave 4 equipment setup requires a GM.");
  const player = game.users.find((user) => user.name === playerName && !user.isGM && user.id !== game.user.id);
  if (!player) throw new Error("The configured distinct non-GM player is unavailable.");
  const modules = await loadModules(moduleId);
  const snapshots = {
    policy: structuredClone(game.settings.get(moduleId, policySetting)),
    packs: structuredClone(game.settings.get("pf2e", packsSetting)),
    sources: structuredClone(game.settings.get("pf2e", sourcesSetting)),
  };
  const sourceCase = cases.find((entry) => entry.id === "supplemental-source-isolation");
  const guardedPolicy = {
    ...snapshots.policy,
    version: 1,
    enabledRecipes: ["permanent-items", "lump-sum"],
    defaultRecipe: "permanent-items",
    recipeChoiceAuthority: "actor-owner",
    higherLevelStartAuthority: "actor-owner-attestation",
    blanketRarity: "unique",
    allowedEquipmentPackFamilies: sourceCase.allowedFamilies,
    applyAuthority: "actor-owner",
    recipeDecision: {
      version: 1,
      configuredBy: { userId: game.user.id, userName: game.user.name },
      configuredAt: new Date().toISOString(),
    },
  };
  const packs = structuredClone(snapshots.packs ?? {});
  packs.equipment = { ...(packs.equipment ?? {}), [sourceCase.adjacent.packId]: { load: true } };
  delete packs.equipment["pf2e.equipment-srd"];
  delete packs.equipment[sourceCase.supplemental.packId];
  const sources = structuredClone(snapshots.sources ?? {});
  sources.ignoreAsGM = sourceCase.pf2eSettings.ignoreAsGM;
  sources.sources = {
    ...(sources.sources ?? {}),
    [sourceCase.pf2eSettings.sourceSlug]: { load: true },
  };
  const fixtures = [];
  try {
    await game.settings.set(moduleId, policySetting, guardedPolicy);
    await game.settings.set("pf2e", packsSetting, packs);
    await game.settings.set("pf2e", sourcesSetting, sources);
    for (const smokeCase of cases.filter((entry) => entry.actor)) {
      const fixtureName = `${fixturePrefix} - ${runId} - ${smokeCase.id}`;
      const actor = await Actor.create({
        name: fixtureName,
        type: "character",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        system: { details: { level: { value: smokeCase.actor.targetLevel } } },
        flags: {
          [moduleId]: {
            smokeWave4Equipment: {
              schemaVersion: 1,
              purpose: WF4_PURPOSE,
              runId,
              caseId: smokeCase.id,
              definitionFingerprint: smokeCase.definitionFingerprint,
              fixtureName,
            },
          },
        },
      });
      if (!actor) throw new Error(`Could not create Wave 4 fixture ${smokeCase.id}.`);
      fixtures.push({ actorId: actor.id, caseId: smokeCase.id, definitionFingerprint: smokeCase.definitionFingerprint, fixtureName });
      const draft = modules.createEmptyDraft(smokeCase.actor.targetLevel);
      draft.selections["ancestry-level-1"] = await selectionRef(smokeCase.actor.ancestry);
      await actor.setFlag(moduleId, "draft", draft);
    }
  } catch (error) {
    for (const fixture of fixtures) await game.actors.get(fixture.actorId)?.delete();
    await game.settings.set(moduleId, policySetting, snapshots.policy);
    await game.settings.set("pf2e", packsSetting, snapshots.packs);
    await game.settings.set("pf2e", sourcesSetting, snapshots.sources);
    throw error;
  }
  return { fixtures, gm: userEvidence(), playerId: player.id, runtime: runtimeEvidence(moduleId), snapshots };
};

globalThis.__runWayfinderWave4PlayerInitial = async function playerInitial({
  cases,
  expectedUserId,
  expectedWorldId,
  fixtures,
  moduleId,
  packsSetting,
  policySetting,
  runId,
  sourcesSetting,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadModules(moduleId);
  const runtime = modules.getRuntime();
  const physicalCase = cases.find((entry) => entry.id === "physical-prepared-boundaries");
  const kitCase = cases.find((entry) => entry.id === "adventurers-pack-retry");
  const sourceCase = cases.find((entry) => entry.id === "supplemental-source-isolation");
  const physicalActor = fixtureActor(fixtures, physicalCase.id, moduleId, runId);
  const kitActor = fixtureActor(fixtures, kitCase.id, moduleId, runId);
  for (const actor of [physicalActor, kitActor]) {
    const marker = actor.getFlag(moduleId, "smokeWave4Equipment");
    const actorCase = cases.find((entry) => entry.id === marker.caseId);
    const draft = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), actorCase.actor.targetLevel);
    await executeAndPersist(actor, draft, { type: "initialize", selectedRecipe: "permanent-items" }, modules, moduleId);
  }

  const stagedPhysicalDraft = modules.normalizeDraft(
    physicalActor.getFlag(moduleId, "draft"),
    physicalCase.actor.targetLevel,
  );
  await executeAndPersist(
    physicalActor,
    stagedPhysicalDraft,
    { type: "activate-policy", startKind: "replacement-character", reason: `Wave 4 physical breadth ${runId}` },
    modules,
    moduleId,
  );

  const physicalDraft = modules.normalizeDraft(
    physicalActor.getFlag(moduleId, "draft"),
    physicalCase.actor.targetLevel,
  );
  const physicalLines = [];
  for (const expected of physicalCase.physicalItems) {
    const line = await runtime.uiAdapter.prepareLine(requestFor(physicalActor, physicalDraft, expected.sourceUuid));
    physicalLines.push({ expected: structuredClone(expected), line: structuredClone(line) });
  }
  const stackSource = physicalLines.find((entry) => entry.line.sourceUuid === physicalCase.stackProbe.sourceUuid)?.line;
  if (!stackSource) throw new Error("Wave 4 stack probe source is missing from the exact physical matrix.");
  await executeAndPersist(physicalActor, physicalDraft, { type: "add-line", line: stackSource }, modules, moduleId);
  await executeAndPersist(
    physicalActor,
    physicalDraft,
    { type: "set-quantity", lineId: stackSource.lineId, quantity: physicalCase.stackProbe.requestedQuantity },
    modules,
    moduleId,
  );
  const stackLine = physicalDraft.acquisition.lines.find((entry) => entry.lineId === stackSource.lineId);
  const treasureProjection = await runtime.uiAdapter.project({
    ...requestFor(physicalActor, physicalDraft),
    query: physicalCase.treasure.name,
  });
  const treasureIndex = treasureProjection.recordSource.sourceUuids.indexOf(physicalCase.treasure.sourceUuid);
  const treasure = treasureIndex < 0 ? null : treasureProjection.recordSource.recordAt(treasureIndex);
  const listedMagic = await runtime.uiAdapter.prepareLine(
    requestFor(physicalActor, physicalDraft, physicalCase.listedMagic.sourceUuid),
  );
  const overlayRuntime = modules.createRuntime({
    packs: game.packs,
    preparePhysicalItem: preparePhysicalWithOverlay(physicalCase.preciousMaterialOverlay),
  });
  const overlayLine = await overlayRuntime.uiAdapter.prepareLine(
    requestFor(physicalActor, physicalDraft, physicalCase.preciousMaterialOverlay.sourceUuid),
  );
  for (const { line } of physicalLines) {
    if (line.lineId === stackSource.lineId) continue;
    await executeAndPersist(physicalActor, physicalDraft, { type: "add-line", line }, modules, moduleId);
  }
  await executeAndPersist(physicalActor, physicalDraft, { type: "review-purchases" }, modules, moduleId);
  const reviewedPhysicalDraft = modules.normalizeDraft(
    physicalActor.getFlag(moduleId, "draft"),
    physicalCase.actor.targetLevel,
  );
  const physicalAcquisition = reviewedPhysicalDraft.acquisition;
  const physicalPlan = classGrantPlan(modules, physicalActor, physicalAcquisition);
  const physicalSession = executionSession(modules, runtime, physicalActor, moduleId);
  const physicalCreateOrdinals = [];
  await physicalSession.executeAcquisitionItems({
    actor: physicalActor,
    draft: reviewedPhysicalDraft,
    classGrantPlan: physicalPlan,
    emitWriteCheckpoint: async (operation, boundary, ordinal) => {
      if (operation === "embedded-item-create" && boundary === "before") physicalCreateOrdinals.push(ordinal);
    },
  });
  await physicalSession.executeAcquisitionCurrency({
    actor: physicalActor,
    draft: reviewedPhysicalDraft,
    classGrantPlan: physicalPlan,
    emitWriteCheckpoint: async () => undefined,
    persistCurrencyConvergenceWitness: async (witness) => {
      reviewedPhysicalDraft.acquisition = {
        ...reviewedPhysicalDraft.acquisition,
        currencyConvergenceWitness: structuredClone(witness),
      };
      await physicalActor.setFlag(moduleId, "draft", reviewedPhysicalDraft);
    },
  });
  const physicalOutcome = await physicalSession.verifyAcquisitionOutcome({
    actor: physicalActor,
    draft: reviewedPhysicalDraft,
    classGrantPlan: physicalPlan,
    finalClassGrantReconciliation: finalReconciliation(physicalAcquisition),
  });
  const physicalState = modules.normalizeState(physicalActor.getFlag(moduleId, "state"));
  physicalState.completedAcquisitionManifest = physicalOutcome.manifest;
  physicalState.completedAcquisitionManifestCorrupt = false;
  await physicalActor.setFlag(moduleId, "state", physicalState);
  await physicalActor.setFlag(moduleId, "smokeWave4PhysicalEvidence", {
    lines: physicalLines,
    stackLine: structuredClone(stackLine),
    listedMagic: structuredClone(listedMagic),
    treasure,
    overlay: { definition: structuredClone(physicalCase.preciousMaterialOverlay), line: structuredClone(overlayLine) },
    execution: {
      beforeCreateOrdinals: physicalCreateOrdinals,
      inventory: inventorySnapshot(physicalActor),
      manifest: structuredClone(physicalOutcome.manifest),
    },
  });

  const kitDraft = modules.normalizeDraft(kitActor.getFlag(moduleId, "draft"), 1);
  const spray = await runtime.uiAdapter.prepareLine(
    requestFor(kitActor, kitDraft, kitCase.smallDiagnostics.exact.sourceUuid),
  );
  let candleMessage = "";
  try {
    await runtime.uiAdapter.prepareLine(requestFor(kitActor, kitDraft, kitCase.smallDiagnostics.unavailable.sourceUuid));
  } catch (error) {
    candleMessage = error instanceof Error ? error.message : String(error);
  }
  const kitLine = await runtime.uiAdapter.prepareLine(requestFor(kitActor, kitDraft, kitCase.kit.sourceUuid));
  await executeAndPersist(kitActor, kitDraft, { type: "add-line", line: kitLine }, modules, moduleId);
  await executeAndPersist(kitActor, kitDraft, { type: "review-purchases" }, modules, moduleId);
  const reviewedDraft = modules.normalizeDraft(kitActor.getFlag(moduleId, "draft"), 1);
  const acquisition = reviewedDraft.acquisition;
  const plan = classGrantPlan(modules, kitActor, acquisition);
  const childDriftSession = executionSession(modules, runtime, kitActor, moduleId, {
    transformResolvedSource: ({ resolved }) => {
      const drifted = structuredClone(resolved);
      drifted.expandedSources = drifted.expandedSources?.map((expanded) => {
        if (expanded.expansionPath !== kitCase.kit.faultChildExpansionPath) return expanded;
        const source = structuredClone(expanded.source);
        source._stats = { ...(source._stats ?? {}), compendiumSource: kitCase.kit.faultChildReplacementSourceUuid };
        source.flags = {
          ...(source.flags ?? {}),
          core: { ...(source.flags?.core ?? {}), sourceId: kitCase.kit.faultChildReplacementSourceUuid },
        };
        return { ...expanded, source };
      });
      return drifted;
    },
  });
  let childDriftMessage = "";
  try {
    await childDriftSession.executeAcquisitionItems({
      actor: kitActor,
      draft: reviewedDraft,
      classGrantPlan: plan,
      emitWriteCheckpoint: async () => undefined,
    });
  } catch (error) {
    childDriftMessage = error instanceof Error ? error.message : String(error);
  }
  const afterChildDrift = inventorySnapshot(kitActor);
  const session = executionSession(modules, runtime, kitActor, moduleId);
  const partialBeforeCreateOrdinals = [];
  let failure = "";
  try {
    await session.executeAcquisitionItems({
      actor: kitActor,
      draft: reviewedDraft,
      classGrantPlan: plan,
      emitWriteCheckpoint: async (operation, boundary, ordinal) => {
        if (operation === "embedded-item-create" && boundary === "before" && ordinal === kitCase.kit.failBeforeCreateOrdinal) {
          partialBeforeCreateOrdinals.push(ordinal);
          throw new Error(
            `Wave 4 forced partial kit write failure before child ${kitCase.kit.faultChildSourceUuid} create ordinal ${ordinal}.`,
          );
        }
        if (operation === "embedded-item-create" && boundary === "before") partialBeforeCreateOrdinals.push(ordinal);
      },
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  reviewedDraft.applyAttemptStepIds = ["starting-equipment-level-1"];
  await kitActor.setFlag(moduleId, "draft", reviewedDraft);
  const afterFailure = inventorySnapshot(kitActor);
  const expectedFailure = `Wave 4 forced partial kit write failure before child ${kitCase.kit.faultChildSourceUuid} create ordinal ${kitCase.kit.failBeforeCreateOrdinal}.`;
  const partialCreatedItemCount = actorAcquisitionItems(kitActor, moduleId).length;
  if (
    failure !== expectedFailure ||
    canonicalJson(partialBeforeCreateOrdinals) !== canonicalJson([1, 2, 3, 4, 5]) ||
    partialCreatedItemCount !== kitCase.kit.expectedCreatedBeforeFailure ||
    afterFailure.currencyCopper !== 0 ||
    modules.normalizeState(kitActor.getFlag(moduleId, "state")).completedAcquisitionManifest !== null
  ) {
    throw new Error(`Wave 4 kit partial-failure boundary drifted: ${failure || "no failure"}`);
  }
  await kitActor.setFlag(moduleId, "smokeWave4KitEvidence", {
    spray: structuredClone(spray),
    candleMessage,
    kitLine: structuredClone(kitLine),
    initial: {
      childDrift: {
        message: childDriftMessage,
        sourceUuid: kitCase.kit.faultChildSourceUuid,
        replacementSourceUuid: kitCase.kit.faultChildReplacementSourceUuid,
        createdItemCount: afterChildDrift.items.filter((item) => item.acquisition).length,
        currencyCopper: afterChildDrift.currencyCopper,
      },
      beforeCreateOrdinals: partialBeforeCreateOrdinals,
      failure,
      createdItemCount: partialCreatedItemCount,
      currencyCopper: afterFailure.currencyCopper,
      manifest: modules.normalizeState(kitActor.getFlag(moduleId, "state")).completedAcquisitionManifest,
    },
  });

  const beforeDenied = durableSnapshot(physicalActor, moduleId, policySetting, packsSetting, sourcesSetting);
  let denialMessage = "";
  try {
    await modules.saveWorldPolicy(game.settings.get(moduleId, policySetting), game.user);
  } catch (error) {
    denialMessage = error instanceof Error ? error.message : String(error);
  }
  const afterDenied = durableSnapshot(physicalActor, moduleId, policySetting, packsSetting, sourcesSetting);
  const playerSources = sourceProbe(modules, sourceCase.allowedFamilies, packsSetting, sourcesSetting, sourceCase);
  const saltProjection = await runtime.uiAdapter.project({ ...requestFor(physicalActor, physicalDraft), query: sourceCase.supplemental.name });
  const saltStakeIndex = saltProjection.recordSource.sourceUuids.indexOf(sourceCase.supplemental.sourceUuid);
  const saltStake = saltStakeIndex < 0 ? null : saltProjection.recordSource.recordAt(saltStakeIndex);
  const material = physicalDraft.acquisition?.policySnapshot?.material;
  if (!material) throw new Error("Wave 4 source evidence requires the reviewed physical policy material.");
  const effectivePolicy = effectivePolicyFromMaterial(material);
  const catalogue = modules.createCatalogue({
    packs: game.packs,
    equipmentPackIds: effectivePolicy.sourcePolicy.effectivePackIds,
  });
  const rawProjection = await catalogue.project({
    actor: physicalActor,
    policy: effectivePolicy,
    draft: modules.createCatalogueDraftContext({
      draftId: physicalDraft.acquisition.draftId,
      targetLevel: physicalDraft.targetLevel,
      version: physicalDraft.version,
      accessFacts: {},
    }),
  });
  const rawSaltStake = rawProjection.entries.find((entry) => entry.sourceUuid === sourceCase.supplemental.sourceUuid) ?? null;
  const saltAuthority = rawSaltStake
    ? {
        eligible: rawSaltStake.policyDecision.eligible,
        sourceBasis: rawSaltStake.policyDecision.sourceBasis,
        unavailableReasonCodes: rawSaltStake.unavailableReasons.map((reason) => reason.code),
      }
    : null;
  await physicalActor.setFlag(moduleId, "smokeWave4SourceEvidence", {
    playerSources,
    saltStake,
    saltAuthority,
  });
  return {
    player: userEvidence(),
    zeroWrite: {
      denied: /gm/i.test(denialMessage),
      message: denialMessage,
      unchanged: canonicalJson(beforeDenied) === canonicalJson(afterDenied),
    },
  };
};

globalThis.__runWayfinderWave4PlayerRetry = async function playerRetry({
  cases,
  expectedUserId,
  expectedWorldId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadModules(moduleId);
  const runtime = modules.getRuntime();
  const kitCase = cases.find((entry) => entry.id === "adventurers-pack-retry");
  const actor = fixtureActor(fixtures, kitCase.id, moduleId, runId);
  const draft = modules.normalizeDraft(actor.getFlag(moduleId, "draft"), 1);
  const acquisition = draft.acquisition;
  const plan = classGrantPlan(modules, actor, acquisition);
  const retryOrdinals = [];
  const session = executionSession(modules, runtime, actor, moduleId);
  await session.executeAcquisitionItems({
    actor,
    draft,
    classGrantPlan: plan,
    emitWriteCheckpoint: async (operation, boundary, ordinal) => {
      if (operation === "embedded-item-create" && boundary === "before") retryOrdinals.push(ordinal);
    },
  });
  await session.executeAcquisitionCurrency({
    actor,
    draft,
    classGrantPlan: plan,
    emitWriteCheckpoint: async () => undefined,
    persistCurrencyConvergenceWitness: async (witness) => {
      draft.acquisition = { ...draft.acquisition, currencyConvergenceWitness: structuredClone(witness) };
      await actor.setFlag(moduleId, "draft", draft);
    },
  });
  const outcome = await session.verifyAcquisitionOutcome({
    actor,
    draft,
    classGrantPlan: plan,
    finalClassGrantReconciliation: finalReconciliation(acquisition),
  });
  const state = modules.normalizeState(actor.getFlag(moduleId, "state"));
  state.completedAcquisitionManifest = outcome.manifest;
  state.completedAcquisitionManifestCorrupt = false;
  await actor.setFlag(moduleId, "state", state);
  await actor.setFlag(moduleId, "draft", draft);
  const evidence = structuredClone(actor.getFlag(moduleId, "smokeWave4KitEvidence"));
  evidence.retry = {
    beforeCreateOrdinals: retryOrdinals,
    createdItemCount: actorAcquisitionItems(actor, moduleId).length,
    currencyCopper: Number(actor.inventory?.currency?.copperValue ?? 0),
    manifest: structuredClone(outcome.manifest),
  };
  await actor.setFlag(moduleId, "smokeWave4KitEvidence", evidence);
  return { player: userEvidence() };
};

globalThis.__runWayfinderWave4GmProbe = async function gmProbe({
  cases,
  expectedUserId,
  expectedWorldId,
  fixtures,
  moduleId,
  packsSetting,
  runId,
  sourcesSetting,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, true);
  const modules = await loadModules(moduleId);
  const sourceCase = cases.find((entry) => entry.id === "supplemental-source-isolation");
  const actor = fixtureActor(fixtures, "physical-prepared-boundaries", moduleId, runId);
  const evidence = structuredClone(actor.getFlag(moduleId, "smokeWave4SourceEvidence"));
  evidence.gmSources = sourceProbe(modules, sourceCase.allowedFamilies, packsSetting, sourcesSetting, sourceCase);
  await actor.setFlag(moduleId, "smokeWave4SourceEvidence", evidence);
  return { gm: userEvidence() };
};

globalThis.__runWayfinderWave4PlayerVerification = async function playerVerification({
  cases,
  expectedUserId,
  expectedWorldId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadModules(moduleId);
  const runtime = modules.getRuntime();
  const kitCase = cases.find((entry) => entry.id === "adventurers-pack-retry");
  const physicalActor = fixtureActor(fixtures, "physical-prepared-boundaries", moduleId, runId);
  const kitActor = fixtureActor(fixtures, kitCase.id, moduleId, runId);
  const draft = modules.normalizeDraft(kitActor.getFlag(moduleId, "draft"), 1);
  const acquisition = draft.acquisition;
  const plan = classGrantPlan(modules, kitActor, acquisition);
  const beforeNoop = inventorySnapshot(kitActor);
  const recovered = await executionSession(modules, runtime, kitActor, moduleId).prepareRecoveredAcquisitionOutcome({
    actor: kitActor,
    draft: { ...draft, applyRecoveryActorUpdate: { "system.details.level.value": 1 } },
    classGrantPlan: plan,
    finalClassGrantReconciliation: finalReconciliation(acquisition),
  });
  const afterNoop = inventorySnapshot(kitActor);
  const kitEvidence = structuredClone(kitActor.getFlag(moduleId, "smokeWave4KitEvidence"));
  kitEvidence.final = {
    inventory: afterNoop,
    noopUnchanged: canonicalJson(beforeNoop) === canonicalJson(afterNoop),
    durableManifest: structuredClone(modules.normalizeState(kitActor.getFlag(moduleId, "state")).completedAcquisitionManifest),
    recoveredManifest: structuredClone(recovered.manifest),
  };
  return {
    player: userEvidence(),
    cases: [
      {
        id: "physical-prepared-boundaries",
        status: "pass",
        definitionFingerprint: cases.find((entry) => entry.id === "physical-prepared-boundaries").definitionFingerprint,
        actorId: physicalActor.id,
        evidence: structuredClone(physicalActor.getFlag(moduleId, "smokeWave4PhysicalEvidence")),
      },
      {
        id: kitCase.id,
        status: "pass",
        definitionFingerprint: kitCase.definitionFingerprint,
        actorId: kitActor.id,
        evidence: kitEvidence,
      },
      {
        id: "supplemental-source-isolation",
        status: "pass",
        definitionFingerprint: cases.find((entry) => entry.id === "supplemental-source-isolation").definitionFingerprint,
        actorId: physicalActor.id,
        evidence: structuredClone(physicalActor.getFlag(moduleId, "smokeWave4SourceEvidence")),
      },
    ],
  };
};

globalThis.__cleanupWayfinderWave4EquipmentSmoke = async function cleanupWave4({
  allowDestructive,
  expectedWorldId,
  fixtures,
  moduleId,
  packsSetting,
  policySetting,
  runId,
  snapshots,
  sourcesSetting,
}) {
  if (!allowDestructive) throw new Error("Wave 4 equipment cleanup requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("Wave 4 equipment cleanup requires a GM.");
  const actors = fixtures.map((fixture) => fixtureActor(fixtures, fixture.caseId, moduleId, runId));
  await game.settings.set(moduleId, policySetting, snapshots.policy);
  await game.settings.set("pf2e", packsSetting, snapshots.packs);
  await game.settings.set("pf2e", sourcesSetting, snapshots.sources);
  for (const actor of actors) await actor.delete();
  return {
    actorsDeleted: actors.length,
    actorsMissingAfterCleanup: actors.every((actor) => !game.actors.has(actor.id)),
    policyRestored: canonicalJson(game.settings.get(moduleId, policySetting)) === canonicalJson(snapshots.policy),
    packsRestored: canonicalJson(game.settings.get("pf2e", packsSetting)) === canonicalJson(snapshots.packs),
    sourcesRestored: canonicalJson(game.settings.get("pf2e", sourcesSetting)) === canonicalJson(snapshots.sources),
  };
};
