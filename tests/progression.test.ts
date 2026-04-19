import { describe, expect, it } from "vitest";
import { buildProgressionPlan, buildSteps } from "../src/progression";
import type { ActorSnapshot } from "../src/types";

function makeSnapshot(partial: Partial<ActorSnapshot> = {}): ActorSnapshot {
  return {
    actorId: "actor-1",
    level: 1,
    isBlank: true,
    singletonSlots: {
      ancestry: false,
      heritage: false,
      background: false,
      class: false,
    },
    featCounts: {
      ancestry: 0,
      class: 0,
      archetype: 0,
      skill: 0,
      general: 0,
    },
    sourceIds: [],
    namesByType: {},
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
});
