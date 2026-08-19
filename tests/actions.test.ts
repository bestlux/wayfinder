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

  it("parses the dedicated class-archetype action", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "select-class-archetype",
          stepId: "class-archetype-doctrine-level-1",
          value: "battle-creed",
        },
      } as any)
    ).toEqual({
      type: "select-class-archetype",
      stepId: "class-archetype-doctrine-level-1",
      value: "battle-creed",
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

  it("parses spell rank filters and pinned-summary deselection actions", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "toggle-picker-filter",
          stepId: "spell-choice-wizard-spellbook-level-3",
          filterKind: "rank",
          value: "rank:2",
        },
      } as any)
    ).toEqual({
      type: "toggle-picker-filter",
      stepId: "spell-choice-wizard-spellbook-level-3",
      filterKind: "rank",
      value: "rank:2",
    });

    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "toggle-spell-choice",
          stepId: "spell-choice-wizard-spellbook-level-3",
          value: "pf2e.spells-srd:dispel-magic",
        },
      } as any)
    ).toEqual({
      type: "toggle-spell-choice",
      stepId: "spell-choice-wizard-spellbook-level-3",
      value: "pf2e.spells-srd:dispel-magic",
    });
  });

  it("parses the spell rarity access toggle", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "toggle-spell-rarity-access",
          stepId: "spell-choice-witch-cantrips-level-1",
        },
      } as any)
    ).toEqual({
      type: "toggle-spell-rarity-access",
      stepId: "spell-choice-witch-cantrips-level-1",
    });
  });

  it("parses the feedback support action", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "open-feedback",
        },
      } as any)
    ).toEqual({ type: "open-feedback" });
  });

  it("parses dedicated equipment cart and review actions", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "change-equipment-quantity",
          stepId: "starting-equipment-level-1",
          lineId: "line-1",
          delta: "1",
        },
      } as any)
    ).toEqual({
      type: "change-equipment-quantity",
      stepId: "starting-equipment-level-1",
      lineId: "line-1",
      delta: 1,
    });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "retain-all-equipment",
          stepId: "starting-equipment-level-1",
        },
      } as any)
    ).toEqual({ type: "retain-all-equipment", stepId: "starting-equipment-level-1" });
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
