import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { LanguageChoiceStep, OptionContext, OptionRecord, PendingStep, SelectionRef } from "../src/types";
import { buildSelectionPane } from "../src/wayfinder/application/build-selection-pane-service";
import { buildLanguageChoicePane } from "../src/wayfinder/panes/language-choice-pane";
import { createSpellRarityAttestation } from "../src/wayfinder/spell-choice/rarity-attestation";

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: "champion",
  classHasSpellcasting: false,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

describe("wayfinder selection pane service", () => {
  it("builds the dedicated class-archetype pane with an explicit Standard option", async () => {
    const draft = createEmptyDraft(1);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "standard";
    const step: PendingStep = {
      id: "class-archetype-doctrine-level-1",
      level: 1,
      kind: "class-archetype",
      slotKind: "class-archetype",
      title: "Doctrine: standard or archetype",
      description: "",
      required: true,
      slotId: "class-archetype-doctrine-level-1",
      classArchetype: {
        slotId: "class-archetype-doctrine-level-1",
        standardValue: "standard",
        sourceName: "Doctrine",
        selector: {
          slotId: "class-branch-doctrine-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "doctrine",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.doctrine",
          selectorName: "Doctrine",
          selectorRuleIndex: 0,
          flag: "doctrine",
          optionTag: "cleric-doctrine",
          classSlug: "cleric",
          dependsOn: "class",
        },
        options: [
          { value: "standard", label: "Standard class path", img: null, detail: null },
          { value: "battle-creed", label: "Battle Creed", img: null, detail: null },
        ],
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      pickerFiltersByStepId: new Map(),
      previewValueByStepId: new Map(),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => null,
      resolveStepStatus: async () => "Standard class path",
      getOptionsForStep: async () => [],
      getPickerInfoState: () => null,
      buildPreview: async () => null,
      matchesSearch: () => true,
    });

    expect(pane).toMatchObject({
      kind: "class-archetype",
      eyebrow: "Class Archetype",
      action: "select-class-archetype",
      completed: true,
      selectedLabel: "Standard class path",
      options: [
        { value: "standard", selected: true },
        { value: "battle-creed", selected: false },
      ],
    });
  });

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
      pickerFiltersByStepId: new Map(),
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

  it("builds a pick-item pane with composable search and picker filters", async () => {
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
      option("test.pack:wintertouched", "Wintertouched", "common", "Player Core"),
      option("test.pack:winterwise", "Winterwise", "rare", "Player Core"),
      option("test.pack:winterbound", "Winterbound", "common", "Lost Omens"),
    ];

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map([[step.id, "winter"]]),
      pickerFiltersByStepId: new Map([[step.id, { levelRange: null, rarity: ["common"], source: ["Player Core"] }]]),
      openPickerFilterMenu: { stepId: step.id, filterKind: "source" },
      previewValueByStepId: new Map([[step.id, "test.pack:wintertouched"]]),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => "Filtered by ancestry context",
      resolveStepStatus: async () => "Wintertouched",
      getOptionsForStep: async () => options,
      getOptionQueryForStep: async () => ({
        options,
        suppressedOptions: [
          {
            uuid: "Compendium.test.pack.Item.hidden-choice",
            name: "Hidden Choice",
            reason: "unvalidated-granted-choice",
          },
        ],
      }),
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
    expect(pane.activeFilterCount).toBe(2);
    expect(pane.suppressionNotice?.count).toBe(1);
    expect(pane.filterGroups).toEqual([
      {
        key: "rarity",
        label: "Rarity",
        summaryLabel: "Common",
        selectedCount: 1,
        isOpen: false,
        range: false,
        options: [
          { value: "common", label: "Common", count: 1, selected: true },
          { value: "rare", label: "Rare", count: 1, selected: false },
        ],
        values: [],
      },
      {
        key: "source",
        label: "Source",
        summaryLabel: "Player Core",
        selectedCount: 1,
        isOpen: true,
        range: false,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 1, selected: false },
          { value: "Player Core", label: "Player Core", count: 1, selected: true },
        ],
        values: [],
      },
    ]);
    expect(pane.preview?.value).toBe("test.pack:wintertouched");
  });

  it("keeps selected filter chips visible when active filters eliminate every searched option", async () => {
    const draft = createEmptyDraft(1);
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
      option("test.pack:wintertouched", "Wintertouched", "common", "Player Core"),
      option("test.pack:winterwise", "Winterwise", "rare", "Lost Omens"),
    ];

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map([[step.id, "winter"]]),
      pickerFiltersByStepId: new Map([[step.id, { levelRange: null, rarity: ["common"], source: ["Lost Omens"] }]]),
      openPickerFilterMenu: { stepId: step.id, filterKind: "source" },
      previewValueByStepId: new Map(),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => null,
      resolveStepStatus: async () => "Choose one",
      getOptionsForStep: async () => options,
      getPickerInfoState: (_step, _context, optionCount, filteredCount, search, hasActiveFilters) => ({
        tone: "empty",
        eyebrow: `${filteredCount}/${optionCount}`,
        title: hasActiveFilters ? "No options match these filters" : "No options match",
        message: `Search ${search}`,
      }),
      buildPreview: async () => null,
      matchesSearch: (entry, search) => entry.name.toLowerCase().includes(search),
    });

    expect(pane?.kind).toBe("pick-item");
    if (!pane || pane.kind !== "pick-item") {
      throw new Error("Expected a pick-item pane");
    }
    expect(pane.options).toEqual([]);
    expect(pane.activeFilterCount).toBe(2);
    expect(pane.filterGroups).toEqual([
      {
        key: "rarity",
        label: "Rarity",
        summaryLabel: "Common",
        selectedCount: 1,
        isOpen: false,
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
        isOpen: true,
        range: false,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 0, selected: true },
          { value: "Player Core", label: "Player Core", count: 1, selected: false },
        ],
        values: [],
      },
    ]);
    expect(pane.infoState?.title).toBe("No options match these filters");
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
        predicate: [],
        rollOption: null,
        options: [
          { value: "diplomacy", label: "Diplomacy", img: null, detail: null },
          { value: "society", label: "Society", img: null, detail: null },
        ],
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      pickerFiltersByStepId: new Map(),
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

  it("builds a language-choice pane from drafted language selections", async () => {
    const draft = createEmptyDraft(1);
    draft.languageChoices["language-choice-level-1"] = ["draconic"];
    const step: PendingStep = {
      id: "language-choice-level-1",
      level: 1,
      kind: "language-choice",
      slotKind: "language-choice",
      title: "Bonus languages",
      description: "",
      required: true,
      slotId: "language-choice-level-1",
      languageChoice: {
        slotId: "language-choice-level-1",
        sourceItemType: "ancestry",
        sourceName: "Human",
        grantedLanguages: ["Common"],
        count: 2,
        options: [
          { value: "draconic", label: "Draconic", requiresGmApproval: false },
          { value: "dwarven", label: "Dwarven", requiresGmApproval: true },
        ],
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      pickerFiltersByStepId: new Map(),
      previewValueByStepId: new Map(),
      resolveOptionContext: async () => {
        throw new Error("Expected language-choice pane to skip option context resolution");
      },
      resolveDeityDocument: async () => null,
      buildContextNote: async () => {
        throw new Error("Expected language-choice pane to skip context note building");
      },
      resolveStepStatus: async () => "1/2 chosen",
      getOptionsForStep: async () => {
        throw new Error("Expected language-choice pane to skip option loading");
      },
      getPickerInfoState: () => {
        throw new Error("Expected language-choice pane to skip picker info state");
      },
      buildPreview: async () => {
        throw new Error("Expected language-choice pane to skip preview building");
      },
      matchesSearch: () => {
        throw new Error("Expected language-choice pane to skip search filtering");
      },
    });

    expect(pane?.kind).toBe("language-choice");
    if (!pane || pane.kind !== "language-choice") {
      throw new Error("Expected a language-choice pane");
    }
    expect(pane.selectedValues).toEqual(["draconic"]);
    expect(pane.grantedLanguages).toEqual(["Common"]);
    expect(pane.requiredCount).toBe(2);
    expect(pane.sourceOptions).toEqual([
      { value: "draconic", label: "Draconic", selected: true, requiresGmApproval: false },
    ]);
    expect(pane.approvalOptions).toEqual([
      { value: "dwarven", label: "Dwarven", selected: false, requiresGmApproval: true },
    ]);
    expect(pane.approvalOptionCount).toBe(1);
    expect(pane.approvalOptionsOpen).toBe(false);
  });

  it("opens the language approval group when it contains a drafted selection", async () => {
    const step = languageChoiceStep();
    const pane = buildLanguageChoicePane({
      step,
      selectedValues: ["dwarven"],
      selectedLabel: "1/2 chosen",
    });

    expect(pane.approvalOptionsOpen).toBe(true);
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
      pickerFiltersByStepId: new Map(),
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
        maxRank: 2,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
      },
    };

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      draft,
      searchByStepId: new Map(),
      pickerFiltersByStepId: new Map([
        [
          step.id,
          {
            levelRange: { minimum: 2, maximum: 2 },
            rarity: [],
            source: [],
          },
        ],
      ]),
      previewValueByStepId: new Map([[step.id, "test.pack:heal"]]),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => "Divine list",
      resolveStepStatus: async () => "1/2 chosen",
      getOptionsForStep: async () => [
        option("test.pack:heal", "Heal"),
        option("test.pack:dispel-magic", "Dispel Magic", "common", "Player Core", 2),
      ],
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
    expect(pane.excessCount).toBe(0);
    expect(pane.selectionState).toBe("incomplete");
    expect(pane.selectedSpells).toEqual([
      {
        value: "test.pack:heal",
        name: "heal",
        rankLabel: "Rank 1",
      },
    ]);
    expect(pane.options).toEqual([
      expect.objectContaining({
        name: "Heal",
        rankLabel: "Rank 1",
        selected: true,
      }),
      expect.objectContaining({
        name: "Dispel Magic",
        rankLabel: "Rank 2",
        selected: false,
      }),
    ]);
    expect(pane.activeFilterCount).toBe(1);
    expect(pane.filterGroups.find((group) => group.key === "level")).toMatchObject({
      label: "Rank",
      summaryLabel: "Rank 2",
      selectedCount: 1,
      range: true,
      minimum: 2,
      maximum: 2,
    });
    expect(pane.filterGroups.map((group) => group.key)).toEqual(["level"]);
    expect(pane.preview).toMatchObject({
      title: "Heal",
      selectedLabel: "Added to draft",
    });
    expect(pane.rarityAccess).toEqual({
      visible: true,
      available: true,
      granted: false,
      locked: false,
      state: "none",
      basisLabel: null,
      reason: null,
      authorName: null,
      attestedAt: null,
      descriptionId: "wayfinder-spell-attestation-note-unknown-spell-choice-cleric-rank-1-level-1",
    });
  });

  it("explicitly grants restricted spell access without changing other spell policy", async () => {
    const draft = createEmptyDraft(1);
    const slotId = "spell-choice-witch-cantrips-level-1";
    const step: PendingStep = {
      id: slotId,
      level: 1,
      kind: "spell-choice",
      slotKind: "spell-choice",
      title: "Witch cantrips",
      description: "",
      required: true,
      slotId,
      filters: { itemType: "spell" },
      spellChoice: {
        slotId,
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
        restrictToCommon: true,
      },
    };
    draft.spellRarityAttestations[slotId] = createSpellRarityAttestation({
      actorId: "actor-1",
      step,
      targetLevel: 1,
      worldRarityCeiling: "common",
      claimedBasis: "rules-access",
      reason: "Witch patron grants Access.",
      authorUserId: "user-1",
      authorName: "Player",
      attestedAt: "2026-08-16T12:00:00.000Z",
    });
    let optionStep: PendingStep | null = null;

    const pane = await buildSelectionPane(step, {} as EffectiveBuildState, {
      actorId: "actor-1",
      draft,
      searchByStepId: new Map(),
      pickerFiltersByStepId: new Map(),
      previewValueByStepId: new Map(),
      resolveOptionContext: async () => EMPTY_CONTEXT,
      resolveDeityDocument: async () => null,
      buildContextNote: async () => null,
      resolveStepStatus: async () => "0/5 chosen",
      getOptionsForStep: async (candidate) => {
        optionStep = candidate;
        return [option("test.pack:forbidding-ward", "Forbidding Ward", "uncommon")];
      },
      getPickerInfoState: () => null,
      buildPreview: async () => null,
      matchesSearch: () => true,
    });

    expect(optionStep?.kind).toBe("spell-choice");
    expect(optionStep?.kind === "spell-choice" && optionStep.spellChoice.restrictToCommon).toBe(false);
    expect(optionStep?.filters).toEqual({ itemType: "spell" });
    expect(
      optionStep?.kind === "spell-choice" && {
        tradition: optionStep.spellChoice.destination.tradition,
        cantrip: optionStep.spellChoice.cantrip,
        minRank: optionStep.spellChoice.minRank,
        maxRank: optionStep.spellChoice.maxRank,
      }
    ).toEqual({
      tradition: "occult",
      cantrip: true,
      minRank: 0,
      maxRank: 0,
    });
    expect(pane?.kind === "spell-choice" && pane.rarityAccess).toEqual({
      visible: true,
      available: true,
      granted: true,
      locked: false,
      state: "attested",
      basisLabel: "A character or rules Access",
      reason: "Witch patron grants Access.",
      authorName: "Player",
      attestedAt: "2026-08-16T12:00:00.000Z",
      descriptionId: "wayfinder-spell-attestation-note-actor-1-spell-choice-witch-cantrips-level-1",
    });
    expect(pane?.kind === "spell-choice" && pane.options[0]?.rankLabel).toBe("Cantrip");
  });
});

function option(
  value: string,
  name: string,
  rarity = "common",
  source = "Player Core",
  level = 1,
  traits: string[] = []
): OptionRecord {
  return {
    value,
    packId: "test.pack",
    documentId: value.split(":")[1] ?? name.toLowerCase(),
    uuid: `Compendium.test.pack.Item.${value.split(":")[1] ?? name.toLowerCase()}`,
    img: `${name}.webp`,
    itemType: "feat",
    featType: null,
    name,
    level,
    slug: name.toLowerCase(),
    traits,
    rarity,
    source,
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

function languageChoiceStep(): LanguageChoiceStep {
  return {
    id: "language-choice-level-1",
    level: 1,
    kind: "language-choice",
    slotKind: "language-choice",
    title: "Bonus languages",
    description: "",
    required: true,
    slotId: "language-choice-level-1",
    languageChoice: {
      slotId: "language-choice-level-1",
      sourceItemType: "ancestry",
      sourceName: "Human",
      grantedLanguages: ["common"],
      count: 2,
      options: [
        { value: "draconic", label: "Draconic", requiresGmApproval: false },
        { value: "dwarven", label: "Dwarven", requiresGmApproval: true },
      ],
    },
  };
}
