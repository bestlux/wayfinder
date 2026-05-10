import { afterEach, describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import {
  buildClassBranchStepsFromRules,
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
});

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
