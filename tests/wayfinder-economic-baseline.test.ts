import { describe, expect, it, vi } from "vitest";
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
    const result = admission({
      baseline: baseline({ currencyCopper: 25, physicalItems: [physical("foreign")] }),
      higherLevelStartEvidence: ownerStartEvidence(),
      unresolvedClassGrantItemIds: ["unresolved"],
      ambiguousClassGrantItemIds: ["ambiguous"],
    });

    expect(result).toMatchObject({ kind: "handoff", handoff: { kind: "pf2e-sheet" } });
    if (result.kind === "handoff") {
      expect(result.handoff.reasons).toEqual([
        { code: "foreign-physical-items", itemIds: ["foreign"] },
        { code: "unresolved-class-grant", itemIds: ["unresolved"] },
        { code: "ambiguous-class-grant", itemIds: ["ambiguous"] },
        { code: "nonzero-currency", copper: 25 },
      ]);
    }
  });

  it("recognizes only exact same-draft and same-batch partial outputs as retry", () => {
    const retryItem = physical("created", {
      acquisitionIdentity: {
        draftId: "draft-1",
        batchId: "batch-1",
        lineId: "line-1",
        entryId: "entry-1",
        stackingIntent: "separate",
      },
    });
    const result = admission({
      baseline: baseline({ currencyCopper: 500, physicalItems: [retryItem] }),
      higherLevelStartEvidence: ownerStartEvidence(),
      retryExpectation: {
        draftId: "draft-1",
        batchId: "batch-1",
        expectedCurrencyCopper: 500,
        expectedEntries: [
          {
            entryId: "entry-1",
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
        expectedCurrencyCopper: 0,
        expectedEntries: [
          {
            entryId: "entry-1",
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
          expectedCurrencyCopper: 500,
          expectedEntries: [],
        },
      })
    ).toMatchObject({ kind: "handoff", handoff: { reasons: [{ code: "nonzero-currency", copper: 500 }] } });
  });

  it("blocks completed acquisition and prior character outcomes before emptiness can grant wealth", () => {
    expect(
      admission({
        baseline: baseline(),
        higherLevelStartEvidence: ownerStartEvidence(),
        history: {
          previousCharacterAppliedAt: null,
          previousTargetLevel: null,
          completedAcquisitionManifestId: "manifest-1",
        },
      })
    ).toMatchObject({ kind: "blocked", code: "completed-acquisition" });

    expect(
      admission({
        baseline: baseline({
          physicalItems: [
            physical("created", {
              acquisitionIdentity: {
                draftId: "draft-1",
                batchId: "batch-1",
                lineId: "line-1",
                entryId: "entry-1",
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
        },
        retryExpectation: {
          draftId: "draft-1",
          batchId: "batch-1",
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
  return evaluateEconomicAdmission({
    baseline: overrides.baseline,
    draftId: "draft-1",
    batchId: "batch-1",
    targetLevel: 5,
    higherLevelStartEvidence: { kind: "not-required" },
    history: {
      previousCharacterAppliedAt: null,
      previousTargetLevel: null,
      completedAcquisitionManifestId: null,
    },
    ...overrides,
  });
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
