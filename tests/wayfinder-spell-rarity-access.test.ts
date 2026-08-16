import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { PackIndexEntry } from "../src/pack/access";
import { matchesFilters } from "../src/pack/filter-policy";
import type { OptionContext, OptionRecord, PendingStep, SelectionRef } from "../src/types";
import { buildSelectionPane } from "../src/wayfinder/application/build-selection-pane-service";
import { isWayfinderStepComplete } from "../src/wayfinder/domain/step-evaluation";
import {
  canGrantRestrictedSpellRarityAccess,
  type SpellRarityCeiling,
  withRestrictedSpellRarityAccess,
} from "../src/wayfinder/spell-choice/rarity-access";

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: "witch",
  classHasSpellcasting: true,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

describe("spell rarity access", () => {
  it.each([
    ["common", ["Common Spell"]],
    ["uncommon", ["Common Spell", "Uncommon Spell"]],
    ["rare", ["Common Spell", "Rare Spell", "Uncommon Spell"]],
    ["unique", ["Common Spell", "Rare Spell", "Uncommon Spell", "Unique Spell"]],
  ] satisfies Array<
    [SpellRarityCeiling, string[]]
  >)("includes spell options through the %s ceiling by default", (ceiling, expectedNames) => {
    const optionStep = withRestrictedSpellRarityAccess(spellChoiceStep(true), ceiling, false);

    expect(
      optionPool(optionStep)
        .map((option) => option.name)
        .sort()
    ).toEqual(expectedNames);
  });

  it("keeps the per-step control below Unique and hides it at Unique", async () => {
    const step = spellChoiceStep(true);

    for (const ceiling of ["common", "uncommon", "rare"] satisfies SpellRarityCeiling[]) {
      expect(canGrantRestrictedSpellRarityAccess(step, ceiling)).toBe(true);
      expect((await buildSpellPane(step, createEmptyDraft(1), ceiling)).rarityAccess.available).toBe(true);
    }
    expect(canGrantRestrictedSpellRarityAccess(step, "unique")).toBe(false);
    expect((await buildSpellPane(step, createEmptyDraft(1), "unique")).rarityAccess.available).toBe(false);
  });

  it("raises any lower ceiling to Unique after per-step access is granted", () => {
    const restricted = spellChoiceStep(true);
    const granted = withRestrictedSpellRarityAccess(restricted, "uncommon", true);

    expect(granted).not.toBe(restricted);
    expect(granted.kind === "spell-choice" && granted.spellChoice.rarityCeiling).toBe("unique");
    expect(
      optionPool(granted)
        .map((option) => option.name)
        .sort()
    ).toEqual(["Common Spell", "Rare Spell", "Uncommon Spell", "Unique Spell"]);
    expect(granted.filters).toEqual(restricted.filters);
    expect(
      granted.kind === "spell-choice" && {
        tradition: granted.spellChoice.destination.tradition,
        cantrip: granted.spellChoice.cantrip,
        minRank: granted.spellChoice.minRank,
        maxRank: granted.spellChoice.maxRank,
      }
    ).toEqual({
      tradition: "occult",
      cantrip: true,
      minRank: 0,
      maxRank: 0,
    });
  });

  it("does not relax tradition, rank, cantrip, curriculum, or fixed-allowlist policy at Unique", () => {
    const unrestricted = withRestrictedSpellRarityAccess(spellChoiceStep(true), "unique", false);
    expect(
      optionPool(unrestricted, [
        spellEntry("eligible", "Eligible Unique", "unique"),
        spellEntry("wrong-tradition", "Wrong Tradition", "common", { traditions: ["divine"] }),
        spellEntry("wrong-rank", "Wrong Rank", "common", { cantrip: false, rank: 1 }),
      ]).map((option) => option.name)
    ).toEqual(["Eligible Unique"]);

    const curriculum = spellChoiceStep(true);
    if (curriculum.kind !== "spell-choice") {
      throw new Error("Expected spell-choice step");
    }
    curriculum.spellChoice.curriculumSpellNames = ["Curriculum Spell"];
    expect(
      optionPool(withRestrictedSpellRarityAccess(curriculum, "unique", false), [
        spellEntry("curriculum", "Curriculum Spell", "unique"),
        spellEntry("other", "Other Spell", "common"),
      ]).map((option) => option.name)
    ).toEqual(["Curriculum Spell"]);

    const allowlist = spellChoiceStep(true);
    if (allowlist.kind !== "spell-choice") {
      throw new Error("Expected spell-choice step");
    }
    allowlist.spellChoice.allowedSpellSlugs = ["allowed-spell"];
    expect(
      optionPool(withRestrictedSpellRarityAccess(allowlist, "unique", false), [
        spellEntry("allowed", "Allowed Spell", "unique", { slug: "allowed-spell" }),
        spellEntry("other", "Other Spell", "common", { slug: "other-spell" }),
      ]).map((option) => option.name)
    ).toEqual(["Allowed Spell"]);
  });

  it("keeps rules-granted restricted spells available below the global ceiling", () => {
    const step = spellChoiceStep(true);
    if (step.kind !== "spell-choice") {
      throw new Error("Expected spell-choice step");
    }
    step.spellChoice.additionalAllowedSpellNames = ["Granted Spell"];

    expect(
      optionPool(withRestrictedSpellRarityAccess(step, "common", false), [
        spellEntry("granted", "Granted Spell", "rare", { traditions: ["arcane"] }),
      ]).map((option) => option.name)
    ).toEqual(["Granted Spell"]);
  });

  it("keeps a previously selected higher-rarity spell in a draft after the ceiling is lowered", async () => {
    const step = spellChoiceStep(true);
    if (step.kind !== "spell-choice") {
      throw new Error("Expected spell-choice step");
    }
    step.spellChoice.count = 1;
    const draft = createEmptyDraft(1);
    draft.spellChoices[step.slotId] = [selection("rare-spell", "Rare Spell")];

    const pane = await buildSpellPane(step, draft, "common");
    expect(pane.selectedSpells).toEqual([
      {
        value: "pf2e.spells-srd:rare-spell",
        name: "Rare Spell",
        rankLabel: "Cantrip",
      },
    ]);
    expect(pane.options.map((option) => option.name)).toEqual(["Common Spell"]);
    expect(pane.selectedCount).toBe(1);
    expect(pane.rarityAccess).toEqual({ available: true, granted: false, locked: true });
    expect(await isWayfinderStepComplete(step, draft, {} as EffectiveBuildState)).toBe(true);
  });

  it("does not rewrite a step that already permits its defined spell pool", () => {
    const unrestricted = spellChoiceStep(false);

    expect(withRestrictedSpellRarityAccess(unrestricted, "rare", true)).toBe(unrestricted);
  });

  it("does not offer or apply an override for a fixed spell allowlist", () => {
    const fixed = spellChoiceStep(true);
    if (fixed.kind !== "spell-choice") {
      throw new Error("Expected spell-choice step");
    }
    fixed.spellChoice.allowedSpellSlugs = ["shield"];

    expect(canGrantRestrictedSpellRarityAccess(fixed, "common")).toBe(false);
    expect(withRestrictedSpellRarityAccess(fixed, "unique", true)).toBe(fixed);
  });
});

async function buildSpellPane(
  step: PendingStep,
  draft: ReturnType<typeof createEmptyDraft>,
  spellRarityCeiling: SpellRarityCeiling
) {
  const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
    draft,
    spellRarityCeiling,
    searchByStepId: new Map(),
    pickerFiltersByStepId: new Map(),
    previewValueByStepId: new Map(),
    resolveOptionContext: async () => EMPTY_CONTEXT,
    resolveDeityDocument: async () => null,
    buildContextNote: async () => null,
    resolveStepStatus: async () => `${draft.spellChoices[step.slotId]?.length ?? 0}/5 chosen`,
    getOptionsForStep: async (candidate) => optionPool(candidate),
    getPickerInfoState: () => null,
    buildPreview: async () => null,
    matchesSearch: () => true,
  });

  if (!pane || pane.kind !== "spell-choice") {
    throw new Error("Expected spell-choice pane");
  }
  return pane;
}

function optionPool(step: PendingStep, entries = rarityEntries()): OptionRecord[] {
  return entries
    .filter((entry) => matchesFilters(entry, "pf2e.spells-srd", step, EMPTY_CONTEXT, new Set()))
    .map((entry) => ({
      value: `pf2e.spells-srd:${String(entry._id)}`,
      packId: "pf2e.spells-srd",
      documentId: String(entry._id),
      uuid: `Compendium.pf2e.spells-srd.Item.${String(entry._id)}`,
      img: "spell.webp",
      itemType: "spell",
      featType: null,
      name: String(entry.name),
      level: Number(entry.system?.level?.value ?? 0),
      slug: String(entry.system?.slug ?? ""),
      traits: Array.isArray(entry.system?.traits?.value) ? entry.system.traits.value : [],
      rarity: String(entry.system?.traits?.rarity ?? "common"),
      source: "Test Source",
      label: String(entry.name),
    }));
}

function rarityEntries(): PackIndexEntry[] {
  return [
    spellEntry("common-spell", "Common Spell", "common"),
    spellEntry("uncommon-spell", "Uncommon Spell", "uncommon"),
    spellEntry("rare-spell", "Rare Spell", "rare"),
    spellEntry("unique-spell", "Unique Spell", "unique"),
  ];
}

function spellEntry(
  id: string,
  name: string,
  rarity: SpellRarityCeiling,
  options: { traditions?: string[]; cantrip?: boolean; rank?: number; slug?: string } = {}
): PackIndexEntry {
  return {
    _id: id,
    type: "spell",
    name,
    system: {
      slug: options.slug ?? id,
      level: { value: options.rank ?? (options.cantrip === false ? 1 : 0) },
      traits: {
        traditions: options.traditions ?? ["occult"],
        value: options.cantrip === false ? [] : ["cantrip"],
        rarity,
      },
    },
  };
}

function selection(documentId: string, name: string): SelectionRef {
  return {
    slotId: "spell-choice-witch-cantrips-level-1",
    packId: "pf2e.spells-srd",
    documentId,
    uuid: `Compendium.pf2e.spells-srd.Item.${documentId}`,
    itemType: "spell",
    featType: null,
    name,
    level: 0,
  };
}

function spellChoiceStep(restrictToCommon: boolean): PendingStep {
  return {
    id: "spell-choice-witch-cantrips-level-1",
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Witch cantrips",
    description: "",
    required: true,
    slotId: "spell-choice-witch-cantrips-level-1",
    filters: {
      itemType: "spell",
      packIds: ["pf2e.spells-srd"],
    },
    spellChoice: {
      slotId: "spell-choice-witch-cantrips-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "witch-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.witch-spellcasting",
      sourceName: "Witch Spellcasting",
      classSlug: "witch",
      dependsOn: "class",
      destination: {
        type: "prepared",
        key: "witch-occult-prepared",
        label: "Witch familiar",
        entryName: "Witch Spellcasting",
        tradition: "occult",
        ability: "int",
        prepared: "prepared",
      },
      count: 5,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon,
    },
  };
}
