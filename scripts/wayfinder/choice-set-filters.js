import { OFFICIAL_PACKS } from "../constants.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { isChoicePredicate, isRecord, predicateIncludesString, toNonEmptyString } from "./rule-data.js";
const STATIC_UUID_PACK_ITEM_TYPES = new Map([
    ...OFFICIAL_PACKS.action.map((packId) => [packId, "action"]),
    ...OFFICIAL_PACKS.ancestry.map((packId) => [packId, "ancestry"]),
    ...OFFICIAL_PACKS.background.map((packId) => [packId, "background"]),
    ...OFFICIAL_PACKS.class.map((packId) => [packId, "class"]),
    ...OFFICIAL_PACKS.classFeature.map((packId) => [packId, "feat"]),
    ...OFFICIAL_PACKS.deity.map((packId) => [packId, "deity"]),
    ...OFFICIAL_PACKS.feat.map((packId) => [packId, "feat"]),
    ...OFFICIAL_PACKS.heritage.map((packId) => [packId, "heritage"]),
    ...OFFICIAL_PACKS.spell.map((packId) => [packId, "spell"]),
]);
const OFFICIAL_PACKS_BY_ITEM_TYPE = {
    action: OFFICIAL_PACKS.action,
    ancestry: OFFICIAL_PACKS.ancestry,
    background: OFFICIAL_PACKS.background,
    class: OFFICIAL_PACKS.class,
    classfeature: OFFICIAL_PACKS.classFeature,
    deity: OFFICIAL_PACKS.deity,
    feat: OFFICIAL_PACKS.feat,
    heritage: OFFICIAL_PACKS.heritage,
    spell: OFFICIAL_PACKS.spell,
};
export function hasSupportedChoiceSetItemType(itemType) {
    return (OFFICIAL_PACKS_BY_ITEM_TYPE[normalizeChoiceItemType(itemType)]?.length ?? 0) > 0;
}
export function resolveChoiceSetFilters(rule, options) {
    const choices = isRecord(rule.choices) && !Array.isArray(rule.choices) ? rule.choices : null;
    if (choices) {
        if (!Array.isArray(choices.filter) || !choices.filter.every(isChoicePredicate)) {
            return null;
        }
        const rawPredicate = choices.filter.map((entry) => resolveChoiceLevelReferences(entry, options));
        const resolvedPredicate = resolveActorInjectedPredicate(rawPredicate, options);
        if (!resolvedPredicate) {
            return null;
        }
        const rawItemType = toNonEmptyString(choices.itemType) ?? inferItemTypeFromPredicate(resolvedPredicate.predicate) ?? "feat";
        const itemType = rawItemType ? normalizeChoiceItemType(rawItemType) : null;
        if (!itemType || !hasSupportedChoiceSetItemType(itemType) || resolvedPredicate.predicate.length === 0) {
            return null;
        }
        const packIds = inferPackIds(itemType, resolvedPredicate.predicate);
        return {
            filters: {
                itemType,
                ...(packIds.length > 0 ? { packIds } : {}),
                predicate: resolvedPredicate.predicate,
            },
            actorDependencies: resolvedPredicate.actorDependencies,
        };
    }
    return resolveStaticUuidChoiceFilters(rule, options);
}
function resolveChoiceLevelReferences(predicate, options) {
    if (typeof predicate === "string") {
        return predicate;
    }
    if (Array.isArray(predicate)) {
        return predicate.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    const result = { ...predicate };
    if (Array.isArray(result.and)) {
        result.and = result.and.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    if (Array.isArray(result.nand)) {
        result.nand = result.nand.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    if (Array.isArray(result.xor)) {
        result.xor = result.xor.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    for (const key of ["eq", "lt", "lte", "gt", "gte"]) {
        const comparator = result[key];
        if (!Array.isArray(comparator)) {
            continue;
        }
        if (comparator[1] === "parent:granter:level") {
            result[key] = [comparator[0], options.sourceLevel];
        }
        else if (comparator[1] === "self:level") {
            result[key] = [comparator[0], options.sourceDocumentLevel ?? options.sourceLevel];
        }
    }
    if (Array.isArray(result.or)) {
        result.or = result.or.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    if (Array.isArray(result.nor)) {
        result.nor = result.nor.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    if (result.not) {
        result.not = resolveChoiceLevelReferences(result.not, options);
    }
    if (result.if) {
        result.if = resolveChoiceLevelReferences(result.if, options);
    }
    if (result.then) {
        result.then = resolveChoiceLevelReferences(result.then, options);
    }
    if (Array.isArray(result.iff)) {
        result.iff = result.iff.map((entry) => resolveChoiceLevelReferences(entry, options));
    }
    return result;
}
function resolveStaticUuidChoiceFilters(rule, options) {
    if (!Array.isArray(rule.choices)) {
        return null;
    }
    const choices = rule.choices.filter(isRecord);
    if (choices.length === 0 || choices.length !== rule.choices.length) {
        return null;
    }
    const uuidPredicates = {};
    const uuids = [];
    const actorDependencies = new Set();
    for (const choice of choices) {
        const uuid = toNonEmptyString(choice.value);
        if (!uuid || !parseCompendiumItemUuid(uuid)) {
            return null;
        }
        const predicate = normalizePredicateList(choice.predicate, options);
        if (!predicate) {
            return null;
        }
        for (const dependency of predicate.actorDependencies) {
            actorDependencies.add(dependency);
        }
        uuids.push(uuid);
        if (predicate.predicate.length > 0) {
            uuidPredicates[uuid] = predicate.predicate;
        }
    }
    const packIds = Array.from(new Set(uuids.flatMap((uuid) => {
        const parsed = parseCompendiumItemUuid(uuid);
        return parsed ? [parsed.packId] : [];
    })));
    const itemTypes = Array.from(new Set(packIds.flatMap((packId) => STATIC_UUID_PACK_ITEM_TYPES.get(packId) ?? [])));
    if (packIds.length === 0 || itemTypes.length !== 1 || itemTypes[0] === undefined) {
        return null;
    }
    return {
        filters: {
            itemType: itemTypes[0],
            packIds,
            uuids,
            ...(Object.keys(uuidPredicates).length > 0 ? { uuidPredicates } : {}),
        },
        actorDependencies: Array.from(actorDependencies),
    };
}
function normalizePredicateList(value, options) {
    if (value === undefined) {
        return { predicate: [], actorDependencies: [] };
    }
    const predicate = Array.isArray(value) ? value.filter(isChoicePredicate) : isChoicePredicate(value) ? [value] : null;
    if (!predicate || (Array.isArray(value) && value.length !== predicate.length)) {
        return null;
    }
    return resolveActorInjectedPredicate(predicate, options);
}
function resolveActorInjectedPredicate(predicate, options) {
    const actorDependencies = new Set();
    let unresolved = false;
    const resolved = predicate.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, () => {
        unresolved = true;
    }));
    if (unresolved && options.requireResolvedActorPlaceholders) {
        return null;
    }
    return {
        predicate: resolved,
        actorDependencies: Array.from(actorDependencies),
    };
}
function resolveActorInjectedPredicateEntry(predicate, options, actorDependencies, markUnresolved) {
    if (typeof predicate === "string") {
        return resolveActorInjectedPredicateString(predicate, options, actorDependencies, markUnresolved);
    }
    if (Array.isArray(predicate)) {
        return predicate.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    const result = { ...predicate };
    if (Array.isArray(result.and)) {
        result.and = result.and.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    if (Array.isArray(result.nand)) {
        result.nand = result.nand.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    if (Array.isArray(result.or)) {
        result.or = result.or.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    if (Array.isArray(result.xor)) {
        result.xor = result.xor.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    if (Array.isArray(result.nor)) {
        result.nor = result.nor.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    if (result.not) {
        result.not = resolveActorInjectedPredicateEntry(result.not, options, actorDependencies, markUnresolved);
    }
    if (result.if) {
        result.if = resolveActorInjectedPredicateEntry(result.if, options, actorDependencies, markUnresolved);
    }
    if (result.then) {
        result.then = resolveActorInjectedPredicateEntry(result.then, options, actorDependencies, markUnresolved);
    }
    if (Array.isArray(result.iff)) {
        result.iff = result.iff.map((entry) => resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved));
    }
    for (const key of ["eq", "lt", "lte", "gt", "gte"]) {
        const comparator = result[key];
        if (!Array.isArray(comparator)) {
            continue;
        }
        result[key] = comparator.map((entry) => typeof entry === "string"
            ? resolveActorInjectedPredicateString(entry, options, actorDependencies, markUnresolved)
            : entry);
    }
    return result;
}
function resolveActorInjectedPredicateString(statement, options, actorDependencies, markUnresolved) {
    return statement.replace(/\{actor\|([^}]+)\}/g, (token, rawPath) => {
        const path = rawPath.trim();
        const dependency = actorDependencyForPath(path);
        if (dependency) {
            actorDependencies.add(dependency);
        }
        const replacement = actorPlaceholderValue(path, options.actorContext);
        if (!replacement) {
            markUnresolved();
            return token;
        }
        return replacement;
    });
}
function actorDependencyForPath(path) {
    if (/^flags\.system\.kineticist\.gate\.(?:one|two|three|four|five|six)$/.test(path)) {
        return "class";
    }
    switch (path) {
        case "system.details.ancestry.trait":
            return "ancestry";
        case "system.details.class.trait":
            return "class";
        default:
            return null;
    }
}
function actorPlaceholderValue(path, context) {
    const gateOrdinal = /^flags\.system\.kineticist\.gate\.(one|two|three|four|five|six)$/.exec(path)?.[1];
    if (gateOrdinal && context?.kineticistGateElements) {
        const index = ["one", "two", "three", "four", "five", "six"].indexOf(gateOrdinal);
        return context.kineticistGateElements[index] ?? `wayfinder-unselected-kineticist-gate-${index + 1}`;
    }
    switch (path) {
        case "system.details.ancestry.trait":
            return toNonEmptyString(context?.ancestrySlug);
        case "system.details.class.trait":
            return toNonEmptyString(context?.classSlug);
        default:
            return null;
    }
}
function inferItemTypeFromPredicate(predicate) {
    for (const entry of predicate) {
        const inferred = inferItemTypeFromPredicateEntry(entry);
        if (inferred) {
            return inferred;
        }
    }
    return null;
}
function inferItemTypeFromPredicateEntry(predicate) {
    if (typeof predicate === "string") {
        const match = /^item:type:([^:]+)$/.exec(predicate);
        return match?.[1] ?? null;
    }
    if (Array.isArray(predicate)) {
        return inferItemTypeFromPredicate(predicate);
    }
    if (!isRecord(predicate)) {
        return null;
    }
    const branches = [predicate.and, predicate.or, predicate.nor].filter(Array.isArray).flat();
    if (predicate.not) {
        branches.push(predicate.not);
    }
    return inferItemTypeFromPredicate(branches);
}
function normalizeChoiceItemType(itemType) {
    return itemType === "feature" ? "feat" : itemType;
}
function inferPackIds(itemType, predicate) {
    if (itemType === "feat" && predicateIncludesString(predicate, "item:type:feature")) {
        return [...OFFICIAL_PACKS.classFeature];
    }
    if (itemType === "feat" && predicateIncludesPrefix(predicate, "item:tag:")) {
        return [...OFFICIAL_PACKS.classFeature, ...OFFICIAL_PACKS.feat];
    }
    return [...(OFFICIAL_PACKS_BY_ITEM_TYPE[itemType] ?? [])];
}
function predicateIncludesPrefix(predicate, prefix) {
    return predicate.some((entry) => predicateEntryIncludesPrefix(entry, prefix));
}
function predicateEntryIncludesPrefix(predicate, prefix) {
    if (typeof predicate === "string") {
        return predicate.startsWith(prefix);
    }
    if (Array.isArray(predicate)) {
        return predicateIncludesPrefix(predicate, prefix);
    }
    if (!isRecord(predicate)) {
        return false;
    }
    return ([predicate.and, predicate.or, predicate.nor]
        .filter(Array.isArray)
        .flat()
        .some((entry) => predicateEntryIncludesPrefix(entry, prefix)) ||
        (predicate.not ? predicateEntryIncludesPrefix(predicate.not, prefix) : false));
}
//# sourceMappingURL=choice-set-filters.js.map