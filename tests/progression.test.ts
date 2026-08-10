import { describe, expect, it } from "vitest";
import { buildProgressionPlan, buildSteps } from "../src/progression";
import type { ActorSnapshot } from "../src/types";

function makeSnapshot(partial: Partial<ActorSnapshot> = {}): ActorSnapshot {
  return {
    actorId: "actor-1",
    level: 1,
    isBlank: true,
    freeArchetypeEnabled: false,
    campaignFeatSections: [],
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

  it("schedules Ancestry Paragon beside the native ancestry lane through the requested level", () => {
    const section = {
      id: "xdy_ancestryparagon",
      label: "Ancestry Paragon",
      supported: ["ancestry"],
      filter: { categories: ["ancestry"], traits: [], omitTraits: [], conjunction: "or" as const },
      slots: [1, 3, 7, 11, 15, 19].map((level) => ({
        id: `xdy_ancestryparagon-${level}`,
        level,
        fulfilled: false,
        filter: null,
      })),
    };
    const level3 = buildSteps(makeSnapshot({ campaignFeatSections: [section] }), 1, 3);

    expect(level3.filter((step) => step.slotKind === "campaign-feat")).toEqual([
      expect.objectContaining({
        level: 1,
        slotId: "campaign-feat-xdy_ancestryparagon-level-1",
        title: "Level 1 Ancestry Paragon",
        filters: expect.objectContaining({ featTypes: ["ancestry"], maxLevel: 1 }),
        campaignFeat: expect.objectContaining({
          sectionId: "xdy_ancestryparagon",
          groupSlotId: "xdy_ancestryparagon-1",
        }),
      }),
      expect.objectContaining({
        level: 3,
        slotId: "campaign-feat-xdy_ancestryparagon-level-3",
      }),
    ]);
    expect(level3.filter((step) => step.slotId === "ancestry-feat-level-1")).toHaveLength(1);

    expect(
      buildSteps(makeSnapshot({ campaignFeatSections: [section] }), 1, 20)
        .filter((step) => step.slotKind === "campaign-feat")
        .map((step) => step.level)
    ).toEqual([1, 3, 7, 11, 15, 19]);
  });

  it("keeps non-ancestry campaign sections on their honest generic supported pool", () => {
    const [step] = buildSteps(
      makeSnapshot({
        campaignFeatSections: [
          {
            id: "xdy_dualclass",
            label: "Dual Class",
            supported: ["class"],
            filter: { categories: ["class"], traits: [], omitTraits: [], conjunction: "or" },
            slots: [{ id: "xdy_dualclass-1", level: 1, fulfilled: false, filter: null }],
          },
        ],
      }),
      1,
      1
    ).filter((candidate) => candidate.slotKind === "campaign-feat");

    expect(step?.filters).toEqual({ itemType: "feat", featTypes: ["class"], maxLevel: 1 });
    expect(step?.campaignFeat?.supported).toEqual(["class"]);
  });

  it("keeps explicit same-level campaign slots distinct while preserving projection suffixes", () => {
    const steps = buildSteps(
      makeSnapshot({
        campaignFeatSections: [
          {
            id: "bonus-ancestry",
            label: "Bonus Ancestry",
            supported: ["ancestry"],
            filter: { categories: ["ancestry"], traits: [], omitTraits: [], conjunction: "or" },
            slots: [
              { id: "bonus-ancestry-first", level: 1, fulfilled: false, filter: null },
              { id: "bonus-ancestry-second", level: 1, fulfilled: false, filter: null },
            ],
          },
        ],
      }),
      1,
      1
    ).filter((step) => step.slotKind === "campaign-feat");

    expect(steps.map((step) => step.slotId)).toEqual([
      "campaign-feat-bonus-ancestry-bonus-ancestry-first-level-1",
      "campaign-feat-bonus-ancestry-bonus-ancestry-second-level-1",
    ]);
    expect(steps.every((step) => step.slotId.endsWith("-level-1"))).toBe(true);
  });

  it("prioritizes a campaign slot filter over its group filter", () => {
    const [step] = buildSteps(
      makeSnapshot({
        campaignFeatSections: [
          {
            id: "mixed",
            label: "Mixed",
            supported: ["ancestry", "class"],
            filter: {
              categories: ["ancestry", "class"],
              traits: ["human", "fighter"],
              omitTraits: ["rare"],
              conjunction: "or",
            },
            slots: [
              {
                id: "mixed-1",
                level: 1,
                fulfilled: false,
                filter: {
                  categories: ["ancestry"],
                  traits: ["human"],
                  omitTraits: ["legacy"],
                  conjunction: "and",
                },
              },
            ],
          },
        ],
      }),
      1,
      1
    ).filter((candidate) => candidate.slotKind === "campaign-feat");

    expect(step?.filters).toEqual({
      itemType: "feat",
      featTypes: ["ancestry"],
      traits: ["human"],
      omitTraits: ["legacy"],
      traitConjunction: "and",
      maxLevel: 1,
    });
    expect(step?.campaignFeat?.filter).toEqual({
      categories: ["ancestry"],
      traits: ["human"],
      omitTraits: ["legacy"],
      conjunction: "and",
    });
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
