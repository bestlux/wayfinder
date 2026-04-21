import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { OptionContext, OptionRecord, PendingStep, SelectionRef } from "../src/types";
import { buildSelectionPane } from "../src/wayfinder/application/build-selection-pane-service";

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: "champion",
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

describe("wayfinder selection pane service", () => {
  it("builds a blocked class-choice pane when a deity-dependent choice has no deity context", async () => {
    const draft = createEmptyDraft(1);
    const step: PendingStep = {
      id: "class-choice-champion-sanctification-level-1",
      level: 1,
      kind: "class-choice",
      slotKind: "class-choice",
      title: "Sanctification",
      description: "",
      required: true,
      slotId: "class-choice-champion-sanctification-level-1",
      classChoice: {
        slotId: "class-choice-champion-sanctification-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "deity-champion",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.deity-champion",
        sourceName: "Deity (Champion)",
        sourceRuleIndex: 2,
        flag: "sanctification",
        classSlug: "champion",
        dependsOn: "deity",
        options: [
          { value: "holy", label: "Holy", img: null, detail: null },
          { value: "unholy", label: "Unholy", img: null, detail: null },
        ],
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      previewValueByStepId: new Map(),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => null,
      resolveStepStatus: async () => "Choose one",
      getOptionsForStep: async () => [],
      getPickerInfoState: () => null,
      buildPreview: async () => null,
      matchesSearch: () => true,
    });

    expect(pane?.kind).toBe("class-choice");
    if (!pane || pane.kind !== "class-choice") {
      throw new Error("Expected a class-choice pane");
    }
    expect(pane.blocked).toBe(true);
    expect(pane.blockedMessage).toContain("depends on the drafted deity");
  });

  it("builds a pick-item pane with filtered options, selected value, and preview state", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["heritage-level-1"] = selection("heritage-level-1", "heritage", "wintertouched");
    const step: PendingStep = {
      id: "heritage-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "heritage",
      title: "Heritage",
      description: "",
      required: true,
      slotId: "heritage-level-1",
      filters: { itemType: "heritage" },
    };
    const options: OptionRecord[] = [
      option("test.pack:wintertouched", "Wintertouched"),
      option("test.pack:aiuvarin", "Aiuvarin"),
    ];

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map([[step.id, "winter"]]),
      previewValueByStepId: new Map([[step.id, "test.pack:wintertouched"]]),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => "Filtered by ancestry context",
      resolveStepStatus: async () => "Wintertouched",
      getOptionsForStep: async () => options,
      getPickerInfoState: () => null,
      buildPreview: async () => ({
        title: "Wintertouched",
        img: "wintertouched.webp",
        source: "Lost Omens",
        rarity: "common",
        tags: [],
        details: [],
        description: "Preview",
        selected: true,
        selectedLabel: "Selected",
        value: "test.pack:wintertouched",
      }),
      matchesSearch: (entry, search) => entry.name.toLowerCase().includes(search),
    });

    expect(pane?.kind).toBe("pick-item");
    if (!pane || pane.kind !== "pick-item") {
      throw new Error("Expected a pick-item pane");
    }
    expect(pane.selectedValue).toBe("test.pack:wintertouched");
    expect(pane.contextNote).toBe("Filtered by ancestry context");
    expect(pane.options.map((entry) => entry.name)).toEqual(["Wintertouched"]);
    expect(pane.preview?.value).toBe("test.pack:wintertouched");
  });

  it("builds a singleton-choice pane from drafted singleton selections", async () => {
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-background-sponsored-by-family-academySkill-level-1"] = "society";
    const step: PendingStep = {
      id: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
      level: 1,
      kind: "singleton-choice",
      slotKind: "singleton-choice",
      title: "Academy Skill",
      description: "",
      required: true,
      slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
      singletonChoice: {
        slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
        sourceItemType: "background",
        sourcePackId: "pf2e.backgrounds",
        sourceDocumentId: "sponsored-by-family",
        sourceUuid: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
        sourceName: "Sponsored by Family",
        sourceRuleIndex: 0,
        flag: "academySkill",
        prompt: "Choose your trained skill",
        options: [
          { value: "diplomacy", label: "Diplomacy", img: null, detail: null },
          { value: "society", label: "Society", img: null, detail: null },
        ],
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      previewValueByStepId: new Map(),
      resolveOptionContext: async () => {
        throw new Error("Expected singleton-choice pane to skip option context resolution");
      },
      resolveDeityDocument: async () => null,
      buildContextNote: async () => {
        throw new Error("Expected singleton-choice pane to skip context note building");
      },
      resolveStepStatus: async () => "Society",
      getOptionsForStep: async () => {
        throw new Error("Expected singleton-choice pane to skip option loading");
      },
      getPickerInfoState: () => {
        throw new Error("Expected singleton-choice pane to skip picker info state");
      },
      buildPreview: async () => {
        throw new Error("Expected singleton-choice pane to skip preview building");
      },
      matchesSearch: () => {
        throw new Error("Expected singleton-choice pane to skip search filtering");
      },
    });

    expect(pane?.kind).toBe("singleton-choice");
    if (!pane || pane.kind !== "singleton-choice") {
      throw new Error("Expected a singleton-choice pane");
    }
    expect(pane.completed).toBe(true);
    expect(pane.selectedLabel).toBe("Society");
    expect(pane.sourceName).toBe("Sponsored by Family");
    expect(pane.sourceItemType).toBe("background");
    expect(pane.options).toEqual([
      { value: "diplomacy", label: "Diplomacy", img: null, detail: null, selected: false },
      { value: "society", label: "Society", img: null, detail: null, selected: true },
    ]);
  });

  it("builds a class-branch pane from branch selections instead of generic selections", async () => {
    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-cause-level-1"] = {
      ...selection("class-branch-cause-level-1", "feat", "redeemer"),
      name: "Redeemer",
    };
    const step: PendingStep = {
      id: "class-branch-cause-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Cause",
      description: "",
      required: true,
      slotId: "class-branch-cause-level-1",
      filters: { itemType: "feat", featTypes: ["classfeature"], maxLevel: 1 },
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

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      previewValueByStepId: new Map([[step.id, "test.pack:redeemer"]]),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => ({ name: "Iomedae" }),
      buildContextNote: async () => "Champion causes",
      resolveStepStatus: async () => "Redeemer",
      getOptionsForStep: async () => [
        option("test.pack:redeemer", "Redeemer"),
        option("test.pack:liberator", "Liberator"),
      ],
      getPickerInfoState: () => null,
      buildPreview: async () => ({
        title: "Redeemer",
        img: "redeemer.webp",
        source: "Player Core",
        rarity: "common",
        tags: [],
        details: [],
        description: "Preview",
        selected: true,
        selectedLabel: "Selected",
        value: "test.pack:redeemer",
      }),
      matchesSearch: () => true,
    });

    expect(pane?.kind).toBe("pick-item");
    if (!pane || pane.kind !== "pick-item") {
      throw new Error("Expected a pick-item pane for class-branch");
    }
    expect(pane.selectedValue).toBe("test.pack:redeemer");
    expect(pane.selectedLabel).toBe("Redeemer");
    expect(pane.contextNote).toBe("Champion causes");
  });

  it("builds a spell-choice pane with drafted selections and adjusted preview labels", async () => {
    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-cleric-rank-1-level-1"] = [
      selection("spell-choice-cleric-rank-1-level-1", "spell", "heal"),
    ];
    const step: PendingStep = {
      id: "spell-choice-cleric-rank-1-level-1",
      level: 1,
      kind: "spell-choice",
      slotKind: "spell-choice",
      title: "Cleric prepared spells",
      description: "",
      required: true,
      slotId: "spell-choice-cleric-rank-1-level-1",
      filters: { itemType: "spell" },
      spellChoice: {
        slotId: "spell-choice-cleric-rank-1-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "cleric-spellcasting",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
        sourceName: "Cleric Spellcasting",
        classSlug: "cleric",
        dependsOn: "class",
        destination: {
          type: "prepared",
          key: "cleric-divine-prepared",
          label: "Divine prepared spells",
          entryName: "Divine Prepared Spells",
          tradition: "divine",
          ability: "wis",
          prepared: "prepared",
        },
        count: 2,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      previewValueByStepId: new Map([[step.id, "test.pack:heal"]]),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => "Divine list",
      resolveStepStatus: async () => "1/2 chosen",
      getOptionsForStep: async () => [option("test.pack:heal", "Heal"), option("test.pack:bless", "Bless")],
      getPickerInfoState: () => null,
      buildPreview: async () => ({
        title: "Heal",
        img: "heal.webp",
        source: "Player Core",
        rarity: "common",
        tags: [],
        details: [],
        description: "Preview",
        selected: true,
        selectedLabel: "Selected",
        value: "test.pack:heal",
      }),
      matchesSearch: () => true,
    });

    expect(pane?.kind).toBe("spell-choice");
    if (!pane || pane.kind !== "spell-choice") {
      throw new Error("Expected a spell-choice pane");
    }
    expect(pane.selectedCount).toBe(1);
    expect(pane.remainingCount).toBe(1);
    expect(pane.preview?.selectedLabel).toBe("Added to draft");
  });
});

function option(value: string, name: string): OptionRecord {
  return {
    value,
    packId: "test.pack",
    documentId: value.split(":")[1] ?? name.toLowerCase(),
    uuid: `Compendium.test.pack.Item.${value.split(":")[1] ?? name.toLowerCase()}`,
    img: `${name}.webp`,
    itemType: "feat",
    featType: null,
    name,
    level: 1,
    slug: name.toLowerCase(),
    traits: [],
    rarity: "common",
    source: "Player Core",
    label: name,
  };
}

function selection(slotId: string, itemType: string, documentId: string): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: null,
    name: documentId,
    level: 1,
  };
}
