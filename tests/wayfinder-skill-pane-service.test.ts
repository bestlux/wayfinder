import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SkillTrainingDraft } from "../src/types";
import { buildSkillPane, projectSkillRanks } from "../src/wayfinder/application/build-skill-pane-service";

describe("wayfinder skill pane service", () => {
  it("projects fixed skills and prior draft choices before the active slot", async () => {
    const draft = createEmptyDraft(5);
    const globals = globalThis as typeof globalThis & {
      CONFIG?: {
        PF2E?: {
          skills?: Record<string, { label: string }>;
        };
      };
    };
    const originalConfig = globals.CONFIG;
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft(
      {
        arcana: "arcana",
      },
      ["stealth"]
    );
    draft.skillTrainings["skill-training-wizard-level-7"] = trainingDraft({}, ["society"]);
    draft.skillIncreases["skill-increase-level-2"] = "arcana";
    draft.skillIncreases["skill-increase-level-6"] = "nature";
    draft.singletonChoices["singleton-choice-heritage-skilled-human-trainedSkill-level-1"] = "society";
    draft.singletonChoices["singleton-choice-background-sponsored-by-family-academySkill-level-1"] = "nature";
    globals.CONFIG = {
      ...(originalConfig ?? {}),
      PF2E: {
        ...(originalConfig?.PF2E ?? {}),
        skills: {
          arcana: { label: "PF2E.Skill.Arcana" },
          athletics: { label: "PF2E.Skill.Athletics" },
          nature: { label: "PF2E.Skill.Nature" },
          occultism: { label: "PF2E.Skill.Occultism" },
          society: { label: "PF2E.Skill.Society" },
        },
      },
    };

    try {
      const projected = await projectSkillRanks(draft, "skill-increase-level-4", {
        baseSkillRanks: {
          acrobatics: 1,
        },
        resolveDocument: async (itemType) => {
          if (itemType === "heritage") {
            return {
              system: {
                slug: "skilled-human",
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
            };
          }
          if (itemType === "background") {
            return {
              system: {
                slug: "sponsored-by-family",
                trainedSkills: { value: ["athletics"] },
                rules: [
                  {
                    key: "ChoiceSet",
                    flag: "academySkill",
                    choices: [
                      { value: "nature", label: "PF2E.Skill.Nature" },
                      {
                        value: "Compendium.pf2e.classfeatures.Item.GenealogyLore",
                        label: "Genealogy Lore",
                      },
                    ],
                  },
                  {
                    key: "ActiveEffectLike",
                    path: "system.skills.{item|flags.pf2e.rulesSelections.academySkill}.rank",
                    value: 1,
                  },
                  {
                    key: "ChoiceSet",
                    flag: "familyLore",
                    choices: [
                      {
                        value: "Compendium.pf2e.classfeatures.Item.GenealogyLore",
                        label: "Genealogy Lore",
                      },
                    ],
                  },
                ],
              },
            };
          }
          if (itemType === "class") {
            return { system: { trainedSkills: { value: ["occultism"] } } };
          }
          return null;
        },
        localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      });

      expect(projected).toMatchObject({
        acrobatics: 1,
        athletics: 1,
        occultism: 1,
        arcana: 1,
        nature: 1,
        society: 1,
      });
      expect(projected.stealth).toBeUndefined();
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("does not project singleton skill selections without a matching rank-granting rule", async () => {
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-heritage-skilled-human-trainedSkill-level-1"] = "society";
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
          society: { label: "PF2E.Skill.Society" },
        },
      },
    };

    try {
      const projected = await projectSkillRanks(draft, "skill-increase-level-4", {
        baseSkillRanks: {},
        resolveDocument: async (itemType) => {
          if (itemType !== "heritage") {
            return null;
          }

          return {
            system: {
              slug: "skilled-human",
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
          };
        },
        localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      });

      expect(projected.society).toBeUndefined();
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("builds a skill-training pane with reserved skills removed from additional choices", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft({ arcana: "arcana" }, ["stealth"]);
    const step: PendingStep = {
      id: "skill-training-wizard-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Wizard training",
      description: "",
      required: true,
      slotId: "skill-training-wizard-level-1",
      training: {
        classSlug: "wizard",
        className: "Wizard",
        fixedSkills: ["occultism"],
        choiceRules: [
          {
            ruleIndex: 0,
            flag: "arcana",
            prompt: "Choose a school skill",
            options: [
              { slug: "arcana", label: "Arcana" },
              { slug: "nature", label: "Nature" },
            ],
          },
        ],
        additionalCount: 1,
      },
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      configSkills: {
        arcana: { label: "Arcana" },
        nature: { label: "Nature" },
        occultism: { label: "Occultism" },
        stealth: { label: "Stealth" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => true,
    });

    expect(pane?.kind).toBe("skill-training");
    if (!pane || pane.kind !== "skill-training") {
      throw new Error("Expected a skill-training pane");
    }
    expect(pane.completed).toBe(true);
    expect(pane.fixedSkills).toEqual(["Occultism"]);
    expect(pane.choiceSections[0]?.selectedLabel).toBe("Arcana");
    expect(pane.additionalSkills.map((entry) => entry.slug)).toEqual(["nature", "stealth"]);
  });

  it("builds a skill-increase pane with localized labels and level cap handling", async () => {
    const draft = createEmptyDraft(3);
    draft.skillIncreases["skill-increase-level-3"] = "arcana";
    const step: PendingStep = {
      id: "skill-increase-level-3",
      level: 3,
      kind: "skill-increase",
      slotKind: "skill-increase",
      title: "Skill increase",
      description: "",
      required: true,
      slotId: "skill-increase-level-3",
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      configSkills: {
        arcana: { label: "Arcana" },
        athletics: { label: "Athletics" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => false,
    });

    expect(pane?.kind).toBe("skill-increase");
    if (!pane || pane.kind !== "skill-increase") {
      throw new Error("Expected a skill-increase pane");
    }

    const arcana = pane.skills.find((entry) => entry.slug === "arcana");
    const athletics = pane.skills.find((entry) => entry.slug === "athletics");
    expect(pane.selectedLabel).toBe("Arcana → Trained");
    expect(arcana?.selected).toBe(true);
    expect(athletics?.disabled).toBe(false);
  });
});

function trainingDraft(ruleChoices: Record<string, string>, additional: string[]): SkillTrainingDraft {
  return {
    ruleChoices,
    additional,
  };
}
