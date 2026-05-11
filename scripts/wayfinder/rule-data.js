export function getDocumentRules(document) {
    const rules = document?.system?.rules;
    return Array.isArray(rules) ? rules.filter(isRecord) : [];
}
export function extractChoiceKey(rule) {
    const candidates = [rule.flag, rule.rollOption, rule.slug];
    for (const candidate of candidates) {
        const normalized = toNonEmptyString(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}
export function toFeatureLevel(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}
export function documentFeatureLevel(document) {
    return toFeatureLevel(document?.system?.level?.value);
}
export function toNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
export function isChoicePredicate(value) {
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.every((entry) => isChoicePredicate(entry));
    }
    if (!isRecord(value)) {
        return false;
    }
    if ("or" in value && value.or !== undefined && (!Array.isArray(value.or) || !value.or.every(isChoicePredicate))) {
        return false;
    }
    if ("nor" in value && value.nor !== undefined && (!Array.isArray(value.nor) || !value.nor.every(isChoicePredicate))) {
        return false;
    }
    if ("not" in value && value.not !== undefined && !isChoicePredicate(value.not)) {
        return false;
    }
    for (const key of ["lt", "lte", "gt", "gte"]) {
        if (key in value &&
            value[key] !== undefined &&
            (!Array.isArray(value[key]) || value[key].length !== 2 || typeof value[key][0] !== "string")) {
            return false;
        }
    }
    return true;
}
export function matchesChoicePredicateList(predicate, matchesString) {
    return predicate.every((entry) => matchesChoicePredicate(entry, matchesString));
}
export function matchesChoicePredicate(predicate, matchesString) {
    if (typeof predicate === "string") {
        return matchesString(predicate);
    }
    if (Array.isArray(predicate)) {
        return matchesChoicePredicateList(predicate, matchesString);
    }
    if (Array.isArray(predicate.or)) {
        return predicate.or.some((entry) => matchesChoicePredicate(entry, matchesString));
    }
    if (Array.isArray(predicate.nor)) {
        return predicate.nor.every((entry) => !matchesChoicePredicate(entry, matchesString));
    }
    if (predicate.not) {
        return !matchesChoicePredicate(predicate.not, matchesString);
    }
    return true;
}
export function predicateIncludesString(predicate, target) {
    if (typeof predicate === "string") {
        return predicate.includes(target);
    }
    if (Array.isArray(predicate)) {
        return predicate.some((entry) => predicateIncludesString(entry, target));
    }
    if (!isRecord(predicate)) {
        return false;
    }
    return ((Array.isArray(predicate.or) && predicate.or.some((entry) => predicateIncludesString(entry, target))) ||
        (Array.isArray(predicate.nor) && predicate.nor.some((entry) => predicateIncludesString(entry, target))) ||
        (!!predicate.not && predicateIncludesString(predicate.not, target)));
}
export function isRecord(value) {
    return !!value && typeof value === "object";
}
//# sourceMappingURL=rule-data.js.map