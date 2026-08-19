import { describe, expect, it } from "vitest";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionCompletion,
  evaluateAcquisitionLedger as evaluateAcquisitionLedgerRaw,
  resolveAcquisitionPrice,
  reviewPurchaseLedger,
  reviewRetainAll,
} from "../src/wayfinder/domain/acquisition-ledger";
import type {
  AcquisitionDraftState,
  AcquisitionFunding,
  AcquisitionLineDraft,
  AcquisitionPriceInput,
  AcquisitionRecipeSelection,
} from "../src/wayfinder/domain/acquisition-types";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  type PlannedClassGrantV1,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import { buildEquipmentPolicyJudgmentFactsFingerprint } from "../src/wayfinder/domain/equipment-policy";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

describe("acquisition price resolution", () => {
  it("normalizes mixed denominations and distinguishes explicit zero from missing Price", () => {
    expect(price({ basePrice: { kind: "priced", value: { gp: 1, sp: 5, cp: 2 } } }).linePriceCopper).toBe(152);
    expect(price({ basePrice: { kind: "priced", value: {} } }).linePriceCopper).toBe(0);
    expect(createAcquisitionPriceSnapshot(priceInput({ basePrice: { kind: "missing" } }))).toMatchObject({
      ok: false,
      code: "price-missing",
    });
    expect(createAcquisitionPriceSnapshot(priceInput({ basePrice: { kind: "unparseable" } }))).toMatchObject({
      ok: false,
      code: "price-unparseable",
    });
  });

  it("applies price.per to source and requested quantity using PF2E copper rounding", () => {
    const stack = price({
      basePrice: { kind: "priced", value: { sp: 1 } },
      pricePer: 10,
      sourceQuantity: 10,
      requestedQuantity: 2,
    });
    expect(stack.materializedQuantity).toBe(20);
    expect(stack.linePriceCopper).toBe(20);

    const combined = price({
      basePrice: { kind: "priced", value: { cp: 1 } },
      configurationPriceCopper: 1,
      pricePer: 2,
    });
    expect(resolveAcquisitionPrice(combined)).toEqual({
      ok: true,
      value: {
        materializedQuantity: 1,
        unitPriceCopper: 2,
        baselineCopper: 1,
        supplementalCopper: 0,
        totalCopper: 1,
      },
    });
  });

  it("applies size only to ordinary size-sensitive base prices", () => {
    expect(price({ size: "large" }).linePriceCopper).toBe(200);
    expect(price({ size: "huge" }).linePriceCopper).toBe(400);
    expect(price({ size: "gargantuan" }).linePriceCopper).toBe(800);
    expect(price({ size: "gargantuan", sizeSensitive: false }).linePriceCopper).toBe(100);
    expect(
      price({
        size: "gargantuan",
        preciousMaterial: true,
        adjustedBulkPriceCopper: 275,
        configurationPriceCopper: 25,
      }).linePriceCopper
    ).toBe(300);
  });

  it("rejects stale and unsafe price snapshots", () => {
    const snapshot = price();
    expect(resolveAcquisitionPrice({ ...snapshot, linePriceCopper: 99 })).toMatchObject({
      ok: false,
      code: "price-invalid",
    });
    expect(
      createAcquisitionPriceSnapshot(
        priceInput({ basePrice: { kind: "priced", value: { pp: Number.MAX_SAFE_INTEGER } } })
      )
    ).toMatchObject({ ok: false, code: "unsafe-arithmetic" });
    expect(createAcquisitionPriceSnapshot(priceInput({ sourceQuantity: -1, requestedQuantity: -1 }))).toMatchObject({
      ok: false,
      code: "quantity-invalid",
    });
  });
});

describe("acquisition ledger", () => {
  it("requires an economic baseline before review or completion", () => {
    const draft = mutable(acquisitionDraft({ lines: [line()] }));
    draft.baseline = null;
    const ledger = evaluateAcquisitionLedger(draft);
    expect(ledger).toMatchObject({ valid: false, materialFacts: null });
    expect(ledger.blockers).toContainEqual(expect.objectContaining({ code: "baseline-missing" }));
    expect(() => reviewPurchaseLedger(draft, ledger, reviewer())).toThrow(/invalid acquisition ledger/i);
  });

  it("requires acknowledgment before an explicit handoff is complete", () => {
    const draft = mutable(acquisitionDraft({ lines: [] }));
    draft.disposition = {
      kind: "handoff",
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: draft.baseline!.fingerprint,
        reasons: [{ code: "nonzero-currency", copper: 1 }],
      },
      acknowledgedByUserId: null,
      acknowledgedAt: null,
    };
    expect(evaluateAcquisitionCompletion(draft, evaluateAcquisitionLedger(draft))).toMatchObject({
      complete: false,
      reasons: ["handoff-acknowledgment-required"],
    });
    draft.disposition.acknowledgedByUserId = "owner-1";
    draft.disposition.acknowledgedAt = "2026-08-18T21:00:00.000Z";
    expect(evaluateAcquisitionCompletion(draft, evaluateAcquisitionLedger(draft))).toMatchObject({
      complete: true,
      reasons: [],
    });
  });

  it("assigns allowances deterministically and charges only configuration supplements", () => {
    const draft = acquisitionDraft({
      lines: [
        line({
          lineId: "lower",
          itemLevel: 2,
          funding: { lane: "allowance", assignment: { mode: "automatic" } },
          configurationPriceCopper: 15,
        }),
        line({
          lineId: "higher",
          itemLevel: 4,
          funding: { lane: "allowance", assignment: { mode: "automatic" } },
          configurationPriceCopper: 25,
        }),
      ],
    });
    const ledger = evaluateAcquisitionLedger(draft);

    expect(ledger.valid).toBe(true);
    expect(ledger.lines.map((entry) => [entry.lineId, entry.resolvedAllowanceId])).toEqual([
      ["lower", "allowance-3"],
      ["higher", "allowance-4"],
    ]);
    expect(ledger.spentCopper).toBe(40);
    expect(ledger.remainingCopper).toBe(960);
  });

  it("rejects consumable and supplement allowance assignments", () => {
    for (const candidate of [
      line({
        permanence: "consumable",
        funding: { lane: "allowance", assignment: { mode: "automatic" } },
      }),
      line({
        componentKind: "property-rune",
        funding: { lane: "allowance", assignment: { mode: "automatic" } },
      }),
    ]) {
      expect(evaluateAcquisitionLedger(acquisitionDraft({ lines: [candidate] })).blockers).toContainEqual(
        expect.objectContaining({ code: "recipe-lane-invalid", lineId: candidate.lineId })
      );
    }
  });

  it("rejects reused, missing, and too-low player allowance assignments", () => {
    const reused = acquisitionDraft({
      lines: [
        line({
          lineId: "one",
          funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "allowance-3" } },
        }),
        line({
          lineId: "two",
          funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "allowance-3" } },
        }),
      ],
    });
    expect(evaluateAcquisitionLedger(reused).blockers.map((entry) => entry.code)).toContain("allowance-reused");

    const missing = acquisitionDraft({
      lines: [line({ funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "gone" } } })],
    });
    expect(evaluateAcquisitionLedger(missing).blockers.map((entry) => entry.code)).toContain("allowance-missing");

    const tooLow = acquisitionDraft({
      lines: [
        line({
          itemLevel: 4,
          funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "allowance-3" } },
        }),
      ],
    });
    expect(evaluateAcquisitionLedger(tooLow).blockers.map((entry) => entry.code)).toContain("allowance-too-low");
  });

  it("keeps duplicate source UUIDs as distinct logical allowance lines", () => {
    const sharedUuid = "Compendium.example.equipment.Item.same";
    const draft = acquisitionDraft({
      lines: [
        line({
          lineId: "one",
          sourceUuid: sharedUuid,
          itemLevel: 3,
          funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "allowance-3" } },
        }),
        line({
          lineId: "two",
          sourceUuid: sharedUuid,
          itemLevel: 4,
          funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "allowance-4" } },
        }),
      ],
    });
    const ledger = evaluateAcquisitionLedger(draft);
    expect(ledger.valid).toBe(true);
    expect(ledger.lines).toHaveLength(2);
  });

  it("requires complete planned provenance for zero-cost class grants", () => {
    const valid = acquisitionDraft({
      plannedClassGrants: [fixedGrant()],
      lines: [
        line({
          sourceUuid: fixedGrant().expected.sourceUuid,
          funding: {
            lane: "class-grant",
            grant: { plannedGrantId: fixedGrant().grantId },
          },
        }),
      ],
    });
    expect(evaluateAcquisitionLedger(valid)).toMatchObject({ valid: true, spentCopper: 0 });

    const fixedOutsideCatalogue = mutable(structuredClone(valid));
    fixedOutsideCatalogue.lines[0]!.policyDecision.packId = "blocked.equipment";
    fixedOutsideCatalogue.lines[0]!.policyDecision.eligible = false;
    expect(evaluateAcquisitionLedger(fixedOutsideCatalogue)).toMatchObject({ valid: true, spentCopper: 0 });

    const invalidQuantity = mutable(structuredClone(valid));
    invalidQuantity.lines[0]!.price = price({ requestedQuantity: 2 });
    expect(() => evaluateAcquisitionLedger(invalidQuantity)).not.toThrow();
    expect(evaluateAcquisitionLedger(invalidQuantity).blockers).toContainEqual(
      expect.objectContaining({ code: "class-grant-invalid" })
    );

    const malformed = structuredClone(valid) as unknown as Record<string, unknown>;
    const malformedLine = (malformed.lines as Array<Record<string, unknown>>)[0];
    const malformedFunding = malformedLine?.funding as Record<string, unknown>;
    const malformedGrant = malformedFunding.grant as Record<string, unknown>;
    delete malformedGrant.plannedGrantId;
    const normalized = JSON.parse(JSON.stringify(malformed)) as AcquisitionDraftState;
    expect(() => evaluateAcquisitionLedger(normalized)).not.toThrow();
    expect(evaluateAcquisitionLedger(normalized).blockers).toContainEqual(
      expect.objectContaining({ code: "class-grant-invalid" })
    );

    const forged = acquisitionDraft({
      lines: [line({ funding: { lane: "class-grant", grant: { plannedGrantId: "missing" } } })],
    });
    expect(evaluateAcquisitionLedger(forged).blockers).toContainEqual(
      expect.objectContaining({ code: "class-grant-invalid" })
    );

    const reused = acquisitionDraft({
      plannedClassGrants: [fixedGrant()],
      lines: [
        line({
          sourceUuid: fixedGrant().expected.sourceUuid,
          lineId: "line-a",
          funding: { lane: "class-grant", grant: { plannedGrantId: fixedGrant().grantId } },
        }),
        line({
          sourceUuid: fixedGrant().expected.sourceUuid,
          lineId: "line-b",
          funding: { lane: "class-grant", grant: { plannedGrantId: fixedGrant().grantId } },
        }),
      ],
    });
    expect(evaluateAcquisitionLedger(reused).blockers).toContainEqual(
      expect.objectContaining({ code: "class-grant-invalid", lineId: "line-b" })
    );

    const titan = acquisitionDraft({
      plannedClassGrants: [titanGrant()],
      lines: [
        line({
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
          funding: { lane: "class-grant", grant: { plannedGrantId: titanGrant().grantId } },
        }),
      ],
    });
    mutable(titan).lines[0]!.policyDecision.packId = "blocked.equipment";
    mutable(titan).lines[0]!.policyDecision.eligible = false;
    expect(evaluateAcquisitionLedger(titan).blockers).toContainEqual(
      expect.objectContaining({ code: "item-ineligible" })
    );
  });

  it("never treats the serialized grant description as current authority", () => {
    const grant = titanGrant();
    const draft = acquisitionDraft({
      plannedClassGrants: [grant],
      lines: [
        line({
          sourceUuid: grant.expected.sourceUuid,
          funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
        }),
      ],
    });
    const prepared = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: draft.draftId,
      batchId: draft.batchId,
      targetLevel: draft.targetLevel,
      grants: [grant],
    });
    expect(evaluateAcquisitionLedgerRaw(draft).blockers).toContainEqual(
      expect.objectContaining({ code: "class-grant-invalid" })
    );

    const forged = mutable(structuredClone(draft));
    forged.plannedClassGrants[0]!.expected.sourceUuid = "Compendium.pf2e.equipment-srd.Item.expensive";
    forged.lines[0]!.sourceUuid = "Compendium.pf2e.equipment-srd.Item.expensive";
    expect(evaluateAcquisitionLedgerRaw(forged, prepared).blockers).toContainEqual(
      expect.objectContaining({ code: "class-grant-invalid" })
    );
  });

  it("requires explicit review and permits retain-all with planned zero-spend grants", () => {
    const grantOnly = acquisitionDraft({
      plannedClassGrants: [fixedGrant()],
      lines: [
        line({
          sourceUuid: fixedGrant().expected.sourceUuid,
          funding: {
            lane: "class-grant",
            grant: { plannedGrantId: fixedGrant().grantId },
          },
        }),
      ],
    });
    const ledger = evaluateAcquisitionLedger(grantOnly);
    expect(evaluateAcquisitionCompletion(grantOnly, ledger)).toMatchObject({ complete: false });
    expect(() => reviewPurchaseLedger(grantOnly, ledger, reviewer())).toThrow(/retain-all/i);
    const reviewed = reviewRetainAll(grantOnly, ledger, reviewer());
    expect(evaluateAcquisitionCompletion(reviewed, evaluateAcquisitionLedger(reviewed))).toEqual({
      complete: true,
      disposition: "retain-all",
      reasons: [],
    });
  });

  it("enforces recipe caps, current policy eligibility, and the currency budget", () => {
    const atLevelPermanent = acquisitionDraft({ lines: [line({ itemLevel: 5, funding: { lane: "currency" } })] });
    expect(evaluateAcquisitionLedger(atLevelPermanent).blockers.map((entry) => entry.code)).toContain(
      "item-ineligible"
    );

    const lumpRecipe = { kind: "lump-sum" } as const;
    const atLevelLump = acquisitionDraft({
      recipe: lumpRecipe,
      lines: [line({ itemLevel: 5, funding: { lane: "currency" } })],
    });
    expect(evaluateAcquisitionLedger(atLevelLump).blockers.map((entry) => entry.code)).toContain("item-ineligible");

    const policyDenied = mutable(acquisitionDraft({ lines: [line()] }));
    policyDenied.lines[0]!.policyDecision.eligible = false;
    expect(evaluateAcquisitionLedger(policyDenied).blockers).toContainEqual(
      expect.objectContaining({ code: "policy-mismatch" })
    );

    const overBudget = acquisitionDraft({
      lines: [line({ configurationPriceCopper: 1001, funding: { lane: "currency" } })],
    });
    expect(evaluateAcquisitionLedger(overBudget).blockers).toContainEqual(
      expect.objectContaining({ code: "over-budget", lineId: null })
    );
  });

  it("rejects forged persisted policy authority before using its budget or item decisions", () => {
    const custom = mutable(acquisitionDraft({ lines: [line()] }));
    custom.recipe = { kind: "custom-lump-sum", judgmentRef: "fake", amountCopper: 999_999 };
    custom.policySnapshot!.material.resolvedRecipe = custom.recipe;
    custom.policySnapshot!.material.budgetCopper = 999_999;
    expect(evaluateAcquisitionLedger(custom).blockers).toContainEqual(
      expect.objectContaining({ code: "policy-mismatch" })
    );

    const item = mutable(acquisitionDraft({ lines: [line()] }));
    item.lines[0]!.policyDecision.rarity = "unique";
    item.lines[0]!.policyDecision.eligible = true;
    expect(evaluateAcquisitionLedger(item).blockers).toContainEqual(
      expect.objectContaining({ code: "policy-mismatch" })
    );
  });

  it("ignores diagnostic policy fingerprint churn but invalidates material policy changes", () => {
    const original = acquisitionDraft({ lines: [line({ funding: { lane: "currency" } })] });
    const reviewed = reviewPurchaseLedger(original, evaluateAcquisitionLedger(original), reviewer());
    const diagnosticOnly = {
      ...reviewed,
      policySnapshot: { ...reviewed.policySnapshot!, fingerprint: "diagnostic-only-change" },
    };
    expect(evaluateAcquisitionCompletion(diagnosticOnly, evaluateAcquisitionLedger(diagnosticOnly)).complete).toBe(
      true
    );

    const unusedRecipePolicyChange = mutable(structuredClone(reviewed));
    unusedRecipePolicyChange.policySnapshot!.material.worldRecipePolicy = {
      enabledRecipes: ["permanent-items"],
      defaultRecipe: "permanent-items",
    };
    expect(
      evaluateAcquisitionCompletion(unusedRecipePolicyChange, evaluateAcquisitionLedger(unusedRecipePolicyChange))
        .complete
    ).toBe(true);

    const materialChange = mutable(structuredClone(reviewed));
    materialChange.lines[0]!.policyDecision.rarityBasis = "different-current-basis";
    expect(evaluateAcquisitionCompletion(materialChange, evaluateAcquisitionLedger(materialChange))).toMatchObject({
      complete: false,
      reasons: ["policy"],
    });

    const authorityChange = mutable(structuredClone(reviewed));
    authorityChange.policySnapshot!.material.authorityPolicy.apply = "gm-review";
    expect(evaluateAcquisitionCompletion(authorityChange, evaluateAcquisitionLedger(authorityChange))).toMatchObject({
      complete: false,
      reasons: ["policy"],
    });

    const abpChange = mutable(structuredClone(reviewed));
    abpChange.policySnapshot!.material.abp = {
      enabled: true,
      mode: "ABPRulesAsWritten",
      actorOverrideDisabled: false,
    };
    expect(evaluateAcquisitionCompletion(abpChange, evaluateAcquisitionLedger(abpChange))).toMatchObject({
      complete: false,
      reasons: ["policy"],
    });
  });

  it("invalidates a reviewed custom amount or judgment reference change", () => {
    const recipe = { kind: "custom-lump-sum", judgmentRef: "judgment-1", amountCopper: 1200 } as const;
    const original = mutable(acquisitionDraft({ recipe, lines: [line()] }));
    original.policySnapshot!.material.budgetCopper = 1200;
    original.policySnapshot!.material.gmJudgments = [customJudgment("judgment-1", 1200)];
    const reviewed = reviewPurchaseLedger(original, evaluateAcquisitionLedger(original), reviewer());
    const changed = mutable(structuredClone(reviewed));
    changed.recipe = { kind: "custom-lump-sum", judgmentRef: "judgment-2", amountCopper: 1200 };
    changed.policySnapshot!.material.resolvedRecipe = changed.recipe;
    changed.policySnapshot!.material.gmJudgments = [customJudgment("judgment-2", 1200)];
    expect(evaluateAcquisitionCompletion(changed, evaluateAcquisitionLedger(changed))).toMatchObject({
      complete: false,
      reasons: expect.arrayContaining(["recipe"]),
    });
  });

  it("invalidates actor baseline and item-level changes after review", () => {
    const original = acquisitionDraft({ lines: [line({ funding: { lane: "currency" } })] });
    const reviewed = reviewPurchaseLedger(original, evaluateAcquisitionLedger(original), reviewer());

    const changedBaseline = mutable(structuredClone(reviewed));
    changedBaseline.baseline = mutable(emptyBaseline("actor-2"));
    expect(evaluateAcquisitionCompletion(changedBaseline, evaluateAcquisitionLedger(changedBaseline))).toMatchObject({
      complete: false,
      reasons: ["policy-mismatch"],
    });

    const changedLevel = mutable(structuredClone(reviewed));
    changedLevel.lines[0]!.itemLevel = 2;
    expect(evaluateAcquisitionCompletion(changedLevel, evaluateAcquisitionLedger(changedLevel))).toMatchObject({
      complete: false,
      reasons: ["document"],
    });

    const changedStacking = mutable(structuredClone(reviewed));
    changedStacking.lines[0]!.stackingIntent = "separate";
    expect(evaluateAcquisitionCompletion(changedStacking, evaluateAcquisitionLedger(changedStacking))).toMatchObject({
      complete: false,
      reasons: ["document"],
    });
  });

  it("isolates review evidence from the retained ledger result", () => {
    const original = acquisitionDraft({ lines: [line()] });
    const ledger = evaluateAcquisitionLedger(original);
    const reviewed = reviewPurchaseLedger(original, ledger, reviewer());
    const capturedBasis =
      reviewed.disposition.kind === "purchase-ledger"
        ? reviewed.disposition.review.materialFacts.lines[0]!.policyDecision.rarityBasis
        : null;

    mutable(ledger.materialFacts!).lines[0]!.policyDecision.rarityBasis = "mutated-through-ledger";
    expect(reviewed.disposition.kind).toBe("purchase-ledger");
    if (reviewed.disposition.kind === "purchase-ledger") {
      expect(reviewed.disposition.review.materialFacts.lines[0]!.policyDecision.rarityBasis).toBe(capturedBasis);
    }
  });
});

function acquisitionDraft(options: {
  lines?: AcquisitionLineDraft[];
  recipe?: AcquisitionRecipeSelection;
  plannedClassGrants?: PlannedClassGrantV1[];
}): AcquisitionDraftState {
  const recipe = options.recipe ?? { kind: "permanent-items" };
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
      fingerprint: "diagnostic-policy-fingerprint",
      material: {
        subject: { actorId: "actor-1", draftId: "draft-1", targetLevel: 5 },
        numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
        semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
        resolvedRecipe: recipe,
        budgetCopper: 1000,
        allowances: [
          { allowanceId: "allowance-3", itemLevel: 3 },
          { allowanceId: "allowance-4", itemLevel: 4 },
        ],
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
    plannedClassGrants: options.plannedClassGrants ?? [],
    classGrantReconciliations: [],
    lines: options.lines ?? [],
  };
}

function fixedGrant(): PlannedClassGrantV1 {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:alchemist-formula-book:class-level-1",
    profileId: "alchemist-formula-book",
    origin: {
      sourceSlotId: "class-level-1",
      sourceUuid: u.alchemistClass,
    },
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

function titanGrant(): PlannedClassGrantV1 {
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
      documentFingerprint: "document-1",
      lineId: "line-1",
      lineDocumentFingerprint: "document-1",
      linePriceFingerprint: "price-0",
      policyFingerprint: "diagnostic-policy-fingerprint",
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

function evaluateAcquisitionLedger(draft: AcquisitionDraftState) {
  const actorId = draft.policySnapshot?.material.subject.actorId ?? "actor-1";
  const prepared = createPreparedClassGrantPlan({
    actorId,
    draftId: draft.draftId,
    batchId: draft.batchId,
    targetLevel: draft.targetLevel,
    grants: draft.plannedClassGrants,
  });
  return evaluateAcquisitionLedgerRaw(draft, prepared);
}

function emptyBaseline(actorId: string) {
  return createEconomicBaseline({
    actorId,
    capturedAt: "2026-08-18T20:00:00.000Z",
    currencyCopper: 0,
    physicalItems: [],
  });
}

function line(
  options: {
    lineId?: string;
    sourceUuid?: string;
    itemLevel?: number;
    permanence?: "consumable" | "permanent";
    componentKind?: "baseline-item" | "property-rune" | "precious-material";
    funding?: AcquisitionFunding;
    configurationPriceCopper?: number;
  } = {}
): AcquisitionLineDraft {
  return {
    schemaVersion: 1,
    lineId: options.lineId ?? "line-1",
    sourceUuid: options.sourceUuid ?? "Compendium.pf2e.equipment-srd.Item.item",
    documentFingerprint: "document-1",
    priceFingerprint: `price-${options.configurationPriceCopper ?? 0}`,
    itemLevel: options.itemLevel ?? 1,
    permanence: options.permanence ?? "permanent",
    componentKind: options.componentKind ?? "baseline-item",
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
    funding: options.funding ?? { lane: "currency" },
    stackingIntent: "aggregate",
    price: price({ configurationPriceCopper: options.configurationPriceCopper ?? 0 }),
  };
}

function price(overrides: Partial<AcquisitionPriceInput> = {}) {
  const resolved = createAcquisitionPriceSnapshot(priceInput(overrides));
  if (resolved.ok === false) throw new Error(resolved.message);
  return resolved.value;
}

function priceInput(overrides: Partial<AcquisitionPriceInput> = {}): AcquisitionPriceInput {
  return {
    basePrice: { kind: "priced", value: { gp: 1 } },
    size: "medium",
    sizeSensitive: true,
    preciousMaterial: false,
    adjustedBulkPriceCopper: null,
    configurationPriceCopper: 0,
    pricePer: 1,
    sourceQuantity: 1,
    requestedQuantity: 1,
    ...overrides,
  };
}

function reviewer() {
  return { userId: "user-1", reviewedAt: "2026-08-18T23:00:00.000Z" };
}

function customJudgment(id: string, amountCopper: number) {
  return {
    id,
    kind: "custom-lump-sum" as const,
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 5,
    factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint({
      kind: "custom-lump-sum",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      amountCopper,
    }),
    authorUserId: "gm-1",
    authorName: "Game Master",
    recordedAt: "2026-08-18T23:00:00.000Z",
    reason: "Custom replacement budget",
  };
}

type DeepMutable<T> = T extends readonly (infer Entry)[]
  ? DeepMutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function mutable<T>(value: T): DeepMutable<T> {
  return value as DeepMutable<T>;
}
