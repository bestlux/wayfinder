export const STARTING_EQUIPMENT_STATUS_FOCUS_ID = "starting-equipment-status";
export const STARTING_EQUIPMENT_REVIEW_FOCUS_ID = "starting-equipment-review";
export const STARTING_EQUIPMENT_SEARCH_FOCUS_ID = "starting-equipment-search";
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
export function startingEquipmentFocusCandidates(target) {
    if (!target?.closest(".starting-equipment-pane"))
        return null;
    const candidates = [];
    const controlId = target.closest("[data-wayfinder-focus-id]")?.dataset.wayfinderFocusId;
    if (controlId)
        candidates.push(controlId);
    const sourceUuid = target.dataset.sourceUuid;
    if (sourceUuid)
        candidates.push(equipmentItemFocusId(sourceUuid, "preview"));
    const lineId = target.dataset.lineId;
    if (lineId)
        candidates.push(equipmentLineFocusId(lineId));
    switch (target.dataset.wayfinderAction) {
        case "initialize-starting-equipment":
            candidates.push("starting-equipment-authority", STARTING_EQUIPMENT_SEARCH_FOCUS_ID, "starting-equipment-clear-filters");
            break;
        case "activate-equipment-policy":
        case "approve-equipment-policy-request":
        case "decline-equipment-policy-request":
            candidates.push(STARTING_EQUIPMENT_SEARCH_FOCUS_ID, "starting-equipment-clear-filters", "starting-equipment-authority");
            break;
        case "revoke-equipment-policy-judgment":
            candidates.push(STARTING_EQUIPMENT_SEARCH_FOCUS_ID, "starting-equipment-authority", "starting-equipment-clear-filters");
            break;
        case "request-equipment-start":
        case "select-equipment-recipe":
            candidates.push("starting-equipment-authority");
            break;
        case "acknowledge-equipment-handoff":
            candidates.push("starting-equipment-handoff");
            break;
    }
    candidates.push(STARTING_EQUIPMENT_REVIEW_FOCUS_ID);
    return [...new Set(candidates)];
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