import { describe, expect, it } from "vitest";
import { inspectActor } from "../src/actor-inspector";

describe("actor-inspector", () => {
  it("counts feats from category when featType is missing", () => {
    const snapshot = inspectActor({
      id: "actor-1",
      system: {
        details: {
          level: {
            value: 4
          }
        }
      },
      items: {
        contents: [
          featItem("ancestry", undefined),
          featItem("class", undefined),
          featItem(undefined, "archetype"),
          featItem(undefined, "skill"),
          featItem(undefined, "general")
        ]
      }
    });

    expect(snapshot.featCounts).toEqual({
      ancestry: 1,
      class: 1,
      archetype: 1,
      skill: 1,
      general: 1
    });
  });
});

function featItem(category?: string, featType?: string): any {
  return {
    type: "feat",
    system: {
      ...(category ? { category } : {}),
      ...(featType ? { featType: { value: featType } } : {})
    }
  };
}
