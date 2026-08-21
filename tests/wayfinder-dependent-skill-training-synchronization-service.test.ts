import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import { synchronizeDependentSkillTrainingChoices } from "../src/wayfinder/application/dependent-skill-training-synchronization-service";

describe("dependent skill-training synchronization", () => {
  it.each([
    {
      classSlug: "druid",
      className: "Druid",
      initialFixedSkills: ["nature", "religion", "acrobatics"],
      additionalCount: 4,
      drafted: ["survival", "medicine", "athletics", "diplomacy"],
      invalidated: "diplomacy",
    },
    {
      classSlug: "exemplar",
      className: "Exemplar",
      initialFixedSkills: ["religion"],
      additionalCount: 3,
      drafted: ["athletics", "diplomacy", "intimidation"],
      invalidated: "athletics",
    },
    {
      classSlug: "kineticist",
      className: "Kineticist",
      initialFixedSkills: ["nature", "religion"],
      additionalCount: 5,
      drafted: ["athletics", "crafting", "medicine", "survival", "acrobatics"],
      invalidated: "survival",
    },
  ])("removes the $className matrix pick made stale by a later source-derived fixed grant", async ({
    classSlug,
    className,
    initialFixedSkills,
    additionalCount,
    drafted,
    invalidated,
  }) => {
    const draft = createEmptyDraft(5);
    const step = trainingStep(classSlug, className, initialFixedSkills, additionalCount);
    draft.skillTrainings[step.slotId] = {
      additional: [...drafted],
      loreChoices: {},
      ruleChoices: {},
    };
    const recentlyInvalidatedStepIds = new Set<string>();

    await expect(
      synchronizeDependentSkillTrainingChoices({
        state: { draft, recentlyInvalidatedStepIds },
        steps: [step],
        baseSkillRanks: {},
        resolveDocument: async () => null,
        localize: (value) => value,
      })
    ).resolves.toBe(false);
    expect(draft.skillTrainings[step.slotId]?.additional).toEqual(drafted);

    step.training.fixedSkills.push(invalidated);
    await expect(
      synchronizeDependentSkillTrainingChoices({
        state: { draft, recentlyInvalidatedStepIds },
        steps: [step],
        baseSkillRanks: {},
        resolveDocument: async () => null,
        localize: (value) => value,
      })
    ).resolves.toBe(true);

    expect(draft.skillTrainings[step.slotId]?.additional).toEqual(drafted.filter((skill) => skill !== invalidated));
    expect(recentlyInvalidatedStepIds).toEqual(new Set([step.slotId]));
  });

  it("preserves a replacement choice after the refreshed plan removes the stale collision", async () => {
    const draft = createEmptyDraft(5);
    const step = trainingStep("druid", "Druid", ["nature", "religion", "acrobatics", "diplomacy"], 4);
    draft.skillTrainings[step.slotId] = {
      additional: ["survival", "medicine", "athletics", "deception"],
      loreChoices: {},
      ruleChoices: {},
    };

    await expect(
      synchronizeDependentSkillTrainingChoices({
        state: { draft, recentlyInvalidatedStepIds: new Set() },
        steps: [step],
        baseSkillRanks: {},
        resolveDocument: async () => null,
        localize: (value) => value,
      })
    ).resolves.toBe(false);
    expect(draft.skillTrainings[step.slotId]?.additional).toEqual(["survival", "medicine", "athletics", "deception"]);
  });
});

function trainingStep(
  classSlug: string,
  className: string,
  fixedSkills: string[],
  additionalCount: number
): PendingStep & { kind: "skill-training" } {
  const slotId = `skill-training-${classSlug}-level-1`;
  return {
    id: slotId,
    level: 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: `${className} skill training`,
    description: "",
    required: true,
    slotId,
    training: {
      classSlug,
      className,
      fixedSkills,
      fixedLores: [],
      choiceRules: [],
      loreChoices: [],
      additionalCount,
    },
  };
}
