import { afterEach, describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import {
  buildClassBranchStepsFromRules,
  buildClassChoiceStepsFromFeatureSources,
  buildClassChoiceStepsFromRules,
  buildClassGrantedItemStepsFromRules,
  buildClassTrainingStepsFromRules,
} from "../src/wayfinder/class-choice/step-builders";

const testGlobals = globalThis as typeof globalThis & { CONFIG?: any };
const classSelection = selection("class-level-1", "class", "class-document", "Class");

describe("wayfinder class-choice step-builders", () => {
  afterEach(() => {
    delete testGlobals.CONFIG;
  });

  it("builds training steps from class rules without actor reads", async () => {
    const rogueClass = {
      name: "Rogue",
      system: {
        slug: "rogue",
        trainedSkills: {
          additional: 2,
          value: ["athletics"],
        },
        rules: [
          {
            key: "ChoiceSet",
            flag: "classSkill",
            prompt: "Choose a class skill",
            choices: [
              { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
              { value: "stealth", label: "PF2E.Skill.Stealth" },
            ],
          },
        ],
        items: {
          selector: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.racket-selector",
            name: "Rogue's Racket",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
      [
        "Compendium.pf2e.classfeatures.Item.racket-selector",
        {
          type: "feat",
          name: "Rogue's Racket",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "roguesRacket",
                choices: {
                  filter: ["item:tag:rogue-racket"],
                },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.roguesRacket}",
              },
            ],
          },
        },
      ],
    ]);

    const trainingSteps = buildClassTrainingStepsFromRules({
      effectiveClassDocument: rogueClass,
      classSelection,
      extractSlug: slugFromDocument,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      intelligenceModifier: 3,
    });
    const branchSteps = await buildClassBranchStepsFromRules({
      effectiveClassDocument: rogueClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
    });

    expect(trainingSteps).toMatchObject([
      {
        kind: "skill-training",
        slotId: "skill-training-rogue-level-1",
        training: {
          classSlug: "rogue",
          className: "Rogue",
          fixedSkills: ["athletics"],
          additionalCount: 5,
          choiceRules: [
            {
              flag: "classSkill",
              options: [
                { slug: "acrobatics", label: "Acrobatics" },
                { slug: "stealth", label: "Stealth" },
              ],
            },
          ],
        },
      },
    ]);
    expect(branchSteps).toMatchObject([
      {
        kind: "class-branch",
        slotId: "class-branch-rogue-s-racket-level-1",
        branch: {
          selectorName: "Rogue's Racket",
          flag: "roguesRacket",
          optionTag: "rogue-racket",
          classSlug: "rogue",
        },
      },
    ]);
  });

  it("keeps configured world skills in training rules", async () => {
    testGlobals.CONFIG = {
      PF2E: {
        skills: {
          acrobatics: { label: "PF2E.Skill.Acrobatics" },
          sailing: { label: "World.Skill.Sailing" },
        },
      },
    };

    const steps = buildClassTrainingStepsFromRules({
      effectiveClassDocument: {
        name: "Swashbuckler",
        system: {
          slug: "swashbuckler",
          trainedSkills: {
            additional: 0,
            value: ["sailing"],
          },
          rules: [
            {
              key: "ChoiceSet",
              flag: "classSkill",
              prompt: "Choose a class skill",
              choices: [
                { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                { value: "sailing", label: "World.Skill.Sailing" },
              ],
            },
          ],
          items: {},
        },
      },
      classSelection,
      extractSlug: slugFromDocument,
      localize: (value) => value.replace(/^PF2E\.Skill\./, "").replace(/^World\.Skill\./, ""),
      intelligenceModifier: 0,
    });

    expect(steps).toMatchObject([
      {
        kind: "skill-training",
        training: {
          fixedSkills: ["sailing"],
          choiceRules: [
            {
              options: [
                { slug: "acrobatics", label: "Acrobatics" },
                { slug: "sailing", label: "Sailing" },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("builds one ordered branch step per item-backed ChoiceSet on the same class feature", async () => {
    const exemplarClass = {
      system: {
        slug: "exemplar",
        items: {
          ikons: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.divine-spark-and-ikons",
            name: "Divine Spark and Ikons",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
      [
        "Compendium.pf2e.classfeatures.Item.divine-spark-and-ikons",
        {
          type: "feat",
          name: "Divine Spark and Ikons",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "firstIkon",
                choices: { filter: ["item:tag:exemplar-ikon"] },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.firstIkon}",
              },
              {
                key: "ChoiceSet",
                flag: "secondIkon",
                choices: { filter: ["item:tag:exemplar-ikon"] },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.secondIkon}",
              },
            ],
          },
        },
      ],
    ]);

    const steps = await buildClassBranchStepsFromRules({
      effectiveClassDocument: exemplarClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "class-branch-divine-spark-and-ikons-firstIkon-level-1",
      "class-branch-divine-spark-and-ikons-secondIkon-level-1",
    ]);
    expect(steps.map((step) => step.branch?.flag)).toEqual(["firstIkon", "secondIkon"]);
    expect(steps[0]?.filters).toMatchObject({
      itemType: "feat",
      predicate: ["item:tag:exemplar-ikon"],
    });
  });

  it("builds deity grants and filters deity-dependent class choices by roll options", async () => {
    const clericClass = {
      system: {
        slug: "cleric",
        items: {
          deity: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
            name: "Deity",
          },
          font: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
            name: "Divine Font",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-cleric",
        {
          type: "feat",
          name: "Deity",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "deity",
                choices: {
                  itemType: "deity",
                  filter: [{ or: ["item:category:deity", "item:category:pantheon"] }],
                },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.deity}",
              },
              {
                key: "ChoiceSet",
                flag: "sanctification",
                choices: [
                  {
                    value: "holy",
                    label: "Holy",
                    predicate: "deity:primary:sanctification:can:holy",
                  },
                  {
                    value: "unholy",
                    label: "Unholy",
                    predicate: "deity:primary:sanctification:can:unholy",
                  },
                ],
              },
            ],
          },
        },
      ],
      [
        "Compendium.pf2e.classfeatures.Item.divine-font",
        {
          type: "feat",
          name: "Divine Font",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "divineFont",
                choices: [
                  {
                    value: "heal",
                    label: "Heal",
                    predicate: "deity:primary:font:heal",
                  },
                  {
                    value: "harm",
                    label: "Harm",
                    predicate: "deity:primary:font:harm",
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);
    const deityDocument = {
      system: {
        font: ["heal"],
        sanctification: null,
      },
    };

    const grantSteps = await buildClassGrantedItemStepsFromRules({
      effectiveClassDocument: clericClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
    });
    const branchSteps = await buildClassBranchStepsFromRules({
      effectiveClassDocument: clericClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
    });
    const choiceSteps = await buildClassChoiceStepsFromRules({
      effectiveClassDocument: clericClass,
      effectiveDeityDocument: deityDocument,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
    });

    expect(grantSteps).toMatchObject([
      {
        kind: "pick-item",
        slotId: "deity-level-1",
        grantSelection: {
          flag: "deity",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
        },
      },
    ]);
    expect(branchSteps.some((step) => step.slotId === "class-branch-deity-level-1")).toBe(false);
    expect(choiceSteps).toMatchObject([
      {
        kind: "class-choice",
        slotId: "class-choice-divine-font-divineFont-level-1",
        classChoice: {
          flag: "divineFont",
          dependsOn: "deity",
          options: [{ value: "heal", label: "Heal" }],
        },
      },
    ]);
    expect(choiceSteps.some((step) => step.slotId === "class-choice-deity-sanctification-level-1")).toBe(false);
  });

  it("builds champion sanctification choices from the real predicate shape", async () => {
    const championClass = {
      system: {
        slug: "champion",
        items: {
          deity: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.deity-champion",
            name: "Deity (Champion)",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-champion",
        {
          type: "feat",
          name: "Deity (Champion)",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "deity",
                choices: {
                  itemType: "deity",
                },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.deity}",
              },
              {
                key: "ChoiceSet",
                slug: "sanctification",
                rollOption: "sanctification",
                choices: [
                  {
                    value: "holy",
                    label: "PF2E.TraitHoly",
                    predicate: [
                      { or: ["deity:primary:sanctification:can:holy", "deity:primary:sanctification:must:holy"] },
                    ],
                  },
                  {
                    value: "unholy",
                    label: "PF2E.TraitUnholy",
                    predicate: [
                      { or: ["deity:primary:sanctification:can:unholy", "deity:primary:sanctification:must:unholy"] },
                    ],
                  },
                  {
                    value: "none",
                    label: "PF2E.NoneOption",
                    predicate: [
                      { nor: ["deity:primary:sanctification:must:holy", "deity:primary:sanctification:must:unholy"] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);
    const deityDocument = {
      system: {
        sanctification: {
          modal: "can",
          what: ["holy", "unholy"],
        },
      },
    };

    const steps = await buildClassChoiceStepsFromRules({
      effectiveClassDocument: championClass,
      effectiveDeityDocument: deityDocument,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
    });

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "class-choice",
          slotId: "class-choice-deity-champion-sanctification-level-1",
          classChoice: expect.objectContaining({
            flag: "sanctification",
            classSlug: "champion",
            dependsOn: "deity",
            options: expect.arrayContaining([
              expect.objectContaining({ value: "holy", label: "PF2E.TraitHoly" }),
              expect.objectContaining({ value: "unholy", label: "PF2E.TraitUnholy" }),
              expect.objectContaining({ value: "none", label: "PF2E.NoneOption" }),
            ]),
          }),
        }),
      ])
    );
  });

  it("builds class feature choices from configured PF2E choice records", async () => {
    const previousConfig = (globalThis as { CONFIG?: unknown }).CONFIG;
    (globalThis as { CONFIG?: { PF2E?: Record<string, unknown> } }).CONFIG = {
      PF2E: {
        weaponGroups: {
          sword: "PF2E.WeaponGroupSword",
          axe: "PF2E.WeaponGroupAxe",
        },
      },
    };

    try {
      const fighterClass = {
        system: {
          slug: "fighter",
          items: {
            mastery: {
              level: 5,
              uuid: "Compendium.pf2e.classfeatures.Item.fighter-weapon-mastery",
              name: "Fighter Weapon Mastery",
            },
          },
        },
      };
      const documents = new Map<string, unknown>([
        [
          "Compendium.pf2e.classfeatures.Item.fighter-weapon-mastery",
          {
            type: "feat",
            name: "Fighter Weapon Mastery",
            system: {
              category: "classfeature",
              level: { value: 5 },
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "fighterWeaponMastery",
                  choices: "weaponGroups",
                },
              ],
            },
          },
        ],
      ]);

      const steps = await buildClassChoiceStepsFromRules({
        effectiveClassDocument: fighterClass,
        effectiveDeityDocument: null,
        targetLevel: 5,
        fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
        extractSlug: slugFromDocument,
        localize: (value) => (value === "PF2E.WeaponGroupSword" ? "Sword" : value),
      });

      expect(steps).toEqual([
        expect.objectContaining({
          kind: "class-choice",
          level: 5,
          slotId: "class-choice-fighter-weapon-mastery-fighterWeaponMastery-level-5",
          classChoice: expect.objectContaining({
            flag: "fighterWeaponMastery",
            options: [
              { value: "sword", label: "Sword", img: null, detail: null },
              { value: "axe", label: "PF2E.WeaponGroupAxe", img: null, detail: null },
            ],
          }),
        }),
      ]);
    } finally {
      (globalThis as { CONFIG?: unknown }).CONFIG = previousConfig;
    }
  });

  it("filters same-item class choice options from earlier ChoiceSet roll options", () => {
    const feature = {
      level: 1,
      selection: {
        slotId: "class-branch-instinct-level-1",
        packId: "pf2e.classfeatures",
        documentId: "elemental-instinct",
        uuid: "Compendium.pf2e.classfeatures.Item.0jSS6pgNXsC8k4o7",
        itemType: "feat",
        featType: "classfeature",
        name: "Elemental Instinct",
        level: null,
      },
      document: elementalInstinctDocument(),
    };
    const elementSlotId = "class-choice-elemental-instinct-elementalInstinctElement-level-1";
    const damageSlotId = "class-choice-elemental-instinct-elementalInstinctDamage-level-1";

    const initialSteps = buildClassChoiceStepsFromFeatureSources({
      classSlug: "barbarian",
      effectiveDeityDocument: null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
      classFeatures: [feature],
    });
    const selectedSteps = buildClassChoiceStepsFromFeatureSources({
      classSlug: "barbarian",
      effectiveDeityDocument: null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
      selectedValuesBySlotId: {
        [elementSlotId]: "water",
      },
      classFeatures: [feature],
    });
    const existingSteps = buildClassChoiceStepsFromFeatureSources({
      classSlug: "barbarian",
      effectiveDeityDocument: null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
      classFeatures: [
        {
          ...feature,
          existingRulesSelections: {
            elementalInstinctElement: "air",
          },
        },
      ],
    });

    expect(initialSteps.map((step) => step.slotId)).toEqual([elementSlotId]);
    expect(selectedSteps.map((step) => step.slotId)).toEqual([elementSlotId, damageSlotId]);
    expect(selectedSteps.find((step) => step.slotId === damageSlotId)?.classChoice).toMatchObject({
      flag: "elementalInstinctDamage",
      dependsOnChoices: [
        {
          sourceUuid: "Compendium.pf2e.classfeatures.Item.0jSS6pgNXsC8k4o7",
          flag: "elementalInstinctElement",
        },
      ],
      options: [
        { value: "bludgeoning", label: "PF2E.TraitBludgeoning", img: null, detail: null },
        { value: "cold", label: "PF2E.TraitCold", img: null, detail: null },
      ],
    });
    expect(existingSteps.find((step) => step.slotId === damageSlotId)?.classChoice.options).toEqual([
      { value: "electricity", label: "PF2E.TraitElectricity", img: null, detail: null },
      { value: "slashing", label: "PF2E.TraitSlashing", img: null, detail: null },
    ]);
  });

  it("builds class-choice steps from static class-feature grants selected by a branch", () => {
    const steps = buildClassChoiceStepsFromFeatureSources({
      classSlug: "thaumaturge",
      effectiveDeityDocument: null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
      classFeatures: [
        {
          level: 1,
          selection: {
            slotId: "static-classfeature-grant-Initiate Benefit (Wand)",
            packId: "pf2e.classfeatures",
            documentId: "Initiate Benefit (Wand)",
            uuid: "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
            itemType: "feat",
            featType: "classfeature",
            name: "Initiate Benefit (Wand)",
            level: null,
          },
          document: {
            type: "feat",
            name: "Initiate Benefit (Wand)",
            system: {
              slug: "initiate-benefit-wand",
              category: "classfeature",
              level: { value: 1 },
              rules: [
                {
                  key: "ChoiceSet",
                  rollOption: "wand-initiate-damage-type",
                  choices: [
                    { label: "Cold", value: "cold" },
                    { label: "Electricity", value: "electricity" },
                    { label: "Fire", value: "fire" },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        kind: "class-choice",
        slotId: "class-choice-initiate-benefit-wand-initiateBenefitWand-level-1",
        classChoice: expect.objectContaining({
          sourceUuid: "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
          flag: "initiateBenefitWand",
          options: [
            { value: "cold", label: "Cold", img: null, detail: null },
            { value: "electricity", label: "Electricity", img: null, detail: null },
            { value: "fire", label: "Fire", img: null, detail: null },
          ],
        }),
      }),
    ]);
  });
});

function elementalInstinctDocument(): unknown {
  return {
    type: "feat",
    name: "Elemental Instinct",
    system: {
      slug: "elemental-instinct",
      category: "classfeature",
      level: { value: 1 },
      rules: [
        {
          actorFlag: true,
          choices: [
            { label: "PF2E.TraitAir", value: "air" },
            { label: "PF2E.TraitEarth", value: "earth" },
            { label: "PF2E.TraitFire", value: "fire" },
            { label: "PF2E.TraitMetal", value: "metal" },
            { label: "PF2E.TraitWater", value: "water" },
            { label: "PF2E.TraitWood", value: "wood" },
          ],
          flag: "elementalInstinctElement",
          key: "ChoiceSet",
          prompt: "PF2E.SpecificRule.Prompt.Element",
          rollOption: "elemental-instinct",
        },
        {
          actorFlag: true,
          adjustName: false,
          choices: [
            {
              label: "PF2E.TraitBludgeoning",
              predicate: [{ or: ["elemental-instinct:earth", "elemental-instinct:water", "elemental-instinct:wood"] }],
              value: "bludgeoning",
            },
            {
              label: "PF2E.TraitCold",
              predicate: ["elemental-instinct:water"],
              value: "cold",
            },
            {
              label: "PF2E.TraitElectricity",
              predicate: ["elemental-instinct:air"],
              value: "electricity",
            },
            {
              label: "PF2E.TraitFire",
              predicate: ["elemental-instinct:fire"],
              value: "fire",
            },
            {
              label: "PF2E.TraitPiercing",
              predicate: [{ or: ["elemental-instinct:earth", "elemental-instinct:metal", "elemental-instinct:wood"] }],
              value: "piercing",
            },
            {
              label: "PF2E.TraitSlashing",
              predicate: [{ or: ["elemental-instinct:air", "elemental-instinct:metal"] }],
              value: "slashing",
            },
          ],
          flag: "elementalInstinctDamage",
          key: "ChoiceSet",
          prompt: "PF2E.SpecificRule.Prompt.DamageType",
          rollOption: "elemental-instinct:damage",
        },
      ],
    },
  };
}

function slugFromDocument(document: unknown): string | null {
  const systemSlug = (document as { system?: { slug?: unknown } } | null | undefined)?.system?.slug;
  if (typeof systemSlug === "string" && systemSlug.trim()) {
    return systemSlug.trim();
  }

  const ancestrySlug = (document as { system?: { ancestry?: { slug?: unknown } } } | null | undefined)?.system?.ancestry
    ?.slug;
  if (typeof ancestrySlug === "string" && ancestrySlug.trim()) {
    return ancestrySlug.trim();
  }

  const name = (document as { name?: unknown } | null | undefined)?.name;
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || null
  );
}

function selection(slotId: string, itemType: string, documentId: string, name = documentId): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: null,
    name,
    level: 1,
  };
}
