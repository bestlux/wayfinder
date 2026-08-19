import type { CharacterWealthPolicyRef } from "./character-wealth-policy.js";
import type { EffectiveEquipmentPolicySnapshotV1 } from "./equipment-policy.js";
import type { SEMANTIC_WEALTH_POLICY_REF } from "./semantic-wealth-rule-ledger.js";

export type OfficialAcquisitionRecipe = "permanent-items" | "lump-sum";
export type AcquisitionRecipeSelection =
  | { readonly kind: OfficialAcquisitionRecipe }
  | { readonly kind: "custom-lump-sum"; readonly judgmentRef: string; readonly amountCopper: number };
export type AcquisitionFundingLane = "allowance" | "currency" | "class-grant";
export type AcquisitionStackingIntent = "aggregate" | "separate";
export type AcquisitionComponentKind = "baseline-item" | "property-rune" | "precious-material";
export type AcquisitionPriceDenomination = "cp" | "sp" | "gp" | "pp";
export type AcquisitionEquipmentSize = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type AcquisitionInvalidationReason =
  | "target-level"
  | "recipe"
  | "policy"
  | "baseline"
  | "document"
  | "price"
  | "quantity"
  | "allowance"
  | "budget";

export interface AcquisitionAllowanceSnapshot {
  readonly allowanceId: string;
  readonly itemLevel: number;
}

export interface AcquisitionPolicyMaterialFacts {
  readonly subject: { readonly actorId: string; readonly draftId: string; readonly targetLevel: number };
  readonly numericPolicyRef: CharacterWealthPolicyRef;
  readonly semanticPolicyRef: typeof SEMANTIC_WEALTH_POLICY_REF;
  readonly resolvedRecipe: AcquisitionRecipeSelection;
  readonly budgetCopper: number;
  readonly allowances: readonly AcquisitionAllowanceSnapshot[];
  readonly worldRecipePolicy: EffectiveEquipmentPolicySnapshotV1["worldRecipePolicy"];
  readonly sourcePolicy: EffectiveEquipmentPolicySnapshotV1["sourcePolicy"];
  readonly rarityPolicy: EffectiveEquipmentPolicySnapshotV1["rarityPolicy"];
  readonly authorityPolicy: EffectiveEquipmentPolicySnapshotV1["authorityPolicy"];
  readonly higherLevelStartEvidence: EffectiveEquipmentPolicySnapshotV1["higherLevelStartEvidence"];
  readonly abp: EffectiveEquipmentPolicySnapshotV1["abp"];
  readonly gmJudgments: EffectiveEquipmentPolicySnapshotV1["gmJudgments"];
}

export interface AcquisitionPolicySnapshot {
  readonly version: 1;
  /** Diagnostic identity for caching and support; it is never authority. */
  readonly fingerprint: string;
  readonly material: AcquisitionPolicyMaterialFacts;
}

export interface AcquisitionEconomicBaselineSnapshot {
  readonly version: 1;
  readonly actorId: string;
  readonly fingerprint: string;
}

export type AcquisitionBasePriceSnapshot =
  | {
      readonly kind: "priced";
      readonly value: Partial<Record<AcquisitionPriceDenomination, number>>;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "unparseable" };

export interface AcquisitionPriceSnapshot {
  readonly basePrice: AcquisitionBasePriceSnapshot;
  readonly size: AcquisitionEquipmentSize;
  /** Mirrors PF2E's persisted `system.price.sizeSensitive` fact. */
  readonly sizeSensitive: boolean;
  readonly preciousMaterial: boolean;
  readonly adjustedBulkPriceCopper: number | null;
  readonly configurationPriceCopper: number;
  readonly pricePer: number;
  readonly sourceQuantity: number;
  readonly requestedQuantity: number;
  readonly materializedQuantity: number;
  readonly unitPriceCopper: number;
  readonly linePriceCopper: number;
}

export type AcquisitionPriceInput = Omit<
  AcquisitionPriceSnapshot,
  "materializedQuantity" | "unitPriceCopper" | "linePriceCopper"
>;

export interface AcquisitionClassGrantRef {
  readonly plannedSourceUuid: string;
  readonly sourceSlotId: string;
  readonly expectedItemSourceUuid: string;
}

export type AcquisitionFunding =
  | { readonly lane: "currency" }
  | {
      readonly lane: "allowance";
      readonly assignment: { readonly mode: "automatic" } | { readonly mode: "player"; readonly allowanceId: string };
    }
  | { readonly lane: "class-grant"; readonly grant: AcquisitionClassGrantRef };

export interface AcquisitionLinePolicyDecision {
  readonly eligible: boolean;
  readonly packId: string;
  readonly publicationSlug: string | null;
  readonly rarity: "common" | "uncommon" | "rare" | "unique";
  readonly sourceBasis: string;
  readonly rarityBasis: string;
  readonly characterAccessRef: string | null;
  readonly sourceExceptionJudgmentId: string | null;
  readonly rarityExceptionJudgmentId: string | null;
  readonly abpTreatment: string;
}

export interface AcquisitionLineDraft {
  readonly schemaVersion: 1;
  readonly lineId: string;
  readonly sourceUuid: string;
  readonly documentFingerprint: string;
  readonly priceFingerprint: string;
  readonly itemLevel: number;
  readonly permanence: "consumable" | "permanent";
  readonly componentKind: AcquisitionComponentKind;
  readonly policyDecision: AcquisitionLinePolicyDecision;
  readonly funding: AcquisitionFunding;
  readonly stackingIntent: AcquisitionStackingIntent;
  readonly price: AcquisitionPriceSnapshot;
}

export interface AcquisitionMaterialLineFacts {
  readonly lineId: string;
  readonly sourceUuid: string;
  readonly documentFingerprint: string;
  readonly priceFingerprint: string;
  readonly itemLevel: number;
  readonly requestedQuantity: number;
  readonly stackingIntent: AcquisitionStackingIntent;
  readonly permanence: "consumable" | "permanent";
  readonly componentKind: AcquisitionComponentKind;
  readonly policyDecision: AcquisitionLinePolicyDecision;
  readonly funding: AcquisitionFunding;
}

export interface AcquisitionMaterialFacts {
  readonly targetLevel: number;
  readonly recipe: AcquisitionRecipeSelection;
  readonly policyFingerprint: string;
  readonly policyMaterial: AcquisitionPolicyMaterialFacts;
  readonly baseline: AcquisitionEconomicBaselineSnapshot;
  readonly lines: readonly AcquisitionMaterialLineFacts[];
}

export interface AcquisitionReviewSnapshot {
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly materialFacts: AcquisitionMaterialFacts;
  readonly remainingCopper: number;
}

export type AcquisitionDisposition =
  | {
      readonly kind: "unreviewed";
      readonly invalidatedFrom: "purchase-ledger" | "retain-all" | null;
      readonly reasons: readonly AcquisitionInvalidationReason[];
    }
  | { readonly kind: "purchase-ledger"; readonly review: AcquisitionReviewSnapshot }
  | { readonly kind: "retain-all"; readonly retainedCopper: number; readonly review: AcquisitionReviewSnapshot }
  | {
      readonly kind: "handoff";
      readonly reason: string;
      readonly acknowledgedByUserId: string;
      readonly acknowledgedAt: string;
    };

export interface AcquisitionDraftState {
  readonly schemaVersion: 1;
  readonly draftId: string;
  readonly batchId: string;
  readonly targetLevel: number;
  readonly recipe: AcquisitionRecipeSelection;
  readonly policySnapshot: AcquisitionPolicySnapshot | null;
  readonly baseline: AcquisitionEconomicBaselineSnapshot | null;
  readonly lines: readonly AcquisitionLineDraft[];
  readonly disposition: AcquisitionDisposition;
}

export interface AcquisitionLedgerBlocker {
  readonly code:
    | "policy-missing"
    | "policy-mismatch"
    | "baseline-missing"
    | "price-invalid"
    | "price-missing"
    | "price-unparseable"
    | "quantity-invalid"
    | "allowance-missing"
    | "allowance-reused"
    | "allowance-too-low"
    | "class-grant-invalid"
    | "recipe-lane-invalid"
    | "item-ineligible"
    | "over-budget"
    | "unsafe-arithmetic";
  readonly lineId: string | null;
  readonly message: string;
}

export interface AcquisitionLedgerLineResult {
  readonly lineId: string;
  readonly sourceUuid: string;
  readonly materializedQuantity: number;
  readonly fundingLane: AcquisitionFundingLane;
  readonly resolvedAllowanceId: string | null;
  readonly baselineChargedCopper: number;
  readonly supplementalChargedCopper: number;
  readonly totalChargedCopper: number;
}

export interface AcquisitionLedgerResult {
  readonly valid: boolean;
  readonly budgetCopper: number;
  readonly spentCopper: number;
  readonly remainingCopper: number;
  readonly lines: readonly AcquisitionLedgerLineResult[];
  readonly unusedAllowanceIds: readonly string[];
  readonly blockers: readonly AcquisitionLedgerBlocker[];
  readonly materialFacts: AcquisitionMaterialFacts | null;
}
