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
const CANTRIP_RANK = "cantrip";
const RANK_PREFIX = "rank:";

export function emptyPickerFilterState(): PickerFilterState {
  return {
    rank: [],
    rarity: [],
    source: [],
  };
}

export function activePickerFilterCount(state: PickerFilterState | null | undefined): number {
  if (!state) {
    return 0;
  }

  return state.rank.length + state.rarity.length + state.source.length;
}

export function normalizePickerFilterState(state: Partial<PickerFilterState> | null | undefined): PickerFilterState {
  return {
    rank: normalizeFilterValues(state?.rank),
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
  excludedKind?: PickerFilterKind,
  kinds: readonly PickerFilterKind[] = ALL_FILTER_KINDS
): boolean {
  const normalizedState = normalizePickerFilterState(state);
  for (const kind of kinds) {
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
  state: Partial<PickerFilterState> | null | undefined,
  kinds: readonly PickerFilterKind[] = DEFAULT_FILTER_KINDS
): PickerFilterGroupState[] {
  const normalizedState = normalizePickerFilterState(state);

  return kinds
    .map((kind) => {
      const counts = new Map<string, number>();
      const labels = new Map<string, string>();
      for (const option of options.filter((entry) => matchesPickerFilters(entry, normalizedState, kind, kinds))) {
        if (kind === "rank" && option.level === null && !option.traits.includes("cantrip")) {
          continue;
        }
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
          if (kind === "rank") {
            return spellRankFilterOrder(leftValue) - spellRankFilterOrder(rightValue);
          }
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
        label: kind === "rank" ? "Rank" : kind === "rarity" ? "Rarity" : "Source",
        summaryLabel: pickerFilterSummaryLabel(selectedOptions),
        selectedCount: selectedOptions.length,
        options: optionStates,
      };
    })
    .filter((group) => group.options.length > 0);
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
  if (kind === "rank") {
    return spellRankFilterValue(option);
  }

  if (kind === "rarity") {
    const rarity = option.rarity?.trim().toLowerCase();
    return rarity && rarity.length > 0 ? rarity : UNKNOWN_RARITY;
  }

  const source = option.source?.trim();
  return source && source.length > 0 ? source : UNKNOWN_SOURCE;
}

function optionFilterLabel(option: OptionRecord, kind: PickerFilterKind): string {
  if (kind === "rank") {
    return spellRankLabel(option.level, option.traits.includes("cantrip"));
  }

  if (kind === "rarity") {
    const rarity = option.rarity?.trim().toLowerCase();
    return rarity && rarity.length > 0 ? formatSlug(rarity) : "Unspecified";
  }

  const source = option.source?.trim();
  return source && source.length > 0 ? source : "Unknown Source";
}

function filterLabelFromValue(kind: PickerFilterKind, value: string): string {
  if (kind === "rank") {
    return value === CANTRIP_RANK ? "Cantrip" : `Rank ${value.slice(RANK_PREFIX.length)}`;
  }

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

export function spellRankLabel(rank: number | null, isCantrip = false): string {
  if (isCantrip || rank === 0) {
    return "Cantrip";
  }

  return rank === null ? "Rank unknown" : `Rank ${rank}`;
}

function spellRankFilterValue(option: OptionRecord): string {
  return option.traits.includes("cantrip") || option.level === 0 ? CANTRIP_RANK : `${RANK_PREFIX}${option.level}`;
}

function spellRankFilterOrder(value: string): number {
  if (value === CANTRIP_RANK) {
    return 0;
  }

  const rank = Number(value.slice(RANK_PREFIX.length));
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
}

const ALL_FILTER_KINDS: PickerFilterKind[] = ["rank", "rarity", "source"];
const DEFAULT_FILTER_KINDS: PickerFilterKind[] = ["rarity", "source"];
