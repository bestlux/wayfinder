import type { OptionRecord, PickerFilterKind, PickerFilterState } from "../../types.js";
import { formatSlug } from "../formatting.js";

interface PickerFilterOptionState {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface PickerFilterGroupState {
  key: PickerFilterKind;
  label: string;
  summaryLabel: string;
  selectedCount: number;
  options: PickerFilterOptionState[];
}

const UNKNOWN_RARITY = "__unknown_rarity__";
const UNKNOWN_SOURCE = "__unknown_source__";

export function emptyPickerFilterState(): PickerFilterState {
  return {
    rarity: [],
    source: [],
  };
}

export function activePickerFilterCount(state: PickerFilterState | null | undefined): number {
  if (!state) {
    return 0;
  }

  return state.rarity.length + state.source.length;
}

export function normalizePickerFilterState(state: Partial<PickerFilterState> | null | undefined): PickerFilterState {
  return {
    rarity: normalizeFilterValues(state?.rarity),
    source: normalizeFilterValues(state?.source),
  };
}

export function togglePickerFilterValue(
  state: Partial<PickerFilterState> | null | undefined,
  kind: PickerFilterKind,
  rawValue: string
): PickerFilterState {
  const normalizedState = normalizePickerFilterState(state);
  const next = new Set(normalizedState[kind]);
  if (next.has(rawValue)) {
    next.delete(rawValue);
  } else {
    next.add(rawValue);
  }

  return {
    ...normalizedState,
    [kind]: [...next].sort((left, right) => left.localeCompare(right)),
  };
}

export function matchesPickerFilters(
  option: OptionRecord,
  state: Partial<PickerFilterState> | null | undefined,
  excludedKind?: PickerFilterKind
): boolean {
  const normalizedState = normalizePickerFilterState(state);
  for (const kind of FILTER_KINDS) {
    if (kind === excludedKind) {
      continue;
    }

    const selected = normalizedState[kind];
    if (selected.length === 0) {
      continue;
    }

    const value = optionFilterValue(option, kind);
    if (!selected.includes(value)) {
      return false;
    }
  }

  return true;
}

export function buildPickerFilterGroups(
  options: OptionRecord[],
  state: Partial<PickerFilterState> | null | undefined
): PickerFilterGroupState[] {
  const normalizedState = normalizePickerFilterState(state);

  return FILTER_KINDS.map((kind) => {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const option of options.filter((entry) => matchesPickerFilters(entry, normalizedState, kind))) {
      const value = optionFilterValue(option, kind);
      counts.set(value, (counts.get(value) ?? 0) + 1);
      labels.set(value, optionFilterLabel(option, kind));
    }

    for (const selectedValue of normalizedState[kind]) {
      if (!counts.has(selectedValue)) {
        counts.set(selectedValue, 0);
      }
      if (!labels.has(selectedValue)) {
        labels.set(selectedValue, filterLabelFromValue(kind, selectedValue));
      }
    }

    const optionStates = [...counts.entries()]
      .sort(([leftValue], [rightValue]) => {
        const leftLabel = labels.get(leftValue) ?? leftValue;
        const rightLabel = labels.get(rightValue) ?? rightValue;
        return leftLabel.localeCompare(rightLabel) || leftValue.localeCompare(rightValue);
      })
      .map(([value, count]) => ({
        value,
        label: labels.get(value) ?? value,
        count,
        selected: normalizedState[kind].includes(value),
      }));
    const selectedOptions = optionStates.filter((option) => option.selected);

    return {
      key: kind,
      label: kind === "rarity" ? "Rarity" : "Source",
      summaryLabel: pickerFilterSummaryLabel(selectedOptions),
      selectedCount: selectedOptions.length,
      options: optionStates,
    };
  }).filter((group) => group.options.length > 0);
}

function normalizeFilterValues(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function optionFilterValue(option: OptionRecord, kind: PickerFilterKind): string {
  if (kind === "rarity") {
    const rarity = option.rarity?.trim().toLowerCase();
    return rarity && rarity.length > 0 ? rarity : UNKNOWN_RARITY;
  }

  const source = option.source?.trim();
  return source && source.length > 0 ? source : UNKNOWN_SOURCE;
}

function optionFilterLabel(option: OptionRecord, kind: PickerFilterKind): string {
  if (kind === "rarity") {
    const rarity = option.rarity?.trim().toLowerCase();
    return rarity && rarity.length > 0 ? formatSlug(rarity) : "Unspecified";
  }

  const source = option.source?.trim();
  return source && source.length > 0 ? source : "Unknown Source";
}

function filterLabelFromValue(kind: PickerFilterKind, value: string): string {
  if (kind === "rarity") {
    return value === UNKNOWN_RARITY ? "Unspecified" : formatSlug(value);
  }

  return value === UNKNOWN_SOURCE ? "Unknown Source" : value;
}

function pickerFilterSummaryLabel(selectedOptions: PickerFilterOptionState[]): string {
  if (selectedOptions.length === 0) {
    return "All";
  }

  if (selectedOptions.length > 1) {
    return `${selectedOptions.length} selected`;
  }

  const [selected] = selectedOptions;
  if (!selected) {
    return "All";
  }

  return selected.label.length > 24 ? "1 selected" : selected.label;
}

const FILTER_KINDS: PickerFilterKind[] = ["rarity", "source"];
