/* global Actor, CONST, game */

const WF3_FIXTURE_PURPOSE = "wave3-equipment-live-gate";

function assertWorld(expectedWorldId) {
  const expected = String(expectedWorldId ?? "").trim();
  if (!expected || game.world?.id !== expected) {
    throw new Error(`Wave 3 equipment smoke expected world ${expected || "<missing>"}, observed ${game.world?.id || "<unknown>"}.`);
  }
}

function assertUser(expectedUserId, isGM) {
  if (!game.user || game.user.id !== expectedUserId || Boolean(game.user.isGM) !== isGM) {
    throw new Error(`Wave 3 equipment smoke requires the exact ${isGM ? "GM" : "non-GM player"} executor.`);
  }
}

async function loadWave3Modules(moduleId) {
  const [draftService, commands, steps, runtime, acquisitionDraft] = await Promise.all([
    import(`/modules/${moduleId}/scripts/draft-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/starting-equipment-command-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/domain/step-types.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-acquisition-runtime-service.js`),
    import(`/modules/${moduleId}/scripts/wayfinder/domain/acquisition-draft.js`),
  ]);
  return {
    createEmptyDraft: draftService.createEmptyDraft,
    normalizeDraft: draftService.normalizeDraft,
    normalizeState: draftService.normalizeState,
    execute: commands.executeStartingEquipmentCommand,
    createStartingEquipmentStep: steps.createStartingEquipmentStep,
    getRuntime: runtime.getFoundryEquipmentAcquisitionRuntime,
    createRuntime: runtime.createEquipmentAcquisitionRuntime,
    ConfiguredItemHandoffRequiredError: runtime.ConfiguredItemHandoffRequiredError,
    createPolicySnapshot: acquisitionDraft.createAcquisitionPolicySnapshot,
  };
}

function userEvidence() {
  return {
    id: game.user.id,
    name: game.user.name,
    role: Number(game.user.role),
    isGM: Boolean(game.user.isGM),
  };
}

function runtimeEvidence(moduleId, expectedWorldId) {
  const record = game.modules.get(moduleId);
  if (!record?.active) throw new Error(`${moduleId} is not active in the guarded world.`);
  const evidence = {
    foundryVersion: String(game.version ?? ""),
    pf2eVersion: String(game.system?.id === "pf2e" ? game.system.version ?? "" : ""),
    moduleVersion: String(record.version ?? record.manifest?.version ?? ""),
    worldId: String(game.world?.id ?? expectedWorldId ?? ""),
  };
  if (Object.values(evidence).some((value) => !value)) throw new Error("Live runtime identity is incomplete.");
  return evidence;
}

function fixtureActor(fixture, moduleId, runId) {
  const actor = game.actors.get(fixture.actorId);
  const marker = actor?.getFlag(moduleId, "smokeWave3Equipment");
  if (
    !actor ||
    actor.name !== fixture.fixtureName ||
    marker?.purpose !== WF3_FIXTURE_PURPOSE ||
    marker?.runId !== runId ||
    marker?.caseId !== fixture.caseId ||
    marker?.definitionFingerprint !== fixture.definitionFingerprint
  ) {
    throw new Error("Wave 3 equipment smoke refused a fixture with changed guarded identity.");
  }
  return actor;
}

function draftFor(actor, modules, targetLevel, moduleId) {
  return modules.normalizeDraft(actor.getFlag(moduleId, "draft"), targetLevel);
}

async function executeAndPersist(actor, draft, command, modules, moduleId) {
  const result = await modules.execute(command, {
    actor,
    draft,
    moduleState: modules.normalizeState(actor.getFlag(moduleId, "state")),
    steps: [modules.createStartingEquipmentStep(draft.targetLevel)],
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

function economicSnapshot(actor, moduleId, judgmentSetting) {
  return {
    currencyCopper: Number(actor.inventory?.currency?.copperValue ?? 0),
    items: actor.items
      .filter((item) => item.isOfType?.("physical"))
      .map((item) => ({ id: item.id, sourceId: item.sourceId ?? null, quantity: Number(item.quantity ?? 0) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    draft: structuredClone(actor.getFlag(moduleId, "draft") ?? null),
    state: structuredClone(actor.getFlag(moduleId, "state") ?? null),
    judgments: structuredClone(game.settings.get(moduleId, judgmentSetting)),
  };
}

function inventorySnapshot(actor) {
  return {
    currencyCopper: Number(actor.inventory?.currency?.copperValue ?? 0),
    items: actor.items
      .filter((item) => item.isOfType?.("physical"))
      .map((item) => ({ id: item.id, sourceId: item.sourceId ?? null, quantity: Number(item.quantity ?? 0) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
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

globalThis.__prepareWayfinderWave3EquipmentSmoke = async function prepareWave3EquipmentSmoke({
  allowDestructive = false,
  cases,
  expectedWorldId,
  fixturePrefix,
  moduleId,
  playerName,
  policySetting,
  runId,
}) {
  if (!allowDestructive) throw new Error("Wave 3 equipment smoke requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("Wave 3 equipment fixture setup requires a current GM.");
  const player = game.users.find((candidate) => candidate.name === playerName && !candidate.isGM && candidate.id !== game.user.id);
  if (!player) throw new Error("The configured distinct non-GM player is unavailable.");
  const modules = await loadWave3Modules(moduleId);
  const policySnapshot = structuredClone(game.settings.get(moduleId, policySetting));
  const guardedPolicy = {
    ...policySnapshot,
    version: 1,
    enabledRecipes: ["permanent-items", "lump-sum"],
    defaultRecipe: "permanent-items",
    recipeChoiceAuthority: "actor-owner",
    higherLevelStartAuthority: "gm-confirmation",
    blanketRarity: "common",
    allowedEquipmentPackFamilies: ["pf2e"],
    applyAuthority: "actor-owner",
  };
  const fixtures = [];
  await game.settings.set(moduleId, policySetting, guardedPolicy);
  try {
    for (const smokeCase of cases) {
      const fixtureName = `${fixturePrefix} - ${runId} - ${smokeCase.id}`;
      const actor = await Actor.create({
        name: fixtureName,
        type: "character",
        ownership: {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
          [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        },
        system: { details: { level: { value: smokeCase.targetLevel } } },
        flags: {
          [moduleId]: {
            smokeWave3Equipment: {
              schemaVersion: 1,
              purpose: WF3_FIXTURE_PURPOSE,
              runId,
              caseId: smokeCase.id,
              definitionFingerprint: smokeCase.definitionFingerprint,
              fixtureName,
              playerId: player.id,
              preparedByUserId: game.user.id,
              worldId: expectedWorldId,
            },
          },
        },
      });
      if (!actor) throw new Error(`Could not create Wave 3 fixture ${smokeCase.id}.`);
      await actor.setFlag(moduleId, "draft", modules.createEmptyDraft(smokeCase.targetLevel));
      fixtures.push({
        actorId: actor.id,
        caseId: smokeCase.id,
        definitionFingerprint: smokeCase.definitionFingerprint,
        fixtureName,
        targetLevel: smokeCase.targetLevel,
      });
    }
  } catch (error) {
    for (const fixture of fixtures) {
      const actor = game.actors.get(fixture.actorId);
      if (actor?.getFlag(moduleId, "smokeWave3Equipment")?.runId === runId) await actor.delete();
    }
    await game.settings.set(moduleId, policySetting, policySnapshot);
    throw error;
  }
  return {
    fixtures,
    gm: userEvidence(),
    playerId: player.id,
    policySnapshot,
    runtime: runtimeEvidence(moduleId, expectedWorldId),
  };
};

globalThis.__runWayfinderWave3PlayerStart = async function runWave3PlayerStart({
  cases,
  expectedWorldId,
  expectedUserId,
  fixtures,
  judgmentSetting,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadWave3Modules(moduleId);
  let zeroWrite = null;
  for (const smokeCase of cases) {
    const fixture = fixtures.find((entry) => entry.caseId === smokeCase.id);
    const actor = fixtureActor(fixture, moduleId, runId);
    if (!actor.isOwner) throw new Error(`${smokeCase.id}: configured player does not own the fixture.`);
    const draft = draftFor(actor, modules, smokeCase.targetLevel, moduleId);
    await executeAndPersist(
      actor,
      draft,
      { type: "initialize", selectedRecipe: smokeCase.selectedRecipe },
      modules,
      moduleId,
    );
    const requested = await executeAndPersist(
      actor,
      draft,
      {
        type: "request-higher-level-start",
        startKind: "replacement-character",
        reason: `Wave 3 live gate request ${runId}`,
      },
      modules,
      moduleId,
    );
    const request = requested.policyRequests.find((entry) => entry.facts.kind === "higher-level-start");
    if (!request) throw new Error(`${smokeCase.id}: player request was not durably recorded.`);
    if (!zeroWrite) {
      const before = economicSnapshot(actor, moduleId, judgmentSetting);
      let denial = "";
      try {
        await modules.execute(
          { type: "approve-policy-request", requestId: request.requestId, reason: "Unauthorized live probe" },
          {
            actor,
            draft,
            moduleState: modules.normalizeState(actor.getFlag(moduleId, "state")),
            steps: [modules.createStartingEquipmentStep(draft.targetLevel)],
            userId: game.user.id,
            user: game.user,
            now: () => new Date().toISOString(),
          },
        );
      } catch (error) {
        denial = error instanceof Error ? error.message : String(error);
      }
      const after = economicSnapshot(actor, moduleId, judgmentSetting);
      zeroWrite = {
        actorId: actor.id,
        denied: /gm/i.test(denial),
        message: denial,
        unchanged: canonicalJson(before) === canonicalJson(after),
      };
    }
  }
  return { player: userEvidence(), zeroWrite };
};

globalThis.__runWayfinderWave3GmApproval = async function runWave3GmApproval({
  cases,
  expectedWorldId,
  expectedUserId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, true);
  const modules = await loadWave3Modules(moduleId);
  for (const smokeCase of cases) {
    const fixture = fixtures.find((entry) => entry.caseId === smokeCase.id);
    const actor = fixtureActor(fixture, moduleId, runId);
    const draft = draftFor(actor, modules, smokeCase.targetLevel, moduleId);
    const request = draft.equipmentPolicyRequests.find((entry) => entry.facts.kind === "higher-level-start");
    if (!request) throw new Error(`${smokeCase.id}: GM could not find the exact player start request.`);
    await executeAndPersist(
      actor,
      draft,
      { type: "approve-policy-request", requestId: request.requestId, reason: `Approved by Wave 3 live gate ${runId}` },
      modules,
      moduleId,
    );
    if (smokeCase.customAmountCopper !== undefined) {
      await executeAndPersist(
        actor,
        draft,
        {
          type: "set-custom-lump-sum",
          amountCopper: smokeCase.customAmountCopper,
          reason: `Custom Wave 3 live gate amount ${runId}`,
        },
        modules,
        moduleId,
      );
    }
    if (smokeCase.grantExtraAllowance) {
      await executeAndPersist(
        actor,
        draft,
        { type: "grant-extra-current-level-allowance", reason: `Wave 3 live gate allowance ${runId}` },
        modules,
        moduleId,
      );
    }
  }
  return { gm: userEvidence() };
};

globalThis.__runWayfinderWave3PlayerExceptionRequests = async function runWave3PlayerExceptionRequests({
  cases,
  expectedWorldId,
  expectedUserId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadWave3Modules(moduleId);
  for (const smokeCase of cases.filter((entry) => entry.configuredItem)) {
    const fixture = fixtures.find((entry) => entry.caseId === smokeCase.id);
    const actor = fixtureActor(fixture, moduleId, runId);
    const draft = draftFor(actor, modules, smokeCase.targetLevel, moduleId);
    await executeAndPersist(
      actor,
      draft,
      {
        type: "request-item-exception",
        sourceUuid: smokeCase.configuredItem.sourceUuid,
        reason: `Exact Wave 3 item request ${runId}`,
      },
      modules,
      moduleId,
    );
  }
  return { player: userEvidence() };
};

globalThis.__runWayfinderWave3GmExceptionApprovals = async function runWave3GmExceptionApprovals({
  cases,
  expectedWorldId,
  expectedUserId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, true);
  const modules = await loadWave3Modules(moduleId);
  for (const smokeCase of cases.filter((entry) => entry.configuredItem)) {
    const fixture = fixtures.find((entry) => entry.caseId === smokeCase.id);
    const actor = fixtureActor(fixture, moduleId, runId);
    const draft = draftFor(actor, modules, smokeCase.targetLevel, moduleId);
    const requests = draft.equipmentPolicyRequests.filter(
      (entry) =>
        entry.facts.kind === "rarity-source-exception" &&
        entry.facts.sourceUuid === smokeCase.configuredItem.sourceUuid,
    );
    if (requests.length !== 1) throw new Error(`${smokeCase.id}: exact Morning Glow request is incomplete.`);
    for (const request of requests) {
      await executeAndPersist(
        actor,
        draft,
        { type: "approve-policy-request", requestId: request.requestId, reason: `Approved exact Wave 3 item ${runId}` },
        modules,
        moduleId,
      );
    }
  }
  return { gm: userEvidence() };
};

globalThis.__runWayfinderWave3PlayerVerification = async function runWave3PlayerVerification({
  cases,
  expectedWorldId,
  expectedUserId,
  fixtures,
  moduleId,
  runId,
}) {
  assertWorld(expectedWorldId);
  assertUser(expectedUserId, false);
  const modules = await loadWave3Modules(moduleId);
  const results = [];
  for (const smokeCase of cases) {
    const fixture = fixtures.find((entry) => entry.caseId === smokeCase.id);
    const actor = fixtureActor(fixture, moduleId, runId);
    const draft = draftFor(actor, modules, smokeCase.targetLevel, moduleId);
    if (smokeCase.id === "level-5-lump-sum" || smokeCase.id === "level-20-permanent-items") {
      await executeAndPersist(actor, draft, { type: "retain-all" }, modules, moduleId);
    }
    const policy = draft.acquisition?.policySnapshot?.material;
    if (!policy) throw new Error(`${smokeCase.id}: durable active policy is missing.`);
    const result = {
      id: smokeCase.id,
      status: "pass",
      definitionFingerprint: smokeCase.definitionFingerprint,
      actorId: actor.id,
      targetLevel: draft.targetLevel,
      subject: structuredClone(policy.subject),
      recipe: structuredClone(policy.recipe),
      startEvidence: structuredClone(policy.higherLevelStartEvidence),
    };
    if (smokeCase.configuredItem) {
      const runtime = modules.getRuntime();
      const allowance = policy.recipe.allowances?.find((entry) => entry.itemLevel === smokeCase.targetLevel);
      if (!allowance) throw new Error("Configured item fixture lacks its exact current-level GM allowance.");
      const request = {
        actor,
        draft,
        step: modules.createStartingEquipmentStep(draft.targetLevel),
        query: "",
        filters: {},
        previewSourceUuid: null,
        funding: { lane: "allowance", allowanceId: allowance.allowanceId },
      };
      const configuredLine = await runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid: smokeCase.configuredItem.sourceUuid,
      });
      const handoffPolicy = {
        ...policy,
        rarityPolicy: { blanketCeiling: "unique" },
        gmJudgments: policy.gmJudgments.filter(
          (entry) => entry.request.facts.sourceUuid !== smokeCase.handoffItem.sourceUuid,
        ),
      };
      const handoffAcquisition = {
        ...draft.acquisition,
        policySnapshot: modules.createPolicySnapshot(handoffPolicy, draft.acquisition.recipe),
      };
      const handoffDraft = { ...draft, acquisition: handoffAcquisition };
      const handoffRuntime = modules.createRuntime({
        packs: game.packs,
        resolveEffectivePolicy: () => handoffPolicy,
      });
      let handoffMessage = "";
      let typedDisposition = null;
      let statusNote = "";
      const inventoryBeforeHandoff = inventorySnapshot(actor);
      try {
        await handoffRuntime.uiAdapter.prepareLine({
          ...request,
          draft: handoffDraft,
          sourceUuid: smokeCase.handoffItem.sourceUuid,
        });
      } catch (error) {
        handoffMessage = error instanceof Error ? error.message : String(error);
        if (
          modules.ConfiguredItemHandoffRequiredError &&
          error instanceof modules.ConfiguredItemHandoffRequiredError
        ) {
          const handoffResult = await executeAndPersist(
            actor,
            draft,
            { type: "enter-configured-item-handoff", reason: structuredClone(error.reason) },
            modules,
            moduleId,
          );
          typedDisposition = structuredClone(draft.acquisition?.disposition ?? null);
          statusNote = handoffResult.statusNote;
        }
      }
      Object.assign(result, {
        abp: structuredClone(policy.abp),
        configuredLine: structuredClone(configuredLine),
        handoff: {
          sourceUuid: smokeCase.handoffItem.sourceUuid,
          message: handoffMessage,
          typedDisposition,
          statusNote,
          economicWritesUnchanged:
            canonicalJson(inventoryBeforeHandoff) === canonicalJson(inventorySnapshot(actor)),
          persistedExceptionApproved: policy.gmJudgments.some(
            (entry) => entry.request.facts.sourceUuid === smokeCase.handoffItem.sourceUuid,
          ),
        },
        approvedExceptionSourceUuids: policy.gmJudgments
          .filter((entry) => entry.kind === "rarity-source-exception")
          .map((entry) => entry.request.facts.sourceUuid)
          .sort(),
      });
    }
    results.push(result);
  }
  return { cases: results, player: userEvidence() };
};

globalThis.__cleanupWayfinderWave3EquipmentSmoke = async function cleanupWave3EquipmentSmoke({
  allowDestructive = false,
  expectedWorldId,
  fixtures,
  judgmentSetting,
  moduleId,
  policySetting,
  policySnapshot,
  runId,
}) {
  if (!allowDestructive) throw new Error("Wave 3 equipment cleanup requires destructive opt-in.");
  assertWorld(expectedWorldId);
  if (!game.user?.isGM) throw new Error("Wave 3 equipment cleanup requires a current GM.");
  const actors = fixtures.map((fixture) => fixtureActor(fixture, moduleId, runId));
  const actorIds = new Set(actors.map((actor) => actor.id));
  const store = structuredClone(game.settings.get(moduleId, judgmentSetting));
  const retainedJudgments = Array.isArray(store?.judgments)
    ? store.judgments.filter((entry) => !actorIds.has(entry.actorId))
    : [];
  await game.settings.set(moduleId, judgmentSetting, { version: 1, judgments: retainedJudgments });
  await game.settings.set(moduleId, policySetting, policySnapshot);
  for (const actor of actors) await actor.delete();
  return {
    actorsDeleted: actors.length,
    actorsMissingAfterCleanup: actors.every((actor) => !game.actors.has(actor.id)),
    fixtureJudgmentsRemoved: retainedJudgments.length === (store?.judgments?.length ?? 0) - countFixtureJudgments(store, actorIds),
    policyRestored: canonicalJson(game.settings.get(moduleId, policySetting)) === canonicalJson(policySnapshot),
  };
};

function countFixtureJudgments(store, actorIds) {
  return Array.isArray(store?.judgments) ? store.judgments.filter((entry) => actorIds.has(entry.actorId)).length : 0;
}
