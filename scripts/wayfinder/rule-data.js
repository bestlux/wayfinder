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
    return true;
}
export function isRecord(value) {
    return !!value && typeof value === "object";
}
//# sourceMappingURL=rule-data.js.map