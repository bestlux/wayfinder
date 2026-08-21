import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft, normalizeState } from "../src/draft-service";
import { localizeAcquisitionMessage } from "../src/wayfinder/application/acquisition-localization";
import { EquipmentSourceHealthError } from "../src/wayfinder/application/equipment-acquisition-runtime-service";
import { WayfinderGmCommandAuthorityError } from "../src/wayfinder/application/gm-command-authority";
import {
  executeStartingEquipmentCommand,
  type StartingEquipmentCommandContext,
  StartingEquipmentPhysicalGrantCoverageError,
} from "../src/wayfinder/application/starting-equipment-command-service";
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
import { localizeAcquisitionEnglish } from "./fixtures/acquisition-localization-fixture";

describe("starting equipment command service", () => {
  beforeEach(() => {
    vi.stubGlobal("game", { system: { id: "pf2e", version: "8.4.1" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    expect(localizeAcquisitionMessage(localizeAcquisitionEnglish, result.status)).toMatch(
      /confirm this higher-level start/i
    );
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

  it("re-resolves policy after approval revocation and invalidates a reviewed purchase", async () => {
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
    const approvedJudgment = judgment(facts, "approval:request-item-1");
    const resolvePolicy = vi
      .fn()
      .mockReturnValueOnce(effectivePolicyWithJudgments([approvedJudgment]))
      .mockReturnValueOnce(effectivePolicyWithJudgments([]));
    const approved = await executeStartingEquipmentCommand(
      { type: "approve-policy-request", requestId: "request-item-1", reason: "Approve" },
      context,
      {
        resolveItemExceptionFacts: vi.fn(async () => facts),
        saveJudgment: vi.fn(async () => approvedJudgment),
        resolvePolicy,
      }
    );
    context.draft.acquisition = {
      ...approved.acquisition,
      disposition: acquisitionFixture().draft.disposition,
    };
    const revokeJudgment = vi.fn(async () => ({
      ...approvedJudgment,
      revocation: {
        revokedByUserId: "gm-1",
        revokedByName: "GM",
        revokedAt: "2026-08-19T20:00:00.000Z",
        reason: "Withdraw approval",
      },
    }));

    const revoked = await executeStartingEquipmentCommand(
      { type: "revoke-policy-judgment", judgmentId: approvedJudgment.id, reason: "Withdraw approval" },
      context,
      { revokeJudgment, resolvePolicy }
    );

    expect(revokeJudgment).toHaveBeenCalledOnce();
    expect(resolvePolicy).toHaveBeenCalledTimes(2);
    expect(resolvePolicy.mock.calls[1]?.[0]).toMatchObject({ exceptionJudgmentIds: [] });
    expect(revoked.acquisition.policySnapshot?.material.gmJudgments).toEqual([]);
    expect(revoked.acquisition.disposition).toMatchObject({
      kind: "unreviewed",
      invalidatedFrom: "purchase-ledger",
      reasons: ["policy"],
    });
  });

  it("keeps the draft unchanged when a non-GM revocation is denied", async () => {
    const approvedJudgment = judgment(
      {
        kind: "rarity-source-exception",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
        scope: "rarity",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.uncommon",
        packId: "pf2e.equipment-srd",
        publicationSlug: "player-core",
        rarity: "uncommon",
      },
      "approval:request-item-1"
    );
    const baseAcquisition = acquisitionFixture().draft;
    const acquisition = {
      ...baseAcquisition,
      policySnapshot: {
        ...baseAcquisition.policySnapshot!,
        material: { ...baseAcquisition.policySnapshot!.material, gmJudgments: [approvedJudgment] },
      },
    };
    const context = {
      ...commandContext(acquisition),
      user: { id: "owner-1", name: "Owner", isGM: false },
    };
    const before = structuredClone(context.draft);
    const resolvePolicy = vi.fn();
    const revokeJudgment = vi.fn(async () => {
      throw new WayfinderGmCommandAuthorityError();
    });

    await expect(
      executeStartingEquipmentCommand(
        { type: "revoke-policy-judgment", judgmentId: approvedJudgment.id, reason: "Unauthorized" },
        context,
        { revokeJudgment, resolvePolicy }
      )
    ).rejects.toBeInstanceOf(WayfinderGmCommandAuthorityError);

    expect(revokeJudgment).toHaveBeenCalledOnce();
    expect(resolvePolicy).not.toHaveBeenCalled();
    expect(context.draft).toEqual(before);
  });

  it("returns a staged invalidated draft when foundational revocation makes fresh policy resolution fail", async () => {
    const startFacts = {
      kind: "higher-level-start" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      startKind: "replacement-character" as const,
    };
    const approvedJudgment = judgment(startFacts, "approval:request-start-1");
    const customJudgment = judgment(
      {
        kind: "custom-lump-sum",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
        amountCopper: 2_500,
      },
      "custom-lump-1"
    );
    const extraJudgment = judgment(
      {
        kind: "extra-current-level-allowance",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
      },
      "extra-allowance-1"
    );
    const baseAcquisition = acquisitionFixture().draft;
    const lumpSumSelection = { ...baseAcquisition.recipeSelection!, selectedRecipe: "lump-sum" as const };
    const acquisition = {
      ...baseAcquisition,
      recipe: { kind: "custom-lump-sum" as const, judgmentRef: customJudgment.id, amountCopper: 2_500 },
      recipeSelection: lumpSumSelection,
      policySnapshot: {
        ...baseAcquisition.policySnapshot!,
        material: {
          ...baseAcquisition.policySnapshot!.material,
          resolvedRecipe: { kind: "custom-lump-sum" as const, judgmentRef: customJudgment.id, amountCopper: 2_500 },
          recipeSelection: lumpSumSelection,
          higherLevelStartEvidence: {
            kind: "gm-confirmation" as const,
            startKind: startFacts.startKind,
            judgment: approvedJudgment,
          },
          gmJudgments: [approvedJudgment, customJudgment, extraJudgment],
        },
      },
    };
    const context = commandContext(acquisition);
    const revokeJudgment = vi.fn(async () => ({
      ...approvedJudgment,
      revocation: {
        revokedByUserId: "gm-1",
        revokedByName: "GM",
        revokedAt: "2026-08-19T20:00:00.000Z",
        reason: "Withdraw start approval",
      },
    }));
    const resolvePolicy = vi.fn(() => {
      throw new TypeError("Higher-level start authority is no longer current.");
    });

    const revoked = await executeStartingEquipmentCommand(
      { type: "revoke-policy-judgment", judgmentId: approvedJudgment.id, reason: "Withdraw start approval" },
      context,
      { revokeJudgment, resolvePolicy }
    );

    expect(revokeJudgment).toHaveBeenCalledOnce();
    expect(resolvePolicy).toHaveBeenCalledWith(expect.objectContaining({ higherLevelStartClaim: null }));
    expect(revoked.acquisition).toMatchObject({
      recipe: { kind: "lump-sum" },
      policySnapshot: null,
      baseline: null,
      lines: [],
      plannedClassGrants: [],
      classGrantReconciliations: [],
      disposition: {
        kind: "unreviewed",
        invalidatedFrom: "purchase-ledger",
        reasons: ["recipe", "policy", "budget"],
      },
    });
  });

  it("uses the freshly resolved recipe when a provenance-free draft sees world policy drift", async () => {
    const exception = judgment(
      {
        kind: "rarity-source-exception",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
        scope: "rarity",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.uncommon",
        packId: "pf2e.equipment-srd",
        publicationSlug: "player-core",
        rarity: "uncommon",
      },
      "approval:request-item-1"
    );
    const baseAcquisition = acquisitionFixture().draft;
    const { recipeSelection: _topRecipeSelection, ...acquisitionWithoutSelection } = baseAcquisition;
    const { recipeSelection: _materialRecipeSelection, ...materialWithoutSelection } =
      baseAcquisition.policySnapshot!.material;
    const acquisition = {
      ...acquisitionWithoutSelection,
      recipe: { kind: "lump-sum" as const },
      lines: acquisitionWithoutSelection.lines.map((line) => ({
        ...line,
        funding: { lane: "allowance" as const, assignment: { mode: "player" as const, allowanceId: "allowance-5" } },
      })),
      policySnapshot: {
        ...baseAcquisition.policySnapshot!,
        material: {
          ...materialWithoutSelection,
          resolvedRecipe: { kind: "lump-sum" as const },
          gmJudgments: [exception],
        },
      },
    };
    const resolvePolicy = vi.fn(() => effectivePolicyWithJudgments([]));

    const revoked = await executeStartingEquipmentCommand(
      { type: "revoke-policy-judgment", judgmentId: exception.id, reason: "Withdraw exception" },
      commandContext(acquisition),
      {
        revokeJudgment: vi.fn(async () => ({
          ...exception,
          revocation: {
            revokedByUserId: "gm-1",
            revokedByName: "GM",
            revokedAt: "2026-08-19T20:00:00.000Z",
            reason: "Withdraw exception",
          },
        })),
        resolvePolicy,
      }
    );

    expect(revoked.acquisition.recipe).toEqual({ kind: "permanent-items" });
    expect(revoked.acquisition.policySnapshot?.material.resolvedRecipe).toEqual({ kind: "permanent-items" });
    expect(revoked.acquisition.disposition).toMatchObject({
      kind: "unreviewed",
      invalidatedFrom: "purchase-ledger",
      reasons: ["recipe", "policy", "budget"],
    });
    expect(revoked.acquisition.lines[0]?.funding).toEqual({ lane: "allowance", assignment: { mode: "automatic" } });
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
    expect(localizeAcquisitionMessage(localizeAcquisitionEnglish, result.status)).toBe("Kit confirmed.");
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

  it("keeps an expanded Adventurer's Pack at one logical purchase", async () => {
    const line = acquisitionLine({
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.2req0jGaxz8hScdB",
      stackingIntent: "separate",
      kitExpansion: {
        version: 1,
        profile: "adventurers-pack-v1",
        requestedQuantity: 1,
        items: Array.from({ length: 9 }, (_, index) => ({
          expansionPath: index === 0 ? "mca3x" : `mca3x/child-${index}`,
          parentPath: index === 0 ? null : "mca3x",
          sourceUuid: `Compendium.pf2e.equipment-srd.Item.child-${index}`,
          documentFingerprint: `fingerprint-${index}`,
          name: index === 0 ? "Backpack" : `Child ${index}`,
          itemType: index === 0 ? ("backpack" as const) : ("equipment" as const),
          quantity: 1,
          size: "medium" as const,
        })),
      },
    });
    const fixture = acquisitionFixture({ lines: [line], disposition: "unreviewed" });

    await expect(
      executeStartingEquipmentCommand(
        { type: "set-quantity", lineId: line.lineId, quantity: 2 },
        commandContext(fixture.draft)
      )
    ).rejects.toThrow(/fixed one-pack purchase/i);
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

    expect(localizeAcquisitionMessage(localizeAcquisitionEnglish, result.status)).toMatch(
      /Chained Mist.*inventory sheet/i
    );
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
    expect(localizeAcquisitionMessage(localizeAcquisitionEnglish, result.status)).toContain(
      "Pick your Titan Mauler weapon before you finish"
    );
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

  it("rejects an exact registered physical route before higher-level identity or acquisition work", async () => {
    const context = unsupportedArmorCommandContext(null, 5);
    const before = structuredClone(context.draft);
    const mintIdentity = vi.fn();
    const saveJudgment = vi.fn();
    const projectClassGrants = vi.fn();
    const prepareClassGrantPlan = vi.fn();
    const prepareNativeGrantLines = vi.fn();
    const evaluateAdmission = vi.fn();

    const rejection = executeStartingEquipmentCommand({ type: "initialize" }, context, {
      mintIdentity,
      saveJudgment,
      projectClassGrants,
      prepareClassGrantPlan,
      prepareNativeGrantLines,
      evaluateAdmission,
    } as never);

    const error = await rejection.catch((reason) => reason);
    expect(error).toBeInstanceOf(StartingEquipmentPhysicalGrantCoverageError);
    expect(error).toMatchObject({
      blocker: {
        code: "unsupported-physical-grant",
        routeId: "inventor-armor-innovation",
        reasonCode: "unprofiled-native-grant",
        sourceSlotId: "class-branch-innovation-level-1",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.fpwtpm8pdwO1I6MO",
      },
    });
    expect(context.draft).toEqual(before);
    for (const operation of [
      mintIdentity,
      saveJudgment,
      projectClassGrants,
      prepareClassGrantPlan,
      prepareNativeGrantLines,
      evaluateAdmission,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it.each([
    { label: "unknown", game: undefined },
    { label: "drifted", game: { system: { id: "pf2e", version: "8.4.2" } } },
  ])("rejects a $label PF2E coverage version before any initialization operation", async ({ game }) => {
    vi.stubGlobal("game", game);
    const context = commandContext(null);
    const before = structuredClone(context.draft);
    const mintIdentity = vi.fn();
    const saveJudgment = vi.fn();
    const projectClassGrants = vi.fn();
    const prepareClassGrantPlan = vi.fn();
    const prepareNativeGrantLines = vi.fn();
    const evaluateAdmission = vi.fn();

    await expect(
      executeStartingEquipmentCommand({ type: "initialize" }, context, {
        mintIdentity,
        saveJudgment,
        projectClassGrants,
        prepareClassGrantPlan,
        prepareNativeGrantLines,
        evaluateAdmission,
      } as never)
    ).rejects.toMatchObject({
      name: "StartingEquipmentPhysicalGrantCoverageError",
      blocker: {
        code: "coverage-version-mismatch",
        routeId: "pf2e-version-pin",
        reasonCode: "pf2e-version-mismatch",
        sourceSlotId: null,
        sourceUuid: null,
      },
    });
    expect(context.draft).toEqual(before);
    for (const operation of [
      mintIdentity,
      saveJudgment,
      projectClassGrants,
      prepareClassGrantPlan,
      prepareNativeGrantLines,
      evaluateAdmission,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("rejects a legacy staged higher-level draft before GM approval can persist judgment", async () => {
    const context = commandContext(null, 5);
    const initialized = await executeStartingEquipmentCommand({ type: "initialize" }, context, {
      mintIdentity: vi.fn(() => ({ draftId: "draft-5", batchId: "batch-5", manifestId: "manifest-5" })),
      getWorldPolicy: vi.fn(() => DEFAULT_EQUIPMENT_WORLD_POLICY),
    });
    context.draft.acquisition = initialized.acquisition;
    const requested = await executeStartingEquipmentCommand(
      { type: "request-higher-level-start", startKind: "new-campaign", reason: "Request" },
      context,
      { mintRequestId: vi.fn(() => "request-5") }
    );
    context.draft.equipmentPolicyRequests = [...requested.policyRequests];
    const guarded = unsupportedArmorCommandContext(context.draft.acquisition, 5);
    guarded.draft.equipmentPolicyRequests = [...context.draft.equipmentPolicyRequests];
    const before = structuredClone(guarded.draft);
    const saveJudgment = vi.fn();
    const projectClassGrants = vi.fn();
    const prepareClassGrantPlan = vi.fn();
    const prepareNativeGrantLines = vi.fn();
    const evaluateAdmission = vi.fn();

    await expect(
      executeStartingEquipmentCommand(
        { type: "approve-policy-request", requestId: "request-5", reason: "Approve" },
        guarded,
        { saveJudgment, projectClassGrants, prepareClassGrantPlan, prepareNativeGrantLines, evaluateAdmission } as never
      )
    ).rejects.toMatchObject({
      name: "StartingEquipmentPhysicalGrantCoverageError",
      blocker: { routeId: "inventor-armor-innovation", reasonCode: "unprofiled-native-grant" },
    });
    expect(guarded.draft).toEqual(before);
    for (const operation of [
      saveJudgment,
      projectClassGrants,
      prepareClassGrantPlan,
      prepareNativeGrantLines,
      evaluateAdmission,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("preserves line-removal recovery when a newly selected route becomes unsupported", async () => {
    const fixture = acquisitionFixture();
    const context = unsupportedArmorCommandContext(fixture.draft, fixture.draft.targetLevel);
    const lineId = context.draft.acquisition!.lines[0]!.lineId;
    const resolvePhysicalGrantCoverageBlockers = vi.fn(() => {
      throw new Error("Recovery commands must not enter the pre-review blocker.");
    });

    const result = await executeStartingEquipmentCommand({ type: "remove-line", lineId }, context, {
      resolvePhysicalGrantCoverageBlockers,
    });

    expect(result.acquisition.lines.some((line) => line.lineId === lineId)).toBe(false);
    expect(resolvePhysicalGrantCoverageBlockers).not.toHaveBeenCalled();
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

  it.each([
    { command: { type: "review-purchases" as const }, code: "equipment-pack-missing" as const },
    { command: { type: "review-purchases" as const }, code: "equipment-pack-index-corrupt" as const },
    { command: { type: "review-purchases" as const }, code: "duplicate-equipment-source-identity" as const },
    { command: { type: "retain-all" as const }, code: "equipment-pack-missing" as const },
    { command: { type: "retain-all" as const }, code: "equipment-pack-index-corrupt" as const },
    { command: { type: "retain-all" as const }, code: "duplicate-equipment-source-identity" as const },
  ])("keeps review state unchanged when $command.type sees $code", async ({ command, code }) => {
    const fixture = acquisitionFixture({
      lines: command.type === "retain-all" ? [] : undefined,
      disposition: "unreviewed",
    });
    const context = commandContext(fixture.draft);
    const before = structuredClone(context.draft);
    const prepareClassGrantPlan = vi.fn();
    const diagnostic = {
      code,
      packId: "pf2e.equipment-srd",
      sourceIdentity: code === "duplicate-equipment-source-identity" ? "Compendium.pf2e.equipment-srd.Item.x" : null,
      message: `Source health failure: ${code}`,
    };

    await expect(
      executeStartingEquipmentCommand(command, context, {
        ...ledgerDependencies(fixture),
        assertSourceHealth: vi.fn(async () => {
          throw new EquipmentSourceHealthError([diagnostic]);
        }),
        prepareClassGrantPlan,
      } as never)
    ).rejects.toMatchObject({ name: "EquipmentSourceHealthError", diagnostics: [diagnostic] });

    expect(context.draft).toEqual(before);
    expect(prepareClassGrantPlan).not.toHaveBeenCalled();
  });
});

function commandContext(
  acquisition: ReturnType<typeof acquisitionFixture>["draft"] | null,
  targetLevel?: number
): StartingEquipmentCommandContext {
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

function unsupportedArmorCommandContext(
  acquisition: ReturnType<typeof acquisitionFixture>["draft"] | null,
  targetLevel?: number
): StartingEquipmentCommandContext {
  const context = commandContext(acquisition, targetLevel);
  const slotId = "class-branch-innovation-level-1";
  context.draft.branchSelections[slotId] = {
    slotId,
    uuid: "Compendium.pf2e.classfeatures.Item.fpwtpm8pdwO1I6MO",
  } as never;
  return { ...context, steps: [{ slotId } as never, ...context.steps] };
}

function ledgerDependencies(fixture: ReturnType<typeof acquisitionFixture>) {
  return {
    mintIdentity: vi.fn(),
    resolvePolicy: vi.fn(),
    prepareClassGrantPlan: vi.fn(async () => fixture.classGrantPlan),
    assertSourceHealth: vi.fn(async () => undefined),
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
  return effectivePolicyWithJudgments([judgment]);
}

function effectivePolicyWithJudgments(judgments: readonly EquipmentPolicyJudgmentRecord[]) {
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
    gmJudgments: judgments,
    fingerprint: "policy-with-exception",
    explanations: [],
  };
}
