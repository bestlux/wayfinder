export const STARTING_EQUIPMENT_RESULT_WINDOW = Object.freeze({
    baselineSize: 12,
    maximumSize: 36,
    hydrationChunkSize: 12,
    overscanRows: 4,
    initialRowHeightPx: 48,
    minimumRowHeightPx: 36,
    maximumRowHeightPx: 96,
});
export function normalizeStartingEquipmentResultLimit(limit) {
    if (!Number.isSafeInteger(limit))
        return STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize;
    const bounded = Math.min(STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize, Math.max(STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize, limit));
    return (Math.ceil(bounded / STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize) *
        STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize);
}
export function clampStartingEquipmentResultWindow(window, total) {
    const limit = normalizeStartingEquipmentResultLimit(window.limit);
    const boundedTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
    const requestedOffset = Number.isSafeInteger(window.offset) && window.offset > 0 ? window.offset : 0;
    return {
        offset: Math.min(requestedOffset, Math.max(0, boundedTotal - limit)),
        limit,
    };
}
export function startingEquipmentResultWindowForViewport(input) {
    const clientHeight = Number.isFinite(input.clientHeight) ? Math.max(0, input.clientHeight) : 0;
    const scrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0;
    const measurements = input.measurements ?? {
        estimatedRowPx: STARTING_EQUIPMENT_RESULT_WINDOW.initialRowHeightPx,
    };
    const estimatedRowPx = clampStartingEquipmentRowHeight(measurements.estimatedRowPx);
    const visibleRows = Math.ceil(clientHeight / estimatedRowPx);
    const limit = normalizeStartingEquipmentResultLimit(visibleRows + STARTING_EQUIPMENT_RESULT_WINDOW.overscanRows * 2);
    const firstVisibleRow = startingEquipmentIndexAtScrollOffset(scrollTop, input.total, measurements.measuredRows ?? new Map(), estimatedRowPx);
    const chunk = STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize;
    const offset = Math.floor(Math.max(0, firstVisibleRow - STARTING_EQUIPMENT_RESULT_WINDOW.overscanRows) / chunk) * chunk;
    return clampStartingEquipmentResultWindow({
        offset,
        limit,
    }, input.total);
}
export function startingEquipmentPrefixHeight(index, measuredRows, estimatedRowPx) {
    const boundedIndex = Number.isSafeInteger(index) ? Math.max(0, index) : 0;
    const estimate = clampStartingEquipmentRowHeight(estimatedRowPx);
    let height = boundedIndex * estimate;
    for (const [rowIndex, measuredHeight] of measuredRows) {
        if (rowIndex >= 0 && rowIndex < boundedIndex && Number.isFinite(measuredHeight)) {
            height += clampStartingEquipmentRowHeight(measuredHeight) - estimate;
        }
    }
    return height;
}
export function startingEquipmentIndexAtScrollOffset(scrollTop, total, measuredRows, estimatedRowPx) {
    const boundedTotal = Number.isSafeInteger(total) ? Math.max(0, total) : 0;
    const target = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
    let low = 0;
    let high = boundedTotal;
    while (low < high) {
        const middle = Math.floor((low + high + 1) / 2);
        if (startingEquipmentPrefixHeight(middle, measuredRows, estimatedRowPx) <= target)
            low = middle;
        else
            high = middle - 1;
    }
    return Math.min(low, Math.max(0, boundedTotal - 1));
}
export function clampStartingEquipmentRowHeight(value) {
    const fallback = STARTING_EQUIPMENT_RESULT_WINDOW.initialRowHeightPx;
    if (!Number.isFinite(value))
        return fallback;
    return Math.min(STARTING_EQUIPMENT_RESULT_WINDOW.maximumRowHeightPx, Math.max(STARTING_EQUIPMENT_RESULT_WINDOW.minimumRowHeightPx, value));
}
//# sourceMappingURL=starting-equipment-result-window.js.map