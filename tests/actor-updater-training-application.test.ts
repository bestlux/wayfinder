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
        fighterSkill: "athletics",
      },
      additional: ["crafting", "medicine", "society"],
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
      "system.skills.arcana.rank": 0,
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
      choiceRules: [
        {
          ruleIndex: 0,
          flag,
          prompt: "Choose a skill",
          options: [
            { slug: "acrobatics", label: "Acrobatics" },
            { slug: "athletics", label: "Athletics" },
          ],
        },
      ],
      additionalCount,
    },
  };
}
