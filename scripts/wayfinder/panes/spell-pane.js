import { spellRankLabel } from "./picker-filters.js";
export function buildSpellChoicePane(args) {
    const { step, search, activeFilterCount, selectedSelections, selectedLabel, filterGroups, visibleOptions, infoState, contextNote, preview, modeLabel, previewValue, rarityAccess, } = args;
    const selectedValues = selectedSelections.map((selection) => `${selection.packId}:${selection.documentId}`);
    const requiredCount = step.spellChoice?.count ?? 0;
    return {
        kind: "spell-choice",
        templateKind: "spell-choice",
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel,
        title: step.title,
        description: step.description,
        search,
        activeFilterCount,
        selectedValues,
        selectedLabel,
        selectedCount: selectedValues.length,
        requiredCount,
        remainingCount: Math.max(0, requiredCount - selectedValues.length),
        resultCount: visibleOptions.length,
        contextNote,
        infoState,
        destinationLabel: step.spellChoice?.destination.label ?? "Spell destination",
        sourceName: step.spellChoice?.sourceName ?? "Spell source",
        rarityAccess,
        filterGroups,
        selectedSpells: selectedSelections.map((selection) => ({
            value: `${selection.packId}:${selection.documentId}`,
            name: selection.name,
            rankLabel: spellRankLabel(selection.level, step.spellChoice?.cantrip === true),
        })),
        options: visibleOptions.map((option) => ({
            ...option,
            selected: selectedValues.includes(option.value),
            previewing: option.value === previewValue,
            sourceLabel: option.source ?? "Unknown Source",
            rankLabel: spellRankLabel(option.level, option.traits.includes("cantrip") || step.spellChoice?.cantrip === true),
        })),
        preview,
    };
}
//# sourceMappingURL=spell-pane.js.map