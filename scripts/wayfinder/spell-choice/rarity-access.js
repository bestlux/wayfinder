export function canGrantRestrictedSpellRarityAccess(step) {
    return (step.kind === "spell-choice" &&
        step.spellChoice.restrictToCommon === true &&
        (step.spellChoice.allowedSpellSlugs?.length ?? 0) === 0 &&
        step.spellChoice.curriculumSpellNames.length === 0);
}
export function grantsRestrictedSpellRarityAccess(step, accessGranted) {
    if (!accessGranted || !canGrantRestrictedSpellRarityAccess(step) || step.kind !== "spell-choice") {
        return step;
    }
    return {
        ...step,
        spellChoice: {
            ...step.spellChoice,
            restrictToCommon: false,
        },
    };
}
//# sourceMappingURL=rarity-access.js.map