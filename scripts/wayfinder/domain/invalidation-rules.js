import { clearDraftSlotDecisions, listDraftDecisionSlotIds } from "./draft-decisions.js";
import { SLOT_IDS } from "./slot-ids.js";
export function clearSelectionState(state, slotId, hooks) {
    const hadDecision = clearDraftSlotDecisions(state.draft, slotId);
    if (hadDecision && slotId === SLOT_IDS.ancestry) {
        hooks.resetAncestryBoostDraft();
        state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    else if (hadDecision && slotId === SLOT_IDS.background) {
        hooks.resetBackgroundBoostDraft();
        state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    else if (hadDecision && slotId === SLOT_IDS.class) {
        hooks.resetClassBoostDraft();
        state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    let clearedTransientState = false;
    if (state.previewValueByStepId.delete(slotId)) {
        clearedTransientState = true;
    }
    if (state.pickerFiltersByStepId.delete(slotId)) {
        clearedTransientState = true;
    }
    for (const key of [...state.scrollById.keys()]) {
        if (key === slotId || key.startsWith(`${slotId}:`)) {
            state.scrollById.delete(key);
            clearedTransientState = true;
        }
    }
    state.recentlyInvalidatedStepIds.delete(slotId);
    return hadDecision || clearedTransientState ? 1 : 0;
}
export function invalidateSelectionState(state, slotId, hooks) {
    if (clearSelectionState(state, slotId, hooks) === 0) {
        return [];
    }
    state.recentlyInvalidatedStepIds.add(slotId);
    return [slotId];
}
export function invalidateSelectionsByPrefix(state, prefix, hooks) {
    const invalidated = [];
    const candidateSlotIds = new Set([
        ...listDraftDecisionSlotIds(state.draft),
        ...state.previewValueByStepId.keys(),
        ...state.pickerFiltersByStepId.keys(),
        ...[...state.scrollById.keys()].map((key) => scrollSlotId(key)),
    ]);
    for (const slotId of candidateSlotIds) {
        if (!slotId.startsWith(prefix)) {
            continue;
        }
        invalidated.push(...invalidateSelectionState(state, slotId, hooks));
    }
    return invalidated;
}
function scrollSlotId(key) {
    const separatorIndex = key.indexOf(":");
    return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}
//# sourceMappingURL=invalidation-rules.js.map