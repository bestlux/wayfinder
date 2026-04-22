import type { EffectiveBuildState } from "../../build-state.js";
import type {
  DraftState,
  OptionContext,
  OptionRecord,
  PendingStep,
  PickerFilterKind,
  PickerFilterState,
  PickerInfoState,
} from "../../types.js";
import { getStepModeLabel } from "../domain/step-types.js";
import { buildClassChoicePane } from "../panes/class-choice-pane.js";
import { buildLanguageChoicePane } from "../panes/language-choice-pane.js";
import { buildPickItemPane, resolvePreviewValue, selectedSelection, selectedValueFor } from "../panes/pick-pane.js";
import {
  activePickerFilterCount,
  buildPickerFilterGroups,
  matchesPickerFilters,
  normalizePickerFilterState,
} from "../panes/picker-filters.js";
import { buildSingletonChoicePane } from "../panes/singleton-choice-pane.js";
import { buildSpellChoicePane } from "../panes/spell-pane.js";
import type {
  ClassChoiceStepPane,
  LanguageChoiceStepPane,
  PickStepPane,
  PreviewPane,
  SingletonChoiceStepPane,
  SpellChoiceStepPane,
} from "../view-models.js";

type SelectionPane =
  | ClassChoiceStepPane
  | LanguageChoiceStepPane
  | PickStepPane
  | SingletonChoiceStepPane
  | SpellChoiceStepPane;

interface BuildSelectionPaneDependencies {
  draft: DraftState;
  searchByStepId: Map<string, string>;
  pickerFiltersByStepId: Map<string, PickerFilterState>;
  previewValueByStepId: Map<string, string>;
  openPickerFilterMenu?: { stepId: string; filterKind: PickerFilterKind } | null;
  resolveOptionContext: () => Promise<OptionContext>;
  resolveDeityDocument: () => Promise<unknown | null>;
  buildContextNote: (step: PendingStep, context: OptionContext) => Promise<string | null>;
  resolveStepStatus: (step: PendingStep, effectiveBuildState: EffectiveBuildState) => Promise<string>;
  getOptionsForStep: (step: PendingStep, context: OptionContext) => Promise<OptionRecord[]>;
  getPickerInfoState: (
    step: PendingStep,
    context: OptionContext,
    optionCount: number,
    filteredCount: number,
    search: string,
    hasActiveFilters: boolean
  ) => PickerInfoState | null;
  buildPreview: (option: OptionRecord | null, selectedValue: string) => Promise<PreviewPane | null>;
  matchesSearch: (option: OptionRecord, search: string) => boolean;
}

export async function buildSelectionPane(
  step: PendingStep,
  effectiveBuildState: EffectiveBuildState,
  deps: BuildSelectionPaneDependencies
): Promise<SelectionPane | null> {
  if (step.kind === "class-choice") {
    const selectedValue = deps.draft.classChoices[step.slotId] ?? null;
    const choice = step.classChoice;
    const blocked = choice.dependsOn === "deity" && !(await deps.resolveDeityDocument());
    return buildClassChoicePane({
      step,
      selectedValue,
      selectedLabel: await deps.resolveStepStatus(step, effectiveBuildState),
      blocked,
      blockedTitle: blocked ? "Choose a deity first" : null,
      blockedMessage: blocked
        ? "This class choice depends on the drafted deity. Resolve the deity step before choosing this option."
        : null,
    });
  }

  if (step.kind === "singleton-choice") {
    return buildSingletonChoicePane({
      step,
      selectedValue: deps.draft.singletonChoices[step.slotId] ?? null,
      selectedLabel: await deps.resolveStepStatus(step, effectiveBuildState),
    });
  }

  if (step.kind === "language-choice") {
    return buildLanguageChoicePane({
      step,
      selectedValues: deps.draft.languageChoices[step.slotId] ?? [],
      selectedLabel: await deps.resolveStepStatus(step, effectiveBuildState),
    });
  }

  if (step.kind !== "spell-choice" && step.kind !== "pick-item" && step.kind !== "class-branch") {
    return null;
  }

  const optionContext = await deps.resolveOptionContext();
  const options = await deps.getOptionsForStep(step, optionContext);
  const search = deps.searchByStepId.get(step.id) ?? "";
  const filterState = normalizePickerFilterState(deps.pickerFiltersByStepId.get(step.id));
  const searchedOptions = options.filter((option) => deps.matchesSearch(option, search));
  const openFilterKind = deps.openPickerFilterMenu?.stepId === step.id ? deps.openPickerFilterMenu.filterKind : null;
  const filterGroups = buildPickerFilterGroups(searchedOptions, filterState).map((group) => ({
    ...group,
    isOpen: group.key === openFilterKind,
  }));
  const filteredOptions = searchedOptions.filter((option) => matchesPickerFilters(option, filterState));
  const infoState = deps.getPickerInfoState(
    step,
    optionContext,
    options.length,
    filteredOptions.length,
    search,
    activePickerFilterCount(filterState) > 0
  );
  const visibleOptions = infoState?.tone === "blocked" ? [] : filteredOptions;
  const contextNote = await deps.buildContextNote(step, optionContext);

  if (step.kind === "spell-choice") {
    const selectedSelections = deps.draft.spellChoices[step.slotId] ?? [];
    const selectedValues = selectedSelections.map((selection) => `${selection.packId}:${selection.documentId}`);
    const previewValue = resolvePreviewValue(
      step.id,
      visibleOptions,
      options,
      selectedValues[0] ?? "",
      deps.previewValueByStepId
    );
    const previewBase = previewValue
      ? await deps.buildPreview(
          options.find((option) => option.value === previewValue) ?? null,
          selectedValues.includes(previewValue) ? previewValue : ""
        )
      : null;
    const preview = previewBase
      ? {
          ...previewBase,
          selectedLabel: selectedValues.includes(previewValue) ? "Added to draft" : "Add to draft",
        }
      : null;

    return buildSpellChoicePane({
      step,
      search,
      activeFilterCount: activePickerFilterCount(filterState),
      selectedSelections,
      selectedLabel: await deps.resolveStepStatus(step, effectiveBuildState),
      filterGroups,
      visibleOptions,
      infoState,
      contextNote,
      preview,
      modeLabel: getStepModeLabel(step.kind),
      previewValue,
    });
  }

  const selectedValue = selectedValueFor(step, deps.draft);
  const previewValue = resolvePreviewValue(step.id, visibleOptions, options, selectedValue, deps.previewValueByStepId);
  const preview = previewValue
    ? await deps.buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValue)
    : null;

  return buildPickItemPane({
    step,
    search,
    activeFilterCount: activePickerFilterCount(filterState),
    selectedValue,
    selectedLabel: selectedSelection(step, deps.draft)?.name ?? null,
    filterGroups,
    visibleOptions,
    infoState,
    contextNote,
    preview,
    modeLabel: getStepModeLabel(step.kind),
    previewValue,
  });
}
