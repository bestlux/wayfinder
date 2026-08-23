export const STARTING_EQUIPMENT_RESULT_WINDOW = Object.freeze({
  baselineSize: 36,
  maximumSize: 144,
  hydrationChunkSize: 12,
  prefetchConcurrency: 2,
  bufferViewportHeights: 3,
  overscanRows: 12,
  initialRowHeightPx: 48,
  minimumRowHeightPx: 36,
  maximumMeasuredRows: 192,
  maximumSkeletonRows: 144,
});

export interface StartingEquipmentResultWindow {
  readonly offset: number;
  readonly limit: number;
}

export interface StartingEquipmentResultWindowLoadState {
  readonly committed: StartingEquipmentResultWindow;
  readonly pending: StartingEquipmentResultWindow | null;
  readonly queued: StartingEquipmentResultWindow | null;
}

export interface StartingEquipmentRowMeasurements {
  readonly estimatedRowPx: number;
  readonly measuredRows?: ReadonlyMap<number, number>;
}

export type StartingEquipmentScrollDirection = "backward" | "forward" | "stationary";

export function normalizeStartingEquipmentResultLimit(limit: number): number {
  if (!Number.isSafeInteger(limit)) return STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize;
  const bounded = Math.min(
    STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize,
    Math.max(STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize, limit)
  );
  return (
    Math.ceil(bounded / STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize) *
    STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize
  );
}

export function clampStartingEquipmentResultWindow(
  window: StartingEquipmentResultWindow,
  total: number
): StartingEquipmentResultWindow {
  const limit = normalizeStartingEquipmentResultLimit(window.limit);
  const boundedTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const requestedOffset = Number.isSafeInteger(window.offset) && window.offset > 0 ? window.offset : 0;
  return {
    offset: Math.min(requestedOffset, Math.max(0, boundedTotal - limit)),
    limit,
  };
}

export function startingEquipmentResultWindowForViewport(input: {
  readonly clientHeight: number;
  readonly scrollTop: number;
  readonly total: number;
  readonly currentWindow?: StartingEquipmentResultWindow;
  readonly direction?: StartingEquipmentScrollDirection;
  readonly measurements?: StartingEquipmentRowMeasurements;
}): StartingEquipmentResultWindow {
  const clientHeight = Number.isFinite(input.clientHeight) ? Math.max(0, input.clientHeight) : 0;
  const scrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0;
  const measurements = input.measurements ?? {
    estimatedRowPx: STARTING_EQUIPMENT_RESULT_WINDOW.initialRowHeightPx,
  };
  const estimatedRowPx = clampStartingEquipmentRowHeight(measurements.estimatedRowPx);
  const visibleRows = Math.max(1, Math.ceil(clientHeight / estimatedRowPx));
  const limit = normalizeStartingEquipmentResultLimit(
    Math.max(
      STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize,
      visibleRows * STARTING_EQUIPMENT_RESULT_WINDOW.bufferViewportHeights,
      visibleRows + STARTING_EQUIPMENT_RESULT_WINDOW.overscanRows * 2
    )
  );
  const firstVisibleRow = startingEquipmentIndexAtScrollOffset(
    scrollTop,
    input.total,
    measurements.measuredRows ?? EMPTY_ROW_MEASUREMENTS,
    estimatedRowPx
  );
  const visibleEnd = Math.min(Math.max(0, input.total), firstVisibleRow + visibleRows);
  const current = clampStartingEquipmentResultWindow(input.currentWindow ?? { offset: 0, limit }, input.total);
  const resized = current.limit !== limit;
  const currentEnd = Math.min(Math.max(0, input.total), current.offset + current.limit);
  const viewportOutsideCurrent = firstVisibleRow < current.offset || visibleEnd > currentEnd;
  const chunk = STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize;
  const triggerRows = Math.max(STARTING_EQUIPMENT_RESULT_WINDOW.overscanRows, visibleRows);
  const direction = input.direction ?? "stationary";
  let offset = current.offset;
  let shouldRewindow = false;

  if (viewportOutsideCurrent || resized) {
    shouldRewindow = true;
    offset = alignedWindowOffsetForViewport({
      direction,
      firstVisibleRow,
      visibleEnd,
      visibleRows,
      limit,
    });
  } else if (direction === "forward" && visibleEnd + triggerRows >= currentEnd && currentEnd < input.total) {
    shouldRewindow = true;
    offset = Math.max(
      current.offset + chunk,
      alignedWindowOffsetForViewport({ direction, firstVisibleRow, visibleEnd, visibleRows, limit })
    );
  } else if (direction === "backward" && firstVisibleRow - triggerRows <= current.offset && current.offset > 0) {
    shouldRewindow = true;
    offset = Math.min(
      current.offset - chunk,
      alignedWindowOffsetForViewport({ direction, firstVisibleRow, visibleEnd, visibleRows, limit })
    );
  }

  if (!shouldRewindow) return current;

  return clampStartingEquipmentResultWindow(
    {
      offset: alignedWindowOffsetCoveringViewport({ offset, firstVisibleRow, visibleEnd, limit }),
      limit,
    },
    input.total
  );
}

export function createStartingEquipmentResultWindowLoadState(
  committed: StartingEquipmentResultWindow = {
    offset: 0,
    limit: STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize,
  }
): StartingEquipmentResultWindowLoadState {
  return { committed: { ...committed }, pending: null, queued: null };
}

export function requestStartingEquipmentResultWindow(
  state: StartingEquipmentResultWindowLoadState,
  target: StartingEquipmentResultWindow
): {
  readonly state: StartingEquipmentResultWindowLoadState;
  readonly scheduled: StartingEquipmentResultWindow | null;
} {
  if (state.pending) {
    const queued = sameStartingEquipmentResultWindow(state.pending, target) ? null : { ...target };
    return {
      state: { ...state, queued },
      scheduled: null,
    };
  }
  if (sameStartingEquipmentResultWindow(state.committed, target)) return { state, scheduled: null };
  const scheduled = { ...target };
  return {
    state: { committed: state.committed, pending: scheduled, queued: null },
    scheduled,
  };
}

export function commitStartingEquipmentResultWindow(
  state: StartingEquipmentResultWindowLoadState,
  completed: StartingEquipmentResultWindow,
  committed: StartingEquipmentResultWindow = completed
): {
  readonly state: StartingEquipmentResultWindowLoadState;
  readonly scheduled: StartingEquipmentResultWindow | null;
} {
  if (!state.pending || !sameStartingEquipmentResultWindow(state.pending, completed)) {
    return { state: createStartingEquipmentResultWindowLoadState(committed), scheduled: null };
  }
  const queued = state.queued && !sameStartingEquipmentResultWindow(state.queued, committed) ? state.queued : null;
  return {
    state: {
      committed: { ...committed },
      pending: queued ? { ...queued } : null,
      queued: null,
    },
    scheduled: queued ? { ...queued } : null,
  };
}

export function recoverStartingEquipmentResultWindowAfterFailure(state: StartingEquipmentResultWindowLoadState): {
  readonly state: StartingEquipmentResultWindowLoadState;
  readonly scheduled: StartingEquipmentResultWindow | null;
} {
  const queued =
    state.queued && !sameStartingEquipmentResultWindow(state.queued, state.committed) ? state.queued : null;
  if (!queued) {
    return { state: createStartingEquipmentResultWindowLoadState(state.committed), scheduled: null };
  }
  return {
    state: {
      committed: state.committed,
      pending: { ...queued },
      queued: null,
    },
    scheduled: { ...queued },
  };
}

export function sameStartingEquipmentResultWindow(
  left: StartingEquipmentResultWindow,
  right: StartingEquipmentResultWindow
): boolean {
  return left.offset === right.offset && left.limit === right.limit;
}

export function recordStartingEquipmentRowMeasurement(
  measuredRows: Map<number, number>,
  index: number,
  borderBoxHeight: number
): void {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isFinite(borderBoxHeight)) return;
  measuredRows.delete(index);
  measuredRows.set(index, clampStartingEquipmentRowHeight(borderBoxHeight));
  while (measuredRows.size > STARTING_EQUIPMENT_RESULT_WINDOW.maximumMeasuredRows) {
    const oldest = measuredRows.keys().next().value;
    if (typeof oldest !== "number") break;
    measuredRows.delete(oldest);
  }
}

export function startingEquipmentPrefixHeight(
  index: number,
  measuredRows: ReadonlyMap<number, number>,
  estimatedRowPx: number
): number {
  const boundedIndex = Number.isSafeInteger(index) ? Math.max(0, index) : 0;
  const estimate = clampStartingEquipmentRowHeight(estimatedRowPx);
  let height = boundedIndex * estimate;
  let inspected = 0;
  for (const [rowIndex, measuredHeight] of measuredRows) {
    if (inspected >= STARTING_EQUIPMENT_RESULT_WINDOW.maximumMeasuredRows) break;
    inspected += 1;
    if (rowIndex >= 0 && rowIndex < boundedIndex && Number.isFinite(measuredHeight)) {
      height += clampStartingEquipmentRowHeight(measuredHeight) - estimate;
    }
  }
  return height;
}

export function startingEquipmentIndexAtScrollOffset(
  scrollTop: number,
  total: number,
  measuredRows: ReadonlyMap<number, number>,
  estimatedRowPx: number
): number {
  const boundedTotal = Number.isSafeInteger(total) ? Math.max(0, total) : 0;
  const target = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  let low = 0;
  let high = boundedTotal;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (startingEquipmentPrefixHeight(middle, measuredRows, estimatedRowPx) <= target) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, Math.max(0, boundedTotal - 1));
}

export function clampStartingEquipmentRowHeight(value: number): number {
  const fallback = STARTING_EQUIPMENT_RESULT_WINDOW.initialRowHeightPx;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(STARTING_EQUIPMENT_RESULT_WINDOW.minimumRowHeightPx, value);
}

function alignedWindowOffsetForViewport(input: {
  readonly direction: StartingEquipmentScrollDirection;
  readonly firstVisibleRow: number;
  readonly visibleEnd: number;
  readonly visibleRows: number;
  readonly limit: number;
}): number {
  const chunk = STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize;
  if (input.direction === "forward") {
    return alignDown(Math.max(0, input.firstVisibleRow - STARTING_EQUIPMENT_RESULT_WINDOW.overscanRows), chunk);
  }
  if (input.direction === "backward") {
    return alignDown(
      Math.max(0, input.visibleEnd + STARTING_EQUIPMENT_RESULT_WINDOW.overscanRows - input.limit),
      chunk
    );
  }
  return alignDown(Math.max(0, input.firstVisibleRow - Math.floor((input.limit - input.visibleRows) / 2)), chunk);
}

function alignDown(value: number, chunk: number): number {
  return Math.floor(Math.max(0, value) / chunk) * chunk;
}

function alignUp(value: number, chunk: number): number {
  return Math.ceil(Math.max(0, value) / chunk) * chunk;
}

function alignedWindowOffsetCoveringViewport(input: {
  readonly offset: number;
  readonly firstVisibleRow: number;
  readonly visibleEnd: number;
  readonly limit: number;
}): number {
  const chunk = STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize;
  const minimumOffset = Math.max(0, input.visibleEnd - input.limit);
  const maximumOffset = Math.max(minimumOffset, input.firstVisibleRow);
  let aligned = alignDown(input.offset, chunk);
  if (aligned < minimumOffset) aligned = alignUp(minimumOffset, chunk);
  if (aligned > maximumOffset) aligned = alignDown(maximumOffset, chunk);
  return aligned;
}

const EMPTY_ROW_MEASUREMENTS = new Map<number, number>();
