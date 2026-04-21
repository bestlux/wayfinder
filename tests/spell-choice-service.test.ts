import { describe, expect, it } from "vitest";
import type { ActorLike } from "../src/shared/actor-model";
import type { SpellChoiceMeta } from "../src/types";
import { readExistingSpellChoiceSelections, wizardMaxSpellRank } from "../src/wayfinder/spell-choice-service";

describe("spell-choice-service", () => {
  it("reads existing cleric prepared spell choices from the matching entry", () => {
    const actor: ActorLike = {
      items: {
        contents: [
          {
            id: "entry-1",
            type: "spellcastingEntry",
            name: "Divine Prepared Spells",
            system: {
              ability: { value: "wis" },
              prepared: { value: "prepared" },
              tradition: { value: "divine" },
            },
          },
          spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.daze", "Daze", 1, ["divine"], ["cantrip"]),
          spellItem(
            "entry-1",
            "Compendium.pf2e.spells-srd.Item.divine-lance",
            "Divine Lance",
            1,
            ["divine"],
            ["cantrip"]
          ),
          spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.bless", "Bless", 1, ["divine"]),
          spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.bane", "Bane", 1, ["divine"]),
        ],
      },
    };

    const cantrips = readExistingSpellChoiceSelections(actor, {
      slotId: "spell-choice-cleric-cantrips-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "cleric-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
      sourceName: "Cleric Spellcasting",
      classSlug: "cleric",
      dependsOn: "class",
      destination: {
        type: "prepared",
        key: "cleric-divine-prepared",
        label: "Divine prepared spells",
        entryName: "Divine Prepared Spells",
        tradition: "divine",
        ability: "wis",
        prepared: "prepared",
      },
      count: 5,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    } satisfies SpellChoiceMeta);

    const rankOne = readExistingSpellChoiceSelections(actor, {
      slotId: "spell-choice-cleric-rank-1-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "cleric-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
      sourceName: "Cleric Spellcasting",
      classSlug: "cleric",
      dependsOn: "class",
      destination: {
        type: "prepared",
        key: "cleric-divine-prepared",
        label: "Divine prepared spells",
        entryName: "Divine Prepared Spells",
        tradition: "divine",
        ability: "wis",
        prepared: "prepared",
      },
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    } satisfies SpellChoiceMeta);

    expect(cantrips.map((selection) => selection.name)).toEqual(["Daze", "Divine Lance"]);
    expect(rankOne.map((selection) => selection.name)).toEqual(["Bless", "Bane"]);
  });

  it("reads existing spell choices from the matching spellbook entry", () => {
    const actor: ActorLike = {
      items: {
        contents: [
          {
            id: "entry-1",
            type: "spellcastingEntry",
            system: {
              ability: { value: "int" },
              prepared: { value: "prepared" },
              tradition: { value: "arcane" },
            },
          },
          spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.mystic-armor", "Mystic Armor", 1),
          spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.force-barrage", "Force Barrage", 1),
          spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.heal", "Heal", 1, ["divine"]),
        ],
      },
    };

    const selections = readExistingSpellChoiceSelections(actor, {
      slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "school-of-battle-magic",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.school-of-battle-magic",
      sourceName: "School of Battle Magic",
      classSlug: "wizard",
      dependsOn: "class-branch",
      destination: {
        type: "spellbook",
        key: "wizard-arcane-prepared",
        label: "Wizard spellbook",
        entryName: "Arcane Prepared Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: ["Force Barrage", "Mystic Armor"],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
    } satisfies SpellChoiceMeta);

    expect(selections.map((selection) => selection.name)).toEqual(["Mystic Armor", "Force Barrage"]);
  });

  it("ignores stale slot-tagged spells that no longer satisfy the current choice", () => {
    const actor: ActorLike = {
      items: {
        contents: [
          {
            id: "entry-1",
            type: "spellcastingEntry",
            system: {
              ability: { value: "int" },
              prepared: { value: "prepared" },
              tradition: { value: "arcane" },
            },
          },
          {
            ...spellItem("entry-1", "Compendium.pf2e.spells-srd.Item.breathe-fire", "Breathe Fire", 1),
            flags: {
              "pf2e-wayfinder": {
                slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
              },
            },
          },
        ],
      },
    };

    const selections = readExistingSpellChoiceSelections(actor, {
      slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "school-of-boundary",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.school-of-boundary",
      sourceName: "School of the Boundary",
      classSlug: "wizard",
      dependsOn: "class-branch",
      destination: {
        type: "spellbook",
        key: "wizard-arcane-prepared",
        label: "Wizard spellbook",
        entryName: "Arcane Prepared Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: ["Grim Tendrils", "Phantasmal Minion"],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
    } satisfies SpellChoiceMeta);

    expect(selections).toEqual([]);
  });

  it("derives the wizard maximum spell rank from level", () => {
    expect(wizardMaxSpellRank(1)).toBe(1);
    expect(wizardMaxSpellRank(3)).toBe(2);
    expect(wizardMaxSpellRank(17)).toBe(9);
    expect(wizardMaxSpellRank(20)).toBe(9);
  });
});

function spellItem(
  entryId: string,
  sourceId: string,
  name: string,
  level: number,
  traditions = ["arcane"],
  valueTraits: string[] = []
) {
  return {
    id: `${entryId}-${name}`,
    type: "spell",
    name,
    sourceId,
    system: {
      level: { value: level },
      location: { value: entryId },
      traits: {
        traditions,
        value: valueTraits,
      },
    },
  };
}
