import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import type { SpellChoiceDocumentLike } from "../src/wayfinder/spell-choice/types";
import {
  buildHistoricalSpellChoicePlanningNote,
  buildSpellChoiceSteps,
  readExistingSpellChoiceSelections,
} from "../src/wayfinder/spell-choice-service";

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

  it("parses curriculum rank labels without colons", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: wizardClassDocument(),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: {
        name: "Red Mantis Magic School",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.srcPBNjhq7FBSmi3",
          },
        },
        system: {
          slug: "red-mantis-magic-school",
          description: {
            value:
              "<ul><li><strong>1st</strong> @UUID[Compendium.pf2e.spells-srd.Item.Fleet Step], @UUID[Compendium.pf2e.spells-srd.Item.Illusory Disguise]</li><li><strong>2nd</strong> @UUID[Compendium.pf2e.spells-srd.Item.Invisibility], @UUID[Compendium.pf2e.spells-srd.Item.Mist]</li></ul>",
          },
        },
      },
      targetLevel: 3,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps[2]?.spellChoice?.curriculumSpellNames).toEqual(["Fleet Step", "Illusory Disguise"]);
    expect(steps[5]?.spellChoice?.curriculumSpellNames).toEqual(["Invisibility", "Mist"]);
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

  it("reduces Battle Creed initial prepared spells to one from draft or existing class-feature state", async () => {
    const drafted = createEmptyDraft(1);
    drafted.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";
    const shared = {
      currentLevel: 1,
      effectiveClassDocument: clericClassDocument(),
      effectiveSchoolDocument: null,
      effectiveDeityDocument: null,
      targetLevel: 1,
      extractSlug,
      readExistingSpellChoiceSelections: () => [],
    };

    const [draftSteps, existingSteps] = await Promise.all([
      buildSpellChoiceSteps({ ...shared, draft: drafted }),
      buildSpellChoiceSteps({
        ...shared,
        draft: createEmptyDraft(1),
        effectiveClassFeatureDocuments: [{ name: "Battle Creed", system: { slug: "battle-creed" } }],
      }),
    ]);

    for (const steps of [draftSteps, existingSteps]) {
      expect(steps.find((step) => step.slotId === "spell-choice-cleric-cantrips-level-1")?.spellChoice?.count).toBe(5);
      expect(steps.find((step) => step.slotId === "spell-choice-cleric-rank-1-level-1")).toMatchObject({
        title: "Battle harbinger prepared spell",
        spellChoice: { count: 1 },
      });
    }
  });

  it("builds bard spontaneous repertoire steps through level 5", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(5),
      currentLevel: 1,
      effectiveClassDocument: {
        system: {
          slug: "bard",
          items: {
            spellcasting: {
              name: "Occult Spellcasting",
              uuid: "Compendium.pf2e.classfeatures.Item.occult-spellcasting",
            },
          },
        },
      },
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      targetLevel: 5,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-bard-cantrips-level-1",
      "spell-choice-bard-repertoire-rank-1-level-1",
      "spell-choice-bard-repertoire-rank-1-level-2",
      "spell-choice-bard-repertoire-rank-2-level-3",
      "spell-choice-bard-repertoire-rank-2-level-4",
      "spell-choice-bard-repertoire-rank-3-level-5",
    ]);
    expect(steps[0]?.spellChoice).toMatchObject({
      count: 5,
      cantrip: true,
      destination: {
        key: "bard-occult-spontaneous",
        tradition: "occult",
        ability: "cha",
        prepared: "spontaneous",
      },
    });
    expect(steps[1]?.spellChoice).toMatchObject({
      count: 2,
      minRank: 1,
      maxRank: 1,
    });
    expect(steps[3]?.spellChoice).toMatchObject({
      count: 2,
      minRank: 2,
      maxRank: 2,
    });
  });

  it("builds prepared caster starting spell steps for druid", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(5),
      currentLevel: 1,
      effectiveClassDocument: classDocument("druid", "Druid Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      targetLevel: 5,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-druid-cantrips-level-1",
      "spell-choice-druid-rank-1-level-1",
    ]);
    expect(steps[0]?.spellChoice).toMatchObject({
      count: 5,
      destination: {
        key: "druid-primal-prepared",
        tradition: "primal",
        ability: "wis",
        prepared: "prepared",
      },
    });
    expect(steps[1]?.spellChoice).toMatchObject({
      count: 2,
      minRank: 1,
      maxRank: 1,
    });
  });

  it("builds limited animist prepared spell steps without apparition slots", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(5),
      currentLevel: 1,
      effectiveClassDocument: classDocument("animist", "Animist & Apparition Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      targetLevel: 5,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-animist-cantrips-level-1",
      "spell-choice-animist-rank-1-level-1",
    ]);
    expect(steps[0]?.spellChoice).toMatchObject({
      count: 2,
      destination: {
        key: "animist-divine-prepared",
        tradition: "divine",
        ability: "wis",
        prepared: "prepared",
      },
    });
    expect(steps[1]?.spellChoice).toMatchObject({
      count: 1,
      minRank: 1,
      maxRank: 1,
    });
  });

  it("builds branch-derived witch familiar-known spell steps", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(5),
      currentLevel: 1,
      effectiveClassDocument: classDocument("witch", "Witch Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Spinner of Threads", "witch-patron", "Spell List", "occult", ["Sure Strike"]),
      ],
      targetLevel: 5,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-witch-cantrips-level-1",
      "spell-choice-witch-rank-1-level-1",
      "spell-choice-witch-patron-lesson-level-1",
      "spell-choice-witch-familiar-level-2",
      "spell-choice-witch-familiar-level-3",
      "spell-choice-witch-familiar-level-4",
      "spell-choice-witch-familiar-level-5",
    ]);
    expect(steps[0]).toMatchObject({
      title: "Witch familiar cantrips",
      description: "Choose the 10 occult cantrips your familiar begins knowing.",
      spellChoice: {
        count: 10,
        destination: {
          key: "witch-occult-prepared",
          type: "spellbook",
          label: "Witch familiar spells",
          tradition: "occult",
          ability: "int",
          prepared: "prepared",
        },
      },
    });
    expect(steps[1]).toMatchObject({
      title: "Witch familiar spells",
      description: "Choose the five 1st-rank occult spells your familiar begins knowing.",
      spellChoice: {
        count: 5,
        destination: { type: "spellbook" },
      },
    });
    expect(steps[2]).toMatchObject({
      title: "Patron initial-lesson spell",
      description: "Add the additional 1st-rank spell your familiar learns from your patron's initial lesson.",
      spellChoice: {
        count: 1,
        curriculumSpellNames: ["Sure Strike"],
        additionalAllowedSpellUuids: ["Compendium.pf2e.spells-srd.Item.Sure Strike"],
        destination: { type: "spellbook" },
      },
    });
  });

  it("guides patron initial-lesson spell choices encoded in PF2E patron data", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: classDocument("witch", "Witch Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Wilding Steward", "witch-patron", "Spell List", "primal", [
          "Summon Animal",
          "Summon Plant or Fungus",
        ]),
      ],
      targetLevel: 1,
      extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.find((step) => step.slotId === "spell-choice-witch-patron-lesson-level-1")?.spellChoice).toMatchObject(
      {
        count: 1,
        curriculumSpellNames: ["Summon Animal", "Summon Plant or Fungus"],
        additionalAllowedSpellUuids: [
          "Compendium.pf2e.spells-srd.Item.Summon Animal",
          "Compendium.pf2e.spells-srd.Item.Summon Plant or Fungus",
        ],
      }
    );
  });

  it("builds two witch familiar spells per level with the current rank ceiling", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: classDocument("witch", "Witch Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Spinner of Threads", "witch-patron", "Spell List", "occult", ["Sure Strike"]),
      ],
      targetLevel: 3,
      extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-witch-cantrips-level-1",
      "spell-choice-witch-rank-1-level-1",
      "spell-choice-witch-patron-lesson-level-1",
      "spell-choice-witch-familiar-level-2",
      "spell-choice-witch-familiar-level-3",
    ]);
    expect(steps.find((step) => step.slotId === "spell-choice-witch-familiar-level-2")?.spellChoice).toMatchObject({
      count: 2,
      minRank: 1,
      maxRank: 1,
      reuseExistingEntryOnly: true,
      destination: {
        key: "witch-occult-prepared",
        type: "spellbook",
      },
    });
    expect(steps.find((step) => step.slotId === "spell-choice-witch-familiar-level-3")?.spellChoice).toMatchObject({
      count: 2,
      minRank: 1,
      maxRank: 2,
      reuseExistingEntryOnly: true,
      destination: {
        key: "witch-occult-prepared",
        type: "spellbook",
      },
    });
  });

  it("discloses the witch historical cutoff without scheduling historical spell steps", async () => {
    const effectiveClassDocument = classDocument("witch", "Witch Spellcasting");
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 3,
      effectiveClassDocument,
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Spinner of Threads", "witch-patron", "Spell List", "occult", ["Sure Strike"]),
      ],
      targetLevel: 3,
      extractSlug,
      readExistingSpellChoiceSelections: (choice) =>
        Array.from({ length: choice.count }, (_, index) =>
          selection(choice.slotId, `existing-${choice.slotId}-${index}`, `Existing ${index}`)
        ),
    });
    const planningNote = buildHistoricalSpellChoicePlanningNote({
      currentLevel: 3,
      effectiveClassDocument,
      extractSlug,
    });

    expect(steps).toEqual([]);
    expect(planningNote).toBe(
      "Spell choices for levels up to 3 aren't re-planned for existing characters. Spells already on the sheet are treated as complete — review them there."
    );
  });

  it("suppresses fulfilled witch familiar steps on rerun", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 1,
      effectiveClassDocument: classDocument("witch", "Witch Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Spinner of Threads", "witch-patron", "Spell List", "occult", ["Sure Strike"]),
      ],
      targetLevel: 3,
      extractSlug,
      readExistingSpellChoiceSelections: (choice) =>
        Array.from({ length: choice.count }, (_, index) =>
          selection(choice.slotId, `fulfilled-${choice.slotId}-${index}`, `Fulfilled ${index}`)
        ),
    });

    expect(steps).toEqual([]);
  });

  it("suppresses all level-1 witch choices when the familiar's known spells are already on the entry", async () => {
    const entryId = "witch-entry";
    const actor = {
      items: {
        contents: [
          {
            id: entryId,
            type: "spellcastingEntry",
            name: "Occult Prepared Spells",
            system: {
              ability: { value: "int" },
              prepared: { value: "prepared" },
              tradition: { value: "occult" },
            },
          },
          ...Array.from({ length: 10 }, (_, index) => knownWitchSpell(entryId, `Cantrip ${index + 1}`, true)),
          ...Array.from({ length: 5 }, (_, index) => knownWitchSpell(entryId, `Rank One ${index + 1}`, false)),
          knownWitchSpell(entryId, "Sure Strike", false),
        ],
      },
    };
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(1),
      currentLevel: 1,
      effectiveClassDocument: classDocument("witch", "Witch Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Spinner of Threads", "witch-patron", "Spell List", "occult", ["Sure Strike"]),
      ],
      targetLevel: 1,
      extractSlug,
      readExistingSpellChoiceSelections: (choice) => readExistingSpellChoiceSelections(actor, choice),
    });

    expect(steps).toEqual([]);
  });

  it("builds branch-derived sorcerer spontaneous repertoire steps", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(5),
      currentLevel: 1,
      effectiveClassDocument: classDocument("sorcerer", "Sorcerer Spellcasting"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Bloodline: Imperial", "sorcerer-bloodline", "Tradition", "arcane"),
      ],
      targetLevel: 5,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId).slice(0, 2)).toEqual([
      "spell-choice-sorcerer-cantrips-level-1",
      "spell-choice-sorcerer-repertoire-rank-1-level-1",
    ]);
    expect(steps[0]?.spellChoice?.destination).toMatchObject({
      key: "sorcerer-arcane-spontaneous",
      tradition: "arcane",
      ability: "cha",
      prepared: "spontaneous",
    });
  });

  it("discloses the spontaneous-caster historical cutoff", async () => {
    const effectiveClassDocument = classDocument("sorcerer", "Sorcerer Spellcasting");
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(3),
      currentLevel: 3,
      effectiveClassDocument,
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [
        classFeatureDocument("Bloodline: Imperial", "sorcerer-bloodline", "Tradition", "arcane"),
      ],
      targetLevel: 3,
      extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });
    const planningNote = buildHistoricalSpellChoicePlanningNote({
      currentLevel: 3,
      effectiveClassDocument,
      extractSlug,
    });

    expect(steps.map((step) => step.level).filter((level) => level > 1)).toEqual([]);
    expect(planningNote).toContain("Spell choices for levels up to 3 aren't re-planned");
  });

  it("builds magus bounded spellbook steps through level 5", async () => {
    const steps = await buildSpellChoiceSteps({
      draft: createEmptyDraft(5),
      currentLevel: 1,
      effectiveClassDocument: classDocument("magus", "Arcane Spellcasting (Magus)"),
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      targetLevel: 5,
      extractSlug: extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-magus-cantrips-level-1",
      "spell-choice-magus-spellbook-rank-1-level-1",
      "spell-choice-magus-spellbook-level-2",
      "spell-choice-magus-spellbook-level-3",
      "spell-choice-magus-spellbook-level-4",
      "spell-choice-magus-spellbook-level-5",
    ]);
    expect(steps[0]?.spellChoice).toMatchObject({
      count: 8,
      destination: {
        key: "magus-arcane-prepared",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
    });
    expect(steps[1]?.spellChoice).toMatchObject({
      count: 4,
      minRank: 1,
      maxRank: 1,
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

function classDocument(slug: string, spellcastingName: string) {
  return {
    system: {
      slug,
      items: {
        spellcasting: {
          name: spellcastingName,
          uuid: `Compendium.pf2e.classfeatures.Item.${spellcastingName}`,
        },
      },
    },
  };
}

function classFeatureDocument(
  name: string,
  otherTag: string,
  traditionLabel: string,
  tradition: string,
  lessonSpellNames: string[] = []
) {
  const lesson =
    lessonSpellNames.length > 0
      ? `<p><strong>Initial Lesson</strong> Your familiar learns ${
          lessonSpellNames.length > 1 ? "your choice of " : ""
        }${lessonSpellNames
          .map((spellName) => `@UUID[Compendium.pf2e.spells-srd.Item.${spellName}]`)
          .join(" or ")}.</p>`
      : "";
  return {
    name,
    system: {
      traits: {
        otherTags: [otherTag],
      },
      description: {
        value: `<p><strong>${traditionLabel}</strong> ${tradition}</p>${lesson}`,
      },
    },
  };
}

function knownWitchSpell(entryId: string, name: string, cantrip: boolean) {
  return {
    id: `${entryId}-${name}`,
    type: "spell",
    name,
    sourceId: `Compendium.pf2e.spells-srd.Item.${name}`,
    system: {
      level: { value: 1 },
      location: { value: entryId },
      traits: {
        rarity: "common",
        traditions: ["occult"],
        value: cantrip ? ["cantrip"] : [],
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
