import { getStepModeLabel } from "../domain/step-types.js";
import { buildClassChoicePane } from "../panes/class-choice-pane.js";
import { buildLanguageChoicePane } from "../panes/language-choice-pane.js";
import { buildPickItemPane, resolvePreviewValue, selectedSelection, selectedValueFor } from "../panes/pick-pane.js";
import { activePickerFilterCount, buildPickerFilterGroups, matchesPickerFilters, normalizePickerFilterState, } from "../panes/picker-filters.js";
import { buildSingletonChoicePane } from "../panes/singleton-choice-pane.js";
import { buildSpellChoicePane } from "../panes/spell-pane.js";
export async function buildSelectionPane(step, effectiveBuildState, deps) {
    if (step.kind === "class-choice" || step.kind === "class-archetype") {
        const selectedValue = step.kind === "class-archetype"
            ? (deps.draft.classArchetypeChoices[step.slotId] ?? null)
            : (deps.draft.classChoices[step.slotId] ?? null);
        const blocked = step.kind === "class-choice" && step.classChoice.dependsOn === "deity" && !(await deps.resolveDeityDocument());
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
    const infoState = deps.getPickerInfoState(step, optionContext, options.length, filteredOptions.length, search, activePickerFilterCount(filterState) > 0);
    const visibleOptions = infoState?.tone === "blocked" ? [] : filteredOptions;
    const contextNote = await deps.buildContextNote(step, optionContext);
    if (step.kind === "spell-choice") {
        const selectedSelections = deps.draft.spellChoices[step.slotId] ?? [];
        const selectedValues = selectedSelections.map((selection) => `${selection.packId}:${selection.documentId}`);
        const previewValue = resolvePreviewValue(step.id, visibleOptions, options, selectedValues[0] ?? "", deps.previewValueByStepId);
        const previewBase = previewValue
            ? await deps.buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValues.includes(previewValue) ? previewValue : "")
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
//# sourceMappingURL=build-selection-pane-service.js.map