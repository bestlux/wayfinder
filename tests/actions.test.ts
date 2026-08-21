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

  it("parses shared level-range and pinned-summary deselection actions", () => {
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "set-picker-level-range",
          stepId: "spell-choice-wizard-spellbook-level-3",
          minimum: "1",
          maximum: "2",
        },
      } as any)
    ).toEqual({
      type: "set-picker-level-range",
      stepId: "spell-choice-wizard-spellbook-level-3",
      minimum: 1,
      maximum: 2,
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
          wayfinderAction: "add-equipment-item",
          stepId: "starting-equipment-level-5",
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
          funding: "allowance",
          allowanceId: "level-4-1",
        },
      } as any)
    ).toEqual({
      type: "add-equipment-item",
      stepId: "starting-equipment-level-5",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
      funding: "allowance",
      allowanceId: "level-4-1",
    });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "activate-equipment-policy",
          stepId: "starting-equipment-level-5",
          startKind: "replacement-character",
        },
      } as any)
    ).toEqual({
      type: "activate-equipment-policy",
      stepId: "starting-equipment-level-5",
      startKind: "replacement-character",
    });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "request-equipment-start",
          stepId: "starting-equipment-level-5",
          startKind: "new-campaign",
        },
      } as any)
    ).toEqual({
      type: "request-equipment-start",
      stepId: "starting-equipment-level-5",
      startKind: "new-campaign",
    });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "approve-equipment-policy-request",
          stepId: "starting-equipment-level-5",
          requestId: "request-1",
        },
      } as any)
    ).toEqual({
      type: "approve-equipment-policy-request",
      stepId: "starting-equipment-level-5",
      requestId: "request-1",
    });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "revoke-equipment-policy-judgment",
          stepId: "starting-equipment-level-5",
          judgmentId: "judgment-1",
        },
      } as any)
    ).toEqual({
      type: "revoke-equipment-policy-judgment",
      stepId: "starting-equipment-level-5",
      judgmentId: "judgment-1",
    });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "set-custom-equipment-lump-sum",
          stepId: "starting-equipment-level-5",
        },
      } as any)
    ).toEqual({ type: "set-custom-equipment-lump-sum", stepId: "starting-equipment-level-5" });
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "grant-extra-equipment-allowance",
          stepId: "starting-equipment-level-5",
        },
      } as any)
    ).toEqual({ type: "grant-extra-equipment-allowance", stepId: "starting-equipment-level-5" });
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
    expect(
      parseWayfinderAction({
        dataset: {
          wayfinderAction: "choose-titan-mauler-equipment",
          stepId: "starting-equipment-level-1",
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
        },
      } as any)
    ).toEqual({
      type: "choose-titan-mauler-equipment",
      stepId: "starting-equipment-level-1",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
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
