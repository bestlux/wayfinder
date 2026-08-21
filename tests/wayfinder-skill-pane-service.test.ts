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
        "class:arcana": "arcana",
        "heritage:trainedSkill": "society",
        "background:academySkill": "nature",
      },
      ["stealth"]
    );
    draft.skillTrainings["skill-training-wizard-level-7"] = trainingDraft({}, ["society"]);
    draft.skillIncreases["skill-increase-level-2"] = "arcana";
    draft.skillIncreases["skill-increase-level-6"] = "nature";
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
      const projected = await projectSkillRanks(draft, "skill-training-wizard-level-7", {
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
        arcana: 2,
        nature: 2,
        society: 1,
      });
      expect(projected.stealth).toBe(1);
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("projects level-1 draft training into a level-3 skill increase", async () => {
    const draft = createEmptyDraft(3);
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft(
      {
        "class:arcana": "arcana",
      },
      ["stealth"]
    );

    const projected = await projectSkillRanks(draft, "skill-increase-level-3", {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      localize: (value) => value,
    });

    expect(projected).toMatchObject({
      arcana: 1,
      stealth: 1,
    });
  });

  it("projects fixed-only level-1 training into a level-3 skill increase", async () => {
    const draft = createEmptyDraft(5);
    draft.skillIncreases["skill-increase-level-3"] = "deception";
    const levelOneTraining: PendingStep = {
      id: "skill-training-intelligent-weapon-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Intelligent Weapon training",
      description: "",
      required: true,
      slotId: "skill-training-intelligent-weapon-level-1",
      training: {
        classSlug: "intelligent-weapon",
        className: "Intelligent Weapon",
        fixedSkills: ["deception", "acrobatics", "crafting"],
        fixedLores: [],
        choiceRules: [],
        loreChoices: [],
        additionalCount: 0,
      },
    };
    const levelThreeIncrease: PendingStep = {
      id: "skill-increase-level-3",
      level: 3,
      kind: "skill-increase",
      slotKind: "skill-increase",
      title: "Skill increase",
      description: "",
      required: true,
      slotId: "skill-increase-level-3",
    };
    const futureTraining: PendingStep = {
      ...levelOneTraining,
      id: "skill-training-intelligent-weapon-level-5",
      level: 5,
      slotId: "skill-training-intelligent-weapon-level-5",
      training: {
        ...levelOneTraining.training,
        fixedSkills: ["medicine"],
      },
    };
    const steps = [levelOneTraining, levelThreeIncrease, futureTraining];

    const projected = await projectSkillRanks(draft, levelThreeIncrease.slotId, {
      baseSkillRanks: {},
      steps,
      resolveDocument: async () => null,
      localize: (value) => value,
    });

    expect(projected).toMatchObject({
      acrobatics: 1,
      crafting: 1,
      deception: 1,
    });
    expect(projected.medicine).toBeUndefined();

    const pane = await buildSkillPane(levelThreeIncrease, draft, {
      baseSkillRanks: {},
      steps,
      resolveDocument: async () => null,
      configSkills: {
        acrobatics: { label: "Acrobatics" },
        crafting: { label: "Crafting" },
        deception: { label: "Deception" },
        medicine: { label: "Medicine" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => true,
    });

    expect(pane?.kind).toBe("skill-increase");
    if (!pane || pane.kind !== "skill-increase") {
      throw new Error("Expected a skill-increase pane");
    }
    expect(pane.selectedLabel).toBe("Deception → Expert");
    expect(pane.skills.find((entry) => entry.slug === "deception")).toMatchObject({
      currentRank: 1,
      currentRankCode: "T",
      targetRank: 2,
      targetRankCode: "E",
    });
  });

  it("keeps overridden unleveled training in bounded skill projections", async () => {
    const draft = createEmptyDraft(3);
    draft.skillTrainings["skill-training-legacy"] = trainingDraft(
      {
        "class:medicine": "medicine",
      },
      []
    );

    const projected = await projectSkillRanks(draft, "skill-increase-level-3", {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      localize: (value) => value,
    });

    expect(projected.medicine).toBe(1);
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
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft({ "class:arcana": "arcana" }, ["stealth"]);
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
        fixedLores: [],
        choiceRules: [
          {
            key: "class:arcana",
            flag: "arcana",
            prompt: "Choose a school skill",
            sourceLabel: "Wizard",
            options: [
              { slug: "arcana", label: "Arcana" },
              { slug: "nature", label: "Nature" },
            ],
            persistence: null,
          },
        ],
        loreChoices: [],
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

  it("adds stable rank, ability, and unavailable-state metadata only to rule-choice options", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: {
        "class:first": "arcana",
      },
      additional: [],
      loreChoices: {
        "class:lore": "Academia Lore",
      },
    };
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
        fixedSkills: [],
        fixedLores: [],
        choiceRules: [
          {
            key: "class:first",
            flag: "first",
            prompt: "Choose a tradition skill",
            sourceLabel: "Wizard",
            options: [
              { slug: "arcana", label: "Arcana" },
              { slug: "occultism", label: "Occultism" },
            ],
            persistence: null,
          },
          {
            key: "class:second",
            flag: "second",
            prompt: "Choose another skill",
            sourceLabel: "Wizard",
            options: [
              { slug: "arcana", label: "Arcana" },
              { slug: "nature", label: "Nature" },
              { slug: "stealth", label: "Stealth" },
            ],
            persistence: null,
          },
        ],
        loreChoices: [
          {
            key: "class:lore",
            flag: "lore",
            prompt: "Choose a lore",
            sourceLabel: "Wizard",
            placeholder: "Lore",
            allowCustom: true,
            suggestions: ["Academia Lore", "Scribing Lore"],
            persistence: null,
          },
        ],
        additionalCount: 0,
      },
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {
        nature: 1,
      },
      resolveDocument: async () => null,
      configSkills: {
        arcana: { label: "Arcana", attribute: "int" },
        nature: { label: "Nature", attribute: "wis" },
        occultism: { label: "Occultism", attribute: "int" },
        stealth: { label: "Stealth", attribute: "dex" },
        "academia-lore": { label: "Academia Lore" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => false,
    });

    expect(pane?.kind).toBe("skill-training");
    if (!pane || pane.kind !== "skill-training") {
      throw new Error("Expected a skill-training pane");
    }

    const options = pane.choiceSections[1]?.options ?? [];
    expect(options.map((option) => option.slug)).toEqual(["arcana", "nature", "stealth"]);
    expect(options.find((option) => option.slug === "nature")).toMatchObject({
      currentRank: 1,
      currentRankCode: "T",
      currentRankLabel: "Trained",
      keyAbility: "WIS",
      disabled: true,
      disabledReason: "Something else already trained you in this",
    });
    expect(options.find((option) => option.slug === "stealth")).toMatchObject({
      currentRank: 0,
      currentRankCode: "U",
      currentRankLabel: "Untrained",
      keyAbility: "DEX",
      disabled: false,
      disabledReason: null,
    });
    expect(options.find((option) => option.slug === "arcana")).toMatchObject({
      keyAbility: "INT",
      disabled: true,
      disabledReason: "You already picked this above",
    });
    expect(pane.choiceSections[1]?.unavailableLegend).toBe(
      "Greyed out because: You already picked this above; Something else already trained you in this"
    );
    expect(pane.loreSections[0]?.suggestions).toEqual([
      { value: "Academia Lore", selected: true },
      { value: "Scribing Lore", selected: false },
    ]);
    expect(pane.loreSections[0]?.suggestions[0]).not.toHaveProperty("currentRankCode");
    expect(pane.loreSections[0]?.suggestions[0]).not.toHaveProperty("keyAbility");
  });

  it("falls back to broad skill options when a conditional dedication choice's preferred skills are already trained", async () => {
    const draft = createEmptyDraft(1);
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
        fixedSkills: ["acrobatics", "athletics"],
        fixedLores: [],
        choiceRules: [
          {
            key: "feat:fighter-dedication:skill",
            flag: "feat:fighter-dedication:skill",
            prompt: "Choose Acrobatics or Athletics",
            sourceLabel: "Fighter Dedication",
            options: [
              { slug: "acrobatics", label: "Acrobatics" },
              { slug: "athletics", label: "Athletics" },
            ],
            fallbackPrompt: "Choose a skill",
            fallbackOptions: [
              { slug: "arcana", label: "Arcana" },
              { slug: "occultism", label: "Occultism" },
              { slug: "stealth", label: "Stealth" },
            ],
            persistence: null,
          },
        ],
        loreChoices: [],
        additionalCount: 0,
      },
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {
        acrobatics: 1,
        athletics: 1,
      },
      resolveDocument: async () => null,
      configSkills: {
        acrobatics: { label: "Acrobatics" },
        arcana: { label: "Arcana" },
        athletics: { label: "Athletics" },
        occultism: { label: "Occultism" },
        stealth: { label: "Stealth" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => false,
    });

    expect(pane?.kind).toBe("skill-training");
    if (!pane || pane.kind !== "skill-training") {
      throw new Error("Expected a skill-training pane");
    }

    expect(pane.choiceSections[0]?.prompt).toBe("Choose a skill");
    expect(pane.choiceSections[0]?.options.map((option) => option.slug)).toEqual(["arcana", "occultism", "stealth"]);
    expect(pane.additionalSkills).toEqual([]);

    draft.skillTrainings[step.slotId] = trainingDraft({ "feat:fighter-dedication:skill": "arcana" }, []);
    const staleFallbackPane = await buildSkillPane(step, draft, {
      baseSkillRanks: {
        acrobatics: 1,
        arcana: 1,
        athletics: 1,
      },
      resolveDocument: async () => null,
      configSkills: {
        acrobatics: { label: "Acrobatics" },
        arcana: { label: "Arcana" },
        athletics: { label: "Athletics" },
        occultism: { label: "Occultism" },
        stealth: { label: "Stealth" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => true,
    });
    expect(staleFallbackPane?.kind).toBe("skill-training");
    if (!staleFallbackPane || staleFallbackPane.kind !== "skill-training") {
      throw new Error("Expected a skill-training pane");
    }
    expect(staleFallbackPane.completed).toBe(false);
    expect(staleFallbackPane.choiceSections[0]?.selectedSlug).toBeNull();
    expect(staleFallbackPane.choiceSections[0]?.options.find((option) => option.slug === "arcana")).toMatchObject({
      selected: false,
      disabled: true,
    });
  });

  it("keeps conditional dedication choices narrow after selecting one preferred skill", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft(
      { "feat:fighter-dedication:skill": "athletics" },
      []
    );
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
        fixedSkills: [],
        fixedLores: [],
        choiceRules: [
          {
            key: "feat:fighter-dedication:skill",
            flag: "feat:fighter-dedication:skill",
            prompt: "Choose Acrobatics or Athletics",
            sourceLabel: "Fighter Dedication",
            options: [
              { slug: "acrobatics", label: "Acrobatics" },
              { slug: "athletics", label: "Athletics" },
            ],
            fallbackPrompt: "Choose a skill",
            fallbackOptions: [
              { slug: "acrobatics", label: "Acrobatics" },
              { slug: "arcana", label: "Arcana" },
              { slug: "athletics", label: "Athletics" },
              { slug: "occultism", label: "Occultism" },
              { slug: "stealth", label: "Stealth" },
            ],
            persistence: null,
          },
        ],
        loreChoices: [],
        additionalCount: 0,
      },
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      configSkills: {
        acrobatics: { label: "Acrobatics" },
        arcana: { label: "Arcana" },
        athletics: { label: "Athletics" },
        occultism: { label: "Occultism" },
        stealth: { label: "Stealth" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => false,
    });

    expect(pane?.kind).toBe("skill-training");
    if (!pane || pane.kind !== "skill-training") {
      throw new Error("Expected a skill-training pane");
    }

    expect(pane.choiceSections[0]?.prompt).toBe("Choose Acrobatics or Athletics");
    expect(pane.choiceSections[0]?.options.map((option) => option.slug)).toEqual(["acrobatics", "athletics"]);
    expect(pane.choiceSections[0]?.options.find((option) => option.slug === "athletics")?.selected).toBe(true);
  });

  it("does not keep a stale fallback selected after the preferred skill becomes available again", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = trainingDraft(
      { "feat:necromancer-dedication:skill": "arcana" },
      ["athletics"]
    );
    const step: PendingStep = {
      id: "skill-training-fighter-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Fighter training",
      description: "",
      required: true,
      slotId: "skill-training-fighter-level-1",
      training: {
        classSlug: "fighter",
        className: "Fighter",
        fixedSkills: [],
        fixedLores: [],
        choiceRules: [
          {
            key: "feat:necromancer-dedication:skill",
            flag: "feat:necromancer-dedication:skill",
            prompt: "Choose Occultism",
            sourceLabel: "Necromancer Dedication",
            options: [{ slug: "occultism", label: "Occultism" }],
            fallbackPrompt: "Choose a skill",
            fallbackOptions: [
              { slug: "arcana", label: "Arcana" },
              { slug: "occultism", label: "Occultism" },
              { slug: "stealth", label: "Stealth" },
            ],
            persistence: null,
          },
        ],
        loreChoices: [],
        additionalCount: 1,
      },
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: { occultism: 0 },
      resolveDocument: async () => null,
      configSkills: {
        arcana: { label: "Arcana" },
        athletics: { label: "Athletics" },
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
    expect(pane.completed).toBe(false);
    expect(pane.choiceSections[0]?.prompt).toBe("Choose Occultism");
    expect(pane.choiceSections[0]?.selectedSlug).toBeNull();
    expect(pane.choiceSections[0]?.options.map((option) => option.slug)).toEqual(["occultism"]);
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
    loreChoices: {},
  };
}
