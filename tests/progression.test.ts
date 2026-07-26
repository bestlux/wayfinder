import { describe, expect, it } from "vitest";
import { buildProgressionPlan, buildSteps } from "../src/progression";
import type { ActorSnapshot } from "../src/types";

function makeSnapshot(partial: Partial<ActorSnapshot> = {}): ActorSnapshot {
  return {
    actorId: "actor-1",
    level: 1,
    isBlank: true,
    freeArchetypeEnabled: false,
    gradualBoostsEnabled: false,
    singletonSlots: {
      ancestry: false,
      heritage: false,
      background: false,
      class: false,
      deity: false,
    },
    featCounts: {
      ancestry: 0,
      class: 0,
      archetype: 0,
      skill: 0,
      general: 0,
    },
    fulfilledStepIds: [],
    sourceIds: [],
    namesByType: {},
    skillRanks: {},
    ...partial,
  };
}

describe("progression", () => {
  it("creates level 1 creation steps for a blank actor", () => {
    const plan = buildProgressionPlan(makeSnapshot());

    expect(plan.targetLevel).toBe(1);
    expect(plan.recommendedTargetLevel).toBe(1);
    expect(plan.steps.map((step) => step.slotKind)).toEqual([
      "ancestry",
      "heritage",
      "background",
      "class",
      "ancestry-feat",
      "ability-boosts",
    ]);
  });

  it("advances a complete level 3 actor to level 4 recommendations", () => {
    const plan = buildProgressionPlan(
      makeSnapshot({
        level: 3,
        isBlank: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 1,
          class: 1,
          archetype: 0,
          skill: 1,
          general: 1,
        },
      })
    );

    expect(plan.recommendedTargetLevel).toBe(4);
    expect(plan.steps.map((step) => step.slotKind)).toEqual(["skill-feat"]);
  });

  it("includes later milestone steps up to a requested level", () => {
    const steps = buildSteps(
      makeSnapshot({
        level: 4,
        isBlank: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 1,
          class: 2,
          archetype: 0,
          skill: 1,
          general: 1,
        },
      }),
      4,
      5
    );

    expect(steps.map((step) => `${step.slotKind}:${step.level}`)).toContain("ability-boosts:5");
    expect(steps.map((step) => `${step.slotKind}:${step.level}`)).toContain("skill-feat:4");
    expect(steps.map((step) => `${step.slotKind}:${step.level}`)).not.toContain("class-feat:2");
  });

  it("allows skill feats in general feat slots", () => {
    const generalFeatStep = buildSteps(makeSnapshot(), 1, 3).find((step) => step.slotId === "general-feat-level-3");

    expect(generalFeatStep?.filters?.featTypes).toEqual(["general", "skill"]);
  });

  it("uses fulfilled slot ids before raw feat counts for level-up feat milestones", () => {
    const steps = buildSteps(
      makeSnapshot({
        level: 1,
        isBlank: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 1,
          class: 0,
          archetype: 0,
          skill: 1,
          general: 0,
        },
        fulfilledStepIds: ["ancestry-feat-level-1", "skill-feat-level-1"],
      }),
      1,
      4
    );

    expect(steps.map((step) => `${step.slotKind}:${step.level}`)).toEqual(
      expect.arrayContaining(["skill-feat:2", "skill-feat:4"])
    );
  });

  it("skips exact fulfilled slot ids without consuming later same-kind milestones", () => {
    const steps = buildSteps(
      makeSnapshot({
        level: 1,
        isBlank: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 1,
          class: 0,
          archetype: 0,
          skill: 2,
          general: 0,
        },
        fulfilledStepIds: ["skill-feat-level-2"],
      }),
      1,
      4
    );

    expect(steps.map((step) => `${step.slotKind}:${step.level}`)).toContain("skill-feat:4");
    expect(steps.map((step) => `${step.slotKind}:${step.level}`)).not.toContain("skill-feat:2");
  });

  it("adds separate even-level Free Archetype steps only when PF2E exposes the variant group", () => {
    const disabledSteps = buildSteps(makeSnapshot(), 1, 5);
    const enabledSteps = buildSteps(
      makeSnapshot({
        freeArchetypeEnabled: true,
        fulfilledStepIds: ["archetype-feat-level-2"],
      }),
      1,
      5
    );

    expect(disabledSteps.some((step) => step.slotKind === "archetype-feat")).toBe(false);
    expect(enabledSteps.filter((step) => step.slotKind === "archetype-feat").map((step) => step.slotId)).toEqual([
      "archetype-feat-level-4",
    ]);
    expect(enabledSteps.find((step) => step.slotKind === "archetype-feat")?.description).toContain(
      "confirm eligibility with your GM"
    );
  });

  it("schedules standard and gradual ability boosts through level 20 for a blank build", () => {
    const standardBoostLevels = buildSteps(makeSnapshot(), 1, 20)
      .filter((step) => step.kind === "boost" && step.level > 1)
      .map((step) => step.level);
    const gradualBoostLevels = buildSteps(makeSnapshot({ gradualBoostsEnabled: true }), 1, 20)
      .filter((step) => step.kind === "boost" && step.level > 1)
      .map((step) => step.level);

    expect(standardBoostLevels).toEqual([5, 10, 15, 20]);
    expect(gradualBoostLevels).toEqual([2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20]);
  });

  it("uses the active boost cadence for an existing character mid-progression", () => {
    const existing = makeSnapshot({
      level: 8,
      isBlank: false,
      singletonSlots: {
        ancestry: true,
        heritage: true,
        background: true,
        class: true,
        deity: false,
      },
    });
    const boostLevels = (snapshot: ActorSnapshot) =>
      buildSteps(snapshot, 8, 15)
        .filter((step) => step.kind === "boost")
        .map((step) => step.level);

    expect(boostLevels(existing)).toEqual([10, 15]);
    expect(boostLevels({ ...existing, gradualBoostsEnabled: true })).toEqual([9, 10, 12, 13, 14, 15]);
  });
});
