export function buildSingletonChoicePane(args) {
    const { step, selectedValue, selectedLabel } = args;
    const singletonChoice = step.singletonChoice;
    if (!singletonChoice) {
        throw new Error(`Missing singletonChoice metadata for step ${step.id}`);
    }
    return {
        kind: "singleton-choice",
        isPickItem: false,
        isManual: false,
        isBoost: false,
        isSkillIncrease: false,
        isSkillTraining: false,
        isSingletonChoice: true,
        isClassChoice: false,
        isSpellChoice: false,
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel: "Choice",
        title: step.title,
        description: step.description,
        completed: typeof selectedValue === "string" && selectedValue.length > 0,
        selectedLabel,
        sourceName: singletonChoice.sourceName,
        sourceItemType: singletonChoice.sourceItemType,
        options: singletonChoice.options.map((option) => ({
            ...option,
            selected: option.value === selectedValue,
        })),
    };
}
//# sourceMappingURL=singleton-choice-pane.js.map