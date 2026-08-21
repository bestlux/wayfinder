import { cloneData } from "../../shared/cloning.js";
import { activePickerFilterCount, buildPickerFilterGroups, matchesPickerFilters, normalizePickerFilterState, spellRankLabel, } from "../panes/picker-filters.js";
export function derivePickerRenderProjection(inputs, state) {
    const filterState = normalizePickerFilterState(state.filterState);
    const searchedOptions = inputs.options.filter((option) => inputs.matchesSearch(option, state.search));
    const filterGroups = buildPickerFilterGroups(searchedOptions, filterState, inputs.filterKinds)
        .filter((group) => group.options.length > 1 || group.selectedCount > 0)
        .map((group) => ({
        ...group,
        isOpen: group.key === state.openFilterKind,
    }));
    const filteredOptions = searchedOptions.filter((option) => matchesPickerFilters(option, filterState, undefined, inputs.filterKinds));
    const activeFilterCount = activePickerFilterCount(filterState);
    let infoState = inputs.getPickerInfoState(inputs.step, inputs.optionContext, inputs.options.length, filteredOptions.length, state.search, activeFilterCount > 0);
    const suppressionNotice = buildSuppressionNotice(inputs.suppressedOptions);
    const suppressedSearchMatches = inputs.suppressedOptions.filter((option) => matchesSuppressedName(option, state.search));
    if (inputs.options.length === 0 &&
        inputs.suppressedOptions.length > 0 &&
        !state.search.trim() &&
        activeFilterCount === 0 &&
        infoState?.tone !== "blocked") {
        infoState = {
            tone: "empty",
            eyebrow: "Not guided yet",
            title: "Nothing here Wayfinder can guide",
            message: `${buildSuppressionMessage(inputs.suppressedOptions, false)} Make this choice on the PF2E sheet for now.`,
        };
    }
    else if (filteredOptions.length === 0 &&
        state.search.trim() &&
        suppressedSearchMatches.length > 0 &&
        infoState?.tone !== "blocked") {
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
export function createPickerRenderSession(inputs, basePane, previewValue) {
    const data = cloneData({
        basePane,
        filterKinds: inputs.filterKinds,
        optionContext: inputs.optionContext,
        options: inputs.options,
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
function buildSuppressionNotice(options) {
    const count = options.length;
    if (count === 0) {
        return null;
    }
    return {
        count,
        message: buildSuppressionMessage(options, false),
    };
}
function buildSuppressionMessage(options, matching) {
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
    ].filter((category) => category !== null);
    return `${options.length}${matchingLabel} options are hidden: ${categories.join("; ")}.`;
}
function matchesSuppressedName(option, search) {
    const query = search.trim().toLowerCase();
    return query.length > 0 && option.name.toLowerCase().includes(query);
}
export function derivePickerRenderSession(session, state) {
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
                rankLabel: spellRankLabel(option.level, option.traits.includes("cantrip") ||
                    (session.step.kind === "spell-choice" && session.step.spellChoice?.cantrip === true)),
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
//# sourceMappingURL=picker-render-session.js.map