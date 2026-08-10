import type { SelectionRef } from "../types.js";

export function selectionTakenLevel(selection: SelectionRef, fallback = 1): number {
  return (
    levelFromSelectionSlotId(selection.slotId) ?? normalizedLevel(selection.level) ?? normalizedLevel(fallback) ?? 1
  );
}

export function levelFromSelectionSlotId(slotId: string): number | null {
  return normalizedLevel(/-level-(\d+)$/.exec(slotId)?.[1]);
}

function normalizedLevel(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? Math.floor(numeric) : null;
}
