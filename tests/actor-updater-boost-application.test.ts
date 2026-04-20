import { describe, expect, it, vi } from "vitest";
import { applyBoostDraft } from "../src/actor-updater/boost-application";
import type { getEffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";

type EffectiveBuildState = Awaited<ReturnType<typeof getEffectiveBuildState>>;

describe("actor-updater boost application", () => {
  it("writes effective ancestry, background, class, and actor boost values", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const update = vi.fn(async () => ({}));
    const actor = {
      items: {
        contents: [
          { id: "ancestry-1", type: "ancestry" },
          { id: "background-1", type: "background" },
          { id: "class-1", type: "class" },
        ],
      },
      system: {
        details: {
          level: {
            value: 5,
          },
        },
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "wis"],
              5: [],
              10: [],
              15: [],
              20: [],
            },
          },
        },
      },
      updateEmbeddedDocuments,
      update,
    };
    const draft = createEmptyDraft(5);
    const effectiveBuildState: EffectiveBuildState = {
      ancestry: {
        document: null,
        mode: "alternate",
        alternateBoosts: ["dex", "int"],
        selectedBoosts: {
          fixed: "con",
          free: null,
        },
        lockedBoosts: [],
        voluntary: {
          enabled: true,
          legacy: true,
          boost: "cha",
          flaws: ["str", "str"],
        },
        buildBoosts: [],
        buildFlaws: [],
      },
      heritage: null,
      background: {
        document: null,
        selectedBoosts: {
          restricted: "dex",
          free: "wis",
        },
        buildBoosts: [],
      },
      class: {
        document: null,
        keyAbilityOptions: ["wis"],
        selectedKeyAbility: "wis",
      },
      deity: null,
      levelBoosts: {
        1: ["str", "dex", "con", "wis"],
        5: ["str", "dex", "int", "cha"],
        10: [],
        15: [],
        20: [],
      },
      allowedBoosts: {
        1: 4,
        5: 4,
        10: 4,
        15: 4,
        20: 4,
      },
      projectedAbilities: {
        str: { key: "str", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        int: { key: "int", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      },
    };

    await applyBoostDraft(actor, draft, {
      getEffectiveBuildState: async () => effectiveBuildState,
    });

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "ancestry-1",
        "system.alternateAncestryBoosts": ["dex", "int"],
        "system.boosts.fixed.selected": "con",
        "system.boosts.free.selected": null,
        "system.voluntary.flaws": ["str", "str"],
        "system.voluntary.boost": "cha",
      },
      {
        _id: "background-1",
        "system.boosts.restricted.selected": "dex",
        "system.boosts.free.selected": "wis",
      },
      {
        _id: "class-1",
        "system.keyAbility.selected": "wis",
      },
    ]);
    expect(update).toHaveBeenCalledWith({
      "system.build.attributes.boosts.1": ["str", "dex", "con", "wis"],
      "system.build.attributes.boosts.5": ["str", "dex", "int", "cha"],
      "system.build.attributes.boosts.10": [],
      "system.build.attributes.boosts.15": [],
      "system.build.attributes.boosts.20": [],
    });
  });
});
