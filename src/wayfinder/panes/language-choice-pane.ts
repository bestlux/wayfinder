import type { LanguageChoiceStep } from "../../types.js";
import type { LanguageChoiceStepPane } from "../view-models.js";

export function buildLanguageChoicePane(args: {
  step: LanguageChoiceStep;
  selectedValues: string[];
  selectedLabel: string | null;
}): LanguageChoiceStepPane {
  const { step, selectedValues, selectedLabel } = args;
  const languageChoice = step.languageChoice;

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
    options: languageChoice.options.map((option) => ({
      ...option,
      selected: selectedValues.includes(option.value),
    })),
  };
}
