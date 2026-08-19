const INVALIDATION_ORDER = [
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
export function createAcquisitionDraft(args) {
    if (!nonEmpty(args.draftId) || !nonEmpty(args.batchId)) {
        throw new TypeError("Acquisition IDs must be created before draft initialization.");
    }
    if (!validTargetLevel(args.targetLevel)) {
        throw new RangeError("Acquisition target level must be 1 through 20.");
    }
    const recipe = normalizeRecipe(args.recipe);
    if (!recipe)
        throw new TypeError("Acquisition recipe is invalid.");
    return {
        schemaVersion: 1,
        draftId: args.draftId,
        batchId: args.batchId,
        targetLevel: args.targetLevel,
        recipe,
        policySnapshot: null,
        baseline: null,
        lines: [],
        disposition: unreviewed(),
    };
}
export function normalizeAcquisitionDraft(raw) {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !nonEmpty(raw.draftId) || !nonEmpty(raw.batchId)) {
        return null;
    }
    const recipe = normalizeRecipe(raw.recipe);
    if (!validTargetLevel(raw.targetLevel) || !recipe || !Array.isArray(raw.lines))
        return null;
    const lines = raw.lines.map(normalizeLine);
    if (lines.some((line) => !line))
        return null;
    const normalizedLines = lines;
    if (new Set(normalizedLines.map((line) => line.lineId)).size !== normalizedLines.length)
        return null;
    const policySnapshot = normalizePolicySnapshot(raw.policySnapshot);
    if (raw.policySnapshot != null && !policySnapshot)
        return null;
    const baseline = normalizeBaseline(raw.baseline);
    if (raw.baseline != null && !baseline)
        return null;
    return {
        schemaVersion: 1,
        draftId: raw.draftId,
        batchId: raw.batchId,
        targetLevel: raw.targetLevel,
        recipe,
        policySnapshot,
        baseline,
        lines: normalizedLines,
        disposition: normalizeDisposition(raw.disposition, normalizedLines, policySnapshot),
    };
}
export function compareAcquisitionMaterialFacts(reviewed, current) {
    const reasons = new Set();
    if (reviewed.targetLevel !== current.targetLevel)
        reasons.add("target-level");
    if (!same(reviewed.recipe, current.recipe))
        reasons.add("recipe");
    comparePolicyMaterial(reviewed.policyMaterial, current.policyMaterial, reasons);
    if (!same(reviewed.baseline, current.baseline))
        reasons.add("baseline");
    const reviewedLines = new Map(reviewed.lines.map((line) => [line.lineId, line]));
    const currentLines = new Map(current.lines.map((line) => [line.lineId, line]));
    if (reviewedLines.size !== currentLines.size)
        reasons.add("document");
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
export function invalidateAcquisitionReview(draft, reasons) {
    const normalizedReasons = INVALIDATION_ORDER.filter((reason) => reasons.includes(reason));
    if (normalizedReasons.length === 0 ||
        draft.disposition.kind === "unreviewed" ||
        draft.disposition.kind === "handoff") {
        return draft;
    }
    const clearAssignments = normalizedReasons.includes("target-level") || normalizedReasons.includes("recipe");
    return {
        ...draft,
        lines: clearAssignments
            ? draft.lines.map((line) => ({
                ...line,
                funding: line.funding.lane === "allowance"
                    ? { lane: "allowance", assignment: { mode: "automatic" } }
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
export function reconcileAcquisitionTargetLevel(draft, targetLevel) {
    if (!validTargetLevel(targetLevel)) {
        throw new RangeError("Acquisition target level must be 1 through 20.");
    }
    if (draft.targetLevel === targetLevel)
        return draft;
    const changed = { ...draft, targetLevel, policySnapshot: null };
    if (draft.disposition.kind === "purchase-ledger" || draft.disposition.kind === "retain-all") {
        return invalidateAcquisitionReview(changed, ["target-level"]);
    }
    return {
        ...changed,
        lines: changed.lines.map((line) => ({
            ...line,
            funding: line.funding.lane === "allowance"
                ? { lane: "allowance", assignment: { mode: "automatic" } }
                : line.funding,
        })),
        disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: ["target-level"] },
    };
}
function comparePolicyMaterial(reviewed, current, reasons) {
    if (!same(reviewed.resolvedRecipe, current.resolvedRecipe))
        reasons.add("recipe");
    if (reviewed.budgetCopper !== current.budgetCopper)
        reasons.add("budget");
    if (!same(reviewed.allowances, current.allowances))
        reasons.add("allowance");
    if (!same(reviewed.numericPolicyRef, current.numericPolicyRef) ||
        !same(reviewed.semanticPolicyRef, current.semanticPolicyRef) ||
        reviewed.applyAuthorityBasis !== current.applyAuthorityBasis) {
        reasons.add("policy");
    }
}
function compareLineMaterial(reviewed, current, reasons) {
    if (reviewed.sourceUuid !== current.sourceUuid ||
        reviewed.documentFingerprint !== current.documentFingerprint ||
        reviewed.itemLevel !== current.itemLevel ||
        reviewed.stackingIntent !== current.stackingIntent ||
        reviewed.permanence !== current.permanence ||
        reviewed.componentKind !== current.componentKind) {
        reasons.add("document");
    }
    if (reviewed.priceFingerprint !== current.priceFingerprint)
        reasons.add("price");
    if (reviewed.requestedQuantity !== current.requestedQuantity)
        reasons.add("quantity");
    if (!same(reviewed.funding, current.funding))
        reasons.add("allowance");
    if (!same(reviewed.policyDecision, current.policyDecision))
        reasons.add("policy");
}
function normalizeLine(raw) {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !nonEmpty(raw.lineId) || !nonEmpty(raw.sourceUuid)) {
        return null;
    }
    if (!nonEmpty(raw.documentFingerprint) ||
        !nonEmpty(raw.priceFingerprint) ||
        !safeNonNegativeInteger(raw.itemLevel) ||
        !isOneOf(raw.permanence, ["consumable", "permanent"]) ||
        !isOneOf(raw.componentKind, ["baseline-item", "property-rune", "precious-material"]) ||
        !isOneOf(raw.stackingIntent, ["aggregate", "separate"])) {
        return null;
    }
    const policyDecision = normalizeLinePolicyDecision(raw.policyDecision);
    const funding = normalizeFunding(raw.funding);
    const price = normalizePrice(raw.price);
    if (!policyDecision || !funding || !price)
        return null;
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
function normalizeFunding(raw) {
    if (!isRecord(raw) || !isOneOf(raw.lane, ["currency", "allowance", "class-grant"]))
        return null;
    if (raw.lane === "currency")
        return hasOnlyKeys(raw, ["lane"]) ? { lane: "currency" } : null;
    if (raw.lane === "allowance") {
        if (!hasOnlyKeys(raw, ["lane", "assignment"]) ||
            !isRecord(raw.assignment) ||
            !isOneOf(raw.assignment.mode, ["automatic", "player"])) {
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
    if (!hasOnlyKeys(raw, ["lane", "grant"]) || !isRecord(raw.grant))
        return null;
    return nonEmpty(raw.grant.plannedSourceUuid) &&
        nonEmpty(raw.grant.sourceSlotId) &&
        nonEmpty(raw.grant.expectedItemSourceUuid) &&
        hasOnlyKeys(raw.grant, ["plannedSourceUuid", "sourceSlotId", "expectedItemSourceUuid"])
        ? {
            lane: "class-grant",
            grant: {
                plannedSourceUuid: raw.grant.plannedSourceUuid,
                sourceSlotId: raw.grant.sourceSlotId,
                expectedItemSourceUuid: raw.grant.expectedItemSourceUuid,
            },
        }
        : null;
}
function normalizeLinePolicyDecision(raw) {
    const accessOrExceptionRef = isRecord(raw) ? raw.accessOrExceptionRef : undefined;
    if (!isRecord(raw) ||
        typeof raw.eligible !== "boolean" ||
        !nonEmpty(raw.sourceBasis) ||
        !nonEmpty(raw.rarityBasis) ||
        (accessOrExceptionRef !== null && !nonEmpty(accessOrExceptionRef)) ||
        !nonEmpty(raw.abpTreatment)) {
        return null;
    }
    return {
        eligible: raw.eligible,
        sourceBasis: raw.sourceBasis,
        rarityBasis: raw.rarityBasis,
        accessOrExceptionRef: accessOrExceptionRef === null ? null : String(accessOrExceptionRef),
        abpTreatment: raw.abpTreatment,
    };
}
function normalizePrice(raw) {
    if (!isRecord(raw))
        return null;
    const basePrice = normalizeBasePrice(raw.basePrice);
    const adjustedBulkPriceCopper = raw.adjustedBulkPriceCopper;
    if (!basePrice ||
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
        !safeNonNegativeInteger(raw.linePriceCopper)) {
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
    };
}
function normalizeBasePrice(raw) {
    if (!isRecord(raw) || !isOneOf(raw.kind, ["priced", "missing", "unparseable"]))
        return null;
    if (raw.kind !== "priced")
        return hasOnlyKeys(raw, ["kind"]) ? { kind: raw.kind } : null;
    const rawValue = raw.value;
    if (!hasOnlyKeys(raw, ["kind", "value"]) ||
        !isRecord(rawValue) ||
        Object.keys(rawValue).some((key) => !["cp", "sp", "gp", "pp"].includes(key))) {
        return null;
    }
    const value = Object.fromEntries(["pp", "gp", "sp", "cp"].flatMap((denomination) => {
        const amount = rawValue[denomination];
        return amount === undefined ? [] : [[denomination, amount]];
    }));
    return Object.values(value).every(safeNonNegativeInteger) ? { kind: "priced", value } : null;
}
function normalizePolicySnapshot(raw) {
    if (raw == null)
        return null;
    if (!isRecord(raw) || raw.version !== 1 || !nonEmpty(raw.fingerprint))
        return null;
    const material = normalizePolicyMaterial(raw.material);
    return material ? { version: 1, fingerprint: raw.fingerprint, material } : null;
}
function normalizePolicyMaterial(raw) {
    if (!isRecord(raw) || !isRecord(raw.numericPolicyRef) || !isRecord(raw.semanticPolicyRef))
        return null;
    const numericPolicyRef = raw.numericPolicyRef;
    const semanticPolicyRef = raw.semanticPolicyRef;
    const resolvedRecipe = normalizeRecipe(raw.resolvedRecipe);
    if (numericPolicyRef.policyId !== "pf2e-remaster-character-wealth" ||
        !safePositiveInteger(numericPolicyRef.policyVersion) ||
        !nonEmpty(numericPolicyRef.dataDigest) ||
        semanticPolicyRef.policyId !== "pf2e-remaster-semantic-wealth" ||
        semanticPolicyRef.policyVersion !== 1 ||
        !resolvedRecipe ||
        !safeNonNegativeInteger(raw.budgetCopper) ||
        !Array.isArray(raw.allowances) ||
        !nonEmpty(raw.applyAuthorityBasis)) {
        return null;
    }
    const allowances = raw.allowances.flatMap((entry) => isRecord(entry) && nonEmpty(entry.allowanceId) && safeNonNegativeInteger(entry.itemLevel)
        ? [{ allowanceId: entry.allowanceId, itemLevel: entry.itemLevel }]
        : []);
    if (allowances.length !== raw.allowances.length ||
        new Set(allowances.map((entry) => entry.allowanceId)).size !== allowances.length) {
        return null;
    }
    return {
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
        allowances: [...allowances].sort((left, right) => left.itemLevel - right.itemLevel || left.allowanceId.localeCompare(right.allowanceId)),
        applyAuthorityBasis: raw.applyAuthorityBasis,
    };
}
function normalizeBaseline(raw) {
    return isRecord(raw) && raw.version === 1 && nonEmpty(raw.actorId) && nonEmpty(raw.fingerprint)
        ? { version: 1, actorId: raw.actorId, fingerprint: raw.fingerprint }
        : null;
}
function normalizeDisposition(raw, lines, policy) {
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
        return nonEmpty(raw.reason) && nonEmpty(raw.acknowledgedByUserId) && nonEmpty(raw.acknowledgedAt)
            ? {
                kind: "handoff",
                reason: raw.reason,
                acknowledgedByUserId: raw.acknowledgedByUserId,
                acknowledgedAt: raw.acknowledgedAt,
            }
            : unreviewed();
    }
    const review = normalizeReview(raw.review, lines, policy);
    if (!review)
        return { kind: "unreviewed", invalidatedFrom: raw.kind, reasons: ["policy"] };
    if (raw.kind === "purchase-ledger")
        return { kind: "purchase-ledger", review };
    return safeNonNegativeInteger(raw.retainedCopper)
        ? { kind: "retain-all", retainedCopper: raw.retainedCopper, review }
        : { kind: "unreviewed", invalidatedFrom: "retain-all", reasons: ["budget"] };
}
function normalizeReview(raw, lines, policy) {
    if (!isRecord(raw) ||
        !nonEmpty(raw.reviewedByUserId) ||
        !nonEmpty(raw.reviewedAt) ||
        !safeNonNegativeInteger(raw.remainingCopper)) {
        return null;
    }
    const facts = normalizeMaterialFacts(raw.materialFacts);
    if (!facts || !policy || facts.lines.length !== lines.length)
        return null;
    return {
        reviewedByUserId: raw.reviewedByUserId,
        reviewedAt: raw.reviewedAt,
        materialFacts: facts,
        remainingCopper: raw.remainingCopper,
    };
}
function normalizeMaterialFacts(raw) {
    if (!isRecord(raw))
        return null;
    const recipe = normalizeRecipe(raw.recipe);
    const policyMaterial = normalizePolicyMaterial(raw.policyMaterial);
    const baseline = normalizeBaseline(raw.baseline);
    if (!validTargetLevel(raw.targetLevel) ||
        !recipe ||
        !nonEmpty(raw.policyFingerprint) ||
        !policyMaterial ||
        !baseline ||
        !Array.isArray(raw.lines)) {
        return null;
    }
    const lines = raw.lines.flatMap(normalizeMaterialLine);
    if (lines.length !== raw.lines.length || new Set(lines.map((line) => line.lineId)).size !== lines.length) {
        return null;
    }
    return {
        targetLevel: raw.targetLevel,
        recipe,
        policyFingerprint: raw.policyFingerprint,
        policyMaterial,
        baseline,
        lines,
    };
}
function normalizeMaterialLine(raw) {
    if (!isRecord(raw) ||
        !nonEmpty(raw.lineId) ||
        !nonEmpty(raw.sourceUuid) ||
        !nonEmpty(raw.documentFingerprint) ||
        !nonEmpty(raw.priceFingerprint) ||
        !safeNonNegativeInteger(raw.itemLevel) ||
        !safePositiveInteger(raw.requestedQuantity) ||
        !isOneOf(raw.stackingIntent, ["aggregate", "separate"]) ||
        !isOneOf(raw.permanence, ["consumable", "permanent"]) ||
        !isOneOf(raw.componentKind, ["baseline-item", "property-rune", "precious-material"])) {
        return [];
    }
    const policyDecision = normalizeLinePolicyDecision(raw.policyDecision);
    const funding = normalizeFunding(raw.funding);
    if (!policyDecision || !funding)
        return [];
    return [
        {
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
        },
    ];
}
function normalizeRecipe(raw) {
    if (!isRecord(raw) || !isOneOf(raw.kind, ["permanent-items", "lump-sum", "custom-lump-sum"])) {
        return null;
    }
    if (raw.kind !== "custom-lump-sum")
        return { kind: raw.kind };
    return nonEmpty(raw.judgmentRef) && safeNonNegativeInteger(raw.amountCopper)
        ? { kind: "custom-lump-sum", judgmentRef: raw.judgmentRef, amountCopper: raw.amountCopper }
        : null;
}
function unreviewed() {
    return { kind: "unreviewed", invalidatedFrom: null, reasons: [] };
}
function validTargetLevel(value) {
    return safePositiveInteger(value) && value <= 20;
}
function safePositiveInteger(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
function safeNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function isOneOf(value, options) {
    return typeof value === "string" && options.includes(value);
}
function hasOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
}
function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
//# sourceMappingURL=acquisition-draft.js.map