import { describe, expect, it } from "vitest";
import type { OptionRecord } from "../src/types";
import {
  activePickerFilterCount,
  buildPickerFilterGroups,
  emptyPickerFilterState,
  matchesPickerFilters,
  togglePickerFilterValue,
} from "../src/wayfinder/panes/picker-filters";

describe("wayfinder picker filters", () => {
  it("toggles composable rarity and source filters", () => {
    const withRarity = togglePickerFilterValue(emptyPickerFilterState(), "rarity", "common");
    const withSource = togglePickerFilterValue(withRarity, "source", "Player Core");

    expect(activePickerFilterCount(withSource)).toBe(2);
    expect(matchesPickerFilters(option("Force Barrage", "common", "Player Core"), withSource)).toBe(true);
    expect(matchesPickerFilters(option("Fireball", "rare", "Player Core"), withSource)).toBe(false);
    expect(matchesPickerFilters(option("Bless", "common", "Lost Omens"), withSource)).toBe(false);
  });

  it("builds filter groups using counts constrained by the other active filters", () => {
    const state = {
      rarity: ["common"],
      source: [],
    };

    const groups = buildPickerFilterGroups(
      [
        option("Force Barrage", "common", "Player Core"),
        option("Bless", "common", "Lost Omens"),
        option("Fireball", "rare", "Player Core"),
      ],
      state
    );

    expect(groups).toEqual([
      {
        key: "rarity",
        label: "Rarity",
        summaryLabel: "Common",
        selectedCount: 1,
        options: [
          { value: "common", label: "Common", count: 2, selected: true },
          { value: "rare", label: "Rare", count: 1, selected: false },
        ],
      },
      {
        key: "source",
        label: "Source",
        summaryLabel: "All",
        selectedCount: 0,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 1, selected: false },
          { value: "Player Core", label: "Player Core", count: 1, selected: false },
        ],
      },
    ]);
  });

  it("preserves selected filters when other active filters reduce their counts to zero", () => {
    const groups = buildPickerFilterGroups(
      [option("Force Barrage", "common", "Player Core"), option("Fireball", "rare", "Lost Omens")],
      {
        rarity: ["common"],
        source: ["Lost Omens"],
      }
    );

    expect(groups).toEqual([
      {
        key: "rarity",
        label: "Rarity",
        summaryLabel: "Common",
        selectedCount: 1,
        options: [
          { value: "common", label: "Common", count: 0, selected: true },
          { value: "rare", label: "Rare", count: 1, selected: false },
        ],
      },
      {
        key: "source",
        label: "Source",
        summaryLabel: "Lost Omens",
        selectedCount: 1,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 0, selected: true },
          { value: "Player Core", label: "Player Core", count: 1, selected: false },
        ],
      },
    ]);
  });
});

function option(name: string, rarity: string | null, source: string | null): OptionRecord {
  return {
    value: `test.pack:${name.toLowerCase().replace(/\s+/g, "-")}`,
    packId: "test.pack",
    documentId: name.toLowerCase().replace(/\s+/g, "-"),
    uuid: `Compendium.test.pack.Item.${name.toLowerCase().replace(/\s+/g, "-")}`,
    img: `${name}.webp`,
    itemType: "feat",
    featType: null,
    name,
    level: 1,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    traits: [],
    rarity,
    source,
    label: name,
  };
}
