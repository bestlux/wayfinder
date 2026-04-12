import type { PendingStep } from "../../types.js";
import type { ClassChoiceStepPane } from "../view-models.js";

export function buildClassChoicePane(args: {
  step: PendingStep;
  selectedValue: string | null;
  selectedLabel: string;
  blocked: boolean;
  blockedTitle: string | null;
  blockedMessage: string | null;
}): ClassChoiceStepPane {
  const { step, selectedValue, selectedLabel, blocked, blockedTitle, blockedMessage } = args;
  const classChoice = step.classChoice;
  if (!classChoice) {
    throw new Error(`Missing classChoice metadata for step ${step.id}`);
  }

  return {
    kind: "class-choice",
    isPickItem: false,
    isManual: false,
    isBoost: false,
    isSkillIncrease: false,
    isSkillTraining: false,
    isClassChoice: true,
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: "Class Choice",
    title: step.title,
    description: step.description,
    completed: typeof selectedValue === "string" && selectedValue.length > 0,
    selectedLabel,
    sourceName: classChoice.sourceName,
    dependsOn: classChoice.dependsOn,
    blocked,
    blockedTitle,
    blockedMessage,
    options: classChoice.options.map((option) => ({
      ...option,
      selected: option.value === selectedValue,
    })),
  };
}
