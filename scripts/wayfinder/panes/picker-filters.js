import { formatSlug } from "../formatting.js";
const UNKNOWN_RARITY = "__unknown_rarity__";
const UNKNOWN_SOURCE = "__unknown_source__";
export function emptyPickerFilterState() {
    return {
        levelRange: null,
        rarity: [],
        source: [],
    };
}
export function activePickerFilterCount(state) {
    if (!state) {
        return 0;
    }
    return state.rarity.length + state.source.length;
}
export function normalizePickerFilterState(state) {
    return {
        levelRange: normalizeLevelRange(state?.levelRange),
        rarity: normalizeFilterValues(state?.rarity),
        source: normalizeFilterValues(state?.source),
    };
}
export function togglePickerFilterValue(state, kind, rawValue) {
    const normalizedState = normalizePickerFilterState(state);
    const next = new Set(normalizedState[kind]);
    if (next.has(rawValue)) {
        next.delete(rawValue);
    }
    else {
        next.add(rawValue);
    }
    return {
        ...normalizedState,
        [kind]: [...next].sort((left, right) => left.localeCompare(right)),
    };
}
export function matchesPickerFilters(option, state, excludedKind, kinds = ALL_FILTER_KINDS) {
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
export function buildPickerFilterGroups(options, state, kinds = DEFAULT_FILTER_KINDS) {
    const normalizedState = normalizePickerFilterState(state);
    return kinds
        .map((kind) => {
        const counts = new Map();
        const labels = new Map();
        for (const option of options.filter((entry) => matchesPickerFilters(entry, normalizedState, kind, kinds))) {
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
            range: false,
            options: optionStates,
            values: [],
        };
    })
        .filter((group) => group.options.length > 0);
}
function normalizeFilterValues(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort((left, right) => left.localeCompare(right));
}
function optionFilterValue(option, kind) {
    if (kind === "rarity") {
        const rarity = option.rarity?.trim().toLowerCase();
        return rarity && rarity.length > 0 ? rarity : UNKNOWN_RARITY;
    }
    const source = option.source?.trim();
    return source && source.length > 0 ? source : UNKNOWN_SOURCE;
}
function optionFilterLabel(option, kind) {
    if (kind === "rarity") {
        const rarity = option.rarity?.trim().toLowerCase();
        return rarity && rarity.length > 0 ? formatSlug(rarity) : "Unspecified";
    }
    const source = option.source?.trim();
    return source && source.length > 0 ? source : "Unknown Source";
}
function filterLabelFromValue(kind, value) {
    if (kind === "rarity") {
        return value === UNKNOWN_RARITY ? "Unspecified" : formatSlug(value);
    }
    return value === UNKNOWN_SOURCE ? "Unknown Source" : value;
}
function pickerFilterSummaryLabel(selectedOptions) {
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
export function spellRankLabel(rank, isCantrip = false) {
    if (isCantrip || rank === 0) {
        return "Cantrip";
    }
    return rank === null ? "Rank unknown" : `Rank ${rank}`;
}
export function buildPickerLevelRangeGroup(options, step, requested) {
    const rankAxis = step.kind === "spell-choice";
    if (!rankAxis && step.filters?.itemType !== "feat") {
        return null;
    }
    const explicitMinimum = rankAxis ? step.spellChoice?.minRank : undefined;
    const explicitMaximum = rankAxis ? step.spellChoice?.maxRank : step.filters?.maxLevel;
    const values = [
        ...new Set(options
            .map((option) => pickerAxisValue(option, rankAxis, rankAxis && step.spellChoice.cantrip))
            .filter(isValidAxisValue)),
    ]
        .filter((value) => explicitMinimum === undefined || value >= explicitMinimum)
        .filter((value) => explicitMaximum === undefined || value <= explicitMaximum)
        .sort((left, right) => left - right);
    if (values.length < 2) {
        return null;
    }
    const fullMinimum = values[0];
    const fullMaximum = values.at(-1);
    const normalizedRequest = normalizeLevelRange(requested);
    const minimum = normalizedRequest
        ? (values.find((value) => value >= normalizedRequest.minimum) ?? fullMaximum)
        : fullMinimum;
    let maximum = normalizedRequest
        ? ([...values].reverse().find((value) => value <= normalizedRequest.maximum) ?? fullMinimum)
        : fullMaximum;
    if (minimum > maximum) {
        maximum = minimum;
    }
    const active = minimum !== fullMinimum || maximum !== fullMaximum;
    const label = rankAxis ? "Rank" : "Level";
    return {
        key: "level",
        label,
        summaryLabel: active && minimum === maximum
            ? pickerAxisLabel(minimum, rankAxis)
            : active
                ? `${pickerAxisLabel(minimum, rankAxis)}–${pickerAxisLabel(maximum, rankAxis)}`
                : "All",
        selectedCount: active ? 1 : 0,
        range: true,
        options: [],
        values: values.map((value) => ({
            value,
            label: pickerAxisLabel(value, rankAxis),
            minimumSelected: value === minimum,
            maximumSelected: value === maximum,
            minimumRangeStart: value,
            minimumRangeEnd: Math.max(value, maximum),
            maximumRangeStart: Math.min(value, minimum),
            maximumRangeEnd: value,
        })),
        minimum,
        maximum,
        active,
    };
}
export function matchesPickerLevelRange(option, group, selectedValues, step) {
    if (!group || selectedValues.has(option.value)) {
        return true;
    }
    const rankAxis = step.kind === "spell-choice";
    const value = pickerAxisValue(option, rankAxis, rankAxis && step.spellChoice.cantrip);
    return value === null ? !group.active : value >= group.minimum && value <= group.maximum;
}
export function matchesPickerLegalLevelBounds(option, step, selectedValues) {
    if (selectedValues.has(option.value)) {
        return true;
    }
    const rankAxis = step.kind === "spell-choice";
    const value = pickerAxisValue(option, rankAxis, rankAxis && step.spellChoice.cantrip);
    if (value === null) {
        return true;
    }
    const minimum = rankAxis ? step.spellChoice?.minRank : undefined;
    const maximum = rankAxis ? step.spellChoice?.maxRank : step.filters?.maxLevel;
    return (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum);
}
function normalizeLevelRange(value) {
    if (!value || !Number.isInteger(value.minimum) || !Number.isInteger(value.maximum)) {
        return null;
    }
    return {
        minimum: Math.max(0, value.minimum),
        maximum: Math.max(0, value.maximum),
    };
}
function pickerAxisValue(option, rankAxis, forceCantrip = false) {
    return rankAxis && (forceCantrip || option.traits.includes("cantrip")) ? 0 : option.level;
}
function isValidAxisValue(value) {
    return value !== null && Number.isInteger(value) && value >= 0;
}
function pickerAxisLabel(value, rankAxis) {
    return rankAxis ? spellRankLabel(value, value === 0) : `Level ${value}`;
}
const ALL_FILTER_KINDS = ["rarity", "source"];
const DEFAULT_FILTER_KINDS = ["rarity", "source"];
//# sourceMappingURL=picker-filters.js.map