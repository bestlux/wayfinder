import { describe, expect, it } from "vitest";
import type { OptionRecord, PendingStep } from "../src/types";
import {
  activePickerFilterCount,
  buildPickerFilterGroups,
  buildPickerLevelRangeGroup,
  emptyPickerFilterState,
  matchesPickerFilters,
  matchesPickerLegalLevelBounds,
  matchesPickerLevelRange,
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
        range: false,
        options: [
          { value: "common", label: "Common", count: 2, selected: true },
          { value: "rare", label: "Rare", count: 1, selected: false },
        ],
        values: [],
      },
      {
        key: "source",
        label: "Source",
        summaryLabel: "All",
        selectedCount: 0,
        range: false,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 1, selected: false },
          { value: "Player Core", label: "Player Core", count: 1, selected: false },
        ],
        values: [],
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
        range: false,
        options: [
          { value: "common", label: "Common", count: 0, selected: true },
          { value: "rare", label: "Rare", count: 1, selected: false },
        ],
        values: [],
      },
      {
        key: "source",
        label: "Source",
        summaryLabel: "Lost Omens",
        selectedCount: 1,
        range: false,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 0, selected: true },
          { value: "Player Core", label: "Player Core", count: 1, selected: false },
        ],
        values: [],
      },
    ]);
  });

  it("builds a bounded spell-rank range from the values present in the slot", () => {
    const group = buildPickerLevelRangeGroup(
      [
        option("Detect Magic", "common", "Player Core", 1, ["cantrip"]),
        option("Bless", "common", "Player Core", 1),
        option("Dispel Magic", "common", "Player Core", 2),
        option("See the Unseen", "common", "Player Core", 2),
      ],
      spellStep(0, 2),
      null
    );

    expect(group).toMatchObject({
      key: "level",
      label: "Rank",
      summaryLabel: "All",
      selectedCount: 0,
      minimum: 0,
      maximum: 2,
      active: false,
    });
    expect(group?.values.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 0, label: "Cantrip" },
      { value: 1, label: "Rank 1" },
      { value: 2, label: "Rank 2" },
    ]);
  });

  it("clamps a level range to legal values and keeps an out-of-range selection visible", () => {
    const options = [
      option("First Step", "common", "Player Core", 1),
      option("Second Step", "common", "Player Core", 2),
      option("Fourth Step", "common", "Player Core", 4),
      option("Sixth Step", "common", "Player Core", 6),
      option("Too High", "common", "Player Core", 8),
      option("Unknown Level", "common", "Player Core", null),
    ];
    const group = buildPickerLevelRangeGroup(options, featStep(6), { minimum: 2, maximum: 5 });
    const selected = new Set([options[3]!.value]);

    expect(group).toMatchObject({ minimum: 2, maximum: 4, summaryLabel: "Level 2–Level 4", active: true });
    expect(
      options.filter((entry) => matchesPickerLevelRange(entry, group, selected, featStep(6))).map((entry) => entry.name)
    ).toEqual(["Second Step", "Fourth Step", "Sixth Step"]);
  });

  it("enforces legal slot bounds even when there is no meaningful range control", () => {
    const legal = option("Legal", "common", "Player Core", 1);
    const tooHigh = option("Too High", "common", "Player Core", 2);
    const step = featStep(1);

    expect([legal, tooHigh].filter((entry) => matchesPickerLegalLevelBounds(entry, step, new Set()))).toEqual([legal]);
    expect(matchesPickerLegalLevelBounds(tooHigh, step, new Set([tooHigh.value]))).toBe(true);
    expect(buildPickerLevelRangeGroup([legal, tooHigh], step, null)).toBeNull();
  });
});

function featStep(maxLevel: number): PendingStep {
  return {
    id: "class-feat-level-6",
    level: 6,
    kind: "pick-item",
    slotKind: "class-feat",
    title: "Class feat",
    description: "",
    required: true,
    slotId: "class-feat-level-6",
    filters: { itemType: "feat", maxLevel },
  };
}

function spellStep(minRank: number, maxRank: number): PendingStep {
  return {
    id: "spell-choice-wizard-level-2",
    level: 2,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Spell",
    description: "",
    required: true,
    slotId: "spell-choice-wizard-level-2",
    filters: { itemType: "spell" },
    spellChoice: {
      slotId: "spell-choice-wizard-level-2",
      sourcePackId: "test.pack",
      sourceDocumentId: "wizard",
      sourceUuid: "Compendium.test.pack.Item.wizard",
      sourceName: "Wizard Spellcasting",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "prepared",
        key: "wizard-arcane",
        label: "Wizard spellbook",
        entryName: "Wizard Spellcasting",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 1,
      minRank,
      maxRank,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

function option(
  name: string,
  rarity: string | null,
  source: string | null,
  level: number | null = 1,
  traits: string[] = []
): OptionRecord {
  return {
    value: `test.pack:${name.toLowerCase().replace(/\s+/g, "-")}`,
    packId: "test.pack",
    documentId: name.toLowerCase().replace(/\s+/g, "-"),
    uuid: `Compendium.test.pack.Item.${name.toLowerCase().replace(/\s+/g, "-")}`,
    img: `${name}.webp`,
    itemType: "feat",
    featType: null,
    name,
    level,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    traits,
    rarity,
    source,
    label: name,
  };
}
