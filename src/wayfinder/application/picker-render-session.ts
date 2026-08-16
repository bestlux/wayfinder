import { cloneData } from "../../shared/cloning.js";
import type {
  OptionContext,
  OptionRecord,
  PendingStep,
  PickerFilterKind,
  PickerFilterState,
  PickerInfoState,
} from "../../types.js";
import {
  activePickerFilterCount,
  buildPickerFilterGroups,
  matchesPickerFilters,
  normalizePickerFilterState,
  spellRankLabel,
} from "../panes/picker-filters.js";
import type { PickStepPane, SpellChoiceStepPane } from "../view-models.js";

type PickerPane = PickStepPane | SpellChoiceStepPane;

export interface PickerRenderInputs {
  step: PendingStep;
  optionContext: OptionContext;
  options: OptionRecord[];
  filterKinds: PickerFilterKind[];
  getPickerInfoState: (
    step: PendingStep,
    context: OptionContext,
    optionCount: number,
    filteredCount: number,
    search: string,
    hasActiveFilters: boolean
  ) => PickerInfoState | null;
  matchesSearch: (option: OptionRecord, search: string) => boolean;
}

export interface PickerRenderState {
  search: string;
  filterState: PickerFilterState | null | undefined;
  openFilterKind: PickerFilterKind | null;
}

export interface PickerRenderProjection {
  search: string;
  activeFilterCount: number;
  filterGroups: PickerPane["filterGroups"];
  visibleOptions: OptionRecord[];
  infoState: PickerInfoState | null;
}

export interface PickerRenderSession extends PickerRenderInputs {
  basePane: PickerPane;
  previewValue: string;
}

export function derivePickerRenderProjection(
  inputs: PickerRenderInputs,
  state: PickerRenderState
): PickerRenderProjection {
  const filterState = normalizePickerFilterState(state.filterState);
  const searchedOptions = inputs.options.filter((option) => inputs.matchesSearch(option, state.search));
  const filterGroups = buildPickerFilterGroups(searchedOptions, filterState, inputs.filterKinds)
    .filter((group) => group.options.length > 1 || group.selectedCount > 0)
    .map((group) => ({
      ...group,
      isOpen: group.key === state.openFilterKind,
    }));
  const filteredOptions = searchedOptions.filter((option) =>
    matchesPickerFilters(option, filterState, undefined, inputs.filterKinds)
  );
  const activeFilterCount = activePickerFilterCount(filterState);
  const infoState = inputs.getPickerInfoState(
    inputs.step,
    inputs.optionContext,
    inputs.options.length,
    filteredOptions.length,
    state.search,
    activeFilterCount > 0
  );

  return {
    search: state.search,
    activeFilterCount,
    filterGroups,
    visibleOptions: infoState?.tone === "blocked" ? [] : filteredOptions,
    infoState,
  };
}

export function createPickerRenderSession(
  inputs: PickerRenderInputs,
  basePane: PickerPane,
  previewValue: string
): PickerRenderSession {
  const data = cloneData({
    basePane,
    filterKinds: inputs.filterKinds,
    optionContext: inputs.optionContext,
    options: inputs.options,
    previewValue,
    step: inputs.step,
  });
  return {
    ...data,
    getPickerInfoState: inputs.getPickerInfoState,
    matchesSearch: inputs.matchesSearch,
  };
}

export function derivePickerRenderSession(session: PickerRenderSession, state: PickerRenderState): PickerPane {
  const projection = derivePickerRenderProjection(session, state);
  const basePane = session.basePane;
  if (basePane.kind === "spell-choice") {
    const selectedValues = basePane.selectedValues;
    return {
      ...basePane,
      search: projection.search,
      activeFilterCount: projection.activeFilterCount,
      filterGroups: projection.filterGroups,
      infoState: projection.infoState,
      resultCount: projection.visibleOptions.length,
      options: projection.visibleOptions.map((option) => ({
        ...option,
        selected: selectedValues.includes(option.value),
        previewing: option.value === session.previewValue,
        sourceLabel: option.source ?? "Unknown Source",
        rankLabel: spellRankLabel(
          option.level,
          option.traits.includes("cantrip") ||
            (session.step.kind === "spell-choice" && session.step.spellChoice?.cantrip === true)
        ),
      })),
    };
  }

  return {
    ...basePane,
    search: projection.search,
    activeFilterCount: projection.activeFilterCount,
    filterGroups: projection.filterGroups,
    infoState: projection.infoState,
    resultCount: projection.visibleOptions.length,
    options: projection.visibleOptions.map((option) => ({
      ...option,
      selected: option.value === basePane.selectedValue,
      previewing: option.value === session.previewValue,
      sourceLabel: option.source ?? "Unknown Source",
    })),
  };
}
