import { createAcquisitionDraft } from "../../src/wayfinder/domain/acquisition-draft";
import { prepareAcquisitionIdentityPlan } from "../../src/wayfinder/domain/acquisition-identity";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionLedger,
  reviewPurchaseLedger,
} from "../../src/wayfinder/domain/acquisition-ledger";
import type {
  AcquisitionDraftState,
  AcquisitionLineDraft,
  AcquisitionPriceInput,
} from "../../src/wayfinder/domain/acquisition-types";
import { CHARACTER_WEALTH_POLICY_REF } from "../../src/wayfinder/domain/character-wealth-policy";
import {
  createPreparedClassGrantPlan,
  type PlannedClassGrantV1,
  reconcilePreparedClassGrants,
} from "../../src/wayfinder/domain/class-grant-reconciliation";
import {
  type CompletedObservedItemV1,
  createCompletedAcquisitionManifest,
} from "../../src/wayfinder/domain/completed-acquisition-manifest";
import { createEconomicBaseline } from "../../src/wayfinder/domain/economic-baseline";
import { SEMANTIC_WEALTH_POLICY_REF } from "../../src/wayfinder/domain/semantic-wealth-rule-ledger";

export function acquisitionFixture(
  options: {
    readonly lines?: readonly AcquisitionLineDraft[];
    readonly disposition?: "reviewed" | "unreviewed";
    readonly plannedClassGrants?: readonly PlannedClassGrantV1[];
  } = {}
) {
  const draft: AcquisitionDraftState = {
    ...createAcquisitionDraft({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 5,
      recipe: { kind: "permanent-items" },
    }),
    policySnapshot: {
      version: 1,
      fingerprint: "policy-diagnostic-1",
      material: {
        subject: { actorId: "actor-1", draftId: "draft-1", targetLevel: 5 },
        numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
        semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
        resolvedRecipe: { kind: "permanent-items" },
        budgetCopper: 1_000,
        allowances: [{ allowanceId: "allowance-5", itemLevel: 5 }],
        worldRecipePolicy: { enabledRecipes: ["lump-sum", "permanent-items"], defaultRecipe: "permanent-items" },
        sourcePolicy: {
          configuredPackFamilies: ["pf2e"],
          effectivePackIds: ["pf2e.equipment-srd"],
          enabledSourceSlugs: ["player-core"],
          knownSourceSlugs: ["player-core"],
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
    baseline: createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: "2026-08-18T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    }),
    plannedClassGrants: [...(options.plannedClassGrants ?? [])],
    classGrantReconciliations: [],
    lines: [...(options.lines ?? [acquisitionLine()])],
  };
  const classGrantPlan = createPreparedClassGrantPlan({
    actorId: "actor-1",
    draftId: draft.draftId,
    batchId: draft.batchId,
    targetLevel: draft.targetLevel,
    grants: draft.plannedClassGrants,
  });
  const ledger = evaluateAcquisitionLedger(draft, classGrantPlan);
  const reviewed =
    options.disposition === "unreviewed"
      ? draft
      : reviewPurchaseLedger(draft, ledger, {
          userId: "owner-1",
          reviewedAt: "2026-08-18T21:00:00.000Z",
        });
  return { draft: reviewed, ledger, classGrantPlan };
}

export function acquisitionLine(
  overrides: Partial<AcquisitionLineDraft> & { readonly requestedQuantity?: number } = {}
): AcquisitionLineDraft {
  const { requestedQuantity: requestedQuantityOverride, ...lineOverrides } = overrides;
  const requestedQuantity = requestedQuantityOverride ?? overrides.price?.requestedQuantity ?? 1;
  return {
    schemaVersion: 1,
    lineId: "line-1",
    sourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
    documentFingerprint: "document-1",
    priceFingerprint: "price-1",
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
    stackingIntent: "aggregate",
    price: acquisitionPrice({ requestedQuantity }),
    ...lineOverrides,
  };
}

export function acquisitionPrice(overrides: Partial<AcquisitionPriceInput> = {}) {
  const result = createAcquisitionPriceSnapshot({
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
  });
  if (result.ok === false) throw new Error(result.message);
  return result.value;
}

export async function completedAcquisitionFixture(
  options: { readonly fixture?: ReturnType<typeof acquisitionFixture>; readonly draft?: AcquisitionDraftState } = {}
) {
  const fixture = options.fixture ?? acquisitionFixture();
  const draft = options.draft ?? fixture.draft;
  const identityPlan = await prepareAcquisitionIdentityPlan({
    actorId: "actor-1",
    draft,
    ledger: fixture.ledger,
    classGrantPlan: fixture.classGrantPlan,
  });
  const finalClassGrantReconciliation = reconcilePreparedClassGrants({
    plan: fixture.classGrantPlan,
    actorItems: [],
    phase: "final",
  });
  const observedItems: CompletedObservedItemV1[] = identityPlan.entries.flatMap((entry, entryIndex) =>
    entry.plannedItems.map((planned) => ({
      plannedItemId: planned.plannedItemId,
      actualItemId: `actor-item-${entryIndex + 1}`,
      actualSourceUuid: planned.sourceUuid,
      actualQuantity: planned.quantity,
      plannedContainerId: planned.plannedContainerId,
      actualContainerId: null,
    }))
  );
  const handoff = draft.disposition.kind === "handoff";
  const currency = {
    preCopper: draft.baseline!.currencyCopper,
    budgetCopper: identityPlan.ledger.budgetCopper,
    spentCopper: handoff ? 0 : identityPlan.ledger.spentCopper,
    remainingCopper: handoff ? identityPlan.ledger.budgetCopper : identityPlan.ledger.remainingCopper,
    targetCopper: handoff
      ? draft.baseline!.currencyCopper
      : draft.baseline!.currencyCopper + identityPlan.ledger.remainingCopper,
    observedCopper: handoff
      ? draft.baseline!.currencyCopper
      : draft.baseline!.currencyCopper + identityPlan.ledger.remainingCopper,
  };
  const manifest = createCompletedAcquisitionManifest({
    actorId: "actor-1",
    draft,
    identityPlan,
    appliedBy: { userId: "owner-1", userName: "Owner" },
    appliedAt: "2026-08-18T22:00:00.000Z",
    currency,
    observedItems: handoff ? [] : observedItems,
    finalClassGrantReconciliation,
    environment: { foundryVersion: "14.366", pf2eVersion: "8.4.0", moduleVersion: "0.8.0" },
  });
  return { fixture, draft, identityPlan, finalClassGrantReconciliation, observedItems, manifest };
}
