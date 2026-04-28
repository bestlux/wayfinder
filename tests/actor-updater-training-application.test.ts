import { describe, expect, it, vi } from "vitest";
import { applySkillIncreaseDraft, applyTrainingDraft } from "../src/actor-updater/training-application";
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
});

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
