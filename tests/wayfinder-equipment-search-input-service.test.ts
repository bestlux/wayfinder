import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEquipmentSearchScheduler,
  EQUIPMENT_SEARCH_DELAY_MS,
  type EquipmentSearchInputState,
  scheduleEquipmentSearchInput,
} from "../src/wayfinder/application/equipment-search-input-service";
import type { PickerSearchRequest } from "../src/wayfinder/application/picker-search-scheduler";

describe("equipment search input service", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces at 24ms and retains the final query and pending focus caret for one render", async () => {
    const rendered: PickerSearchRequest[] = [];
    const captured: EquipmentSearchInputState[] = [];
    const scheduler = createEquipmentSearchScheduler({
      render: async (request) => {
        rendered.push(request);
      },
    });

    for (const query of ["s", "sp", "spr", "spra", "spray pellets"]) {
      scheduleEquipmentSearchInput(
        {
          dataset: { stepId: "starting-equipment-level-5" },
          value: query,
          selectionStart: query.length,
        },
        scheduler,
        (state) => captured.push(state)
      );
    }

    await vi.advanceTimersByTimeAsync(EQUIPMENT_SEARCH_DELAY_MS - 1);
    expect(rendered).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({
      stepId: "starting-equipment-level-5",
      query: "spray pellets",
    });
    expect(captured.at(-1)).toEqual({
      stepId: "starting-equipment-level-5",
      query: "spray pellets",
      cursor: 13,
    });
  });

  it("aborts obsolete equipment work and starts the latest target before it settles", async () => {
    const first = deferred<void>();
    const rendered: PickerSearchRequest[] = [];
    const signals: AbortSignal[] = [];
    const scheduler = createEquipmentSearchScheduler({
      render: async (request, context) => {
        rendered.push(request);
        signals.push(context.signal);
        if (rendered.length === 1) await first.promise;
      },
    });

    const obsolete = scheduler.schedule("starting-equipment-level-5", "");
    await vi.advanceTimersByTimeAsync(EQUIPMENT_SEARCH_DELAY_MS);
    expect(rendered).toEqual([obsolete]);

    // Window and facet changes deliberately reuse the same query text.
    const latest = scheduler.schedule("starting-equipment-level-5", "");
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(EQUIPMENT_SEARCH_DELAY_MS);
    expect(rendered).toEqual([obsolete, latest]);

    first.resolve();
    await vi.runAllTimersAsync();
    expect(signals[1]?.aborted).toBe(false);
  });

  it("reports a current failure once and remains available for an immediate retry", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const scheduler = createEquipmentSearchScheduler({
      render: async () => {
        calls += 1;
        if (calls === 1) throw new Error("current projection failed");
      },
      onError: (error) => errors.push(error),
    });

    scheduler.schedule("starting-equipment-level-5", "");
    await vi.advanceTimersByTimeAsync(EQUIPMENT_SEARCH_DELAY_MS);
    expect(errors).toEqual([new Error("current projection failed")]);

    scheduler.schedule("starting-equipment-level-5", "");
    await vi.advanceTimersByTimeAsync(EQUIPMENT_SEARCH_DELAY_MS);
    expect(calls).toBe(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
