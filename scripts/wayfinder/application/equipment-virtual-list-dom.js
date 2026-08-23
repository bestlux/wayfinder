import { clampStartingEquipmentRowHeight, STARTING_EQUIPMENT_RESULT_WINDOW, startingEquipmentIndexAtScrollOffset, startingEquipmentPrefixHeight, } from "../starting-equipment-result-window.js";
export function equipmentResultAnchorAtViewport(list) {
    const viewport = list.getBoundingClientRect();
    const row = [...list.querySelectorAll("[data-result-index]")].find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    });
    const index = Number(row?.dataset.resultIndex);
    const sourceUuid = row?.dataset.sourceUuid;
    if (!row || !sourceUuid || !Number.isSafeInteger(index))
        return null;
    return {
        sourceUuid,
        index,
        offsetFromViewportTopPx: row.getBoundingClientRect().top - viewport.top,
    };
}
export function renderEquipmentResultSkeletonBand(args) {
    const band = args.list.querySelector("[data-equipment-skeleton-band]");
    if (!band || !Number.isSafeInteger(args.total) || args.total < 1)
        return [];
    const estimatedRowPx = clampStartingEquipmentRowHeight(args.measurements.estimatedRowPx);
    const measuredRows = args.measurements.measuredRows ?? EMPTY_MEASUREMENTS;
    const firstVisible = startingEquipmentIndexAtScrollOffset(args.list.scrollTop, args.total, measuredRows, estimatedRowPx);
    const visibleRows = Math.max(1, Math.ceil(args.list.clientHeight / estimatedRowPx));
    const start = Math.max(0, firstVisible - 1);
    const end = Math.min(args.total, firstVisible + visibleRows + 1);
    const mounted = new Set([...args.list.querySelectorAll("[data-result-index]")]
        .map((row) => Number(row.dataset.resultIndex))
        .filter((index) => Number.isSafeInteger(index)));
    const fragment = args.list.ownerDocument.createDocumentFragment();
    const loadingIndices = [];
    for (let index = start; index < end; index += 1) {
        if (mounted.has(index))
            continue;
        if (loadingIndices.length >= STARTING_EQUIPMENT_RESULT_WINDOW.maximumSkeletonRows)
            break;
        const row = args.list.ownerDocument.createElement("div");
        row.className = "equipment-result-row equipment-result-skeleton";
        row.dataset.equipmentLoadingIndex = String(index);
        row.setAttribute("data-equipment-result-skeleton", "");
        row.setAttribute("aria-hidden", "true");
        row.style.top = `${startingEquipmentPrefixHeight(index, measuredRows, estimatedRowPx)}px`;
        row.style.height = `${estimatedRowPx}px`;
        row.innerHTML =
            '<span class="equipment-result-skeleton-art"></span><span class="equipment-result-skeleton-copy"><span></span><span></span></span><span class="equipment-result-skeleton-price"></span>';
        fragment.append(row);
        loadingIndices.push(index);
    }
    band.replaceChildren(fragment);
    band.hidden = loadingIndices.length === 0;
    return loadingIndices;
}
export function clearEquipmentResultSkeletonBand(list) {
    const band = list.querySelector("[data-equipment-skeleton-band]");
    if (!band)
        return;
    band.replaceChildren();
    band.hidden = true;
}
export function transferEquipmentResultFocusToSentinel(list) {
    list.focus({ preventScroll: true });
    return list.ownerDocument.activeElement === list;
}
const EMPTY_MEASUREMENTS = new Map();
//# sourceMappingURL=equipment-virtual-list-dom.js.map