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
    return [{
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
                additionalCount
            }
        }];
}
export async function buildClassBranchSteps(params) {
    const { draft, effectiveClassDocument, targetLevel, fetchSelectionDocument, extractSlug, readExistingBranchSelection } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classSlug = extractSlug(effectiveClassDocument);
    const items = Object.values(effectiveClassDocument?.system?.items ?? {});
    const selectorSelections = items
        .filter((entry) => typeof entry?.uuid === "string"
        && entry.uuid.startsWith("Compendium.")
        && Number(entry.level ?? 0) <= targetLevel)
        .map((entry) => selectionFromCompendiumUuid(entry.uuid ?? "", entry.name ?? "", "feat"))
        .filter((entry) => entry !== null);
    const selectorDocuments = await Promise.all(selectorSelections.map((selection) => fetchSelectionDocument(selection)));
    const steps = [];
    for (let index = 0; index < selectorSelections.length; index += 1) {
        const selectorSelection = selectorSelections[index];
        const selectorDocument = selectorDocuments[index];
        const branch = extractClassBranchMeta(selectorDocument, selectorSelection, classSlug, extractSlug);
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
            level: selectorDocument?.system?.level?.value ?? 1,
            kind: "class-branch",
            slotKind: "class-branch",
            title: branch.selectorName,
            description: `Choose the ${branch.selectorName.toLowerCase()} option that defines this class path.`,
            required: true,
            slotId: branch.slotId,
            filters: {
                itemType: "feat",
                featTypes: ["classfeature"],
                maxLevel: selectorDocument?.system?.level?.value ?? 1
            },
            branch
        });
    }
    return steps;
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
            label: skillLabel(slug, typeof choice.label === "string" ? choice.label : undefined, localize)
        };
    })
        .filter((choice) => !!choice);
    if (options.length === 0 || !looksLikeSkillChoiceRule(rule, options.map((option) => option.slug))) {
        return null;
    }
    return {
        ruleIndex,
        flag: rule.flag,
        prompt: localize(String(rule.prompt ?? "Choose a skill")),
        options
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
        slotId: `class-branch-${selectorSlug}-level-${level}`
    };
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
        level: null
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