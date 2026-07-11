export function buildClassChoicePane(args) {
    const { step, selectedValue, selectedLabel, blocked, blockedTitle, blockedMessage } = args;
    if (step.kind !== "class-choice" && step.kind !== "class-archetype") {
        throw new Error(`Expected class choice metadata for step ${step.id}`);
    }
    const choice = step.kind === "class-archetype" ? step.classArchetype : step.classChoice;
    const dependsOn = step.kind === "class-archetype" ? "class" : step.classChoice.dependsOn;
    return {
        kind: step.kind,
        isPickItem: false,
        isManual: false,
        isBoost: false,
        isSkillIncrease: false,
        isSkillTraining: false,
        isSingletonChoice: false,
        isLanguageChoice: false,
        isClassChoice: true,
        isSpellChoice: false,
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel: step.kind === "class-archetype" ? "Class Archetype" : "Class Choice",
        title: step.title,
        description: step.description,
        completed: typeof selectedValue === "string" && selectedValue.length > 0,
        selectedLabel,
        eyebrow: step.kind === "class-archetype" ? "Class Archetype" : "Class Choice",
        action: step.kind === "class-archetype" ? "select-class-archetype" : "select-class-choice",
        sourceName: choice.sourceName,
        dependsOn,
        blocked,
        blockedTitle,
        blockedMessage,
        options: choice.options.map((option) => ({
            ...option,
            selected: option.value === selectedValue,
        })),
    };
}
//# sourceMappingURL=class-choice-pane.js.map