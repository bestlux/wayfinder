import { describe, expect, it } from "vitest";
import { buildDraftPatch, createEmptyDraft, normalizeDraft } from "../src/draft-service";
import {
  createAcquisitionDraft,
  normalizeAcquisitionDraft,
  reconcileAcquisitionTargetLevel,
} from "../src/wayfinder/domain/acquisition-draft";
import { createAcquisitionPriceSnapshot } from "../src/wayfinder/domain/acquisition-ledger";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../src/wayfinder/domain/acquisition-types";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

describe("acquisition draft", () => {
  it("creates stable identity only at the explicit initialization boundary", () => {
    expect(
      createAcquisitionDraft({
        draftId: "draft-1",
        batchId: "batch-1",
        targetLevel: 5,
        recipe: { kind: "lump-sum" },
      })
    ).toMatchObject({ draftId: "draft-1", batchId: "batch-1", targetLevel: 5 });
    expect(
      normalizeAcquisitionDraft({ schemaVersion: 1, targetLevel: 5, recipe: { kind: "lump-sum" }, lines: [] })
    ).toBeNull();
  });

  it("preserves duplicate source UUID lines and every stable ID through save and reopen", () => {
    const acquisition = completeDraft();
    const parent = createEmptyDraft(5);
    parent.acquisition = acquisition;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(parent))), 1);

    expect(reopened.version).toBe(14);
    expect(reopened.acquisition?.draftId).toBe("draft-1");
    expect(reopened.acquisition?.batchId).toBe("batch-1");
    expect(reopened.acquisition?.lines.map((line) => line.lineId)).toEqual(["line-1", "line-2"]);
    expect(new Set(reopened.acquisition?.lines.map((line) => line.sourceUuid)).size).toBe(1);
  });

  it("migrates old parent drafts to acquisition null", () => {
    expect(normalizeDraft({ version: 13, targetLevel: 3 }, 1)).toMatchObject({
      version: 14,
      targetLevel: 3,
      acquisition: null,
    });
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
});

function completeDraft(): AcquisitionDraftState {
  const recipe = { kind: "permanent-items" } as const;
  return {
    ...createAcquisitionDraft({ draftId: "draft-1", batchId: "batch-1", targetLevel: 5, recipe }),
    policySnapshot: {
      version: 1,
      fingerprint: "full-policy",
      material: {
        numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
        semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
        resolvedRecipe: recipe,
        budgetCopper: 1000,
        allowances: [{ allowanceId: "allowance-4", itemLevel: 4 }],
        applyAuthorityBasis: "actor-owner",
      },
    },
    baseline: { version: 1, actorId: "actor-1", fingerprint: "empty" },
    lines: [line("line-1"), line("line-2")],
  };
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
      sourceBasis: "approved-pack",
      rarityBasis: "common",
      accessOrExceptionRef: null,
      abpTreatment: "unchanged",
    },
    funding: { lane: "currency" },
    stackingIntent: "separate",
    price: price.value,
  };
}
