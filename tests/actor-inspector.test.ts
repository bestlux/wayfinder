import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectActor } from "../src/actor-inspector";

describe("actor-inspector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("reads Gradual Ability Boosts from PF2E's authoritative world setting", () => {
    const get = vi.fn((_scope: string, key: string) => key === "gradualBoostsVariant");
    vi.stubGlobal("game", { settings: { get } });

    expect(inspectActor({ items: [] }).gradualBoostsEnabled).toBe(true);
    expect(get).toHaveBeenCalledWith("pf2e", "gradualBoostsVariant");
  });

  it("detects configured campaign feat sections only when PF2E exposes the actor group", () => {
    const get = vi.fn((_scope: string, key: string) =>
      key === "campaignFeatSections"
        ? [
            {
              id: "xdy_ancestryparagon",
              label: "Ancestry Paragon",
              supported: ["ancestry"],
              slots: [1, 3, 7, 11, 15, 19],
            },
          ]
        : false
    );
    vi.stubGlobal("game", { settings: { get } });

    const snapshot = inspectActor({
      items: [],
      feats: new Map([
        [
          "xdy_ancestryparagon",
          {
            id: "xdy_ancestryparagon",
            label: "Ancestry Paragon",
            supported: ["ancestry"],
            slots: {
              "xdy_ancestryparagon-1": {
                id: "xdy_ancestryparagon-1",
                level: 1,
                feat: {},
              },
            },
          },
        ],
      ]),
    });

    expect(snapshot.campaignFeatSections).toEqual([
      {
        id: "xdy_ancestryparagon",
        label: "Ancestry Paragon",
        supported: ["ancestry"],
        slots: [
          { id: "xdy_ancestryparagon-1", level: 1, fulfilled: true },
          { id: "xdy_ancestryparagon-3", level: 3, fulfilled: false },
          { id: "xdy_ancestryparagon-7", level: 7, fulfilled: false },
          { id: "xdy_ancestryparagon-11", level: 11, fulfilled: false },
          { id: "xdy_ancestryparagon-15", level: 15, fulfilled: false },
          { id: "xdy_ancestryparagon-19", level: 19, fulfilled: false },
        ],
      },
    ]);
    expect(snapshot.fulfilledStepIds).toContain("campaign-feat-xdy_ancestryparagon-level-1");

    const withoutGroup = inspectActor({ items: [], feats: new Map() });
    expect(withoutGroup.campaignFeatSections).toEqual([]);
  });

  it("reads campaign settings through the native settings receiver", () => {
    const settings = {
      isNativeSettings: true,
      get(this: { isNativeSettings?: boolean }, _scope: string, key: string) {
        if (!this.isNativeSettings) {
          throw new Error("Missing ClientSettings receiver");
        }
        return key === "campaignFeatSections"
          ? [{ id: "custom", label: "Custom", supported: ["ancestry"], slots: [1] }]
          : false;
      },
    };
    vi.stubGlobal("game", { settings });

    expect(
      inspectActor({
        items: [],
        feats: { custom: { id: "custom", label: "Custom", supported: ["ancestry"], slots: {} } },
      }).campaignFeatSections
    ).toHaveLength(1);
  });

  it("fails malformed, absent, or throwing campaign section settings to no sections", () => {
    const actor = {
      items: [],
      feats: new Map([["custom", { id: "custom", label: "Custom", supported: ["ancestry"], slots: {} }]]),
    };

    vi.stubGlobal("game", { settings: { get: () => ({ id: "custom" }) } });
    expect(inspectActor(actor).campaignFeatSections).toEqual([]);

    vi.stubGlobal("game", { settings: { get: () => [{ id: "custom", label: "Custom", slots: [null, "bad"] }] } });
    expect(inspectActor(actor).campaignFeatSections).toEqual([]);

    vi.stubGlobal("game", {
      settings: { get: () => [{ id: "custom", label: "Custom", supported: "ancestry", slots: [1] }] },
    });
    expect(inspectActor(actor).campaignFeatSections).toEqual([]);

    vi.stubGlobal("game", {
      settings: {
        get: (_scope: string, key: string) => {
          if (key === "campaignFeatSections") {
            throw new Error("Setting is not registered");
          }
          return false;
        },
      },
    });
    expect(inspectActor(actor).campaignFeatSections).toEqual([]);
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
