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
});
