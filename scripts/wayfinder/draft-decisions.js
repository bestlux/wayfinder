export function clearDraftSlotDecisions(draft, slotId) {
    const hasItemSelection = !!draft.selections[slotId];
    const hasBranchSelection = !!draft.branchSelections[slotId];
    const hasTrainingSelection = !!draft.skillTrainings[slotId];
    const hasClassChoice = !!draft.classChoices[slotId];
    const hasSpellChoices = (draft.spellChoices[slotId]?.length ?? 0) > 0;
    if (!hasItemSelection && !hasBranchSelection && !hasTrainingSelection && !hasClassChoice && !hasSpellChoices) {
        return false;
    }
    delete draft.selections[slotId];
    delete draft.branchSelections[slotId];
    delete draft.skillTrainings[slotId];
    delete draft.classChoices[slotId];
    delete draft.spellChoices[slotId];
    return true;
}
export function findDraftSelectionByType(draft, itemType) {
    return Object.values(draft.selections).find((selection) => selection.itemType === itemType) ?? null;
}
export function hasDuplicateDraftSelection(draft, selection) {
    return [...Object.values(draft.selections), ...Object.values(draft.branchSelections)].some((existing) => existing.uuid === selection.uuid && existing.slotId !== selection.slotId);
}
export function listDraftDecisionSlotIds(draft) {
    return Array.from(new Set([
        ...Object.keys(draft.selections),
        ...Object.keys(draft.branchSelections),
        ...Object.keys(draft.skillTrainings),
        ...Object.keys(draft.classChoices),
        ...Object.keys(draft.spellChoices),
    ]));
}
export function readDraftStepSelection(draft, step) {
    return step.kind === "class-branch"
        ? (draft.branchSelections[step.slotId] ?? null)
        : (draft.selections[step.slotId] ?? null);
}
export function writeDraftStepSelection(draft, step, selection) {
    const previousSelection = readDraftStepSelection(draft, step);
    if (step.kind === "class-branch") {
        draft.branchSelections[selection.slotId] = selection;
    }
    else {
        draft.selections[selection.slotId] = selection;
    }
    return previousSelection;
}
//# sourceMappingURL=draft-decisions.js.map