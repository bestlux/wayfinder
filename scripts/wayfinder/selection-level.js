export function selectionTakenLevel(selection, fallback = 1) {
    return (levelFromSelectionSlotId(selection.slotId) ?? normalizedLevel(selection.level) ?? normalizedLevel(fallback) ?? 1);
}
export function levelFromSelectionSlotId(slotId) {
    return normalizedLevel(/-level-(\d+)$/.exec(slotId)?.[1]);
}
function normalizedLevel(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? Math.floor(numeric) : null;
}
//# sourceMappingURL=selection-level.js.map