export function buildLanguageChoicePane(args) {
    const { step, selectedValues, selectedLabel } = args;
    const languageChoice = step.languageChoice;
    const options = languageChoice.options.map((option) => ({
        ...option,
        selected: selectedValues.includes(option.value),
    }));
    const sourceOptions = options.filter((option) => !option.requiresGmApproval);
    const approvalOptions = options.filter((option) => option.requiresGmApproval);
    return {
        kind: "language-choice",
        isPickItem: false,
        isManual: false,
        isBoost: false,
        isSkillIncrease: false,
        isSkillTraining: false,
        isSingletonChoice: false,
        isLanguageChoice: true,
        isClassChoice: false,
        isSpellChoice: false,
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel: "Languages",
        title: step.title,
        description: step.description,
        completed: selectedValues.length === languageChoice.count,
        selectedLabel,
        selectedValues,
        selectedCount: selectedValues.length,
        requiredCount: languageChoice.count,
        remainingCount: Math.max(0, languageChoice.count - selectedValues.length),
        sourceName: languageChoice.sourceName,
        grantedLanguages: languageChoice.grantedLanguages,
        sourceOptions,
        approvalOptions,
        approvalOptionCount: approvalOptions.length,
        approvalOptionsOpen: approvalOptions.some((option) => option.selected),
    };
}
//# sourceMappingURL=language-choice-pane.js.map