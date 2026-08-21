export const STARTING_EQUIPMENT_STATUS_FOCUS_ID = "starting-equipment-status";
export const STARTING_EQUIPMENT_REVIEW_FOCUS_ID = "starting-equipment-review";

export function equipmentItemFocusId(
  sourceUuid: string,
  action: "preview" | "coin" | "request-exception" | "approve-exception" | "titan"
): string {
  return `starting-equipment-item:${sourceUuid}:${action}`;
}

export function equipmentAllowanceFocusId(sourceUuid: string, allowanceId: string): string {
  return `starting-equipment-item:${sourceUuid}:allowance:${allowanceId}`;
}

export function equipmentLineFocusId(lineId: string): string {
  return `starting-equipment-line:${lineId}`;
}

export function equipmentLineControlFocusId(lineId: string, action: "decrease" | "increase" | "remove"): string {
  return `${equipmentLineFocusId(lineId)}:${action}`;
}

export function equipmentFilterFocusId(filterKey: string, value: string): string {
  return `starting-equipment-filter:${filterKey}:${value}`;
}

/**
 * Restores focus after Foundry replaces the application HTML. Candidates are
 * ordered by user intent: preserve the initiating control when it still
 * exists, then relocate to the closest stable workflow target.
 */
export function restoreEquipmentFocus(root: ParentNode, candidateIds: readonly string[]): HTMLElement | null {
  const controls = [...root.querySelectorAll<HTMLElement>("[data-wayfinder-focus-id]")];
  for (const candidateId of candidateIds) {
    const candidate = controls.find((control) => control.dataset.wayfinderFocusId === candidateId);
    if (candidate && !isDisabled(candidate)) {
      candidate.focus();
      return candidate;
    }
  }
  return null;
}

function isDisabled(element: HTMLElement): boolean {
  return element instanceof HTMLButtonElement || element instanceof HTMLInputElement
    ? element.disabled
    : element.getAttribute("aria-disabled") === "true";
}
