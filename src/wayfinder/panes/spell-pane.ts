import type { OptionRecord, PendingStep, SelectionRef } from "../../types.js";
import type { PreviewPane, SpellChoiceStepPane } from "../view-models.js";

export function buildSpellChoicePane(args: {
  step: PendingStep;
  search: string;
  selectedSelections: SelectionRef[];
  selectedLabel: string | null;
  visibleOptions: OptionRecord[];
  infoState: SpellChoiceStepPane["infoState"];
  contextNote: string | null;
  preview: PreviewPane | null;
  modeLabel: string;
  previewValue: string;
}): SpellChoiceStepPane {
  const {
    step,
    search,
    selectedSelections,
    selectedLabel,
    visibleOptions,
    infoState,
    contextNote,
    preview,
    modeLabel,
    previewValue,
  } = args;
  const selectedValues = selectedSelections.map((selection) => `${selection.packId}:${selection.documentId}`);
  const requiredCount = step.spellChoice?.count ?? 0;

  return {
    kind: "spell-choice",
    isPickItem: false,
    isManual: false,
    isBoost: false,
    isSkillIncrease: false,
    isSkillTraining: false,
    isSingletonChoice: false,
    isClassChoice: false,
    isSpellChoice: true,
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel,
    title: step.title,
    description: step.description,
    search,
    selectedValues,
    selectedLabel,
    selectedCount: selectedValues.length,
    requiredCount,
    remainingCount: Math.max(0, requiredCount - selectedValues.length),
    resultCount: visibleOptions.length,
    contextNote,
    infoState,
    destinationLabel: step.spellChoice?.destination.label ?? "Spell destination",
    sourceName: step.spellChoice?.sourceName ?? "Spell source",
    options: visibleOptions.map((option) => ({
      ...option,
      selected: selectedValues.includes(option.value),
      previewing: option.value === previewValue,
      sourceLabel: option.source ?? "Unknown Source",
    })),
    preview,
  };
}
