import { describe, expect, it } from "vitest";

import {
  buildActorSourceEvidence,
  qualifySmokeResult,
  SMOKE_EVIDENCE_SCHEMA_VERSION,
  validateAcquisitionEvidence,
} from "../tools/foundry-smoke/evidence-contract.mjs";

describe("Foundry smoke evidence contract", () => {
  it("accepts one physical stack with an exact aggregate quantity", () => {
    const result = qualifySmokeResult(resultFixture({ items: [physicalItem({ quantity: 12 })] }), [
      {
        id: "case",
        sourceGroupExpectations: [
          { sourceId: "Compendium.pf2e.equipment-srd.Item.rope", documentCount: 1, totalQuantity: 12 },
        ],
      },
    ]);

    expect(result.qualification).toMatchObject({ passed: true, unreviewedFindingCount: 0 });
    expect(result.cases[0].actor.sourceGroups).toEqual([
      expect.objectContaining({
        documentCount: 1,
        sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
        totalQuantity: 12,
      }),
    ]);
  });

  it("rejects same-source documents without distinct semantic identity", () => {
    const result = qualifySmokeResult(
      resultFixture({ items: [physicalItem({ id: "item-a" }), physicalItem({ id: "item-b" })] })
    );

    expect(result.qualification.passed).toBe(false);
    expect(findingCodes(result)).toContain("ambiguous-source-identity");
  });

  it("distinguishes grant ancestry and rejects a repeated grant identity", () => {
    const distinct = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({ id: "child-a", grantedById: "parent-a", grantAncestryIds: ["parent-a"] }),
          physicalItem({ id: "child-b", grantedById: "parent-b", grantAncestryIds: ["parent-b"] }),
        ],
      })
    );
    const repeated = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({ id: "child-a", grantedById: "parent-a", grantAncestryIds: ["parent-a"] }),
          physicalItem({ id: "child-b", grantedById: "parent-a", grantAncestryIds: ["parent-a"] }),
        ],
      })
    );

    expect(distinct.qualification.passed).toBe(true);
    expect(findingCodes(repeated)).toContain("ambiguous-source-identity");
  });

  it("allows intentionally separate acquisition entries and rejects repeated entry identity", () => {
    const first = acquisitionIdentity({ entryId: "entry-a", stackingIntent: "separate" });
    const second = acquisitionIdentity({ entryId: "entry-b", stackingIntent: "separate" });
    const distinct = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({ id: "item-a", acquisition: first }),
          physicalItem({ id: "item-b", acquisition: second }),
        ],
      })
    );
    const repeated = qualifySmokeResult(
      resultFixture({
        items: [physicalItem({ id: "item-a", acquisition: first }), physicalItem({ id: "item-b", acquisition: first })],
      })
    );

    expect(distinct.qualification.passed).toBe(true);
    expect(findingCodes(repeated)).toEqual(
      expect.arrayContaining(["ambiguous-source-identity", "duplicate-acquisition-entry"])
    );
  });

  it("rejects a split aggregate line and enforces source totals", () => {
    const result = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({ id: "item-a", acquisition: acquisitionIdentity({ entryId: "entry-a" }), quantity: 2 }),
          physicalItem({ id: "item-b", acquisition: acquisitionIdentity({ entryId: "entry-b" }), quantity: 3 }),
        ],
      }),
      [
        {
          id: "case",
          sourceGroupExpectations: [
            {
              sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
              documentCount: 1,
              totalQuantity: 6,
              stackingIntent: "aggregate",
            },
          ],
        },
      ]
    );

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining([
        "aggregate-stack-split",
        "source-document-count-mismatch",
        "source-quantity-mismatch",
        "source-stacking-mismatch",
      ])
    );
  });

  it("preserves container and source identity while excluding currency documents from conflicts", () => {
    const container = physicalItem({ id: "pack", sourceId: "Compendium.pf2e.equipment-srd.Item.pack" });
    const child = physicalItem({ id: "rope", containerId: "pack" });
    const coins = physicalItem({ id: "coins", isCurrency: true, quantity: 100 });
    const evidence = buildActorSourceEvidence({ items: [container, child, coins] });

    expect(evidence.findings).toEqual([]);
    expect(evidence.sourceGroups.map((group: { sourceId: string }) => group.sourceId)).toEqual([
      "Compendium.pf2e.equipment-srd.Item.pack",
      "Compendium.pf2e.equipment-srd.Item.rope",
    ]);
  });

  it("fails closed on invalid quantities, currency, containers, and runtime IDs", () => {
    const result = qualifySmokeResult(
      resultFixture({
        currencyCopper: Number.NaN,
        items: [physicalItem({ id: "", quantity: Number.NaN, containerId: "missing" })],
      })
    );

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining([
        "invalid-actor-currency",
        "invalid-container-id",
        "invalid-item-quantity",
        "missing-item-id",
      ])
    );
  });

  it("keeps the complete nullable acquisition envelope on character-build evidence", () => {
    const input = resultFixture();
    const result = qualifySmokeResult(input);

    expect(result.cases[0].evidence.acquisition).toEqual(emptyAcquisitionEvidence());
    expect(result.qualification.passed).toBe(true);
  });

  it("requires complete policy, currency, and manifest evidence for an acquisition success", () => {
    const smokeCase = resultFixture().cases[0];
    expect(validateAcquisitionEvidence(smokeCase).map((finding: { code: string }) => finding.code)).toEqual(
      expect.arrayContaining([
        "missing-policy-provenance",
        "invalid-acquisition-currency",
        "missing-manifest-identity",
        "invalid-manifest-version",
      ])
    );
    const result = qualifySmokeResult(resultFixture(), [{ id: "case", caseKind: "acquisition" }]);
    expect(result.qualification.passed).toBe(false);
  });

  it("reconciles acquisition currency and canonical manifest entries to the actor snapshot", () => {
    const valid = qualifySmokeResult(successfulAcquisitionResult(), [{ id: "case", caseKind: "acquisition" }]);
    const invalidInput = successfulAcquisitionResult();
    invalidInput.cases[0].actor.currencyCopper = 500;
    invalidInput.cases[0].evidence.acquisition.currency = {
      preCopper: 1000,
      budgetCopper: 1001,
      targetCopper: 1,
      observedCopper: 999,
      spentCopper: 1,
      remainingCopper: 777,
    };
    invalidInput.cases[0].evidence.acquisition.manifest.entries[0].quantity = 2;
    const invalid = qualifySmokeResult(invalidInput, [{ id: "case", caseKind: "acquisition" }]);

    expect(valid.qualification.passed).toBe(true);
    expect(findingCodes(invalid)).toEqual(
      expect.arrayContaining([
        "actor-currency-mismatch",
        "currency-absolute-target-mismatch",
        "currency-ledger-mismatch",
        "currency-target-mismatch",
        "manifest-quantity-mismatch",
      ])
    );
  });

  it("accepts a truthful before-currency failure and rejects arbitrary boundary evidence", () => {
    const input = successfulAcquisitionResult();
    input.cases[0].actor.currencyCopper = 0;
    input.cases[0].evidence.acquisition.currency.observedCopper = 0;
    input.cases[0].evidence.acquisition.failureSnapshot = {
      point: "currency-before",
      batchId: "batch-id",
      afterItemIndex: null,
      currencyOperationIndex: null,
      message: "Intentional failure before the first currency operation.",
      actualItemIds: ["acquired-item"],
      observedCurrencyCopper: 0,
      manifestId: null,
    };
    input.cases[0].evidence.acquisition.manifest = null;
    const valid = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);
    const invalidInput = structuredClone(input);
    invalidInput.cases[0].evidence.acquisition.failureSnapshot.point = "arbitrary-point";
    const invalid = qualifySmokeResult(invalidInput, [{ id: "case", caseKind: "acquisition" }]);

    expect(valid.qualification.passed).toBe(true);
    expect(findingCodes(invalid)).toContain("invalid-failure-point");
  });

  it("rejects failure item ids that do not exactly match the observed partial batch", () => {
    const input = successfulAcquisitionResult();
    input.cases[0].actor.items = [];
    input.cases[0].actor.currencyCopper = 0;
    input.cases[0].evidence.acquisition.currency.observedCopper = 0;
    input.cases[0].evidence.acquisition.failureSnapshot = {
      point: "item-after",
      batchId: "batch-id",
      afterItemIndex: 1,
      currencyOperationIndex: null,
      message: "Intentional failure after the first item.",
      actualItemIds: ["ghost-item"],
      observedCurrencyCopper: 0,
      manifestId: null,
    };
    input.cases[0].evidence.acquisition.manifest = null;
    const result = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(["failure-batch-item-set-mismatch", "missing-failure-item"])
    );
    expect(result.qualification.passed).toBe(false);
  });

  it("rejects nonphysical or currency documents stamped as acquisition outputs", () => {
    const input = successfulAcquisitionResult();
    Object.assign(input.cases[0].actor.items[0], {
      type: "action",
      isPhysical: false,
      quantity: null,
    });
    input.cases[0].actor.currencyCopper = 0;
    input.cases[0].evidence.acquisition.currency.observedCopper = 0;
    input.cases[0].evidence.acquisition.failureSnapshot = {
      point: "item-after",
      batchId: "batch-id",
      afterItemIndex: 1,
      currencyOperationIndex: null,
      message: "Intentional failure after the first item.",
      actualItemIds: ["acquired-item"],
      observedCurrencyCopper: 0,
      manifestId: null,
    };
    input.cases[0].evidence.acquisition.manifest = null;
    const result = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(["failure-item-identity-mismatch", "invalid-acquisition-item-kind"])
    );
    expect(result.qualification.passed).toBe(false);
  });

  it("requires requested and observed case ids to match exactly", () => {
    const empty = resultFixture();
    (empty as { cases: unknown[] }).cases = [];
    expect(() => qualifySmokeResult(empty, [{ id: "case" }])).toThrow(/coverage mismatch/u);

    const incremental = resultFixture();
    incremental.cases[0].id = "case-incremental-existing";
    expect(() => qualifySmokeResult(incremental, [{ id: "case" }])).toThrow(/coverage mismatch/u);
    expect(qualifySmokeResult(incremental, [{ id: "case-incremental-existing" }]).qualification.passed).toBe(true);
  });

  it("never converts malformed failed browser evidence into a passing case", () => {
    const input = resultFixture();
    input.cases[0].status = "fail";
    (input.cases[0] as { actor: unknown }).actor = null;
    (input.cases[0] as { failures: unknown }).failures = "fatal failure";
    const result = qualifySmokeResult(input);

    expect(result.qualification.passed).toBe(false);
    expect(findingCodes(result)).toEqual(expect.arrayContaining(["malformed-case-failures", "missing-actor-evidence"]));
  });

  it("fails an unreviewed classification and records a valid GM review by exact digest", () => {
    const input = resultFixture({ classifications: ["manual PF2E-native checkpoint"] });
    const unreviewed = qualifySmokeResult(input);
    const findingId = unreviewed.cases[0].evidence.contract.findings[0].id;
    const reviewed = qualifySmokeResult(input, [
      {
        id: "case",
        reviewedFindings: [
          {
            findingId,
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "The native checkpoint was inspected in the recorded Foundry run.",
          },
        ],
      },
    ]);

    expect(unreviewed.qualification).toMatchObject({ passed: false, unreviewedFindingCount: 1 });
    expect(reviewed.qualification).toMatchObject({ passed: true, reviewedFindingCount: 1 });
    expect(reviewed.cases[0].evidence.contract.findings[0].review).toMatchObject({ reviewerRole: "gm" });
  });

  it("rejects invalid and unused review records", () => {
    const result = qualifySmokeResult(resultFixture(), [
      {
        id: "case",
        reviewedFindings: [
          {
            findingId: "wf-smoke:manual-classification:not-observed",
            reviewerRole: "player",
            reviewedAt: "not-a-date",
            reason: "",
          },
          {
            findingId: "wf-smoke:manual-classification:also-not-observed",
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "This digest does not correspond to evidence from this run.",
          },
        ],
      },
    ]);

    expect(findingCodes(result)).toEqual(expect.arrayContaining(["invalid-review-record", "unused-review-record"]));
    expect(result.qualification.passed).toBe(false);
  });

  it("binds reviews to exact finding content and a current GM execution session", () => {
    const firstInput = resultFixture({ classifications: ["first observed fact"] });
    const first = qualifySmokeResult(firstInput);
    const firstFindingId = first.cases[0].evidence.contract.findings[0].id;
    const changed = qualifySmokeResult(resultFixture({ classifications: ["materially changed fact"] }));
    expect(changed.cases[0].evidence.contract.findings[0].id).not.toBe(firstFindingId);

    const nonGmInput = resultFixture({ classifications: ["first observed fact"] });
    nonGmInput.user = { id: "player-id", name: "Player", role: 1, isGM: false };
    const nonGm = qualifySmokeResult(nonGmInput, [
      {
        id: "case",
        reviewedFindings: [
          {
            findingId: firstFindingId,
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "A prior GM record cannot authorize a player-executed evidence run.",
          },
        ],
      },
    ]);
    expect(findingCodes(nonGm)).toContain("non-gm-review-session");
    expect(nonGm.qualification.passed).toBe(false);
  });

  it("rejects evidence without the schema-v2 user role record", () => {
    const input = resultFixture();
    (input as { user: unknown }).user = "GM";
    expect(() => qualifySmokeResult(input)).toThrow(/complete user role record/u);
  });
});

function resultFixture(
  overrides: { classifications?: string[]; currencyCopper?: number; items?: Array<Record<string, unknown>> } = {}
) {
  return {
    schemaVersion: SMOKE_EVIDENCE_SCHEMA_VERSION,
    user: { id: "user-id", name: "User", role: 4, isGM: true },
    cases: [
      {
        id: "case",
        label: "Case",
        status: overrides.classifications?.length ? "classified" : "pass",
        actor: {
          id: "actor-id",
          currencyCopper: overrides.currencyCopper ?? 1500,
          items: overrides.items ?? [],
        },
        classifications: overrides.classifications ?? [],
        evidence: { acquisition: emptyAcquisitionEvidence() },
        failures: [],
        warnings: [],
      },
    ],
    summary: { passed: 1, classified: 0, failed: 0 },
  };
}

function physicalItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-id",
    name: "Rope",
    type: "equipment",
    sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
    isPhysical: true,
    isCurrency: false,
    quantity: 1,
    containerId: null,
    grantedById: null,
    grantAncestryIds: [],
    slotId: null,
    trainingKey: null,
    destinationKey: null,
    location: null,
    acquisition: null,
    ...overrides,
  };
}

function acquisitionIdentity(overrides: Record<string, unknown> = {}) {
  return {
    draftId: "draft-id",
    batchId: "batch-id",
    lineId: "line-id",
    entryId: "entry-id",
    stackingIntent: "aggregate",
    ...overrides,
  };
}

function successfulAcquisitionResult() {
  const item = physicalItem({
    id: "acquired-item",
    acquisition: acquisitionIdentity({ stackingIntent: "aggregate" }),
  });
  const result = resultFixture({ currencyCopper: 500, items: [item] });
  result.cases[0].evidence.acquisition = {
    policy: { source: "world", version: "1", fingerprint: "policy-sha256" },
    currency: {
      preCopper: 0,
      budgetCopper: 1500,
      targetCopper: 500,
      observedCopper: 500,
      spentCopper: 1000,
      remainingCopper: 500,
    },
    manifest: {
      id: "manifest-id",
      schemaVersion: 1,
      batchId: "batch-id",
      entries: [
        {
          lineId: "line-id",
          entryId: "entry-id",
          sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
          quantity: 1,
          actualItemIds: ["acquired-item"],
          containerId: null,
          grantAncestryIds: [],
        },
      ],
    },
    failureSnapshot: null,
  };
  return result;
}

function emptyAcquisitionEvidence() {
  return {
    policy: null,
    currency: {
      preCopper: null,
      budgetCopper: null,
      targetCopper: null,
      observedCopper: null,
      spentCopper: null,
      remainingCopper: null,
    },
    manifest: null,
    failureSnapshot: null,
  };
}

function findingCodes(result: any): string[] {
  return result.cases[0].evidence.contract.findings.map((finding: { code: string }) => finding.code);
}
