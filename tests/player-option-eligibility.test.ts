import { describe, expect, it } from "vitest";
import { evaluatePlayerRootEligibility, isPlayerSelectableRoot } from "../src/pack/player-option-eligibility";

describe("player root option eligibility", () => {
  it("rejects ancestry-shaped eidolon support documents", () => {
    expect(
      isPlayerSelectableRoot(
        ancestryEntry({
          traits: ["aberration", "eidolon"],
          boosts: emptyBoosts(),
          rules: [{ key: "ActiveEffectLike", path: "flags.system.eidolon-features", value: {} }],
        }),
        "ancestry"
      )
    ).toBe(false);
  });

  it("rejects a root explicitly modeled as a minion", () => {
    expect(
      isPlayerSelectableRoot(
        ancestryEntry({
          traits: ["construct", "minion"],
          boosts: standardBoosts(),
          rules: [],
        }),
        "ancestry"
      )
    ).toBe(false);
  });

  it("rejects animal-companion ancestry chassis without relying on a package or document name", () => {
    expect(
      isPlayerSelectableRoot(
        ancestryEntry({
          traits: ["animal"],
          boosts: emptyBoosts(),
          rules: [
            { key: "ActiveEffectLike", path: "system.abilities.str.mod", value: 3 },
            { key: "ActiveEffectLike", path: "system.abilities.dex.mod", value: 1 },
            { key: "ActiveEffectLike", path: "system.abilities.con.mod", value: 2 },
            { key: "ActiveEffectLike", path: "system.abilities.int.mod", value: -4 },
            { key: "ActiveEffectLike", path: "system.abilities.wis.mod", value: 2 },
          ],
        }),
        "ancestry"
      )
    ).toBe(false);
  });

  it("fails closed for ancestry roots without normal build choices", () => {
    expect(
      evaluatePlayerRootEligibility(
        {
          type: "ancestry",
          system: { boosts: emptyBoosts(), languages: { value: [], custom: "" }, rules: [], traits: { value: [] } },
        },
        "ancestry"
      )
    ).toMatchObject({ eligible: false, reason: "incomplete-ancestry-build-shape" });
  });

  it.each([
    ["Evil Eye", ["aberration", "evil-eye"]],
    ["Mimic", ["aberration"]],
    ["Angel", ["angel", "celestial"]],
    ["Intelligent Weapon", ["construct"]],
  ])("keeps unusual player ancestry %s when it has normal ancestry choices", (_name, traits) => {
    expect(
      isPlayerSelectableRoot(
        ancestryEntry({
          traits,
          boosts: standardBoosts(),
          rules: [],
        }),
        "ancestry"
      )
    ).toBe(true);
  });

  it("does not reject a playable animal ancestry solely for its creature trait", () => {
    expect(
      isPlayerSelectableRoot(
        ancestryEntry({
          traits: ["animal"],
          boosts: standardBoosts(),
          rules: [{ key: "GrantItem", uuid: "Compendium.example.features.Item.playerFeature" }],
        }),
        "ancestry"
      )
    ).toBe(true);
  });

  it("does not decide eligibility from a companion-like name", () => {
    expect(
      isPlayerSelectableRoot(
        {
          name: "Aberrant Eidolon",
          type: "ancestry",
          system: {
            traits: { value: ["humanoid"] },
            boosts: standardBoosts(),
            languages: { value: ["common"], custom: "" },
            rules: [],
          },
        },
        "ancestry"
      )
    ).toBe(true);
  });

  it("allows ordinary ancestry automation when the player ancestry chassis remains present", () => {
    expect(
      isPlayerSelectableRoot(
        ancestryEntry({
          traits: ["construct"],
          boosts: standardBoosts(),
          rules: [
            { key: "ChoiceSet", flag: "size", choices: ["sm", "med"] },
            { key: "ActiveEffectLike", path: "system.abilities.str.mod", value: 1 },
            { key: "GrantItem", uuid: "Compendium.example.features.Item.playerFeature" },
            { key: "Strike", label: "Integrated attack" },
          ],
        }),
        "ancestry"
      )
    ).toBe(true);
  });

  it("applies explicit companion automation markers to every player root type", () => {
    for (const type of ["heritage", "background", "class", "deity"]) {
      expect(
        isPlayerSelectableRoot(
          {
            type,
            system: {
              rules: [{ key: "ActiveEffectLike", path: "flags.system.companionCompendia.kind", value: type }],
            },
          },
          type
        )
      ).toBe(false);
    }
  });

  it("rejects heritage-shaped companion stat blocks but keeps ordinary versatile heritages", () => {
    expect(
      evaluatePlayerRootEligibility(
        {
          type: "heritage",
          system: {
            rules: ["str", "dex", "con"].map((attribute) => ({
              key: "ActiveEffectLike",
              path: `system.abilities.${attribute}.mod`,
              value: 2,
            })),
          },
        },
        "heritage"
      )
    ).toMatchObject({ eligible: false, reason: "direct-ability-statblock" });

    expect(evaluatePlayerRootEligibility({ type: "heritage", system: { rules: [] } }, "heritage")).toEqual({
      eligible: true,
      reason: "eligible",
      evidence: [],
    });
  });

  it("requires the standard class progression shape without requiring a key ability", () => {
    expect(evaluatePlayerRootEligibility({ type: "class", system: { rules: [] } }, "class")).toMatchObject({
      eligible: false,
      reason: "incomplete-class-progression",
    });
    expect(
      evaluatePlayerRootEligibility(
        {
          type: "class",
          system: {
            ancestryFeatLevels: { value: [1, 5] },
            classFeatLevels: { value: [2, 4] },
            generalFeatLevels: { value: [3, 7] },
            skillFeatLevels: { value: [2, 4] },
            skillIncreaseLevels: { value: [3, 5] },
            rules: [],
          },
        },
        "class"
      )
    ).toEqual({ eligible: true, reason: "eligible", evidence: [] });
  });

  it("does not reinterpret non-root options", () => {
    expect(
      isPlayerSelectableRoot(
        {
          type: "feat",
          system: {
            traits: { value: ["eidolon"] },
            rules: [{ key: "ActiveEffectLike", path: "flags.system.eidolon-features", value: {} }],
          },
        },
        "feat"
      )
    ).toBe(true);
  });
});

function ancestryEntry(options: { traits: string[]; boosts: unknown; rules: Record<string, unknown>[] }) {
  return {
    type: "ancestry",
    system: {
      boosts: options.boosts,
      languages: { value: ["common"], custom: "" },
      rules: options.rules,
      traits: { value: options.traits },
    },
  };
}

function emptyBoosts(): Record<string, { value: string[] }> {
  return { 0: { value: [] }, 1: { value: [] }, 2: { value: [] } };
}

function standardBoosts(): Record<string, { value: string[] }> {
  return {
    0: { value: ["str", "dex", "con", "int", "wis", "cha"] },
    1: { value: [] },
    2: { value: ["str", "dex", "con", "int", "wis", "cha"] },
  };
}
