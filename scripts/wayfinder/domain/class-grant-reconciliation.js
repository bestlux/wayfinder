import { supportedPhysicalGrantRoute, } from "./physical-grant-route-registry.js";
import { SEMANTIC_WEALTH_POLICY } from "./semantic-wealth-policy.js";
export { CLASS_GRANT_PROFILE_UUIDS, } from "./physical-grant-route-registry.js";
const preparedPlans = new WeakSet();
export function createPlannedClassGrant(grant) {
    const normalized = normalizePlannedClassGrant({ ...grant, version: 1, fundingLane: "class-grant" });
    if (!normalized)
        throw new TypeError("The planned class grant is invalid.");
    return normalized;
}
export function createPreparedClassGrantPlan(args) {
    if (!nonEmpty(args.actorId) ||
        !nonEmpty(args.draftId) ||
        !nonEmpty(args.batchId) ||
        !Number.isInteger(args.targetLevel) ||
        args.targetLevel < 1 ||
        args.targetLevel > 20) {
        throw new TypeError("A prepared class-grant plan requires an actor, draft, batch, and target level.");
    }
    const grants = args.grants.map(normalizePlannedClassGrant);
    if (grants.some((grant) => !grant))
        throw new TypeError("A prepared class-grant plan contains an invalid grant.");
    const normalized = grants.sort((left, right) => left.grantId.localeCompare(right.grantId));
    if (new Set(normalized.map((grant) => grant.grantId)).size !== normalized.length) {
        throw new TypeError("A prepared class-grant plan contains duplicate grant IDs.");
    }
    const subject = {
        actorId: args.actorId,
        draftId: args.draftId,
        batchId: args.batchId,
        targetLevel: args.targetLevel,
    };
    const plan = Object.freeze({
        version: 1,
        subject: Object.freeze(subject),
        grants: Object.freeze(normalized.map((grant) => deepFreezeGrant(grant))),
        fingerprint: fingerprint({ subject, grants: normalized }),
    });
    preparedPlans.add(plan);
    return plan;
}
export function isPreparedClassGrantPlan(value) {
    return isRecord(value) && preparedPlans.has(value);
}
export function assertPreparedClassGrantPlanMatches(args) {
    if (!isPreparedClassGrantPlan(args.plan))
        throw new TypeError("Class-grant authority must be freshly prepared.");
    const expected = createPreparedClassGrantPlan({
        actorId: args.actorId,
        draftId: args.draftId,
        batchId: args.batchId,
        targetLevel: args.targetLevel,
        grants: args.persistedGrants,
    });
    if (args.plan.subject.actorId !== expected.subject.actorId ||
        args.plan.subject.draftId !== expected.subject.draftId ||
        args.plan.subject.batchId !== expected.subject.batchId ||
        args.plan.subject.targetLevel !== expected.subject.targetLevel ||
        canonicalJson(args.plan.grants) !== canonicalJson(expected.grants)) {
        throw new TypeError("The persisted class-grant description does not match current prepared authority.");
    }
}
export function normalizePlannedClassGrant(raw) {
    if (!isRecord(raw) || raw.version !== 1 || raw.fundingLane !== "class-grant")
        return null;
    if (!nonEmpty(raw.grantId) ||
        !isProfileId(raw.profileId) ||
        !isRecord(raw.origin) ||
        !nonEmpty(raw.origin.sourceSlotId) ||
        !nonEmpty(raw.origin.sourceUuid) ||
        !nonEmpty(raw.granterSourceUuid) ||
        !isRecord(raw.expected) ||
        !nonEmpty(raw.expected.sourceUuid) ||
        raw.expected.quantity !== 1 ||
        (raw.expected.itemType !== "equipment" && raw.expected.itemType !== "weapon") ||
        (raw.materializer !== "pf2e-native" && raw.materializer !== "wayfinder-acquisition") ||
        (raw.eligibilityKind !== "fixed-class-grant" && raw.eligibilityKind !== "catalogue-choice") ||
        (raw.resaleRule !== "normal" && raw.resaleRule !== "zero-until-rune-investment") ||
        !isRecord(raw.eligibilityEvidence) ||
        !Array.isArray(raw.nativeGrantChainSourceUuids) ||
        raw.nativeGrantChainSourceUuids.some((entry) => !nonEmpty(entry))) {
        return null;
    }
    const nativeChain = [...new Set(raw.nativeGrantChainSourceUuids)];
    const eligibilityEvidence = normalizeEligibilityEvidence(raw.eligibilityEvidence);
    if (!eligibilityEvidence ||
        nativeChain.length !== raw.nativeGrantChainSourceUuids.length ||
        (raw.materializer === "pf2e-native" && nativeChain.length === 0) ||
        (raw.materializer === "wayfinder-acquisition" && nativeChain.length !== 0) ||
        (raw.eligibilityKind === "fixed-class-grant" && raw.materializer !== "pf2e-native") ||
        (raw.profileId === "giant-instinct-titan-mauler") !==
            (raw.materializer === "wayfinder-acquisition" &&
                raw.expected.itemType === "weapon" &&
                raw.resaleRule === "zero-until-rune-investment" &&
                raw.eligibilityKind === "catalogue-choice") ||
        (raw.materializer === "pf2e-native" && nativeChain[0] !== raw.granterSourceUuid) ||
        (raw.materializer === "pf2e-native" && !nativeChain.includes(raw.origin.sourceUuid)) ||
        (raw.eligibilityKind === "fixed-class-grant" && eligibilityEvidence.kind !== "fixed-native-profile") ||
        (raw.profileId === "giant-instinct-titan-mauler") !== (eligibilityEvidence.kind === "titan-mauler")) {
        return null;
    }
    const normalized = {
        version: 1,
        grantId: raw.grantId,
        profileId: raw.profileId,
        origin: { sourceSlotId: raw.origin.sourceSlotId, sourceUuid: raw.origin.sourceUuid },
        granterSourceUuid: raw.granterSourceUuid,
        expected: {
            sourceUuid: raw.expected.sourceUuid,
            quantity: 1,
            itemType: raw.expected.itemType,
        },
        fundingLane: "class-grant",
        materializer: raw.materializer,
        eligibilityKind: raw.eligibilityKind,
        resaleRule: raw.resaleRule,
        eligibilityEvidence,
        nativeGrantChainSourceUuids: nativeChain,
    };
    return canonicalProfileMatches(normalized) ? normalized : null;
}
export function evaluateTitanMaulerCandidate(candidate) {
    if (!candidate.sourceAllowed) {
        return failure("source-not-allowed", "The Titan Mauler weapon must come from an allowed equipment source.");
    }
    if (candidate.itemType !== "weapon") {
        return failure("not-a-weapon", "Titan Mauler grants a physical weapon.");
    }
    if (!nonEmpty(candidate.weaponCategory)) {
        return failure("not-a-weapon", "The Titan Mauler weapon category is unavailable.");
    }
    if (candidate.weaponCategory === "unarmed") {
        return failure("unarmed-weapon", "An unarmed attack is not a Titan Mauler weapon.");
    }
    if (candidate.rangeIncrement !== null &&
        (!Number.isFinite(candidate.rangeIncrement) || candidate.rangeIncrement <= 0)) {
        return failure("range-invalid", "A ranged Titan Mauler weapon needs a positive range increment.");
    }
    if (candidate.rarity !== "common" && !nonEmpty(candidate.characterAccessRef)) {
        return failure("rarity-or-access-invalid", "The Titan Mauler weapon must be Common or specifically accessed by this character.");
    }
    if (!safeNonNegativeInteger(candidate.basePriceCopper)) {
        return failure("price-invalid", "The Titan Mauler weapon needs a parseable pre-size base Price.");
    }
    const expectedSize = titanMaulerTargetSize(candidate.actorSize);
    if (!expectedSize || candidate.targetSize !== expectedSize) {
        return failure("size-invalid", "The Titan Mauler weapon must be Large for a Small or Medium character, or one size larger otherwise.");
    }
    if (candidate.quantity !== 1 || candidate.permanence !== "permanent" || candidate.componentKind !== "baseline-item") {
        return failure("line-shape-invalid", "Titan Mauler grants exactly one permanent baseline weapon.");
    }
    const result = SEMANTIC_WEALTH_POLICY.evaluateTitanMaulerGrant({
        isWeapon: true,
        isMeleeOrRanged: true,
        isOneSizeLarger: true,
        rarity: candidate.rarity,
        hasCharacterAccess: nonEmpty(candidate.characterAccessRef),
        basePriceCopper: candidate.basePriceCopper,
    });
    return result.ok
        ? { ok: true, targetSize: expectedSize, resaleCopper: 0 }
        : failure("price-invalid", "The Titan Mauler weapon's pre-size base Price must be 9 gp or less.");
}
export function reconcilePlannedClassGrants(args) {
    if (!nonEmpty(args.draftId) || !nonEmpty(args.batchId)) {
        throw new TypeError("Class-grant reconciliation requires a draft and batch identity.");
    }
    const plan = args.plan.map(normalizePlannedClassGrant);
    if (plan.some((grant) => !grant))
        throw new TypeError("Class-grant reconciliation received an invalid plan.");
    const grants = plan;
    if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
        throw new TypeError("Class-grant reconciliation received duplicate grant IDs.");
    }
    const itemsById = new Map(args.actorItems.map((item) => [item.itemId, item]));
    if (itemsById.size !== args.actorItems.length || args.actorItems.some((item) => !validObservedItem(item))) {
        throw new TypeError("Class-grant reconciliation received invalid actor items.");
    }
    const entries = grants.map((grant) => {
        const matches = args.actorItems.filter((item) => matchesPlannedGrant(item, grant, itemsById, args));
        if (matches.length === 1)
            return { grantId: grant.grantId, status: "resolved", itemIds: [matches[0].itemId] };
        if (matches.length > 1) {
            return { grantId: grant.grantId, status: "ambiguous", itemIds: unique(matches.map((item) => item.itemId)) };
        }
        return {
            grantId: grant.grantId,
            status: args.phase === "before-acquisition" ? "pending" : "unresolved",
            itemIds: [],
        };
    });
    return {
        version: 1,
        draftId: args.draftId,
        batchId: args.batchId,
        phase: args.phase,
        entries,
        ignoredItemIds: unique(entries.flatMap((entry) => (entry.status === "resolved" ? entry.itemIds : []))),
        unresolvedGrantIds: unique(entries.filter((entry) => entry.status === "unresolved").map((entry) => entry.grantId)),
        ambiguousGrantIds: unique(entries.filter((entry) => entry.status === "ambiguous").map((entry) => entry.grantId)),
    };
}
export function reconcilePreparedClassGrants(args) {
    if (!isPreparedClassGrantPlan(args.plan))
        throw new TypeError("Class grants must be freshly prepared.");
    return reconcilePlannedClassGrants({
        plan: args.plan.grants,
        actorItems: args.actorItems,
        phase: args.phase,
        draftId: args.plan.subject.draftId,
        batchId: args.plan.subject.batchId,
    });
}
export function isClassGrantReconciliationConsistent(result) {
    if (result.version !== 1 ||
        !nonEmpty(result.draftId) ||
        !nonEmpty(result.batchId) ||
        !["before-acquisition", "after-acquisition", "final"].includes(result.phase)) {
        return false;
    }
    const grantIds = result.entries.map((entry) => entry.grantId);
    if (grantIds.some((id) => !nonEmpty(id)) || new Set(grantIds).size !== grantIds.length)
        return false;
    if (result.entries.some((entry) => !["resolved", "pending", "unresolved", "ambiguous"].includes(entry.status) ||
        entry.itemIds.some((id) => !nonEmpty(id)) ||
        new Set(entry.itemIds).size !== entry.itemIds.length ||
        (entry.status === "resolved" && entry.itemIds.length !== 1) ||
        ((entry.status === "pending" || entry.status === "unresolved") && entry.itemIds.length !== 0) ||
        (entry.status === "ambiguous" && entry.itemIds.length < 2))) {
        return false;
    }
    const expectedIgnored = unique(result.entries.flatMap((entry) => (entry.status === "resolved" ? entry.itemIds : [])));
    const expectedUnresolved = unique(result.entries.filter((entry) => entry.status === "unresolved").map((entry) => entry.grantId));
    const expectedAmbiguous = unique(result.entries.filter((entry) => entry.status === "ambiguous").map((entry) => entry.grantId));
    return (sameStrings(result.ignoredItemIds, expectedIgnored) &&
        sameStrings(result.unresolvedGrantIds, expectedUnresolved) &&
        sameStrings(result.ambiguousGrantIds, expectedAmbiguous));
}
export function normalizeClassGrantReconciliationResult(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.entries))
        return null;
    const result = raw;
    if (!isClassGrantReconciliationConsistent(result))
        return null;
    return structuredClone(result);
}
export function isClassGrantReconciliationConsistentForPlan(result, plan) {
    if (!isPreparedClassGrantPlan(plan) || !isClassGrantReconciliationConsistent(result))
        return false;
    if (result.draftId !== plan.subject.draftId ||
        result.batchId !== plan.subject.batchId ||
        (result.phase !== "before-acquisition" && result.entries.some((entry) => entry.status === "pending"))) {
        return false;
    }
    const expectedIds = plan.grants.map((grant) => grant.grantId).sort();
    return sameStrings(result.entries.map((entry) => entry.grantId), expectedIds);
}
function matchesPlannedGrant(item, grant, itemsById, subject) {
    if (item.sourceUuid !== grant.expected.sourceUuid ||
        item.itemType !== grant.expected.itemType ||
        item.quantity !== grant.expected.quantity) {
        return false;
    }
    if (grant.materializer === "wayfinder-acquisition") {
        const identity = item.acquisitionIdentity;
        const evidence = grant.eligibilityEvidence;
        return (evidence.kind === "titan-mauler" &&
            identity?.draftId === subject.draftId &&
            identity.batchId === subject.batchId &&
            identity.lineId === evidence.lineId &&
            identity.plannedGrantId === grant.grantId);
    }
    let child = item;
    let originMatched = false;
    for (const [index, expectedSourceUuid] of grant.nativeGrantChainSourceUuids.entries()) {
        const linkId = index === grant.nativeGrantChainSourceUuids.length - 1 ? child.locationItemId : child.grantedByItemId;
        const parent = linkId ? itemsById.get(linkId) : null;
        if (!parent || parent.sourceUuid !== expectedSourceUuid)
            return false;
        if (parent.sourceUuid === grant.origin.sourceUuid && parent.wayfinderSlotId === grant.origin.sourceSlotId) {
            originMatched = true;
        }
        child = parent;
    }
    return originMatched && child.grantedByItemId === null && child.locationItemId === null;
}
function validObservedItem(item) {
    return (nonEmpty(item.itemId) &&
        (item.sourceUuid === null || nonEmpty(item.sourceUuid)) &&
        nonEmpty(item.itemType) &&
        safePositiveInteger(item.quantity) &&
        (item.grantedByItemId === null || nonEmpty(item.grantedByItemId)) &&
        (item.locationItemId === null || nonEmpty(item.locationItemId)) &&
        (item.wayfinderSlotId === null || nonEmpty(item.wayfinderSlotId)));
}
function normalizeEligibilityEvidence(raw) {
    if (raw.kind === "fixed-native-profile") {
        return Object.keys(raw).length === 1 ? { kind: "fixed-native-profile" } : null;
    }
    if (raw.kind !== "titan-mauler" ||
        !nonEmpty(raw.documentFingerprint) ||
        !nonEmpty(raw.lineId) ||
        !nonEmpty(raw.lineDocumentFingerprint) ||
        !nonEmpty(raw.linePriceFingerprint) ||
        !nonEmpty(raw.policyFingerprint) ||
        !isEquipmentSize(raw.actorSize) ||
        !isEquipmentSize(raw.targetSize) ||
        !safeNonNegativeInteger(raw.basePriceCopper) ||
        !nonEmpty(raw.weaponCategory) ||
        (raw.rangeIncrement !== null &&
            (typeof raw.rangeIncrement !== "number" || !Number.isFinite(raw.rangeIncrement) || raw.rangeIncrement <= 0)) ||
        !isRarity(raw.rarity) ||
        (raw.characterAccessRef !== null && !nonEmpty(raw.characterAccessRef)) ||
        raw.sourceAllowed !== true ||
        raw.quantity !== 1 ||
        raw.permanence !== "permanent" ||
        raw.componentKind !== "baseline-item") {
        return null;
    }
    return {
        kind: "titan-mauler",
        documentFingerprint: raw.documentFingerprint,
        lineId: raw.lineId,
        lineDocumentFingerprint: raw.lineDocumentFingerprint,
        linePriceFingerprint: raw.linePriceFingerprint,
        policyFingerprint: raw.policyFingerprint,
        actorSize: raw.actorSize,
        targetSize: raw.targetSize,
        basePriceCopper: raw.basePriceCopper,
        weaponCategory: raw.weaponCategory,
        rangeIncrement: raw.rangeIncrement,
        rarity: raw.rarity,
        characterAccessRef: raw.characterAccessRef,
        sourceAllowed: true,
        quantity: 1,
        permanence: "permanent",
        componentKind: "baseline-item",
    };
}
function canonicalProfileMatches(grant) {
    const route = supportedPhysicalGrantRoute(grant.profileId);
    const expected = route.grant;
    const sharedFactsMatch = grant.origin.sourceSlotId === expected.originSourceSlotId &&
        grant.origin.sourceUuid === expected.originSourceUuid &&
        grant.granterSourceUuid === expected.granterSourceUuid &&
        grant.expected.itemType === expected.expectedItemType &&
        grant.materializer === route.materializer &&
        grant.eligibilityKind === expected.eligibilityKind &&
        grant.resaleRule === expected.resaleRule &&
        sameOrderedStrings(grant.nativeGrantChainSourceUuids, expected.nativeGrantChainSourceUuids);
    if (!sharedFactsMatch)
        return false;
    if (route.classification === "supported-native") {
        return (grant.grantId === expected.grantId &&
            grant.expected.sourceUuid === expected.expectedSourceUuid &&
            grant.eligibilityEvidence.kind === "fixed-native-profile");
    }
    return (grant.grantId === `class-grant:titan-mauler:${expected.originSourceSlotId}` &&
        grant.expected.sourceUuid.length > 0 &&
        grant.eligibilityEvidence.kind === "titan-mauler");
}
function deepFreezeGrant(grant) {
    return Object.freeze({
        ...grant,
        origin: Object.freeze({ ...grant.origin }),
        expected: Object.freeze({ ...grant.expected }),
        eligibilityEvidence: Object.freeze({ ...grant.eligibilityEvidence }),
        nativeGrantChainSourceUuids: Object.freeze([...grant.nativeGrantChainSourceUuids]),
    });
}
function fingerprint(value) {
    const text = canonicalJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `class-grant-plan-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
function sameOrderedStrings(actual, expected) {
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
function isEquipmentSize(value) {
    return ["tiny", "small", "medium", "large", "huge", "gargantuan"].includes(String(value));
}
function isRarity(value) {
    return ["common", "uncommon", "rare", "unique"].includes(String(value));
}
/**
 * Titan Mauler's oversized-weapon target. PF2E treats Small and Medium
 * characters alike here: both receive a weapon built for a Large creature.
 */
export function titanMaulerTargetSize(size) {
    switch (size) {
        case "tiny":
            return "small";
        case "small":
        case "medium":
            return "large";
        case "large":
            return "huge";
        case "huge":
            return "gargantuan";
        case "gargantuan":
            return null;
    }
}
function failure(code, message) {
    return { ok: false, code, message };
}
function isProfileId(value) {
    return (value === "alchemist-formula-book" ||
        value === "investigator-alchemical-sciences-formula-book" ||
        value === "giant-instinct-titan-mauler" ||
        value === "dwarf-clan-dagger" ||
        value === "sarangay-head-gem");
}
function safeNonNegativeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function safePositiveInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function unique(values) {
    return [...new Set(values)].sort();
}
function sameStrings(actual, expected) {
    const normalized = unique(actual);
    return (normalized.length === actual.length &&
        normalized.length === expected.length &&
        normalized.every((value, index) => value === expected[index]));
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=class-grant-reconciliation.js.map