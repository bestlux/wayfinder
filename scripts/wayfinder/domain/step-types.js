function createBaseStep(kind, slotKind, level, title, description, options = {}) {
    const slotId = options.slotId ?? `${slotKind}-level-${level}`;
    return {
        id: slotId,
        level,
        kind,
        slotKind,
        title,
        description,
        required: options.required ?? true,
        slotId,
    };
}
export function createPickItemStep(slotKind, level, title, description, filters, options = {}) {
    return {
        ...createBaseStep("pick-item", slotKind, level, title, description, options),
        filters,
        ...(options.grantSelection ? { grantSelection: options.grantSelection } : {}),
        ...(options.staticGrantReplacement ? { staticGrantReplacement: options.staticGrantReplacement } : {}),
        ...(options.flagChoice ? { flagChoice: options.flagChoice } : {}),
    };
}
export function createManualStep(slotKind, level, title, description, options = {}) {
    return createBaseStep("manual", slotKind, level, title, description, options);
}
export function createBoostStep(level, title, description, options = {}) {
    return createBaseStep("boost", "ability-boosts", level, title, description, options);
}
export function createSkillIncreaseStep(level, title, description, options = {}) {
    return createBaseStep("skill-increase", "skill-increase", level, title, description, options);
}
export function createSkillTrainingStep(level, title, description, training, options = {}) {
    const slotId = options.slotId ?? `skill-training-${training.classSlug}-level-${level}`;
    return {
        ...createBaseStep("skill-training", "skill-training", level, title, description, {
            ...options,
            slotId,
        }),
        training,
    };
}
export function createSingletonChoiceStep(level, singletonChoice, options = {}) {
    return {
        ...createBaseStep("singleton-choice", "singleton-choice", level, options.title ?? singletonChoice.sourceName, options.description ?? singletonChoice.prompt ?? "", {
            ...options,
            slotId: options.slotId ?? singletonChoice.slotId,
        }),
        singletonChoice,
    };
}
export function createLanguageChoiceStep(level, languageChoice, options = {}) {
    return {
        ...createBaseStep("language-choice", "language-choice", level, options.title ?? "Bonus languages", options.description ?? "Choose the additional languages this character knows at 1st level.", {
            ...options,
            slotId: options.slotId ?? languageChoice.slotId,
        }),
        languageChoice,
    };
}
export function createClassBranchStep(level, branch, options = {}) {
    return {
        ...createBaseStep("class-branch", "class-branch", level, options.title ?? branch.selectorName, options.description ?? `Choose the ${branch.selectorName.toLowerCase()} option that defines this class path.`, {
            ...options,
            slotId: options.slotId ?? branch.slotId,
        }),
        filters: options.filters ??
            branch.filters ?? {
            itemType: "feat",
            featTypes: ["classfeature"],
            maxLevel: level,
        },
        branch,
    };
}
export function createClassArchetypeStep(level, classArchetype, options = {}) {
    return {
        ...createBaseStep("class-archetype", "class-archetype", level, options.title ?? "Choose a class path", options.description ??
            "Choose the standard class progression or a supported class archetype that replaces part of it.", {
            ...options,
            slotId: options.slotId ?? classArchetype.slotId,
        }),
        classArchetype,
    };
}
export function createClassChoiceStep(level, classChoice, options = {}) {
    return {
        ...createBaseStep("class-choice", "class-choice", level, options.title ?? classChoice.sourceName, options.description ?? "", {
            ...options,
            slotId: options.slotId ?? classChoice.slotId,
        }),
        classChoice,
    };
}
export function createSpellChoiceStep(level, title, description, spellChoice, options = {}) {
    return {
        ...createBaseStep("spell-choice", "spell-choice", level, title, description, {
            ...options,
            slotId: options.slotId ?? spellChoice.slotId,
        }),
        filters: options.filters ?? {
            itemType: "spell",
        },
        spellChoice,
    };
}
export function isPickItemStep(step) {
    return step.kind === "pick-item";
}
export function isClassBranchStep(step) {
    return step.kind === "class-branch";
}
export function isClassArchetypeStep(step) {
    return step.kind === "class-archetype";
}
export function isClassChoiceStep(step) {
    return step.kind === "class-choice";
}
export function isSingletonChoiceStep(step) {
    return step.kind === "singleton-choice";
}
export function isLanguageChoiceStep(step) {
    return step.kind === "language-choice";
}
export function isManualStep(step) {
    return step.kind === "manual";
}
export function isSelectionStep(step) {
    return step.kind === "pick-item" || step.kind === "class-branch";
}
export function isSkillIncreaseStep(step) {
    return step.kind === "skill-increase";
}
export function isSkillTrainingStep(step) {
    return step.kind === "skill-training";
}
export function isSpellChoiceStep(step) {
    return step.kind === "spell-choice";
}
const SLOT_KIND_SORT_WEIGHTS = {
    ancestry: 0,
    heritage: 1,
    background: 2,
    class: 3,
    "ancestry-feat": 4,
    "ability-boosts": 5,
    "grant-choice": 6,
    "flag-choice": 7,
    deity: 8,
    "class-archetype": 9,
    "singleton-choice": 10,
    "class-choice": 11,
    "class-branch": 12,
    "skill-training": 13,
    "language-choice": 14,
    "spell-choice": 15,
    "class-feat": 16,
    "archetype-feat": 17,
    "skill-feat": 18,
    "general-feat": 19,
    "skill-increase": 20,
};
const STEP_MODE_LABELS = {
    "pick-item": "Selection",
    manual: "Manual",
    boost: "Boosts",
    "skill-increase": "Skill",
    "singleton-choice": "Choice",
    "language-choice": "Languages",
    "class-archetype": "Class Archetype",
    "class-branch": "Class Path",
    "class-choice": "Class Choice",
    "spell-choice": "Spells",
    "skill-training": "Training",
};
export function getStepModeLabel(kind) {
    return STEP_MODE_LABELS[kind];
}
export function sortWeightForSlotKind(kind) {
    return SLOT_KIND_SORT_WEIGHTS[kind];
}
//# sourceMappingURL=step-types.js.map