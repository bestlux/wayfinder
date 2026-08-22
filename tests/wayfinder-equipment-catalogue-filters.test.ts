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
