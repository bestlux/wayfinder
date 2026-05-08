import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import type { SpellChoiceDocumentLike } from "../src/wayfinder/spell-choice/types";
import { buildSpellChoiceSteps } from "../src/wayfinder/spell-choice-service";

describe("wayfinder spell-choice step builders", () => {
  it("builds wizard spellbook steps for initial choices and later spellbook growth", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
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
      extractSlug: extractSlug,
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
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
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
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps[2]?.spellChoice?.curriculumSpellNames).toEqual([
      "Grim Tendrils",
      "Phantasmal Minion",
      "Summon Undead",
    ]);
  });

  it("merges selected static class-feature grant curriculum into wizard school spell choices", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: {
        name: "School of Rooted Wisdom",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-of-rooted-wisdom",
          },
        },
        system: {
          slug: "school-of-rooted-wisdom",
          description: {
            value:
              "<ul><li><strong>cantrips:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Detect Magic]</li><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Alarm]</li></ul>",
          },
        },
      },
      effectiveClassFeatureDocuments: [
        {
          name: "Cascade Bearers",
          system: {
            description: {
              value:
                "<p><strong>Additional Curriculum</strong></p><ul><li><strong>cantrips:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Telekinetic Projectile]</li><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Force Barrage], @UUID[Compendium.pf2e.spells-srd.Item.Mystic Armor]</li></ul>",
            },
          },
        },
      ],
      targetLevel: 1,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps[2]?.spellChoice?.curriculumSpellNames).toEqual(["Alarm", "Force Barrage", "Mystic Armor"]);
  });

  it("suppresses resolved wizard spell-choice steps when actor state already covers them", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: battleMagicSchoolDocument(),
      targetLevel: 1,
      extractSlug: extractSlug,
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

  it("keeps a step visible when the draft already has selections even if actor state is full", async () => {
    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-wizard-spellbook-cantrips-level-1"] = [
      selection("spell-choice-wizard-spellbook-cantrips-level-1", "drafted-cantrip", "Drafted Cantrip"),
    ];

    const steps = await buildSpellChoiceSteps({
      draft,
      currentLevel: 1,
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: battleMagicSchoolDocument(),
      targetLevel: 1,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: (choice) => {
        if (choice.slotId === "spell-choice-wizard-spellbook-cantrips-level-1") {
          return Array.from({ length: 10 }, (_, index) =>
            selection(choice.slotId, `cantrip-${index}`, `Cantrip ${index}`)
          );
        }

        return [];
      },
    });

    expect(steps.map((step) => step.slotId)).toContain("spell-choice-wizard-spellbook-cantrips-level-1");
  });

  it("switches to the unified-theory bonus spell instead of curriculum spell steps", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
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
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toContain("spell-choice-wizard-unified-rank-1-level-1");
    expect(steps.map((step) => step.slotId)).not.toContain("spell-choice-wizard-curriculum-rank-1-level-1");
    expect(steps.map((step) => step.slotId)).not.toContain("spell-choice-wizard-curriculum-rank-2-level-3");
    expect(
      steps.find((step) => step.slotId === "spell-choice-wizard-unified-rank-1-level-1")?.spellChoice
    ).toMatchObject({
      dependsOn: "class-branch",
      curriculumSpellNames: [],
      requiresCurriculum: false,
    });
  });

  it("builds cleric initial preparation steps and carries deity spell access", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: clericClassDocument(),
      effectiveSchoolDocument: null,
      effectiveDeityDocument: {
        name: "Sarenrae",
        system: {
          spells: {
            1: ["Compendium.pf2e.spells-srd.Item.burning-hands", "Compendium.pf2e.spells-srd.Item.y6rAdMK6EFlV6U0t"],
          },
        },
      },
      targetLevel: 1,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-cleric-cantrips-level-1",
      "spell-choice-cleric-rank-1-level-1",
    ]);
    expect(steps[0]?.spellChoice).toMatchObject({
      count: 5,
      cantrip: true,
      minRank: 0,
      maxRank: 0,
      destination: {
        key: "cleric-divine-prepared",
        tradition: "divine",
        ability: "wis",
        prepared: "prepared",
      },
    });
    expect(steps[1]?.spellChoice).toMatchObject({
      count: 2,
      cantrip: false,
      minRank: 1,
      maxRank: 1,
      additionalAllowedSpellNames: ["Burning Hands"],
      additionalAllowedSpellUuids: [
        "Compendium.pf2e.spells-srd.Item.burning-hands",
        "Compendium.pf2e.spells-srd.Item.y6rAdMK6EFlV6U0t",
      ],
      restrictToCommon: true,
    });
  });

  it("returns no steps for unknown class slugs", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: {
        system: {
          slug: "inventor",
          items: {},
        },
      },
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      targetLevel: 1,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps).toEqual([]);
  });
});

function extractSlug(document: SpellChoiceDocumentLike | null): string | null {
  return typeof document?.system?.slug === "string" ? document.system.slug : null;
}

function wizardClassDocument() {
  return {
    system: {
      slug: "wizard",
      items: {
        spellcasting: {
          name: "Wizard Spellcasting",
          uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
        },
      },
    },
  };
}

function clericClassDocument() {
  return {
    system: {
      slug: "cleric",
      items: {
        spellcasting: {
          name: "Cleric Spellcasting",
          uuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
        },
      },
    },
  };
}

function battleMagicSchoolDocument() {
  return {
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
  };
}

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
