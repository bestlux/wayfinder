import { toCompendiumItemUuid } from "../shared/compendium.js";
import { predicateIncludesString } from "../wayfinder/rule-data.js";
import { extractEntrySlug, extractEntryTraits, numericOrNull, resolveFeatType, stringOrNull } from "./entry.js";
export function matchesChoicePredicate(predicate, entry, context) {
    return evaluateStaticPredicate(predicate, (statement) => evaluateStaticPredicateString(statement, entry, context));
}
export function matchesUuidAllowlist(entry, packId, allowedUuids) {
    const allowed = new Set(allowedUuids.map(normalizeUuid).filter(Boolean));
    if (allowed.size === 0) {
        return true;
    }
    return entryUuidCandidates(entry, packId).some((candidate) => allowed.has(normalizeUuid(candidate)));
}
export function matchesUuidChoicePredicate(entry, packId, uuidPredicates, context) {
    const predicatesByUuid = new Map(Object.entries(uuidPredicates).map(([uuid, predicate]) => [normalizeUuid(uuid), predicate]));
    for (const candidate of entryUuidCandidates(entry, packId)) {
        const predicate = predicatesByUuid.get(normalizeUuid(candidate));
        if (predicate) {
            return matchesStaticPredicate(predicate, entry, context);
        }
    }
    return true;
}
export function matchesStaticPredicate(predicate, entry, context) {
    return evaluateStaticPredicate(predicate, (statement) => evaluateStaticPredicateString(statement, entry, context));
}
export function matchesItemType(entry, expectedType) {
    const normalizedExpected = expectedType.trim().toLowerCase();
    const entryType = String(entry?.type ?? "")
        .trim()
        .toLowerCase();
    if (normalizedExpected === "feature") {
        return entryType === "feat" && resolveFeatType(entry)?.trim().toLowerCase() === "classfeature";
    }
    return entryType === normalizedExpected;
}
export function matchesCurrentClassMulticlassDedication(entry, predicate, context) {
    const classSlug = context.classSlug?.trim().toLowerCase();
    if (!classSlug || !predicateIncludesString(predicate, "item:trait:multiclass")) {
        return false;
    }
    return extractEntryTraits(entry).includes(classSlug);
}
function entryUuidCandidates(entry, packId) {
    const candidates = [];
    const documentId = stringOrNull(entry._id);
    const name = stringOrNull(entry.name);
    const slug = extractEntrySlug(entry);
    if (documentId) {
        candidates.push(toCompendiumItemUuid(packId, documentId));
    }
    if (name) {
        candidates.push(toCompendiumItemUuid(packId, name));
    }
    if (slug) {
        candidates.push(toCompendiumItemUuid(packId, slug));
    }
    return candidates;
}
function normalizeUuid(value) {
    return value.trim().toLowerCase();
}
function matchesChoicePredicateString(statement, entry, context) {
    const resolved = resolveInjectedPredicateString(statement, context);
    if (!resolved) {
        return false;
    }
    const itemSlug = extractEntrySlug(entry);
    const itemTraits = extractEntryTraits(entry);
    if (resolved.startsWith("item:level:")) {
        const expectedLevel = Number(resolved.slice("item:level:".length));
        const level = numericOrNull(entry?.system?.level?.value);
        return Number.isFinite(expectedLevel) && level === expectedLevel;
    }
    if (resolved.startsWith("item:type:")) {
        const expectedType = resolved.slice("item:type:".length).trim().toLowerCase();
        return matchesItemType(entry, expectedType);
    }
    if (resolved.startsWith("item:category:")) {
        const expectedCategory = resolved.slice("item:category:".length).trim().toLowerCase();
        const category = stringOrNull(entry?.system?.category)?.trim().toLowerCase();
        const featType = resolveFeatType(entry)?.trim().toLowerCase();
        return category === expectedCategory || featType === expectedCategory;
    }
    if (resolved.startsWith("item:trait:")) {
        const expectedTrait = resolved.slice("item:trait:".length).trim().toLowerCase();
        return itemTraits.includes(expectedTrait);
    }
    if (resolved.startsWith("item:tag:")) {
        const expectedTag = resolved.slice("item:tag:".length).trim().toLowerCase();
        return itemTraits.includes(expectedTag);
    }
    if (resolved.startsWith("item:")) {
        const expectedSlug = resolved.slice("item:".length).trim().toLowerCase();
        return itemSlug === expectedSlug;
    }
    if (resolved.startsWith("feature:")) {
        return false;
    }
    return false;
}
function evaluateStaticPredicate(predicate, evaluateString) {
    if (typeof predicate === "string") {
        return evaluateString(predicate) === true;
    }
    if (Array.isArray(predicate)) {
        return predicate.every((entry) => evaluateStaticPredicate(entry, evaluateString));
    }
    const comparison = evaluateComparisonPredicate(predicate, evaluateString);
    if (comparison !== null) {
        return comparison;
    }
    if (Array.isArray(predicate.or)) {
        return predicate.or.some((entry) => evaluateStaticPredicate(entry, evaluateString));
    }
    if (Array.isArray(predicate.nor)) {
        return predicate.nor.every((entry) => evaluateStringOrTree(entry, evaluateString) === false);
    }
    if (predicate.not) {
        return evaluateStringOrTree(predicate.not, evaluateString) === false;
    }
    return true;
}
function evaluateComparisonPredicate(predicate, evaluateString) {
    for (const [operator, comparator] of [
        ["lt", predicate.lt],
        ["lte", predicate.lte],
        ["gt", predicate.gt],
        ["gte", predicate.gte],
    ]) {
        if (!Array.isArray(comparator) || comparator.length !== 2) {
            continue;
        }
        const [left, right] = comparator;
        if (typeof left !== "string" || (typeof right !== "number" && typeof right !== "string")) {
            return false;
        }
        const resolved = evaluateString(`${operator}:${left}:${right}`);
        return resolved === true;
    }
    return null;
}
function evaluateStringOrTree(predicate, evaluateString) {
    if (typeof predicate === "string") {
        return evaluateString(predicate);
    }
    if (Array.isArray(predicate)) {
        return predicate.every((entry) => evaluateStringOrTree(entry, evaluateString) === true) ? true : "unknown";
    }
    if (Array.isArray(predicate.or)) {
        if (predicate.or.some((entry) => evaluateStringOrTree(entry, evaluateString) === true)) {
            return true;
        }
        return predicate.or.every((entry) => evaluateStringOrTree(entry, evaluateString) === false) ? false : "unknown";
    }
    if (Array.isArray(predicate.nor)) {
        if (predicate.nor.some((entry) => evaluateStringOrTree(entry, evaluateString) === true)) {
            return false;
        }
        return predicate.nor.every((entry) => evaluateStringOrTree(entry, evaluateString) === false) ? true : "unknown";
    }
    if (predicate.not) {
        const value = evaluateStringOrTree(predicate.not, evaluateString);
        return value === "unknown" ? "unknown" : !value;
    }
    return true;
}
function evaluateStaticPredicateString(statement, entry, context) {
    const trimmed = statement.trim().toLowerCase();
    if (!trimmed) {
        return "unknown";
    }
    const activeRollOptions = new Set((context.rollOptions ?? []).map((option) => option.trim().toLowerCase()));
    if (activeRollOptions.has(trimmed)) {
        return true;
    }
    if (trimmed.startsWith("class:")) {
        return context.classSlug?.trim().toLowerCase() === trimmed.slice("class:".length);
    }
    if (trimmed.startsWith("ancestry:")) {
        return context.ancestrySlug?.trim().toLowerCase() === trimmed.slice("ancestry:".length);
    }
    const skillRankMatch = /^skill:([^:]+):rank:(\d+)$/.exec(trimmed);
    if (skillRankMatch) {
        const skillSlug = skillRankMatch[1] ?? "";
        const expectedRank = Number(skillRankMatch[2]);
        const rank = context.skillRanks?.[skillSlug] ?? 0;
        return Number.isFinite(expectedRank) && rank === expectedRank;
    }
    if (trimmed.startsWith("item:")) {
        return matchesChoicePredicateString(statement, entry, context);
    }
    const comparisonMatch = /^(lt|lte|gt|gte):item:level:(\d+)$/.exec(trimmed);
    if (comparisonMatch) {
        const level = numericOrNull(entry?.system?.level?.value);
        const expected = Number(comparisonMatch[2]);
        if (level === null || !Number.isFinite(expected)) {
            return false;
        }
        switch (comparisonMatch[1]) {
            case "lt":
                return level < expected;
            case "lte":
                return level <= expected;
            case "gt":
                return level > expected;
            case "gte":
                return level >= expected;
        }
    }
    return "unknown";
}
function resolveInjectedPredicateString(statement, context) {
    const trimmed = statement.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.replace(/\{actor\|([^}]+)\}/g, (_, path) => {
        switch (path.trim()) {
            case "system.details.class.trait":
                return context.classSlug ?? "";
            case "system.details.ancestry.trait":
                return context.ancestrySlug ?? "";
            default:
                return "";
        }
    });
}
//# sourceMappingURL=predicates.js.map