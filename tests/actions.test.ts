import { describe, expect, it } from "vitest";
import { parseWayfinderAction } from "../src/wayfinder/actions";

describe("wayfinder actions", () => {
  it("parses dataset-backed selection actions", () => {
    const action = parseWayfinderAction({
      dataset: {
        wayfinderAction: "select-option",
        stepId: "class-level-1",
        value: "pf2e.classes:fighter",
      },
    } as any);

    expect(action).toEqual({
      type: "select-option",
      stepId: "class-level-1",
      value: "pf2e.classes:fighter",
    });
  });

  it("parses picker filter actions", () => {
    const action = parseWayfinderAction({
      dataset: {
        wayfinderAction: "toggle-picker-filter",
        stepId: "class-feat-level-2",
        filterKind: "source",
        value: "Player Core",
      },
    } as any);

    expect(action).toEqual({
      type: "toggle-picker-filter",
      stepId: "class-feat-level-2",
      filterKind: "source",
      value: "Player Core",
    });
  });

  it("parses picker filter menu toggle actions", () => {
    const action = parseWayfinderAction({
      dataset: {
        wayfinderAction: "toggle-picker-filter-menu",
        stepId: "class-feat-level-2",
        filterKind: "source",
      },
    } as any);

    expect(action).toEqual({
      type: "toggle-picker-filter-menu",
      stepId: "class-feat-level-2",
      filterKind: "source",
    });
  });

  it("rejects incomplete action datasets", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "toggle-boost-choice",
          stepId: "ability-boosts-level-1",
        },
      } as any)
    ).toBeNull();
  });
});
