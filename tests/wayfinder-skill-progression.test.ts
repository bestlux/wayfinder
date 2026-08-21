import { describe, expect, it, vi } from "vitest";
import { applyTrainingDraft, buildTrainingActorUpdate } from "../src/actor-updater/training-application";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SkillTrainingStep } from "../src/types";
import { buildSkillPane } from "../src/wayfinder/application/build-skill-pane-service";
import { compileSkillProgression } from "../src/wayfinder/domain/skill-progression";
import { evaluateWayfinderStep } from "../src/wayfinder/domain/step-evaluation";

const VALID_SKILLS = new Set([
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "medicine",
  "nature",
  "occultism",
  "society",
  "stealth",
]);

describe("Wayfinder skill progression", () => {
  it("uses active plan order for source grants, fixed training, drafted training, and increases", () => {
    const draft = createEmptyDraft(5);
    const levelOne = trainingStep("skill-training-fencer-level-1", 1, {
      fixedSkills: ["deception", "acrobatics", "crafting"],
      additionalCount: 1,
    });
    draft.skillTrainings[levelOne.slotId] = {
      ruleChoices: {},
      additional: ["athletics"],
      loreChoices: {},
    };
    draft.skillIncreases["skill-increase-level-3"] = "deception";
    draft.skillIncreases["skill-increase-level-4"] = "medicine";
    const levelFive = trainingStep("skill-training-fencer-level-5", 5, {
      fixedSkills: ["medicine"],
    });

    const progression = compileSkillProgression({
      baselineRanks: { arcana: 0 },
      sourceGrants: [{ slug: "arcana", rank: 1, sourceId: "background" }],
      draft,
      steps: [levelOne, increaseStep(3), increaseStep(4), levelFive],
      validSkillSlugs: VALID_SKILLS,
      mode: "editing",
    });

    expect(progression.stepsBySlotId["skill-increase-level-3"]?.ranksBefore).toMatchObject({
      acrobatics: 1,
      arcana: 1,
      athletics: 1,
      crafting: 1,
      deception: 1,
    });
    expect(progression.stepsBySlotId["skill-increase-level-4"]?.ranksBefore.medicine).toBeUndefined();
    expect(progression.finalRanks).toMatchObject({ deception: 2, medicine: 1 });
  });

  it("reports issues while producing a deterministic editing reconciliation", () => {
    const draft = createEmptyDraft(3);
    const step = trainingStep("skill-training-fencer-level-1", 1, {
      fixedSkills: ["deception"],
      choiceRules: [
        {
          key: "class:skill",
          flag: "skill",
          prompt: "Choose a skill",
          sourceLabel: "Fencer",
          options: [{ slug: "arcana", label: "Arcana" }],
          persistence: null,
        },
      ],
      additionalCount: 2,
    });
    draft.skillTrainings[step.slotId] = {
      ruleChoices: { "class:skill": "arcana", old: "stealth" },
      additional: ["deception", "arcana", "medicine", "medicine", "nature"],
      loreChoices: { old: "Phantom Lore" },
    };

    const progression = compileSkillProgression({
      baselineRanks: { medicine: 1 },
      draft,
      steps: [step],
      validSkillSlugs: VALID_SKILLS,
      mode: "editing",
    });

    expect(progression.issues.map((entry) => entry.code)).toEqual([
      "unknown-rule-choice",
      "unknown-lore-choice",
      "reserved-additional",
      "reserved-additional",
      "already-trained-additional",
      "duplicate-additional",
    ]);
    expect(progression.reconciliation.skillTrainings[step.slotId]).toEqual({
      ruleChoices: { "class:skill": "arcana" },
      additional: ["nature"],
      loreChoices: {},
    });
    expect(progression.reconciliation.changedStepIds).toEqual([step.slotId]);
    expect(progression.stepsBySlotId[step.slotId]?.progress).toMatchObject({
      selectedCount: 2,
      requiredCount: 3,
      remainingCount: 1,
      complete: false,
    });
  });

  it("allows already-applied selections only in recovery mode", () => {
    const draft = createEmptyDraft(1);
    const step = trainingStep("skill-training-fencer-level-1", 1, { additionalCount: 1 });
    draft.skillTrainings[step.slotId] = { ruleChoices: {}, additional: ["athletics"], loreChoices: {} };

    const editing = compileSkillProgression({
      baselineRanks: { athletics: 1 },
      draft,
      steps: [step],
      validSkillSlugs: VALID_SKILLS,
      mode: "editing",
    });
    const recovery = compileSkillProgression({
      baselineRanks: { athletics: 1 },
      draft,
      steps: [step],
      validSkillSlugs: VALID_SKILLS,
      mode: "recovery",
    });

    expect(editing.issues.map((entry) => entry.code)).toEqual(["already-trained-additional"]);
    expect(recovery.issues).toEqual([]);
    expect(recovery.stepsBySlotId[step.slotId]?.progress.complete).toBe(true);
  });

  it("returns deeply immutable rank, issue, progress, and reconciliation surfaces", () => {
    const progression = compileSkillProgression({
      baselineRanks: { athletics: 0 },
      sourceGrants: [{ slug: "arcana", rank: 1, sourceId: "background" }],
      draft: createEmptyDraft(1),
      steps: [trainingStep("skill-training-fencer-level-1", 1, { fixedSkills: ["athletics"] })],
      validSkillSlugs: VALID_SKILLS,
      mode: "editing",
    });

    expect(Object.isFrozen(progression)).toBe(true);
    expect(Object.isFrozen(progression.sourceGrants)).toBe(true);
    expect(Object.isFrozen(progression.sourceGrants[0])).toBe(true);
    expect(Object.isFrozen(progression.ranksBeforeSteps)).toBe(true);
    expect(Object.isFrozen(progression.finalRanks)).toBe(true);
    expect(Object.isFrozen(progression.steps)).toBe(true);
    expect(Object.isFrozen(progression.steps[0])).toBe(true);
    expect(Object.isFrozen(progression.steps[0]?.progress)).toBe(true);
    expect(Object.isFrozen(progression.reconciliation.skillTrainings)).toBe(true);
  });

  it("keeps preview, readiness, and Apply on the same compiled progression", async () => {
    const draft = createEmptyDraft(3);
    const fencerTraining = trainingStep("skill-training-fencer-level-1", 1, {
      fixedSkills: ["deception"],
    });
    const levelThreeIncrease = increaseStep(3);
    const steps = [fencerTraining, levelThreeIncrease];
    draft.skillIncreases[levelThreeIncrease.slotId] = "deception";
    const progression = compileSkillProgression({
      baselineRanks: { acrobatics: 0, crafting: 0, deception: 0 },
      sourceGrants: [
        { slug: "crafting", rank: 1, sourceId: "background" },
        { slug: "acrobatics", rank: 1, sourceId: "class" },
      ],
      draft,
      steps,
      validSkillSlugs: VALID_SKILLS,
      mode: "editing",
    });

    const pane = await buildSkillPane(levelThreeIncrease, draft, {
      baseSkillRanks: {},
      steps,
      skillProgression: progression,
      resolveDocument: async () => null,
      configSkills: Object.fromEntries(Array.from(VALID_SKILLS, (slug) => [slug, { label: slug }])),
      localize: (value) => value,
      isTrainingStepComplete: () => true,
    });
    const readiness = await evaluateWayfinderStep(levelThreeIncrease, draft, new Set(), {} as never, progression);
    const actor = {
      system: {
        skills: {
          acrobatics: { rank: 1 },
          crafting: { rank: 1 },
          deception: { rank: 0 },
        },
      },
      items: { contents: [] },
      update: vi.fn(async () => ({})),
    };
    const appliedRanks = await applyTrainingDraft(actor, draft, steps, { validSkillSlugs: VALID_SKILLS });

    expect(pane?.kind).toBe("skill-increase");
    if (!pane || pane.kind !== "skill-increase") throw new Error("Expected a skill-increase pane");
    expect(pane.skills.find((skill) => skill.slug === "deception")).toMatchObject({
      currentRank: 1,
      targetRank: 2,
    });
    expect(readiness).toMatchObject({ complete: true, state: "complete" });
    expect(appliedRanks).toEqual(progression.finalRanks);
    expect(buildTrainingActorUpdate(actor, appliedRanks)).toEqual({ "system.skills.deception.rank": 2 });
  });
});

function increaseStep(level: number): PendingStep {
  return {
    id: `skill-increase-level-${level}`,
    level,
    kind: "skill-increase",
    slotKind: "skill-increase",
    title: "Skill increase",
    description: "",
    required: true,
    slotId: `skill-increase-level-${level}`,
  };
}

function trainingStep(
  slotId: string,
  level: number,
  overrides: Partial<SkillTrainingStep["training"]> = {}
): SkillTrainingStep {
  return {
    id: slotId,
    level,
    kind: "skill-training",
    slotKind: "skill-training",
    title: "Skill training",
    description: "",
    required: true,
    slotId,
    training: {
      classSlug: "fencer",
      className: "Fencer",
      fixedSkills: [],
      fixedLores: [],
      choiceRules: [],
      loreChoices: [],
      additionalCount: 0,
      ...overrides,
    },
  };
}
