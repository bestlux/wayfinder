import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { ABILITY_KEYS } from "../src/constants";
import type { PendingStep } from "../src/types";
import { buildBoostPane, remainingCreationBoostChoices } from "../src/wayfinder/panes/boost-pane";

describe("boost pane helpers", () => {
  it("marks the creation boost pane blocked until ancestry, background, and class exist", async () => {
    const step: PendingStep = {
      id: "ability-boosts-level-1",
      level: 1,
      kind: "boost",
      slotKind: "ability-boosts",
      title: "Ability boosts",
      description: "Choose boosts",
      required: true,
      slotId: "ability-boosts-level-1",
      boost: {
        batchLevel: 1,
        requiredCount: 4,
        grantCount: 4,
      },
    };

    const pane = await buildBoostPane(
      step,
      makeBuildState({
        ancestry: null,
        background: null,
        class: null,
      }),
      {
        isStepComplete: async () => false,
        stepStatus: async () => "Choose ancestry, background, and class first",
        abilityLabel: (attribute) => attribute.toUpperCase(),
      }
    );

    expect(pane.blocked).toBe(true);
    expect(pane.blockedTitle).toContain("Choose ancestry");
  });

  it("counts remaining creation-boost choices across ancestry, background, class, and level boosts", () => {
    const buildState = makeBuildState();
    expect(remainingCreationBoostChoices(buildState)).toBe(8);
  });

  it("offers one ordered choice for a gradual boost and disables abilities already used in its batch", async () => {
    const pane = await buildBoostPane(
      {
        id: "ability-boosts-level-3",
        level: 3,
        kind: "boost",
        slotKind: "ability-boosts",
        title: "Level 3 ability boost",
        description: "Choose one",
        required: true,
        slotId: "ability-boosts-level-3",
        boost: {
          batchLevel: 5,
          requiredCount: 2,
          grantCount: 1,
        },
      },
      makeBuildState({
        levelBoosts: {
          1: [],
          5: ["str"],
          10: [],
          15: [],
          20: [],
        },
      }),
      {
        isStepComplete: async () => false,
        stepStatus: async () => "1 choice remaining",
        abilityLabel: (attribute) => attribute.toUpperCase(),
      }
    );

    expect(pane.blocked).toBe(false);
    expect(pane.levelSection).toMatchObject({ level: 3, batchLevel: 5, remaining: 1 });
    expect(pane.levelSection.buttons.find((button) => button.attribute === "str")).toMatchObject({
      selected: false,
      disabled: true,
    });
    expect(pane.levelSection.buttons.filter((button) => !button.disabled)).toHaveLength(5);
  });
});

function makeBuildState(overrides: Partial<EffectiveBuildState> = {}): EffectiveBuildState {
  const projectedAbilities = Object.fromEntries(
    ABILITY_KEYS.map((key) => [
      key,
      {
        key,
        modifier: 0,
        partial: false,
        boostCount: 0,
        flawCount: 0,
      },
    ])
  ) as EffectiveBuildState["projectedAbilities"];

  return {
    ancestry: {
      document: {
        system: {
          boosts: {
            fixed: { value: ["con"], selected: "con" },
            free: { value: ["str", "dex", "int", "wis", "cha"], selected: null },
          },
        },
      },
      mode: "standard",
      selectedBoosts: { fixed: "con", free: null },
      alternateBoosts: [],
      lockedBoosts: ["con"],
      voluntary: {
        enabled: false,
        legacy: false,
        boost: null,
        flaws: [],
      },
      buildBoosts: ["con"],
      buildFlaws: [],
    },
    heritage: null,
    background: {
      document: {
        system: {
          boosts: {
            restricted: { value: ["str", "dex"], selected: null },
            free: { value: ["str", "dex", "con", "int", "wis", "cha"], selected: null },
          },
        },
      },
      selectedBoosts: { restricted: null, free: null },
      buildBoosts: [],
    },
    class: {
      document: {},
      keyAbilityOptions: ["str", "dex"],
      selectedKeyAbility: null,
    },
    deity: null,
    languages: null,
    levelBoosts: {
      1: [],
      5: [],
      10: [],
      15: [],
      20: [],
    },
    allowedBoosts: {
      1: 4,
      5: 0,
      10: 0,
      15: 0,
      20: 0,
    },
    projectedAbilities,
    ...overrides,
  };
}
