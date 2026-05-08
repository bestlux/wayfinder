import { listActorItems } from "../build-state.js";
import type { ActorItemLike, ActorLike } from "../shared/actor-model.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import { SINGLETON_ITEM_TYPES } from "./selection-constants.js";

export function orderSelections(draft: DraftState, steps: PendingStep[]): SelectionRef[] {
  const order = new Map<string, number>();
  steps.forEach((step, index) => order.set(step.slotId, index));

  return Object.values(draft.selections).sort((left, right) => {
    return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
  });
}

export function singletonSelections(selections: SelectionRef[]): SelectionRef[] {
  return selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType));
}

export function featSelections(selections: SelectionRef[]): SelectionRef[] {
  return selections.filter((entry) => entry.itemType === "feat");
}

export function hasSourceId(actor: ActorLike, sourceId: string): boolean {
  return (listActorItems(actor) as ActorItemLike[]).some((item) => itemMatchesSourceId(item, sourceId));
}
