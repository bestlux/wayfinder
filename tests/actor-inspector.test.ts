import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectActor } from "../src/actor-inspector";
import { completedAcquisitionFixture } from "./fixtures/acquisition-fixture";

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
            completedStepIds: ["ability-boosts-level-1", "starting-equipment-level-1", "untrusted-step"],
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
      "starting-equipment-level-1",
    ]);
  });

  it("recognizes only an intact completed acquisition manifest owned by the inspected actor", async () => {
    const { manifest } = await completedAcquisitionFixture();
    const inspectWithState = (actorId: string, state: Record<string, unknown>) =>
      inspectActor({
        id: actorId,
        items: [],
        flags: { "wayfinder-pf2e": { state } },
      }).hasValidCompletedAcquisitionManifest;

    expect(inspectWithState("actor-1", { completedAcquisitionManifest: manifest })).toBe(true);
    expect(inspectWithState("actor-1", {})).toBe(false);
    expect(
      inspectWithState("actor-1", {
        completedAcquisitionManifest: manifest,
        completedAcquisitionManifestCorrupt: true,
      })
    ).toBe(false);
    expect(inspectWithState("actor-2", { completedAcquisitionManifest: manifest })).toBe(false);
    expect(
      inspectWithState("actor-1", {
        completedAcquisitionManifest: { ...manifest, targetLevel: manifest.targetLevel + 1 },
      })
    ).toBe(false);
    expect(
      inspectWithState("actor-1", {
        completedAcquisitionManifest: {
          schemaVersion: 1,
          actorId: "actor-1",
          id: manifest.id,
        },
      })
    ).toBe(false);
  });

  it("recognizes only normalized persisted existing-character history", () => {
    const inspectWithHistory = (existingCharacterHistory: unknown) =>
      inspectActor({
        id: "actor-1",
        items: [],
        flags: { "wayfinder-pf2e": { state: { existingCharacterHistory } } },
      }).hasImportedExistingCharacterHistory;

    expect(
      inspectWithHistory({
        version: 1,
        importedAt: "2026-08-21T12:00:00.000Z",
        actorLevel: 7,
        entries: [],
      })
    ).toBe(true);
    expect(inspectWithHistory(null)).toBe(false);
    expect(inspectWithHistory({ version: 1, actorLevel: 7, entries: [] })).toBe(false);
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
              filter: {
                categories: ["ancestry"],
                traits: ["human"],
                omitTraits: ["rare"],
                conjunction: "and",
              },
              slots: [
                {
                  id: "xdy_ancestryparagon-1",
                  level: 1,
                  filter: { categories: ["ancestry"], traits: ["human"], conjunction: "and" },
                },
                3,
                7,
                11,
                15,
                19,
              ],
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
            filter: {
              categories: ["ancestry"],
              traits: ["human"],
              omitTraits: ["rare"],
              conjunction: "and",
            },
            slots: {
              "xdy_ancestryparagon-1": {
                id: "xdy_ancestryparagon-1",
                level: 1,
                feat: {},
                filter: { categories: ["ancestry"], traits: ["human"], conjunction: "and" },
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
        filter: {
          categories: ["ancestry"],
          traits: ["human"],
          omitTraits: ["rare"],
          conjunction: "and",
        },
        slots: [
          {
            id: "xdy_ancestryparagon-1",
            level: 1,
            fulfilled: true,
            filter: {
              categories: ["ancestry"],
              traits: ["human"],
              omitTraits: [],
              conjunction: "and",
            },
          },
          { id: "xdy_ancestryparagon-3", level: 3, fulfilled: false, filter: null },
          { id: "xdy_ancestryparagon-7", level: 7, fulfilled: false, filter: null },
          { id: "xdy_ancestryparagon-11", level: 11, fulfilled: false, filter: null },
          { id: "xdy_ancestryparagon-15", level: 15, fulfilled: false, filter: null },
          { id: "xdy_ancestryparagon-19", level: 19, fulfilled: false, filter: null },
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

  it("rejects every ambiguous campaign section sharing a normalized id", () => {
    vi.stubGlobal("game", {
      settings: {
        get: () => [
          { id: " duplicate ", label: "First", supported: ["ancestry"], slots: [1] },
          { id: "duplicate", label: "Second", supported: ["class"], slots: [1] },
          { id: "unique", label: "Unique", supported: ["ancestry"], slots: [1] },
        ],
      },
    });

    const snapshot = inspectActor({
      items: [],
      feats: new Map([
        ["duplicate", { id: "duplicate", label: "Duplicate", supported: ["ancestry"], slots: {} }],
        ["unique", { id: "unique", label: "Unique", supported: ["ancestry"], slots: {} }],
      ]),
    });

    expect(snapshot.campaignFeatSections.map((section) => section.id)).toEqual(["unique"]);
  });

  it("rejects campaign sections with duplicate normalized slot ids", () => {
    vi.stubGlobal("game", {
      settings: {
        get: () => [
          {
            id: "custom",
            label: "Custom",
            supported: ["ancestry"],
            slots: [
              { id: " repeated ", level: 1 },
              { id: "repeated", level: 3 },
            ],
          },
        ],
      },
    });

    expect(
      inspectActor({
        items: [],
        feats: new Map([["custom", { id: "custom", label: "Custom", supported: ["ancestry"], slots: {} }]]),
      }).campaignFeatSections
    ).toEqual([]);
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
