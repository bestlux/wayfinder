import { describe, expect, it } from "vitest";
import {
  clampStartingEquipmentResultWindow,
  commitStartingEquipmentResultWindow,
  createStartingEquipmentResultWindowLoadState,
  recordStartingEquipmentRowMeasurement,
  recoverStartingEquipmentResultWindowAfterFailure,
  requestStartingEquipmentResultWindow,
  STARTING_EQUIPMENT_RESULT_WINDOW,
  startingEquipmentPrefixHeight,
  startingEquipmentResultWindowForViewport,
} from "../src/wayfinder/starting-equipment-result-window";

describe("starting equipment result window", () => {
  it("mounts about three viewport heights and expands beyond 36 rows within the 4K ceiling", () => {
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 192, scrollTop: 0, total: 500 })).toEqual({
      offset: 0,
      limit: 36,
    });
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 500, scrollTop: 0, total: 500 })).toEqual({
      offset: 0,
      limit: 36,
    });
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 2_000, scrollTop: 0, total: 500 })).toEqual({
      offset: 0,
      limit: 132,
    });
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 4_000, scrollTop: 0, total: 500 })).toEqual({
      offset: 0,
      limit: STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize,
    });
  });

  it("schedules a forward chunk while a full viewport still remains mounted", () => {
    const currentWindow = { offset: 0, limit: 36 };
    expect(
      startingEquipmentResultWindowForViewport({
        clientHeight: 480,
        scrollTop: 14 * 48,
        total: 500,
        currentWindow,
        direction: "forward",
      })
    ).toEqual({ offset: 12, limit: 36 });
    expect(
      startingEquipmentResultWindowForViewport({
        clientHeight: 480,
        scrollTop: 80 * 48,
        total: 500,
        currentWindow,
        direction: "forward",
      })
    ).toEqual({ offset: 60, limit: 36 });
  });

  it("preserves end-clamped windows and never aligns backward past visible rows", () => {
    expect(
      startingEquipmentResultWindowForViewport({
        clientHeight: 480,
        scrollTop: 27 * 48,
        total: 37,
        currentWindow: { offset: 1, limit: 36 },
        direction: "stationary",
      })
    ).toEqual({ offset: 1, limit: 36 });
    const backward = startingEquipmentResultWindowForViewport({
      clientHeight: 480,
      scrollTop: 76 * 48,
      total: 100,
      currentWindow: { offset: 64, limit: 36 },
      direction: "backward",
    });
    expect(backward).toEqual({ offset: 60, limit: 36 });
    expect(backward.offset + backward.limit).toBeGreaterThanOrEqual(86);
  });

  it("distinguishes a promoted window that covers the viewport from one the user has outrun", () => {
    expect(
      startingEquipmentResultWindowForViewport({
        clientHeight: 480,
        scrollTop: 38 * 48,
        total: 500,
        currentWindow: { offset: 24, limit: 36 },
        direction: "stationary",
      })
    ).toEqual({ offset: 24, limit: 36 });
    expect(
      startingEquipmentResultWindowForViewport({
        clientHeight: 480,
        scrollTop: 0,
        total: 500,
        currentWindow: { offset: 12, limit: 36 },
        direction: "stationary",
      })
    ).toEqual({ offset: 0, limit: 36 });
  });

  it("keeps every reachable viewport inside the selected window across direction and end clamps", () => {
    for (const total of [37, 100, 500]) {
      for (const clientHeight of [480, 2_000]) {
        const visibleRows = Math.ceil(clientHeight / 48);
        const maximumFirstVisible = Math.max(0, total - visibleRows);
        const firstVisibleRows = [...new Set([0, 1, 7, 14, maximumFirstVisible])].filter(
          (index) => index <= maximumFirstVisible
        );
        for (const limit of [36, 60, 144]) {
          for (const offset of [...new Set([0, 12, Math.max(0, total - limit)])]) {
            for (const direction of ["backward", "forward", "stationary"] as const) {
              for (const firstVisibleRow of firstVisibleRows) {
                const selected = startingEquipmentResultWindowForViewport({
                  clientHeight,
                  scrollTop: firstVisibleRow * 48,
                  total,
                  currentWindow: { offset, limit },
                  direction,
                });
                const visibleEnd = Math.min(total, firstVisibleRow + visibleRows);
                expect(
                  {
                    startsBeforeViewport: selected.offset <= firstVisibleRow,
                    endsAfterViewport: selected.offset + selected.limit >= visibleEnd,
                  },
                  JSON.stringify({ total, clientHeight, offset, limit, direction, firstVisibleRow, selected })
                ).toEqual({ startsBeforeViewport: true, endsAfterViewport: true });
              }
            }
          }
        }
      }
    }
  });

  it("keeps committed rows populated while rapid multi-screen targets preempt obsolete loads", () => {
    const initial = createStartingEquipmentResultWindowLoadState({ offset: 0, limit: 36 });
    const first = requestStartingEquipmentResultWindow(initial, { offset: 12, limit: 36 });
    expect(first).toMatchObject({
      state: { committed: { offset: 0, limit: 36 }, pending: { offset: 12, limit: 36 } },
      scheduled: { offset: 12, limit: 36 },
    });

    const rapid = requestStartingEquipmentResultWindow(first.state, { offset: 60, limit: 36 });
    expect(rapid).toMatchObject({
      state: {
        committed: { offset: 0, limit: 36 },
        pending: { offset: 60, limit: 36 },
      },
      scheduled: { offset: 60, limit: 36 },
    });
    expect(Array.from({ length: rapid.state.committed.limit }, (_, index) => index)).toHaveLength(36);

    const reversed = requestStartingEquipmentResultWindow(rapid.state, initial.committed);
    expect(reversed.state).toMatchObject({
      committed: initial.committed,
      pending: initial.committed,
    });
    expect(commitStartingEquipmentResultWindow(reversed.state, { offset: 12, limit: 36 })).toMatchObject({
      state: reversed.state,
      scheduled: null,
    });

    const stale = commitStartingEquipmentResultWindow(rapid.state, { offset: 12, limit: 36 });
    expect(stale).toEqual({ state: rapid.state, scheduled: null });
    const committed = commitStartingEquipmentResultWindow(rapid.state, { offset: 60, limit: 36 });
    expect(committed).toMatchObject({
      state: {
        committed: { offset: 60, limit: 36 },
        pending: null,
      },
      scheduled: null,
    });
  });

  it("recovers a failed latest window without wedging the committed rows", () => {
    const initial = createStartingEquipmentResultWindowLoadState({ offset: 0, limit: 36 });
    const pending = requestStartingEquipmentResultWindow(initial, { offset: 12, limit: 36 }).state;
    const latest = requestStartingEquipmentResultWindow(pending, { offset: 60, limit: 36 }).state;

    expect(recoverStartingEquipmentResultWindowAfterFailure(latest)).toEqual({
      state: initial,
      scheduled: null,
    });
    expect(recoverStartingEquipmentResultWindowAfterFailure(pending)).toEqual({
      state: initial,
      scheduled: null,
    });
  });

  it("clamps windows after context shrink and bounds exact border-box measurements without truncating tall rows", () => {
    expect(clampStartingEquipmentResultWindow({ offset: 95, limit: 12 }, 100)).toEqual({
      offset: 64,
      limit: 36,
    });
    expect(clampStartingEquipmentResultWindow({ offset: 88, limit: 24 }, 5)).toEqual({
      offset: 0,
      limit: 36,
    });

    const measuredRows = new Map<number, number>();
    for (let index = 0; index < 250; index += 1) {
      recordStartingEquipmentRowMeasurement(measuredRows, index, index === 249 ? 160 : 48);
    }
    expect(measuredRows.size).toBe(STARTING_EQUIPMENT_RESULT_WINDOW.maximumMeasuredRows);
    expect(measuredRows.has(0)).toBe(false);
    expect(measuredRows.get(249)).toBe(160);
    expect(startingEquipmentPrefixHeight(250, measuredRows, 48)).toBe(250 * 48 + 112);
  });
});
