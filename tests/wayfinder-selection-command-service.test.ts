import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import {
  chooseSelectionOption,
  type SelectionCommandState,
  selectClassChoiceValue,
  selectSingletonChoiceValue,
  toggleLanguageChoiceValue,
  toggleSpellChoiceSelection,
} from "../src/wayfinder/application/selection-command-service";
import { SLOT_IDS, SLOT_PREFIXES } from "../src/wayfinder/slot-ids";

describe("wayfinder selection command service", () => {
  it("invalidates dependent class draft state when the chosen class changes", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "class", "fighter", "Fighter");
    draft.boosts.class.keyAbility = "str";
    const state = commandState(draft, { invalidatedSlotIds: ["class-level-1"] });
    const step: PendingStep = {
      id: "class-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "class",
      title: "Class",
      description: "",
      required: true,
      slotId: "class-level-1",
      filters: { itemType: "class" },
    };

    const result = await chooseSelectionOption(state, step, "test.pack:champion", {
      resolveSelection: async () => selection("class-level-1", "class", "champion", "Champion"),
      hasDuplicateDraftSelection: () => false,
      resolveSelectionTraits: async () => [],
      resolveSelectionSlug: async (selectionRef) => selectionRef?.documentId ?? null,
      invalidateSelection: () => [],
      invalidateSelectionsByPrefix: (prefix) => {
        const invalidatedPrefixes = new Set<string>([
          SLOT_PREFIXES.classFeat,
          SLOT_PREFIXES.deity,
          SLOT_PREFIXES.classBranch,
          SLOT_PREFIXES.classChoice,
          SLOT_PREFIXES.skillTraining,
          SLOT_PREFIXES.spellChoice,
        ]);
        return invalidatedPrefixes.has(prefix) ? [prefix] : [];
      },
      invalidateSingletonChoicesBySource: async () => [],
      invalidateClassChoicesByDependency: async () => [],
      invalidateBranchSelectionsByDependency: async () => [],
      invalidateSpellChoicesByDependency: async () => [],
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => {
        const hadValues = !!draft.boosts.class.keyAbility;
        draft.boosts.class.keyAbility = null;
        return hadValues;
      },
    });

    expect(result).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      shouldRender: false,
      warning: null,
      statusNote:
        "Class changed. Wayfinder cleared the key-ability draft choice and marked drafted deity, class training, class path, class choice, related singleton choices, spell, and class feat selections for review.",
    });
    expect(draft.selections["class-level-1"]?.documentId).toBe("champion");
    expect(draft.boosts.class.keyAbility).toBeNull();
    expect(state.previewValueByStepId.get(step.id)).toBe("test.pack:champion");
    expect(state.recentlyInvalidatedStepIds.has("class-level-1")).toBe(false);
    expect(state.recentlyInvalidatedStepIds.has(SLOT_IDS.abilityBoostsLevel1)).toBe(true);
  });

  it("invalidates dependent class choices and branches when the deity changes", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("deity-level-1", "deity", "iomedae", "Iomedae");
    const state = commandState(draft);
    const step: PendingStep = {
      id: "deity-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "deity",
      title: "Deity",
      description: "",
      required: true,
      slotId: "deity-level-1",
      filters: { itemType: "deity" },
    };

    const result = await chooseSelectionOption(state, step, "test.pack:sarenrae", {
      resolveSelection: async () => selection("deity-level-1", "deity", "sarenrae", "Sarenrae"),
      hasDuplicateDraftSelection: () => false,
      resolveSelectionTraits: async () => [],
      resolveSelectionSlug: async () => null,
      invalidateSelection: () => [],
      invalidateSelectionsByPrefix: () => [],
      invalidateSingletonChoicesBySource: async () => [],
      invalidateClassChoicesByDependency: async () => ["class-choice-champion-sanctification-level-1"],
      invalidateBranchSelectionsByDependency: async () => ["class-branch-cause-level-1"],
      invalidateSpellChoicesByDependency: async () => [],
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => false,
    });

    expect(result).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      statusNote:
        "Deity changed. Wayfinder marked dependent class choices, class paths, and deity-driven choices for review.",
    });
    expect(draft.selections["deity-level-1"]?.documentId).toBe("sarenrae");
  });

  it("invalidates heritage-driven singleton choices even when heritage traits stay the same", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["heritage-level-1"] = selection("heritage-level-1", "heritage", "wintertouched", "Wintertouched");
    const state = commandState(draft);
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

    const result = await chooseSelectionOption(state, step, "test.pack:arctic-elf", {
      resolveSelection: async () => selection("heritage-level-1", "heritage", "arctic-elf", "Arctic Elf"),
      hasDuplicateDraftSelection: () => false,
      resolveSelectionTraits: async () => ["cold"],
      resolveSelectionSlug: async () => null,
      invalidateSelection: () => [],
      invalidateSelectionsByPrefix: () => [],
      invalidateSingletonChoicesBySource: async (sourceItemType) =>
        sourceItemType === "heritage" ? ["singleton-choice-heritage-arctic-elf-language-level-1"] : [],
      invalidateClassChoicesByDependency: async () => [],
      invalidateBranchSelectionsByDependency: async () => [],
      invalidateSpellChoicesByDependency: async () => [],
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => false,
    });

    expect(result).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      statusNote:
        "Heritage changed. Wayfinder marked heritage-driven choices and ancestry-feat draft picks for review.",
    });
    expect(draft.selections["heritage-level-1"]?.documentId).toBe("arctic-elf");
  });

  it("toggles a singleton choice value in the draft", async () => {
    const draft = createEmptyDraft(1);
    const state = commandState(draft, {
      invalidatedSlotIds: ["singleton-choice-background-sponsored-by-family-academySkill-level-1"],
    });
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

    const selected = await selectSingletonChoiceValue(state, step, "society");
    expect(selected).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      shouldRender: false,
    });
    expect(draft.singletonChoices[step.slotId]).toBe("society");

    const cleared = await selectSingletonChoiceValue(state, step, "society");
    expect(cleared).toMatchObject({
      kind: "changed",
      shouldAdvance: false,
      shouldRender: true,
    });
    expect(draft.singletonChoices[step.slotId]).toBeUndefined();
  });

  it("toggles language choices and warns when the step is full", async () => {
    const draft = createEmptyDraft(1);
    const state = commandState(draft);
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
        grantedLanguages: ["common"],
        count: 1,
        options: [
          { value: "draconic", label: "Draconic" },
          { value: "dwarven", label: "Dwarven" },
        ],
      },
    };

    const selected = await toggleLanguageChoiceValue(state, step, "draconic");
    expect(selected).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      shouldRender: false,
    });
    expect(draft.languageChoices[step.slotId]).toEqual(["draconic"]);

    const warning = await toggleLanguageChoiceValue(state, step, "dwarven");
    expect(warning).toMatchObject({
      kind: "warning",
      warning: "language-choice-full",
    });

    const cleared = await toggleLanguageChoiceValue(state, step, "draconic");
    expect(cleared).toMatchObject({
      kind: "changed",
      shouldAdvance: false,
      shouldRender: true,
    });
    expect(draft.languageChoices[step.slotId]).toBeUndefined();
  });

  it("invalidates deity-dependent branches when sanctification changes", async () => {
    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-champion-sanctification-level-1"] = "holy";
    const state = commandState(draft, { invalidatedSlotIds: ["class-choice-champion-sanctification-level-1"] });
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
        sourceDocumentId: "champion-deity",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.champion-deity",
        sourceName: "Champion Deity",
        sourceRuleIndex: 0,
        flag: "sanctification",
        classSlug: "champion",
        dependsOn: "deity",
        options: [],
      },
    };

    const result = await selectClassChoiceValue(state, step, "unholy", {
      invalidateBranchSelectionsByDependency: async () => ["class-branch-cause-level-1"],
    });

    expect(result).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      shouldRender: false,
      statusNote: "Sanctification changed. Wayfinder marked dependent class paths for review.",
    });
    expect(draft.classChoices[step.slotId]).toBe("unholy");
    expect(state.recentlyInvalidatedStepIds.has(step.slotId)).toBe(false);
  });

  it("rejects duplicate spell selections already chosen elsewhere", async () => {
    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-wizard-rank-1-level-1"] = [
      selection("spell-choice-wizard-rank-1-level-1", "spell", "magic-missile", "Magic Missile"),
    ];
    const state = commandState(draft);
    const step: PendingStep = {
      id: "spell-choice-wizard-cantrip-level-1",
      level: 1,
      kind: "spell-choice",
      slotKind: "spell-choice",
      title: "Arcane cantrip",
      description: "",
      required: true,
      slotId: "spell-choice-wizard-cantrip-level-1",
      filters: { itemType: "spell" },
      spellChoice: {
        slotId: "spell-choice-wizard-cantrip-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "wizard-spellcasting",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
        sourceName: "Wizard Spellcasting",
        classSlug: "wizard",
        dependsOn: "class",
        destination: {
          type: "spellbook",
          key: "wizard-arcane-known",
          label: "Arcane spells",
          entryName: "Arcane Spells",
          tradition: "arcane",
          ability: "int",
          prepared: "prepared",
        },
        count: 1,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
      },
    };

    const result = await toggleSpellChoiceSelection(state, step, "test.pack:magic-missile", {
      resolveSelection: async () =>
        selection("spell-choice-wizard-cantrip-level-1", "spell", "magic-missile", "Magic Missile"),
      selectionExistsOnActor: () => false,
    });

    expect(result).toMatchObject({
      kind: "warning",
      warning: "duplicate-selection",
      shouldAdvance: false,
      shouldRender: false,
    });
    expect(draft.spellChoices[step.slotId]).toEqual([]);
  });

  it("adds a spell choice and advances when the slot becomes full", async () => {
    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-cleric-rank-1-level-1"] = [
      selection("spell-choice-cleric-rank-1-level-1", "spell", "heal", "Heal"),
    ];
    const state = commandState(draft, { invalidatedSlotIds: ["spell-choice-cleric-rank-1-level-1"] });
    const step: PendingStep = {
      id: "spell-choice-cleric-rank-1-level-1",
      level: 1,
      kind: "spell-choice",
      slotKind: "spell-choice",
      title: "Divine spells",
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

    const result = await toggleSpellChoiceSelection(state, step, "test.pack:bless", {
      resolveSelection: async () => selection(step.slotId, "spell", "bless", "Bless"),
      selectionExistsOnActor: () => false,
    });

    expect(result).toMatchObject({
      kind: "changed",
      shouldAdvance: true,
      shouldRender: false,
      warning: null,
    });
    expect(draft.spellChoices[step.slotId]?.map((entry) => entry.documentId)).toEqual(["heal", "bless"]);
    expect(state.recentlyInvalidatedStepIds.has(step.slotId)).toBe(false);
  });
});

function commandState(
  draft = createEmptyDraft(1),
  options: {
    invalidatedSlotIds?: string[];
  } = {}
): SelectionCommandState {
  return {
    draft,
    previewValueByStepId: new Map(),
    recentlyInvalidatedStepIds: new Set(options.invalidatedSlotIds ?? []),
  };
}

function selection(slotId: string, itemType: string, documentId: string, name = documentId): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "class" : null,
    name,
    level: 1,
  };
}
