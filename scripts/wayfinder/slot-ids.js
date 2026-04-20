export const SLOT_IDS = {
    abilityBoostsLevel1: "ability-boosts-level-1",
    ancestry: "ancestry-level-1",
    background: "background-level-1",
    class: "class-level-1",
    deity: "deity-level-1",
    heritage: "heritage-level-1",
    wizardArcaneSchool: "class-branch-arcane-school-level-1",
};
export const SLOT_PREFIXES = {
    ancestryFeat: "ancestry-feat-level-",
    classBranch: "class-branch-",
    classChoice: "class-choice-",
    classFeat: "class-feat-level-",
    deity: "deity-level-",
    skillTraining: "skill-training-",
    spellChoice: "spell-choice-",
    wizardArcaneSchool: "class-branch-arcane-school-level-",
};
export function isSanctificationChoiceSlotId(slotId) {
    return /^class-choice-.+-sanctification-level-\d+$/.test(slotId);
}
export function isWizardArcaneSchoolSlotId(slotId) {
    return /^class-branch-arcane-school-level-\d+$/.test(slotId);
}
//# sourceMappingURL=slot-ids.js.map