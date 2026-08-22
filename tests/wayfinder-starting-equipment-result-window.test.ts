import { describe, expect, it } from "vitest";
import {
  clampStartingEquipmentResultWindow,
  STARTING_EQUIPMENT_RESULT_WINDOW,
  startingEquipmentResultWindowForViewport,
} from "../src/wayfinder/starting-equipment-result-window";

describe("starting equipment result window", () => {
  it("keeps the standard viewport at twelve rows and expands tall viewports within a hard ceiling", () => {
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 192, scrollTop: 0, total: 100 })).toEqual({
      offset: 0,
      limit: 12,
    });
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 500, scrollTop: 0, total: 100 })).toEqual({
      offset: 0,
      limit: 24,
    });
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 2_000, scrollTop: 0, total: 100 })).toEqual({
      offset: 0,
      limit: STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize,
    });
  });

  it("tracks scroll with overscan and clamps the hydrated slice at the end or after context shrink", () => {
    expect(startingEquipmentResultWindowForViewport({ clientHeight: 192, scrollTop: 800, total: 100 })).toEqual({
      offset: 12,
      limit: 12,
    });
    expect(clampStartingEquipmentResultWindow({ offset: 95, limit: 12 }, 100)).toEqual({
      offset: 88,
      limit: 12,
    });
    expect(clampStartingEquipmentResultWindow({ offset: 88, limit: 24 }, 5)).toEqual({
      offset: 0,
      limit: 24,
    });
  });
});
