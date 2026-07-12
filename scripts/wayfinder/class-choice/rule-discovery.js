import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { formatSlug } from "../formatting.js";
import { isRecord, matchesChoicePredicate, toNonEmptyString } from "../rule-data.js";
import { getConfiguredSkills, isConfiguredSkillSlug, resolveSkillLabel } from "./skill-config.js";
export function findRelevantClassRules(document) {
    const rules = document?.system?.rules;
    return Array.isArray(rules) ? rules.filter(isRecord) : [];
}
export function discoverSkillTrainingMeta(args) {
    const { classDocument, classSelection, extractSlug, localize, intelligenceModifier } = args;
    const document = classDocument;
    const configuredSkills = getConfiguredSkills();
    const className = toNonEmptyString(document?.name) ?? "Class";
    const choiceRules = findRelevantClassRules(classDocument)
        .map((rule, ruleIndex) => toTrainingChoiceRule(rule, ruleIndex, localize, configuredSkills, className, classSelection))
        .filter((rule) => rule !== null);
    const additionalCount = Math.max(0, toNonNegativeNumber(document?.system?.trainedSkills?.additional) + Math.trunc(intelligenceModifier));
    const fixedSkills = toStringArray(document?.system?.trainedSkills?.value).map((entry) => entry.toLowerCase());
    if (choiceRules.length === 0 && additionalCount <= 0) {
        return null;
    }
    return {
        classSlug: extractSlug(classDocument) ?? "class",
        className,
        fixedSkills,
        fixedLores: [],
        choiceRules,
        loreChoices: [],
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
    return discoverClassBranchMetas(args)[0] ?? null;
}
export function discoverClassBranchMetas(args) {
    const { selectorDocument, selectorSelection, classSlug, extractSlug } = args;
    const document = selectorDocument;
    if (document?.type !== "feat" || document.system?.category !== "classfeature") {
        return [];
    }
    const rules = findRelevantClassRules(selectorDocument);
    const selectorSlug = extractSlug(selectorDocument) ?? selectorSelection.documentId;
    const level = toFeatureLevel(document.system?.level?.value);
    const selectorName = toNonEmptyString(document.name) ?? selectorSelection.name;
    const choiceRules = rules
        .map((rule, ruleIndex) => ({ rule, ruleIndex }))
        .filter((entry) => entry.rule.key === "ChoiceSet" && typeof entry.rule.flag === "string")
        .flatMap((entry) => {
        const choiceFlag = toNonEmptyString(entry.rule.flag);
        const filters = extractChoiceFilters(entry.rule);
        if (!choiceFlag || !filters) {
            return [];
        }
        if (filters.itemType === "deity") {
            return [];
        }
        const grantRuleIndex = rules.findIndex((rule) => rule.key === "GrantItem" &&
            typeof rule.uuid === "string" &&
            rule.uuid.includes(`rulesSelections.${choiceFlag}`));
        if (grantRuleIndex === -1) {
            return [];
        }
        return [{ ...entry, choiceFlag, filters, grantRuleIndex }];
    });
    return choiceRules.map((entry) => {
        const optionTag = extractChoiceTag(entry.rule, entry.choiceFlag) ?? entry.choiceFlag.trim().toLowerCase();
        const slotSuffix = choiceRules.length === 1 ? "" : `-${entry.choiceFlag}`;
        return {
            selectorPackId: selectorSelection.packId,
            selectorDocumentId: selectorSelection.documentId,
            selectorUuid: selectorSelection.uuid,
            selectorName,
            selectorRuleIndex: entry.ruleIndex,
            grantRuleIndex: entry.grantRuleIndex,
            flag: entry.choiceFlag,
            rollOption: toNonEmptyString(entry.rule.rollOption),
            optionTag,
            classSlug,
            dependsOn: referencesDeity(entry.rule) || optionTag === "champion-cause" ? "deity" : "class",
            slotId: `class-branch-${selectorSlug}${slotSuffix}-level-${level}`,
            filters: entry.filters,
            predicate: Array.isArray(entry.rule.predicate) ? entry.rule.predicate : [],
        };
    });
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
        sourceItemType: "classfeature",
        selectorPackId: selectorSelection.packId,
        selectorDocumentId: selectorSelection.documentId,
        selectorUuid: selectorSelection.uuid,
        selectorName: toNonEmptyString(document.name) ?? selectorSelection.name,
        selectorRuleIndex: choiceRuleIndex,
        grantRuleIndex,
        flag: choiceFlag,
        itemType: "deity",
        classSlug,
        dependsOn: "class",
        filters: {
            itemType: "deity",
        },
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
    const configuredSkills = getConfiguredSkills();
    const activeRollOptions = new Set(rollOptions);
    const choiceRefs = [];
    const result = [];
    const rules = findRelevantClassRules(sourceDocument);
    rules.forEach((rule, ruleIndex) => {
        const selectionKey = extractClassChoiceKey(rule, sourceSlug);
        if (rule.key !== "ChoiceSet" || !selectionKey) {
            return;
        }
        const slotId = "class-choice-" + sourceSlug + "-" + selectionKey + "-level-" + level;
        const options = resolveClassChoiceOptions(rule.choices, activeRollOptions, localize);
        const isTrainingChoice = looksLikeSkillChoiceRule(rule, options.map((option) => option.value.trim().toLowerCase()), configuredSkills);
        const dependencyRefs = sameItemChoiceDependencies(rule, choiceRefs);
        if (options.length > 0 && !isTrainingChoice) {
            result.push({
                slotId,
                sourcePackId: sourceSelection.packId,
                sourceDocumentId: sourceSelection.documentId,
                sourceUuid: sourceSelection.uuid,
                sourceName: toNonEmptyString(document.name) ?? sourceSelection.name,
                sourceRuleIndex: ruleIndex,
                flag: selectionKey,
                rollOption: toNonEmptyString(rule.rollOption),
                classSlug,
                dependsOn: referencesDeity(rule) ? "deity" : "class",
                ...(dependencyRefs.length > 0
                    ? {
                        dependsOnChoices: dependencyRefs.map((entry) => ({
                            sourceUuid: sourceSelection.uuid,
                            flag: entry.flag,
                        })),
                    }
                    : {}),
                options,
            });
        }
        const selectedValue = toNonEmptyString(args.selectedValuesBySlotId?.[slotId]) ??
            toNonEmptyString(args.existingSelectionsByFlag?.[selectionKey]) ??
            toNonEmptyString(args.existingSelectionsByFlag?.[toNonEmptyString(rule.flag) ?? ""]) ??
            (args.assumeFirstChoiceSelection ? (options[0]?.value ?? null) : null);
        const choiceRef = {
            flag: selectionKey,
            rawFlag: toNonEmptyString(rule.flag),
            rollOption: toNonEmptyString(rule.rollOption),
            dependencyKeys: sameItemChoiceDependencyKeys(rules, selectionKey, toNonEmptyString(rule.flag), toNonEmptyString(rule.rollOption)),
        };
        choiceRefs.push(choiceRef);
        if (selectedValue) {
            addSameItemChoiceRollOptions(activeRollOptions, rules, choiceRef, selectedValue);
        }
    });
    return result;
}
function resolveClassChoiceOptions(choices, rollOptions, localize) {
    if (Array.isArray(choices)) {
        return choices
            .filter((choice) => isRecord(choice))
            .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
            .filter((choice) => evaluatePredicate(choice.predicate, rollOptions))
            .map((choice) => ({
            value: String(choice.value),
            label: resolveChoiceLabel(typeof choice.label === "string" ? choice.label : undefined, String(choice.value), localize),
            img: typeof choice.img === "string" && choice.img.length > 0 ? choice.img : null,
            detail: null,
        }));
    }
    if (typeof choices === "string") {
        return resolveConfiguredChoiceOptions(choices, localize);
    }
    return [];
}
export function resolveConfiguredChoiceOptions(choiceSetKey, localize) {
    if (choiceSetKey.startsWith("flags.")) {
        return [];
    }
    const pf2eConfig = globalThis.CONFIG?.PF2E;
    const choices = pf2eConfig?.[choiceSetKey];
    if (!isRecord(choices)) {
        return [];
    }
    return Object.entries(choices)
        .filter((entry) => typeof entry[1] === "string" && entry[0].length > 0)
        .map(([value, label]) => ({
        value,
        label: resolveChoiceLabel(label, value, localize),
        img: null,
        detail: null,
    }));
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
function toTrainingChoiceRule(rule, ruleIndex, localize, configuredSkills, className, classSelection) {
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
        key: `class:${String(rule.flag).trim().toLowerCase()}`,
        flag: rule.flag,
        prompt: localize(typeof rule.prompt === "string" ? rule.prompt : "Choose a skill"),
        sourceLabel: className,
        options,
        persistence: classSelection
            ? {
                sourceItemType: "class",
                sourcePackId: classSelection.packId,
                sourceDocumentId: classSelection.documentId,
                sourceUuid: classSelection.uuid,
                sourceRuleIndex: ruleIndex,
            }
            : null,
    };
}
function extractClassChoiceKey(rule, sourceSlug) {
    const candidates = [rule.flag, rule.slug];
    for (const value of candidates) {
        const candidate = toNonEmptyString(value);
        if (candidate) {
            return sanitizeChoiceFlag(candidate);
        }
    }
    return toDromedaryFlag(sourceSlug);
}
function sanitizeChoiceFlag(value) {
    return value.replace(/[^-a-z0-9]/gi, "");
}
function toDromedaryFlag(value) {
    const parts = value
        .trim()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
    if (parts.length === 0) {
        return null;
    }
    return parts
        .map((part, index) => {
        const lower = part.toLowerCase();
        return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
        .join("");
}
function evaluatePredicate(predicate, rollOptions) {
    return !predicate || matchesChoicePredicate(predicate, (statement) => rollOptions.has(statement));
}
function sameItemChoiceDependencies(rule, previousChoices) {
    if (!Array.isArray(rule.choices) || previousChoices.length === 0) {
        return [];
    }
    const predicates = rule.choices
        .filter(isRecord)
        .flatMap((choice) => (choice.predicate === undefined ? [] : [choice.predicate]));
    if (predicates.length === 0) {
        return [];
    }
    const serialized = JSON.stringify(predicates).toLowerCase();
    return previousChoices.filter((choice) => choice.dependencyKeys.some((key) => {
        const normalized = key.trim().toLowerCase();
        return (normalized.length > 0 &&
            (serialized.includes(`${normalized}:`) || serialized.includes(`rulesselections.${normalized}`)));
    }));
}
function addSameItemChoiceRollOptions(rollOptions, rules, choiceRef, selectedValue) {
    const normalizedValue = selectedValue.trim().toLowerCase();
    if (!normalizedValue) {
        return;
    }
    for (const key of new Set([choiceRef.rollOption, choiceRef.flag, choiceRef.rawFlag].filter(isPresentString))) {
        rollOptions.add(`${key}:${normalizedValue}`.toLowerCase());
    }
    for (const option of resolveTemplatedRollOptions(rules, choiceRef.flag, choiceRef.rawFlag, normalizedValue)) {
        rollOptions.add(option.toLowerCase());
    }
}
function sameItemChoiceDependencyKeys(rules, selectionKey, rawFlag, rollOption) {
    const keys = new Set([selectionKey, rawFlag, rollOption].filter(isPresentString));
    for (const option of templatedRollOptionStrings(rules, selectionKey, rawFlag)) {
        const resolved = resolveTemplatedRollOption(option, selectionKey, rawFlag, "__wayfinder_value__");
        if (!resolved) {
            continue;
        }
        const markerIndex = resolved.indexOf("__wayfinder_value__");
        if (markerIndex <= 0) {
            continue;
        }
        const prefix = resolved.slice(0, markerIndex).replace(/:+$/, "");
        if (prefix) {
            keys.add(prefix);
        }
    }
    return Array.from(keys);
}
function resolveTemplatedRollOptions(rules, selectionKey, rawFlag, selectedValue) {
    return templatedRollOptionStrings(rules, selectionKey, rawFlag)
        .map((option) => resolveTemplatedRollOption(option, selectionKey, rawFlag, selectedValue))
        .filter(isPresentString)
        .filter((option) => !/\{item\|flags\.system\.rulesSelections\.[^}]+\}/.test(option))
        .filter((option, index, all) => all.indexOf(option) === index);
}
function templatedRollOptionStrings(rules, selectionKey, rawFlag) {
    const flags = new Set([selectionKey, rawFlag].filter(isPresentString).map((entry) => entry.toLowerCase()));
    return rules.flatMap((rule) => {
        if (rule.key !== "RollOption") {
            return [];
        }
        const option = toNonEmptyString(rule.option);
        if (!option || !rollOptionTemplateReferencesAnyFlag(option, flags)) {
            return [];
        }
        return [option];
    });
}
function resolveTemplatedRollOption(option, selectionKey, rawFlag, selectedValue) {
    const flags = new Set([selectionKey, rawFlag].filter(isPresentString).map((entry) => entry.toLowerCase()));
    let resolvedAny = false;
    let unresolved = false;
    const resolved = option.replace(/\{item\|flags\.system\.rulesSelections\.([^}]+)\}/g, (_match, flag) => {
        if (!flags.has(String(flag).toLowerCase())) {
            unresolved = true;
            return "";
        }
        resolvedAny = true;
        return selectedValue;
    });
    return resolvedAny && !unresolved ? resolved : null;
}
function rollOptionTemplateReferencesAnyFlag(option, flags) {
    for (const match of option.matchAll(/\{item\|flags\.system\.rulesSelections\.([^}]+)\}/g)) {
        if (flags.has(String(match[1] ?? "").toLowerCase())) {
            return true;
        }
    }
    return false;
}
function isPresentString(value) {
    return typeof value === "string" && value.trim().length > 0;
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
function extractChoiceFilters(choiceRule) {
    const choices = isRecord(choiceRule.choices) ? choiceRule.choices : null;
    const rawFilter = Array.isArray(choices?.filter) ? choices.filter : [];
    const itemType = normalizeChoiceItemType(toNonEmptyString(choices?.itemType) ?? "feat");
    if (rawFilter.length === 0) {
        return null;
    }
    return {
        itemType,
        ...(itemType === "feat" ? { packIds: ["pf2e.classfeatures", "pf2e.feats-srd"] } : {}),
        ...(itemType === "action" ? { packIds: ["pf2e.actionspf2e"] } : {}),
        predicate: rawFilter,
    };
}
function normalizeChoiceItemType(itemType) {
    return itemType === "feature" ? "feat" : itemType;
}
function selectionFromCompendiumUuid(uuid, name, itemType) {
    const parsed = parseCompendiumItemUuid(uuid);
    if (!parsed) {
        return null;
    }
    return {
        slotId: "",
        packId: parsed.packId,
        documentId: parsed.documentId,
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
//# sourceMappingURL=rule-discovery.js.map