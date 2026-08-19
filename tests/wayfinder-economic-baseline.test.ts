import { describe, expect, it, vi } from "vitest";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import {
  compareEconomicBaselines,
  createEconomicBaseline,
  type EconomicPhysicalItemV1,
  evaluateEconomicAdmission,
  executeWithEconomicBaselineRevalidation,
  normalizeEconomicBaseline,
} from "../src/wayfinder/domain/economic-baseline";

describe("economic baseline", () => {
  it("captures a stable material fingerprint independent of time and item order", () => {
    const first = baseline({
      capturedAt: "2026-08-18T20:00:00.000Z",
      physicalItems: [physical("item-b"), physical("item-a")],
    });
    const second = baseline({
      capturedAt: "2026-08-18T21:00:00.000Z",
      physicalItems: [physical("item-a"), physical("item-b")],
    });

    expect(first.physicalItems.map((item) => item.itemId)).toEqual(["item-a", "item-b"]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(normalizeEconomicBaseline(structuredClone(first))).toEqual(first);
    expect(normalizeEconomicBaseline({ ...first, currencyCopper: 1 })).toBeNull();
  });

  it("admits an empty level-1 actor without a start claim", () => {
    expect(admission({ baseline: baseline(), targetLevel: 1 })).toMatchObject({ kind: "eligible-empty" });
  });

  it("requires an exact persisted start context above level 1", () => {
    expect(admission({ baseline: baseline() })).toMatchObject({
      kind: "blocked",
      code: "higher-level-start-context-missing",
    });

    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: ownerStartEvidence(),
      })
    ).toMatchObject({ kind: "eligible-empty" });

    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: { ...ownerStartEvidence(), draftId: "another-draft" },
      })
    ).toMatchObject({ kind: "blocked", code: "higher-level-start-context-mismatch" });
  });

  it("routes foreign physical items, currency, and unresolved grants to handoff", () => {
    const grants = [formulaGrant(), titanGrant()];
    const result = admission({
      baseline: baseline({ currencyCopper: 25, physicalItems: [physical("foreign")] }),
      higherLevelStartEvidence: ownerStartEvidence(),
      classGrantReconciliation: reconciliation({
        entries: [
          { grantId: grants[0]!.grantId, status: "unresolved", itemIds: [] },
          { grantId: grants[1]!.grantId, status: "ambiguous", itemIds: ["candidate-a", "candidate-b"] },
        ],
        unresolvedGrantIds: [grants[0]!.grantId],
        ambiguousGrantIds: [grants[1]!.grantId],
      }),
      preparedClassGrantPlan: preparedPlan(grants),
    });

    expect(result).toMatchObject({ kind: "handoff", handoff: { kind: "pf2e-sheet" } });
    if (result.kind === "handoff") {
      expect(result.handoff.reasons).toEqual([
        { code: "foreign-physical-items", itemIds: ["foreign"] },
        { code: "unresolved-class-grant", grantIds: [grants[0]!.grantId] },
        { code: "ambiguous-class-grant", grantIds: [grants[1]!.grantId] },
        { code: "nonzero-currency", copper: 25 },
      ]);
    }
  });

  it("ignores only item IDs resolved by authoritative class-grant reconciliation", () => {
    const granted = physical("granted-book");
    const grant = formulaGrant();
    expect(
      admission({
        baseline: baseline({ physicalItems: [granted] }),
        higherLevelStartEvidence: ownerStartEvidence(),
        classGrantReconciliation: reconciliation({
          entries: [{ grantId: grant.grantId, status: "resolved", itemIds: ["granted-book"] }],
          ignoredItemIds: ["granted-book"],
        }),
        preparedClassGrantPlan: preparedPlan([grant]),
      })
    ).toMatchObject({ kind: "eligible-empty" });

    expect(
      admission({
        baseline: baseline({ physicalItems: [granted] }),
        higherLevelStartEvidence: ownerStartEvidence(),
      })
    ).toMatchObject({ kind: "handoff", handoff: { reasons: [{ code: "foreign-physical-items" }] } });
  });

  it("recognizes only exact same-draft and same-batch partial outputs as retry", () => {
    const retryItem = physical("created", {
      acquisitionIdentity: {
        version: 1,
        draftId: "draft-1",
        batchId: "batch-1",
        manifestId: "manifest-1",
        lineId: "line-1",
        entryId: "entry-1",
        plannedItemId: "planned-item-1",
        plannedContainerId: null,
        plannedGrantId: null,
        stackingIntent: "separate",
      },
    });
    const result = admission({
      baseline: baseline({ currencyCopper: 500, physicalItems: [retryItem] }),
      higherLevelStartEvidence: ownerStartEvidence(),
      retryExpectation: {
        draftId: "draft-1",
        batchId: "batch-1",
        manifestId: "manifest-1",
        expectedCurrencyCopper: 500,
        expectedEntries: [
          {
            entryId: "entry-1",
            plannedItemId: "planned-item-1",
            plannedContainerId: null,
            lineId: "line-1",
            sourceUuid: retryItem.sourceUuid!,
            quantity: 1,
            containerId: null,
            stackingIntent: "separate",
          },
        ],
      },
    });
    expect(result).toMatchObject({ kind: "eligible-retry", entryIds: ["entry-1"] });

    const wrongBatch = admission({
      baseline: baseline({ physicalItems: [retryItem] }),
      higherLevelStartEvidence: ownerStartEvidence(),
      retryExpectation: {
        draftId: "draft-1",
        batchId: "other-batch",
        manifestId: "manifest-1",
        expectedCurrencyCopper: 0,
        expectedEntries: [
          {
            entryId: "entry-1",
            plannedItemId: "planned-item-1",
            plannedContainerId: null,
            lineId: "line-1",
            sourceUuid: retryItem.sourceUuid!,
            quantity: 1,
            containerId: null,
            stackingIntent: "separate",
          },
        ],
      },
    });
    expect(wrongBatch).toMatchObject({ kind: "blocked", code: "retry-identity-mismatch" });

    expect(
      admission({
        baseline: baseline({ physicalItems: [retryItem] }),
        higherLevelStartEvidence: ownerStartEvidence(),
      })
    ).toMatchObject({ kind: "handoff" });

    expect(
      admission({
        baseline: baseline({ currencyCopper: 500 }),
        higherLevelStartEvidence: ownerStartEvidence(),
        retryExpectation: {
          draftId: "draft-1",
          batchId: "batch-1",
          manifestId: "manifest-1",
          expectedCurrencyCopper: 500,
          expectedEntries: [],
        },
      })
    ).toMatchObject({ kind: "handoff", handoff: { reasons: [{ code: "nonzero-currency", copper: 500 }] } });

    expect(
      admission({
        baseline: baseline({ currencyCopper: 500 }),
        higherLevelStartEvidence: ownerStartEvidence(),
        retryExpectation: {
          draftId: "draft-1",
          batchId: "batch-1",
          manifestId: "manifest-1",
          expectedCurrencyCopper: 500,
          allowCurrencyOnlyConvergence: true,
          expectedEntries: [],
        },
      })
    ).toMatchObject({ kind: "eligible-retry", entryIds: [] });
  });

  it("blocks completed acquisition and prior character outcomes before emptiness can grant wealth", () => {
    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: ownerStartEvidence(),
        history: {
          previousCharacterAppliedAt: null,
          previousTargetLevel: null,
          completedAcquisitionManifestId: null,
          completedAcquisitionManifestCorrupt: true,
        },
      })
    ).toMatchObject({ kind: "blocked", code: "completed-acquisition-manifest-corrupt" });

    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: ownerStartEvidence(),
        history: {
          previousCharacterAppliedAt: null,
          previousTargetLevel: null,
          completedAcquisitionManifestId: "manifest-1",
          completedAcquisitionManifestCorrupt: false,
        },
      })
    ).toMatchObject({ kind: "blocked", code: "completed-acquisition" });

    expect(
      admission({
        baseline: baseline({
          physicalItems: [
            physical("created", {
              acquisitionIdentity: {
                version: 1,
                draftId: "draft-1",
                batchId: "batch-1",
                manifestId: "manifest-1",
                lineId: "line-1",
                entryId: "entry-1",
                plannedItemId: "planned-item-1",
                plannedContainerId: null,
                plannedGrantId: null,
                stackingIntent: "aggregate",
              },
            }),
          ],
        }),
        higherLevelStartEvidence: ownerStartEvidence(),
        history: {
          previousCharacterAppliedAt: null,
          previousTargetLevel: null,
          completedAcquisitionManifestId: "manifest-1",
          completedAcquisitionManifestCorrupt: false,
        },
        retryExpectation: {
          draftId: "draft-1",
          batchId: "batch-1",
          manifestId: "manifest-1",
          expectedCurrencyCopper: 0,
          expectedEntries: [],
        },
      })
    ).toMatchObject({ kind: "blocked", code: "completed-acquisition" });
    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: ownerStartEvidence(),
        history: {
          previousCharacterAppliedAt: "2026-08-17T20:00:00.000Z",
          previousTargetLevel: 1,
          completedAcquisitionManifestId: null,
          completedAcquisitionManifestCorrupt: false,
        },
      })
    ).toMatchObject({ kind: "blocked", code: "prior-character-outcome" });

    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: ownerStartEvidence(),
        history: {
          previousCharacterAppliedAt: null,
          previousTargetLevel: 1,
          completedAcquisitionManifestId: null,
          completedAcquisitionManifestCorrupt: false,
        },
      })
    ).toMatchObject({ kind: "blocked", code: "prior-character-outcome" });
  });

  it("detects only material baseline changes and performs zero writes on drift", async () => {
    const reviewed = baseline();
    const same = baseline({ capturedAt: "2026-08-18T21:00:00.000Z" });
    expect(compareEconomicBaselines(reviewed, same)).toEqual([]);

    const write = vi.fn();
    const result = await executeWithEconomicBaselineRevalidation({
      reviewed,
      captureCurrent: () => baseline({ currencyCopper: 1 }),
      write,
    });
    expect(result).toMatchObject({ ok: false, differences: [{ code: "currency" }] });
    expect(write).not.toHaveBeenCalled();
  });
});

function admission(
  overrides: Partial<Parameters<typeof evaluateEconomicAdmission>[0]> & {
    baseline: Parameters<typeof evaluateEconomicAdmission>[0]["baseline"];
  }
) {
  const draftId = overrides.draftId ?? "draft-1";
  const batchId = overrides.batchId ?? "batch-1";
  const targetLevel = overrides.targetLevel ?? 5;
  const preparedClassGrantPlan =
    overrides.preparedClassGrantPlan ??
    createPreparedClassGrantPlan({
      actorId: overrides.baseline.actorId,
      draftId,
      batchId,
      targetLevel,
      grants: [],
    });
  return evaluateEconomicAdmission({
    baseline: overrides.baseline,
    draftId,
    batchId,
    targetLevel,
    higherLevelStartEvidence: { kind: "not-required" },
    history: {
      previousCharacterAppliedAt: null,
      previousTargetLevel: null,
      completedAcquisitionManifestId: null,
      completedAcquisitionManifestCorrupt: false,
    },
    classGrantReconciliation: reconciliation(),
    preparedClassGrantPlan,
    ...overrides,
  });
}

function preparedPlan(grants: Parameters<typeof createPreparedClassGrantPlan>[0]["grants"]) {
  return createPreparedClassGrantPlan({
    actorId: "actor-1",
    draftId: "draft-1",
    batchId: "batch-1",
    targetLevel: 5,
    grants,
  });
}

function formulaGrant() {
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

function titanGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:titan-mauler:class-branch-instinct-level-1",
    profileId: "giant-instinct-titan-mauler",
    origin: { sourceSlotId: "class-branch-instinct-level-1", sourceUuid: u.giantInstinct },
    granterSourceUuid: u.giantInstinct,
    expected: { sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon", quantity: 1, itemType: "weapon" },
    materializer: "wayfinder-acquisition",
    eligibilityKind: "catalogue-choice",
    resaleRule: "zero-until-rune-investment",
    eligibilityEvidence: {
      kind: "titan-mauler",
      documentFingerprint: "weapon-1",
      lineId: "line-titan",
      lineDocumentFingerprint: "weapon-line-1",
      linePriceFingerprint: "weapon-price-1",
      policyFingerprint: "policy-1",
      actorSize: "medium",
      targetSize: "large",
      basePriceCopper: 900,
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

function reconciliation(
  overrides: Partial<Parameters<typeof evaluateEconomicAdmission>[0]["classGrantReconciliation"]> = {}
) {
  return {
    version: 1 as const,
    draftId: "draft-1",
    batchId: "batch-1",
    phase: "before-acquisition" as const,
    entries: [],
    ignoredItemIds: [],
    unresolvedGrantIds: [],
    ambiguousGrantIds: [],
    ...overrides,
  };
}

function baseline(
  overrides: Partial<{
    actorId: string;
    capturedAt: string;
    currencyCopper: number;
    physicalItems: EconomicPhysicalItemV1[];
  }> = {}
) {
  return createEconomicBaseline({
    actorId: overrides.actorId ?? "actor-1",
    capturedAt: overrides.capturedAt ?? "2026-08-18T20:00:00.000Z",
    currencyCopper: overrides.currencyCopper ?? 0,
    physicalItems: overrides.physicalItems ?? [],
  });
}

function physical(itemId: string, overrides: Partial<EconomicPhysicalItemV1> = {}): EconomicPhysicalItemV1 {
  return {
    itemId,
    type: "equipment",
    sourceUuid: `Compendium.pf2e.equipment-srd.Item.${itemId}`,
    quantity: 1,
    containerId: null,
    acquisitionIdentity: null,
    ...overrides,
  };
}

function ownerStartEvidence() {
  return {
    kind: "actor-owner-attestation" as const,
    startKind: "replacement-character" as const,
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 5,
    authorUserId: "owner-1",
    authorName: "Owner",
    recordedAt: "2026-08-18T20:00:00.000Z",
    reason: "Replacement character",
  };
}
