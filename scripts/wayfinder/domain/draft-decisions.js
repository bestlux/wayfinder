import { isClassBranchStep } from "./step-types.js";
const DECISION_KIND_ORDER = {
    selection: 0,
    "class-branch": 1,
    "singleton-choice": 2,
    "language-choice": 3,
    "class-choice": 4,
    manual: 5,
    "skill-increase": 6,
    "skill-training": 7,
    "spell-choice": 8,
};
export function clearDraftSlotDecisions(draft, slotId) {
    const hasItemSelection = !!draft.selections[slotId];
    const hasBranchSelection = !!draft.branchSelections[slotId];
    const hasTrainingSelection = !!draft.skillTrainings[slotId];
    const hasSingletonChoice = Object.prototype.hasOwnProperty.call(draft.singletonChoices, slotId);
    const hasLanguageChoices = (draft.languageChoices[slotId]?.length ?? 0) > 0;
    const hasClassChoice = Object.prototype.hasOwnProperty.call(draft.classChoices, slotId);
    const hasManualDecision = Object.prototype.hasOwnProperty.call(draft.manual, slotId);
    const hasSkillIncrease = Object.prototype.hasOwnProperty.call(draft.skillIncreases, slotId);
    const hasSpellChoices = (draft.spellChoices[slotId]?.length ?? 0) > 0;
    if (!hasItemSelection &&
        !hasBranchSelection &&
        !hasTrainingSelection &&
        !hasSingletonChoice &&
        !hasLanguageChoices &&
        !hasClassChoice &&
        !hasManualDecision &&
        !hasSkillIncrease &&
        !hasSpellChoices) {
        return false;
    }
    delete draft.selections[slotId];
    delete draft.branchSelections[slotId];
    delete draft.skillTrainings[slotId];
    delete draft.singletonChoices[slotId];
    delete draft.languageChoices[slotId];
    delete draft.classChoices[slotId];
    delete draft.manual[slotId];
    delete draft.skillIncreases[slotId];
    delete draft.spellChoices[slotId];
    return true;
}
export function findDraftSelectionByType(draft, itemType) {
    return Object.values(draft.selections).find((selection) => selection.itemType === itemType) ?? null;
}
export function hasDuplicateDraftSelection(draft, selection) {
    return [...Object.values(draft.selections), ...Object.values(draft.branchSelections)].some((existing) => existing.uuid === selection.uuid && existing.slotId !== selection.slotId);
}
export function listDraftDecisions(draft) {
    const decisions = [];
    for (const [slotId, selection] of Object.entries(draft.selections)) {
        decisions.push({ kind: "selection", slotId, selection });
    }
    for (const [slotId, selection] of Object.entries(draft.branchSelections)) {
        decisions.push({ kind: "class-branch", slotId, selection });
    }
    for (const [slotId, value] of Object.entries(draft.singletonChoices)) {
        decisions.push({ kind: "singleton-choice", slotId, value });
    }
    for (const [slotId, selections] of Object.entries(draft.languageChoices)) {
        decisions.push({ kind: "language-choice", slotId, selections });
    }
    for (const [slotId, value] of Object.entries(draft.classChoices)) {
        decisions.push({ kind: "class-choice", slotId, value });
    }
    for (const [slotId, complete] of Object.entries(draft.manual)) {
        decisions.push({ kind: "manual", slotId, complete });
    }
    for (const [slotId, skillSlug] of Object.entries(draft.skillIncreases)) {
        decisions.push({ kind: "skill-increase", slotId, skillSlug });
    }
    for (const [slotId, training] of Object.entries(draft.skillTrainings)) {
        decisions.push({ kind: "skill-training", slotId, training });
    }
    for (const [slotId, selections] of Object.entries(draft.spellChoices)) {
        decisions.push({ kind: "spell-choice", slotId, selections });
    }
    return decisions.sort((left, right) => {
        const kindDelta = DECISION_KIND_ORDER[left.kind] - DECISION_KIND_ORDER[right.kind];
        if (kindDelta !== 0) {
            return kindDelta;
        }
        return left.slotId.localeCompare(right.slotId);
    });
}
export function listDraftDecisionSlotIds(draft) {
    return Array.from(new Set(listDraftDecisions(draft).map((decision) => decision.slotId)));
}
export function readDraftStepDecision(draft, step) {
    const slotId = step.slotId;
    switch (step.kind) {
        case "pick-item": {
            const selection = draft.selections[slotId];
            return selection ? { kind: "selection", slotId, selection } : null;
        }
        case "class-branch": {
            const selection = draft.branchSelections[slotId];
            return selection ? { kind: "class-branch", slotId, selection } : null;
        }
        case "singleton-choice": {
            const value = draft.singletonChoices[slotId];
            return typeof value === "string" && value.length > 0 ? { kind: "singleton-choice", slotId, value } : null;
        }
        case "language-choice": {
            const selections = draft.languageChoices[slotId];
            return selections && selections.length > 0 ? { kind: "language-choice", slotId, selections } : null;
        }
        case "class-choice": {
            const value = draft.classChoices[slotId];
            return typeof value === "string" && value.length > 0 ? { kind: "class-choice", slotId, value } : null;
        }
        case "manual":
            return Object.prototype.hasOwnProperty.call(draft.manual, slotId)
                ? { kind: "manual", slotId, complete: draft.manual[slotId] === true }
                : null;
        case "skill-increase": {
            const skillSlug = draft.skillIncreases[slotId];
            return typeof skillSlug === "string" && skillSlug.length > 0
                ? { kind: "skill-increase", slotId, skillSlug }
                : null;
        }
        case "skill-training": {
            const training = draft.skillTrainings[slotId];
            return training ? { kind: "skill-training", slotId, training } : null;
        }
        case "spell-choice": {
            const selections = draft.spellChoices[slotId];
            return selections && selections.length > 0 ? { kind: "spell-choice", slotId, selections } : null;
        }
        default:
            return null;
    }
}
export function readDraftStepSelection(draft, step) {
    const decision = readDraftStepDecision(draft, step);
    return decision?.kind === "selection" || decision?.kind === "class-branch" ? decision.selection : null;
}
export function writeDraftStepSelection(draft, step, selection) {
    const previousSelection = readDraftStepSelection(draft, step);
    if (isClassBranchStep(step)) {
        draft.branchSelections[selection.slotId] = selection;
    }
    else {
        draft.selections[selection.slotId] = selection;
    }
    return previousSelection;
}
//# sourceMappingURL=draft-decisions.js.map