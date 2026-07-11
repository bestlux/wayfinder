import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import { discoverSourceSkillTrainingMeta } from "../src/wayfinder/skill-training/source-discovery";

describe("wayfinder skill training source discovery", () => {
  it("discovers heritage skill ChoiceSets as persisted skill-training choices", () => {
    const globals = globalThis as typeof globalThis & {
      CONFIG?: {
        PF2E?: {
          skills?: Record<string, { label: string }>;
        };
      };
    };
    const originalConfig = globals.CONFIG;
    globals.CONFIG = {
      ...(originalConfig ?? {}),
      PF2E: {
        ...(originalConfig?.PF2E ?? {}),
        skills: {
          arcana: { label: "PF2E.Skill.Arcana" },
          society: { label: "PF2E.Skill.Society" },
        },
      },
    };

    try {
      const training = discoverSourceSkillTrainingMeta({
        sources: [
          {
            sourceItemType: "heritage",
            sourceSelection: selection("heritage-level-1", "skilled-human", "Skilled Human", "heritage"),
            sourceDocument: {
              name: "Skilled Human",
              system: {
                slug: "skilled-human",
                description: {
                  value: "<p>Your ingenuity allows you to train in one skill of your choice.</p>",
                },
                rules: [
                  {
                    key: "ChoiceSet",
                    flag: "trainedSkill",
                    choices: {
                      config: "skills",
                    },
                  },
                ],
              },
            },
          },
        ],
        localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      });

      expect(training.choiceRules).toHaveLength(1);
      expect(training.choiceRules).toMatchObject([
        {
          key: "heritage:skilled-human:trainedSkill",
          flag: "trainedSkill",
          sourceLabel: "Skilled Human",
          options: [
            { slug: "arcana", label: "Arcana" },
            { slug: "society", label: "Society" },
          ],
          persistence: {
            sourceItemType: "heritage",
            sourcePackId: "pf2e.heritages",
            sourceDocumentId: "skilled-human",
            sourceUuid: "Compendium.pf2e.heritages.Item.skilled-human",
            sourceRuleIndex: 0,
          },
        },
      ]);
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("discovers fixed feat-granted skills and lore from ancestry feats like Elven Lore", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("ancestry-feat-level-1", "elven-lore", "Elven Lore"),
          sourceDocument: {
            name: "Elven Lore",
            system: {
              slug: "elven-lore",
              description: {
                value:
                  "<p>You've studied traditional elven arts, learning about arcane magic and the world around you. You gain the trained proficiency rank in Arcana and Nature. If you would automatically become trained in one of those skills (from your background or class, for example), you instead become trained in a skill of your choice.</p><p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for Elf Lore.</p>",
              },
              rules: [
                {
                  key: "ActiveEffectLike",
                  mode: "upgrade",
                  path: "system.skills.arcana.rank",
                  value: 1,
                },
                {
                  key: "ActiveEffectLike",
                  mode: "upgrade",
                  path: "system.skills.nature.rank",
                  value: 1,
                },
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training).toMatchObject({
      fixedSkills: ["arcana", "nature"],
      fixedLores: ["Elf Lore"],
      choiceRules: [],
      loreChoices: [],
    });
  });

  it("does not turn fixed-skill conditional fallback text into an unconditional free skill choice", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "heritage",
          sourceSelection: selection("heritage-level-1", "wisp-fetchling", "Wisp Fetchling"),
          sourceDocument: {
            name: "Wisp Fetchling",
            system: {
              slug: "wisp-fetchling",
              description: {
                value:
                  "<p>You gain the trained proficiency rank in Acrobatics. If you would automatically become trained in Acrobatics (from your background or class, for example), you instead become trained in a skill of your choice.</p>",
              },
              rules: [
                {
                  key: "ActiveEffectLike",
                  mode: "upgrade",
                  path: "system.skills.acrobatics.rank",
                  value: 1,
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training).toMatchObject({
      fixedSkills: ["acrobatics"],
      choiceRules: [],
    });
  });

  it("normalizes explicit UUID labels when deriving Additional Lore grants", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("ancestry-feat-level-1", "elven-lore", "Elven Lore"),
          sourceDocument: {
            name: "Elven Lore",
            system: {
              slug: "elven-lore",
              description: {
                value:
                  "<p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore]{Additional Lore} general feat for Elf Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Elf Lore"]);
  });

  it("discovers multiple fixed lores from a single Additional Lore grant", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "viking-dedication", "Viking Dedication"),
          sourceDocument: {
            name: "Viking Dedication",
            system: {
              slug: "viking-dedication",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for Sailing Lore and Warfare Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Sailing Lore", "Warfare Lore"]);
  });

  it("discovers fixed Additional Lore grants expressed with 'in'", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "xenoarchaeologist", "Xenoarchaeologist"),
          sourceDocument: {
            name: "Xenoarchaeologist",
            system: {
              slug: "xenoarchaeologist",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.sf2e.feats.Item.Additional Lore]{ Additional Lore} general feat in Delve Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.sf2e.feats.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Delve Lore"]);
  });

  it("treats chosen-lore Additional Lore grants as lore choices, not fixed lore", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "gnome-obsession", "Gnome Obsession"),
          sourceDocument: {
            name: "Gnome Obsession",
            system: {
              slug: "gnome-obsession",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] feat and the @UUID[Compendium.pf2e.feats-srd.Item.Assurance] feat for the chosen Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Gnome Obsession",
        allowCustom: true,
        suggestions: [],
        placeholder: "Custom Lore",
      },
    ]);
  });

  it("treats partially open Additional Lore grants as lore choices", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "pirate-dedication", "Pirate Dedication"),
          sourceDocument: {
            name: "Pirate Dedication",
            system: {
              slug: "pirate-dedication",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for Sailing Lore or for a specific coastal city you have a connection to (such as Port Peril Lore).</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Pirate Dedication",
        allowCustom: true,
        suggestions: ["Sailing Lore"],
        placeholder: "Port Peril Lore",
      },
    ]);
  });

  it("treats lore subcategory Additional Lore grants as custom lore choices", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "nephilim-lore", "Nephilim Lore"),
          sourceDocument: {
            name: "Nephilim Lore",
            system: {
              slug: "nephilim-lore",
              description: {
                value:
                  "<p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for a Lore subcategory of a plane to which you trace your lineage.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Nephilim Lore",
        allowCustom: true,
      },
    ]);
  });

  it("discovers explicit lore subcategory labels after em dashes", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "heroic-scion", "Heroic Scion"),
          sourceDocument: {
            name: "Heroic Scion",
            system: {
              slug: "heroic-scion",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] feat for a special Lore skill subcategory—Incarnation Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Incarnation Lore"]);
  });

  it("treats the selected Additional Lore feat as a custom lore choice", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection(
            "grant-choice-none-feat-general-training-feat-level-1",
            "additional-lore",
            "Additional Lore"
          ),
          sourceDocument: {
            name: "Additional Lore",
            system: {
              slug: "additional-lore",
              description: {
                value:
                  "<p>Your knowledge has expanded to encompass a new field. Choose a Lore skill subcategory. You become trained in it.</p>",
              },
              rules: [],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Additional Lore",
        allowCustom: true,
        placeholder: "Custom Lore",
        suggestions: [],
      },
    ]);
  });

  it("discovers conditional multiclass dedication skill choices like Fighter Dedication", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection(
            "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
            "fighter-dedication"
          ),
          sourceDocument: {
            name: "Fighter Dedication",
            system: {
              slug: "fighter-dedication",
              description: {
                value:
                  "<p>You become trained in martial weapons. You become trained in your choice of Acrobatics or Athletics, if you are already trained in both skills, you instead become trained in another skill of your choice. You become trained in fighter class DC.</p>",
              },
              rules: [],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training.choiceRules).toMatchObject([
      {
        sourceLabel: "Fighter Dedication",
        prompt: "Choose Acrobatics or Athletics",
        options: [
          { slug: "acrobatics", label: "Acrobatics" },
          { slug: "athletics", label: "Athletics" },
        ],
        fallbackPrompt: "Choose a skill",
      },
    ]);
    expect(training.choiceRules[0]?.fallbackOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "acrobatics" }),
        expect.objectContaining({ slug: "athletics" }),
        expect.objectContaining({ slug: "arcana" }),
      ])
    );
  });

  it("prefers persisted rule choices for multiclass dedication skills when PF2E provides them", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection(
            "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
            "fighter-dedication"
          ),
          sourceDocument: {
            name: "Fighter Dedication",
            system: {
              slug: "fighter-dedication",
              description: {
                value:
                  "<p>You become trained in martial weapons. You become trained in your choice of Acrobatics or Athletics; if you are already trained in both of these skills, you instead become trained in a skill of your choice. You become trained in fighter class DC.</p>",
              },
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "skill",
                  prompt: "PF2E.SpecificRule.Prompt.Skill",
                  choices: [
                    { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                    { value: "athletics", label: "PF2E.Skill.Athletics" },
                  ],
                },
                {
                  key: "ActiveEffectLike",
                  mode: "upgrade",
                  path: "system.skills.{item|flags.system.rulesSelections.skill}.rank",
                  value: 1,
                },
              ],
            },
          },
        },
      ],
      localize: (value) =>
        value.replace("PF2E.SpecificRule.Prompt.Skill", "Select a skill.").replace(/^PF2E\.Skill\./, ""),
    });

    expect(training.choiceRules).toHaveLength(1);
    expect(training.choiceRules[0]).toMatchObject({
      key: "feat:fighter-dedication:skill",
      flag: "skill",
      sourceLabel: "Fighter Dedication",
      prompt: "Select a skill.",
      options: [
        { slug: "acrobatics", label: "Acrobatics" },
        { slug: "athletics", label: "Athletics" },
      ],
      persistence: {
        sourceItemType: "feat",
        sourcePackId: "pf2e.feats-srd",
        sourceDocumentId: "fighter-dedication",
        sourceUuid: "Compendium.pf2e.feats-srd.Item.fighter-dedication",
        sourceRuleIndex: 0,
      },
    });
    expect(training.choiceRules[0]?.fallbackPrompt).toBe("Choose a skill");
    expect(training.choiceRules[0]?.fallbackOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "acrobatics" }),
        expect.objectContaining({ slug: "athletics" }),
        expect.objectContaining({ slug: "arcana" }),
      ])
    );
  });

  it("discovers mixed specific and open multiclass dedication choices like Rogue Dedication", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("grant-choice-class-heritage-ancient-elf-ancientElf-level-1", "rogue-dedication"),
          sourceDocument: {
            name: "Rogue Dedication",
            system: {
              slug: "rogue-dedication",
              description: {
                value:
                  "<p>You become trained in Stealth or Thievery plus one skill of your choice; if you are already trained in both Stealth and Thievery, you become trained in an additional skill of your choice.</p>",
              },
              rules: [],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training.choiceRules).toHaveLength(2);
    expect(training.choiceRules[0]).toMatchObject({
      prompt: "Choose Stealth or Thievery",
      options: [
        { slug: "stealth", label: "Stealth" },
        { slug: "thievery", label: "Thievery" },
      ],
      fallbackPrompt: "Choose a skill",
    });
    expect(training.choiceRules[1]).toMatchObject({
      prompt: "Choose a skill",
    });
  });

  it("keeps mixed open dedication skill choices when the specific choice is rule-backed", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("grant-choice-class-heritage-ancient-elf-ancientElf-level-1", "rogue-dedication"),
          sourceDocument: {
            name: "Rogue Dedication",
            system: {
              slug: "rogue-dedication",
              description: {
                value:
                  "<p>You become trained in Stealth or Thievery plus one skill of your choice; if you are already trained in both Stealth and Thievery, you become trained in an additional skill of your choice.</p>",
              },
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "skill",
                  prompt: "Choose Stealth or Thievery",
                  choices: [
                    { value: "stealth", label: "Stealth" },
                    { value: "thievery", label: "Thievery" },
                  ],
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training.choiceRules).toHaveLength(2);
    expect(training.choiceRules[0]).toMatchObject({
      prompt: "Choose Stealth or Thievery",
      options: [
        { slug: "stealth", label: "Stealth" },
        { slug: "thievery", label: "Thievery" },
      ],
    });
    expect(training.choiceRules[1]).toMatchObject({
      prompt: "Choose a skill",
    });
  });

  it("discovers fixed-or-fallback multiclass dedication skill choices like Ranger Dedication", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("grant-choice-class-heritage-ancient-elf-ancientElf-level-1", "ranger-dedication"),
          sourceDocument: {
            name: "Ranger Dedication",
            system: {
              slug: "ranger-dedication",
              description: {
                value:
                  "<p>You become trained in Survival; if you were already trained in Survival, you instead become trained in another skill of your choice.</p>",
              },
              rules: [],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training.choiceRules).toMatchObject([
      {
        prompt: "Choose Survival",
        options: [{ slug: "survival", label: "Survival" }],
        fallbackPrompt: "Choose a skill",
      },
    ]);
  });
});

function selection(slotId: string, documentId: string, name = documentId, itemType = "feat"): SelectionRef {
  const packId = itemType === "heritage" ? "pf2e.heritages" : "pf2e.feats-srd";
  return {
    slotId,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "ancestry" : null,
    name,
    level: 1,
  };
}
