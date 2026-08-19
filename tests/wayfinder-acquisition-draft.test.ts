import { describe, expect, it } from "vitest";
import { buildDraftPatch, createEmptyDraft, normalizeDraft } from "../src/draft-service";
import {
  acquisitionCurrencyConvergenceWitnessMatches,
  createAcquisitionCurrencyConvergenceWitness,
} from "../src/wayfinder/domain/acquisition-currency-convergence";
import {
  acknowledgeAcquisitionHandoff,
  createAcquisitionDraft,
  normalizeAcquisitionDraft,
  reconcileAcquisitionTargetLevel,
  recordAcquisitionCurrencyConvergenceWitness,
  recordClassGrantReconciliations,
  recordEconomicAdmission,
  recordPlannedClassGrants,
} from "../src/wayfinder/domain/acquisition-draft";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionCompletion,
  evaluateAcquisitionLedger,
  reviewRetainAll,
} from "../src/wayfinder/domain/acquisition-ledger";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../src/wayfinder/domain/acquisition-types";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import { CLASS_GRANT_PROFILE_UUIDS, createPlannedClassGrant } from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import { buildEquipmentPolicyJudgmentFactsFingerprint } from "../src/wayfinder/domain/equipment-policy";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

describe("acquisition draft", () => {
  it("creates stable identity only at the explicit initialization boundary", () => {
    expect(
      createAcquisitionDraft({
        draftId: "draft-1",
        batchId: "batch-1",
        manifestId: "manifest-1",
        targetLevel: 5,
        recipe: { kind: "lump-sum" },
      })
    ).toMatchObject({
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 5,
      currencyConvergenceWitness: null,
    });
    expect(
      normalizeAcquisitionDraft({ schemaVersion: 1, targetLevel: 5, recipe: { kind: "lump-sum" }, lines: [] })
    ).toBeNull();
  });

  it("persists only exact acquisition-bound currency convergence evidence", () => {
    const acquisition = completeDraft();
    const witness = currencyWitness(acquisition);
    const enriched = recordAcquisitionCurrencyConvergenceWitness(acquisition, witness);
    const parent = createEmptyDraft(5);
    parent.applyAttemptStepIds = ["starting-equipment-level-5"];
    parent.acquisition = enriched;

    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(parent))), 1);
    expect(reopened.acquisition?.currencyConvergenceWitness).toEqual(witness);
    expect(recordAcquisitionCurrencyConvergenceWitness(enriched, witness)).toBe(enriched);
    expect(
      acquisitionCurrencyConvergenceWitnessMatches(witness, {
        actorId: "actor-1",
        draftId: "draft-1",
        batchId: "batch-1",
        manifestId: "manifest-1",
        ledgerDigest: "different-ledger",
        baselineFingerprint: acquisition.baseline!.fingerprint,
        preCopper: 0,
        targetCopper: 1000,
      })
    ).toBe(false);

    const replacement = createAcquisitionCurrencyConvergenceWitness({
      ...witness,
      ledgerDigest: "different-ledger",
    });
    expect(() => recordAcquisitionCurrencyConvergenceWitness(enriched, replacement)).toThrow(/cannot be replaced/i);

    const corruptParent = structuredClone(parent) as unknown as Record<string, unknown>;
    const corruptAcquisition = corruptParent.acquisition as Record<string, unknown>;
    const corruptWitness = corruptAcquisition.currencyConvergenceWitness as Record<string, unknown>;
    corruptWitness.fingerprint = "forged-fingerprint";
    expect(normalizeDraft(corruptParent, 1)).toMatchObject({ acquisition: null, acquisitionCorrupt: true });
  });

  it("rejects the superseded acquisition schema instead of silently inventing recovery metadata", () => {
    expect(normalizeAcquisitionDraft({ ...completeDraft(), schemaVersion: 2 })).toBeNull();
  });

  it("preserves duplicate source UUID lines and every stable ID through save and reopen", () => {
    const acquisition = completeDraft();
    const parent = createEmptyDraft(5);
    parent.acquisition = acquisition;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(parent))), 1);

    expect(reopened.version).toBe(15);
    expect(reopened.acquisition?.draftId).toBe("draft-1");
    expect(reopened.acquisition?.batchId).toBe("batch-1");
    expect(reopened.acquisition?.lines.map((line) => line.lineId)).toEqual(["line-1", "line-2"]);
    expect(new Set(reopened.acquisition?.lines.map((line) => line.sourceUuid)).size).toBe(1);
  });

  it("preserves an exact reviewed retain-all decision through save and reopen", () => {
    const acquisition = normalizeAcquisitionDraft({ ...completeDraft(), lines: [] })!;
    const reviewed = reviewRetainAll(acquisition, evaluateAcquisitionLedger(acquisition), {
      userId: "owner-1",
      reviewedAt: "2026-08-18T20:30:00.000Z",
    });
    const parent = createEmptyDraft(5);
    parent.acquisition = reviewed;

    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(parent))), 1).acquisition;
    expect(reopened?.disposition).toMatchObject({
      kind: "retain-all",
      retainedCopper: 1000,
      review: {
        reviewedByUserId: "owner-1",
        reviewedAt: "2026-08-18T20:30:00.000Z",
        remainingCopper: 1000,
      },
    });
    expect(reopened?.disposition).toEqual(reviewed.disposition);
    expect(evaluateAcquisitionCompletion(reopened!, evaluateAcquisitionLedger(reopened!))).toEqual({
      complete: true,
      disposition: "retain-all",
      reasons: [],
    });
  });

  it.each([
    ["Alchemist", formulaGrant()],
    ["Investigator", investigatorGrant()],
    ["Titan Mauler", titanGrant()],
  ])("preserves the authoritative %s class-grant envelope through save and reopen", (_name, grant) => {
    const acquisition = recordPlannedClassGrants(completeDraft(), [grant]);
    const parent = createEmptyDraft(5);
    parent.acquisition = acquisition;

    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(parent))), 1);
    expect(reopened.acquisition?.plannedClassGrants).toEqual([grant]);
    expect(reopened.acquisition?.disposition).toMatchObject({ kind: "unreviewed", reasons: ["document"] });
  });

  it("persists only draft-bound class-grant recovery evidence", () => {
    const grant = formulaGrant();
    const acquisition = recordClassGrantReconciliations(recordPlannedClassGrants(completeDraft(), [grant]), [
      {
        version: 1,
        draftId: "draft-1",
        batchId: "batch-1",
        phase: "before-acquisition",
        entries: [{ grantId: grant.grantId, status: "pending", itemIds: [] }],
        ignoredItemIds: [],
        unresolvedGrantIds: [],
        ambiguousGrantIds: [],
      },
    ]);
    const parent = createEmptyDraft(5);
    parent.acquisition = acquisition;

    expect(normalizeDraft(structuredClone(parent), 1).acquisition?.classGrantReconciliations).toEqual(
      acquisition.classGrantReconciliations
    );
    expect(() =>
      recordClassGrantReconciliations(acquisition, [
        { ...acquisition.classGrantReconciliations[0]!, draftId: "another-draft" },
      ])
    ).toThrow(/does not match/i);
  });

  it("migrates old parent drafts to acquisition null", () => {
    expect(normalizeDraft({ version: 13, targetLevel: 3 }, 1)).toMatchObject({
      version: 15,
      targetLevel: 3,
      acquisition: null,
      acquisitionCorrupt: false,
    });
  });

  it("marks a malformed persisted acquisition instead of silently downgrading it to no acquisition", () => {
    const raw = createEmptyDraft(5) as unknown as Record<string, unknown>;
    raw.acquisition = { schemaVersion: 1, draftId: "draft-1", batchId: "batch-1" };

    expect(normalizeDraft(raw, 1)).toMatchObject({ acquisition: null, acquisitionCorrupt: true });
  });

  it("reconciles parent target drift without churning identity", () => {
    const original = completeDraft();
    const reconciled = reconcileAcquisitionTargetLevel(original, 6);
    expect(reconciled).toMatchObject({
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 6,
      disposition: { kind: "unreviewed", reasons: ["target-level"] },
      policySnapshot: null,
    });
    expect(reconciled.lines.map((line) => line.lineId)).toEqual(["line-1", "line-2"]);

    const parent = createEmptyDraft(6);
    parent.acquisition = original;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(parent)), 1);
    expect(reopened.acquisition).toMatchObject({
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 6,
      disposition: { kind: "unreviewed", reasons: ["target-level"] },
      policySnapshot: null,
    });
  });

  it("fails closed on duplicate line IDs and malformed funding", () => {
    const valid = completeDraft();
    const duplicate = structuredClone(valid) as unknown as Record<string, unknown>;
    const duplicateLines = duplicate.lines as Array<Record<string, unknown>>;
    duplicateLines[1]!.lineId = duplicateLines[0]!.lineId;
    expect(normalizeAcquisitionDraft(duplicate)).toBeNull();

    const malformed = structuredClone(valid) as unknown as Record<string, unknown>;
    const malformedFunding = ((malformed.lines as Array<Record<string, unknown>>)[0]!.funding ?? {}) as Record<
      string,
      unknown
    >;
    malformedFunding.assignment = { mode: "player" };
    expect(normalizeAcquisitionDraft(malformed)).toBeNull();
  });

  it("rejects policy authority replay across draft, actor, or target subjects", () => {
    const valid = completeDraft();
    expect(normalizeAcquisitionDraft(valid)).not.toBeNull();

    const otherDraft = structuredClone(valid) as unknown as Record<string, unknown>;
    otherDraft.draftId = "draft-2";
    expect(normalizeAcquisitionDraft(otherDraft)).toBeNull();

    const otherActor = structuredClone(valid) as unknown as Record<string, unknown>;
    const baseline = otherActor.baseline as Record<string, unknown>;
    baseline.actorId = "actor-2";
    expect(normalizeAcquisitionDraft(otherActor)).toBeNull();

    const otherTarget = structuredClone(valid) as unknown as Record<string, unknown>;
    otherTarget.targetLevel = 6;
    expect(normalizeAcquisitionDraft(otherTarget)).toBeNull();
  });

  it("preserves auditable GM start evidence and rejects a forged start kind", () => {
    const base = completeDraft();
    const facts = {
      kind: "higher-level-start" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      startKind: "replacement-character" as const,
    };
    const judgment = {
      id: "start-1",
      kind: facts.kind,
      actorId: facts.actorId,
      draftId: facts.draftId,
      targetLevel: facts.targetLevel,
      factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
      authorUserId: "gm-1",
      authorName: "Game Master",
      recordedAt: "2026-08-18T20:00:00.000Z",
      reason: "Approved replacement character",
    };
    const policy = base.policySnapshot!.material;
    const draft: AcquisitionDraftState = {
      ...base,
      policySnapshot: {
        ...base.policySnapshot!,
        material: {
          ...policy,
          authorityPolicy: { ...policy.authorityPolicy, higherLevelStart: "gm-confirmation" },
          higherLevelStartEvidence: { kind: "gm-confirmation", startKind: facts.startKind, judgment },
          gmJudgments: [judgment],
        },
      },
    };

    expect(normalizeAcquisitionDraft(draft)?.policySnapshot?.material.higherLevelStartEvidence).toEqual({
      kind: "gm-confirmation",
      startKind: "replacement-character",
      judgment,
    });
    const forged: AcquisitionDraftState = {
      ...draft,
      policySnapshot: {
        ...draft.policySnapshot!,
        material: {
          ...draft.policySnapshot!.material,
          higherLevelStartEvidence: { kind: "gm-confirmation", startKind: "new-campaign", judgment },
        },
      },
    };
    expect(normalizeAcquisitionDraft(forged)).toBeNull();
  });

  it("rejects persisted custom budgets, allowances, and eligibility without exact judgments", () => {
    const custom = structuredClone(completeDraft()) as unknown as Record<string, unknown>;
    custom.recipe = { kind: "custom-lump-sum", judgmentRef: "fake", amountCopper: 999_999 };
    const customPolicy = ((custom.policySnapshot as Record<string, unknown>).material ?? {}) as Record<string, unknown>;
    customPolicy.resolvedRecipe = custom.recipe;
    customPolicy.budgetCopper = 999_999;
    expect(normalizeAcquisitionDraft(custom)).toBeNull();

    const allowance = structuredClone(completeDraft()) as unknown as Record<string, unknown>;
    const allowancePolicy = ((allowance.policySnapshot as Record<string, unknown>).material ?? {}) as Record<
      string,
      unknown
    >;
    allowancePolicy.allowances = [{ allowanceId: "gm-extra:fake", itemLevel: 5 }];
    expect(normalizeAcquisitionDraft(allowance)).toBeNull();

    const item = structuredClone(completeDraft()) as unknown as Record<string, unknown>;
    const firstLine = (item.lines as Array<Record<string, unknown>>)[0]!;
    const decision = firstLine.policyDecision as Record<string, unknown>;
    decision.rarity = "unique";
    decision.eligible = true;
    expect(normalizeAcquisitionDraft(item)).toBeNull();
  });

  it("persists a structured economic handoff and requires explicit acknowledgment", () => {
    const draft = completeDraft();
    const foreign = createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: "2026-08-18T21:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [
        {
          itemId: "foreign-item",
          type: "equipment",
          sourceUuid: "Compendium.example.items.Item.foreign",
          quantity: 1,
          containerId: null,
          acquisitionIdentity: null,
        },
      ],
    });
    const admitted = recordEconomicAdmission(draft, {
      kind: "handoff",
      baseline: foreign,
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: foreign.fingerprint,
        reasons: [{ code: "foreign-physical-items", itemIds: ["foreign-item"] }],
      },
    });
    expect(admitted.disposition).toMatchObject({
      kind: "handoff",
      acknowledgedByUserId: null,
      acknowledgedAt: null,
    });
    expect(normalizeAcquisitionDraft(structuredClone(admitted))).toMatchObject({
      baseline: foreign,
      disposition: admitted.disposition,
    });

    expect(
      acknowledgeAcquisitionHandoff(admitted, {
        userId: "owner-1",
        acknowledgedAt: "2026-08-18T21:05:00.000Z",
      }).disposition
    ).toMatchObject({ kind: "handoff", acknowledgedByUserId: "owner-1" });

    expect(
      recordEconomicAdmission(admitted, {
        kind: "eligible-empty",
        baseline: foreign,
      }).disposition
    ).toEqual({ kind: "unreviewed", invalidatedFrom: null, reasons: [] });
  });
});

function completeDraft(): AcquisitionDraftState {
  const recipe = { kind: "permanent-items" } as const;
  return {
    ...createAcquisitionDraft({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 5,
      recipe,
    }),
    policySnapshot: {
      version: 1,
      fingerprint: "full-policy",
      material: {
        subject: { actorId: "actor-1", draftId: "draft-1", targetLevel: 5 },
        numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
        semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
        resolvedRecipe: recipe,
        budgetCopper: 1000,
        allowances: [{ allowanceId: "allowance-4", itemLevel: 4 }],
        worldRecipePolicy: { enabledRecipes: ["permanent-items", "lump-sum"], defaultRecipe: "permanent-items" },
        sourcePolicy: {
          configuredPackFamilies: ["pf2e"],
          effectivePackIds: ["pf2e.equipment-srd"],
          enabledSourceSlugs: [],
          knownSourceSlugs: [],
          showEmptySources: false,
          showUnknownSources: false,
        },
        rarityPolicy: { blanketCeiling: "common" },
        authorityPolicy: {
          recipeChoice: "actor-owner",
          higherLevelStart: "actor-owner-attestation",
          apply: "actor-owner",
        },
        higherLevelStartEvidence: {
          kind: "actor-owner-attestation",
          startKind: "replacement-character",
          actorId: "actor-1",
          draftId: "draft-1",
          targetLevel: 5,
          authorUserId: "owner-1",
          authorName: "Owner",
          recordedAt: "2026-08-18T20:00:00.000Z",
          reason: "Replacement character",
        },
        abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
        gmJudgments: [],
      },
    },
    baseline: emptyBaseline("actor-1"),
    lines: [line("line-1"), line("line-2")],
  };
}

function emptyBaseline(actorId: string) {
  return createEconomicBaseline({
    actorId,
    capturedAt: "2026-08-18T20:00:00.000Z",
    currencyCopper: 0,
    physicalItems: [],
  });
}

function currencyWitness(acquisition: AcquisitionDraftState) {
  return createAcquisitionCurrencyConvergenceWitness({
    actorId: "actor-1",
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    manifestId: acquisition.manifestId,
    ledgerDigest: "ledger-digest",
    baselineFingerprint: acquisition.baseline!.fingerprint,
    preCopper: acquisition.baseline!.currencyCopper,
    targetCopper: 1000,
    observedCopper: 1000,
    verifiedAt: "2026-08-18T20:05:00.000Z",
  });
}

function line(lineId: string): AcquisitionLineDraft {
  const price = createAcquisitionPriceSnapshot({
    basePrice: { kind: "priced", value: { gp: 1 } },
    size: "medium",
    sizeSensitive: true,
    preciousMaterial: false,
    adjustedBulkPriceCopper: null,
    configurationPriceCopper: 0,
    pricePer: 1,
    sourceQuantity: 1,
    requestedQuantity: 1,
  });
  if (price.ok === false) throw new Error(price.message);
  return {
    schemaVersion: 1,
    lineId,
    sourceUuid: "Compendium.example.equipment.Item.same",
    documentFingerprint: `document-${lineId}`,
    priceFingerprint: `price-${lineId}`,
    itemLevel: 1,
    permanence: "permanent",
    componentKind: "baseline-item",
    policyDecision: {
      eligible: true,
      packId: "pf2e.equipment-srd",
      publicationSlug: "player-core",
      rarity: "common",
      sourceBasis: "approved-pack",
      rarityBasis: "common",
      characterAccessRef: null,
      sourceExceptionJudgmentId: null,
      rarityExceptionJudgmentId: null,
      abpTreatment: "unchanged",
    },
    funding: { lane: "currency" },
    stackingIntent: "separate",
    price: price.value,
  };
}

function formulaGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:alchemist-formula-book:class-level-1",
    profileId: "alchemist-formula-book",
    origin: { sourceSlotId: "class-level-1", sourceUuid: u.alchemistClass },
    granterSourceUuid: u.formulaBookFeature,
    expected: {
      sourceUuid: u.formulaBookItem,
      quantity: 1,
      itemType: "equipment",
    },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.formulaBookFeature, u.alchemyFeature, u.alchemistClass],
  });
}

function investigatorGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:investigator-formula-book:class-branch-methodology-level-1",
    profileId: "investigator-alchemical-sciences-formula-book",
    origin: {
      sourceSlotId: "class-branch-methodology-level-1",
      sourceUuid: u.alchemicalSciences,
    },
    granterSourceUuid: u.alchemicalSciences,
    expected: {
      sourceUuid: u.formulaBookItem,
      quantity: 1,
      itemType: "equipment",
    },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.alchemicalSciences, u.methodologyFeature, u.investigatorClass],
  });
}

function titanGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:titan-mauler:class-branch-instinct-level-1",
    profileId: "giant-instinct-titan-mauler",
    origin: {
      sourceSlotId: "class-branch-instinct-level-1",
      sourceUuid: u.giantInstinct,
    },
    granterSourceUuid: u.giantInstinct,
    expected: {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
      quantity: 1,
      itemType: "weapon",
    },
    materializer: "wayfinder-acquisition",
    eligibilityKind: "catalogue-choice",
    resaleRule: "zero-until-rune-investment",
    eligibilityEvidence: {
      kind: "titan-mauler",
      documentFingerprint: "document-weapon",
      lineId: "line-1",
      lineDocumentFingerprint: "document-line-1",
      linePriceFingerprint: "price-line-1",
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
