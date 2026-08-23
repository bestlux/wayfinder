import { PickerSearchScheduler, } from "./picker-search-scheduler.js";
export const EQUIPMENT_SEARCH_DELAY_MS = 24;
export function createEquipmentSearchScheduler(options) {
    return new PickerSearchScheduler({ delayMs: EQUIPMENT_SEARCH_DELAY_MS, preemptInFlight: true, ...options });
}
export function scheduleEquipmentSearchInput(input, scheduler, capture) {
    const stepId = input.dataset.stepId;
    if (!stepId)
        return null;
    const state = {
        stepId,
        query: input.value,
        cursor: input.selectionStart ?? input.value.length,
    };
    capture(state);
    return scheduler.schedule(state.stepId, state.query);
}
//# sourceMappingURL=equipment-search-input-service.js.map