import { describe, expect, it } from "vitest";
import { inspectActor } from "../src/actor-inspector";

describe("actor-inspector", () => {
  it("counts feats from category when featType is missing", () => {
    const snapshot = inspectActor({
      id: "actor-1",
      system: {
        details: {
          level: {
            value: 4,
          },
        },
      },
      items: {
        contents: [
          featItem("ancestry", undefined),
          featItem("class", undefined),
          featItem(undefined, "archetype"),
          featItem(undefined, "skill"),
          featItem(undefined, "general"),
        ],
      },
    });

    expect(snapshot.featCounts).toEqual({
      ancestry: 1,
      class: 1,
      archetype: 1,
      skill: 1,
      general: 1,
    });
  });

  it("tracks fulfilled wayfinder and PF2E feat slot ids", () => {
    const snapshot = inspectActor({
      flags: {
        "wayfinder-pf2e": {
          state: {
            completedStepIds: ["ability-boosts-level-1"],
          },
        },
      },
      items: {
        contents: [
          {
            type: "feat",
            flags: {
              "wayfinder-pf2e": {
                slotId: "skill-feat-level-1",
              },
            },
          },
        ],
      },
      feats: {
        skill: {
          slots: {
            level2: {
              level: 2,
              feat: {},
            },
          },
        },
        class: {
          slots: {
            level4: {
              level: 4,
              feat: {},
            },
          },
        },
        archetype: {
          slots: {
            level2: {
              level: 2,
              feat: {},
            },
          },
        },
      },
    });

    expect(snapshot.freeArchetypeEnabled).toBe(true);
    expect(snapshot.fulfilledStepIds).toEqual([
      "ability-boosts-level-1",
      "archetype-feat-level-2",
      "class-feat-level-4",
      "skill-feat-level-1",
      "skill-feat-level-2",
    ]);
  });

  it("counts class-category feats in PF2E's archetype locations only in the Free Archetype lane", () => {
    const snapshot = inspectActor({
      items: {
        contents: [
          { ...featItem("class"), system: { category: "class", location: "class-2" } },
          { ...featItem("class"), system: { category: "class", location: "archetype-2" } },
        ],
      },
      feats: new Map([["archetype", { slots: {} }]]),
    });

    expect(snapshot.freeArchetypeEnabled).toBe(true);
    expect(snapshot.featCounts.class).toBe(1);
    expect(snapshot.featCounts.archetype).toBe(1);
  });
});

function featItem(category?: string, featType?: string): any {
  return {
    type: "feat",
    system: {
      ...(category ? { category } : {}),
      ...(featType ? { featType: { value: featType } } : {}),
    },
  };
}
