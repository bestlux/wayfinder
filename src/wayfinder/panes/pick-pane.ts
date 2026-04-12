import { fetchSelectionDocument } from "../../pack-service.js";
import type { DraftState, OptionRecord, PendingStep, SelectionRef } from "../../types.js";
import { buildPreviewDetails, formatSlug } from "../formatting.js";
import type { PickStepPane, PreviewPane } from "../view-models.js";

export function buildPickItemPane(args: {
  step: PendingStep;
  search: string;
  selectedValue: string;
  selectedLabel: string | null;
  visibleOptions: OptionRecord[];
  infoState: PickStepPane["infoState"];
  contextNote: string | null;
  preview: PreviewPane | null;
  modeLabel: string;
  previewValue: string;
}): PickStepPane {
  const {
    step,
    search,
    selectedValue,
    selectedLabel,
    visibleOptions,
    infoState,
    contextNote,
    preview,
    modeLabel,
    previewValue,
  } = args;
  return {
    kind: "pick-item",
    isPickItem: true,
    isManual: false,
    isBoost: false,
    isSkillIncrease: false,
    isSkillTraining: false,
    isClassChoice: false,
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel,
    title: step.title,
    description: step.description,
    search,
    selectedValue,
    selectedLabel,
    resultCount: visibleOptions.length,
    contextNote,
    infoState,
    options: visibleOptions.map((option) => ({
      ...option,
      selected: option.value === selectedValue,
      previewing: option.value === previewValue,
      sourceLabel: option.source ?? "Unknown Source",
    })),
    preview,
  };
}

export async function buildPreview(option: OptionRecord | null, selectedValue: string): Promise<PreviewPane | null> {
  if (!option) {
    return null;
  }

  const document = await fetchSelectionDocument({
    slotId: "",
    packId: option.packId,
    documentId: option.documentId,
    uuid: option.uuid,
    itemType: option.itemType,
    featType: option.featType,
    name: option.name,
    level: option.level,
  });

  if (!document) {
    return {
      title: option.name,
      img: option.img,
      source: option.source,
      rarity: option.rarity,
      tags: [],
      details: [],
      description: "",
      selected: option.value === selectedValue,
      selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
      value: option.value,
    };
  }

  const system = document.system ?? {};
  return {
    title: document.name,
    img: document.img,
    source: system.publication?.title?.trim() || option.source,
    rarity: system.traits?.rarity ?? option.rarity,
    tags: Array.isArray(system.traits?.value) ? system.traits.value.map((trait: string) => formatSlug(trait)) : [],
    details: buildPreviewDetails(document),
    description: await TextEditor.enrichHTML(String(system.description?.value ?? ""), { async: true }),
    selected: option.value === selectedValue,
    selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
    value: option.value,
  };
}

export function selectedSelection(step: PendingStep, draft: DraftState): SelectionRef | null {
  return step.kind === "class-branch"
    ? (draft.branchSelections[step.slotId] ?? null)
    : (draft.selections[step.slotId] ?? null);
}

export function selectedValueFor(step: PendingStep, draft: DraftState): string {
  const selection = selectedSelection(step, draft);
  return selection ? `${selection.packId}:${selection.documentId}` : "";
}

export function resolvePreviewValue(
  stepId: string,
  filteredOptions: OptionRecord[],
  allOptions: OptionRecord[],
  selectedValue: string,
  previewValueByStepId: Map<string, string>
): string {
  const current = previewValueByStepId.get(stepId);
  if (current && allOptions.some((option) => option.value === current)) {
    return current;
  }

  if (selectedValue) {
    previewValueByStepId.set(stepId, selectedValue);
    return selectedValue;
  }

  const fallback = filteredOptions[0]?.value ?? allOptions[0]?.value ?? "";
  if (fallback) {
    previewValueByStepId.set(stepId, fallback);
  }

  return fallback;
}

export function matchesSearch(option: OptionRecord, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [option.name, option.source ?? "", option.rarity ?? ""].some((value) => value.toLowerCase().includes(query));
}
