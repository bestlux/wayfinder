import { describe, expect, it } from "vitest";
import { parseWayfinderAction } from "../src/wayfinder/actions";

describe("wayfinder actions", () => {
  it("parses dataset-backed selection actions", () => {
    const action = parseWayfinderAction({
      dataset: {
        wayfinderAction: "select-option",
        stepId: "class-level-1",
        value: "pf2e.classes:fighter"
      }
    } as any);

    expect(action).toEqual({
      type: "select-option",
      stepId: "class-level-1",
      value: "pf2e.classes:fighter"
    });
  });

  it("rejects incomplete action datasets", () => {
    expect(parseWayfinderAction({
      dataset: {
        wayfinderAction: "toggle-boost-choice",
        stepId: "ability-boosts-level-1"
      }
    } as any)).toBeNull();
  });
});
