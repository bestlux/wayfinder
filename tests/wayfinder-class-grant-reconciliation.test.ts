import { describe, expect, it } from "vitest";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  evaluateTitanMaulerCandidate,
  isClassGrantReconciliationConsistentForPlan,
  isPreparedClassGrantPlan,
  normalizePlannedClassGrant,
  type ObservedClassGrantItem,
  type PlannedClassGrantV1,
  reconcilePlannedClassGrants,
  type TitanMaulerCandidate,
} from "../src/wayfinder/domain/class-grant-reconciliation";

describe("planned class-grant reconciliation", () => {
  it("requires the exact PF2E native granted-by chain and rejects source resemblance", () => {
    const grant = formulaGrant();
    const items = [
      observed("book", grant.expected.sourceUuid, "equipment", "formula-feature"),
      observed("formula-feature", grant.nativeGrantChainSourceUuids[0]!, "feat", "alchemy-feature"),
      observed("alchemy-feature", grant.nativeGrantChainSourceUuids[1]!, "feat", null, null, null, "class"),
      observed("class", grant.nativeGrantChainSourceUuids[2]!, "class", null, null, "class-level-1"),
      observed("lookalike", grant.expected.sourceUuid, "equipment", null),
    ];

    const result = reconcilePlannedClassGrants({
      plan: [grant],
      actorItems: items,
      phase: "final",
      draftId: "draft-1",
      batchId: "batch-1",
    });
    expect(result.entries).toEqual([{ grantId: grant.grantId, status: "resolved", itemIds: ["book"] }]);
    expect(result.ignoredItemIds).toEqual(["book"]);
  });

  it("keeps missing grants pending before acquisition and fails them closed afterward", () => {
    const grant = formulaGrant();
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: [],
        phase: "before-acquisition",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({ entries: [{ status: "pending" }], unresolvedGrantIds: [] });
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: [],
        phase: "after-acquisition",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({ entries: [{ status: "unresolved" }], unresolvedGrantIds: [grant.grantId] });
  });

  it("authenticates Investigator through the selected methodology slot and complete native chain", () => {
    const grant = investigatorGrant();
    const chain = [
      observed("book", grant.expected.sourceUuid, "equipment", "science"),
      observed(
        "science",
        grant.nativeGrantChainSourceUuids[0]!,
        "feat",
        "methodology",
        null,
        grant.origin.sourceSlotId
      ),
      observed("methodology", grant.nativeGrantChainSourceUuids[1]!, "feat", null, null, null, "class"),
      observed("class", grant.nativeGrantChainSourceUuids[2]!, "class", null),
    ];
    for (const phase of ["before-acquisition", "after-acquisition", "final"] as const) {
      expect(
        reconcilePlannedClassGrants({
          plan: [grant],
          actorItems: chain,
          phase,
          draftId: "draft-1",
          batchId: "batch-1",
        }).entries[0]?.status
      ).toBe("resolved");
    }
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: chain.map((item) =>
          item.itemId === "science" ? { ...item, wayfinderSlotId: "wrong-methodology-slot" } : item
        ),
        phase: "final",
        draftId: "draft-1",
        batchId: "batch-1",
      }).entries[0]?.status
    ).toBe("unresolved");
  });

  it.each([
    ["Dwarf Clan Dagger", dwarfGrant()],
    ["Sarangay Head Gem", sarangayGrant()],
  ])("authenticates the exact %s ancestry-native chain", (_name, grant) => {
    const chain = [
      observed("target", grant.expected.sourceUuid, grant.expected.itemType, "feature"),
      observed("feature", grant.nativeGrantChainSourceUuids[0]!, "feat", null, null, null, "ancestry"),
      observed("ancestry", grant.nativeGrantChainSourceUuids[1]!, "ancestry", null, null, "ancestry-level-1"),
    ];
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: chain,
        phase: "final",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({
      entries: [{ grantId: grant.grantId, status: "resolved", itemIds: ["target"] }],
      ignoredItemIds: ["target"],
    });

    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: [observed("lookalike", grant.expected.sourceUuid, grant.expected.itemType, null)],
        phase: "final",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({ entries: [{ status: "unresolved" }], ignoredItemIds: [] });
  });

  it("requires exact Wayfinder draft, batch, and planned-grant identity for Titan Mauler", () => {
    const grant = titanGrant();
    const exact = observed("weapon", grant.expected.sourceUuid, "weapon", null, {
      version: 1,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      lineId: "line-1",
      entryId: "entry-1",
      plannedItemId: "planned-item-1",
      plannedContainerId: null,
      plannedGrantId: grant.grantId,
      stackingIntent: "separate",
    });
    const wrongBatch = {
      ...exact,
      itemId: "wrong-batch",
      acquisitionIdentity: { ...exact.acquisitionIdentity!, batchId: "other-batch" },
    };
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: [exact, wrongBatch],
        phase: "final",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({ entries: [{ status: "resolved", itemIds: ["weapon"] }] });

    const wrongLine = {
      ...exact,
      itemId: "wrong-line",
      acquisitionIdentity: { ...exact.acquisitionIdentity!, lineId: "other-line", entryId: "other-entry" },
    };
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: [wrongLine],
        phase: "final",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({ entries: [{ status: "unresolved", itemIds: [] }], ignoredItemIds: [] });
  });

  it("marks duplicate authoritative matches ambiguous", () => {
    const grant = titanGrant();
    const identity = {
      version: 1 as const,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      lineId: "line-1",
      entryId: "entry-1",
      plannedItemId: "planned-item-1",
      plannedContainerId: null,
      plannedGrantId: grant.grantId,
      stackingIntent: "separate" as const,
    };
    const first = observed("weapon-a", grant.expected.sourceUuid, "weapon", null, identity);
    const second = observed("weapon-b", grant.expected.sourceUuid, "weapon", null, {
      ...identity,
      entryId: "entry-2",
      plannedItemId: "planned-item-2",
    });
    expect(
      reconcilePlannedClassGrants({
        plan: [grant],
        actorItems: [first, second],
        phase: "final",
        draftId: "draft-1",
        batchId: "batch-1",
      })
    ).toMatchObject({
      entries: [{ status: "ambiguous", itemIds: ["weapon-a", "weapon-b"] }],
      ambiguousGrantIds: [grant.grantId],
    });
  });

  it("normalizes a stable grant envelope and rejects incompatible profile facts", () => {
    const grant = formulaGrant();
    expect(normalizePlannedClassGrant(structuredClone(grant))).toEqual(grant);
    expect(normalizePlannedClassGrant({ ...grant, materializer: "wayfinder-acquisition" })).toBeNull();
  });

  it("rejects an orphan or extra-parent native chain even when every source UUID matches", () => {
    const grant = formulaGrant();
    const base = [
      observed("book", grant.expected.sourceUuid, "equipment", "formula"),
      observed("formula", grant.nativeGrantChainSourceUuids[0]!, "feat", "alchemy"),
      observed("alchemy", grant.nativeGrantChainSourceUuids[1]!, "feat", "class"),
    ];
    const orphan = reconcilePlannedClassGrants({
      plan: [grant],
      actorItems: base,
      phase: "final",
      draftId: "draft-1",
      batchId: "batch-1",
    });
    expect(orphan.entries[0]?.status).toBe("unresolved");

    const extraParent = reconcilePlannedClassGrants({
      plan: [grant],
      actorItems: [
        ...base,
        observed("class", grant.origin.sourceUuid, "class", "extra", null, grant.origin.sourceSlotId),
        observed("extra", "Compendium.pf2e.Item.extra", "feat", null),
      ],
      phase: "final",
      draftId: "draft-1",
      batchId: "batch-1",
    });
    expect(extraParent.entries[0]?.status).toBe("unresolved");
  });

  it("issues transient actor-bound plans that serialized lookalikes cannot forge", () => {
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [formulaGrant()],
    });
    expect(plan.subject.actorId).toBe("actor-1");
    expect(isPreparedClassGrantPlan(plan)).toBe(true);
    expect(isPreparedClassGrantPlan(structuredClone(plan))).toBe(false);
    expect(
      isClassGrantReconciliationConsistentForPlan(
        {
          version: 1,
          draftId: "draft-1",
          batchId: "batch-1",
          phase: "final",
          entries: [{ grantId: plan.grants[0]!.grantId, status: "pending", itemIds: [] }],
          ignoredItemIds: [],
          unresolvedGrantIds: [],
          ambiguousGrantIds: [],
        },
        plan
      )
    ).toBe(false);
  });
});

describe("Titan Mauler candidate", () => {
  it("enforces the exact pre-size Price, size, source, rarity, and item boundary", () => {
    expect(evaluateTitanMaulerCandidate(titanCandidate())).toEqual({
      ok: true,
      targetSize: "large",
      resaleCopper: 0,
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ basePriceCopper: 901 }))).toMatchObject({
      ok: false,
      code: "price-invalid",
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ basePriceCopper: null }))).toMatchObject({
      ok: false,
      code: "price-invalid",
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ targetSize: "medium" }))).toMatchObject({
      ok: false,
      code: "size-invalid",
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ sourceAllowed: false }))).toMatchObject({
      ok: false,
      code: "source-not-allowed",
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ rarity: "uncommon" }))).toMatchObject({
      ok: false,
      code: "rarity-or-access-invalid",
    });
    expect(
      evaluateTitanMaulerCandidate(titanCandidate({ rarity: "uncommon", characterAccessRef: "feature:access" }))
    ).toMatchObject({ ok: true });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ weaponCategory: "unarmed" }))).toMatchObject({
      ok: false,
      code: "unarmed-weapon",
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ weaponCategory: null }))).toMatchObject({
      ok: false,
      code: "not-a-weapon",
    });
    expect(evaluateTitanMaulerCandidate(titanCandidate({ quantity: 2 }))).toMatchObject({
      ok: false,
      code: "line-shape-invalid",
    });
  });

  it.each([
    ["tiny", "small"],
    ["small", "large"],
    ["medium", "large"],
    ["large", "huge"],
    ["huge", "gargantuan"],
  ] as const)("requires %s actors to choose a %s weapon", (actorSize, targetSize) => {
    expect(evaluateTitanMaulerCandidate(titanCandidate({ actorSize, targetSize }))).toMatchObject({ ok: true });
  });

  it("cannot grant a weapon larger than Gargantuan", () => {
    expect(
      evaluateTitanMaulerCandidate(titanCandidate({ actorSize: "gargantuan", targetSize: "gargantuan" }))
    ).toMatchObject({
      ok: false,
      code: "size-invalid",
    });
  });
});

function formulaGrant(): PlannedClassGrantV1 {
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

function titanGrant(): PlannedClassGrantV1 {
  const candidate = titanCandidate();
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
      documentFingerprint: candidate.documentFingerprint,
      lineId: candidate.lineId,
      lineDocumentFingerprint: candidate.lineDocumentFingerprint,
      linePriceFingerprint: candidate.linePriceFingerprint,
      policyFingerprint: candidate.policyFingerprint,
      actorSize: candidate.actorSize,
      targetSize: candidate.targetSize,
      basePriceCopper: candidate.basePriceCopper!,
      weaponCategory: candidate.weaponCategory!,
      rangeIncrement: candidate.rangeIncrement,
      rarity: candidate.rarity,
      characterAccessRef: candidate.characterAccessRef,
      sourceAllowed: true,
      quantity: 1,
      permanence: "permanent",
      componentKind: "baseline-item",
    },
    nativeGrantChainSourceUuids: [],
  });
}

function investigatorGrant(): PlannedClassGrantV1 {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:investigator-formula-book:class-branch-methodology-level-1",
    profileId: "investigator-alchemical-sciences-formula-book",
    origin: { sourceSlotId: "class-branch-methodology-level-1", sourceUuid: u.alchemicalSciences },
    granterSourceUuid: u.alchemicalSciences,
    expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.alchemicalSciences, u.methodologyFeature, u.investigatorClass],
  });
}

function dwarfGrant(): PlannedClassGrantV1 {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
    profileId: "dwarf-clan-dagger",
    origin: { sourceSlotId: "ancestry-level-1", sourceUuid: u.dwarfAncestry },
    granterSourceUuid: u.clanDaggerFeature,
    expected: { sourceUuid: u.clanDaggerItem, quantity: 1, itemType: "weapon" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.clanDaggerFeature, u.dwarfAncestry],
  });
}

function sarangayGrant(): PlannedClassGrantV1 {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
    profileId: "sarangay-head-gem",
    origin: { sourceSlotId: "ancestry-level-1", sourceUuid: u.sarangayAncestry },
    granterSourceUuid: u.headGemFeature,
    expected: { sourceUuid: u.headGemItem, quantity: 1, itemType: "equipment" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.headGemFeature, u.sarangayAncestry],
  });
}

function titanCandidate(overrides: Partial<TitanMaulerCandidate> = {}): TitanMaulerCandidate {
  return {
    sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
    itemType: "weapon",
    weaponCategory: "martial",
    rangeIncrement: null,
    rarity: "common",
    characterAccessRef: null,
    sourceAllowed: true,
    basePriceCopper: 900,
    actorSize: "medium",
    targetSize: "large",
    quantity: 1,
    permanence: "permanent",
    componentKind: "baseline-item",
    documentFingerprint: "weapon-document-1",
    lineId: "line-1",
    lineDocumentFingerprint: "weapon-document-line-1",
    linePriceFingerprint: "weapon-price-line-1",
    policyFingerprint: "equipment-policy-1",
    ...overrides,
  };
}

function observed(
  itemId: string,
  sourceUuid: string,
  itemType: string,
  grantedByItemId: string | null,
  acquisitionIdentity: ObservedClassGrantItem["acquisitionIdentity"] = null,
  wayfinderSlotId: string | null = null,
  locationItemId: string | null = null
): ObservedClassGrantItem {
  return {
    itemId,
    sourceUuid,
    itemType,
    quantity: 1,
    grantedByItemId,
    locationItemId,
    wayfinderSlotId,
    acquisitionIdentity,
  };
}
