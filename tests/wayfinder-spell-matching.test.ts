import { describe, expect, it } from "vitest";
import type { SpellChoiceMeta } from "../src/types";
import { spellMatchesChoice } from "../src/wayfinder/spell-choice/spell-matching";

describe("wayfinder spell matching", () => {
  it("allows additional spell names even when common-only filtering would otherwise reject the spell", () => {
    const choice = spellChoice({
      additionalAllowedSpellNames: ["Burning Hands"],
      restrictToCommon: true,
    });

    expect(
      spellMatchesChoice(
        spellItem("entry-1", "Burning Hands", 1, {
          traditions: ["arcane"],
          rarity: "uncommon",
        }),
        choice,
        "entry-1"
      )
    ).toBe(true);
  });

  it("allows additional spell UUIDs even when the spell is outside the class tradition", () => {
    const choice = spellChoice({
      destination: {
        type: "prepared",
        key: "cleric-divine-prepared",
        label: "Divine prepared spells",
        entryName: "Divine Prepared Spells",
        tradition: "divine",
        ability: "wis",
        prepared: "prepared",
      },
      additionalAllowedSpellUuids: ["Compendium.pf2e.spells-srd.Item.y6rAdMK6EFlV6U0t"],
      restrictToCommon: true,
    });

    expect(
      spellMatchesChoice(
        spellItem("entry-1", "Breathe Fire", 1, {
          sourceId: "Compendium.pf2e.spells-srd.Item.y6rAdMK6EFlV6U0t",
          traditions: ["arcane", "primal"],
          rarity: "uncommon",
        }),
        choice,
        "entry-1"
      )
    ).toBe(true);
  });

  it("rejects non-curriculum spells when curriculum names are specified", () => {
    const choice = spellChoice({
      curriculumSpellNames: ["Force Barrage", "Mystic Armor"],
      restrictToCommon: false,
    });

    expect(
      spellMatchesChoice(
        spellItem("entry-1", "Breathe Fire", 1, {
          traditions: ["arcane"],
        }),
        choice,
        "entry-1"
      )
    ).toBe(false);
  });

  it("rejects uncommon non-exception spells on common-only choices", () => {
    const choice = spellChoice({
      restrictToCommon: true,
      destination: {
        type: "prepared",
        key: "cleric-divine-prepared",
        label: "Divine prepared spells",
        entryName: "Divine Prepared Spells",
        tradition: "divine",
        ability: "wis",
        prepared: "prepared",
      },
    });

    expect(
      spellMatchesChoice(
        spellItem("entry-1", "Rare Blessing", 1, {
          traditions: ["divine"],
          rarity: "rare",
        }),
        choice,
        "entry-1"
      )
    ).toBe(false);
  });
});

function spellChoice(overrides: Partial<SpellChoiceMeta>): SpellChoiceMeta {
  return {
    slotId: "spell-choice-test",
    sourcePackId: "pf2e.classfeatures",
    sourceDocumentId: "spell-test",
    sourceUuid: "Compendium.pf2e.classfeatures.Item.spell-test",
    sourceName: "Spell Test",
    classSlug: "wizard",
    dependsOn: "class",
    destination: {
      type: "spellbook",
      key: "wizard-arcane-prepared",
      label: "Wizard spellbook",
      entryName: "Arcane Prepared Spells",
      tradition: "arcane",
      ability: "int",
      prepared: "prepared",
    },
    count: 1,
    minRank: 1,
    maxRank: 1,
    cantrip: false,
    curriculumSpellNames: [],
    additionalAllowedSpellNames: [],
    restrictToCommon: false,
    ...overrides,
  };
}

function spellItem(
  entryId: string,
  name: string,
  level: number,
  options: {
    traditions: string[];
    rarity?: string;
    sourceId?: string;
    valueTraits?: string[];
  }
) {
  return {
    id: `${entryId}-${name}`,
    type: "spell" as const,
    name,
    flags: options.sourceId ? { core: { sourceId: options.sourceId } } : {},
    system: {
      level: { value: level },
      location: { value: entryId },
      traits: {
        traditions: options.traditions,
        value: options.valueTraits ?? [],
        rarity: options.rarity,
      },
    },
  };
}
