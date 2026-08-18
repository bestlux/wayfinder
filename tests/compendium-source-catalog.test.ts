import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPENDIUM_COUNT_FIELDS,
  classifyCompendiumEntries,
  discoverItemCompendia,
  findUnavailableSelectedCompendiumIds,
  resolveCompendiumSelection,
  scanCompendiumCatalog,
  serializeCompendiumSelection,
} from "../src/compendium-source-catalog";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("compendium source catalog", () => {
  beforeEach(() => {
    testGlobals.game = {
      modules: new Map([["battlezoo", { title: "Battlezoo" }]]),
      packs: new Map(),
      system: { id: "pf2e", title: "Pathfinder Second Edition" },
    };
  });

  it("classifies supported PF2E item types and feat categories without double-counting", () => {
    const counts = classifyCompendiumEntries([
      { type: "ancestry" },
      { type: "heritage" },
      { type: "background" },
      { type: "class" },
      { type: "deity" },
      { type: "spell" },
      { type: "feat", system: { category: "ancestry" } },
      { type: "feat", system: { category: "class" } },
      { type: "feat", system: { featType: { value: "skill" } } },
      { type: "feat", system: { category: "general" } },
      { type: "feat", system: { category: "classfeature" } },
      { type: "weapon" },
      { type: null },
    ]);

    expect(counts).toMatchObject({
      totalItems: 13,
      relevantTotal: 11,
      ancestry: 1,
      heritage: 1,
      background: 1,
      class: 1,
      deity: 1,
      spells: 1,
      feats: 5,
      ancestryFeats: 1,
      classFeats: 1,
      skillFeats: 1,
      generalFeats: 1,
      classFeatures: 1,
      other: 2,
    });
  });

  it("discovers only Item compendia and labels official, module, and world packs", () => {
    testGlobals.game.packs = new Map([
      ["pf2e.ancestries", itemPack([], { title: "Ancestries", metadata: { packageName: "pf2e", type: "Item" } })],
      [
        "battlezoo.characters",
        itemPack([], { title: "Character Options", metadata: { packageName: "battlezoo", type: "Item" } }),
      ],
      ["world.homebrew", itemPack([], { title: "Homebrew", metadata: { packageName: "world", type: "Item" } })],
      ["battlezoo.journals", itemPack([], { documentName: "JournalEntry" })],
      ["broken.unknown", { title: "Unknown", getIndex: vi.fn(async () => []) }],
    ]);

    expect(discoverItemCompendia()).toEqual([
      expect.objectContaining({
        id: "pf2e.ancestries",
        title: "Ancestries",
        packageTitle: "Pathfinder Second Edition",
        official: true,
      }),
      expect.objectContaining({
        id: "battlezoo.characters",
        title: "Character Options",
        packageTitle: "Battlezoo",
        official: false,
      }),
      expect.objectContaining({
        id: "world.homebrew",
        title: "Homebrew",
        packageTitle: "World",
        official: false,
      }),
    ]);
  });

  it("scans with minimal fields, isolates failures, and bounds concurrency", async () => {
    let active = 0;
    let peak = 0;
    const requestedFields: string[][] = [];
    testGlobals.game.packs = new Map(
      ["one", "two", "three", "four"].map((name, index) => [
        `addon.${name}`,
        itemPack([], {
          getIndex: async ({ fields }) => {
            requestedFields.push(fields);
            active += 1;
            peak = Math.max(peak, active);
            await Promise.resolve();
            active -= 1;
            if (index === 2) throw new Error("broken pack");
            return [{ type: index === 0 ? "ancestry" : "spell" }];
          },
        }),
      ])
    );

    const scanned = await scanCompendiumCatalog(discoverItemCompendia(), 2);

    expect(peak).toBeLessThanOrEqual(2);
    expect(requestedFields).toHaveLength(4);
    expect(requestedFields.every((fields) => fields.join() === COMPENDIUM_COUNT_FIELDS.join())).toBe(true);
    expect(scanned.filter((row) => row.status === "ready")).toHaveLength(3);
    expect(scanned.find((row) => row.id === "addon.three")?.status).toBe("error");
    expect(scanned.find((row) => row.id === "addon.one")?.counts.ancestry).toBe(1);
  });

  it("expands legacy wildcards for review without mutating unavailable exact ids", () => {
    expect(
      resolveCompendiumSelection("*, battlezoo.*, world.missing", [
        "pf2e.ancestries",
        "battlezoo.ancestries",
        "other.items",
      ])
    ).toEqual({
      selectedIds: ["pf2e.ancestries", "battlezoo.ancestries", "other.items"],
      unavailableExactIds: ["world.missing"],
      legacyPatterns: ["*", "battlezoo.*"],
      unmatchedLegacyPatterns: [],
      hasGlobalWildcard: true,
    });
  });

  it("identifies legacy wildcard patterns with no currently available matches", () => {
    expect(resolveCompendiumSelection("inactive-module.*, malformed*", ["pf2e.ancestries"])).toEqual({
      selectedIds: [],
      unavailableExactIds: [],
      legacyPatterns: ["inactive-module.*", "malformed*"],
      unmatchedLegacyPatterns: ["inactive-module.*", "malformed*"],
      hasGlobalWildcard: false,
    });
  });

  it("serializes exact optional pack ids deterministically and drops wildcards and official packs", () => {
    expect(
      serializeCompendiumSelection(["world.zed", "pf2e.ancestries", "battlezoo.*", "world.alpha", "world.zed"])
    ).toBe("world.alpha, world.zed");
    expect(serializeCompendiumSelection(["world.alpha"], ["inactive-module.*"])).toBe("inactive-module.*, world.alpha");
  });

  it("retains selected optional sources that disappear during a catalog refresh", () => {
    expect(
      findUnavailableSelectedCompendiumIds(
        ["pf2e.ancestries", "addon.present", "addon.missing", "addon.missing"],
        ["pf2e.ancestries", "addon.present"]
      )
    ).toEqual(["addon.missing"]);
  });
});

function itemPack(
  entries: unknown[],
  overrides: {
    documentName?: string;
    title?: string;
    metadata?: { packageName?: string; type?: string };
    getIndex?: (options: { fields: string[] }) => Promise<Iterable<any>>;
  } = {}
): any {
  return {
    documentName: "Item",
    title: overrides.title,
    metadata: overrides.metadata,
    getIndex: overrides.getIndex ?? vi.fn(async () => entries),
    ...overrides,
  };
}
