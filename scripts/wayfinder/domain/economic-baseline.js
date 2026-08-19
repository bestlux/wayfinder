import { isClassGrantReconciliationConsistentForPlan, } from "./class-grant-reconciliation.js";
export function createEconomicBaseline(args) {
    if (!nonEmpty(args.actorId) || !validTimestamp(args.capturedAt) || !validCopper(args.currencyCopper)) {
        throw new TypeError("The economic baseline subject, timestamp, or currency is invalid.");
    }
    const physicalItems = args.physicalItems.map(normalizeEconomicPhysicalItem);
    if (physicalItems.some((item) => !item)) {
        throw new TypeError("The economic baseline contains an invalid physical item.");
    }
    const normalizedItems = physicalItems;
    normalizedItems.sort((left, right) => left.itemId.localeCompare(right.itemId));
    if (new Set(normalizedItems.map((item) => item.itemId)).size !== normalizedItems.length) {
        throw new TypeError("The economic baseline contains duplicate physical item IDs.");
    }
    const material = {
        version: 1,
        actorId: args.actorId,
        currencyCopper: args.currencyCopper,
        physicalItems: normalizedItems,
    };
    return {
        ...material,
        capturedAt: args.capturedAt,
        fingerprint: economicBaselineFingerprint(material),
    };
}
export function normalizeEconomicBaseline(raw) {
    if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.physicalItems))
        return null;
    try {
        const normalized = createEconomicBaseline({
            actorId: typeof raw.actorId === "string" ? raw.actorId : "",
            capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : "",
            currencyCopper: typeof raw.currencyCopper === "number" ? raw.currencyCopper : Number.NaN,
            physicalItems: raw.physicalItems,
        });
        return typeof raw.fingerprint === "string" && raw.fingerprint === normalized.fingerprint ? normalized : null;
    }
    catch {
        return null;
    }
}
export function normalizeEconomicHandoff(raw) {
    if (!isRecord(raw) ||
        raw.version !== 1 ||
        raw.kind !== "pf2e-sheet" ||
        !nonEmpty(raw.baselineFingerprint) ||
        !Array.isArray(raw.reasons)) {
        return null;
    }
    const reasons = raw.reasons.map(normalizeHandoffReason);
    if (reasons.length === 0 || reasons.some((reason) => !reason))
        return null;
    return {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: raw.baselineFingerprint,
        reasons: reasons,
    };
}
export function evaluateEconomicAdmission(args) {
    const { baseline } = args;
    if (baseline.actorId.length === 0 ||
        !nonEmpty(args.draftId) ||
        !nonEmpty(args.batchId) ||
        !Number.isInteger(args.targetLevel) ||
        args.targetLevel < 1 ||
        args.targetLevel > 20) {
        throw new TypeError("Economic admission requires a valid actor, acquisition identity, and target level.");
    }
    if (args.history.completedAcquisitionManifestId) {
        return blocked(baseline, "completed-acquisition", "This actor already has a completed starting-equipment manifest.");
    }
    if (args.history.previousCharacterAppliedAt) {
        return blocked(baseline, "prior-character-outcome", "This actor already has a completed Wayfinder character outcome and cannot receive starting wealth again.");
    }
    if (args.targetLevel > 1) {
        const startProblem = higherLevelStartProblem(args.higherLevelStartEvidence, baseline.actorId, args.draftId, args.targetLevel);
        if (startProblem)
            return blocked(baseline, startProblem.code, startProblem.message);
    }
    const reconciliation = args.classGrantReconciliation;
    if (!isClassGrantReconciliationConsistentForPlan(reconciliation, args.preparedClassGrantPlan) ||
        args.preparedClassGrantPlan.subject.actorId !== baseline.actorId ||
        args.preparedClassGrantPlan.subject.draftId !== args.draftId ||
        args.preparedClassGrantPlan.subject.batchId !== args.batchId ||
        args.preparedClassGrantPlan.subject.targetLevel !== args.targetLevel) {
        throw new TypeError("The class-grant reconciliation belongs to another draft or batch.");
    }
    const unresolved = uniqueSorted(reconciliation.unresolvedGrantIds);
    const ambiguous = uniqueSorted(reconciliation.ambiguousGrantIds);
    const ignoredClassGrantItemIds = new Set(reconciliation.ignoredItemIds);
    const retry = args.retryExpectation ?? null;
    if (retry && (retry.draftId !== args.draftId || retry.batchId !== args.batchId)) {
        return blocked(baseline, "retry-identity-mismatch", "The retry expectation belongs to a different draft or batch.");
    }
    const retryEntries = new Map(retry?.expectedEntries.map((entry) => [entry.entryId, entry]) ?? []);
    if (retry && retryEntries.size !== retry.expectedEntries.length) {
        return blocked(baseline, "retry-identity-mismatch", "The retry expectation contains duplicate entry identities.");
    }
    const observedRetryEntries = [];
    const foreignItemIds = [];
    for (const item of baseline.physicalItems) {
        if (ignoredClassGrantItemIds.has(item.itemId))
            continue;
        const identity = item.acquisitionIdentity;
        const expected = identity ? retryEntries.get(identity.entryId) : null;
        if (retry &&
            identity?.draftId === args.draftId &&
            identity.batchId === args.batchId &&
            expected?.lineId === identity.lineId &&
            expected.stackingIntent === identity.stackingIntent &&
            expected.sourceUuid === item.sourceUuid &&
            expected.quantity === item.quantity &&
            expected.containerId === item.containerId &&
            !observedRetryEntries.includes(identity.entryId)) {
            observedRetryEntries.push(identity.entryId);
            continue;
        }
        foreignItemIds.push(item.itemId);
    }
    const handoffReasons = [];
    if (foreignItemIds.length > 0) {
        handoffReasons.push({ code: "foreign-physical-items", itemIds: uniqueSorted(foreignItemIds) });
    }
    if (unresolved.length > 0)
        handoffReasons.push({ code: "unresolved-class-grant", grantIds: unresolved });
    if (ambiguous.length > 0)
        handoffReasons.push({ code: "ambiguous-class-grant", grantIds: ambiguous });
    const retryCurrencyMatches = !!retry && observedRetryEntries.length > 0 && baseline.currencyCopper === retry.expectedCurrencyCopper;
    if (baseline.currencyCopper !== 0 && !retryCurrencyMatches) {
        handoffReasons.push({ code: "nonzero-currency", copper: baseline.currencyCopper });
    }
    if (handoffReasons.length > 0) {
        return {
            kind: "handoff",
            baseline,
            handoff: { version: 1, kind: "pf2e-sheet", baselineFingerprint: baseline.fingerprint, reasons: handoffReasons },
        };
    }
    if (retry && observedRetryEntries.length > 0) {
        return { kind: "eligible-retry", baseline, entryIds: uniqueSorted(observedRetryEntries) };
    }
    return { kind: "eligible-empty", baseline };
}
export function compareEconomicBaselines(reviewed, current) {
    const differences = [];
    if (reviewed.actorId !== current.actorId) {
        differences.push({ code: "actor", message: "The reviewed economic baseline belongs to another actor." });
    }
    if (reviewed.currencyCopper !== current.currencyCopper) {
        differences.push({ code: "currency", message: "Actor currency changed after equipment review." });
    }
    if (canonicalJson(reviewed.physicalItems) !== canonicalJson(current.physicalItems)) {
        differences.push({ code: "physical-items", message: "Actor physical inventory changed after equipment review." });
    }
    return differences;
}
export async function executeWithEconomicBaselineRevalidation(args) {
    const current = await args.captureCurrent();
    const differences = compareEconomicBaselines(args.reviewed, current);
    if (differences.length > 0)
        return { ok: false, differences };
    return { ok: true, value: await args.write() };
}
export function normalizeAcquisitionIdentity(raw) {
    if (!isRecord(raw) ||
        !nonEmpty(raw.draftId) ||
        !nonEmpty(raw.batchId) ||
        !nonEmpty(raw.lineId) ||
        !nonEmpty(raw.entryId) ||
        (raw.plannedGrantId !== null && !nonEmpty(raw.plannedGrantId)) ||
        (raw.stackingIntent !== "aggregate" && raw.stackingIntent !== "separate")) {
        return null;
    }
    const plannedGrantId = raw.plannedGrantId === null ? null : String(raw.plannedGrantId);
    return {
        draftId: raw.draftId,
        batchId: raw.batchId,
        lineId: raw.lineId,
        entryId: raw.entryId,
        plannedGrantId,
        stackingIntent: raw.stackingIntent,
    };
}
function normalizeEconomicPhysicalItem(raw) {
    if (!isRecord(raw) ||
        !nonEmpty(raw.itemId) ||
        !nonEmpty(raw.type) ||
        !Number.isInteger(raw.quantity) ||
        raw.quantity < 0 ||
        (raw.sourceUuid !== null && typeof raw.sourceUuid !== "string") ||
        (raw.containerId !== null && typeof raw.containerId !== "string")) {
        return null;
    }
    const acquisitionIdentity = raw.acquisitionIdentity === null ? null : normalizeAcquisitionIdentity(raw.acquisitionIdentity);
    if (raw.acquisitionIdentity !== null && !acquisitionIdentity)
        return null;
    return {
        itemId: raw.itemId,
        type: raw.type,
        sourceUuid: raw.sourceUuid,
        quantity: raw.quantity,
        containerId: raw.containerId,
        acquisitionIdentity,
    };
}
function normalizeHandoffReason(raw) {
    if (!isRecord(raw))
        return null;
    if (raw.code === "nonzero-currency") {
        return validCopper(raw.copper) && raw.copper > 0
            ? { code: raw.code, copper: raw.copper }
            : null;
    }
    if (raw.code !== "foreign-physical-items" &&
        raw.code !== "unresolved-class-grant" &&
        raw.code !== "ambiguous-class-grant") {
        return null;
    }
    const field = raw.code === "foreign-physical-items" ? "itemIds" : "grantIds";
    const values = raw[field];
    if (!Array.isArray(values) || values.some((value) => !nonEmpty(value)))
        return null;
    const normalized = uniqueSorted(values);
    return normalized.length > 0
        ? raw.code === "foreign-physical-items"
            ? { code: raw.code, itemIds: normalized }
            : { code: raw.code, grantIds: normalized }
        : null;
}
function higherLevelStartProblem(evidence, actorId, draftId, targetLevel) {
    if (evidence.kind === "not-required") {
        return {
            code: "higher-level-start-context-missing",
            message: "A higher-level new or replacement character requires a persisted start-context claim.",
        };
    }
    const subject = evidence.kind === "gm-confirmation" ? evidence.judgment : evidence;
    if (subject.actorId !== actorId || subject.draftId !== draftId || subject.targetLevel !== targetLevel) {
        return {
            code: "higher-level-start-context-mismatch",
            message: "The higher-level start-context claim does not match this actor, draft, and target level.",
        };
    }
    const startKind = evidence.startKind;
    if (startKind !== "new-campaign" && startKind !== "replacement-character") {
        return {
            code: "higher-level-start-context-mismatch",
            message: "The higher-level start-context claim has an invalid purpose.",
        };
    }
    return null;
}
function blocked(baseline, code, message) {
    return { kind: "blocked", baseline, code, message };
}
function economicBaselineFingerprint(value) {
    const text = canonicalJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `economic-baseline-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function uniqueSorted(values) {
    return [...new Set(values.filter(nonEmpty))].sort((left, right) => left.localeCompare(right));
}
function validCopper(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function validTimestamp(value) {
    return nonEmpty(value) && Number.isFinite(Date.parse(value));
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=economic-baseline.js.map