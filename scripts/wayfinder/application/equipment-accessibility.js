export const STARTING_EQUIPMENT_STATUS_FOCUS_ID = "starting-equipment-status";
export const STARTING_EQUIPMENT_REVIEW_FOCUS_ID = "starting-equipment-review";
export function equipmentItemFocusId(sourceUuid, action) {
    return `starting-equipment-item:${sourceUuid}:${action}`;
}
export function equipmentAllowanceFocusId(sourceUuid, allowanceId) {
    return `starting-equipment-item:${sourceUuid}:allowance:${allowanceId}`;
}
export function equipmentLineFocusId(lineId) {
    return `starting-equipment-line:${lineId}`;
}
export function equipmentLineControlFocusId(lineId, action) {
    return `${equipmentLineFocusId(lineId)}:${action}`;
}
export function equipmentFilterFocusId(filterKey, value) {
    return `starting-equipment-filter:${filterKey}:${value}`;
}
/**
 * Restores focus after Foundry replaces the application HTML. Candidates are
 * ordered by user intent: preserve the initiating control when it still
 * exists, then relocate to the closest stable workflow target.
 */
export function restoreEquipmentFocus(root, candidateIds) {
    const controls = [...root.querySelectorAll("[data-wayfinder-focus-id]")];
    for (const candidateId of candidateIds) {
        const candidate = controls.find((control) => control.dataset.wayfinderFocusId === candidateId);
        if (candidate && !isDisabled(candidate)) {
            candidate.focus();
            return candidate;
        }
    }
    return null;
}
function isDisabled(element) {
    return element instanceof HTMLButtonElement || element instanceof HTMLInputElement
        ? element.disabled
        : element.getAttribute("aria-disabled") === "true";
}
//# sourceMappingURL=equipment-accessibility.js.map