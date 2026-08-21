import {
  type AcquisitionCurrencyConvergenceWitnessV1,
  normalizeAcquisitionCurrencyConvergenceWitness,
} from "./acquisition-currency-convergence.js";
import type {
  AcquisitionBasePriceSnapshot,
  AcquisitionConfiguredRunesV1,
  AcquisitionDisposition,
  AcquisitionDraftState,
  AcquisitionFunding,
  AcquisitionInvalidationReason,
  AcquisitionLineDraft,
  AcquisitionLinePolicyDecision,
  AcquisitionMaterialFacts,
  AcquisitionMaterialLineFacts,
  AcquisitionPolicyMaterialFacts,
  AcquisitionPolicySnapshot,
  AcquisitionPriceSnapshot,
  AcquisitionRecipeSelection,
  AcquisitionReviewSnapshot,
} from "./acquisition-types.js";
import {
  type ClassGrantReconciliationResultV1,
  isClassGrantReconciliationConsistent,
  normalizeClassGrantReconciliationResult,
  normalizePlannedClassGrant,
  type PlannedClassGrantV1,
} from "./class-grant-reconciliation.js";
import type { EconomicAdmissionResult } from "./economic-baseline.js";
import { compareEconomicBaselines, normalizeEconomicBaseline, normalizeEconomicHandoff } from "./economic-baseline.js";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  type EffectiveEquipmentPolicySnapshotV1,
  evaluateEquipmentItemAuthorityFacts,
  normalizeEquipmentPolicyJudgment,
} from "./equipment-policy.js";

const INVALIDATION_ORDER: readonly AcquisitionInvalidationReason[] = [
  "target-level",
  "recipe",
  "policy",
  "baseline",
  "document",
  "price",
  "quantity",
  "allowance",
  "budget",
];

export function createAcquisitionDraft(args: {
  draftId: string;
  batchId: string;
  manifestId: string;
  targetLevel: number;
  recipe: AcquisitionRecipeSelection;
}): AcquisitionDraftState {
  if (!nonEmpty(args.draftId) || !nonEmpty(args.batchId) || !nonEmpty(args.manifestId)) {
    throw new TypeError("Acquisition IDs must be created before draft initialization.");
  }
  if (!validTargetLevel(args.targetLevel)) {
    throw new RangeError("Acquisition target level must be 1 through 20.");
  }
  const recipe = normalizeRecipe(args.recipe);
  if (!recipe) throw new TypeError("Acquisition recipe is invalid.");
  return {
    schemaVersion: 3,
    draftId: args.draftId,
    batchId: args.batchId,
    manifestId: args.manifestId,
    targetLevel: args.targetLevel,
    recipe,
    policySnapshot: null,
    baseline: null,
    plannedClassGrants: [],
    classGrantReconciliations: [],
    currencyConvergenceWitness: null,
    lines: [],
    disposition: unreviewed(),
  };
}

export function createAcquisitionPolicySnapshot(
  policy: EffectiveEquipmentPolicySnapshotV1,
  selectedRecipe: AcquisitionRecipeSelection
): AcquisitionPolicySnapshot {
  const recipe = acquisitionRecipeFromEffectivePolicy(policy, selectedRecipe);
  const allowances =
    policy.recipe.kind === "permanent-items" ? policy.recipe.allowances.map((allowance) => ({ ...allowance })) : [];
  const budgetCopper =
    policy.recipe.kind === "permanent-items" ? policy.recipe.currencyCopper : policy.recipe.budgetCopper;
  const material: AcquisitionPolicyMaterialFacts = {
    subject: { actorId: policy.actorId, draftId: policy.draftId, targetLevel: policy.targetLevel },
    numericPolicyRef: policy.rules.wealth,
    semanticPolicyRef: policy.rules.semantics,
    resolvedRecipe: recipe,
    budgetCopper,
    allowances,
    worldRecipePolicy: clone(policy.worldRecipePolicy),
    sourcePolicy: clone(policy.sourcePolicy),
    rarityPolicy: clone(policy.rarityPolicy),
    authorityPolicy: clone(policy.authorityPolicy),
    higherLevelStartEvidence: clone(policy.higherLevelStartEvidence),
    abp: clone(policy.abp),
    gmJudgments: clone(policy.gmJudgments),
  };
  const normalized = normalizeAcquisitionPolicySnapshot({ version: 1, fingerprint: policy.fingerprint, material });
  if (!normalized) throw new TypeError("The effective equipment policy cannot be captured for this acquisition.");
  return normalized;
}

export function acquisitionPolicyMaterialMatches(
  left: AcquisitionPolicySnapshot,
  right: AcquisitionPolicySnapshot
): boolean {
  return same(left.material, right.material);
}

export function normalizeAcquisitionDraft(raw: unknown): AcquisitionDraftState | null {
  if (
    !isRecord(raw) ||
    raw.schemaVersion !== 3 ||
    !("currencyConvergenceWitness" in raw) ||
    !nonEmpty(raw.draftId) ||
    !nonEmpty(raw.batchId) ||
    !nonEmpty(raw.manifestId)
  ) {
    return null;
  }
  const recipe = normalizeRecipe(raw.recipe);
  if (
    !validTargetLevel(raw.targetLevel) ||
    !recipe ||
    !Array.isArray(raw.plannedClassGrants) ||
    !Array.isArray(raw.lines) ||
    !Array.isArray(raw.classGrantReconciliations)
  )
    return null;

  const plannedClassGrants = raw.plannedClassGrants.map(normalizePlannedClassGrant);
  if (plannedClassGrants.some((grant) => !grant)) return null;
  const normalizedClassGrants = plannedClassGrants as NonNullable<(typeof plannedClassGrants)[number]>[];
  if (new Set(normalizedClassGrants.map((grant) => grant.grantId)).size !== normalizedClassGrants.length) return null;

  const lines = raw.lines.map(normalizeLine);
  if (lines.some((line) => !line)) return null;
  const normalizedLines = lines as AcquisitionLineDraft[];
  if (new Set(normalizedLines.map((line) => line.lineId)).size !== normalizedLines.length) return null;
  const classGrantReconciliations = raw.classGrantReconciliations.map(normalizeClassGrantReconciliationResult);
  const currencyConvergenceWitness =
    raw.currencyConvergenceWitness == null
      ? null
      : normalizeAcquisitionCurrencyConvergenceWitness(raw.currencyConvergenceWitness);
  if (
    classGrantReconciliations.some((result) => !result) ||
    !classGrantJournalMatchesPlan(
      classGrantReconciliations as ClassGrantReconciliationResultV1[],
      raw.draftId,
      raw.batchId,
      normalizedClassGrants
    ) ||
    (raw.currencyConvergenceWitness != null && !currencyConvergenceWitness)
  ) {
    return null;
  }

  const policySnapshot = normalizeAcquisitionPolicySnapshot(raw.policySnapshot);
  if (raw.policySnapshot != null && !policySnapshot) return null;
  const baseline = normalizeBaseline(raw.baseline);
  if (raw.baseline != null && !baseline) return null;
  if (
    policySnapshot &&
    !policyMatchesAcquisition(
      policySnapshot.material,
      { draftId: raw.draftId, targetLevel: raw.targetLevel },
      baseline,
      normalizedLines
    )
  )
    return null;
  if (
    currencyConvergenceWitness &&
    (!policySnapshot ||
      !baseline ||
      currencyConvergenceWitness.actorId !== policySnapshot.material.subject.actorId ||
      currencyConvergenceWitness.draftId !== raw.draftId ||
      currencyConvergenceWitness.batchId !== raw.batchId ||
      currencyConvergenceWitness.manifestId !== raw.manifestId ||
      currencyConvergenceWitness.baselineFingerprint !== baseline.fingerprint ||
      currencyConvergenceWitness.preCopper !== baseline.currencyCopper)
  ) {
    return null;
  }

  return {
    schemaVersion: 3,
    draftId: raw.draftId,
    batchId: raw.batchId,
    manifestId: raw.manifestId,
    targetLevel: raw.targetLevel,
    recipe,
    policySnapshot,
    baseline,
    plannedClassGrants: normalizedClassGrants,
    classGrantReconciliations: classGrantReconciliations as ClassGrantReconciliationResultV1[],
    currencyConvergenceWitness,
    lines: normalizedLines,
    disposition: normalizeDisposition(
      raw.disposition,
      normalizedLines,
      policySnapshot,
      baseline,
      normalizedClassGrants
    ),
  };
}

export function compareAcquisitionMaterialFacts(
  reviewed: AcquisitionMaterialFacts,
  current: AcquisitionMaterialFacts
): AcquisitionInvalidationReason[] {
  const reasons = new Set<AcquisitionInvalidationReason>();
  if (reviewed.targetLevel !== current.targetLevel) reasons.add("target-level");
  if (!same(reviewed.recipe, current.recipe)) reasons.add("recipe");
  comparePolicyMaterial(reviewed.policyMaterial, current.policyMaterial, reasons);
  if (compareEconomicBaselines(reviewed.baseline, current.baseline).length > 0) reasons.add("baseline");
  if (!same(reviewed.plannedClassGrants, current.plannedClassGrants)) reasons.add("document");

  const reviewedLines = new Map(reviewed.lines.map((line) => [line.lineId, line]));
  const currentLines = new Map(current.lines.map((line) => [line.lineId, line]));
  if (reviewedLines.size !== currentLines.size) reasons.add("document");
  for (const [lineId, currentLine] of currentLines) {
    const previous = reviewedLines.get(lineId);
    if (!previous) {
      reasons.add("document");
      continue;
    }
    compareLineMaterial(previous, currentLine, reasons);
  }
  return INVALIDATION_ORDER.filter((reason) => reasons.has(reason));
}

export function isAcquisitionPolicyAuthorityConsistent(draft: AcquisitionDraftState): boolean {
  return (
    draft.policySnapshot !== null &&
    policyMatchesAcquisition(
      draft.policySnapshot.material,
      { draftId: draft.draftId, targetLevel: draft.targetLevel },
      draft.baseline,
      draft.lines
    )
  );
}

export function invalidateAcquisitionReview(
  draft: AcquisitionDraftState,
  reasons: readonly AcquisitionInvalidationReason[]
): AcquisitionDraftState {
  const normalizedReasons = INVALIDATION_ORDER.filter((reason) => reasons.includes(reason));
  if (normalizedReasons.length === 0) {
    return draft;
  }
  if (draft.disposition.kind === "unreviewed" || draft.disposition.kind === "handoff") {
    return draft.currencyConvergenceWitness ? { ...draft, currencyConvergenceWitness: null } : draft;
  }
  const clearAssignments = normalizedReasons.includes("target-level") || normalizedReasons.includes("recipe");
  return {
    ...draft,
    currencyConvergenceWitness: null,
    lines: clearAssignments
      ? draft.lines.map((line) => ({
          ...line,
          funding:
            line.funding.lane === "allowance"
              ? ({ lane: "allowance", assignment: { mode: "automatic" } } as const)
              : line.funding,
        }))
      : draft.lines,
    disposition: {
      kind: "unreviewed",
      invalidatedFrom: draft.disposition.kind,
      reasons: normalizedReasons,
    },
  };
}

export function reconcileAcquisitionTargetLevel(
  draft: AcquisitionDraftState,
  targetLevel: number
): AcquisitionDraftState {
  if (!validTargetLevel(targetLevel)) {
    throw new RangeError("Acquisition target level must be 1 through 20.");
  }
  if (draft.targetLevel === targetLevel) return draft;
  const changed = {
    ...draft,
    targetLevel,
    policySnapshot: null,
    classGrantReconciliations: [],
    currencyConvergenceWitness: null,
  };
  if (draft.disposition.kind === "purchase-ledger" || draft.disposition.kind === "retain-all") {
    return invalidateAcquisitionReview(changed, ["target-level"]);
  }
  return {
    ...changed,
    lines: changed.lines.map((line) => ({
      ...line,
      funding:
        line.funding.lane === "allowance"
          ? ({ lane: "allowance", assignment: { mode: "automatic" } } as const)
          : line.funding,
    })),
    disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: ["target-level"] },
  };
}

export function recordPlannedClassGrants(
  draft: AcquisitionDraftState,
  grants: readonly PlannedClassGrantV1[]
): AcquisitionDraftState {
  const normalized = grants.map(normalizePlannedClassGrant);
  if (normalized.some((grant) => !grant)) throw new TypeError("The planned class-grant projection is invalid.");
  const plannedClassGrants = normalized as PlannedClassGrantV1[];
  plannedClassGrants.sort((left, right) => left.grantId.localeCompare(right.grantId));
  if (new Set(plannedClassGrants.map((grant) => grant.grantId)).size !== plannedClassGrants.length) {
    throw new TypeError("The planned class-grant projection contains duplicate grant IDs.");
  }
  if (same(draft.plannedClassGrants, plannedClassGrants)) return draft;

  const invalidatedFrom =
    draft.disposition.kind === "purchase-ledger" || draft.disposition.kind === "retain-all"
      ? draft.disposition.kind
      : null;
  const priorReasons = draft.disposition.kind === "unreviewed" ? draft.disposition.reasons : [];
  return {
    ...draft,
    plannedClassGrants,
    classGrantReconciliations: [],
    currencyConvergenceWitness: null,
    disposition: {
      kind: "unreviewed",
      invalidatedFrom,
      reasons: INVALIDATION_ORDER.filter((reason) => reason === "document" || priorReasons.includes(reason)),
    },
  };
}

export function recordClassGrantReconciliations(
  draft: AcquisitionDraftState,
  results: readonly ClassGrantReconciliationResultV1[]
): AcquisitionDraftState {
  const normalized = results.map(normalizeClassGrantReconciliationResult);
  if (
    normalized.some((result) => !result) ||
    !classGrantJournalMatchesPlan(
      normalized as ClassGrantReconciliationResultV1[],
      draft.draftId,
      draft.batchId,
      draft.plannedClassGrants
    )
  ) {
    throw new TypeError("The class-grant recovery evidence does not match this acquisition.");
  }
  return { ...draft, classGrantReconciliations: normalized as ClassGrantReconciliationResultV1[] };
}

export function recordAcquisitionCurrencyConvergenceWitness(
  draft: AcquisitionDraftState,
  witnessInput: AcquisitionCurrencyConvergenceWitnessV1
): AcquisitionDraftState {
  const witness = normalizeAcquisitionCurrencyConvergenceWitness(witnessInput);
  if (
    !witness ||
    witness.draftId !== draft.draftId ||
    witness.batchId !== draft.batchId ||
    witness.manifestId !== draft.manifestId ||
    witness.actorId !== draft.policySnapshot?.material.subject.actorId ||
    witness.baselineFingerprint !== draft.baseline?.fingerprint ||
    witness.preCopper !== draft.baseline?.currencyCopper
  ) {
    throw new TypeError("The currency convergence evidence does not match this acquisition.");
  }
  if (draft.currencyConvergenceWitness) {
    if (!same(draft.currencyConvergenceWitness, witness)) {
      throw new TypeError("Existing currency convergence evidence cannot be replaced.");
    }
    return draft;
  }
  return { ...draft, currencyConvergenceWitness: witness };
}

export function recordEconomicAdmission(
  draft: AcquisitionDraftState,
  admission: EconomicAdmissionResult
): AcquisitionDraftState {
  if (admission.baseline.actorId !== draft.policySnapshot?.material.subject.actorId) {
    throw new TypeError("The economic admission baseline does not match the acquisition policy subject.");
  }
  if (admission.kind === "handoff") {
    if (admission.handoff.baselineFingerprint !== admission.baseline.fingerprint) {
      throw new TypeError("The economic handoff does not match its captured baseline.");
    }
    return {
      ...draft,
      baseline: admission.baseline,
      currencyConvergenceWitness: null,
      disposition: {
        kind: "handoff",
        handoff: admission.handoff,
        acknowledgedByUserId: null,
        acknowledgedAt: null,
      },
    };
  }
  const baselineChanged = !!draft.baseline && compareEconomicBaselines(draft.baseline, admission.baseline).length > 0;
  const next = {
    ...draft,
    baseline: admission.baseline,
    currencyConvergenceWitness:
      baselineChanged || draft.disposition.kind === "handoff" ? null : draft.currencyConvergenceWitness,
    disposition:
      draft.disposition.kind === "handoff"
        ? ({ kind: "unreviewed", invalidatedFrom: null, reasons: [] } as const)
        : draft.disposition,
  };
  return baselineChanged ? invalidateAcquisitionReview(next, ["baseline"]) : next;
}

export function acknowledgeAcquisitionHandoff(
  draft: AcquisitionDraftState,
  acknowledgment: { readonly userId: string; readonly acknowledgedAt: string }
): AcquisitionDraftState {
  if (draft.disposition.kind !== "handoff") throw new TypeError("The acquisition is not in handoff state.");
  if (
    !nonEmpty(acknowledgment.userId) ||
    !nonEmpty(acknowledgment.acknowledgedAt) ||
    !Number.isFinite(Date.parse(acknowledgment.acknowledgedAt))
  ) {
    throw new TypeError("Handoff acknowledgment requires a user and timestamp.");
  }
  return {
    ...draft,
    currencyConvergenceWitness: null,
    disposition: {
      ...draft.disposition,
      acknowledgedByUserId: acknowledgment.userId,
      acknowledgedAt: acknowledgment.acknowledgedAt,
    },
  };
}

function comparePolicyMaterial(
  reviewed: AcquisitionPolicyMaterialFacts,
  current: AcquisitionPolicyMaterialFacts,
  reasons: Set<AcquisitionInvalidationReason>
): void {
  if (!same(reviewed.resolvedRecipe, current.resolvedRecipe)) reasons.add("recipe");
  if (reviewed.budgetCopper !== current.budgetCopper) reasons.add("budget");
  if (!same(reviewed.allowances, current.allowances)) reasons.add("allowance");
  if (
    !same(reviewed.subject, current.subject) ||
    !same(reviewed.numericPolicyRef, current.numericPolicyRef) ||
    !same(reviewed.semanticPolicyRef, current.semanticPolicyRef) ||
    !same(reviewed.authorityPolicy, current.authorityPolicy) ||
    !same(reviewed.higherLevelStartEvidence, current.higherLevelStartEvidence) ||
    !same(reviewed.abp, current.abp) ||
    !same(reviewed.gmJudgments, current.gmJudgments)
  ) {
    reasons.add("policy");
  }
}

function compareLineMaterial(
  reviewed: AcquisitionMaterialLineFacts,
  current: AcquisitionMaterialLineFacts,
  reasons: Set<AcquisitionInvalidationReason>
): void {
  if (
    reviewed.sourceUuid !== current.sourceUuid ||
    reviewed.documentFingerprint !== current.documentFingerprint ||
    reviewed.itemLevel !== current.itemLevel ||
    reviewed.stackingIntent !== current.stackingIntent ||
    reviewed.permanence !== current.permanence ||
    reviewed.componentKind !== current.componentKind
  ) {
    reasons.add("document");
  }
  if (reviewed.priceFingerprint !== current.priceFingerprint) reasons.add("price");
  if (reviewed.requestedQuantity !== current.requestedQuantity) reasons.add("quantity");
  if (!same(reviewed.funding, current.funding) || reviewed.resolvedAllowanceId !== current.resolvedAllowanceId) {
    reasons.add("allowance");
  }
  if (!same(reviewed.policyDecision, current.policyDecision)) reasons.add("policy");
}

function normalizeLine(raw: unknown): AcquisitionLineDraft | null {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !nonEmpty(raw.lineId) || !nonEmpty(raw.sourceUuid)) {
    return null;
  }
  if (
    !nonEmpty(raw.documentFingerprint) ||
    !nonEmpty(raw.priceFingerprint) ||
    !safeNonNegativeInteger(raw.itemLevel) ||
    !isOneOf(raw.permanence, ["consumable", "permanent"]) ||
    !isOneOf(raw.componentKind, ["baseline-item", "property-rune", "precious-material"]) ||
    !isOneOf(raw.stackingIntent, ["aggregate", "separate"])
  ) {
    return null;
  }
  const policyDecision = normalizeAcquisitionLinePolicyDecision(raw.policyDecision);
  const funding = normalizeAcquisitionFunding(raw.funding);
  const price = normalizeAcquisitionPriceSnapshot(raw.price);
  if (!policyDecision || !funding || !price) return null;
  return {
    schemaVersion: 1,
    lineId: raw.lineId,
    sourceUuid: raw.sourceUuid,
    documentFingerprint: raw.documentFingerprint,
    priceFingerprint: raw.priceFingerprint,
    itemLevel: raw.itemLevel,
    permanence: raw.permanence,
    componentKind: raw.componentKind,
    policyDecision,
    funding,
    stackingIntent: raw.stackingIntent,
    price,
  };
}

export function normalizeAcquisitionFunding(raw: unknown): AcquisitionFunding | null {
  if (!isRecord(raw) || !isOneOf(raw.lane, ["currency", "allowance", "class-grant"])) return null;
  if (raw.lane === "currency") return hasOnlyKeys(raw, ["lane"]) ? { lane: "currency" } : null;
  if (raw.lane === "allowance") {
    if (
      !hasOnlyKeys(raw, ["lane", "assignment"]) ||
      !isRecord(raw.assignment) ||
      !isOneOf(raw.assignment.mode, ["automatic", "player"])
    ) {
      return null;
    }
    return raw.assignment.mode === "automatic"
      ? hasOnlyKeys(raw.assignment, ["mode"])
        ? { lane: "allowance", assignment: { mode: "automatic" } }
        : null
      : hasOnlyKeys(raw.assignment, ["mode", "allowanceId"]) && nonEmpty(raw.assignment.allowanceId)
        ? { lane: "allowance", assignment: { mode: "player", allowanceId: raw.assignment.allowanceId } }
        : null;
  }
  if (!hasOnlyKeys(raw, ["lane", "grant"]) || !isRecord(raw.grant)) return null;
  return nonEmpty(raw.grant.plannedGrantId) && hasOnlyKeys(raw.grant, ["plannedGrantId"])
    ? {
        lane: "class-grant",
        grant: {
          plannedGrantId: raw.grant.plannedGrantId,
        },
      }
    : null;
}

export function normalizeAcquisitionLinePolicyDecision(raw: unknown): AcquisitionLinePolicyDecision | null {
  const publicationSlug = isRecord(raw) ? raw.publicationSlug : undefined;
  const characterAccessRef = isRecord(raw) ? raw.characterAccessRef : undefined;
  const sourceExceptionJudgmentId = isRecord(raw) ? raw.sourceExceptionJudgmentId : undefined;
  const rarityExceptionJudgmentId = isRecord(raw) ? raw.rarityExceptionJudgmentId : undefined;
  if (
    !isRecord(raw) ||
    typeof raw.eligible !== "boolean" ||
    !nonEmpty(raw.packId) ||
    (publicationSlug !== null && typeof publicationSlug !== "string") ||
    !isOneOf(raw.rarity, ["common", "uncommon", "rare", "unique"]) ||
    !nonEmpty(raw.sourceBasis) ||
    !nonEmpty(raw.rarityBasis) ||
    (characterAccessRef !== null && !nonEmpty(characterAccessRef)) ||
    (sourceExceptionJudgmentId !== null && !nonEmpty(sourceExceptionJudgmentId)) ||
    (rarityExceptionJudgmentId !== null && !nonEmpty(rarityExceptionJudgmentId)) ||
    !nonEmpty(raw.abpTreatment)
  ) {
    return null;
  }
  return {
    eligible: raw.eligible,
    packId: raw.packId,
    publicationSlug: publicationSlug === null ? null : String(publicationSlug),
    rarity: raw.rarity,
    sourceBasis: raw.sourceBasis,
    rarityBasis: raw.rarityBasis,
    characterAccessRef: characterAccessRef === null ? null : String(characterAccessRef),
    sourceExceptionJudgmentId: sourceExceptionJudgmentId === null ? null : String(sourceExceptionJudgmentId),
    rarityExceptionJudgmentId: rarityExceptionJudgmentId === null ? null : String(rarityExceptionJudgmentId),
    abpTreatment: raw.abpTreatment,
  };
}

export function normalizeAcquisitionPriceSnapshot(raw: unknown): AcquisitionPriceSnapshot | null {
  if (!isRecord(raw)) return null;
  const basePrice = normalizeBasePrice(raw.basePrice);
  const adjustedBulkPriceCopper = raw.adjustedBulkPriceCopper;
  const configurationComponents = normalizeConfigurationComponents(raw.configurationComponents);
  if (
    !basePrice ||
    !isOneOf(raw.size, ["tiny", "small", "medium", "large", "huge", "gargantuan"]) ||
    typeof raw.sizeSensitive !== "boolean" ||
    typeof raw.preciousMaterial !== "boolean" ||
    (adjustedBulkPriceCopper !== null && !safeNonNegativeInteger(adjustedBulkPriceCopper)) ||
    !safeNonNegativeInteger(raw.configurationPriceCopper) ||
    !safePositiveInteger(raw.pricePer) ||
    !safePositiveInteger(raw.sourceQuantity) ||
    !safePositiveInteger(raw.requestedQuantity) ||
    !safePositiveInteger(raw.materializedQuantity) ||
    !safeNonNegativeInteger(raw.unitPriceCopper) ||
    !safeNonNegativeInteger(raw.linePriceCopper) ||
    configurationComponents === undefined
  ) {
    return null;
  }
  return {
    basePrice,
    size: raw.size,
    sizeSensitive: raw.sizeSensitive,
    preciousMaterial: raw.preciousMaterial,
    adjustedBulkPriceCopper: adjustedBulkPriceCopper === null ? null : Number(adjustedBulkPriceCopper),
    configurationPriceCopper: raw.configurationPriceCopper,
    pricePer: raw.pricePer,
    sourceQuantity: raw.sourceQuantity,
    requestedQuantity: raw.requestedQuantity,
    materializedQuantity: raw.materializedQuantity,
    unitPriceCopper: raw.unitPriceCopper,
    linePriceCopper: raw.linePriceCopper,
    ...(configurationComponents ? { configurationComponents } : {}),
  };
}

function normalizeConfigurationComponents(
  raw: unknown
): AcquisitionPriceSnapshot["configurationComponents"] | null | undefined {
  if (raw === undefined) return null;
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    !isOneOf(raw.itemType, ["weapon", "armor"]) ||
    !nonEmpty(raw.baseItem) ||
    !isRecord(raw.source) ||
    !isRecord(raw.prepared) ||
    !safeNonNegativeInteger(raw.baselineAndFundamentalCopper) ||
    !safeNonNegativeInteger(raw.propertyRuneCopper) ||
    !safeNonNegativeInteger(raw.preciousMaterialCopper) ||
    !Array.isArray(raw.suppressedByAbp) ||
    !raw.suppressedByAbp.every(nonEmpty)
  ) {
    return undefined;
  }
  const sourceRunes = normalizeConfiguredRunes(raw.source.runes);
  const preparedRunes = normalizeConfiguredRunes(raw.prepared.runes);
  const sourceMaterial = normalizeConfiguredMaterial(raw.source.material);
  const preparedMaterial = normalizeConfiguredMaterial(raw.prepared.material);
  if (
    !sourceRunes ||
    !preparedRunes ||
    !sourceMaterial ||
    !preparedMaterial ||
    !safeNonNegativeInteger(raw.prepared.totalCopper)
  ) {
    return undefined;
  }
  return {
    version: 1,
    itemType: raw.itemType,
    baseItem: raw.baseItem,
    source: { runes: sourceRunes, material: sourceMaterial },
    prepared: { runes: preparedRunes, material: preparedMaterial, totalCopper: raw.prepared.totalCopper },
    baselineAndFundamentalCopper: raw.baselineAndFundamentalCopper,
    propertyRuneCopper: raw.propertyRuneCopper,
    preciousMaterialCopper: raw.preciousMaterialCopper,
    suppressedByAbp: [...new Set(raw.suppressedByAbp)].sort(),
  };
}

function normalizeConfiguredRunes(raw: unknown): AcquisitionConfiguredRunesV1 | null {
  if (
    !isRecord(raw) ||
    !safeNonNegativeInteger(raw.potency) ||
    (raw.fundamental !== null && typeof raw.fundamental !== "string" && !safeNonNegativeInteger(raw.fundamental)) ||
    !Array.isArray(raw.property) ||
    !raw.property.every((value) => typeof value === "string")
  ) {
    return null;
  }
  return {
    potency: Number(raw.potency),
    fundamental: raw.fundamental as string | number | null,
    property: [...raw.property] as string[],
  };
}

function normalizeConfiguredMaterial(
  raw: unknown
): { readonly type: string | null; readonly grade: string | null } | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  const grade = raw.grade;
  if ((type !== null && typeof type !== "string") || (grade !== null && typeof grade !== "string")) return null;
  return { type: type as string | null, grade: grade as string | null };
}

function normalizeBasePrice(raw: unknown): AcquisitionBasePriceSnapshot | null {
  if (!isRecord(raw) || !isOneOf(raw.kind, ["priced", "missing", "unparseable"])) return null;
  if (raw.kind !== "priced") return hasOnlyKeys(raw, ["kind"]) ? { kind: raw.kind } : null;
  const rawValue = raw.value;
  if (
    !hasOnlyKeys(raw, ["kind", "value"]) ||
    !isRecord(rawValue) ||
    Object.keys(rawValue).some((key) => !["cp", "sp", "gp", "pp"].includes(key))
  ) {
    return null;
  }
  const value = Object.fromEntries(
    ["pp", "gp", "sp", "cp"].flatMap((denomination) => {
      const amount = rawValue[denomination];
      return amount === undefined ? [] : [[denomination, amount]];
    })
  );
  return Object.values(value).every(safeNonNegativeInteger) ? { kind: "priced", value } : null;
}

export function normalizeAcquisitionPolicySnapshot(raw: unknown): AcquisitionPolicySnapshot | null {
  if (raw == null) return null;
  if (!isRecord(raw) || raw.version !== 1 || !nonEmpty(raw.fingerprint)) return null;
  const material = normalizePolicyMaterial(raw.material);
  return material ? { version: 1, fingerprint: raw.fingerprint, material } : null;
}

function normalizePolicyMaterial(raw: unknown): AcquisitionPolicyMaterialFacts | null {
  if (!isRecord(raw) || !isRecord(raw.numericPolicyRef) || !isRecord(raw.semanticPolicyRef)) return null;
  const subject = normalizePolicySubject(raw.subject);
  const numericPolicyRef = raw.numericPolicyRef;
  const semanticPolicyRef = raw.semanticPolicyRef;
  const resolvedRecipe = normalizeRecipe(raw.resolvedRecipe);
  const worldRecipePolicy = normalizeWorldRecipePolicy(raw.worldRecipePolicy);
  const sourcePolicy = normalizeSourcePolicy(raw.sourcePolicy);
  const rarityPolicy = normalizeRarityPolicy(raw.rarityPolicy);
  const authorityPolicy = normalizeAuthorityPolicy(raw.authorityPolicy);
  const higherLevelStartEvidence = normalizeHigherLevelStartEvidence(raw.higherLevelStartEvidence);
  const abp = normalizeAbp(raw.abp);
  const gmJudgments = normalizeJudgments(raw.gmJudgments);
  if (
    !subject ||
    numericPolicyRef.policyId !== "pf2e-remaster-character-wealth" ||
    !safePositiveInteger(numericPolicyRef.policyVersion) ||
    !nonEmpty(numericPolicyRef.dataDigest) ||
    semanticPolicyRef.policyId !== "pf2e-remaster-semantic-wealth" ||
    semanticPolicyRef.policyVersion !== 1 ||
    !resolvedRecipe ||
    !safeNonNegativeInteger(raw.budgetCopper) ||
    !Array.isArray(raw.allowances) ||
    !worldRecipePolicy ||
    !sourcePolicy ||
    !rarityPolicy ||
    !authorityPolicy ||
    !higherLevelStartEvidence ||
    !abp ||
    !gmJudgments
  ) {
    return null;
  }
  const allowances = raw.allowances.flatMap((entry) =>
    isRecord(entry) && nonEmpty(entry.allowanceId) && safeNonNegativeInteger(entry.itemLevel)
      ? [{ allowanceId: entry.allowanceId, itemLevel: entry.itemLevel }]
      : []
  );
  if (
    allowances.length !== raw.allowances.length ||
    new Set(allowances.map((entry) => entry.allowanceId)).size !== allowances.length
  ) {
    return null;
  }
  return {
    subject,
    numericPolicyRef: {
      policyId: "pf2e-remaster-character-wealth",
      policyVersion: numericPolicyRef.policyVersion,
      dataDigest: numericPolicyRef.dataDigest,
    },
    semanticPolicyRef: {
      policyId: "pf2e-remaster-semantic-wealth",
      policyVersion: 1,
    },
    resolvedRecipe,
    budgetCopper: raw.budgetCopper,
    allowances: [...allowances].sort(
      (left, right) => left.itemLevel - right.itemLevel || left.allowanceId.localeCompare(right.allowanceId)
    ),
    worldRecipePolicy,
    sourcePolicy,
    rarityPolicy,
    authorityPolicy,
    higherLevelStartEvidence,
    abp,
    gmJudgments,
  };
}

function normalizePolicySubject(raw: unknown): AcquisitionPolicyMaterialFacts["subject"] | null {
  return isRecord(raw) && nonEmpty(raw.actorId) && nonEmpty(raw.draftId) && validTargetLevel(raw.targetLevel)
    ? { actorId: raw.actorId, draftId: raw.draftId, targetLevel: raw.targetLevel }
    : null;
}

function policyMatchesAcquisition(
  policy: AcquisitionPolicyMaterialFacts,
  draft: { readonly draftId: unknown; readonly targetLevel: unknown },
  baseline: AcquisitionDraftState["baseline"],
  lines: readonly AcquisitionLineDraft[]
): boolean {
  const subject = policy.subject;
  if (
    subject.draftId !== draft.draftId ||
    subject.targetLevel !== draft.targetLevel ||
    (baseline !== null && baseline.actorId !== subject.actorId) ||
    policy.gmJudgments.some(
      (judgment) =>
        judgment.actorId !== subject.actorId ||
        judgment.draftId !== subject.draftId ||
        judgment.targetLevel !== subject.targetLevel
    )
  ) {
    return false;
  }
  const evidence = policy.higherLevelStartEvidence;
  const usedJudgmentIds = new Set<string>();
  if (subject.targetLevel === 1 && evidence.kind !== "not-required") return false;
  if (subject.targetLevel === 1) {
    return (
      policyDetailsMatchJudgments(policy, lines, usedJudgmentIds) && allRequiredJudgmentsUsed(policy, usedJudgmentIds)
    );
  }
  if (evidence.kind === "not-required") return false;
  if (evidence.kind === "gm-confirmation") {
    const validStart =
      policy.authorityPolicy.higherLevelStart === "gm-confirmation" &&
      evidence.judgment.actorId === subject.actorId &&
      evidence.judgment.draftId === subject.draftId &&
      evidence.judgment.targetLevel === subject.targetLevel &&
      evidence.judgment.factsFingerprint ===
        buildEquipmentPolicyJudgmentFactsFingerprint({
          kind: "higher-level-start",
          actorId: subject.actorId,
          draftId: subject.draftId,
          targetLevel: subject.targetLevel,
          startKind: evidence.startKind,
        }) &&
      policy.gmJudgments.some((judgment) => judgment.id === evidence.judgment.id);
    if (!validStart) return false;
    usedJudgmentIds.add(evidence.judgment.id);
  } else if (
    policy.authorityPolicy.higherLevelStart !== "actor-owner-attestation" ||
    evidence.actorId !== subject.actorId ||
    evidence.draftId !== subject.draftId ||
    evidence.targetLevel !== subject.targetLevel
  ) {
    return false;
  }
  return (
    policyDetailsMatchJudgments(policy, lines, usedJudgmentIds) && allRequiredJudgmentsUsed(policy, usedJudgmentIds)
  );
}

function allRequiredJudgmentsUsed(
  policy: AcquisitionPolicyMaterialFacts,
  usedJudgmentIds: ReadonlySet<string>
): boolean {
  return policy.gmJudgments.every(
    (judgment) => judgment.kind === "rarity-source-exception" || usedJudgmentIds.has(judgment.id)
  );
}

function policyDetailsMatchJudgments(
  policy: AcquisitionPolicyMaterialFacts,
  lines: readonly AcquisitionLineDraft[],
  usedJudgmentIds: Set<string>
): boolean {
  const byId = new Map(policy.gmJudgments.map((judgment) => [judgment.id, judgment]));
  const subject = policy.subject;
  if (policy.resolvedRecipe.kind === "custom-lump-sum") {
    const judgment = byId.get(policy.resolvedRecipe.judgmentRef);
    const expected = buildEquipmentPolicyJudgmentFactsFingerprint({
      kind: "custom-lump-sum",
      actorId: subject.actorId,
      draftId: subject.draftId,
      targetLevel: subject.targetLevel,
      amountCopper: policy.resolvedRecipe.amountCopper,
    });
    if (judgment?.kind !== "custom-lump-sum" || judgment.factsFingerprint !== expected) return false;
    usedJudgmentIds.add(judgment.id);
  } else if (policy.gmJudgments.some((judgment) => judgment.kind === "custom-lump-sum")) {
    return false;
  }

  for (const allowance of policy.allowances) {
    if (!allowance.allowanceId.startsWith("gm-extra:")) continue;
    const id = allowance.allowanceId.slice("gm-extra:".length);
    const judgment = byId.get(id);
    const expected = buildEquipmentPolicyJudgmentFactsFingerprint({
      kind: "extra-current-level-allowance",
      actorId: subject.actorId,
      draftId: subject.draftId,
      targetLevel: subject.targetLevel,
    });
    if (
      judgment?.kind !== "extra-current-level-allowance" ||
      judgment.factsFingerprint !== expected ||
      allowance.itemLevel !== subject.targetLevel
    )
      return false;
    usedJudgmentIds.add(id);
  }
  if (
    policy.gmJudgments.some(
      (judgment) => judgment.kind === "extra-current-level-allowance" && !usedJudgmentIds.has(judgment.id)
    )
  )
    return false;

  for (const line of lines) {
    const decision = line.policyDecision;
    const authority = evaluateEquipmentItemAuthorityFacts({
      policy: {
        actorId: subject.actorId,
        draftId: subject.draftId,
        targetLevel: subject.targetLevel,
        sourcePolicy: policy.sourcePolicy,
        rarityPolicy: policy.rarityPolicy,
        gmJudgments: policy.gmJudgments,
      },
      sourceUuid: line.sourceUuid,
      packId: decision.packId,
      publicationSlug: decision.publicationSlug,
      rarity: decision.rarity,
      hasCharacterAccess: decision.characterAccessRef !== null,
      sourceExceptionJudgmentId: decision.sourceExceptionJudgmentId,
      rarityExceptionJudgmentId: decision.rarityExceptionJudgmentId,
    });
    if (authority.eligible !== decision.eligible) return false;
    for (const [id, scope] of [
      [decision.sourceExceptionJudgmentId, "source"],
      [decision.rarityExceptionJudgmentId, "rarity"],
    ] as const) {
      if (id === null) continue;
      const judgment = byId.get(id);
      if (
        judgment?.kind !== "rarity-source-exception" ||
        ![scope, "source-and-rarity"].some(
          (candidateScope) =>
            judgment.factsFingerprint ===
            buildEquipmentPolicyJudgmentFactsFingerprint({
              kind: "rarity-source-exception",
              actorId: subject.actorId,
              draftId: subject.draftId,
              targetLevel: subject.targetLevel,
              scope: candidateScope as "source" | "rarity" | "source-and-rarity",
              sourceUuid: line.sourceUuid,
              packId: decision.packId,
              publicationSlug: decision.publicationSlug,
              rarity: decision.rarity,
            })
        )
      )
        return false;
      usedJudgmentIds.add(id);
    }
  }
  return true;
}

function normalizeWorldRecipePolicy(raw: unknown): AcquisitionPolicyMaterialFacts["worldRecipePolicy"] | null {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.enabledRecipes) ||
    !isOneOf(raw.defaultRecipe, ["permanent-items", "lump-sum"])
  ) {
    return null;
  }
  const enabledRecipes = Array.from(
    new Set(
      raw.enabledRecipes.filter((value): value is "permanent-items" | "lump-sum" =>
        isOneOf(value, ["permanent-items", "lump-sum"])
      )
    )
  ).sort();
  return enabledRecipes.length > 0 && enabledRecipes.includes(raw.defaultRecipe)
    ? { enabledRecipes, defaultRecipe: raw.defaultRecipe }
    : null;
}

function normalizeSourcePolicy(raw: unknown): AcquisitionPolicyMaterialFacts["sourcePolicy"] | null {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.configuredPackFamilies) ||
    !Array.isArray(raw.effectivePackIds) ||
    !Array.isArray(raw.enabledSourceSlugs) ||
    !Array.isArray(raw.knownSourceSlugs) ||
    typeof raw.showEmptySources !== "boolean" ||
    typeof raw.showUnknownSources !== "boolean"
  )
    return null;
  const strings = (values: unknown[]) => Array.from(new Set(values.filter(nonEmpty))).sort();
  return {
    configuredPackFamilies: strings(raw.configuredPackFamilies),
    effectivePackIds: strings(raw.effectivePackIds),
    enabledSourceSlugs: strings(raw.enabledSourceSlugs),
    knownSourceSlugs: strings(raw.knownSourceSlugs),
    showEmptySources: raw.showEmptySources,
    showUnknownSources: raw.showUnknownSources,
  };
}

function normalizeRarityPolicy(raw: unknown): AcquisitionPolicyMaterialFacts["rarityPolicy"] | null {
  return isRecord(raw) && isOneOf(raw.blanketCeiling, ["common", "uncommon", "rare", "unique"])
    ? { blanketCeiling: raw.blanketCeiling }
    : null;
}

function normalizeAuthorityPolicy(raw: unknown): AcquisitionPolicyMaterialFacts["authorityPolicy"] | null {
  return isRecord(raw) &&
    isOneOf(raw.recipeChoice, ["gm-fixed", "actor-owner"]) &&
    isOneOf(raw.higherLevelStart, ["gm-confirmation", "actor-owner-attestation"]) &&
    isOneOf(raw.apply, ["actor-owner", "gm-review"])
    ? { recipeChoice: raw.recipeChoice, higherLevelStart: raw.higherLevelStart, apply: raw.apply }
    : null;
}

function normalizeAbp(raw: unknown): AcquisitionPolicyMaterialFacts["abp"] | null {
  return isRecord(raw) &&
    typeof raw.enabled === "boolean" &&
    (raw.mode === null || typeof raw.mode === "string") &&
    typeof raw.actorOverrideDisabled === "boolean"
    ? { enabled: raw.enabled, mode: raw.mode as string | null, actorOverrideDisabled: raw.actorOverrideDisabled }
    : null;
}

function normalizeHigherLevelStartEvidence(
  raw: unknown
): AcquisitionPolicyMaterialFacts["higherLevelStartEvidence"] | null {
  if (!isRecord(raw) || !isOneOf(raw.kind, ["not-required", "gm-confirmation", "actor-owner-attestation"])) {
    return null;
  }
  if (raw.kind === "not-required") return hasOnlyKeys(raw, ["kind"]) ? { kind: "not-required" } : null;
  if (raw.kind === "gm-confirmation") {
    const judgment = normalizeEquipmentPolicyJudgment(raw.judgment);
    return judgment?.kind === "higher-level-start" && isOneOf(raw.startKind, ["new-campaign", "replacement-character"])
      ? { kind: "gm-confirmation", startKind: raw.startKind, judgment }
      : null;
  }
  return nonEmpty(raw.actorId) &&
    nonEmpty(raw.draftId) &&
    validTargetLevel(raw.targetLevel) &&
    isOneOf(raw.startKind, ["new-campaign", "replacement-character"]) &&
    nonEmpty(raw.authorUserId) &&
    nonEmpty(raw.authorName) &&
    nonEmpty(raw.recordedAt) &&
    Number.isFinite(Date.parse(raw.recordedAt)) &&
    nonEmpty(raw.reason)
    ? {
        kind: "actor-owner-attestation",
        startKind: raw.startKind,
        actorId: raw.actorId,
        draftId: raw.draftId,
        targetLevel: raw.targetLevel,
        authorUserId: raw.authorUserId,
        authorName: raw.authorName,
        recordedAt: raw.recordedAt,
        reason: raw.reason.trim(),
      }
    : null;
}

function normalizeJudgments(raw: unknown): AcquisitionPolicyMaterialFacts["gmJudgments"] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.flatMap((value) => {
    const judgment = normalizeEquipmentPolicyJudgment(value);
    return judgment ? [judgment] : [];
  });
  if (values.length !== raw.length || new Set(values.map((value) => value.id)).size !== values.length) return null;
  return values.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeBaseline(raw: unknown): AcquisitionDraftState["baseline"] {
  return normalizeEconomicBaseline(raw);
}

function normalizeDisposition(
  raw: unknown,
  lines: readonly AcquisitionLineDraft[],
  policy: AcquisitionPolicySnapshot | null,
  baseline: AcquisitionDraftState["baseline"],
  plannedClassGrants: AcquisitionDraftState["plannedClassGrants"]
): AcquisitionDisposition {
  if (!isRecord(raw) || !isOneOf(raw.kind, ["unreviewed", "purchase-ledger", "retain-all", "handoff"])) {
    return unreviewed();
  }
  if (raw.kind === "unreviewed") {
    const rawReasons = Array.isArray(raw.reasons) ? raw.reasons : [];
    return {
      kind: "unreviewed",
      invalidatedFrom: isOneOf(raw.invalidatedFrom, ["purchase-ledger", "retain-all"]) ? raw.invalidatedFrom : null,
      reasons: INVALIDATION_ORDER.filter((reason) => rawReasons.includes(reason)),
    };
  }
  if (raw.kind === "handoff") {
    const handoff = normalizeEconomicHandoff(raw.handoff);
    const unacknowledged = raw.acknowledgedByUserId === null && raw.acknowledgedAt === null;
    const acknowledged =
      nonEmpty(raw.acknowledgedByUserId) &&
      nonEmpty(raw.acknowledgedAt) &&
      Number.isFinite(Date.parse(raw.acknowledgedAt));
    return handoff &&
      baseline &&
      handoff.baselineFingerprint === baseline.fingerprint &&
      (unacknowledged || acknowledged)
      ? {
          kind: "handoff",
          handoff,
          acknowledgedByUserId: acknowledged ? (raw.acknowledgedByUserId as string) : null,
          acknowledgedAt: acknowledged ? (raw.acknowledgedAt as string) : null,
        }
      : unreviewed();
  }
  const review = normalizeReview(raw.review, lines, policy, plannedClassGrants);
  if (!review) return { kind: "unreviewed", invalidatedFrom: raw.kind, reasons: ["policy"] };
  if (raw.kind === "purchase-ledger") return { kind: "purchase-ledger", review };
  return safeNonNegativeInteger(raw.retainedCopper)
    ? { kind: "retain-all", retainedCopper: raw.retainedCopper, review }
    : { kind: "unreviewed", invalidatedFrom: "retain-all", reasons: ["budget"] };
}

function normalizeReview(
  raw: unknown,
  lines: readonly AcquisitionLineDraft[],
  policy: AcquisitionPolicySnapshot | null,
  plannedClassGrants: AcquisitionDraftState["plannedClassGrants"]
): AcquisitionReviewSnapshot | null {
  if (
    !isRecord(raw) ||
    !nonEmpty(raw.reviewedByUserId) ||
    !nonEmpty(raw.reviewedAt) ||
    !safeNonNegativeInteger(raw.remainingCopper)
  ) {
    return null;
  }
  const facts = normalizeMaterialFacts(raw.materialFacts);
  if (!facts || !policy || facts.lines.length !== lines.length || !same(facts.plannedClassGrants, plannedClassGrants))
    return null;
  return {
    reviewedByUserId: raw.reviewedByUserId,
    reviewedAt: raw.reviewedAt,
    materialFacts: facts,
    remainingCopper: raw.remainingCopper,
  };
}

function normalizeMaterialFacts(raw: unknown): AcquisitionMaterialFacts | null {
  if (!isRecord(raw)) return null;
  const recipe = normalizeRecipe(raw.recipe);
  const policyMaterial = normalizePolicyMaterial(raw.policyMaterial);
  const baseline = normalizeBaseline(raw.baseline);
  if (
    !validTargetLevel(raw.targetLevel) ||
    !recipe ||
    !nonEmpty(raw.policyFingerprint) ||
    !policyMaterial ||
    !baseline ||
    !Array.isArray(raw.plannedClassGrants) ||
    !Array.isArray(raw.lines)
  ) {
    return null;
  }
  const lines = raw.lines.map(normalizeAcquisitionMaterialLineFacts);
  const plannedClassGrants = raw.plannedClassGrants.map(normalizePlannedClassGrant);
  if (lines.some((line) => !line) || new Set(lines.map((line) => line?.lineId)).size !== lines.length) {
    return null;
  }
  if (
    plannedClassGrants.some((grant) => !grant) ||
    new Set(plannedClassGrants.map((grant) => grant?.grantId)).size !== plannedClassGrants.length
  )
    return null;
  return {
    targetLevel: raw.targetLevel,
    recipe,
    policyFingerprint: raw.policyFingerprint,
    policyMaterial,
    baseline,
    plannedClassGrants: plannedClassGrants as NonNullable<(typeof plannedClassGrants)[number]>[],
    lines: lines as AcquisitionMaterialLineFacts[],
  };
}

export function normalizeAcquisitionMaterialLineFacts(raw: unknown): AcquisitionMaterialLineFacts | null {
  if (
    !isRecord(raw) ||
    !nonEmpty(raw.lineId) ||
    !nonEmpty(raw.sourceUuid) ||
    !nonEmpty(raw.documentFingerprint) ||
    !nonEmpty(raw.priceFingerprint) ||
    !safeNonNegativeInteger(raw.itemLevel) ||
    !safePositiveInteger(raw.requestedQuantity) ||
    !isOneOf(raw.stackingIntent, ["aggregate", "separate"]) ||
    !isOneOf(raw.permanence, ["consumable", "permanent"]) ||
    !isOneOf(raw.componentKind, ["baseline-item", "property-rune", "precious-material"])
  ) {
    return null;
  }
  const policyDecision = normalizeAcquisitionLinePolicyDecision(raw.policyDecision);
  const funding = normalizeAcquisitionFunding(raw.funding);
  const resolvedAllowanceId = raw.resolvedAllowanceId;
  if (
    !policyDecision ||
    !funding ||
    (resolvedAllowanceId !== null && !nonEmpty(resolvedAllowanceId)) ||
    (funding.lane !== "allowance" && resolvedAllowanceId !== null) ||
    (funding.lane === "allowance" && resolvedAllowanceId === null)
  ) {
    return null;
  }
  return {
    lineId: raw.lineId,
    sourceUuid: raw.sourceUuid,
    documentFingerprint: raw.documentFingerprint,
    priceFingerprint: raw.priceFingerprint,
    itemLevel: raw.itemLevel,
    requestedQuantity: raw.requestedQuantity,
    stackingIntent: raw.stackingIntent,
    permanence: raw.permanence,
    componentKind: raw.componentKind,
    policyDecision,
    funding,
    resolvedAllowanceId: resolvedAllowanceId === null ? null : String(resolvedAllowanceId),
  };
}

function acquisitionRecipeFromEffectivePolicy(
  policy: EffectiveEquipmentPolicySnapshotV1,
  selectedRecipe: AcquisitionRecipeSelection
): AcquisitionRecipeSelection {
  if (policy.recipe.kind === "level-1-equivalent") {
    if (selectedRecipe.kind === "custom-lump-sum") {
      throw new TypeError("Level-1 acquisition cannot use a custom lump-sum recipe.");
    }
    return { kind: selectedRecipe.kind };
  }
  if (policy.recipe.kind === "permanent-items") return { kind: "permanent-items" };
  if (policy.recipe.kind === "lump-sum") return { kind: "lump-sum" };
  return {
    kind: "custom-lump-sum",
    judgmentRef: policy.recipe.judgment.id,
    amountCopper: policy.recipe.budgetCopper,
  };
}

function classGrantJournalMatchesPlan(
  results: readonly ClassGrantReconciliationResultV1[],
  draftId: string,
  batchId: string,
  grants: readonly PlannedClassGrantV1[]
): boolean {
  const phaseOrder = ["before-acquisition", "after-acquisition", "final"] as const;
  const grantIds = grants.map((grant) => grant.grantId).sort();
  let previousPhase = -1;
  for (const result of results) {
    const phase = phaseOrder.indexOf(result.phase);
    if (
      !isClassGrantReconciliationConsistent(result) ||
      result.draftId !== draftId ||
      result.batchId !== batchId ||
      phase <= previousPhase ||
      (result.phase !== "before-acquisition" && result.entries.some((entry) => entry.status === "pending")) ||
      !same(result.entries.map((entry) => entry.grantId).sort(), grantIds)
    ) {
      return false;
    }
    previousPhase = phase;
  }
  return true;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeRecipe(raw: unknown): AcquisitionRecipeSelection | null {
  if (!isRecord(raw) || !isOneOf(raw.kind, ["permanent-items", "lump-sum", "custom-lump-sum"])) {
    return null;
  }
  if (raw.kind !== "custom-lump-sum") return { kind: raw.kind };
  return nonEmpty(raw.judgmentRef) && safeNonNegativeInteger(raw.amountCopper)
    ? { kind: "custom-lump-sum", judgmentRef: raw.judgmentRef, amountCopper: raw.amountCopper }
    : null;
}

function unreviewed(): AcquisitionDisposition {
  return { kind: "unreviewed", invalidatedFrom: null, reasons: [] };
}

function validTargetLevel(value: unknown): value is number {
  return safePositiveInteger(value) && value <= 20;
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
