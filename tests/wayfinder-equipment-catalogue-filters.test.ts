import { describe, expect, it, vi } from "vitest";
import {
  buildEquipmentCatalogueFacetOptions,
  buildEquipmentCatalogueLevelFacet,
  isTitanMaulerEligibleEntry,
  matchesEquipmentCatalogueFilters,
  normalizeEquipmentCatalogueFilters,
  projectEquipmentCatalogueFilters,
  rankEquipmentCatalogueMatches,
} from "../src/wayfinder/application/equipment-catalogue-filters";
import type { EquipmentCatalogueEntry } from "../src/wayfinder/application/equipment-catalogue-service";

describe("equipment catalogue filters", () => {
  it("normalizes default-on policy and contextual Titan modes with explicit clear overrides", () => {
    expect(
      normalizeEquipmentCatalogueFilters({
        defaults: { policyAvailable: true, titanMaulerEligible: true },
      })
    ).toMatchObject({ policyAvailable: true, titanMaulerEligible: true });
    expect(
      normalizeEquipmentCatalogueFilters({
        filters: { availability: ["all"], "titan-mauler": ["all"] },
        defaults: { policyAvailable: true, titanMaulerEligible: true },
      })
    ).toMatchObject({ policyAvailable: false, titanMaulerEligible: false });
  });

  it("applies token, range, categorical, trait, and exact Titan eligibility predicates", () => {
    const entries = [
      entry({ name: "Agile Hatchet", level: 0, traits: ["agile", "sweep"] }),
      entry({ name: "Long Spear", level: 1, traits: ["reach"] }),
      entry({ name: "Forbidden Axe", level: 0, available: false, traits: ["sweep"] }),
    ];
    const filters = normalizeEquipmentCatalogueFilters({
      query: "hatchet agile",
      filters: { type: ["weapon"], trait: ["reach", "sweep"], level: ["0:0"] },
      defaults: { policyAvailable: true },
    });

    expect(entries.filter((candidate) => matchesEquipmentCatalogueFilters(candidate, filters))).toEqual([entries[0]]);
    expect(isTitanMaulerEligibleEntry(entries[0]!)).toBe(true);
    expect(isTitanMaulerEligibleEntry({ ...entries[0]!, level: 1 })).toBe(false);
  });

  it("preserves source and hyphenated trait identifiers while free-text search still folds punctuation", () => {
    const candidate = entry({
      name: "Bastard Sword",
      publicationSlug: "pathfinder-player-core",
      traits: ["two-hand-d12"],
    });
    const filters = normalizeEquipmentCatalogueFilters({
      query: "two hand d12",
      filters: { source: ["pathfinder-player-core"], trait: ["two-hand-d12"] },
    });

    expect(matchesEquipmentCatalogueFilters(candidate, filters)).toBe(true);
    expect(buildEquipmentCatalogueFacetOptions([candidate], filters, "source", ["pathfinder-player-core"])).toEqual([
      expect.objectContaining({ value: "pathfinder-player-core", count: 1 }),
    ]);
    expect(buildEquipmentCatalogueFacetOptions([candidate], filters, "trait", ["two-hand-d12"])).toEqual([
      expect.objectContaining({ value: "two-hand-d12", label: "Two Hand D12", count: 1 }),
    ]);
  });

  it("computes facet counts with the current query and every other facet applied", () => {
    const entries = [
      entry({ name: "Agile Hatchet", traits: ["agile", "sweep"] }),
      entry({ name: "Agile Spear", traits: ["agile", "reach"] }),
      entry({ name: "Heavy Shield", itemType: "shield", traits: ["bulwark"] }),
      entry({ name: "Agile Forbidden Axe", available: false, traits: ["agile"] }),
    ];
    const filters = normalizeEquipmentCatalogueFilters({
      query: "agile",
      filters: { type: ["weapon"] },
      defaults: { policyAvailable: true },
    });

    expect(buildEquipmentCatalogueFacetOptions(entries, filters, "trait")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "agile", count: 2 }),
        expect.objectContaining({ value: "reach", count: 1 }),
        expect.objectContaining({ value: "sweep", count: 1 }),
      ])
    );
    expect(buildEquipmentCatalogueFacetOptions(entries, filters, "availability")).toEqual([
      expect.objectContaining({ value: "available", count: 2 }),
    ]);
  });

  it("projects the picker-style level vocabulary from conditionally matching entries", () => {
    const entries = [0, 1, 2, 4].map((level) => entry({ level }));
    const filters = normalizeEquipmentCatalogueFilters({ filters: { level: ["1:2"] } });

    expect(buildEquipmentCatalogueLevelFacet(entries, filters)).toEqual({
      values: [0, 1, 2, 4],
      minimum: 1,
      maximum: 2,
      fullMinimum: 0,
      fullMaximum: 4,
      active: true,
    });
  });

  it.each([
    ["one", { type: ["armor"], level: ["1:4"] }, ""],
    ["zero", { level: ["1:4"] }, "no matching equipment"],
  ])("retains an active level facet across a %s-level contextual domain", (_label, filterMap, query) => {
    const entries = [entry({ level: 0 }), entry({ level: 2, itemType: "armor" }), entry({ level: 4 })];
    const filters = normalizeEquipmentCatalogueFilters({ filters: filterMap, query });

    expect(buildEquipmentCatalogueLevelFacet(entries, filters)).toMatchObject({
      values: [0, 1, 2, 4],
      minimum: 1,
      maximum: 4,
      active: true,
    });
  });

  it("preserves exact stable catalogue order on the blank-query linear rank path", () => {
    const entries = [
      entry({ name: "Available A" }),
      entry({ name: "Unavailable A", available: false }),
      entry({ name: "Available B" }),
      entry({ name: "Unavailable B", available: false }),
      entry({ name: "Available C" }),
    ];

    expect(rankEquipmentCatalogueMatches(entries, "  ")).toEqual([
      entries[0],
      entries[2],
      entries[4],
      entries[1],
      entries[3],
    ]);
    expect(rankEquipmentCatalogueMatches(entries, "available")).toEqual(referenceRank(entries, "available"));
  });

  it("matches the reference excluded-key facet semantics across mixed randomized catalogues", () => {
    const random = seededRandom(0x80_02);
    const types = ["weapon", "armor", "shield", "equipment"] as const;
    const rarities = ["common", "uncommon", "rare", "unique"] as const;
    const sources = ["pathfinder-player-core", "gm-core", "treasure-vault"] as const;
    const traits = ["agile", "reach", "two-hand-d12", "bulwark", "consumable"] as const;
    const queries = ["", "blade", "two hand", "gm core", "missing"] as const;

    for (let iteration = 0; iteration < 40; iteration += 1) {
      const entries = Array.from({ length: 20 + Math.floor(random() * 30) }, (_, index) => {
        const itemType = pick(random, types);
        const rarity = pick(random, rarities);
        const publicationSlug = pick(random, sources);
        const selectedTraits = traits.filter(() => random() < 0.35);
        if (selectedTraits.length > 0 && random() < 0.2) selectedTraits.push(selectedTraits[0]!);
        return entry({
          sourceUuid: `Compendium.pf2e.equipment-srd.Item.random-${iteration}-${index}`,
          documentId: `random-${iteration}-${index}`,
          name: `${index % 3 === 0 ? "Blade" : "Gear"} ${index}`,
          itemType,
          level: Math.floor(random() * 6),
          rarity,
          publicationSlug,
          traits: selectedTraits,
          available: random() < 0.75,
        });
      });
      const requested = {
        availability: random() < 0.5 ? [random() < 0.5 ? "available" : "all"] : undefined,
        type: random() < 0.6 ? [pick(random, types)] : undefined,
        rarity: random() < 0.6 ? [pick(random, rarities)] : undefined,
        source: random() < 0.6 ? [pick(random, sources)] : undefined,
        trait: random() < 0.6 ? [pick(random, traits), ...(random() < 0.3 ? ["selected-zero"] : [])] : undefined,
        level: random() < 0.6 ? [`${Math.floor(random() * 3)}:${3 + Math.floor(random() * 3)}`] : undefined,
        "titan-mauler": random() < 0.5 ? [random() < 0.5 ? "eligible" : "all"] : undefined,
      };
      const filters = normalizeEquipmentCatalogueFilters({
        query: pick(random, queries),
        filters: requested,
        defaults: { policyAvailable: random() < 0.5, titanMaulerEligible: random() < 0.5 },
      });
      const includeTitanMaulerFacet = random() < 0.5;
      const projection = projectEquipmentCatalogueFilters({
        entries,
        filters,
        selectedValues: requested,
        includeTitanMaulerFacet,
      });
      const facetKeys = ["availability", "type", "rarity", "source", "trait"] as const;
      const expectedFacets = [
        ...facetKeys.flatMap((key) => buildEquipmentCatalogueFacetOptions(entries, filters, key, requested[key])),
        ...(includeTitanMaulerFacet
          ? buildEquipmentCatalogueFacetOptions(entries, filters, "titan-mauler", requested["titan-mauler"])
          : []),
      ];

      expect(projection.matchedEntries).toEqual(
        entries.filter((candidate) => matchesEquipmentCatalogueFilters(candidate, filters))
      );
      expect(projection.facets).toEqual(expectedFacets);
      expect(projection.levelFacet).toEqual(buildEquipmentCatalogueLevelFacet(entries, filters));
    }
  });

  it("normalizes searchable entry material once instead of once per excluded-key scan", () => {
    const entries = Array.from({ length: 120 }, (_, index) =>
      entry({
        sourceUuid: `Compendium.pf2e.equipment-srd.Item.normalization-${index}`,
        documentId: `normalization-${index}`,
        name: `Accented Bladé ${index}`,
        traits: ["agile", "two-hand-d12"],
      })
    );
    const requested = {
      availability: ["available"],
      type: ["weapon"],
      rarity: ["common"],
      source: ["pathfinder-player-core"],
      trait: ["agile"],
      level: ["0:4"],
      "titan-mauler": ["eligible"],
    };
    const filters = normalizeEquipmentCatalogueFilters({ query: "accented blade", filters: requested });
    const blankFilters = normalizeEquipmentCatalogueFilters({ filters: requested });
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      projectEquipmentCatalogueFilters({
        entries,
        filters: blankFilters,
        selectedValues: requested,
        includeTitanMaulerFacet: true,
      });
      expect(normalize).not.toHaveBeenCalled();
      normalize.mockClear();

      projectEquipmentCatalogueFilters({
        entries,
        filters,
        selectedValues: requested,
        includeTitanMaulerFacet: true,
      });
      const optimizedNormalizations = normalize.mock.calls.length;
      normalize.mockClear();

      entries.filter((candidate) => matchesEquipmentCatalogueFilters(candidate, filters));
      for (const key of ["availability", "type", "rarity", "source", "trait", "titan-mauler"] as const) {
        buildEquipmentCatalogueFacetOptions(entries, filters, key, requested[key]);
      }
      buildEquipmentCatalogueLevelFacet(entries, filters);
      const referenceNormalizations = normalize.mock.calls.length;

      expect(optimizedNormalizations).toBe(entries.length);
      expect(referenceNormalizations).toBeGreaterThanOrEqual(entries.length * 8);
    } finally {
      normalize.mockRestore();
    }
  });

  it("weakly reuses normalized facts only for immutable catalogue entries", () => {
    const entries = Array.from({ length: 30 }, (_, index) =>
      immutableEntry({
        sourceUuid: `Compendium.pf2e.equipment-srd.Item.immutable-${index}`,
        documentId: `immutable-${index}`,
        name: `Immutable Blade ${index}`,
        traits: ["agile", "two-hand-d12"],
      })
    );
    const blankFilters = normalizeEquipmentCatalogueFilters({});
    const queryFilters = normalizeEquipmentCatalogueFilters({ query: "immutable blade" });
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      projectEquipmentCatalogueFilters({ entries, filters: blankFilters });
      expect(normalize).not.toHaveBeenCalled();

      projectEquipmentCatalogueFilters({ entries, filters: queryFilters });
      projectEquipmentCatalogueFilters({ entries, filters: queryFilters });
      expect(normalize).toHaveBeenCalledTimes(entries.length);
    } finally {
      normalize.mockRestore();
    }
  });
});

function referenceRank(entries: readonly EquipmentCatalogueEntry[], query: string): EquipmentCatalogueEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries
    .map((candidate, index) => ({ candidate, index, relevance: relevance(candidate, normalizedQuery) }))
    .sort(
      (left, right) =>
        Number(right.candidate.available) - Number(left.candidate.available) ||
        left.relevance - right.relevance ||
        left.index - right.index
    )
    .map(({ candidate }) => candidate);
}

function relevance(candidate: EquipmentCatalogueEntry, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const name = candidate.name.trim().toLocaleLowerCase();
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  return 3;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function entry(overrides: Partial<EquipmentCatalogueEntry> = {}): EquipmentCatalogueEntry {
  const level = overrides.level ?? 0;
  return {
    sourceUuid: `Compendium.pf2e.equipment-srd.Item.${overrides.name ?? level}`,
    packId: "pf2e.equipment-srd",
    documentId: String(overrides.name ?? level),
    name: "Hatchet",
    img: "icons/hatchet.webp",
    itemType: "weapon",
    level,
    rarity: "common",
    publicationSlug: "pathfinder-player-core",
    price: { kind: "priced", value: { gp: 1 }, copperValue: 100, per: 1, sourceQuantity: 1 },
    indexedBrowsePriceFacts: null,
    traits: [],
    ruleKeys: [],
    previewIdentity: "preview",
    available: true,
    unavailableReasons: [],
    policyDecision: {
      eligible: true,
      packId: "pf2e.equipment-srd",
      publicationSlug: "pathfinder-player-core",
      rarity: "common",
      sourceBasis: "approved-pack",
      rarityBasis: "common",
      characterAccessRef: null,
      sourceExceptionJudgmentId: null,
      rarityExceptionJudgmentId: null,
      abpTreatment: "unchanged",
    },
    ...overrides,
  };
}

function immutableEntry(overrides: Partial<EquipmentCatalogueEntry> = {}): EquipmentCatalogueEntry {
  const candidate = entry(overrides);
  return Object.freeze({
    ...candidate,
    traits: Object.freeze([...candidate.traits]),
    price: Object.freeze({ ...candidate.price }),
    policyDecision: Object.freeze({ ...candidate.policyDecision }),
  });
}
