import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft, normalizeState } from "../src/draft-service";
import { executeStartingEquipmentCommand } from "../src/wayfinder/application/starting-equipment-command-service";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyResolver,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
  type EquipmentPolicyJudgmentFacts,
  type EquipmentPolicyJudgmentRecord,
} from "../src/wayfinder/domain/equipment-policy";
import { createStartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import { acquisitionFixture, acquisitionLine, acquisitionPrice } from "./fixtures/acquisition-fixture";

describe("starting equipment command service", () => {
  it("stages a higher-level identity before draft-bound authority exists", async () => {
    const context = commandContext(null, 5);
    const resolvePolicy = vi.fn();
    const result = await executeStartingEquipmentCommand({ type: "initialize", selectedRecipe: "lump-sum" }, context, {
      mintIdentity: vi.fn(() => ({ draftId: "draft-5", batchId: "batch-5", manifestId: "manifest-5" })),
      getWorldPolicy: vi.fn(() => ({
        ...DEFAULT_EQUIPMENT_WORLD_POLICY,
        higherLevelStartAuthority: "actor-owner-attestation" as const,
      })),
      resolvePolicy,
    });

    expect(result.acquisition).toMatchObject({
      draftId: "draft-5",
      targetLevel: 5,
      recipe: { kind: "lump-sum" },
      policySnapshot: null,
      baseline: null,
      recipeSelection: {
        version: 1,
        selectedRecipe: "lump-sum",
        selectedAt: "2026-08-19T20:00:00.000Z",
        selector: { kind: "user", userId: "owner-1", userName: "owner-1" },
        authority: { mode: "owner-delegated" },
      },
    });
    expect(result.statusNote).toMatch(/confirm this higher-level start/i);
    expect(resolvePolicy).not.toHaveBeenCalled();
  });

  it("attributes a GM-fixed recipe to the GM who configured the world policy", async () => {
    const context = commandContext(null, 5);
    const result = await executeStartingEquipmentCommand({ type: "initialize" }, context, {
      mintIdentity: vi.fn(() => ({ draftId: "draft-5", batchId: "batch-5", manifestId: "manifest-5" })),
      getWorldPolicy: vi.fn(() => ({
        ...DEFAULT_EQUIPMENT_WORLD_POLICY,
        enabledRecipes: ["permanent-items", "lump-sum"] as const,
        defaultRecipe: "lump-sum" as const,
        recipeChoiceAuthority: "gm-fixed" as const,
        recipeDecision: {
          version: 1 as const,
          configuredBy: { userId: "gm-1", userName: "Game Master" },
          configuredAt: "2026-08-19T18:00:00.000Z",
        },
      })),
    });

    expect(result.acquisition.recipeSelection).toMatchObject({
      selectedRecipe: "lump-sum",
      selectedAt: "2026-08-19T18:00:00.000Z",
      selector: { kind: "user", userId: "gm-1", userName: "Game Master" },
      authority: { mode: "gm-fixed" },
    });
  });

  it("does not fabricate a GM selector for an unattributed legacy world policy", async () => {
    const context = commandContext(null, 5);
    const result = await executeStartingEquipmentCommand({ type: "initialize" }, context, {
      mintIdentity: vi.fn(() => ({ draftId: "draft-5", batchId: "batch-5", manifestId: "manifest-5" })),
      getWorldPolicy: vi.fn(() => ({
        ...DEFAULT_EQUIPMENT_WORLD_POLICY,
        defaultRecipe: "lump-sum" as const,
        recipeChoiceAuthority: "gm-fixed" as const,
      })),
    });

    expect(result.acquisition.recipeSelection).toMatchObject({
      selectedRecipe: "lump-sum",
      selector: { kind: "unattributed-world-policy" },
      authority: { mode: "gm-fixed", worldPolicy: { recipeDecision: { version: 1 } } },
    });
  });

  it("records a player request as non-authoritative draft evidence", async () => {
    const context = commandContext(null, 5);
    context.draft.acquisition = createAcquisitionDraft({
      draftId: "draft-5",
      batchId: "batch-5",
      manifestId: "manifest-5",
      targetLevel: 5,
      recipe: { kind: "permanent-items" },
    });
    const result = await executeStartingEquipmentCommand(
      {
        type: "request-higher-level-start",
        startKind: "replacement-character",
        reason: "Replacing a retired character",
      },
      context,
      { mintRequestId: vi.fn(() => "request-5") }
    );

    expect(result.acquisition.policySnapshot).toBeNull();
    expect(result.policyRequests).toEqual([
      expect.objectContaining({
        requestId: "request-5",
        requesterUserId: "owner-1",
        reason: "Replacing a retired character",
        facts: expect.objectContaining({
          kind: "higher-level-start",
          draftId: "draft-5",
          targetLevel: 5,
          startKind: "replacement-character",
        }),
      }),
    ]);
  });

  it("records an exact hydrated item-exception request without an authority write", async () => {
    const context = commandContext(acquisitionFixture({ disposition: "unreviewed" }).draft);
    const saveJudgment = vi.fn();
    const facts = {
      kind: "rarity-source-exception" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      scope: "rarity" as const,
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.uncommon",
      packId: "pf2e.equipment-srd",
      publicationSlug: "player-core",
      rarity: "uncommon" as const,
    };
    const result = await executeStartingEquipmentCommand(
      { type: "request-item-exception", sourceUuid: facts.sourceUuid, reason: "Ancestral item access" },
      context,
      {
        mintRequestId: vi.fn(() => "request-item-1"),
        resolveItemExceptionFacts: vi.fn(async () => facts),
        saveJudgment,
      }
    );

    expect(result.acquisition).toBe(context.draft.acquisition);
    expect(result.policyRequests).toEqual([
      expect.objectContaining({ requestId: "request-item-1", facts, requesterUserId: "owner-1" }),
    ]);
    expect(saveJudgment).not.toHaveBeenCalled();
  });

  it("rejects stale item-exception request facts before any GM authority write", async () => {
    const context = commandContext(acquisitionFixture({ disposition: "unreviewed" }).draft);
    const requestedFacts = {
      kind: "rarity-source-exception" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      scope: "rarity" as const,
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.uncommon",
      packId: "pf2e.equipment-srd",
      publicationSlug: "player-core",
      rarity: "uncommon" as const,
    };
    const requested = await executeStartingEquipmentCommand(
      { type: "request-item-exception", sourceUuid: requestedFacts.sourceUuid, reason: "Request" },
      context,
      {
        mintRequestId: vi.fn(() => "request-item-1"),
        resolveItemExceptionFacts: vi.fn(async () => requestedFacts),
      }
    );
    context.draft.equipmentPolicyRequests = [...requested.policyRequests];
    const saveJudgment = vi.fn();
    await expect(
      executeStartingEquipmentCommand(
        { type: "approve-policy-request", requestId: "request-item-1", reason: "Approve" },
        context,
        {
          resolveItemExceptionFacts: vi.fn(async () => ({ ...requestedFacts, rarity: "rare" as const })),
          saveJudgment,
        }
      )
    ).rejects.toThrow(/facts changed/i);
    expect(saveJudgment).not.toHaveBeenCalled();
  });

  it("approves exact current item facts and persists a dormant policy exception", async () => {
    const context = commandContext(acquisitionFixture({ disposition: "unreviewed" }).draft);
    const facts = {
      kind: "rarity-source-exception" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      scope: "rarity" as const,
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.uncommon",
      packId: "pf2e.equipment-srd",
      publicationSlug: "player-core",
      rarity: "uncommon" as const,
    };
    const requested = await executeStartingEquipmentCommand(
      { type: "request-item-exception", sourceUuid: facts.sourceUuid, reason: "Request" },
      context,
      {
        mintRequestId: vi.fn(() => "request-item-1"),
        resolveItemExceptionFacts: vi.fn(async () => facts),
      }
    );
    context.draft.equipmentPolicyRequests = [...requested.policyRequests];
    const approved = judgment(facts, "approval:request-item-1");
    const saveJudgment = vi.fn(async () => approved);
    const result = await executeStartingEquipmentCommand(
      { type: "approve-policy-request", requestId: "request-item-1", reason: "Approve" },
      context,
      {
        resolveItemExceptionFacts: vi.fn(async () => facts),
        saveJudgment,
        resolvePolicy: vi.fn(() => effectivePolicyWithJudgment(approved)),
      }
    );

    expect(saveJudgment).toHaveBeenCalledOnce();
    expect(result.acquisition.lines).toEqual(context.draft.acquisition!.lines);
    expect(result.acquisition.policySnapshot?.material.gmJudgments).toContainEqual(approved);
  });

  it("refuses to revoke an approval outside the current acquisition scope", async () => {
    const revokeJudgment = vi.fn();
    await expect(
      executeStartingEquipmentCommand(
        { type: "revoke-policy-judgment", judgmentId: "other-draft", reason: "Forged action" },
        commandContext(acquisitionFixture({ disposition: "unreviewed" }).draft),
        { revokeJudgment }
      )
    ).rejects.toThrow(/bound to this equipment draft/i);
    expect(revokeJudgment).not.toHaveBeenCalled();
  });

  it("returns a reviewed purchase state without mutating the caller draft", async () => {
    const fixture = acquisitionFixture({ disposition: "unreviewed" });
    const context = commandContext(fixture.draft);
    const original = context.draft.acquisition;

    const result = await executeStartingEquipmentCommand(
      { type: "review-purchases" },
      context,
      ledgerDependencies(fixture) as never
    );

    expect(context.draft.acquisition).toBe(original);
    expect(result.acquisition.disposition).toMatchObject({
      kind: "purchase-ledger",
      review: { reviewedByUserId: "owner-1" },
    });
    expect(result.statusNote).toBe("Kit confirmed.");
  });

  it("records retain-all as an explicit reviewed empty-cart decision", async () => {
    const fixture = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const result = await executeStartingEquipmentCommand(
      { type: "retain-all" },
      commandContext(fixture.draft),
      ledgerDependencies(fixture) as never
    );

    expect(result.acquisition.disposition).toMatchObject({
      kind: "retain-all",
      retainedCopper: fixture.ledger.remainingCopper,
      review: { reviewedByUserId: "owner-1" },
    });
  });

  it("owns add, quantity, and remove transitions and invalidates prior review", async () => {
    const empty = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const added = await executeStartingEquipmentCommand(
      { type: "add-line", line: acquisitionLine() },
      commandContext(empty.draft)
    );
    expect(added.acquisition.lines).toHaveLength(1);

    const reviewed = acquisitionFixture().draft;
    const quantity = await executeStartingEquipmentCommand(
      { type: "set-quantity", lineId: "line-1", quantity: 3 },
      commandContext(reviewed)
    );
    expect(quantity.acquisition.lines[0]?.price.requestedQuantity).toBe(3);
    expect(quantity.acquisition.lines[0]?.price.linePriceCopper).toBe(300);
    expect(quantity.acquisition.disposition).toMatchObject({
      kind: "unreviewed",
      invalidatedFrom: "purchase-ledger",
      reasons: ["quantity"],
    });

    const removed = await executeStartingEquipmentCommand(
      { type: "remove-line", lineId: "line-1" },
      commandContext(quantity.acquisition)
    );
    expect(removed.acquisition.lines).toEqual([]);
  });

  it("recomputes requested quantity over the source stack and price.per basis", async () => {
    const line = acquisitionLine({
      price: acquisitionPrice({ pricePer: 10, sourceQuantity: 12, requestedQuantity: 1 }),
    });
    const fixture = acquisitionFixture({ lines: [line], disposition: "unreviewed" });

    const result = await executeStartingEquipmentCommand(
      { type: "set-quantity", lineId: line.lineId, quantity: 3 },
      commandContext(fixture.draft)
    );

    expect(result.acquisition.lines[0]?.price).toMatchObject({
      pricePer: 10,
      sourceQuantity: 12,
      requestedQuantity: 3,
      materializedQuantity: 36,
      linePriceCopper: 360,
    });
  });

  it("moves unsafe configured equipment into acknowledged zero-write handoff", async () => {
    const context = commandContext(acquisitionFixture({ disposition: "unreviewed" }).draft);
    const result = await executeStartingEquipmentCommand(
      {
        type: "enter-configured-item-handoff",
        reason: {
          code: "unsafe-configured-item",
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.specific",
          itemName: "Chained Mist",
          issue: "specific-magic-item",
        },
      },
      context
    );

    expect(result.statusNote).toMatch(/Chained Mist.*inventory sheet/i);
    expect(result.acquisition.lines).toEqual([]);
    expect(result.acquisition.disposition).toMatchObject({
      kind: "handoff",
      acknowledgedByUserId: null,
      handoff: { reasons: [{ code: "unsafe-configured-item" }] },
    });

    context.draft.acquisition = result.acquisition;
    const acknowledged = await executeStartingEquipmentCommand({ type: "acknowledge-handoff" }, context);
    expect(acknowledged.acquisition.disposition).toMatchObject({
      kind: "handoff",
      acknowledgedByUserId: "owner-1",
    });
  });

  it("keeps class-grant lines locked against removal and quantity changes", async () => {
    const grant = fixedNativeGrant();
    const line = acquisitionLine({
      lineId: "native-line",
      sourceUuid: grant.expected.sourceUuid,
      itemLevel: 0,
      funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
      stackingIntent: "separate",
    });
    const acquisition = acquisitionFixture({
      lines: [line],
      plannedClassGrants: [grant],
      disposition: "unreviewed",
    }).draft;

    await expect(
      executeStartingEquipmentCommand({ type: "remove-line", lineId: line.lineId }, commandContext(acquisition))
    ).rejects.toThrow(/cannot be removed/i);
    await expect(
      executeStartingEquipmentCommand(
        { type: "set-quantity", lineId: line.lineId, quantity: 2 },
        commandContext(acquisition)
      )
    ).rejects.toThrow(/quantity is fixed/i);
  });

  it("allows Titan Mauler reselection by removing its line while keeping its quantity fixed", async () => {
    const line = acquisitionLine({
      lineId: "titan-line",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
      documentFingerprint: "titan-document",
      priceFingerprint: "titan-price",
      itemLevel: 0,
      funding: {
        lane: "class-grant",
        grant: { plannedGrantId: "class-grant:titan-mauler:class-branch-instinct-level-1" },
      },
      stackingIntent: "separate",
    });
    const grant = titanMaulerGrant(line);
    const acquisition = acquisitionFixture({
      lines: [line],
      plannedClassGrants: [grant],
      disposition: "unreviewed",
    }).draft;

    const removed = await executeStartingEquipmentCommand(
      { type: "remove-line", lineId: line.lineId },
      commandContext(acquisition)
    );
    expect(removed.acquisition.lines).toEqual([]);
    await expect(
      executeStartingEquipmentCommand(
        { type: "set-quantity", lineId: line.lineId, quantity: 2 },
        commandContext(acquisition)
      )
    ).rejects.toThrow(/quantity is fixed/i);
  });

  it("removes only stale native lines when the projected build switches grants", async () => {
    const nativeGrant = fixedNativeGrant();
    const ordinaryLine = acquisitionLine({ lineId: "ordinary-line" });
    const nativeLine = acquisitionLine({
      lineId: "native-line",
      sourceUuid: nativeGrant.expected.sourceUuid,
      itemLevel: 0,
      funding: { lane: "class-grant", grant: { plannedGrantId: nativeGrant.grantId } },
      stackingIntent: "separate",
    });
    const titanLine = acquisitionLine({
      lineId: "titan-line",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
      documentFingerprint: "titan-document",
      priceFingerprint: "titan-price",
      itemLevel: 0,
      funding: {
        lane: "class-grant",
        grant: { plannedGrantId: "class-grant:titan-mauler:class-branch-instinct-level-1" },
      },
      stackingIntent: "separate",
    });
    const titanGrant = titanMaulerGrant(titanLine);
    const prior = acquisitionFixture({
      lines: [ordinaryLine, nativeLine, titanLine],
      plannedClassGrants: [nativeGrant, titanGrant],
    });
    const current = acquisitionFixture({
      lines: [ordinaryLine, titanLine],
      plannedClassGrants: [titanGrant],
      disposition: "unreviewed",
    });
    const currentPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: prior.draft.draftId,
      batchId: prior.draft.batchId,
      targetLevel: prior.draft.targetLevel,
      grants: [titanGrant],
    });

    const result = await executeStartingEquipmentCommand({ type: "review-purchases" }, commandContext(prior.draft), {
      ...ledgerDependencies(current),
      prepareClassGrantPlan: vi.fn(async () => currentPlan),
      prepareNativeGrantLines: vi.fn(async () => []),
    } as never);

    expect(result.acquisition.lines.map((line) => line.lineId)).toEqual(["ordinary-line", "titan-line"]);
    expect(result.acquisition.plannedClassGrants).toEqual([titanGrant]);
    expect(result.acquisition.disposition).toMatchObject({ kind: "purchase-ledger" });
  });

  it("keeps an unchanged native synchronization exactly idempotent", async () => {
    const grant = fixedNativeGrant();
    const ordinaryLine = acquisitionLine({ lineId: "ordinary-line" });
    const nativeLine = acquisitionLine({
      lineId: "native-line",
      sourceUuid: grant.expected.sourceUuid,
      itemLevel: 0,
      funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
      stackingIntent: "separate",
    });
    const fixture = acquisitionFixture({ lines: [ordinaryLine, nativeLine], plannedClassGrants: [grant] });

    const result = await executeStartingEquipmentCommand({ type: "review-purchases" }, commandContext(fixture.draft), {
      ...ledgerDependencies(fixture),
      prepareNativeGrantLines: vi.fn(async (request: { acquisition: typeof fixture.draft }) => [
        request.acquisition.lines[1]!,
      ]),
    } as never);

    expect(result.acquisition.lines).toBe(fixture.draft.lines);
    expect(result.acquisition.lines[1]).toBe(nativeLine);
    expect(result.acquisition.disposition).toMatchObject({ kind: "purchase-ledger" });
  });

  it("adds projected native grant lines before initial economic admission", async () => {
    const policy = levelOnePolicy();
    const baseline = createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: "2026-08-19T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    });
    const grant = fixedNativeGrant();
    const nativeLine = acquisitionLine({
      lineId: "native-line",
      sourceUuid: grant.expected.sourceUuid,
      itemLevel: 0,
      funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
      stackingIntent: "separate",
    });
    const prepareNativeGrantLines = vi.fn(async (request: { acquisition: { plannedClassGrants: unknown[] } }) => {
      expect(request.acquisition.plannedClassGrants).toEqual([grant]);
      return [nativeLine];
    });
    const evaluateAdmission = vi.fn(() => ({ kind: "eligible-empty" as const, baseline }));

    const result = await executeStartingEquipmentCommand({ type: "initialize" }, commandContext(null), {
      mintIdentity: vi.fn(() => ({ draftId: "draft-1", batchId: "batch-1", manifestId: "manifest-1" })),
      resolvePolicy: vi.fn(() => policy),
      projectClassGrants: vi.fn(async () => ({ grants: [grant], preparedPlan: null, blockers: [] })),
      prepareClassGrantPlan: vi.fn(),
      prepareNativeGrantLines,
      evaluateAdmission,
      evaluateLedger: vi.fn(),
    } as never);

    expect(result.acquisition.lines).toEqual([nativeLine]);
    expect(result.acquisition.plannedClassGrants).toEqual([grant]);
    expect(prepareNativeGrantLines.mock.invocationCallOrder[0]).toBeLessThan(
      evaluateAdmission.mock.invocationCallOrder[0]!
    );
  });

  it("initializes browsing when Titan Mauler still needs a catalogue selection", async () => {
    const policy = levelOnePolicy();
    const baseline = createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: "2026-08-19T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    });
    const evaluateAdmission = vi.fn((args: { preparedClassGrantPlan: { grants: readonly unknown[] } }) => {
      expect(args.preparedClassGrantPlan.grants).toEqual([]);
      return { kind: "eligible-empty" as const, baseline };
    });
    const prepareClassGrantPlan = vi.fn();

    const result = await executeStartingEquipmentCommand({ type: "initialize" }, commandContext(null), {
      mintIdentity: vi.fn(() => ({ draftId: "draft-1", batchId: "batch-1", manifestId: "manifest-1" })),
      resolvePolicy: vi.fn(() => policy),
      projectClassGrants: vi.fn(async () => ({
        grants: [],
        preparedPlan: null,
        blockers: [
          {
            code: "titan-selection-required",
            profileId: "giant-instinct-titan-mauler",
            message: "Giant Instinct requires a reviewed Titan Mauler weapon selection.",
          },
        ],
      })),
      prepareClassGrantPlan,
      prepareNativeGrantLines: vi.fn(async () => []),
      evaluateAdmission,
      evaluateLedger: vi.fn(),
    } as never);

    expect(result.acquisition).toMatchObject({
      baseline: { actorId: "actor-1", currencyCopper: 0 },
      disposition: { kind: "unreviewed" },
    });
    expect(result.statusNote).toContain("Pick your Titan Mauler weapon before you finish");
    expect(prepareClassGrantPlan).not.toHaveBeenCalled();
  });

  it("hard-stops an unsupported physical grant before initialization performs admission or native-line work", async () => {
    const policy = levelOnePolicy();
    const prepareNativeGrantLines = vi.fn(async () => []);
    const evaluateAdmission = vi.fn();
    const context = commandContext(null);

    await expect(
      executeStartingEquipmentCommand({ type: "initialize" }, context, {
        mintIdentity: vi.fn(() => ({ draftId: "draft-1", batchId: "batch-1", manifestId: "manifest-1" })),
        resolvePolicy: vi.fn(() => policy),
        projectClassGrants: vi.fn(async () => ({
          grants: [],
          preparedPlan: null,
          blockers: [
            {
              code: "unsupported-physical-grant",
              routeId: "clan-pistol",
              reasonCode: "unprofiled-native-grant",
              sourceSlotId: "ancestry-feat-level-1",
              sourceUuid: "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF",
              message: "Clan Pistol must use the PF2E sheet.",
            },
          ],
        })),
        prepareClassGrantPlan: vi.fn(),
        prepareNativeGrantLines,
        evaluateAdmission,
        evaluateLedger: vi.fn(),
      } as never)
    ).rejects.toThrow("Clan Pistol must use the PF2E sheet");

    expect(context.draft.acquisition).toBeNull();
    expect(prepareNativeGrantLines).not.toHaveBeenCalled();
    expect(evaluateAdmission).not.toHaveBeenCalled();
  });

  it.each([
    { type: "review-purchases" as const },
    { type: "retain-all" as const },
  ])("rechecks unsupported physical grants before $type can change review state", async (command) => {
    const fixture = acquisitionFixture();
    const before = JSON.stringify(fixture.draft);
    const prepareNativeGrantLines = vi.fn(async () => []);
    const evaluateLedger = vi.fn();

    await expect(
      executeStartingEquipmentCommand(command, commandContext(fixture.draft), {
        ...ledgerDependencies(fixture),
        prepareClassGrantPlan: vi.fn(async () => {
          throw new Error("Unsupported physical grant route: clan-pistol");
        }),
        prepareNativeGrantLines,
        evaluateLedger,
      } as never)
    ).rejects.toThrow("Unsupported physical grant route: clan-pistol");

    expect(JSON.stringify(fixture.draft)).toBe(before);
    expect(prepareNativeGrantLines).not.toHaveBeenCalled();
    expect(evaluateLedger).not.toHaveBeenCalled();
  });
});

function commandContext(acquisition: ReturnType<typeof acquisitionFixture>["draft"] | null, targetLevel?: number) {
  const level = targetLevel ?? acquisition?.targetLevel ?? 1;
  const draft = createEmptyDraft(level);
  draft.acquisition = acquisition;
  return {
    actor: { id: "actor-1" },
    draft,
    moduleState: normalizeState(null),
    steps: [createStartingEquipmentStep(level)],
    userId: "owner-1",
    now: () => "2026-08-19T20:00:00.000Z",
  };
}

function ledgerDependencies(fixture: ReturnType<typeof acquisitionFixture>) {
  return {
    mintIdentity: vi.fn(),
    resolvePolicy: vi.fn(),
    prepareClassGrantPlan: vi.fn(async () => fixture.classGrantPlan),
    prepareNativeGrantLines: vi.fn(async () => []),
    evaluateAdmission: vi.fn(),
    evaluateLedger: vi.fn(() => fixture.ledger),
  };
}

function fixedNativeGrant() {
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

function titanMaulerGrant(line: ReturnType<typeof acquisitionLine>) {
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

function levelOnePolicy() {
  return createEquipmentPolicyResolver({
    resolveGmJudgment: () => null,
    verifyOwnerStartAttestation: () => false,
  }).resolve({
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 1,
    worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
    selectedRecipe: null,
    effectivePackIds: ["pf2e.equipment-srd"],
    enabledSourceSlugs: ["player-core"],
    knownSourceSlugs: ["player-core"],
    showEmptySources: false,
    showUnknownSources: false,
    abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
  });
}

function judgment(facts: EquipmentPolicyJudgmentFacts, id: string): EquipmentPolicyJudgmentRecord {
  return {
    id,
    kind: facts.kind,
    actorId: facts.actorId,
    draftId: facts.draftId,
    targetLevel: facts.targetLevel,
    factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
    authorUserId: "gm-1",
    authorName: "GM",
    recordedAt: "2026-08-19T20:00:00.000Z",
    reason: "Approved",
    request: {
      requestId: "request-item-1",
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-19T19:00:00.000Z",
      reason: "Requested",
      facts,
    },
    revocation: null,
  };
}

function effectivePolicyWithJudgment(judgment: EquipmentPolicyJudgmentRecord) {
  const base = acquisitionFixture({ disposition: "unreviewed" }).draft.policySnapshot!.material;
  return {
    version: 1 as const,
    actorId: base.subject.actorId,
    draftId: base.subject.draftId,
    targetLevel: base.subject.targetLevel,
    rules: { wealth: base.numericPolicyRef, semantics: base.semanticPolicyRef },
    recipe: {
      kind: "permanent-items" as const,
      currencyCopper: base.budgetCopper,
      allowances: base.allowances,
    },
    worldRecipePolicy: base.worldRecipePolicy,
    sourcePolicy: base.sourcePolicy,
    rarityPolicy: base.rarityPolicy,
    authorityPolicy: base.authorityPolicy,
    higherLevelStartEvidence: base.higherLevelStartEvidence,
    abp: base.abp,
    gmJudgments: [judgment],
    fingerprint: "policy-with-exception",
    explanations: [],
  };
}
