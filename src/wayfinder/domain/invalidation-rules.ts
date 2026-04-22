import type { DraftState } from "../../types.js";
import { clearDraftSlotDecisions, listDraftDecisionSlotIds } from "./draft-decisions.js";
import { SLOT_IDS } from "./slot-ids.js";

export interface DraftInteractionState {
  draft: DraftState;
  previewValueByStepId: Map<string, string>;
  pickerFiltersByStepId: Map<string, { rarity: string[]; source: string[] }>;
  recentlyInvalidatedStepIds: Set<string>;
  scrollById: Map<string, number>;
}

export interface ResetHooks {
  resetAncestryBoostDraft: () => boolean;
  resetBackgroundBoostDraft: () => boolean;
  resetClassBoostDraft: () => boolean;
}

export function clearSelectionState(state: DraftInteractionState, slotId: string, hooks: ResetHooks): number {
  const hadDecision = clearDraftSlotDecisions(state.draft, slotId);

  if (hadDecision && slotId === SLOT_IDS.ancestry) {
    hooks.resetAncestryBoostDraft();
    state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
  } else if (hadDecision && slotId === SLOT_IDS.background) {
    hooks.resetBackgroundBoostDraft();
    state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
  } else if (hadDecision && slotId === SLOT_IDS.class) {
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

export function invalidateSelectionState(state: DraftInteractionState, slotId: string, hooks: ResetHooks): string[] {
  if (clearSelectionState(state, slotId, hooks) === 0) {
    return [];
  }

  state.recentlyInvalidatedStepIds.add(slotId);
  return [slotId];
}

export function invalidateSelectionsByPrefix(
  state: DraftInteractionState,
  prefix: string,
  hooks: ResetHooks
): string[] {
  const invalidated: string[] = [];
  const candidateSlotIds = new Set<string>([
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

function scrollSlotId(key: string): string {
  const separatorIndex = key.indexOf(":");
  return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}
