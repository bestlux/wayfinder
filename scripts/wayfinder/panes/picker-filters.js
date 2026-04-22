import { formatSlug } from "../formatting.js";
const UNKNOWN_RARITY = "__unknown_rarity__";
const UNKNOWN_SOURCE = "__unknown_source__";
export function emptyPickerFilterState() {
    return {
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
export function matchesPickerFilters(option, state, excludedKind) {
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
export function buildPickerFilterGroups(options, state) {
    const normalizedState = normalizePickerFilterState(state);
    return FILTER_KINDS.map((kind) => {
        const counts = new Map();
        const labels = new Map();
        for (const option of options.filter((entry) => matchesPickerFilters(entry, normalizedState, kind))) {
            const value = optionFilterValue(option, kind);
            counts.set(value, (counts.get(value) ?? 0) + 1);
            labels.set(value, optionFilterLabel(option, kind));
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
        return {
            key: kind,
            label: kind === "rarity" ? "Rarity" : "Source",
            options: optionStates,
        };
    }).filter((group) => group.options.length > 0);
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
const FILTER_KINDS = ["rarity", "source"];
//# sourceMappingURL=picker-filters.js.map