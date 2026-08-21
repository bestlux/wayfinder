import { describe, expect, it } from "vitest";
import { createEmptyState, normalizeState } from "../src/draft-service";
import { prepareAcquisitionIdentityPlan } from "../src/wayfinder/domain/acquisition-identity";
import { reviewRetainAll } from "../src/wayfinder/domain/acquisition-ledger";
import type { AcquisitionDraftState } from "../src/wayfinder/domain/acquisition-types";
import { CLASS_GRANT_PROFILE_UUIDS, createPlannedClassGrant } from "../src/wayfinder/domain/class-grant-reconciliation";
import {
  type CompletedObservedItemV1,
  computeCompletedAcquisitionManifestFingerprint,
  createCompletedAcquisitionManifest,
  findCompletedAcquisitionManifestByBatchId,
  manifestsDescribeSameOutcome,
  normalizeCompletedAcquisitionManifest,
} from "../src/wayfinder/domain/completed-acquisition-manifest";
import { acquisitionFixture, acquisitionLine, completedAcquisitionFixture } from "./fixtures/acquisition-fixture";

describe("completed acquisition manifest", () => {
  it("captures exact purchase provenance and survives normalization and batch lookup", async () => {
    const completed = await completedAcquisitionFixture();
    const normalized = normalizeCompletedAcquisitionManifest(structuredClone(completed.manifest));

    expect(normalized).toEqual(completed.manifest);
    expect(normalized).toMatchObject({
      schemaVersion: 1,
      id: "manifest-1",
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      appliedBy: { userId: "owner-1", userName: "Owner" },
      targetLevel: 5,
      disposition: "purchase-ledger",
      policy: {
        material: {
          recipeSelection: {
            selectedRecipe: "permanent-items",
            selectedAt: "2026-08-18T19:55:00.000Z",
            selector: { kind: "user", userId: "owner-1", userName: "Owner" },
            authority: { mode: "owner-delegated" },
          },
        },
      },
      currency: { preCopper: 0, budgetCopper: 1_000, spentCopper: 100, remainingCopper: 900 },
      entries: [
        expect.objectContaining({
          lineIds: ["line-1"],
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
          documentFingerprint: "document-1",
          priceFingerprint: "price-1",
          stackingIntent: "aggregate",
          observedItems: [
            expect.objectContaining({
              actualItemId: "actor-item-1",
              actualSourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
              actualQuantity: 1,
            }),
          ],
        }),
      ],
      environment: { foundryVersion: "14.366", pf2eVersion: "8.4.0", moduleVersion: "0.8.0" },
    });
    expect(findCompletedAcquisitionManifestByBatchId(normalized, "batch-1")).toEqual(normalized);
    expect(findCompletedAcquisitionManifestByBatchId(normalized, "another-batch")).toBeNull();
  });

  it("binds observed item and currency evidence to the prepared plan and ledger", async () => {
    const completed = await completedAcquisitionFixture();
    const planned = completed.identityPlan.entries[0]!.plannedItems[0]!;

    expect(() =>
      createManifest(completed, {
        observedItems: [
          {
            plannedItemId: planned.plannedItemId,
            actualItemId: "actor-item-1",
            actualSourceUuid: "Compendium.pf2e.equipment-srd.Item.other",
            actualQuantity: planned.quantity,
            plannedContainerId: planned.plannedContainerId,
            actualContainerId: null,
          },
        ],
      })
    ).toThrow(/item facts differ/i);
    expect(() =>
      createManifest(completed, {
        observedItems: [{ ...completed.observedItems[0]!, actualContainerId: "foreign-container" }],
      })
    ).toThrow(/container evidence differs/i);
    expect(() =>
      createManifest(completed, {
        currency: {
          ...completed.manifest.currency,
          spentCopper: 0,
          remainingCopper: 1_000,
          targetCopper: 1_000,
          observedCopper: 1_000,
        },
      })
    ).toThrow(/prepared ledger/i);
  });

  it("preserves automatic allowance funding and its resolved allowance identity", async () => {
    const completed = await completedAcquisitionFixture({
      fixture: acquisitionFixture({
        lines: [
          acquisitionLine({
            funding: { lane: "allowance", assignment: { mode: "automatic" } },
          }),
        ],
      }),
    });

    expect(completed.manifest.entries[0]).toMatchObject({
      funding: { lane: "allowance", assignment: { mode: "automatic" } },
      resolvedAllowanceId: "allowance-5",
    });
    expect(normalizeCompletedAcquisitionManifest(completed.manifest)).toEqual(completed.manifest);
  });

  it("records retain-all and acknowledged handoff without item or currency mutation", async () => {
    const retain = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const retainedDraft = reviewRetainAll(retain.draft, retain.ledger, {
      userId: "owner-1",
      reviewedAt: "2026-08-18T21:00:00.000Z",
    });
    const retained = await completedAcquisitionFixture({ draft: retainedDraft, fixture: retain });
    expect(retained.manifest).toMatchObject({
      disposition: "retain-all",
      entries: [],
      currency: { spentCopper: 0, remainingCopper: 1_000, targetCopper: 1_000, observedCopper: 1_000 },
    });

    const handoffFixture = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const handoffDraft = structuredClone(handoffFixture.draft) as Mutable<AcquisitionDraftState>;
    handoffDraft.disposition = {
      kind: "handoff",
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: handoffDraft.baseline!.fingerprint,
        reasons: [{ code: "nonzero-currency", copper: 1 }],
      },
      acknowledgedByUserId: "owner-1",
      acknowledgedAt: "2026-08-18T21:00:00.000Z",
    };
    const handoff = await completedAcquisitionFixture({ draft: handoffDraft, fixture: handoffFixture });
    expect(handoff.manifest).toMatchObject({
      disposition: "handoff",
      entries: [],
      currency: { preCopper: 0, spentCopper: 0, remainingCopper: 1_000, targetCopper: 0, observedCopper: 0 },
    });

    const handoffWithCartFixture = acquisitionFixture();
    const handoffWithCartDraft = structuredClone(handoffWithCartFixture.draft) as Mutable<AcquisitionDraftState>;
    handoffWithCartDraft.disposition = {
      kind: "handoff",
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: handoffWithCartDraft.baseline!.fingerprint,
        reasons: [{ code: "nonzero-currency", copper: 1 }],
      },
      acknowledgedByUserId: "owner-1",
      acknowledgedAt: "2026-08-18T21:00:00.000Z",
    };
    const handoffWithCart = await completedAcquisitionFixture({
      draft: handoffWithCartDraft,
      fixture: handoffWithCartFixture,
    });
    expect(() => createManifest(handoffWithCart, { observedItems: handoffWithCart.observedItems })).toThrow(
      /cannot claim automated item mutation/i
    );
  });

  it("round-trips stable container ownership and rejects a mismatched actual parent", async () => {
    const completed = await completedAcquisitionFixture({
      fixture: acquisitionFixture({ lines: [acquisitionLine({ requestedQuantity: 2 })] }),
    });
    const nested = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    const entry = nested.entries[0]!;
    const original = entry.plannedItems[0]!;
    entry.plannedItems = [
      { ...original, quantity: 1, ownedContainerId: "container-1" },
      {
        plannedItemId: "planned-child",
        ownedContainerId: null,
        sourceUuid: original.sourceUuid,
        quantity: 1,
        plannedContainerId: "container-1",
      },
    ];
    entry.observedItems = [
      {
        plannedItemId: original.plannedItemId,
        actualItemId: "actor-container",
        actualSourceUuid: original.sourceUuid,
        actualQuantity: 1,
        plannedContainerId: null,
        actualContainerId: null,
      },
      {
        plannedItemId: "planned-child",
        actualItemId: "actor-child",
        actualSourceUuid: original.sourceUuid,
        actualQuantity: 1,
        plannedContainerId: "container-1",
        actualContainerId: "actor-container",
      },
    ];
    nested.fingerprint = computeCompletedAcquisitionManifestFingerprint(nested);
    expect(normalizeCompletedAcquisitionManifest(nested)).not.toBeNull();

    entry.observedItems[1]!.actualContainerId = "wrong-container";
    nested.fingerprint = computeCompletedAcquisitionManifestFingerprint(nested);
    expect(normalizeCompletedAcquisitionManifest(nested)).toBeNull();

    entry.plannedItems[0]!.plannedContainerId = "container-2";
    entry.plannedItems[1]!.ownedContainerId = "container-2";
    entry.observedItems[0]!.plannedContainerId = "container-2";
    entry.observedItems[0]!.actualContainerId = "actor-child";
    entry.observedItems[1]!.actualContainerId = "actor-container";
    nested.fingerprint = computeCompletedAcquisitionManifestFingerprint(nested);
    expect(normalizeCompletedAcquisitionManifest(nested)).toBeNull();
  });

  it("binds class-grant-funded item evidence to the exact final reconciliation", async () => {
    const grant = fixedGrant();
    const fixture = acquisitionFixture({
      disposition: "unreviewed",
      plannedClassGrants: [grant],
      lines: [
        acquisitionLine({
          sourceUuid: grant.expected.sourceUuid,
          funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
        }),
      ],
    });
    const reviewedDraft = reviewRetainAll(fixture.draft, fixture.ledger, {
      userId: "owner-1",
      reviewedAt: "2026-08-18T21:00:00.000Z",
    });
    const identityPlan = await prepareAcquisitionIdentityPlan({
      actorId: "actor-1",
      draft: reviewedDraft,
      ledger: fixture.ledger,
      classGrantPlan: fixture.classGrantPlan,
    });
    const planned = identityPlan.entries[0]!.plannedItems[0]!;

    expect(() =>
      createCompletedAcquisitionManifest({
        actorId: "actor-1",
        draft: reviewedDraft,
        identityPlan,
        appliedBy: { userId: "owner-1", userName: "Owner" },
        appliedAt: "2026-08-18T22:00:00.000Z",
        currency: {
          preCopper: 0,
          budgetCopper: 1_000,
          targetCopper: 1_000,
          observedCopper: 1_000,
          spentCopper: 0,
          remainingCopper: 1_000,
        },
        observedItems: [
          {
            plannedItemId: planned.plannedItemId,
            actualItemId: "wrong-item",
            actualSourceUuid: planned.sourceUuid,
            actualQuantity: planned.quantity,
            plannedContainerId: null,
            actualContainerId: null,
          },
        ],
        finalClassGrantReconciliation: {
          version: 1,
          draftId: fixture.draft.draftId,
          batchId: fixture.draft.batchId,
          phase: "final",
          entries: [{ grantId: grant.grantId, status: "resolved", itemIds: ["actual-grant-item"] }],
          ignoredItemIds: ["actual-grant-item"],
          unresolvedGrantIds: [],
          ambiguousGrantIds: [],
        },
        environment: { foundryVersion: "14.366", pf2eVersion: "8.4.0", moduleVersion: "0.8.0" },
      })
    ).toThrow(/class-grant item evidence differs/i);

    const valid = createCompletedAcquisitionManifest({
      actorId: "actor-1",
      draft: reviewedDraft,
      identityPlan,
      appliedBy: { userId: "owner-1", userName: "Owner" },
      appliedAt: "2026-08-18T22:00:00.000Z",
      currency: {
        preCopper: 0,
        budgetCopper: 1_000,
        targetCopper: 1_000,
        observedCopper: 1_000,
        spentCopper: 0,
        remainingCopper: 1_000,
      },
      observedItems: [
        {
          plannedItemId: planned.plannedItemId,
          actualItemId: "actual-grant-item",
          actualSourceUuid: planned.sourceUuid,
          actualQuantity: planned.quantity,
          plannedContainerId: null,
          actualContainerId: null,
        },
      ],
      finalClassGrantReconciliation: {
        version: 1,
        draftId: fixture.draft.draftId,
        batchId: fixture.draft.batchId,
        phase: "final",
        entries: [{ grantId: grant.grantId, status: "resolved", itemIds: ["actual-grant-item"] }],
        ignoredItemIds: ["actual-grant-item"],
        unresolvedGrantIds: [],
        ambiguousGrantIds: [],
      },
      environment: { foundryVersion: "14.366", pf2eVersion: "8.4.0", moduleVersion: "0.8.0" },
    });
    expect(normalizeCompletedAcquisitionManifest(valid)).not.toBeNull();
    const missingGrantEntry = structuredClone(valid) as Mutable<typeof valid>;
    missingGrantEntry.entries = [];
    missingGrantEntry.logicalLines = [];
    missingGrantEntry.fingerprint = computeCompletedAcquisitionManifestFingerprint(missingGrantEntry);
    expect(normalizeCompletedAcquisitionManifest(missingGrantEntry)).toBeNull();
  });

  it("rejects independently re-fingerprinted malformed nested data and cross-entry item evidence", async () => {
    const completed = await completedAcquisitionFixture({
      fixture: acquisitionFixture({
        lines: [
          acquisitionLine({ lineId: "line-a", stackingIntent: "separate" }),
          acquisitionLine({ lineId: "line-b", stackingIntent: "separate" }),
        ],
      }),
    });
    const malformedPolicy = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    malformedPolicy.policy = {} as never;
    malformedPolicy.fingerprint = computeCompletedAcquisitionManifestFingerprint(malformedPolicy);
    expect(normalizeCompletedAcquisitionManifest(malformedPolicy)).toBeNull();

    const crossed = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    const firstObserved = crossed.entries[0]!.observedItems[0]!;
    firstObserved.plannedItemId = crossed.entries[1]!.plannedItems[0]!.plannedItemId;
    crossed.fingerprint = computeCompletedAcquisitionManifestFingerprint(crossed);
    expect(normalizeCompletedAcquisitionManifest(crossed)).toBeNull();

    const relabeledRetainAll = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    relabeledRetainAll.disposition = "retain-all";
    relabeledRetainAll.fingerprint = computeCompletedAcquisitionManifestFingerprint(relabeledRetainAll);
    expect(normalizeCompletedAcquisitionManifest(relabeledRetainAll)).toBeNull();
  });

  it("treats retry user, time, and runtime metadata as volatile while preserving the durable outcome", async () => {
    const completed = await completedAcquisitionFixture();
    const retry = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    retry.appliedBy = { userId: "gm-1", userName: "Game Master" };
    retry.appliedAt = "2026-08-19T22:00:00.000Z";
    retry.environment = { foundryVersion: "14.367", pf2eVersion: "8.4.1", moduleVersion: "0.8.1" };
    retry.fingerprint = computeCompletedAcquisitionManifestFingerprint(retry);

    expect(normalizeCompletedAcquisitionManifest(retry)).not.toBeNull();
    expect(manifestsDescribeSameOutcome(completed.manifest, retry)).toBe(true);
    retry.currency.remainingCopper -= 1;
    retry.fingerprint = computeCompletedAcquisitionManifestFingerprint(retry);
    expect(manifestsDescribeSameOutcome(completed.manifest, retry)).toBe(false);
  });

  it("migrates state to v4 and preserves malformed manifest evidence as sticky corruption", async () => {
    const completed = await completedAcquisitionFixture();
    const valid = normalizeState({
      ...createEmptyState(),
      version: 3,
      completedAcquisitionManifest: completed.manifest,
    });
    expect(valid).toMatchObject({
      version: 4,
      completedAcquisitionManifest: completed.manifest,
      completedAcquisitionManifestCorrupt: false,
    });

    const malformed = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    malformed.policy = {} as never;
    malformed.fingerprint = computeCompletedAcquisitionManifestFingerprint(malformed);
    const corrupt = normalizeState({
      ...createEmptyState(),
      completedAcquisitionManifest: malformed,
    });
    expect(corrupt.completedAcquisitionManifest).toBeNull();
    expect(corrupt.completedAcquisitionManifestCorrupt).toBe(true);
    expect(normalizeState(corrupt).completedAcquisitionManifestCorrupt).toBe(true);
  });
});

function createManifest(
  completed: Awaited<ReturnType<typeof completedAcquisitionFixture>>,
  overrides: {
    readonly observedItems?: readonly CompletedObservedItemV1[];
    readonly currency?: typeof completed.manifest.currency;
  }
) {
  return createCompletedAcquisitionManifest({
    actorId: "actor-1",
    draft: completed.draft,
    identityPlan: completed.identityPlan,
    appliedBy: { userId: "owner-1", userName: "Owner" },
    appliedAt: "2026-08-18T22:00:00.000Z",
    currency: overrides.currency ?? completed.manifest.currency,
    observedItems: overrides.observedItems ?? completed.observedItems,
    finalClassGrantReconciliation: completed.finalClassGrantReconciliation,
    environment: { foundryVersion: "14.366", pf2eVersion: "8.4.0", moduleVersion: "0.8.0" },
  });
}

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function fixedGrant() {
  const uuid = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:alchemist-formula-book:class-level-1",
    profileId: "alchemist-formula-book",
    origin: { sourceSlotId: "class-level-1", sourceUuid: uuid.alchemistClass },
    granterSourceUuid: uuid.formulaBookFeature,
    expected: { sourceUuid: uuid.formulaBookItem, quantity: 1, itemType: "equipment" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [uuid.formulaBookFeature, uuid.alchemyFeature, uuid.alchemistClass],
  });
}
