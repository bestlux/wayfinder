import { describe, expect, it } from "vitest";
import { normalizeEquipmentComparisonFacts } from "../src/wayfinder/application/equipment-comparison-facts";

describe("equipment comparison source facts", () => {
  it("keeps ordinary default damage and traits independent of character bonuses", () => {
    const source = weapon({
      bonus: { value: 3 },
      bonusDamage: { value: 99 },
      traits: { value: ["agile", "finesse", "versatile-s", "two-hand-d8"] },
    });

    expect(normalizeEquipmentComparisonFacts(source)).toEqual({
      kind: "weapon",
      primary: { dice: 1, die: "d4", modifier: 0, damageType: "piercing" },
      hasAdditionalEffects: false,
      includesStriking: false,
    });
  });

  it.each([0, 1, 2, 3, 4])("derives conventional source striking rank %s exactly once", (striking) => {
    expect(normalizeEquipmentComparisonFacts(weapon({ runes: { striking, potency: 2, property: [] } }))).toEqual({
      kind: "weapon",
      primary: { dice: 1 + striking, die: "d4", modifier: 0, damageType: "piercing" },
      hasAdditionalEffects: false,
      includesStriking: striking > 0,
    });
  });

  it.each([2, 3, 4])("preserves inherent or already encoded %s dice without adding striking", (dice) => {
    expect(
      normalizeEquipmentComparisonFacts(
        weapon({ damage: { dice, die: "d6", damageType: "bludgeoning" }, runes: { striking: 2, property: [] } })
      )
    ).toMatchObject({ primary: { dice, die: "d6" }, includesStriking: false });
  });

  it("shows Frost Brand's primary dice while retaining its rune and special-item effects marker", () => {
    expect(
      normalizeEquipmentComparisonFacts(
        weapon({
          damage: { dice: 1, die: "d12", damageType: "slashing" },
          runes: { potency: 2, striking: 2, property: ["greaterFrost"] },
          specific: { runes: { potency: 2, striking: 2, property: ["greaterFrost"] } },
        })
      )
    ).toEqual({
      kind: "weapon",
      primary: { dice: 3, die: "d12", modifier: 0, damageType: "slashing" },
      hasAdditionalEffects: true,
      includesStriking: true,
    });
  });

  it.each([
    ["", undefined, 1],
    [null, undefined, 1],
    ["", 0, 1],
    [null, 0, 1],
    ["", 2, 2],
    [null, 2, 2],
  ])("normalizes legacy flat damage with die %s and modifier %s", (die, modifier, expected) => {
    const source = weapon({
      damage: { dice: 1, die, modifier, damageType: "acid", persistent: { number: 1, faces: 6, type: "acid" } },
      traits: { value: ["acid", "alchemical", "bomb", "consumable", "splash"] },
      splashDamage: { value: 1 },
    });

    expect(normalizeEquipmentComparisonFacts(source)).toEqual({
      kind: "weapon",
      primary: { dice: 0, die: null, modifier: expected, damageType: "acid" },
      hasAdditionalEffects: true,
      includesStriking: false,
    });
  });

  it("retains a signed source modifier on a real die without adding legacy bonusDamage", () => {
    expect(
      normalizeEquipmentComparisonFacts(
        weapon({ damage: { dice: 1, die: "d8", modifier: -2, damageType: "slashing" }, bonusDamage: { value: 9 } })
      )
    ).toMatchObject({ primary: { dice: 1, die: "d8", modifier: -2 } });
  });

  it("falls back for a persistent-only Atrophy Bomb without inventing a zero-damage formula", () => {
    expect(
      normalizeEquipmentComparisonFacts(
        weapon({
          damage: { dice: 0, die: null, damageType: "void", persistent: { number: 1, faces: 4, type: "void" } },
        })
      )
    ).toEqual({ kind: "weapon", primary: null, hasAdditionalEffects: true, includesStriking: false });
  });

  it.each([
    { damage: { dice: 1, die: "d8", damageType: "fire", persistent: { number: 1, faces: null, type: "fire" } } },
    { splashDamage: { value: 1 } },
    { damage: { dice: 1, die: "d4", damageType: "piercing", persistent: "unparseable" } },
    { splashDamage: "unparseable" },
    { runes: { striking: 0, property: ["flaming"] } },
    { runes: { striking: 0, property: "unparseable" } },
    { traits: { value: ["combination"] }, meleeUsage: { damage: { die: "d8", type: "slashing" } } },
    { traits: { value: ["double-barrel"] } },
    { specific: {} },
    { rules: [{ key: "FlatModifier", selector: "initiative", value: 1 }] },
  ])("marks additional or uncertain effects without pretending to summarize them %#", (system) => {
    expect(normalizeEquipmentComparisonFacts(weapon(system))).toMatchObject({ hasAdditionalEffects: true });
  });

  it.each([
    { flags: { pf2e: { battleForm: true } } },
    { flags: { pf2e: { fixedAttack: 12 } } },
    { system: { grade: "advanced" } },
    { system: { grade: "commercial", traits: { value: ["tech"] } } },
    { system: { traits: { value: ["analog"] } } },
    { system: { traits: { value: ["modular"] } } },
    { system: { traits: { value: [], config: { modular: [{ traits: ["tech"] }] } } } },
    { system: { traits: { value: ["double-barrel"], toggles: { doubleBarrel: { selected: true } } } } },
    { system: { traits: { value: ["consumable"] }, runes: { striking: 1, property: [] } } },
    { system: { traits: { value: ["consumable"] }, runes: { potency: 1, striking: 0, property: [] } } },
    { system: { traits: { value: ["consumable"] }, runes: { potency: 0, striking: 0, property: ["flaming"] } } },
    { system: { traits: { value: ["unarmed"], otherTags: ["handwraps-of-mighty-blows"] } } },
    { system: { slug: "handwraps-of-mighty-blows" } },
    { system: { rules: [{ key: "ItemAlteration", itemType: "weapon", property: "damage-dice", value: 3 }] } },
    { system: { rules: [{ key: "ItemAlteration", itemId: "{item|id}", itemType: "armor" }] } },
  ])("does not guess damage for unsupported or ambiguous item preparation %#", (overrides) => {
    const source = weapon(overrides.system);
    expect(normalizeEquipmentComparisonFacts({ ...source, ...overrides, system: source.system })).toMatchObject({
      kind: "weapon",
      primary: null,
      includesStriking: false,
    });
  });

  it("does not reject a rule that explicitly alters a different item type", () => {
    expect(
      normalizeEquipmentComparisonFacts(
        weapon({ rules: [{ key: "ItemAlteration", itemType: "armor", property: "ac-bonus" }] })
      )
    ).toMatchObject({ primary: { dice: 1, die: "d4" }, hasAdditionalEffects: true });
  });

  it.each([
    "1",
    -1,
    0.5,
    5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
  ])("does not silently normalize invalid striking %s to an ordinary weapon", (striking) => {
    expect(normalizeEquipmentComparisonFacts(weapon({ runes: { striking, property: [] } }))).toMatchObject({
      primary: null,
      includesStriking: false,
    });
  });

  it.each([
    { damage: [] },
    { damage: { dice: 1, die: "d4" } },
    { damage: { die: "d4", damageType: "piercing" } },
    { damage: { dice: 1, damageType: "piercing" } },
    { damage: { dice: "1", die: "d4", damageType: "piercing" } },
    { damage: { dice: -1, die: "d4", damageType: "piercing" } },
    { damage: { dice: 1.5, die: "d4", damageType: "piercing" } },
    { damage: { dice: Number.MAX_SAFE_INTEGER + 1, die: "d4", damageType: "piercing" } },
    { damage: { dice: 1, die: "d20", damageType: "piercing" } },
    { damage: { dice: 1, die: "d4", damageType: "unknown" } },
    { damage: { dice: 1, die: "d4", damageType: "piercing", modifier: "2" } },
    { damage: { dice: 1, die: "d4", damageType: "piercing", modifier: 0.5 } },
    { damage: { dice: 1, die: "d4", damageType: "piercing", modifier: Number.NaN } },
    { runes: null },
    { traits: null },
    { traits: { value: [null] } },
    { rules: [null] },
  ])("fails closed for malformed relevant source data %#", (system) => {
    expect(() => normalizeEquipmentComparisonFacts(weapon(system))).not.toThrow();
    expect(normalizeEquipmentComparisonFacts(weapon(system))).toMatchObject({ kind: "weapon", primary: null });
  });

  it.each([0, 1, 2, 3, 2.5])("preserves finite nonnegative listed shield AC %s", (acBonus) => {
    expect(
      normalizeEquipmentComparisonFacts({ type: "shield", system: { acBonus, hardness: 8, hp: { max: 64 } } })
    ).toEqual({
      kind: "shield",
      acBonus,
    });
  });

  it.each([
    undefined,
    null,
    "2",
    false,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("keeps unavailable shield AC %s separate from valid zero", (acBonus) => {
    expect(normalizeEquipmentComparisonFacts({ type: "shield", system: { acBonus } })).toEqual({
      kind: "shield",
      acBonus: null,
    });
  });

  it.each([
    null,
    undefined,
    2,
    "weapon",
    [],
    {},
    { type: "equipment" },
    { type: "armor" },
    { type: "consumable" },
  ])("does not give irrelevant or unknown sources comparison facts %#", (source) => {
    expect(normalizeEquipmentComparisonFacts(source)).toBeNull();
  });

  it("retains the relevant kind when the item's entire system is missing", () => {
    expect(normalizeEquipmentComparisonFacts({ type: "weapon" })).toEqual({
      kind: "weapon",
      primary: null,
      hasAdditionalEffects: false,
      includesStriking: false,
    });
    expect(normalizeEquipmentComparisonFacts({ type: "shield" })).toEqual({ kind: "shield", acBonus: null });
  });

  it("does not prepare or mutate frozen source data and freezes independent returned facts", () => {
    const source = weapon();
    const system = source.system;
    const damage = system.damage;
    freezeSource(source);

    const facts = normalizeEquipmentComparisonFacts(source);

    expect(facts).toMatchObject({ primary: { dice: 1, die: "d4", modifier: 0 } });
    expect(Object.isFrozen(facts)).toBe(true);
    expect(facts?.kind === "weapon" && Object.isFrozen(facts.primary)).toBe(true);
    expect(damage).toEqual({ dice: 1, die: "d4", damageType: "piercing" });
    expect(Object.isFrozen(normalizeEquipmentComparisonFacts({ type: "shield", system: { acBonus: 2 } }))).toBe(true);
  });

  it("keeps returned facts independent of subsequent source edits", () => {
    const source = weapon();
    const facts = normalizeEquipmentComparisonFacts(source);
    source.system.damage.dice = 4;

    expect(facts).toMatchObject({ primary: { dice: 1, die: "d4" } });
    expect(normalizeEquipmentComparisonFacts(source)).toMatchObject({ primary: { dice: 4, die: "d4" } });
  });
});

function weapon(system: Record<string, unknown> = {}) {
  return {
    type: "weapon",
    system: {
      damage: { dice: 1, die: "d4", damageType: "piercing" },
      runes: { potency: 0, striking: 0, property: [] },
      traits: { value: ["agile", "finesse", "versatile-s"], otherTags: [] },
      rules: [],
      grade: null,
      ...system,
    },
  };
}

function freezeSource(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const nested of Object.values(value)) freezeSource(nested);
  Object.freeze(value);
}
