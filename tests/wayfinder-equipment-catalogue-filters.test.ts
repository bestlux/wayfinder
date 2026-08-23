import { describe, expect, it } from "vitest";
import {
  buildEquipmentCatalogueFacetOptions,
  buildEquipmentCatalogueLevelFacet,
  isTitanMaulerEligibleEntry,
  matchesEquipmentCatalogueFilters,
  normalizeEquipmentCatalogueFilters,
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
});

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
