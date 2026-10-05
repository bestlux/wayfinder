import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDraftPatch, createEmptyDraft, normalizeDraft, normalizeState } from "../src/draft-service";
import {
  executeStartingEquipmentCommand,
  type StartingEquipmentCommandContext,
} from "../src/wayfinder/application/starting-equipment-command-service";
import type { StartingEquipmentUiAdapter } from "../src/wayfinder/application/starting-equipment-ui-adapter";
import { createAcquisitionCurrencyConvergenceWitness } from "../src/wayfinder/domain/acquisition-currency-convergence";
import { reconcileAcquisitionTargetLevel } from "../src/wayfinder/domain/acquisition-draft";
import { evaluateAcquisitionLedger, reviewRetainAll } from "../src/wayfinder/domain/acquisition-ledger";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../src/wayfinder/domain/acquisition-types";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  type PlannedClassGrantV1,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyRequest,
  createEquipmentPolicyResolver,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
  type EquipmentPolicyJudgmentRecord,
  type EquipmentWorldPolicyV1,
} from "../src/wayfinder/domain/equipment-policy";
import { createStartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import { acquisitionFixture, acquisitionLine, acquisitionPrice } from "./fixtures/acquisition-fixture";

type CommandDependencies = NonNullable<Parameters<typeof executeStartingEquipmentCommand>[2]>;
const NOW = "2026-10-05T20:00:00.000Z";
const ACTIVATE = { type: "activate-policy", startKind: "new-campaign", reason: "New target level" } as const;

describe("starting equipment after changing the draft target level", () => {
  beforeEach(() => {
    vi.stubGlobal("game", { system: { id: "pf2e", version: "8.5.1" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    4, 6,
  ])("recaptures coin-only equipment at level %i without minting another acquisition", async (targetLevel) => {
    const context = retargetContext(targetLevel);
    const before = structuredClone(context.draft);
    const deps = reentryDependencies(context);

    const activated = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(activated.acquisition).toMatchObject({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel,
      baseline: deps.baseline,
      disposition: { kind: "unreviewed" },
      lines: [],
      policySnapshot: { material: { subject: { targetLevel } } },
    });
    expect(activated.status).toMatchObject({ key: "wayfinder-pf2e.StartingEquipment.Status.TargetLevelChanged" });
    expect(deps.mintIdentity).not.toHaveBeenCalled();
    expect(context.draft).toEqual(before);
    context.draft.acquisition = activated.acquisition;

    const reviewed = await executeStartingEquipmentCommand({ type: "retain-all" }, context, deps);
    const ledger = evaluateAcquisitionLedger(reviewed.acquisition, deps.plan(reviewed.acquisition));
    expect(ledger.valid).toBe(true);
    expect(reviewed.acquisition.disposition).toMatchObject({
      kind: "retain-all",
      retainedCopper: ledger.budgetCopper,
      review: { reviewedAt: NOW },
    });
  });

  it("reinitializes level 1 with fresh policy, baseline and recipe provenance while preserving choices through reopen", async () => {
    const context = retargetContext(1);
    context.draft.classChoices["class-choice-level-1"] = "guardian-choice";
    context.draft.languageChoices["languages-level-1"] = ["common", "dwarven"];
    context.draft.boosts.class.keyAbility = "str";
    context.draft = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(context.draft))), 1);
    const before = structuredClone(context.draft);
    const deps = reentryDependencies(context);

    const initialized = await executeStartingEquipmentCommand({ type: "initialize" }, context, deps);

    expect(initialized.acquisition).toMatchObject({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      baseline: deps.baseline,
      policySnapshot: { material: { budgetCopper: 1_500, higherLevelStartEvidence: { kind: "not-required" } } },
      recipeSelection: {
        selectedAt: NOW,
        selector: { kind: "user", userId: "owner-1" },
        authority: { mode: "level-one-choice" },
      },
    });
    expect(context.draft).toEqual(before);
    expect(deps.mintIdentity).not.toHaveBeenCalled();
    expect(deps.saveJudgment).not.toHaveBeenCalled();
    context.draft.acquisition = initialized.acquisition;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(context.draft))), 1);
    expect(reopened.acquisition).toEqual(initialized.acquisition);
    expect(reopened.classChoices).toEqual(before.classChoices);
    expect(reopened.languageChoices).toEqual(before.languageChoices);
    expect(reopened.boosts).toEqual(before.boosts);
    const retained = await executeStartingEquipmentCommand(
      { type: "retain-all" },
      { ...context, draft: reopened },
      deps
    );
    expect(retained.acquisition.disposition).toMatchObject({ kind: "retain-all", retainedCopper: 1_500 });
  });

  it("lets GM request approval restore a known target-change state without replacing its identity", async () => {
    const context = retargetContext(6);
    context.user = { id: "gm-1", name: "GM", isGM: true };
    context.userId = "gm-1";
    context.draft.equipmentPolicyRequests = [startRequest(context)];
    const deps = reentryDependencies(context, DEFAULT_EQUIPMENT_WORLD_POLICY);

    const result = await executeStartingEquipmentCommand(
      { type: "approve-policy-request", requestId: "request-6", reason: "Approved" },
      context,
      deps
    );

    expect(deps.saveJudgment).toHaveBeenCalledOnce();
    expect(deps.mintIdentity).not.toHaveBeenCalled();
    expect(result.acquisition).toMatchObject({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      baseline: deps.baseline,
      policySnapshot: { material: { higherLevelStartEvidence: { kind: "gm-confirmation" } } },
    });
  });

  it("lets a direct GM confirmation restore existing shopping after a target change", async () => {
    const context = retargetContext(6, [acquisitionLine()]);
    context.user = { id: "gm-1", name: "GM", isGM: true };
    context.userId = "gm-1";
    const deps = reentryDependencies(context, DEFAULT_EQUIPMENT_WORLD_POLICY);

    const result = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(deps.saveJudgment).toHaveBeenCalledOnce();
    expect(result.acquisition.policySnapshot?.material.higherLevelStartEvidence).toMatchObject({
      kind: "gm-confirmation",
      judgment: { id: "gm-reentry-judgment", targetLevel: 6 },
    });
    expect(result.acquisition.lines).toMatchObject([{ lineId: "line-1", documentFingerprint: "fresh-document" }]);
    expect(deps.mintIdentity).not.toHaveBeenCalled();
  });

  it("accepts recipe reselection only for explicit target drift, retaining cart identity for later restoration", async () => {
    const line = acquisitionLine({ requestedQuantity: 3, stackingIntent: "separate" });
    const context = retargetContext(6, [line]);
    const deps = reentryDependencies(context);

    const selected = await executeStartingEquipmentCommand(
      { type: "select-recipe", selectedRecipe: "lump-sum" },
      context,
      deps
    );

    expect(selected.acquisition).toMatchObject({
      recipe: { kind: "lump-sum" },
      policySnapshot: null,
      disposition: { kind: "unreviewed", reasons: ["target-level"] },
      lines: [line],
    });
    context.draft.acquisition = selected.acquisition;
    const restored = await executeStartingEquipmentCommand(ACTIVATE, context, deps);
    expect(restored.acquisition.lines[0]).toMatchObject({
      lineId: line.lineId,
      stackingIntent: "separate",
      funding: { lane: "currency" },
      price: { requestedQuantity: 3, materializedQuantity: 3, linePriceCopper: 600 },
    });
    expect(deps.mintIdentity).not.toHaveBeenCalled();
  });

  it.each(["active-shopping", "arbitrary-staging"] as const)("rejects recipe changes to %s", async (state) => {
    const context = retargetContext(6, [acquisitionLine()]);
    if (state === "active-shopping") {
      context.draft.acquisition = acquisitionFixture({ disposition: "unreviewed" }).draft;
      context.draft.targetLevel = 5;
      context.steps = [createStartingEquipmentStep(5)];
    } else {
      context.draft.acquisition = {
        ...context.draft.acquisition!,
        disposition: { kind: "unreviewed", invalidatedFrom: "purchase-ledger", reasons: ["policy"] },
      };
    }
    const before = structuredClone(context.draft);
    const deps = reentryDependencies(context);

    await expect(
      executeStartingEquipmentCommand({ type: "select-recipe", selectedRecipe: "lump-sum" }, context, deps)
    ).rejects.toThrow();
    expect(context.draft).toEqual(before);
    expect(deps.prepareLine).not.toHaveBeenCalled();
    expect(deps.saveJudgment).not.toHaveBeenCalled();
  });

  it("freshly prepares cart sources but keeps their line IDs, separate stacking, and requested quantities", async () => {
    const first = acquisitionLine({ lineId: "first", requestedQuantity: 3 });
    const second = acquisitionLine({ lineId: "second", requestedQuantity: 2, stackingIntent: "separate" });
    const context = retargetContext(6, [first, second]);
    const deps = reentryDependencies(context);

    const result = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(deps.assertSourceHealth).toHaveBeenCalledOnce();
    expect(deps.prepareLine).toHaveBeenCalledTimes(2);
    expect(deps.prepareLine.mock.calls.map(([request]) => request.lineId)).toEqual(["first", "second"]);
    expect(result.acquisition.lines).toMatchObject([
      {
        lineId: "first",
        documentFingerprint: "fresh-document",
        priceFingerprint: "fresh-price",
        stackingIntent: "aggregate",
        price: { requestedQuantity: 3, materializedQuantity: 3, linePriceCopper: 600 },
      },
      {
        lineId: "second",
        stackingIntent: "separate",
        price: { requestedQuantity: 2, materializedQuantity: 2, linePriceCopper: 400 },
      },
    ]);
    context.draft.acquisition = result.acquisition;
    const reviewed = await executeStartingEquipmentCommand({ type: "review-purchases" }, context, deps);
    expect(reviewed.acquisition.disposition.kind).toBe("purchase-ledger");
    expect(evaluateAcquisitionLedger(reviewed.acquisition, deps.plan(reviewed.acquisition)).valid).toBe(true);
  });

  it.each([
    "permanent-items",
    "lump-sum",
  ] as const)("restores old allowance purchases under the current %s recipe", async (recipe) => {
    const line = acquisitionLine({
      funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "obsolete-allowance" } },
    });
    const context = retargetContext(6, [line]);
    context.draft.acquisition = { ...context.draft.acquisition!, recipe: { kind: recipe } };
    const deps = reentryDependencies(context);

    const restored = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(restored.acquisition.lines).toHaveLength(1);
    expect(restored.acquisition.lines[0]?.lineId).toBe(line.lineId);
    expect(restored.acquisition.lines[0]?.funding).toEqual(
      recipe === "permanent-items" ? { lane: "allowance", assignment: { mode: "automatic" } } : { lane: "currency" }
    );
    if (recipe === "permanent-items") {
      expect(deps.prepareLine.mock.calls[0]?.[0].funding).toMatchObject({ lane: "allowance" });
      expect(deps.prepareLine.mock.calls[0]?.[0].funding).not.toMatchObject({ allowanceId: "obsolete-allowance" });
    }
  });

  it.each([
    { previousItemLevel: 1, refreshedItemLevel: 4, targetLevel: 6 },
    { previousItemLevel: 6, refreshedItemLevel: 2, targetLevel: 4 },
  ])("funds a refreshed level-$refreshedItemLevel source with current allowances after its old level-$previousItemLevel snapshot changes", async ({
    previousItemLevel,
    refreshedItemLevel,
    targetLevel,
  }) => {
    const previous = acquisitionLine({
      lineId: "allowance-source",
      itemLevel: previousItemLevel,
      funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "obsolete-allowance" } },
    });
    const context = retargetContext(targetLevel, [previous]);
    const deps = reentryDependencies(context);
    deps.prepareLine.mockImplementation(async (request) => {
      const currentAllowances = request.draft.acquisition!.policySnapshot!.material.allowances;
      const funding = request.funding;
      if (funding?.lane === "allowance") {
        const requestedAllowance = currentAllowances.find((allowance) => allowance.allowanceId === funding.allowanceId);
        if (!requestedAllowance || requestedAllowance.itemLevel < refreshedItemLevel) {
          throw new TypeError("The selected allowance cannot fund the freshly loaded source level.");
        }
      }
      return { ...(await freshLine(request)), itemLevel: refreshedItemLevel };
    });

    const restored = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(deps.prepareLine).toHaveBeenCalledOnce();
    expect(restored.acquisition.lines).toMatchObject([
      {
        lineId: previous.lineId,
        itemLevel: refreshedItemLevel,
        funding: { lane: "allowance", assignment: { mode: "automatic" } },
      },
    ]);
    const ledger = evaluateAcquisitionLedger(restored.acquisition, deps.plan(restored.acquisition));
    expect(ledger.valid).toBe(true);
    expect(ledger.spentCopper).toBe(0);
    expect(restored.status).toMatchObject({ key: "wayfinder-pf2e.StartingEquipment.Status.TargetLevelChanged" });
  });

  it("discards an unsupported individual line with a count while restoring safe purchases", async () => {
    const safe = acquisitionLine({ lineId: "safe" });
    const unavailable = acquisitionLine({
      lineId: "unavailable",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.gone",
    });
    const context = retargetContext(6, [safe, unavailable]);
    const deps = reentryDependencies(context);
    deps.prepareLine.mockImplementation(async (request) => {
      if (request.sourceUuid === unavailable.sourceUuid) throw new TypeError("This source is unavailable.");
      return freshLine(request);
    });

    const restored = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(restored.acquisition.lines.map((line) => line.lineId)).toEqual([safe.lineId]);
    expect(restored.status).toEqual({
      key: "wayfinder-pf2e.StartingEquipment.Status.TargetLevelChangedItems",
      values: { count: 1 },
    });
    expect(deps.mintIdentity).not.toHaveBeenCalled();
  });

  it("blocks unhealthy global sources before restoring any cart line", async () => {
    const context = retargetContext(6, [acquisitionLine()]);
    const deps = reentryDependencies(context);
    const before = structuredClone(context.draft);
    deps.assertSourceHealth.mockRejectedValue(new Error("The approved equipment pack is missing."));

    await expect(executeStartingEquipmentCommand(ACTIVATE, context, deps)).rejects.toThrow(/pack is missing/i);

    expect(context.draft).toEqual(before);
    expect(deps.prepareLine).not.toHaveBeenCalled();
    expect(deps.mintIdentity).not.toHaveBeenCalled();
  });

  it("moves newly detected foreign wealth to a handoff without restoring purchase intent", async () => {
    const context = retargetContext(6, [acquisitionLine()]);
    const deps = reentryDependencies(context);
    const baseline = createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: NOW,
      currencyCopper: 100,
      physicalItems: [],
    });
    deps.evaluateAdmission.mockReturnValue({
      kind: "handoff",
      baseline,
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: baseline.fingerprint,
        reasons: [{ code: "nonzero-currency", copper: 100 }],
      },
    });

    const result = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(result.acquisition.lines).toEqual([]);
    expect(result.acquisition.baseline).toEqual(baseline);
    expect(result.acquisition.disposition).toMatchObject({
      kind: "handoff",
      acknowledgedByUserId: null,
      handoff: { reasons: [{ code: "nonzero-currency", copper: 100 }] },
    });
    expect(deps.prepareLine).not.toHaveBeenCalled();
    expect(result.status).toMatchObject({
      key: "wayfinder-pf2e.StartingEquipment.Status.TargetLevelChangedItems",
      values: { count: 1 },
    });
  });

  it("reprojects native grants with stable identity and removes a stale Titan Mauler selection", async () => {
    const native = nativeGrant();
    const nativeLine = acquisitionLine({
      lineId: "old-native-line",
      sourceUuid: native.expected.sourceUuid,
      itemLevel: 0,
      funding: { lane: "class-grant", grant: { plannedGrantId: native.grantId } },
      stackingIntent: "separate",
    });
    const titanLine = acquisitionLine({
      lineId: "old-titan-line",
      itemLevel: 0,
      funding: {
        lane: "class-grant",
        grant: { plannedGrantId: "class-grant:titan-mauler:class-branch-instinct-level-1" },
      },
    });
    const context = retargetContext(6, [nativeLine, titanLine], [native, titanGrant(titanLine)]);
    const deps = reentryDependencies(context, undefined, [native]);
    deps.projectClassGrants.mockImplementation(async (_actor, draft) => ({
      grants: [native],
      preparedPlan: deps.plan(draft.acquisition!),
      blockers: [
        {
          code: "titan-selection-required",
          profileId: "giant-instinct-titan-mauler",
          message: "Choose a current Titan Mauler weapon.",
        },
      ],
    }));
    deps.prepareNativeGrantLines.mockResolvedValue([
      { ...nativeLine, lineId: "new-prepared-native-line", documentFingerprint: "fresh-native-document" },
    ]);

    const result = await executeStartingEquipmentCommand(ACTIVATE, context, deps);

    expect(result.acquisition.plannedClassGrants).toEqual([native]);
    expect(result.acquisition.lines).toMatchObject([
      { lineId: "old-native-line", documentFingerprint: "fresh-native-document" },
    ]);
    expect(result.acquisition.lines).toHaveLength(1);
    expect(deps.prepareLine).not.toHaveBeenCalled();
    expect(result.status).toMatchObject({
      key: "wayfinder-pf2e.StartingEquipment.Status.TargetLevelChangedItems",
      values: { count: 1 },
    });
  });

  it.each([
    "activate-policy",
    "approve-policy-request",
  ] as const)("rejects structurally invalid staging before %s writes authority", async (type) => {
    const context = retargetContext(6);
    context.draft.acquisition = {
      ...context.draft.acquisition!,
      disposition: { kind: "unreviewed", invalidatedFrom: "retain-all", reasons: ["policy"] },
    };
    context.draft.equipmentPolicyRequests = [startRequest(context)];
    context.user = { id: "gm-1", name: "GM", isGM: true };
    const deps = reentryDependencies(context, DEFAULT_EQUIPMENT_WORLD_POLICY);
    const before = structuredClone(context.draft);
    const command = type === "activate-policy" ? ACTIVATE : { type, requestId: "request-6", reason: "Approved" };

    await expect(executeStartingEquipmentCommand(command, context, deps)).rejects.toThrow();

    expect(context.draft).toEqual(before);
    expect(deps.saveJudgment).not.toHaveBeenCalled();
    expect(deps.mintIdentity).not.toHaveBeenCalled();
    expect(deps.evaluateAdmission).not.toHaveBeenCalled();
  });

  it.each([
    "apply-attempt",
    "actor-recovery",
    "grant-journal",
    "currency-witness",
  ] as const)("rejects %s recovery before changing equipment authority", async (recovery) => {
    const context = retargetContext(6);
    if (recovery === "apply-attempt") context.draft.applyAttemptStepIds = ["starting-equipment-level-5"];
    if (recovery === "actor-recovery") context.draft.applyRecoveryActorUpdate = { "system.details.level.value": 5 };
    if (recovery === "grant-journal") {
      context.draft.acquisition = {
        ...context.draft.acquisition!,
        classGrantReconciliations: [
          {
            version: 1,
            draftId: "draft-1",
            batchId: "batch-1",
            phase: "before-acquisition",
            entries: [],
            ignoredItemIds: [],
            unresolvedGrantIds: [],
            ambiguousGrantIds: [],
          },
        ],
      };
    }
    if (recovery === "currency-witness") {
      context.draft.acquisition = {
        ...context.draft.acquisition!,
        currencyConvergenceWitness: createAcquisitionCurrencyConvergenceWitness({
          actorId: "actor-1",
          draftId: "draft-1",
          batchId: "batch-1",
          manifestId: "manifest-1",
          ledgerDigest: "ledger-digest",
          baselineFingerprint: context.draft.acquisition!.baseline!.fingerprint,
          preCopper: 0,
          targetCopper: 1_000,
          observedCopper: 1_000,
          verifiedAt: NOW,
        }),
      };
    }
    context.user = { id: "gm-1", name: "GM", isGM: true };
    const before = structuredClone(context.draft);
    const deps = reentryDependencies(context, DEFAULT_EQUIPMENT_WORLD_POLICY);

    await expect(executeStartingEquipmentCommand(ACTIVATE, context, deps)).rejects.toThrow();

    expect(context.draft).toEqual(before);
    expect(deps.saveJudgment).not.toHaveBeenCalled();
    expect(deps.resolvePolicy).not.toHaveBeenCalled();
    expect(deps.prepareLine).not.toHaveBeenCalled();
  });
});

function retargetContext(
  targetLevel: number,
  lines: readonly AcquisitionLineDraft[] = [],
  grants: readonly PlannedClassGrantV1[] = []
): { -readonly [Key in keyof StartingEquipmentCommandContext]: StartingEquipmentCommandContext[Key] } {
  const fixture = acquisitionFixture({ lines, plannedClassGrants: grants, disposition: "unreviewed" });
  const original =
    lines.length === 0
      ? reviewRetainAll(fixture.draft, fixture.ledger, { userId: "owner-1", reviewedAt: "2026-10-05T19:00:00.000Z" })
      : fixture.draft;
  const draft = createEmptyDraft(targetLevel);
  draft.acquisition = reconcileAcquisitionTargetLevel(original, targetLevel);
  return {
    actor: { id: "actor-1" },
    draft,
    moduleState: normalizeState(null),
    steps: [createStartingEquipmentStep(targetLevel)],
    userId: "owner-1",
    user: { id: "owner-1", name: "Owner", isGM: false },
    now: () => NOW,
  };
}

function reentryDependencies(
  context: StartingEquipmentCommandContext,
  worldPolicy: EquipmentWorldPolicyV1 = {
    ...DEFAULT_EQUIPMENT_WORLD_POLICY,
    higherLevelStartAuthority: "actor-owner-attestation",
  },
  grants: readonly PlannedClassGrantV1[] = []
) {
  const baseline = createEconomicBaseline({
    actorId: "actor-1",
    capturedAt: context.now(),
    currencyCopper: 0,
    physicalItems: [],
  });
  const judgments = new Map<string, EquipmentPolicyJudgmentRecord>();
  const resolver = createEquipmentPolicyResolver({
    resolveGmJudgment: (id) => judgments.get(id) ?? null,
    verifyOwnerStartAttestation: () => true,
  });
  const plan = (acquisition: AcquisitionDraftState) =>
    createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: acquisition.draftId,
      batchId: acquisition.batchId,
      targetLevel: acquisition.targetLevel,
      grants,
    });
  const resolvePolicy = vi.fn<NonNullable<CommandDependencies["resolvePolicy"]>>((request) =>
    resolver.resolve({
      ...request,
      actorId: "actor-1",
      selectedRecipe: request.selectedRecipe ?? null,
      worldPolicy,
      effectivePackIds: ["pf2e.equipment-srd"],
      enabledSourceSlugs: ["player-core"],
      knownSourceSlugs: ["player-core"],
      showEmptySources: false,
      showUnknownSources: false,
      abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
    })
  );
  const saveJudgment = vi.fn<NonNullable<CommandDependencies["saveJudgment"]>>(async (input) => {
    const record: EquipmentPolicyJudgmentRecord = {
      id: input.id,
      kind: input.facts.kind,
      actorId: input.facts.actorId,
      draftId: input.facts.draftId,
      targetLevel: input.facts.targetLevel,
      factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(input.facts),
      authorUserId: "gm-1",
      authorName: "GM",
      recordedAt: input.recordedAt,
      reason: input.reason,
      request: input.request ?? {
        requestId: "direct-start",
        requesterUserId: "owner-1",
        requesterName: "Owner",
        requestedAt: input.recordedAt,
        reason: input.reason,
        facts: input.facts,
      },
      revocation: null,
    };
    judgments.set(record.id, record);
    return record;
  });
  return {
    baseline,
    plan,
    mintIdentity: vi.fn<NonNullable<CommandDependencies["mintIdentity"]>>(() => {
      throw new Error("Retarget must reuse identity.");
    }),
    mintJudgmentId: vi.fn(() => "gm-reentry-judgment"),
    getWorldPolicy: () => worldPolicy,
    resolvePolicy,
    saveJudgment,
    createOwnerStartAttestation: vi.fn<NonNullable<CommandDependencies["createOwnerStartAttestation"]>>((input) => ({
      kind: "actor-owner-attestation",
      startKind: input.startKind,
      actorId: "actor-1",
      draftId: input.draftId,
      targetLevel: input.targetLevel,
      authorUserId: "owner-1",
      authorName: "Owner",
      recordedAt: input.recordedAt,
      reason: input.reason,
    })),
    projectClassGrants: vi.fn<NonNullable<CommandDependencies["projectClassGrants"]>>(async (_actor, draft) => ({
      grants: [...grants],
      preparedPlan: plan(draft.acquisition!),
      blockers: [],
    })),
    prepareClassGrantPlan: vi.fn<NonNullable<CommandDependencies["prepareClassGrantPlan"]>>(async (_actor, draft) =>
      plan(draft.acquisition!)
    ),
    prepareNativeGrantLines: vi.fn<NonNullable<CommandDependencies["prepareNativeGrantLines"]>>(async () => []),
    evaluateAdmission: vi.fn<NonNullable<CommandDependencies["evaluateAdmission"]>>(() => ({
      kind: "eligible-empty",
      baseline,
    })),
    assertSourceHealth: vi.fn(async () => undefined),
    resolvePhysicalGrantCoverageBlockers: () => [],
    prepareLine: vi.fn<StartingEquipmentUiAdapter["prepareLine"]>(freshLine),
  };
}

async function freshLine(request: Parameters<StartingEquipmentUiAdapter["prepareLine"]>[0]) {
  return acquisitionLine({
    lineId: "fresh-prepared-line",
    sourceUuid: request.sourceUuid,
    documentFingerprint: "fresh-document",
    priceFingerprint: "fresh-price",
    funding:
      request.funding?.lane === "allowance"
        ? { lane: "allowance", assignment: { mode: "player", allowanceId: request.funding.allowanceId } }
        : { lane: "currency" },
    price: acquisitionPrice({ basePrice: { kind: "priced", value: { gp: 2 } } }),
  });
}

function startRequest(context: StartingEquipmentCommandContext) {
  return createEquipmentPolicyRequest({
    requestId: "request-6",
    facts: {
      kind: "higher-level-start",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: context.draft.targetLevel,
      startKind: "new-campaign",
    },
    requesterUserId: "owner-1",
    requesterName: "Owner",
    requestedAt: "2026-10-05T19:00:00.000Z",
    reason: "New level",
  });
}

function nativeGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:alchemist-formula-book:class-level-1",
    profileId: "alchemist-formula-book",
    origin: { sourceSlotId: "class-level-1", sourceUuid: u.alchemistClass },
    granterSourceUuid: u.formulaBookFeature,
    expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.formulaBookFeature, u.alchemyFeature, u.alchemistClass],
  });
}

function titanGrant(line: AcquisitionLineDraft) {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:titan-mauler:class-branch-instinct-level-1",
    profileId: "giant-instinct-titan-mauler",
    origin: { sourceSlotId: "class-branch-instinct-level-1", sourceUuid: u.giantInstinct },
    granterSourceUuid: u.giantInstinct,
    expected: { sourceUuid: line.sourceUuid, quantity: 1, itemType: "weapon" },
    materializer: "wayfinder-acquisition",
    eligibilityKind: "catalogue-choice",
    resaleRule: "zero-until-rune-investment",
    eligibilityEvidence: {
      kind: "titan-mauler",
      documentFingerprint: "titan-profile-document",
      lineId: line.lineId,
      lineDocumentFingerprint: line.documentFingerprint,
      linePriceFingerprint: line.priceFingerprint,
      policyFingerprint: "policy-diagnostic-1",
      actorSize: "medium",
      targetSize: "large",
      basePriceCopper: line.price.unitPriceCopper,
      weaponCategory: "martial",
      rangeIncrement: null,
      rarity: "common",
      characterAccessRef: null,
      sourceAllowed: true,
      quantity: 1,
      permanence: "permanent",
      componentKind: "baseline-item",
    },
    nativeGrantChainSourceUuids: [],
  });
}
