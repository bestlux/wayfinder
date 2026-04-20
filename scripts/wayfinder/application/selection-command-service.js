import { writeDraftStepSelection } from "../draft-decisions.js";
import { sameMembers } from "../formatting.js";
import { SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";
const NOOP_RESULT = {
    kind: "noop",
    warning: null,
    statusNote: null,
    shouldAdvance: false,
    shouldRender: false,
};
export async function chooseSelectionOption(state, step, rawValue, deps) {
    const selection = await deps.resolveSelection(rawValue, step);
    if (!selection) {
        return NOOP_RESULT;
    }
    if (deps.hasDuplicateDraftSelection(selection)) {
        return warningResult("duplicate-selection");
    }
    const previousSelection = writeDraftStepSelection(state.draft, step, selection);
    state.recentlyInvalidatedStepIds.delete(selection.slotId);
    let statusNote = null;
    if (step.slotKind === "ancestry" && previousSelection?.uuid !== selection.uuid) {
        const invalidated = [
            ...deps.invalidateSelection(SLOT_IDS.heritage),
            ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat),
        ];
        const boostReset = deps.resetAncestryBoostDraft();
        if (boostReset) {
            state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
        }
        if (invalidated.length > 0 || boostReset) {
            statusNote = boostReset
                ? "Ancestry changed. Wayfinder cleared ancestry-specific boost draft choices and marked dependent heritage and ancestry-feat picks for review."
                : "Ancestry changed. Wayfinder marked dependent heritage and ancestry-feat draft picks for review.";
        }
    }
    if (step.slotKind === "heritage" && previousSelection?.uuid !== selection.uuid) {
        const previousTraits = await deps.resolveSelectionTraits(previousSelection);
        const nextTraits = await deps.resolveSelectionTraits(selection);
        if (!sameMembers(previousTraits, nextTraits)) {
            const invalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat);
            if (invalidated.length > 0) {
                statusNote = "Heritage changed. Wayfinder marked ancestry-feat draft picks for review.";
            }
        }
    }
    if (step.slotKind === "background" && previousSelection?.uuid !== selection.uuid) {
        const boostReset = deps.resetBackgroundBoostDraft();
        if (boostReset) {
            state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
            statusNote = "Background changed. Wayfinder cleared background boost draft choices for review.";
        }
    }
    if (step.slotKind === "class" && previousSelection?.uuid !== selection.uuid) {
        const previousClassSlug = await deps.resolveSelectionSlug(previousSelection);
        const nextClassSlug = await deps.resolveSelectionSlug(selection);
        const boostReset = deps.resetClassBoostDraft();
        if (boostReset) {
            state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
        }
        if (previousClassSlug !== nextClassSlug) {
            const invalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classFeat);
            const deityInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.deity);
            const branchInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
            const classChoiceInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice);
            const trainingInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.skillTraining);
            const spellInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.spellChoice);
            if (invalidated.length > 0 ||
                deityInvalidated.length > 0 ||
                branchInvalidated.length > 0 ||
                classChoiceInvalidated.length > 0 ||
                trainingInvalidated.length > 0 ||
                spellInvalidated.length > 0 ||
                boostReset) {
                statusNote = boostReset
                    ? "Class changed. Wayfinder cleared the key-ability draft choice and marked drafted deity, class training, class path, class choice, spell, and class feat selections for review."
                    : "Class changed. Wayfinder marked drafted deity, class training, class path, class choice, spell, and class feat selections for review.";
            }
        }
        else if (boostReset) {
            statusNote = "Class changed. Wayfinder cleared the key-ability draft choice for review.";
        }
    }
    if (step.slotKind === "deity" && previousSelection?.uuid !== selection.uuid) {
        const invalidatedChoices = await deps.invalidateClassChoicesByDependency("deity");
        const invalidatedBranches = await deps.invalidateBranchSelectionsByDependency("deity");
        if (invalidatedChoices.length > 0 || invalidatedBranches.length > 0) {
            statusNote = "Deity changed. Wayfinder marked dependent class choices and class paths for review.";
        }
    }
    if (step.kind === "class-branch" && previousSelection?.uuid !== selection.uuid) {
        const invalidatedSpells = await deps.invalidateSpellChoicesByDependency("class-branch");
        if (invalidatedSpells.length > 0 && step.branch?.flag === "arcaneSchool") {
            statusNote = "Arcane school changed. Wayfinder marked dependent curriculum spell choices for review.";
        }
    }
    state.previewValueByStepId.set(step.id, rawValue);
    return changedResult({ statusNote, shouldAdvance: true });
}
export async function selectClassChoiceValue(state, step, value, deps) {
    const stepId = step?.slotId ?? "";
    if (!stepId) {
        return NOOP_RESULT;
    }
    const invalidatesDeityBranches = step?.classChoice?.flag === "sanctification";
    const wasSelected = state.draft.classChoices[stepId] === value;
    if (wasSelected) {
        delete state.draft.classChoices[stepId];
        let statusNote = null;
        if (invalidatesDeityBranches) {
            const invalidated = await deps.invalidateBranchSelectionsByDependency("deity");
            if (invalidated.length > 0) {
                statusNote = "Sanctification changed. Wayfinder marked dependent class paths for review.";
            }
        }
        state.recentlyInvalidatedStepIds.delete(stepId);
        return changedResult({ statusNote, shouldRender: true });
    }
    const previousValue = state.draft.classChoices[stepId] ?? null;
    state.draft.classChoices[stepId] = value;
    let statusNote = null;
    if (invalidatesDeityBranches && previousValue !== value) {
        const invalidated = await deps.invalidateBranchSelectionsByDependency("deity");
        if (invalidated.length > 0) {
            statusNote = "Sanctification changed. Wayfinder marked dependent class paths for review.";
        }
    }
    state.recentlyInvalidatedStepIds.delete(stepId);
    return changedResult({ statusNote, shouldAdvance: true });
}
export async function toggleSpellChoiceSelection(state, step, rawValue, deps) {
    if (!step || step.kind !== "spell-choice") {
        return NOOP_RESULT;
    }
    const selection = await deps.resolveSelection(rawValue, step);
    if (!selection) {
        return NOOP_RESULT;
    }
    state.draft.spellChoices[step.slotId] ??= [];
    const current = state.draft.spellChoices[step.slotId];
    const existingIndex = current.findIndex((entry) => entry.uuid === selection.uuid);
    if (existingIndex !== -1) {
        current.splice(existingIndex, 1);
        if (current.length === 0) {
            delete state.draft.spellChoices[step.slotId];
        }
        state.recentlyInvalidatedStepIds.delete(step.slotId);
        return changedResult({ shouldRender: true });
    }
    const selectedElsewhere = Object.entries(state.draft.spellChoices).some(([slotId, selections]) => {
        if (slotId === step.slotId) {
            return false;
        }
        return selections.some((entry) => entry.uuid === selection.uuid);
    });
    if (selectedElsewhere || deps.selectionExistsOnActor(selection)) {
        return warningResult("duplicate-selection");
    }
    const requiredCount = step.spellChoice?.count ?? 0;
    if (current.length >= requiredCount) {
        return warningResult("spell-choice-full");
    }
    current.push(selection);
    state.recentlyInvalidatedStepIds.delete(step.slotId);
    return current.length >= requiredCount
        ? changedResult({ shouldAdvance: true })
        : changedResult({ shouldRender: true });
}
function changedResult(args) {
    return {
        kind: "changed",
        warning: null,
        statusNote: args.statusNote ?? null,
        shouldAdvance: args.shouldAdvance ?? false,
        shouldRender: args.shouldRender ?? false,
    };
}
function warningResult(warning) {
    return {
        kind: "warning",
        warning,
        statusNote: null,
        shouldAdvance: false,
        shouldRender: false,
    };
}
//# sourceMappingURL=selection-command-service.js.map