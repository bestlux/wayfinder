import { SKILL_LABELS } from "../constants.js";
import { formatSlug } from "./formatting.js";
export async function buildClassTrainingSteps(params) {
    const { draftClassSelection, targetLevel, fetchSelectionDocument, extractSlug, localize } = params;
    if (!draftClassSelection || targetLevel < 1) {
        return [];
    }
    const classDocument = await fetchSelectionDocument(draftClassSelection);
    if (!classDocument) {
        return [];
    }
    const classSlug = extractSlug(classDocument) ?? "class";
    const rules = Array.isArray(classDocument.system?.rules) ? classDocument.system.rules : [];
    const choiceRules = rules
        .map((rule, ruleIndex) => toTrainingChoiceRule(rule, ruleIndex, localize))
        .filter((rule) => !!rule);
    const additionalCount = Number(classDocument.system?.trainedSkills?.additional ?? 0);
    const fixedSkills = Array.isArray(classDocument.system?.trainedSkills?.value)
        ? classDocument.system.trainedSkills.value
            .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim().toLowerCase())
        : [];
    if (choiceRules.length === 0 && additionalCount <= 0) {
        return [];
    }
    return [
        {
            id: `skill-training-${classSlug}-level-1`,
            level: 1,
            kind: "skill-training",
            slotKind: "skill-training",
            title: `${classDocument.name} skill training`,
            description: "Choose the class skill training decisions this class grants at 1st level.",
            required: true,
            slotId: `skill-training-${classSlug}-level-1`,
            training: {
                classSlug,
                className: classDocument.name ?? "Class",
                fixedSkills,
                choiceRules,
                additionalCount,
            },
        },
    ];
}
export async function buildClassFeatSteps(params) {
    const { effectiveClassDocument, targetLevel, fulfilledCount } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classFeatLevels = Array.isArray(effectiveClassDocument.system?.classFeatLevels?.value)
        ? effectiveClassDocument.system.classFeatLevels.value
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 1 && value <= targetLevel)
            .map((value) => Math.floor(value))
        : [];
    if (classFeatLevels.length === 0) {
        return [];
    }
    const milestones = Array.from(new Set(classFeatLevels)).sort((left, right) => left - right);
    const startIndex = Math.min(Math.max(0, fulfilledCount), milestones.length);
    return milestones.slice(startIndex).map((level) => ({
        id: `class-feat-level-${level}`,
        level,
        kind: "pick-item",
        slotKind: "class-feat",
        title: `Level ${level} class feat`,
        description: "Pick a class or archetype feat unlocked at this milestone.",
        required: true,
        slotId: `class-feat-level-${level}`,
        filters: {
            itemType: "feat",
            featTypes: ["class", "archetype"],
            maxLevel: level,
        },
    }));
}
export async function buildClassBranchSteps(params) {
    const { draft, effectiveClassDocument, targetLevel, fetchSelectionDocument, extractSlug, readExistingBranchSelection, } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classFeatures = await getClassFeatureSources(effectiveClassDocument, targetLevel, fetchSelectionDocument);
    const classSlug = extractSlug(effectiveClassDocument);
    const steps = [];
    for (const feature of classFeatures) {
        const branch = extractClassBranchMeta(feature.document, feature.selection, classSlug, extractSlug);
        if (!branch) {
            continue;
        }
        const actorSelection = readExistingBranchSelection(branch);
        const draftSelection = draft.branchSelections[branch.slotId];
        if (actorSelection && !draftSelection) {
            continue;
        }
        steps.push({
            id: branch.slotId,
            level: feature.level,
            kind: "class-branch",
            slotKind: "class-branch",
            title: branch.selectorName,
            description: `Choose the ${branch.selectorName.toLowerCase()} option that defines this class path.`,
            required: true,
            slotId: branch.slotId,
            filters: {
                itemType: "feat",
                featTypes: ["classfeature"],
                maxLevel: feature.level,
            },
            branch,
        });
    }
    return steps;
}
export async function buildClassGrantedItemSteps(params) {
    const { draft, effectiveClassDocument, targetLevel, fetchSelectionDocument, extractSlug, readExistingGrantedSelection, } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classFeatures = await getClassFeatureSources(effectiveClassDocument, targetLevel, fetchSelectionDocument);
    const classSlug = extractSlug(effectiveClassDocument);
    const steps = [];
    for (const feature of classFeatures) {
        const grant = extractGrantedItemMeta(feature.document, feature.selection, classSlug);
        if (!grant) {
            continue;
        }
        const actorSelection = readExistingGrantedSelection(grant);
        const draftSelection = draft.selections[grant.slotId];
        if (actorSelection && !draftSelection) {
            continue;
        }
        steps.push({
            id: grant.slotId,
            level: feature.level,
            kind: "pick-item",
            slotKind: grant.itemType,
            title: grant.itemType === "deity" ? "Choose a deity" : `Choose ${grant.selectorName.toLowerCase()}`,
            description: grant.itemType === "deity"
                ? "Choose the deity that grants your divine skill, favored weapon, sanctification, and divine font."
                : `Choose the ${grant.selectorName.toLowerCase()} this class feature grants.`,
            required: true,
            slotId: grant.slotId,
            filters: {
                itemType: grant.itemType,
            },
            grantSelection: grant,
        });
    }
    return steps;
}
export async function buildClassChoiceSteps(params) {
    const { draft, effectiveClassDocument, effectiveDeityDocument, targetLevel, fetchSelectionDocument, extractSlug, localize, readExistingClassChoiceSelection, } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classFeatures = await getClassFeatureSources(effectiveClassDocument, targetLevel, fetchSelectionDocument);
    const classSlug = extractSlug(effectiveClassDocument);
    const rollOptions = buildChoiceRollOptions(effectiveDeityDocument);
    const steps = [];
    for (const feature of classFeatures) {
        const choices = extractClassChoiceMeta(feature.document, feature.selection, {
            classSlug,
            extractSlug,
            localize,
            rollOptions,
        });
        for (const choice of choices) {
            const actorSelection = readExistingClassChoiceSelection(choice);
            const draftSelection = draft.classChoices[choice.slotId];
            if (actorSelection && !draftSelection) {
                continue;
            }
            steps.push({
                id: choice.slotId,
                level: feature.level,
                kind: "class-choice",
                slotKind: "class-choice",
                title: choiceTitle(choice, localize),
                description: buildClassChoiceDescription(choice),
                required: true,
                slotId: choice.slotId,
                classChoice: choice,
            });
        }
    }
    return steps;
}
function choiceTitle(choice, localize) {
    const localized = localize(choice.sourceName);
    const flagLabel = formatSlug(choice.flag);
    if (choice.flag === "sanctification") {
        return "Sanctification";
    }
    if (choice.flag === "divineFont") {
        return "Divine Font";
    }
    return localized && localized !== choice.sourceName ? `${localized}: ${flagLabel}` : flagLabel;
}
function buildClassChoiceDescription(choice) {
    const classLabel = choice.classSlug ? formatSlug(choice.classSlug).toLowerCase() : "class";
    if (choice.flag === "sanctification") {
        return `Choose the sanctification your deity allows for this ${classLabel}.`;
    }
    if (choice.flag === "divineFont") {
        return `Choose the divine font your deity grants for this ${classLabel}.`;
    }
    return `Choose the ${formatSlug(choice.flag).toLowerCase()} this class feature grants.`;
}
async function getClassFeatureSources(classDocument, targetLevel, fetchSelectionDocument) {
    const items = Object.values(classDocument?.system?.items ?? {});
    const selections = items
        .filter((entry) => typeof entry?.uuid === "string" &&
        entry.uuid.startsWith("Compendium.") &&
        Number(entry.level ?? 0) <= targetLevel)
        .map((entry) => {
        const selection = selectionFromCompendiumUuid(entry.uuid ?? "", entry.name ?? "", "feat");
        if (!selection) {
            return null;
        }
        return {
            level: Number(entry.level ?? 1) || 1,
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
function toTrainingChoiceRule(rule, ruleIndex, localize) {
    if (rule?.key !== "ChoiceSet" || !Array.isArray(rule?.choices) || typeof rule?.flag !== "string") {
        return null;
    }
    const options = rule.choices
        .filter((choice) => typeof choice?.value === "string" && choice.value.length > 0)
        .map((choice) => {
        const slug = String(choice.value).trim().toLowerCase();
        return {
            slug,
            label: skillLabel(slug, typeof choice.label === "string" ? choice.label : undefined, localize),
        };
    })
        .filter((choice) => !!choice);
    if (options.length === 0 ||
        !looksLikeSkillChoiceRule(rule, options.map((option) => option.slug))) {
        return null;
    }
    return {
        ruleIndex,
        flag: rule.flag,
        prompt: localize(String(rule.prompt ?? "Choose a skill")),
        options,
    };
}
function extractClassBranchMeta(selectorDocument, selectorSelection, classSlug, extractSlug) {
    if (!selectorDocument || selectorDocument.type !== "feat" || selectorDocument?.system?.category !== "classfeature") {
        return null;
    }
    const rules = Array.isArray(selectorDocument.system?.rules) ? selectorDocument.system.rules : [];
    const choiceRuleIndex = rules.findIndex((rule) => rule?.key === "ChoiceSet" && typeof rule?.flag === "string");
    if (choiceRuleIndex === -1) {
        return null;
    }
    const choiceRule = rules[choiceRuleIndex];
    const grantRule = rules.find((rule) => rule?.key === "GrantItem" && typeof rule?.uuid === "string");
    if (!grantRule) {
        return null;
    }
    const optionTag = extractChoiceTag(choiceRule, String(choiceRule.flag));
    if (!optionTag) {
        return null;
    }
    const selectorSlug = extractSlug(selectorDocument) ?? selectorSelection.documentId;
    const level = Number(selectorDocument?.system?.level?.value ?? 1) || 1;
    return {
        selectorPackId: selectorSelection.packId,
        selectorDocumentId: selectorSelection.documentId,
        selectorUuid: selectorSelection.uuid,
        selectorName: selectorDocument.name ?? selectorSelection.name,
        selectorRuleIndex: choiceRuleIndex,
        flag: String(choiceRule.flag),
        optionTag,
        classSlug,
        dependsOn: referencesDeity(choiceRule) || optionTag === "champion-cause" ? "deity" : "class",
        slotId: `class-branch-${selectorSlug}-level-${level}`,
    };
}
function extractGrantedItemMeta(selectorDocument, selectorSelection, classSlug) {
    if (!selectorDocument || selectorDocument.type !== "feat" || selectorDocument?.system?.category !== "classfeature") {
        return null;
    }
    const rules = Array.isArray(selectorDocument.system?.rules) ? selectorDocument.system.rules : [];
    const choiceRuleIndex = rules.findIndex((rule) => rule?.key === "ChoiceSet" && typeof rule?.flag === "string" && rule?.choices?.itemType === "deity");
    if (choiceRuleIndex === -1) {
        return null;
    }
    const choiceRule = rules[choiceRuleIndex];
    const choiceFlag = String(choiceRule.flag);
    const grantRuleIndex = rules.findIndex((rule) => rule?.key === "GrantItem" && typeof rule?.uuid === "string" && rule.uuid.includes(`rulesSelections.${choiceFlag}`));
    if (grantRuleIndex === -1) {
        return null;
    }
    return {
        slotId: `deity-level-${Number(selectorDocument?.system?.level?.value ?? 1) || 1}`,
        selectorPackId: selectorSelection.packId,
        selectorDocumentId: selectorSelection.documentId,
        selectorUuid: selectorSelection.uuid,
        selectorName: selectorDocument.name ?? selectorSelection.name,
        selectorRuleIndex: choiceRuleIndex,
        grantRuleIndex,
        flag: choiceFlag,
        itemType: "deity",
        classSlug,
    };
}
function extractClassChoiceMeta(sourceDocument, sourceSelection, args) {
    if (!sourceDocument || sourceDocument.type !== "feat" || sourceDocument?.system?.category !== "classfeature") {
        return [];
    }
    const rules = Array.isArray(sourceDocument.system?.rules) ? sourceDocument.system.rules : [];
    const sourceSlug = args.extractSlug(sourceDocument) ?? sourceSelection.documentId;
    const level = Number(sourceDocument?.system?.level?.value ?? 1) || 1;
    return rules.flatMap((rule, ruleIndex) => {
        const selectionKey = extractClassChoiceKey(rule);
        if (rule?.key !== "ChoiceSet" || !selectionKey || !Array.isArray(rule?.choices)) {
            return [];
        }
        const options = rule.choices
            .filter((choice) => typeof choice?.value === "string" && choice.value.length > 0)
            .filter((choice) => evaluatePredicate(choice.predicate, args.rollOptions))
            .map((choice) => ({
            value: String(choice.value),
            label: resolveChoiceLabel(choice.label, String(choice.value), args.localize),
            img: typeof choice.img === "string" && choice.img.length > 0 ? choice.img : null,
            detail: null,
        }));
        const dependsOn = referencesDeity(rule) ? "deity" : "class";
        if (options.length === 0) {
            return [];
        }
        return [
            {
                slotId: `class-choice-${sourceSlug}-${selectionKey}-level-${level}`,
                sourcePackId: sourceSelection.packId,
                sourceDocumentId: sourceSelection.documentId,
                sourceUuid: sourceSelection.uuid,
                sourceName: sourceDocument.name ?? sourceSelection.name,
                sourceRuleIndex: ruleIndex,
                flag: selectionKey,
                classSlug: args.classSlug,
                dependsOn,
                options,
            },
        ];
    });
}
function extractClassChoiceKey(rule) {
    const candidates = [rule?.flag, rule?.slug, rule?.rollOption];
    for (const value of candidates) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
function buildChoiceRollOptions(deityDocument) {
    const options = new Set();
    if (!deityDocument) {
        return options;
    }
    options.add("deity");
    for (const font of Array.isArray(deityDocument?.system?.font) ? deityDocument.system.font : []) {
        if (typeof font === "string" && font.trim()) {
            options.add(`deity:primary:font:${font.trim().toLowerCase()}`);
        }
    }
    const sanctification = deityDocument?.system?.sanctification;
    if (sanctification && typeof sanctification === "object") {
        const modal = typeof sanctification.modal === "string" ? sanctification.modal.trim().toLowerCase() : "";
        const values = Array.isArray(sanctification.what) ? sanctification.what : [];
        for (const value of values) {
            if (modal && typeof value === "string" && value.trim()) {
                options.add(`deity:primary:sanctification:${modal}:${value.trim().toLowerCase()}`);
            }
        }
    }
    return options;
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
    const text = JSON.stringify(rule ?? {});
    return text.includes("deity:primary:");
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
    const filters = Array.isArray(choiceRule?.choices?.filter) ? choiceRule.choices.filter : [];
    const directTag = filters
        .filter((entry) => typeof entry === "string")
        .map((entry) => /^item:tag:(.+)$/.exec(entry)?.[1] ?? null)
        .find((entry) => typeof entry === "string" && entry.length > 0);
    if (directTag) {
        return directTag.trim().toLowerCase();
    }
    const uuid = typeof choiceRule?.uuid === "string" ? choiceRule.uuid : "";
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
function looksLikeSkillChoiceRule(rule, optionSlugs) {
    if (optionSlugs.length === 0) {
        return false;
    }
    const recognizedCount = optionSlugs.filter((slug) => isConfiguredSkillSlug(slug)).length;
    if (recognizedCount === optionSlugs.length) {
        return true;
    }
    const hintText = `${String(rule?.flag ?? "")} ${String(rule?.prompt ?? "")}`.toLowerCase();
    return /\bskill\b|\bskills\b|\blore\b/.test(hintText);
}
function isConfiguredSkillSlug(value) {
    const slug = value.trim().toLowerCase();
    if (Object.hasOwn(SKILL_LABELS, slug)) {
        return true;
    }
    const configured = globalThis.CONFIG?.PF2E?.skills;
    return !!configured && typeof configured === "object" && Object.hasOwn(configured, slug);
}
function skillLabel(slug, label, localize) {
    const localized = typeof label === "string" && label.length > 0 ? localize(label) : "";
    if (localized && localized !== label) {
        return localized;
    }
    const configured = globalThis.CONFIG?.PF2E?.skills?.[slug];
    const configuredLabel = typeof configured === "string" ? configured : configured?.label;
    const fallback = typeof configuredLabel === "string" && configuredLabel.length > 0
        ? configuredLabel
        : (SKILL_LABELS[slug] ?? formatSlug(slug));
    return localize(fallback);
}
//# sourceMappingURL=class-choice-service.js.map