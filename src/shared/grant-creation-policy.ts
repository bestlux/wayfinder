import type { PendingStep } from "../types.js";

export function usesNativeGrantItemCreation(step: PendingStep | null | undefined): boolean {
  if (step?.kind !== "pick-item" || step.slotKind !== "grant-choice" || !step.grantSelection) {
    return false;
  }

  const staticUuidCount = step.grantSelection.filters.uuids?.length ?? step.filters.uuids?.length ?? 0;
  const itemType = step.grantSelection.itemType || step.filters.itemType;
  return step.grantSelection.sourceItemType === "feat" || (staticUuidCount > 0 && itemType === "feat");
}
