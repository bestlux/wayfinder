import { formatSlug } from "../formatting.js";
import { getConfiguredSkills, isConfiguredSkillSlug, resolveSkillLabel } from "./skill-config.js";
export function findRelevantClassRules(document) {
    const rules = document?.system?.rules;
    return Array.isArray(rules) ? rules.filter(isRecord) : [];
}
export function discoverSkillTrainingMeta(args) {
    const { classDocument, extractSlug, localize } = args;
    const document = classDocument;
    const configuredSkills = getConfiguredSkills();
    const choiceRules = findRelevantClassRules(classDocument)
        .map((rule, ruleIndex) => toTrainingChoiceRule(rule, ruleIndex, localize, configuredSkills))
        .filter((rule) => rule !== null);
    const additionalCount = toNonNegativeNumber(document?.system?.trainedSkills?.additional);
    const fixedSkills = toStringArray(document?.system?.trainedSkills?.value).map((entry) => entry.toLowerCase());
    if (choiceRules.length === 0 && additionalCount <= 0) {
        return null;
    }
    return {
        classSlug: extractSlug(classDocument) ?? "class",
        className: toNonEmptyString(document?.name) ?? "Class",
        fixedSkills,
        choiceRules,
        additionalCount,
    };
}
export async function getClassFeatureSources(classDocument, targetLevel, fetchSelectionDocument) {
    const items = Object.values(classDocument?.system?.items ?? {});
    const selections = items
        .filter((entry) => isRecord(entry) &&
        typeof entry.uuid === "string" &&
        entry.uuid.startsWith("Compendium.") &&
        toNonNegativeNumber(entry.level) <= targetLevel)
        .map((entry) => {
        const selection = selectionFromCompendiumUuid(entry.uuid ?? "", toNonEmptyString(entry.name) ?? "", "feat");
        if (!selection) {
            return null;
        }
        return {
            level: toFeatureLevel(entry.level),
            selection,
        };
    })
        .filter((entry) => entry !== null);
    const documents = await Promise.all(selections.map((entry) => fetchSelectionDocument(entry.selection)));
    return selections.map((entry, index) => ({
        level: entry.level,
        selection: entry.selection,
        document: documents[index],
    }));
}
export function discoverClassBranchMeta(args) {
    const { selectorDocument, selectorSelection, classSlug, extractSlug } = args;
    const document = selectorDocument;
    if (document?.type !== "feat" || document.system?.category !== "classfeature") {
        return null;
    }
    const rules = findRelevantClassRules(selectorDocument);
    const choiceRuleIndex = rules.findIndex((rule) => rule.key === "ChoiceSet" && typeof rule.flag === "string");
    if (choiceRuleIndex === -1) {
        return null;
    }
    const choiceRule = rules[choiceRuleIndex];
    const choiceFlag = toNonEmptyString(choiceRule.flag);
    const grantRule = rules.find((rule) => rule.key === "GrantItem" && typeof rule.uuid === "string");
    if (!choiceFlag || !grantRule) {
        return null;
    }
    const optionTag = extractChoiceTag(choiceRule, choiceFlag);
    if (!optionTag) {
        return null;
    }
    const selectorSlug = extractSlug(selectorDocument) ?? selectorSelection.documentId;
    const level = toFeatureLevel(document.system?.level?.value);
    return {
        selectorPackId: selectorSelection.packId,
        selectorDocumentId: selectorSelection.documentId,
        selectorUuid: selectorSelection.uuid,
        selectorName: toNonEmptyString(document.name) ?? selectorSelection.name,
        selectorRuleIndex: choiceRuleIndex,
        flag: choiceFlag,
        optionTag,
        classSlug,
        dependsOn: referencesDeity(choiceRule) || optionTag === "champion-cause" ? "deity" : "class",
        slotId: `class-branch-${selectorSlug}-level-${level}`,
    };
}
export function discoverGrantedItemMeta(args) {
    const { selectorDocument, selectorSelection, classSlug } = args;
    const document = selectorDocument;
    if (document?.type !== "feat" || document.system?.category !== "classfeature") {
        return null;
    }
    const rules = findRelevantClassRules(selectorDocument);
    const choiceRuleIndex = rules.findIndex((rule) => {
        const choices = isRecord(rule.choices) ? rule.choices : null;
        return rule.key === "ChoiceSet" && typeof rule.flag === "string" && choices?.itemType === "deity";
    });
    if (choiceRuleIndex === -1) {
        return null;
    }
    const choiceRule = rules[choiceRuleIndex];
    const choiceFlag = toNonEmptyString(choiceRule.flag);
    if (!choiceFlag) {
        return null;
    }
    const grantRuleIndex = rules.findIndex((rule) => rule.key === "GrantItem" && typeof rule.uuid === "string" && rule.uuid.includes(`rulesSelections.${choiceFlag}`));
    if (grantRuleIndex === -1) {
        return null;
    }
    return {
        slotId: `deity-level-${toFeatureLevel(document.system?.level?.value)}`,
        selectorPackId: selectorSelection.packId,
        selectorDocumentId: selectorSelection.documentId,
        selectorUuid: selectorSelection.uuid,
        selectorName: toNonEmptyString(document.name) ?? selectorSelection.name,
        selectorRuleIndex: choiceRuleIndex,
        grantRuleIndex,
        flag: choiceFlag,
        itemType: "deity",
        classSlug,
    };
}
export function discoverClassChoiceMeta(args) {
    const { sourceDocument, sourceSelection, classSlug, extractSlug, localize, rollOptions } = args;
    const document = sourceDocument;
    if (document?.type !== "feat" || document.system?.category !== "classfeature") {
        return [];
    }
    const sourceSlug = extractSlug(sourceDocument) ?? sourceSelection.documentId;
    const level = toFeatureLevel(document.system?.level?.value);
    return findRelevantClassRules(sourceDocument).flatMap((rule, ruleIndex) => {
        const selectionKey = extractClassChoiceKey(rule);
        if (rule.key !== "ChoiceSet" || !selectionKey || !Array.isArray(rule.choices)) {
            return [];
        }
        const options = rule.choices
            .filter((choice) => isRecord(choice))
            .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
            .filter((choice) => evaluatePredicate(choice.predicate, rollOptions))
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
                slotId: `class-choice-${sourceSlug}-${selectionKey}-level-${level}`,
                sourcePackId: sourceSelection.packId,
                sourceDocumentId: sourceSelection.documentId,
                sourceUuid: sourceSelection.uuid,
                sourceName: toNonEmptyString(document.name) ?? sourceSelection.name,
                sourceRuleIndex: ruleIndex,
                flag: selectionKey,
                classSlug,
                dependsOn: referencesDeity(rule) ? "deity" : "class",
                options,
            },
        ];
    });
}
export function buildChoiceRollOptions(deityDocument) {
    const document = deityDocument;
    const options = new Set();
    if (!document) {
        return options;
    }
    options.add("deity");
    for (const font of toStringArray(document.system?.font)) {
        options.add(`deity:primary:font:${font.toLowerCase()}`);
    }
    const modal = toNonEmptyString(document.system?.sanctification?.modal)?.toLowerCase();
    for (const value of toStringArray(document.system?.sanctification?.what)) {
        if (modal) {
            options.add(`deity:primary:sanctification:${modal}:${value.toLowerCase()}`);
        }
    }
    return options;
}
function toTrainingChoiceRule(rule, ruleIndex, localize, configuredSkills) {
    if (rule.key !== "ChoiceSet" || !Array.isArray(rule.choices) || typeof rule.flag !== "string") {
        return null;
    }
    const options = rule.choices
        .filter((choice) => isRecord(choice))
        .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
        .map((choice) => {
        const slug = String(choice.value).trim().toLowerCase();
        return {
            slug,
            label: resolveSkillLabel(slug, typeof choice.label === "string" ? choice.label : undefined, localize, configuredSkills),
        };
    });
    if (options.length === 0 ||
        !looksLikeSkillChoiceRule(rule, options.map((option) => option.slug), configuredSkills)) {
        return null;
    }
    return {
        ruleIndex,
        flag: rule.flag,
        prompt: localize(typeof rule.prompt === "string" ? rule.prompt : "Choose a skill"),
        options,
    };
}
function extractClassChoiceKey(rule) {
    const candidates = [rule.flag, rule.slug, rule.rollOption];
    for (const value of candidates) {
        const candidate = toNonEmptyString(value);
        if (candidate) {
            return candidate;
        }
    }
    return null;
}
function evaluatePredicate(predicate, rollOptions) {
    if (!predicate) {
        return true;
    }
    if (typeof predicate === "string") {
        return rollOptions.has(predicate);
    }
    if (Array.isArray(predicate)) {
        return predicate.every((entry) => evaluatePredicate(entry, rollOptions));
    }
    if (Array.isArray(predicate.or)) {
        return predicate.or.some((entry) => evaluatePredicate(entry, rollOptions));
    }
    if (Array.isArray(predicate.nor)) {
        return predicate.nor.every((entry) => !evaluatePredicate(entry, rollOptions));
    }
    if (predicate.not) {
        return !evaluatePredicate(predicate.not, rollOptions);
    }
    return true;
}
function referencesDeity(rule) {
    return JSON.stringify(rule).includes("deity:primary:");
}
function resolveChoiceLabel(label, value, localize) {
    if (typeof label === "string" && label.length > 0) {
        const localized = localize(label);
        if (localized && localized !== label) {
            return localized;
        }
        return label;
    }
    return formatSlug(value);
}
function extractChoiceTag(choiceRule, flag) {
    const choices = isRecord(choiceRule.choices) ? choiceRule.choices : null;
    const filters = Array.isArray(choices?.filter)
        ? choices.filter.filter((entry) => typeof entry === "string")
        : [];
    const directTag = filters
        .map((entry) => /^item:tag:(.+)$/.exec(entry)?.[1] ?? null)
        .find((entry) => typeof entry === "string" && entry.length > 0);
    if (directTag) {
        return directTag.trim().toLowerCase();
    }
    const uuid = toNonEmptyString(choiceRule.uuid) ?? "";
    return uuid.includes(`rulesSelections.${flag}`) ? flag.trim().toLowerCase() : null;
}
function selectionFromCompendiumUuid(uuid, name, itemType) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid);
    if (!match) {
        return null;
    }
    return {
        slotId: "",
        packId: match[1],
        documentId: match[2],
        uuid,
        itemType,
        featType: itemType === "feat" ? "classfeature" : null,
        name,
        level: null,
    };
}
function looksLikeSkillChoiceRule(rule, optionSlugs, configuredSkills) {
    if (optionSlugs.length === 0) {
        return false;
    }
    const recognizedCount = optionSlugs.filter((slug) => isConfiguredSkillSlug(slug, configuredSkills)).length;
    if (recognizedCount === optionSlugs.length) {
        return true;
    }
    const hintText = `${String(rule.flag ?? "")} ${String(rule.prompt ?? "")}`.toLowerCase();
    return /\bskill\b|\bskills\b|\blore\b/.test(hintText);
}
function toFeatureLevel(value) {
    return toNonNegativeNumber(value) || 1;
}
function toNonNegativeNumber(value) {
    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
}
function toStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
function toNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function isRecord(value) {
    return !!value && typeof value === "object";
}
//# sourceMappingURL=rule-discovery.js.map