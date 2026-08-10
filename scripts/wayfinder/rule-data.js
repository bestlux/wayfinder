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
    const keys = Object.keys(value);
    if (keys.length === 1 && ["and", "nand", "or", "xor", "nor", "iff"].includes(keys[0])) {
        const entries = value[keys[0]];
        return Array.isArray(entries) && entries.every(isChoicePredicate);
    }
    if (keys.length === 1 && keys[0] === "not") {
        return isChoicePredicate(value.not);
    }
    if (keys.length === 2 && keys.includes("if") && keys.includes("then")) {
        return isChoicePredicate(value.if) && isChoicePredicate(value.then);
    }
    if (keys.length === 1 && ["eq", "lt", "lte", "gt", "gte"].includes(keys[0])) {
        const comparator = value[keys[0]];
        return (Array.isArray(comparator) &&
            comparator.length === 2 &&
            typeof comparator[0] === "string" &&
            ["string", "number"].includes(typeof comparator[1]));
    }
    return false;
}
export function matchesChoicePredicateList(predicate, matchesString) {
    return predicate.every((entry) => matchesChoicePredicate(entry, matchesString));
}
export function matchesChoiceSetRulePredicate(rule, activeRollOptions) {
    if (rule.predicate === undefined) {
        return true;
    }
    const predicate = Array.isArray(rule.predicate)
        ? rule.predicate.filter(isChoicePredicate)
        : isChoicePredicate(rule.predicate)
            ? [rule.predicate]
            : null;
    if (!predicate || (Array.isArray(rule.predicate) && predicate.length !== rule.predicate.length)) {
        return false;
    }
    return matchesChoicePredicateListAgainstRollOptions(predicate, activeRollOptions);
}
export function matchesChoicePredicateListAgainstRollOptions(predicate, activeRollOptions) {
    return matchesChoicePredicateList(predicate, (statement) => matchesProjectedRollOption(statement, activeRollOptions));
}
export function matchesChoicePredicateAgainstRollOptions(predicate, activeRollOptions) {
    return matchesChoicePredicate(predicate, (statement) => matchesProjectedRollOption(statement, activeRollOptions));
}
function matchesProjectedRollOption(statement, activeRollOptions) {
    const normalized = statement.trim().toLowerCase();
    if (activeRollOptions.has(normalized)) {
        return true;
    }
    const comparison = /^(eq|lt|lte|gt|gte):(.+):(-?\d+(?:\.\d+)?)$/u.exec(normalized);
    if (!comparison) {
        return false;
    }
    const [, operator, operand, rawExpected] = comparison;
    const expected = Number(rawExpected);
    const prefix = `${operand}:`;
    return Array.from(activeRollOptions).some((option) => {
        if (!option.startsWith(prefix)) {
            return false;
        }
        const actual = Number(option.slice(prefix.length));
        if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
            return false;
        }
        switch (operator) {
            case "lt":
                return actual < expected;
            case "lte":
                return actual <= expected;
            case "gt":
                return actual > expected;
            case "gte":
                return actual >= expected;
            case "eq":
                return actual === expected;
            default:
                return false;
        }
    });
}
export function matchesChoicePredicate(predicate, matchesString) {
    if (typeof predicate === "string") {
        return matchesString(predicate);
    }
    if (Array.isArray(predicate)) {
        return matchesChoicePredicateList(predicate, matchesString);
    }
    const comparison = matchesComparisonPredicate(predicate, matchesString);
    if (comparison !== null) {
        return comparison;
    }
    if (Array.isArray(predicate.and)) {
        return predicate.and.every((entry) => matchesChoicePredicate(entry, matchesString));
    }
    if (Array.isArray(predicate.nand)) {
        return !predicate.nand.every((entry) => matchesChoicePredicate(entry, matchesString));
    }
    if (Array.isArray(predicate.or)) {
        return predicate.or.some((entry) => matchesChoicePredicate(entry, matchesString));
    }
    if (Array.isArray(predicate.xor)) {
        return predicate.xor.filter((entry) => matchesChoicePredicate(entry, matchesString)).length === 1;
    }
    if (Array.isArray(predicate.nor)) {
        return predicate.nor.every((entry) => !matchesChoicePredicate(entry, matchesString));
    }
    if (predicate.not) {
        return !matchesChoicePredicate(predicate.not, matchesString);
    }
    if (predicate.if && predicate.then) {
        return (!matchesChoicePredicate(predicate.if, matchesString) || matchesChoicePredicate(predicate.then, matchesString));
    }
    if (Array.isArray(predicate.iff)) {
        const results = predicate.iff.map((entry) => matchesChoicePredicate(entry, matchesString));
        return results.every(Boolean) || results.every((result) => !result);
    }
    return true;
}
function matchesComparisonPredicate(predicate, matchesString) {
    for (const [operator, comparator] of [
        ["eq", predicate.eq],
        ["lt", predicate.lt],
        ["lte", predicate.lte],
        ["gt", predicate.gt],
        ["gte", predicate.gte],
    ]) {
        if (comparator === undefined) {
            continue;
        }
        if (!Array.isArray(comparator) || comparator.length !== 2 || typeof comparator[0] !== "string") {
            return false;
        }
        if (operator === "eq" && typeof comparator[1] === "string") {
            return comparator[0] === comparator[1];
        }
        return matchesString(`${operator}:${comparator[0]}:${String(comparator[1])}`);
    }
    return null;
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
    return ((Array.isArray(predicate.and) && predicate.and.some((entry) => predicateIncludesString(entry, target))) ||
        (Array.isArray(predicate.nand) && predicate.nand.some((entry) => predicateIncludesString(entry, target))) ||
        (Array.isArray(predicate.or) && predicate.or.some((entry) => predicateIncludesString(entry, target))) ||
        (Array.isArray(predicate.xor) && predicate.xor.some((entry) => predicateIncludesString(entry, target))) ||
        (Array.isArray(predicate.nor) && predicate.nor.some((entry) => predicateIncludesString(entry, target))) ||
        (!!predicate.not && predicateIncludesString(predicate.not, target)) ||
        (!!predicate.if && predicateIncludesString(predicate.if, target)) ||
        (!!predicate.then && predicateIncludesString(predicate.then, target)) ||
        (Array.isArray(predicate.iff) && predicate.iff.some((entry) => predicateIncludesString(entry, target))) ||
        comparisonPredicateIncludesString(predicate, target));
}
function comparisonPredicateIncludesString(predicate, target) {
    for (const comparator of [predicate.eq, predicate.lt, predicate.lte, predicate.gt, predicate.gte]) {
        if (Array.isArray(comparator) && comparator.some((entry) => typeof entry === "string" && entry.includes(target))) {
            return true;
        }
    }
    return false;
}
export function isRecord(value) {
    return !!value && typeof value === "object";
}
//# sourceMappingURL=rule-data.js.map