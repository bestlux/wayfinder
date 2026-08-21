import { type PickerSearchRequest, PickerSearchScheduler } from "./picker-search-scheduler.js";

export const EQUIPMENT_SEARCH_DELAY_MS = 24;

export interface EquipmentSearchInputLike {
  readonly dataset: { readonly stepId?: string };
  readonly selectionStart: number | null;
  readonly value: string;
}

export interface EquipmentSearchInputState {
  readonly cursor: number;
  readonly query: string;
  readonly stepId: string;
}

interface EquipmentSearchSchedulerOptions {
  readonly render: (request: PickerSearchRequest) => Promise<void>;
  readonly onError?: (error: unknown, request: PickerSearchRequest) => void;
}

export function createEquipmentSearchScheduler(options: EquipmentSearchSchedulerOptions): PickerSearchScheduler {
  return new PickerSearchScheduler({ delayMs: EQUIPMENT_SEARCH_DELAY_MS, ...options });
}

export function scheduleEquipmentSearchInput(
  input: EquipmentSearchInputLike,
  scheduler: PickerSearchScheduler,
  capture: (state: EquipmentSearchInputState) => void
): PickerSearchRequest | null {
  const stepId = input.dataset.stepId;
  if (!stepId) return null;
  const state = {
    stepId,
    query: input.value,
    cursor: input.selectionStart ?? input.value.length,
  };
  capture(state);
  return scheduler.schedule(state.stepId, state.query);
}
