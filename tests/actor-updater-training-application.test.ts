import { describe, expect, it, vi } from "vitest";
import { applySkillIncreaseDraft, applyTrainingDraft } from "../src/actor-updater/training-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";

describe("actor-updater training application", () => {
  it("writes class rule selections and projects trained skills from skill-training steps", async () => {
    const update = vi.fn(async () => ({}));
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: {
        skills: {
          acrobatics: { rank: 0 },
          athletics: { rank: 0 },
          crafting: { rank: 0 },
          medicine: { rank: 0 },
          society: { rank: 0 },
        },
      },
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "fighterSkill",
                  choices: [
                    { value: "acrobatics", label: "Acrobatics" },
                    { value: "athletics", label: "Athletics" },
                  ],
                },
                {
                  key: "ActiveEffectLike",
                  path: "system.skills.{item|flags.system.rulesSelections.fighterSkill}.rank",
                  value: 1,
                },
              ],
            },
          },
        ],
      },
      updateEmbeddedDocuments,
      update,
    };
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: {
        "class:fighterskill": "athletics",
      },
      additional: ["crafting", "medicine", "society"],
      loreChoices: {},
    };

    const projectedRanks = await applyTrainingDraft(actor, draft, [
      skillTrainingStep("skill-training-fighter-level-1", "fighter", "fighterSkill", 3),
    ]);

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "class-1",
        "flags.pf2e.rulesSelections.fighterSkill": "athletics",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "fighterSkill",
            choices: [
              { value: "acrobatics", label: "Acrobatics" },
              { value: "athletics", label: "Athletics" },
            ],
            selection: "athletics",
          },
          {
            key: "ActiveEffectLike",
            path: "system.skills.{item|flags.system.rulesSelections.fighterSkill}.rank",
            value: 1,
          },
        ],
      },
    ]);
    expect(update).toHaveBeenCalledWith({
      "system.skills.athletics.rank": 1,
      "system.skills.crafting.rank": 1,
      "system.skills.medicine.rank": 1,
      "system.skills.society.rank": 1,
    });
    expect(projectedRanks).toMatchObject({
      athletics: 1,
      crafting: 1,
      medicine: 1,
      society: 1,
    });
  });

  it("applies a non-persisted class training choice without mutating the class item", async () => {
    const update = vi.fn(async () => ({}));
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: {
        skills: {
          nature: { rank: 0 },
          occultism: { rank: 0 },
          religion: { rank: 0 },
        },
      },
      items: {
        contents: [{ id: "class-1", type: "class", system: { rules: [] } }],
      },
      updateEmbeddedDocuments,
      update,
    };
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-animist-level-1"] = {
      ruleChoices: {
        "class:animist:initial-skill": "nature",
      },
      additional: [],
      loreChoices: {},
    };
    const step: PendingStep = {
      id: "skill-training-animist-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Animist skill training",
      description: "",
      required: true,
      slotId: "skill-training-animist-level-1",
      training: {
        classSlug: "animist",
        className: "Animist",
        fixedSkills: ["religion"],
        fixedLores: [],
        choiceRules: [
          {
            key: "class:animist:initial-skill",
            flag: "initialSkill",
            prompt: "Choose Nature or Occultism",
            sourceLabel: "Animist",
            options: [
              { slug: "nature", label: "Nature" },
              { slug: "occultism", label: "Occultism" },
            ],
            persistence: null,
          },
        ],
        loreChoices: [],
        additionalCount: 0,
      },
    };

    const projectedRanks = await applyTrainingDraft(actor, draft, [step]);

    expect(updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      "system.skills.nature.rank": 1,
      "system.skills.religion.rank": 1,
    });
    expect(projectedRanks).toMatchObject({
      nature: 1,
      occultism: 0,
      religion: 1,
    });
  });

  it("applies drafted skill increases in level order and stacks repeated picks", async () => {
    const update = vi.fn(async () => ({}));
    const actor = {
      system: {
        skills: {
          acrobatics: { rank: 1 },
          arcana: { rank: 0 },
        },
      },
      update,
    };
    const draft = createEmptyDraft(5);
    draft.skillIncreases["skill-increase-level-3"] = "acrobatics";
    draft.skillIncreases["skill-increase-level-5"] = "acrobatics";

    await applySkillIncreaseDraft(actor, draft);

    expect(update).toHaveBeenCalledWith({
      "system.skills.acrobatics.rank": 3,
    });
  });

  it("projects singleton skill choices when the owning item rule grants a skill rank", async () => {
    const update = vi.fn(async () => ({}));
    const actor = {
      system: {
        skills: {
          arcana: { rank: 0 },
          society: { rank: 0 },
        },
      },
      items: {
        contents: [
          {
            id: "heritage-1",
            type: "heritage",
            sourceId: "Compendium.pf2e.heritages.Item.skilled-human",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.heritages.Item.skilled-human",
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "trainedSkill",
                  choices: {
                    config: "skills",
                  },
                },
                {
                  key: "ActiveEffectLike",
                  path: "system.skills.{item|flags.pf2e.rulesSelections.trainedSkill}.rank",
                  value: 1,
                },
              ],
            },
          },
        ],
      },
      update,
    };
    const draft = createEmptyDraft(3);
    draft.singletonChoices["singleton-choice-heritage-skilled-human-trainedSkill-level-1"] = "society";

    const projectedRanks = await applyTrainingDraft(actor, draft, [
      singletonSkillChoiceStep("singleton-choice-heritage-skilled-human-trainedSkill-level-1"),
    ]);

    expect(update).toHaveBeenCalledWith({
      "system.skills.society.rank": 1,
    });
    expect(projectedRanks).toMatchObject({
      society: 1,
      arcana: 0,
    });
  });

  it("does not project singleton choices that do not drive skill-rank rules", async () => {
    const update = vi.fn(async () => ({}));
    const actor = {
      system: {
        skills: {
          society: { rank: 0 },
        },
      },
      items: {
        contents: [
          {
            id: "background-1",
            type: "background",
            sourceId: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "academySkill",
                  choices: [{ value: "society", label: "Society" }],
                },
              ],
            },
          },
        ],
      },
      update,
    };
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-background-sponsored-by-family-academySkill-level-1"] = "society";

    const projectedRanks = await applyTrainingDraft(actor, draft, [
      singletonSkillChoiceStep(
        "singleton-choice-background-sponsored-by-family-academySkill-level-1",
        "background",
        "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
        "academySkill",
        [{ value: "society", label: "Society", img: null, detail: null }]
      ),
    ]);

    expect(update).not.toHaveBeenCalled();
    expect(projectedRanks).toMatchObject({
      society: 0,
    });
  });

  it("preserves earlier managed Lore when a later training plan omits its slot", async () => {
    const earlierLore = managedLore("guild-lore", "Guild Lore", "skill-training-cleric-level-1", "fixed:0");
    const deleteEmbeddedDocuments = vi.fn(async () => []);
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const createEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: { skills: {} },
      items: { contents: [earlierLore] },
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments,
      createEmbeddedDocuments,
    };

    await applyTrainingDraft(actor, createEmptyDraft(2), [
      loreTrainingStep("skill-training-battle-harbinger-dedication-level-2", []),
    ]);

    expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(earlierLore.system.proficient.value).toBe(1);
    expect(earlierLore.flags[MODULE_ID].slotId).toBe("skill-training-cleric-level-1");
  });

  it("removes obsolete managed Lore within an active slot even when that slot has no desired Lore", async () => {
    const slotId = "skill-training-cleric-level-1";
    const deleteEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: { skills: {} },
      items: { contents: [managedLore("guild-lore", "Guild Lore", slotId, "fixed:0")] },
      deleteEmbeddedDocuments,
    };

    await applyTrainingDraft(actor, createEmptyDraft(1), [loreTrainingStep(slotId, [])]);

    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["guild-lore"]);
  });

  it("reconciles obsolete Lore in an active slot while preserving Lore from an inactive slot", async () => {
    const activeSlotId = "skill-training-cleric-level-1";
    const deleteEmbeddedDocuments = vi.fn(async () => []);
    const createEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: { skills: {} },
      items: {
        contents: [
          managedLore("old-active-lore", "Guild Lore", activeSlotId, "retired-choice"),
          managedLore("earlier-lore", "Sailing Lore", "skill-training-earlier-level-1", "fixed:0"),
        ],
      },
      deleteEmbeddedDocuments,
      createEmbeddedDocuments,
    };

    await applyTrainingDraft(actor, createEmptyDraft(1), [loreTrainingStep(activeSlotId, ["Mining"])]);

    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["old-active-lore"]);
    expect(createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        name: "Mining Lore",
        flags: {
          [MODULE_ID]: { importedBy: MODULE_ID, slotId: activeSlotId, trainingKey: "fixed:0" },
        },
      }),
    ]);
  });
});

function managedLore(id: string, name: string, slotId: string, trainingKey: string) {
  return {
    id,
    type: "lore",
    name,
    system: { proficient: { value: 1 } },
    flags: { [MODULE_ID]: { importedBy: MODULE_ID, slotId, trainingKey } },
  };
}

function loreTrainingStep(slotId: string, fixedLores: string[]): PendingStep {
  return {
    id: slotId,
    level: slotId.endsWith("level-2") ? 2 : 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: "Training",
    description: "",
    required: true,
    slotId,
    training: {
      classSlug: "cleric",
      className: "Cleric",
      fixedSkills: [],
      fixedLores,
      choiceRules: [],
      loreChoices: [],
      additionalCount: 0,
    },
  };
}

function skillTrainingStep(slotId: string, classSlug: string, flag: string, additionalCount: number): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: "Training",
    description: "",
    required: true,
    slotId,
    training: {
      classSlug,
      className: classSlug,
      fixedSkills: [],
      fixedLores: [],
      choiceRules: [
        {
          key: `class:${flag.toLowerCase()}`,
          flag,
          prompt: "Choose a skill",
          sourceLabel: classSlug,
          options: [
            { slug: "acrobatics", label: "Acrobatics" },
            { slug: "athletics", label: "Athletics" },
          ],
          persistence: {
            sourceItemType: "class",
            sourcePackId: "test.pack",
            sourceDocumentId: classSlug,
            sourceUuid: `Compendium.test.pack.Item.${classSlug}`,
            sourceRuleIndex: 0,
          },
        },
      ],
      loreChoices: [],
      additionalCount,
    },
  };
}

function singletonSkillChoiceStep(
  slotId: string,
  sourceItemType: "ancestry" | "heritage" | "background" | "class" | "deity" = "heritage",
  sourceUuid = "Compendium.pf2e.heritages.Item.skilled-human",
  flag = "trainedSkill",
  options = [
    { value: "arcana", label: "Arcana", img: null, detail: null },
    { value: "society", label: "Society", img: null, detail: null },
  ]
): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "singleton-choice",
    slotKind: "singleton-choice",
    title: "Trained Skill",
    description: "",
    required: true,
    slotId,
    singletonChoice: {
      slotId,
      sourceItemType,
      sourcePackId: sourceItemType === "background" ? "pf2e.backgrounds" : "pf2e.heritages",
      sourceDocumentId: sourceItemType === "background" ? "sponsored-by-family" : "skilled-human",
      sourceUuid,
      sourceName: sourceItemType === "background" ? "Sponsored by Family" : "Skilled Human",
      sourceRuleIndex: 0,
      flag,
      prompt: "Choose a skill",
      predicate: [],
      rollOption: null,
      options,
    },
  };
}
