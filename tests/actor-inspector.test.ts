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
        "pf2e-wayfinder": {
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
              "pf2e-wayfinder": {
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
      },
    });

    expect(snapshot.fulfilledStepIds).toEqual([
      "ability-boosts-level-1",
      "class-feat-level-4",
      "skill-feat-level-1",
      "skill-feat-level-2",
    ]);
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
