import { cloneData } from "../../shared/cloning.js";
import { compareAcquisitionMaterialFacts, isAcquisitionPolicyAuthorityConsistent } from "./acquisition-draft.js";
import { assertPreparedClassGrantPlanMatches } from "./class-grant-reconciliation.js";
import { SEMANTIC_WEALTH_POLICY } from "./semantic-wealth-policy.js";
export function evaluateAcquisitionLedger(draft, preparedClassGrantPlan) {
    const policy = draft.policySnapshot;
    if (!policy)
        return emptyInvalidLedger("policy-missing", "An effective equipment policy is required.");
    if (!draft.baseline)
        return emptyInvalidLedger("baseline-missing", "An economic baseline is required.");
    if (!isAcquisitionPolicyAuthorityConsistent(draft)) {
        return emptyInvalidLedger("policy-mismatch", "The equipment policy authority evidence is invalid or stale.");
    }
    if (!same(policy.material.resolvedRecipe, draft.recipe)) {
        return emptyInvalidLedger("policy-mismatch", "The reviewed policy recipe does not match the acquisition draft.");
    }
    if (draft.plannedClassGrants.length > 0 || preparedClassGrantPlan) {
        if (!preparedClassGrantPlan) {
            return emptyInvalidLedger("class-grant-invalid", "Class-grant funding requires a freshly prepared authoritative plan.");
        }
        try {
            assertPreparedClassGrantPlanMatches({
                plan: preparedClassGrantPlan,
                actorId: policy.material.subject.actorId,
                draftId: draft.draftId,
                batchId: draft.batchId,
                targetLevel: draft.targetLevel,
                persistedGrants: draft.plannedClassGrants,
            });
        }
        catch {
            return emptyInvalidLedger("class-grant-invalid", "The persisted class-grant description does not match current prepared authority.");
        }
    }
    const blockers = [];
    const allowances = policy.material.allowances;
    const allowanceById = new Map(allowances.map((allowance) => [allowance.allowanceId, allowance]));
    const usedAllowances = new Set();
    const resolvedAllowances = new Map();
    const authoritativeGrants = preparedClassGrantPlan?.grants ?? [];
    const plannedGrants = new Map(authoritativeGrants.map((grant) => [grant.grantId, grant]));
    const usedGrantIds = new Set();
    for (const line of draft.lines) {
        const plannedGrant = line.funding.lane === "class-grant" ? plannedGrants.get(line.funding.grant.plannedGrantId) : null;
        const fixedGrantAuthorizes = plannedGrant?.eligibilityKind === "fixed-class-grant";
        if (!line.policyDecision.eligible && !fixedGrantAuthorizes) {
            blockers.push(blocker("item-ineligible", line.lineId, "Current equipment policy does not permit this item."));
        }
    }
    for (const line of draft.lines.filter((entry) => entry.funding.lane === "allowance" && entry.funding.assignment.mode === "player")) {
        if (line.funding.lane !== "allowance" || line.funding.assignment.mode !== "player")
            continue;
        if (officialRecipe(draft) !== "permanent-items") {
            blockers.push(blocker("recipe-lane-invalid", line.lineId, "The lump-sum recipe cannot consume permanent-item allowances."));
            continue;
        }
        const allowance = allowanceById.get(line.funding.assignment.allowanceId);
        if (!allowance) {
            blockers.push(blocker("allowance-missing", line.lineId, "The selected allowance no longer exists."));
            continue;
        }
        if (usedAllowances.has(allowance.allowanceId)) {
            blockers.push(blocker("allowance-reused", line.lineId, "A permanent-item allowance can fund only one logical line."));
            continue;
        }
        if (!allowanceLineEligible(line)) {
            blockers.push(blocker("recipe-lane-invalid", line.lineId, "Only a permanent baseline item can consume a permanent-item allowance."));
            continue;
        }
        const assignment = SEMANTIC_WEALTH_POLICY.evaluateAllowanceAssignment({
            allowanceLevel: allowance.itemLevel,
            itemLevel: line.itemLevel,
            componentKind: "baseline-item",
            hasBaselineIdentity: true,
        });
        if (!assignment.ok) {
            blockers.push(blocker("allowance-too-low", line.lineId, assignment.diagnostics[0]?.message ?? "The allowance is below the item level."));
            continue;
        }
        usedAllowances.add(allowance.allowanceId);
        resolvedAllowances.set(line.lineId, allowance.allowanceId);
    }
    const automaticLines = draft.lines
        .filter((line) => line.funding.lane === "allowance" && line.funding.assignment.mode === "automatic")
        .sort((left, right) => right.itemLevel - left.itemLevel || left.lineId.localeCompare(right.lineId));
    for (const line of automaticLines) {
        if (officialRecipe(draft) !== "permanent-items") {
            blockers.push(blocker("recipe-lane-invalid", line.lineId, "The lump-sum recipe cannot consume permanent-item allowances."));
            continue;
        }
        if (!allowanceLineEligible(line)) {
            blockers.push(blocker("recipe-lane-invalid", line.lineId, "Only a permanent baseline item can consume a permanent-item allowance."));
            continue;
        }
        const allowance = [...allowanceById.values()]
            .filter((entry) => !usedAllowances.has(entry.allowanceId) && entry.itemLevel >= line.itemLevel)
            .sort((left, right) => left.itemLevel - right.itemLevel || left.allowanceId.localeCompare(right.allowanceId))[0];
        if (!allowance) {
            blockers.push(blocker("allowance-missing", line.lineId, "No remaining allowance can fund this item."));
            continue;
        }
        usedAllowances.add(allowance.allowanceId);
        resolvedAllowances.set(line.lineId, allowance.allowanceId);
    }
    const results = [];
    let spentCopper = 0;
    for (const line of draft.lines) {
        const price = resolveAcquisitionPrice(line.price);
        if (price.ok === false) {
            blockers.push(blocker(price.code, line.lineId, price.message));
            continue;
        }
        let baselineChargedCopper = price.value.baselineCopper;
        const supplementalChargedCopper = price.value.supplementalCopper;
        let resolvedAllowanceId = null;
        if (line.funding.lane === "allowance") {
            resolvedAllowanceId = resolvedAllowances.get(line.lineId) ?? null;
            if (!resolvedAllowanceId && !blockers.some((entry) => entry.lineId === line.lineId)) {
                blockers.push(blocker("allowance-missing", line.lineId, "Allowance funding requires an explicit or automatic assignment."));
            }
            if (price.value.materializedQuantity !== 1) {
                blockers.push(blocker("quantity-invalid", line.lineId, "One allowance can fund exactly one baseline item."));
            }
            baselineChargedCopper = 0;
        }
        else if (line.funding.lane === "class-grant") {
            const grant = plannedGrants.get(line.funding.grant.plannedGrantId);
            const funding = SEMANTIC_WEALTH_POLICY.evaluateClassGrantFunding({
                planned: !!grant,
                sourceSlotId: grant?.origin.sourceSlotId ?? "",
                sourceUuid: grant?.origin.sourceUuid ?? "",
                expectedItemUuid: grant?.expected.sourceUuid ?? "",
            });
            if (!grant ||
                !funding.ok ||
                usedGrantIds.has(line.funding.grant.plannedGrantId) ||
                line.sourceUuid !== grant?.expected.sourceUuid ||
                price.value.materializedQuantity !== 1 ||
                line.componentKind !== "baseline-item" ||
                line.permanence !== "permanent" ||
                (grant.eligibilityEvidence.kind === "titan-mauler" &&
                    (grant.eligibilityEvidence.lineId !== line.lineId ||
                        grant.eligibilityEvidence.lineDocumentFingerprint !== line.documentFingerprint ||
                        grant.eligibilityEvidence.linePriceFingerprint !== line.priceFingerprint ||
                        grant.eligibilityEvidence.policyFingerprint !== policy.fingerprint))) {
                blockers.push(blocker("class-grant-invalid", line.lineId, funding.ok
                    ? "A class grant funds exactly one planned permanent baseline item."
                    : (funding.diagnostics[0]?.message ?? "A class grant funds exactly one planned permanent baseline item.")));
            }
            if (grant)
                usedGrantIds.add(grant.grantId);
            baselineChargedCopper = 0;
        }
        else {
            const eligibility = evaluateCurrencyPurchase(draft, line.itemLevel, line.permanence);
            if (!eligibility.ok) {
                blockers.push(blocker("item-ineligible", line.lineId, eligibility.diagnostics[0]?.message ?? "The item is not eligible under this recipe."));
            }
        }
        const totalChargedCopper = safeAdd(baselineChargedCopper, supplementalChargedCopper);
        if (totalChargedCopper === null) {
            blockers.push(blocker("unsafe-arithmetic", line.lineId, "Line cost exceeds safe integer arithmetic."));
            continue;
        }
        const nextSpent = safeAdd(spentCopper, totalChargedCopper);
        if (nextSpent === null) {
            blockers.push(blocker("unsafe-arithmetic", line.lineId, "Acquisition total exceeds safe integer arithmetic."));
            continue;
        }
        spentCopper = nextSpent;
        results.push({
            lineId: line.lineId,
            sourceUuid: line.sourceUuid,
            materializedQuantity: price.value.materializedQuantity,
            fundingLane: line.funding.lane,
            resolvedAllowanceId,
            baselineChargedCopper,
            supplementalChargedCopper,
            totalChargedCopper,
        });
    }
    for (const grant of authoritativeGrants) {
        if (!usedGrantIds.has(grant.grantId)) {
            blockers.push(blocker("class-grant-invalid", null, `Planned class grant ${grant.grantId} has no acquisition line.`));
        }
    }
    if (spentCopper > policy.material.budgetCopper) {
        blockers.push(blocker("over-budget", null, "The acquisition ledger exceeds its currency budget."));
    }
    const remainingCopper = Math.max(0, policy.material.budgetCopper - spentCopper);
    return {
        valid: blockers.length === 0,
        budgetCopper: policy.material.budgetCopper,
        spentCopper,
        remainingCopper,
        lines: results,
        unusedAllowanceIds: allowances.map((entry) => entry.allowanceId).filter((id) => !usedAllowances.has(id)),
        blockers,
        materialFacts: captureAcquisitionMaterialFacts(draft, resolvedAllowances),
    };
}
export function resolveAcquisitionPrice(price) {
    const resolved = calculateAcquisitionPrice(price);
    if (resolved.ok === false)
        return resolved;
    if (price.materializedQuantity !== resolved.value.materializedQuantity ||
        price.unitPriceCopper !== resolved.value.unitPriceCopper ||
        price.linePriceCopper !== resolved.value.totalCopper) {
        return failedPrice("price-invalid", "The line price snapshot is stale or inconsistent.");
    }
    return resolved;
}
export function createAcquisitionPriceSnapshot(input) {
    const resolved = calculateAcquisitionPrice(input);
    if (resolved.ok === false)
        return resolved;
    return {
        ok: true,
        value: {
            ...input,
            materializedQuantity: resolved.value.materializedQuantity,
            unitPriceCopper: resolved.value.unitPriceCopper,
            linePriceCopper: resolved.value.totalCopper,
        },
    };
}
function calculateAcquisitionPrice(price) {
    if (!safePositiveInteger(price.pricePer) ||
        !safePositiveInteger(price.sourceQuantity) ||
        !safePositiveInteger(price.requestedQuantity)) {
        return failedPrice("quantity-invalid", "Price per, source quantity, and requested quantity must be positive integers.");
    }
    if (price.basePrice.kind === "missing") {
        return failedPrice("price-missing", "The item has no Price.");
    }
    if (price.basePrice.kind === "unparseable") {
        return failedPrice("price-unparseable", "The item Price cannot be parsed.");
    }
    let baseCopper = 0;
    for (const [denomination, factor] of Object.entries({ pp: 1000, gp: 100, sp: 10, cp: 1 })) {
        const amount = price.basePrice.value[denomination] ?? 0;
        const component = safeMultiply(amount, factor);
        baseCopper = component === null ? Number.NaN : (safeAdd(baseCopper, component) ?? Number.NaN);
    }
    if (!safeNonNegativeInteger(baseCopper) || !safeNonNegativeInteger(price.configurationPriceCopper)) {
        return failedPrice("unsafe-arithmetic", "The normalized item price exceeds safe integer arithmetic.");
    }
    const base = SEMANTIC_WEALTH_POLICY.resolveBasePrice({ kind: "priced", copper: baseCopper });
    if (!base.ok || base.value === null) {
        return failedPrice("price-invalid", base.diagnostics[0]?.message ?? "The item Price is invalid.");
    }
    const sized = SEMANTIC_WEALTH_POLICY.resolveSizePricing({
        baseCopper: base.value,
        size: price.size,
        sizeSensitive: price.sizeSensitive,
        preciousMaterial: price.preciousMaterial,
    });
    if (!sized.ok || !sized.value) {
        return failedPrice("price-invalid", sized.diagnostics[0]?.message ?? "The size-adjusted Price is invalid.");
    }
    const adjustedBase = sized.value.strategy === "adjusted-bulk-material"
        ? price.adjustedBulkPriceCopper
        : price.adjustedBulkPriceCopper === null
            ? sized.value.copper
            : null;
    if (adjustedBase === null || !safeNonNegativeInteger(adjustedBase)) {
        return failedPrice("price-invalid", sized.value.strategy === "adjusted-bulk-material"
            ? "Precious-material equipment requires an adjusted-Bulk price."
            : "An adjusted-Bulk price is valid only for precious-material equipment.");
    }
    const unitPriceCopper = safeAdd(adjustedBase, price.configurationPriceCopper);
    const materializedQuantity = safeMultiply(price.sourceQuantity, price.requestedQuantity);
    if (unitPriceCopper === null || materializedQuantity === null) {
        return failedPrice("unsafe-arithmetic", "Line price or quantity exceeds safe integer arithmetic.");
    }
    if (materializedQuantity <= 0)
        return failedPrice("quantity-invalid", "The materialized quantity is invalid.");
    const full = SEMANTIC_WEALTH_POLICY.resolveRequestedPrice({
        unitPriceCopper,
        pricePer: price.pricePer,
        requestedQuantity: materializedQuantity,
    });
    const supplemental = SEMANTIC_WEALTH_POLICY.resolveRequestedPrice({
        unitPriceCopper: price.configurationPriceCopper,
        pricePer: price.pricePer,
        requestedQuantity: materializedQuantity,
    });
    if (!full.ok || full.value === null || !supplemental.ok || supplemental.value === null) {
        return failedPrice("price-invalid", full.diagnostics[0]?.message ?? supplemental.diagnostics[0]?.message ?? "The requested quantity is invalid.");
    }
    const baselineCopper = full.value - supplemental.value;
    if (baselineCopper < 0)
        return failedPrice("price-invalid", "The resolved baseline price is invalid.");
    return {
        ok: true,
        value: {
            materializedQuantity,
            unitPriceCopper,
            baselineCopper,
            supplementalCopper: supplemental.value,
            totalCopper: full.value,
        },
    };
}
export function captureAcquisitionMaterialFacts(draft, resolvedAllowances = new Map()) {
    const policy = draft.policySnapshot;
    if (!policy || !draft.baseline)
        return null;
    return {
        targetLevel: draft.targetLevel,
        recipe: draft.recipe,
        policyFingerprint: policy.fingerprint,
        policyMaterial: {
            ...cloneData(policy.material),
            allowances: [...policy.material.allowances]
                .map((allowance) => ({ ...allowance }))
                .sort((left, right) => left.itemLevel - right.itemLevel || left.allowanceId.localeCompare(right.allowanceId)),
        },
        baseline: cloneData(draft.baseline),
        plannedClassGrants: cloneData(draft.plannedClassGrants),
        lines: draft.lines
            .map((line) => ({
            lineId: line.lineId,
            sourceUuid: line.sourceUuid,
            documentFingerprint: line.documentFingerprint,
            priceFingerprint: line.priceFingerprint,
            itemLevel: line.itemLevel,
            requestedQuantity: line.price.requestedQuantity,
            stackingIntent: line.stackingIntent,
            permanence: line.permanence,
            componentKind: line.componentKind,
            policyDecision: cloneData(line.policyDecision),
            funding: line.funding.lane === "allowance" && line.funding.assignment.mode === "automatic"
                ? {
                    lane: "allowance",
                    assignment: {
                        mode: "player",
                        allowanceId: resolvedAllowances.get(line.lineId) ?? "",
                    },
                }
                : cloneData(line.funding),
        }))
            .sort((left, right) => left.lineId.localeCompare(right.lineId)),
    };
}
export function reviewPurchaseLedger(draft, ledger, reviewer) {
    const review = buildReview(ledger, reviewer);
    if (!draft.lines.some((line) => line.funding.lane !== "class-grant")) {
        throw new TypeError("An empty purchase ledger must use retain-all.");
    }
    return { ...draft, disposition: { kind: "purchase-ledger", review } };
}
export function reviewRetainAll(draft, ledger, reviewer) {
    const review = buildReview(ledger, reviewer);
    if (ledger.spentCopper !== 0 || draft.lines.some((line) => line.funding.lane !== "class-grant")) {
        throw new TypeError("Retain-all cannot include a currency purchase or allowance assignment.");
    }
    return {
        ...draft,
        disposition: { kind: "retain-all", retainedCopper: ledger.remainingCopper, review },
    };
}
export function evaluateAcquisitionCompletion(draft, ledger) {
    if (draft.disposition.kind === "handoff") {
        const complete = !!draft.disposition.acknowledgedByUserId && !!draft.disposition.acknowledgedAt;
        return { complete, disposition: "handoff", reasons: complete ? [] : ["handoff-acknowledgment-required"] };
    }
    if (draft.disposition.kind === "unreviewed") {
        return { complete: false, disposition: "unreviewed", reasons: ["review-required"] };
    }
    if (!ledger.valid || !ledger.materialFacts) {
        return {
            complete: false,
            disposition: draft.disposition.kind,
            reasons: ledger.blockers.map((entry) => entry.code),
        };
    }
    const drift = compareAcquisitionMaterialFacts(draft.disposition.review.materialFacts, ledger.materialFacts);
    if (drift.length > 0 || draft.disposition.review.remainingCopper !== ledger.remainingCopper) {
        return {
            complete: false,
            disposition: draft.disposition.kind,
            reasons: drift.length > 0 ? drift : ["remaining-copper"],
        };
    }
    if (draft.disposition.kind === "purchase-ledger") {
        const hasPurchase = draft.lines.some((line) => line.funding.lane !== "class-grant");
        return {
            complete: hasPurchase,
            disposition: "purchase-ledger",
            reasons: hasPurchase ? [] : ["empty-cart-requires-retain-all"],
        };
    }
    const retainAllValid = ledger.spentCopper === 0 &&
        draft.lines.every((line) => line.funding.lane === "class-grant") &&
        draft.disposition.retainedCopper === ledger.remainingCopper;
    return {
        complete: retainAllValid,
        disposition: "retain-all",
        reasons: retainAllValid ? [] : ["retain-all-mismatch"],
    };
}
export function invalidationReasonsForReviewedLedger(draft, ledger) {
    if ((draft.disposition.kind !== "purchase-ledger" && draft.disposition.kind !== "retain-all") ||
        !ledger.materialFacts) {
        return [];
    }
    return compareAcquisitionMaterialFacts(draft.disposition.review.materialFacts, ledger.materialFacts);
}
function evaluateCurrencyPurchase(draft, itemLevel, permanence) {
    return officialRecipe(draft) === "permanent-items"
        ? SEMANTIC_WEALTH_POLICY.evaluatePermanentRecipePurchase({
            characterLevel: draft.targetLevel,
            itemLevel,
            permanence,
        })
        : SEMANTIC_WEALTH_POLICY.evaluateLumpSumPurchase({
            characterLevel: draft.targetLevel,
            itemLevel,
            rarity: "common",
        });
}
function allowanceLineEligible(line) {
    return line.componentKind === "baseline-item" && line.permanence === "permanent";
}
function officialRecipe(draft) {
    return draft.recipe.kind === "permanent-items" ? "permanent-items" : "lump-sum";
}
function buildReview(ledger, reviewer) {
    if (!ledger.valid || !ledger.materialFacts)
        throw new TypeError("An invalid acquisition ledger cannot be reviewed.");
    if (!nonEmpty(reviewer.userId) || !nonEmpty(reviewer.reviewedAt)) {
        throw new TypeError("Acquisition review requires a reviewer and timestamp.");
    }
    return {
        reviewedByUserId: reviewer.userId,
        reviewedAt: reviewer.reviewedAt,
        materialFacts: cloneData(ledger.materialFacts),
        remainingCopper: ledger.remainingCopper,
    };
}
function emptyInvalidLedger(code, message) {
    return {
        valid: false,
        budgetCopper: 0,
        spentCopper: 0,
        remainingCopper: 0,
        lines: [],
        unusedAllowanceIds: [],
        blockers: [blocker(code, null, message)],
        materialFacts: null,
    };
}
function failedPrice(code, message) {
    return { ok: false, code, message };
}
function blocker(code, lineId, message) {
    return { code, lineId, message };
}
function safeAdd(left, right) {
    const result = left + right;
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
function safeMultiply(left, right) {
    const result = left * right;
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
function safeNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function safePositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
//# sourceMappingURL=acquisition-ledger.js.map