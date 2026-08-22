import { describe, expect, it } from "vitest";
import {
  bindWayfinderInteractions,
  isDraftMutationAction,
  parseWayfinderAction,
  scrollActiveStepIntoView,
} from "../src/wayfinder/actions";

describe("Wayfinder actions", () => {
  it("parses rail level disclosure toggles as ephemeral view actions", () => {
    const collapse = {
      dataset: { wayfinderAction: "toggle-rail-level", level: "5", levelOpen: "true" },
    } as unknown as HTMLElement;
    const expand = {
      dataset: { wayfinderAction: "toggle-rail-level", level: "5", levelOpen: "false" },
    } as unknown as HTMLElement;

    expect(parseWayfinderAction(collapse)).toEqual({ type: "toggle-rail-level", level: 5, expanded: false });
    expect(parseWayfinderAction(expand)).toEqual({ type: "toggle-rail-level", level: 5, expanded: true });
    expect(isDraftMutationAction(parseWayfinderAction(expand)!)).toBe(false);
  });

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

  it("keeps the active rail step visible without smooth motion when reduced motion is requested", () => {
    const options: ScrollIntoViewOptions[] = [];
    const activeStep = {
      scrollIntoView: (value: ScrollIntoViewOptions) => options.push(value),
    } as unknown as HTMLElement;
    const root = {
      querySelector: (selector: string) => (selector === ".wizard-step-list .step-link.active" ? activeStep : null),
    } as unknown as HTMLElement;

    scrollActiveStepIntoView(root, false);
    scrollActiveStepIntoView(root, true);

    expect(options).toEqual([
      { behavior: "smooth", block: "nearest", inline: "nearest" },
      { behavior: "auto", block: "nearest", inline: "nearest" },
    ]);
  });

  it("restores a scoped render target when the target is itself the scroll container", () => {
    const listeners: string[] = [];
    const root = {
      addEventListener: (type: string) => listeners.push(type),
      dataset: { wayfinderScrollId: "equipment:detail" },
      matches: (selector: string) => selector === "[data-wayfinder-scroll-id]",
      querySelector: () => null,
      querySelectorAll: () => [],
      scrollTop: 0,
    } as unknown as HTMLElement;
    const noop = () => undefined;

    bindWayfinderInteractions(
      root,
      {
        onActionClick: noop,
        onSearchInput: noop,
        onEquipmentSearchInput: noop,
        onEquipmentSourceSearchInput: noop,
        onEquipmentQuantityCommit: noop,
        onScrollableScroll: noop,
        onManualChange: noop,
        onLoreInputChange: noop,
      },
      new Map([["equipment:detail", 144]]),
      null
    );

    expect(root.scrollTop).toBe(144);
    expect(listeners).toEqual(["scroll"]);
  });
});
