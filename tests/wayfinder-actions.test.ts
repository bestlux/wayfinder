import { describe, expect, it } from "vitest";
import { isDraftMutationAction, parseWayfinderAction } from "../src/wayfinder/actions";

describe("Wayfinder actions", () => {
  it("parses the existing-character history import action", () => {
    const element = {
      dataset: {
        wayfinderAction: "import-existing-history",
      },
    } as unknown as HTMLElement;

    expect(parseWayfinderAction(element)).toEqual({ type: "import-existing-history" });
  });

  it("parses retry and distinguishes semantic draft mutations from browser state", () => {
    const retry = {
      dataset: { wayfinderAction: "retry-draft-save" },
    } as unknown as HTMLElement;

    expect(parseWayfinderAction(retry)).toEqual({ type: "retry-draft-save" });
    expect(parseWayfinderAction({ dataset: { wayfinderAction: "open-inventory" } } as unknown as HTMLElement)).toEqual({
      type: "open-inventory",
    });
    expect(isDraftMutationAction({ type: "target-up" })).toBe(true);
    expect(isDraftMutationAction({ type: "preview-option", stepId: "step", value: "item" })).toBe(false);
    expect(isDraftMutationAction({ type: "clear-picker-filters", stepId: "step" })).toBe(false);
    expect(isDraftMutationAction({ type: "retain-all-equipment", stepId: "equipment" })).toBe(true);
    expect(
      isDraftMutationAction({ type: "decline-equipment-policy-request", stepId: "equipment", requestId: "request-1" })
    ).toBe(true);
    expect(isDraftMutationAction({ type: "open-inventory" })).toBe(false);
    expect(
      isDraftMutationAction({
        type: "toggle-equipment-filter",
        stepId: "equipment",
        filterKey: "type",
        value: "weapon",
      })
    ).toBe(false);
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "toggle-equipment-filter-panel",
          stepId: "equipment",
          filterKey: "source",
        },
      } as unknown as HTMLElement)
    ).toEqual({ type: "toggle-equipment-filter-panel", stepId: "equipment", filterKey: "source" });
    expect(
      isDraftMutationAction({ type: "toggle-equipment-filter-panel", stepId: "equipment", filterKey: "rarity" })
    ).toBe(false);
  });
});
