import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef, SpellChoiceMeta } from "../src/types";
import {
  buildSpellChoiceSteps,
  readExistingSpellChoiceSelections,
  wizardMaxSpellRank,
} from "../src/wayfinder/spell-choice-service";

describe("spell-choice-service", () => {
  it("builds wizard spellbook steps for initial choices and later spellbook growth", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: {
        system: {
          slug: "wizard",
          items: {
            spellcasting: {
              name: "Wizard Spellcasting",
              uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
            },
          },
        },
      },
      effectiveSchoolDocument: {
        name: "School of Battle Magic",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-of-battle-magic",
          },
        },
        system: {
          slug: "school-of-battle-magic",
          description: {
            value:
              "<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Breathe Fire], @UUID[Compendium.pf2e.spells-srd.Item.Force Barrage]</li><li><strong>2nd:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Mist]</li></ul>",
          },
        },
      },
      targetLevel: 3,
      extractSlug: (document) => document?.system?.slug ?? null,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-wizard-spellbook-cantrips-level-1",
      "spell-choice-wizard-spellbook-rank-1-level-1",
      "spell-choice-wizard-curriculum-rank-1-level-1",
      "spell-choice-wizard-spellbook-level-2",
      "spell-choice-wizard-spellbook-level-3",
      "spell-choice-wizard-curriculum-rank-2-level-3",
    ]);
    expect(steps[2]?.spellChoice?.curriculumSpellNames).toEqual(["Breathe Fire", "Force Barrage"]);
    expect(steps[5]?.spellChoice?.curriculumSpellNames).toEqual(["Mist"]);
  });

  it("parses curriculum spells from labeled compendium UUIDs", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: {
        system: {
          slug: "wizard",
          items: {
            spellcasting: {
              name: "Wizard Spellcasting",
              uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
            },
          },
        },
      },
      effectiveSchoolDocument: {
        name: "School of the Boundary",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-of-the-boundary",
          },
        },
        system: {
          slug: "school-of-the-boundary",
          description: {
            value:
              '<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.k34hDOfIIMAxNL4a]{Grim Tendrils}, @UUID[Compendium.pf2e.spells-srd.Item.abcd1234]{Phantasmal Minion}, <a class="content-link" data-uuid="Compendium.pf2e.spells-srd.Item.efgh5678">Summon Undead</a></li></ul>',
          },
        },
      },
      targetLevel: 1,
      extractSlug: (document) => document?.system?.slug ?? null,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps[2]?.spellChoice?.curriculumSpellNames).toEqual([
      "Grim Tendrils",
      "Phantasmal Minion",
      "Summon Undead",
    ]);
  });

  it("suppresses resolved wizard spell-choice steps when actor state already covers them", async () => {
    const draft = createEmptyDraft(1);
    const steps = await buildSpellChoiceSteps({
      draft,
      currentLevel: 1,
      effectiveClassDocument: {
        system: {
          slug: "wizard",
          items: {
            spellcasting: {
              name: "Wizard Spellcasting",
              uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
            },
          },
        },
      },
      effectiveSchoolDocument: {
        name: "School of Battle Magic",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-of-battle-magic",
          },
        },
        system: {
          slug: "school-of-battle-magic",
          description: {
            value:
              "<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Breathe Fire], @UUID[Compendium.pf2e.spells-srd.Item.Force Barrage]</li></ul>",
          },
        },
      },
      targetLevel: 1,
      extractSlug: (document) => document?.system?.slug ?? null,
      readExistingSpellChoiceSelections: (choice) => {
        if (choice.slotId === "spell-choice-wizard-spellbook-cantrips-level-1") {
          return Array.from({ length: 10 }, (_, index) =>
            selection(choice.slotId, `cantrip-${index}`, `Cantrip ${index}`)
          );
        }

        return [];
      },
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-wizard-spellbook-rank-1-level-1",
      "spell-choice-wizard-curriculum-rank-1-level-1",
    ]);
  });

  it("switches to the unified-theory bonus spell instead of curriculum spell steps", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: {
        system: {
          slug: "wizard",
          items: {
            spellcasting: {
              name: "Wizard Spellcasting",
              uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
            },
          },
        },
      },
      effectiveSchoolDocument: {
        name: "School of Unified Magical Theory",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-of-unified-magical-theory",
          },
        },
        system: {
          slug: "school-of-unified-magical-theory",
          description: {
            value: "<p><strong>No Curriculum</strong></p>",
          },
        },
      },
      targetLevel: 3,
      extractSlug: (document) => document?.system?.slug ?? null,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toContain("spell-choice-wizard-unified-rank-1-level-1");
    expect(steps.map((step) => step.slotId)).not.toContain("spell-choice-wizard-curriculum-rank-1-level-1");
    expect(steps.map((step) => step.slotId)).not.toContain("spell-choice-wizard-curriculum-rank-2-level-3");
  });

  it("reads existing spell choices from the matching spellbook entry", () => {
    const actor = {
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

    const selections = readExistingSpellChoiceSelections(actor as any, {
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
    } satisfies SpellChoiceMeta);

    expect(selections.map((selection) => selection.name)).toEqual(["Mystic Armor", "Force Barrage"]);
  });

  it("ignores stale slot-tagged spells that no longer satisfy the current choice", () => {
    const actor = {
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

    const selections = readExistingSpellChoiceSelections(actor as any, {
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

function selection(slotId: string, documentId: string, name: string): SelectionRef {
  return {
    slotId,
    packId: "pf2e.spells-srd",
    documentId,
    uuid: `Compendium.pf2e.spells-srd.Item.${documentId}`,
    itemType: "spell",
    featType: null,
    name,
    level: 1,
  };
}

function spellItem(entryId: string, sourceId: string, name: string, level: number, traditions = ["arcane"]): any {
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
        value: [],
      },
    },
  };
}
