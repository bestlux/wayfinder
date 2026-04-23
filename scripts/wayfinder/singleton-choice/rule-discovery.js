import { getConfiguredSkills, isConfiguredSkillSlug, resolveSkillLabel, } from "../class-choice/skill-config.js";
import { formatSlug } from "../formatting.js";
export function discoverSingletonChoiceMeta(args) {
    const { sourceItemType, sourceDocument, sourceSelection, sourceLevel, extractSlug, localize } = args;
    const document = sourceDocument;
    return discoverSingletonChoiceSpecs({
        sourceItemType,
        sourceDocument,
        sourceSlug: extractSlug(sourceDocument) ?? sourceSelection.documentId,
        sourceLevel,
        localize,
    }).map((choice) => ({
        slotId: choice.slotId,
        sourceItemType,
        sourcePackId: sourceSelection.packId,
        sourceDocumentId: sourceSelection.documentId,
        sourceUuid: sourceSelection.uuid,
        sourceName: toNonEmptyString(document?.name) ?? sourceSelection.name,
        sourceRuleIndex: choice.sourceRuleIndex,
        flag: choice.flag,
        prompt: choice.prompt,
        options: choice.options,
    }));
}
export function discoverSingletonChoiceSpecs(args) {
    const { sourceItemType, sourceDocument, sourceSlug, sourceLevel, localize } = args;
    const document = sourceDocument;
    const level = sourceLevel ?? toFeatureLevel(document?.system?.level?.value);
    const configuredSkills = getConfiguredSkills();
    return findRelevantRules(sourceDocument).flatMap((rule, sourceRuleIndex) => {
        const flag = extractChoiceKey(rule);
        if (rule.key !== "ChoiceSet" || !flag) {
            return [];
        }
        const options = resolveChoiceOptions(rule, localize, configuredSkills);
        if (!options ||
            options.options.length === 0 ||
            shouldSkipSingletonChoice(args.sourceItemType, options.optionDomain)) {
            return [];
        }
        return [
            {
                sourceRuleIndex,
                slotId: `singleton-choice-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`,
                flag,
                prompt: resolvePrompt(rule.prompt, localize),
                optionDomain: options.optionDomain,
                options: options.options,
            },
        ];
    });
}
function shouldSkipSingletonChoice(sourceItemType, optionDomain) {
    // Starting skill and lore choices belong to the skill training workflow so
    // they stay in one draft store and do not reappear as separate singleton steps.
    return ["ancestry", "heritage", "background", "class", "feat"].includes(sourceItemType) && optionDomain !== "generic";
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
function resolveChoiceOptions(rule, localize, configuredSkills) {
    if (Array.isArray(rule.choices)) {
        const options = rule.choices
            .filter((choice) => isRecord(choice))
            .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
            .map((choice) => {
            const rawValue = String(choice.value).trim();
            const normalizedSkillValue = rawValue.toLowerCase();
            const skillChoice = isConfiguredSkillSlug(normalizedSkillValue, configuredSkills);
            const value = skillChoice ? normalizedSkillValue : rawValue;
            return {
                value,
                label: skillChoice
                    ? resolveSkillLabel(normalizedSkillValue, typeof choice.label === "string" ? choice.label : undefined, localize, configuredSkills)
                    : resolveChoiceLabel(typeof choice.label === "string" ? choice.label : undefined, value, localize),
                img: typeof choice.img === "string" && choice.img.length > 0 ? choice.img : null,
                detail: null,
            };
        });
        if (options.length === 0) {
            return null;
        }
        const everySkill = options.every((choice) => isConfiguredSkillSlug(choice.value, configuredSkills));
        const everyLore = options.every((choice) => /\blore\b/i.test(choice.label));
        return {
            optionDomain: everySkill ? "skill" : everyLore ? "lore" : "generic",
            options,
        };
    }
    const choiceConfig = isRecord(rule.choices) ? rule.choices : null;
    if (choiceConfig?.config === "skills") {
        const options = Object.entries(configuredSkills)
            .map(([slug, entry]) => ({
            value: slug,
            label: resolveSkillLabel(slug, entry.label, localize, configuredSkills),
            img: null,
            detail: null,
        }))
            .sort((left, right) => left.label.localeCompare(right.label));
        return {
            optionDomain: "skill",
            options,
        };
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