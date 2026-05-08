import { listActorItems } from "../build-state.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import { SINGLETON_ITEM_TYPES } from "./selection-constants.js";
export function orderSelections(draft, steps) {
    const order = new Map();
    steps.forEach((step, index) => order.set(step.slotId, index));
    return Object.values(draft.selections).sort((left, right) => {
        return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
    });
}
export function singletonSelections(selections) {
    return selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType));
}
export function featSelections(selections) {
    return selections.filter((entry) => entry.itemType === "feat");
}
export function hasSourceId(actor, sourceId) {
    return listActorItems(actor).some((item) => itemMatchesSourceId(item, sourceId));
}
//# sourceMappingURL=selection-queries.js.map