import { resolveConfiguredChoiceOptions } from "../class-choice/rule-discovery.js";
import { getConfiguredSkills, isConfiguredSkillSlug, resolveSkillLabel, } from "../class-choice/skill-config.js";
import { formatSlug } from "../formatting.js";
import { documentFeatureLevel, extractChoiceKey, getDocumentRules, isChoicePredicate, isRecord, toNonEmptyString, } from "../rule-data.js";
const ENABLED_FEAT_CONFIG_CHOICE_KEYS = new Set(["baseWeaponTypes", "creatureTraits", "saves", "weaponGroups"]);
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
        predicate: choice.predicate,
        rollOption: choice.rollOption,
        options: choice.options,
    }));
}
export function discoverSingletonChoiceSpecs(args) {
    const { sourceItemType, sourceDocument, sourceSlug, sourceLevel, localize, includeTrainingChoices = false } = args;
    const level = sourceLevel ?? documentFeatureLevel(sourceDocument);
    const configuredSkills = getConfiguredSkills();
    const rules = getDocumentRules(sourceDocument);
    return rules.flatMap((rule, sourceRuleIndex) => {
        const flag = extractChoiceKey(rule);
        if (rule.key !== "ChoiceSet" || !flag) {
            return [];
        }
        if (isGrantSelectorChoice(rules, flag)) {
            return [];
        }
        const options = resolveChoiceOptions(rule, localize, configuredSkills, sourceItemType);
        if (!options ||
            options.options.length === 0 ||
            (!includeTrainingChoices && shouldSkipSingletonChoice(args.sourceItemType, options.optionDomain))) {
            return [];
        }
        return [
            {
                sourceRuleIndex,
                slotId: `singleton-choice-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`,
                flag,
                prompt: resolvePrompt(rule.prompt, localize),
                predicate: extractPredicate(rule.predicate),
                rollOption: toNonEmptyString(rule.rollOption),
                optionDomain: options.optionDomain,
                options: options.options,
            },
        ];
    });
}
function isGrantSelectorChoice(rules, flag) {
    return rules.some((entry) => entry.key === "GrantItem" && typeof entry.uuid === "string" && entry.uuid.includes(`rulesSelections.${flag}`));
}
function shouldSkipSingletonChoice(sourceItemType, optionDomain) {
    // Starting skill and lore choices belong to the skill training workflow so
    // they stay in one draft store and do not reappear as separate singleton steps.
    return (["ancestry", "heritage", "background", "class", "classfeature", "feat"].includes(sourceItemType) &&
        optionDomain !== "generic");
}
function extractPredicate(value) {
    return Array.isArray(value) ? value.filter(isChoicePredicate) : [];
}
function resolveChoiceOptions(rule, localize, configuredSkills, sourceItemType) {
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
    const configKey = typeof rule.choices === "string"
        ? rule.choices
        : typeof choiceConfig?.config === "string"
            ? choiceConfig.config
            : null;
    if (sourceItemType === "feat" && configKey && ENABLED_FEAT_CONFIG_CHOICE_KEYS.has(configKey)) {
        const options = resolveConfiguredChoiceOptions(configKey, localize);
        return options.length > 0
            ? {
                optionDomain: "generic",
                options,
            }
            : null;
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
//# sourceMappingURL=rule-discovery.js.map