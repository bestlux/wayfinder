import { getStepModeLabel } from "../domain/step-types.js";
import { buildClassChoicePane } from "../panes/class-choice-pane.js";
import { buildLanguageChoicePane } from "../panes/language-choice-pane.js";
import { buildPickItemPane, resolvePreviewValue, selectedSelection, selectedValueFor } from "../panes/pick-pane.js";
import { buildSingletonChoicePane } from "../panes/singleton-choice-pane.js";
import { buildSpellChoicePane } from "../panes/spell-pane.js";
import { canGrantRestrictedSpellRarityAccess, withRestrictedSpellRarityAccess, } from "../spell-choice/rarity-access.js";
import { createPickerRenderSession, derivePickerRenderProjection, } from "./picker-render-session.js";
export async function buildSelectionPane(step, effectiveBuildState, deps) {
    const selectedLabel = async () => deps.stepEvaluation?.status ?? deps.resolveStepStatus(step, effectiveBuildState);
    if (step.kind === "class-choice" || step.kind === "class-archetype") {
        const selectedValue = step.kind === "class-archetype"
            ? (deps.draft.classArchetypeChoices[step.slotId] ?? null)
            : (deps.draft.classChoices[step.slotId] ?? null);
        const blocked = step.kind === "class-choice" && step.classChoice.dependsOn === "deity" && !(await deps.resolveDeityDocument());
        return buildClassChoicePane({
            step,
            selectedValue,
            selectedLabel: await selectedLabel(),
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
            selectedLabel: await selectedLabel(),
        });
    }
    if (step.kind === "language-choice") {
        return buildLanguageChoicePane({
            step,
            selectedValues: deps.draft.languageChoices[step.slotId] ?? [],
            selectedLabel: await selectedLabel(),
        });
    }
    if (step.kind !== "spell-choice" && step.kind !== "pick-item" && step.kind !== "class-branch") {
        return null;
    }
    const optionContext = await deps.resolveOptionContext(step);
    const spellRarityCeiling = deps.spellRarityCeiling ?? "common";
    const spellRarityAccessGranted = step.kind === "spell-choice" && deps.draft.spellRarityAccess[step.slotId] === true;
    const optionStep = withRestrictedSpellRarityAccess(step, spellRarityCeiling, spellRarityAccessGranted);
    const options = await deps.getOptionsForStep(optionStep, optionContext);
    const filterKinds = step.kind === "spell-choice" ? ["rank", "rarity", "source"] : ["rarity", "source"];
    const openFilterKind = deps.openPickerFilterMenu?.stepId === step.id ? deps.openPickerFilterMenu.filterKind : null;
    const renderInputs = {
        step,
        optionContext,
        options,
        filterKinds,
        getPickerInfoState: deps.getPickerInfoState,
        matchesSearch: deps.matchesSearch,
    };
    const renderState = {
        search: deps.searchByStepId.get(step.id) ?? "",
        filterState: deps.pickerFiltersByStepId.get(step.id),
        openFilterKind,
    };
    const projection = derivePickerRenderProjection(renderInputs, renderState);
    const contextNote = await deps.buildContextNote(step, optionContext);
    if (step.kind === "spell-choice") {
        const selectedSelections = deps.draft.spellChoices[step.slotId] ?? [];
        const selectedValues = selectedSelections.map((selection) => `${selection.packId}:${selection.documentId}`);
        const previewValue = resolvePreviewValue(step.id, projection.visibleOptions, options, selectedValues[0] ?? "", deps.previewValueByStepId);
        const previewBase = previewValue
            ? await deps.buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValues.includes(previewValue) ? previewValue : "")
            : null;
        const preview = previewBase
            ? {
                ...previewBase,
                selectedLabel: selectedValues.includes(previewValue) ? "Added to draft" : "Add to draft",
            }
            : null;
        const pane = buildSpellChoicePane({
            step,
            search: projection.search,
            activeFilterCount: projection.activeFilterCount,
            selectedSelections,
            selectedLabel: await selectedLabel(),
            selectionState: deps.stepEvaluation?.state,
            filterGroups: projection.filterGroups,
            visibleOptions: projection.visibleOptions,
            infoState: projection.infoState,
            contextNote,
            preview,
            modeLabel: getStepModeLabel(step.kind),
            previewValue,
            rarityAccess: {
                available: canGrantRestrictedSpellRarityAccess(step, spellRarityCeiling),
                granted: spellRarityAccessGranted,
                locked: selectedSelections.length > 0,
            },
        });
        deps.onPickerRenderSession?.(createPickerRenderSession(renderInputs, pane, previewValue));
        return pane;
    }
    const selectedValue = selectedValueFor(step, deps.draft);
    const previewValue = resolvePreviewValue(step.id, projection.visibleOptions, options, selectedValue, deps.previewValueByStepId);
    const preview = previewValue
        ? await deps.buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValue)
        : null;
    const pane = buildPickItemPane({
        step,
        search: projection.search,
        activeFilterCount: projection.activeFilterCount,
        selectedValue,
        selectedLabel: selectedSelection(step, deps.draft)?.name ?? null,
        filterGroups: projection.filterGroups,
        visibleOptions: projection.visibleOptions,
        infoState: projection.infoState,
        contextNote,
        preview,
        modeLabel: getStepModeLabel(step.kind),
        previewValue,
    });
    deps.onPickerRenderSession?.(createPickerRenderSession(renderInputs, pane, previewValue));
    return pane;
}
//# sourceMappingURL=build-selection-pane-service.js.map