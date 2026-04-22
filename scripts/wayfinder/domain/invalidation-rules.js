import { clearDraftSlotDecisions, listDraftDecisionSlotIds } from "./draft-decisions.js";
import { SLOT_IDS } from "./slot-ids.js";
export function clearSelectionState(state, slotId, hooks) {
    if (!clearDraftSlotDecisions(state.draft, slotId)) {
        state.recentlyInvalidatedStepIds.delete(slotId);
        return 0;
    }
    if (slotId === SLOT_IDS.ancestry) {
        hooks.resetAncestryBoostDraft();
        state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    else if (slotId === SLOT_IDS.background) {
        hooks.resetBackgroundBoostDraft();
        state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    else if (slotId === SLOT_IDS.class) {
        hooks.resetClassBoostDraft();
        state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    state.previewValueByStepId.delete(slotId);
    state.pickerFiltersByStepId.delete(slotId);
    for (const key of [...state.scrollById.keys()]) {
        if (key === slotId || key.startsWith(`${slotId}:`)) {
            state.scrollById.delete(key);
        }
    }
    state.recentlyInvalidatedStepIds.delete(slotId);
    return 1;
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
    for (const slotId of listDraftDecisionSlotIds(state.draft)) {
        if (!slotId.startsWith(prefix)) {
            continue;
        }
        invalidated.push(...invalidateSelectionState(state, slotId, hooks));
    }
    return invalidated;
}
//# sourceMappingURL=invalidation-rules.js.map