import { beforeEach, describe, expect, it } from "vitest";
import { clearPackServiceCache } from "../src/pack/access";
import { getOptionsForStep } from "../src/pack/options";
import { getPickerBlockedState, getPickerInfoState } from "../src/pack/picker-state";
import type { OptionContext, PendingStep, PickItemSlotKind } from "../src/types";
import { createPickItemStep } from "../src/wayfinder/domain/step-types";

const testGlobals = globalThis as typeof globalThis & { game: any };

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  classHasSpellcasting: false,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

describe("pack picker states", () => {
  beforeEach(() => {
    clearPackServiceCache();
    testGlobals.game = {
      packs: new Map(),
      settings: {
        get: () => "",
      },
    } as any;
  });

  it("keeps unified-theory wizard bonus spell choices unblocked without a curriculum list", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("shield", "Shield", 1, ["arcane"], ["cantrip"]),
      spellEntry("force-barrage", "Force Barrage", 1, ["arcane"], []),
      spellEntry("heal", "Heal", 1, ["divine"], []),
      spellEntry("fireball", "Fireball", 3, ["arcane"], []),
    ]);

    const step: PendingStep = {
      id: "spell-choice-wizard-unified-rank-1-level-1",
      level: 1,
      kind: "spell-choice",
      slotKind: "spell-choice",
      title: "Unified theory bonus spell",
      description: "",
      required: true,
      slotId: "spell-choice-wizard-unified-rank-1-level-1",
      filters: {
        itemType: "spell",
      },
      spellChoice: {
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "school-of-unified-magical-theory",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.school-of-unified-magical-theory",
        sourceName: "School of Unified Magical Theory",
        classSlug: "wizard",
        dependsOn: "class-branch",
        destination: {
          type: "spellbook",
          key: "wizard-arcane-prepared",
          label: "Wizard spellbook",
          entryName: "Arcane Prepared Spells",
          tradition: "arcane",
          ability: "int",
          prepared: "prepared",
        },
        count: 1,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        requiresCurriculum: false,
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
      },
    };

    const context = {
      ...EMPTY_CONTEXT,
      classSlug: "wizard",
    };

    const options = await getOptionsForStep(step, context);

    expect(options.map((option) => option.name)).toEqual(["Force Barrage"]);
    expect(getPickerBlockedState(step, context)).toBeNull();
    expect(getPickerInfoState(step, context, options.length, options.length, "")).toBeNull();
  });

  it("distinguishes blocked, empty-source, and search-empty picker states", () => {
    const heritageStep = makeStep("heritage", {
      itemType: "heritage",
    });

    expect(getPickerBlockedState(heritageStep, EMPTY_CONTEXT)?.tone).toBe("blocked");
    expect(getPickerInfoState(heritageStep, EMPTY_CONTEXT, 0, 0, "")?.tone).toBe("blocked");
    expect(
      getPickerInfoState(
        heritageStep,
        {
          ...EMPTY_CONTEXT,
          ancestrySlug: "elf",
          ancestryTraits: ["elf"],
        },
        0,
        0,
        ""
      )?.tone
    ).toBe("empty");
    expect(
      getPickerInfoState(
        heritageStep,
        {
          ...EMPTY_CONTEXT,
          ancestrySlug: "elf",
          ancestryTraits: ["elf"],
        },
        2,
        0,
        "zzz"
      )?.tone
    ).toBe("search");
    expect(
      getPickerInfoState(
        heritageStep,
        {
          ...EMPTY_CONTEXT,
          ancestrySlug: "elf",
          ancestryTraits: ["elf"],
        },
        2,
        0,
        "",
        true
      )?.title
    ).toBe("No choices match current filters");

    expect(
      getPickerInfoState(
        makeStep("skill-feat", {
          itemType: "feat",
          featTypes: ["skill"],
          maxLevel: 1,
        }),
        EMPTY_CONTEXT,
        0,
        0,
        ""
      )?.message
    ).toContain("Wayfinder hides direct options that require unsupported follow-up choices");
  });

  it("blocks deity-dependent class branches until a deity is chosen", () => {
    const step: PendingStep = {
      id: "class-branch-cause-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Cause",
      description: "Choose a cause.",
      required: true,
      slotId: "class-branch-cause-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
      },
      branch: {
        slotId: "class-branch-cause-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "cause",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.cause",
        selectorName: "Cause",
        selectorRuleIndex: 0,
        flag: "cause",
        optionTag: "champion-cause",
        classSlug: "champion",
        dependsOn: "deity",
      },
    };

    expect(
      getPickerBlockedState(step, {
        ...EMPTY_CONTEXT,
        classSlug: "champion",
        deitySelected: false,
      })?.tone
    ).toBe("blocked");
  });
});

function makeStep(slotKind: PickItemSlotKind, filters: PendingStep["filters"]): PendingStep {
  return createPickItemStep(slotKind, 1, "Test Step", "Test description", filters ?? { itemType: "feat" });
}

function setPack(id: string, entries: any[]): void {
  testGlobals.game.packs.set(id, {
    metadata: { id },
    getIndex: async () => entries,
  });
}

function spellEntry(slug: string, name: string, level: number, traditions: string[], traits: string[]): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "spell",
    system: {
      slug,
      level: {
        value: level,
      },
      traits: {
        rarity: "common",
        traditions,
        value: traits,
      },
      publication: {
        title: "Player Core",
      },
    },
  };
}
