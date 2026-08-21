import { cloneData } from "../../shared/cloning.js";
import type {
  OptionContext,
  OptionRecord,
  PendingStep,
  PickerFilterKind,
  PickerFilterMenuKind,
  PickerFilterState,
  PickerInfoState,
  PickerSuppressionNotice,
  SuppressedPickerOption,
} from "../../types.js";
import {
  activePickerFilterCount,
  buildPickerFilterGroups,
  buildPickerLevelRangeGroup,
  matchesPickerFilters,
  matchesPickerLegalLevelBounds,
  matchesPickerLevelRange,
  normalizePickerFilterState,
  spellRankLabel,
} from "../panes/picker-filters.js";
import type { PickStepPane, SpellChoiceStepPane } from "../view-models.js";

type PickerPane = PickStepPane | SpellChoiceStepPane;

export interface PickerRenderInputs {
  step: PendingStep;
  optionContext: OptionContext;
  options: OptionRecord[];
  suppressedOptions: SuppressedPickerOption[];
  selectedValues: string[];
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
  openFilterKind: PickerFilterMenuKind | null;
}

export interface PickerRenderProjection {
  search: string;
  activeFilterCount: number;
  filterGroups: PickerPane["filterGroups"];
  visibleOptions: OptionRecord[];
  infoState: PickerInfoState | null;
  suppressionNotice: PickerSuppressionNotice | null;
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
  const selectedValues = new Set(inputs.selectedValues);
  const boundedOptions = inputs.options.filter((option) =>
    matchesPickerLegalLevelBounds(option, inputs.step, selectedValues)
  );
  const searchedOptions = boundedOptions.filter((option) => inputs.matchesSearch(option, state.search));
  const levelRangeGroup = buildPickerLevelRangeGroup(inputs.options, inputs.step, filterState.levelRange);
  const rangeFilteredOptions = searchedOptions.filter((option) =>
    matchesPickerLevelRange(option, levelRangeGroup, selectedValues, inputs.step)
  );
  const categoricalGroups = buildPickerFilterGroups(rangeFilteredOptions, filterState, inputs.filterKinds)
    .filter((group) => group.options.length > 1 || group.selectedCount > 0)
    .map((group) => ({
      ...group,
      isOpen: group.key === state.openFilterKind,
    }));
  const filterGroups = [
    ...(levelRangeGroup ? [{ ...levelRangeGroup, isOpen: state.openFilterKind === levelRangeGroup.key }] : []),
    ...categoricalGroups,
  ];
  const filteredOptions = rangeFilteredOptions.filter((option) =>
    matchesPickerFilters(option, filterState, undefined, inputs.filterKinds)
  );
  const activeFilterCount = activePickerFilterCount(filterState) + (levelRangeGroup?.active ? 1 : 0);
  let infoState = inputs.getPickerInfoState(
    inputs.step,
    inputs.optionContext,
    boundedOptions.length,
    filteredOptions.length,
    state.search,
    activeFilterCount > 0
  );
  const suppressionNotice = buildSuppressionNotice(inputs.suppressedOptions);
  const suppressedSearchMatches = inputs.suppressedOptions.filter((option) =>
    matchesSuppressedName(option, state.search)
  );
  if (
    inputs.options.length === 0 &&
    inputs.suppressedOptions.length > 0 &&
    !state.search.trim() &&
    activeFilterCount === 0 &&
    infoState?.tone !== "blocked"
  ) {
    infoState = {
      tone: "empty",
      eyebrow: "Not guided yet",
      title: "Nothing here Wayfinder can guide",
      message: `${buildSuppressionMessage(inputs.suppressedOptions, false)} Make this choice on the PF2E sheet for now.`,
    };
  } else if (
    filteredOptions.length === 0 &&
    state.search.trim() &&
    suppressedSearchMatches.length > 0 &&
    infoState?.tone !== "blocked"
  ) {
    const count = suppressedSearchMatches.length;
    infoState = {
      tone: "search",
      eyebrow: "Not guided yet",
      title: count === 1 ? "That choice is hidden" : "Those choices are hidden",
      message: buildSuppressionMessage(suppressedSearchMatches, true),
    };
  }

  return {
    search: state.search,
    activeFilterCount,
    filterGroups,
    visibleOptions: infoState?.tone === "blocked" ? [] : filteredOptions,
    infoState,
    suppressionNotice,
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
    selectedValues: inputs.selectedValues,
    suppressedOptions: inputs.suppressedOptions,
    previewValue,
    step: inputs.step,
  });
  return {
    ...data,
    getPickerInfoState: inputs.getPickerInfoState,
    matchesSearch: inputs.matchesSearch,
  };
}

function buildSuppressionNotice(options: SuppressedPickerOption[]): PickerSuppressionNotice | null {
  const count = options.length;
  if (count === 0) {
    return null;
  }

  return {
    count,
    message: buildSuppressionMessage(options, false),
  };
}

function buildSuppressionMessage(options: SuppressedPickerOption[], matching: boolean): string {
  const grantCount = options.filter((option) => option.reason === "unvalidated-granted-choice").length;
  const eligibilityCount = options.filter((option) => option.reason === "unvalidated-eligibility").length;
  const heritageCount = options.filter((option) => option.reason === "ambiguous-heritage-ownership").length;
  const matchingLabel = matching ? " matching" : "";
  if (eligibilityCount === 0 && heritageCount === 0) {
    const subject = grantCount === 1 ? "option" : "options";
    const verb = matching ? (grantCount === 1 ? " is" : " are") : "";
    return `${grantCount}${matchingLabel} ${subject}${verb} hidden because Wayfinder cannot yet validate a choice ${grantCount === 1 ? "it grants" : "they grant"}.`;
  }
  if (grantCount === 0 && heritageCount === 0) {
    const subject = eligibilityCount === 1 ? "option" : "options";
    const verb = matching ? (eligibilityCount === 1 ? " is" : " are") : "";
    return `${eligibilityCount}${matchingLabel} ${subject}${verb} hidden because Wayfinder cannot yet validate whether ${eligibilityCount === 1 ? "it is" : "they are"} eligible.`;
  }
  if (grantCount === 0 && eligibilityCount === 0) {
    const subject = heritageCount === 1 ? "heritage" : "heritages";
    const verb = matching ? (heritageCount === 1 ? " is" : " are") : "";
    return `${heritageCount}${matchingLabel} ${subject}${verb} hidden because Wayfinder cannot determine which ancestry ${heritageCount === 1 ? "it belongs" : "they belong"} to.`;
  }

  const categories = [
    grantCount > 0
      ? `${grantCount} ${grantCount === 1 ? "grants a choice" : "grant choices"} Wayfinder cannot validate`
      : null,
    eligibilityCount > 0 ? `${eligibilityCount} have eligibility Wayfinder cannot validate` : null,
    heritageCount > 0 ? `${heritageCount} have ambiguous ancestry ownership` : null,
  ].filter((category): category is string => category !== null);
  return `${options.length}${matchingLabel} options are hidden: ${categories.join("; ")}.`;
}

function matchesSuppressedName(option: SuppressedPickerOption, search: string): boolean {
  const query = search.trim().toLowerCase();
  return query.length > 0 && option.name.toLowerCase().includes(query);
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
      suppressionNotice: projection.suppressionNotice,
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
    suppressionNotice: projection.suppressionNotice,
    resultCount: projection.visibleOptions.length,
    options: projection.visibleOptions.map((option) => ({
      ...option,
      selected: option.value === basePane.selectedValue,
      previewing: option.value === session.previewValue,
      sourceLabel: option.source ?? "Unknown Source",
    })),
  };
}
