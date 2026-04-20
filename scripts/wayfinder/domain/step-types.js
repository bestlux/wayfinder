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
export function createClassBranchStep(level, branch, options = {}) {
    return {
        ...createBaseStep("class-branch", "class-branch", level, options.title ?? branch.selectorName, options.description ?? `Choose the ${branch.selectorName.toLowerCase()} option that defines this class path.`, {
            ...options,
            slotId: options.slotId ?? branch.slotId,
        }),
        filters: options.filters ?? {
            itemType: "feat",
            featTypes: ["classfeature"],
            maxLevel: level,
        },
        branch,
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
export function isClassChoiceStep(step) {
    return step.kind === "class-choice";
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
    deity: 4,
    "skill-training": 5,
    "class-choice": 6,
    "class-branch": 7,
    "spell-choice": 8,
    "ancestry-feat": 9,
    "class-feat": 10,
    "skill-feat": 11,
    "general-feat": 12,
    "ability-boosts": 13,
    "skill-increase": 14,
};
const STEP_MODE_LABELS = {
    "pick-item": "Selection",
    manual: "Manual",
    boost: "Boosts",
    "skill-increase": "Skill",
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