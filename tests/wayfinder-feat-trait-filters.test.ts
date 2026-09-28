import { describe, expect, it, vi } from "vitest";
import { getPickerInfoState } from "../src/pack/picker-state.js";
import type { OptionRecord, PendingStep } from "../src/types.js";
import { derivePickerRenderProjection } from "../src/wayfinder/application/picker-render-session.js";
import {
  buildFeatTraitFilterPane,
  featTraitLabel,
  matchesFeatTraitFilters,
  normalizeFeatTraitFilters,
  supportsFeatTraitFilters,
  toggleFeatTraitFilter,
} from "../src/wayfinder/panes/feat-trait-filters.js";
import { matchesSearch } from "../src/wayfinder/panes/pick-pane.js";
import {
  activePickerFilterCount,
  emptyPickerFilterState,
  togglePickerFilterValue,
} from "../src/wayfinder/panes/picker-filters.js";

describe("feat trait browsing", () => {
  it("requires every included trait and rejects any excluded trait", () => {
    const state = { include: ["fighter", "press"], exclude: ["dedication", "multiclass"] };
    const options = [
      feat("both", ["fighter", "press"]),
      feat("one", ["fighter"]),
      feat("dedication", ["fighter", "press", "dedication"]),
      feat("multiclass", ["fighter", "press", "multiclass"]),
      feat("none", []),
    ];
    expect(options.filter((option) => matchesFeatTraitFilters(option, state)).map((option) => option.name)).toEqual([
      "both",
    ]);
    expect(matchesFeatTraitFilters(options[4]!, { include: [], exclude: [] })).toBe(true);
  });

  it("uses visible traits without mistaking technical tags for traits", () => {
    const option = { ...feat("visible", ["hb_starlit"]), traits: ["fighter", "internal-tag", "hb_starlit"] };
    expect(
      buildFeatTraitFilterPane([option], { include: [], exclude: [] }, true).options.map((row) => row.value)
    ).toEqual(["hb_starlit"]);
    expect(matchesFeatTraitFilters(option, { include: ["internal-tag"], exclude: [] })).toBe(false);
    expect(featTraitLabel("hb_starlit")).toBe("Starlit");
  });

  it("normalizes conflicts and moves a trait between include, exclude and neutral", () => {
    expect(normalizeFeatTraitFilters({ include: [" Fighter ", "fighter", ""], exclude: ["FIGHTER"] })).toEqual({
      include: [],
      exclude: ["fighter"],
    });
    const included = toggleFeatTraitFilter(undefined, "dedication", "include");
    const excluded = toggleFeatTraitFilter(included, "dedication", "exclude");
    expect(excluded).toEqual({ include: [], exclude: ["dedication"] });
    expect(toggleFeatTraitFilter(excluded, "dedication", "exclude")).toEqual({ include: [], exclude: [] });
  });

  it("preserves trait filters when changing other facets and counts them", () => {
    const initial = { ...emptyPickerFilterState(), traits: { include: ["fighter"], exclude: ["dedication"] } };
    const next = togglePickerFilterValue(initial, "rarity", "common");
    expect(next.traits).toEqual(initial.traits);
    expect(activePickerFilterCount(next)).toBe(3);
  });

  it("keeps selected zero-count traits removable and computes counts with other traits", () => {
    const pane = buildFeatTraitFilterPane(
      [feat("press", ["fighter", "press"]), feat("dedication", ["archetype", "dedication"])],
      { include: ["fighter"], exclude: ["dedication", "missing"] },
      true
    );
    expect(pane.options.find((row) => row.value === "dedication")).toMatchObject({ count: 0, excluded: true });
    expect(pane.options.find((row) => row.value === "missing")).toMatchObject({ count: 0, active: true });
    expect(pane.options.find((row) => row.value === "press")?.count).toBe(1);
    expect(pane.hideDedications).toBe(true);
  });

  it("resolves configured PF2E labels and falls back for unknown traits", () => {
    vi.stubGlobal("CONFIG", { PF2E: { featTraits: { press: "PF2E.TraitPress" } } });
    vi.stubGlobal("game", { i18n: { localize: () => "Press (localized)" } });
    try {
      expect(featTraitLabel("press")).toBe("Press (localized)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "class-feat",
    "general-feat",
    "skill-feat",
  ] as const)("composes filters in the %s pane without changing prepared choices", (slotKind) => {
    const options = [
      feat("one", ["fighter", "press"]),
      feat("two", ["fighter", "dedication"]),
      { ...feat("three", ["fighter", "press"]), level: 4 },
      { ...feat("four", ["fighter", "press"]), rarity: "rare" },
    ];
    const step = featStep(slotKind);
    const inputs = {
      step,
      options,
      suppressedOptions: [
        { uuid: "test:hidden", name: "Hidden dedication", reason: "unvalidated-eligibility" as const },
      ],
      selectedValues: [options[1]!.value],
      filterKinds: ["rarity", "source"] as const,
      optionContext: {
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        heritageTraits: [],
        classSlug: "fighter",
        classHasSpellcasting: false,
        deitySelected: false,
        sanctification: null,
        hasDedicationFeat: false,
      },
      getPickerInfoState,
      matchesSearch,
    };
    const before = JSON.stringify(inputs);
    const state = {
      search: "",
      openFilterKind: "traits" as const,
      filterState: {
        ...emptyPickerFilterState(),
        rarity: ["common"],
        source: ["Player Core"],
        traits: { include: ["fighter"], exclude: ["dedication"] },
      },
    };
    const derive = (filterState = state.filterState, search = "") =>
      derivePickerRenderProjection(
        { ...inputs, filterKinds: [...inputs.filterKinds] },
        { ...state, filterState, search }
      );
    expect(derive().visibleOptions.map((option) => option.name)).toEqual(["one"]);
    expect(derive(state.filterState, "absent").infoState?.title).toBe("No choices match this search and filters");
    expect(
      derive(state.filterState, "absent").traitFilter?.options.find((row) => row.value === "fighter")
    ).toMatchObject({ included: true, count: 0 });
    const cleared = derivePickerRenderProjection(
      { ...inputs, filterKinds: [...inputs.filterKinds] },
      { search: "", openFilterKind: null, filterState: emptyPickerFilterState() }
    );
    expect(cleared.visibleOptions.map((option) => option.name)).toEqual(["one", "two", "four"]);
    expect(cleared.suppressionNotice?.count).toBe(1);
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it("does not add trait browsing to unrelated pickers", () => {
    expect(supportsFeatTraitFilters({ ...featStep("class-feat"), slotKind: "ancestry-feat" })).toBe(false);
  });
});

function feat(name: string, traits: string[]): OptionRecord {
  return {
    value: `test:${name}`,
    uuid: `Compendium.test.Item.${name}`,
    packId: "test",
    documentId: name,
    img: "",
    itemType: "feat",
    featType: "class",
    name,
    level: 2,
    slug: name,
    traits,
    featTraits: traits,
    rarity: "common",
    source: "Player Core",
    label: name,
  };
}

function featStep(slotKind: "class-feat" | "general-feat" | "skill-feat"): Extract<PendingStep, { kind: "pick-item" }> {
  return {
    id: `${slotKind}-level-2`,
    slotId: `${slotKind}-level-2`,
    kind: "pick-item",
    slotKind,
    level: 2,
    title: "Feat",
    description: "Choose",
    required: true,
    filters: { itemType: "feat", maxLevel: 2 },
  };
}
