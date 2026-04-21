import { formatSlug } from "../formatting.js";
export function discoverSingletonChoiceMeta(args) {
    const { sourceItemType, sourceDocument, sourceSelection, extractSlug, localize } = args;
    const document = sourceDocument;
    const sourceSlug = extractSlug(sourceDocument) ?? sourceSelection.documentId;
    const level = toFeatureLevel(document?.system?.level?.value);
    return findRelevantRules(sourceDocument).flatMap((rule, ruleIndex) => {
        const flag = extractChoiceKey(rule);
        if (rule.key !== "ChoiceSet" || !flag || !Array.isArray(rule.choices)) {
            return [];
        }
        const options = rule.choices
            .filter((choice) => isRecord(choice))
            .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
            .map((choice) => ({
            value: String(choice.value),
            label: resolveChoiceLabel(typeof choice.label === "string" ? choice.label : undefined, String(choice.value), localize),
            img: typeof choice.img === "string" && choice.img.length > 0 ? choice.img : null,
            detail: null,
        }));
        if (options.length === 0) {
            return [];
        }
        return [
            {
                slotId: `singleton-choice-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`,
                sourceItemType,
                sourcePackId: sourceSelection.packId,
                sourceDocumentId: sourceSelection.documentId,
                sourceUuid: sourceSelection.uuid,
                sourceName: toNonEmptyString(document?.name) ?? sourceSelection.name,
                sourceRuleIndex: ruleIndex,
                flag,
                prompt: resolvePrompt(rule.prompt, localize),
                options,
            },
        ];
    });
}
function findRelevantRules(document) {
    const rules = document?.system?.rules;
    return Array.isArray(rules) ? rules.filter(isRecord) : [];
}
function extractChoiceKey(rule) {
    const candidates = [rule.flag, rule.rollOption, rule.slug];
    for (const candidate of candidates) {
        const normalized = toNonEmptyString(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}
function resolvePrompt(prompt, localize) {
    const raw = toNonEmptyString(prompt);
    if (!raw) {
        return null;
    }
    const localized = localize(raw);
    return localized && localized !== raw ? localized : raw;
}
function resolveChoiceLabel(rawLabel, fallbackValue, localize) {
    const trimmed = rawLabel?.trim();
    if (!trimmed) {
        return formatSlug(fallbackValue);
    }
    const localized = localize(trimmed);
    return localized && localized !== trimmed ? localized : trimmed;
}
function toFeatureLevel(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}
function toNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function isRecord(value) {
    return !!value && typeof value === "object";
}
//# sourceMappingURL=rule-discovery.js.map