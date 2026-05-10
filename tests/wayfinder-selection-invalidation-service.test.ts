import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import { createSelectionInvalidationService } from "../src/wayfinder/application/selection-invalidation-service";
import { SLOT_IDS } from "../src/wayfinder/slot-ids";

describe("wayfinder selection invalidation service", () => {
  it("clears a class selection and invalidates dependent draft prefixes", () => {
    const draft = createEmptyDraft(1);
    draft.selections[SLOT_IDS.class] = selection(SLOT_IDS.class, "class", "wizard");
    draft.languageChoices[SLOT_IDS.languageChoice] = ["draconic"];
    draft.selections[SLOT_IDS.deity] = selection(SLOT_IDS.deity, "deity", "nethys");
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "feat",
      "battle-magic"
    );
    draft.classChoices["class-choice-wizard-thesis-level-1"] = "spell-substitution";
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: {},
      additional: ["arcana"],
      loreChoices: {},
    };
    draft.spellChoices["spell-choice-wizard-level-1"] = [
      selection("spell-choice-wizard-level-1", "spell", "magic-missile"),
    ];
    draft.selections["class-feat-level-2"] = selection("class-feat-level-2", "feat", "familiar");
    draft.boosts.class.keyAbility = "int";

    const service = createSelectionInvalidationService(
      {
        draft,
        previewValueByStepId: new Map([[SLOT_IDS.class, "wizard"]]),
        pickerFiltersByStepId: new Map([[SLOT_IDS.class, { rarity: ["common"], source: [] }]]),
        recentlyInvalidatedStepIds: new Set<string>(),
        scrollById: new Map([[SLOT_IDS.class, 4]]),
      },
      {
        buildPlan: async () => ({ recommendedTargetLevel: 1, targetLevel: 1, steps: [] }),
        resetAncestryBoostDraft: () => false,
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => {
          const hadValue = !!draft.boosts.class.keyAbility;
          draft.boosts.class.keyAbility = null;
          return hadValue;
        },
      }
    );

    expect(service.clearSelection(SLOT_IDS.class)).toBe(7);
    expect(draft.selections[SLOT_IDS.class]).toBeUndefined();
    expect(draft.selections[SLOT_IDS.deity]).toBeUndefined();
    expect(draft.branchSelections["class-branch-arcane-school-level-1"]).toBeUndefined();
    expect(draft.classChoices["class-choice-wizard-thesis-level-1"]).toBeUndefined();
    expect(draft.skillTrainings["skill-training-wizard-level-1"]).toBeUndefined();
    expect(draft.spellChoices["spell-choice-wizard-level-1"]).toBeUndefined();
    expect(draft.selections["class-feat-level-2"]).toBeUndefined();
    expect(draft.boosts.class.keyAbility).toBeNull();
  });

  it("clears drafted language choices when the ancestry selection is cleared", () => {
    const draft = createEmptyDraft(1);
    draft.selections[SLOT_IDS.ancestry] = selection(SLOT_IDS.ancestry, "ancestry", "human");
    draft.languageChoices[SLOT_IDS.languageChoice] = ["draconic"];

    const service = createSelectionInvalidationService(
      {
        draft,
        previewValueByStepId: new Map(),
        pickerFiltersByStepId: new Map(),
        recentlyInvalidatedStepIds: new Set<string>(),
        scrollById: new Map(),
      },
      {
        buildPlan: async () => ({ recommendedTargetLevel: 1, targetLevel: 1, steps: [] }),
        resetAncestryBoostDraft: () => false,
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => false,
      }
    );

    expect(service.clearSelection(SLOT_IDS.ancestry)).toBe(2);
    expect(draft.selections[SLOT_IDS.ancestry]).toBeUndefined();
    expect(draft.languageChoices[SLOT_IDS.languageChoice]).toBeUndefined();
  });

  it("clears filter-only dependent class steps when the class selection is cleared", () => {
    const draft = createEmptyDraft(1);
    draft.selections[SLOT_IDS.class] = selection(SLOT_IDS.class, "class", "wizard");

    const previewValueByStepId = new Map([["class-branch-arcane-school-level-1", "test.pack:battle-magic"]]);
    const pickerFiltersByStepId = new Map([["class-branch-arcane-school-level-1", { rarity: ["common"], source: [] }]]);
    const scrollById = new Map([["class-branch-arcane-school-level-1:options", 12]]);
    const service = createSelectionInvalidationService(
      {
        draft,
        previewValueByStepId,
        pickerFiltersByStepId,
        recentlyInvalidatedStepIds: new Set<string>(),
        scrollById,
      },
      {
        buildPlan: async () => ({ recommendedTargetLevel: 1, targetLevel: 1, steps: [] }),
        resetAncestryBoostDraft: () => false,
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => false,
      }
    );

    expect(service.clearSelection(SLOT_IDS.class)).toBe(2);
    expect(previewValueByStepId.has("class-branch-arcane-school-level-1")).toBe(false);
    expect(pickerFiltersByStepId.has("class-branch-arcane-school-level-1")).toBe(false);
    expect(scrollById.has("class-branch-arcane-school-level-1:options")).toBe(false);
  });

  it("invalidates only the dependency-matching steps from the current plan", async () => {
    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-cause-level-1"] = selection("class-branch-cause-level-1", "feat", "paladin");
    draft.classChoices["class-choice-champion-sanctification-level-1"] = "holy";
    draft.spellChoices["spell-choice-wizard-curriculum-rank-1-level-1"] = [
      selection("spell-choice-wizard-curriculum-rank-1-level-1", "spell", "force-barrage"),
    ];

    const service = createSelectionInvalidationService(
      {
        draft,
        previewValueByStepId: new Map(),
        pickerFiltersByStepId: new Map(),
        recentlyInvalidatedStepIds: new Set<string>(),
        scrollById: new Map(),
      },
      {
        buildPlan: async () => ({
          recommendedTargetLevel: 1,
          targetLevel: 1,
          steps: [
            classBranchStep("class-branch-cause-level-1", "deity"),
            classBranchStep("class-branch-tenet-level-1", "class"),
            classChoiceStep("class-choice-champion-sanctification-level-1", "deity"),
            classChoiceStep("class-choice-cleric-doctrine-level-1", "class"),
            spellChoiceStep("spell-choice-wizard-curriculum-rank-1-level-1", "class-branch"),
            spellChoiceStep("spell-choice-cleric-cantrip-level-1", "class"),
          ],
        }),
        resetAncestryBoostDraft: () => false,
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => false,
      }
    );

    expect(await service.invalidateBranchSelectionsByDependency("deity")).toEqual(["class-branch-cause-level-1"]);
    expect(await service.invalidateClassChoicesByDependency("deity")).toEqual([
      "class-choice-champion-sanctification-level-1",
    ]);
    expect(await service.invalidateSpellChoicesByDependency("class-branch")).toEqual([
      "spell-choice-wizard-curriculum-rank-1-level-1",
    ]);
    expect(draft.branchSelections["class-branch-cause-level-1"]).toBeUndefined();
    expect(draft.classChoices["class-choice-champion-sanctification-level-1"]).toBeUndefined();
    expect(draft.spellChoices["spell-choice-wizard-curriculum-rank-1-level-1"]).toBeUndefined();
    expect(draft.classChoices["class-choice-cleric-doctrine-level-1"]).toBeUndefined();
  });

  it("invalidates grant choices owned by the same source UUID", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["grant-choice-none-feat-molten-wit-feat-level-1"] = selection(
      "grant-choice-none-feat-molten-wit-feat-level-1",
      "feat",
      "charming-liar"
    );

    const service = createSelectionInvalidationService(
      {
        draft,
        previewValueByStepId: new Map([
          ["grant-choice-none-feat-molten-wit-feat-level-1", "pf2e.feats-srd:charming-liar"],
        ]),
        pickerFiltersByStepId: new Map([
          ["grant-choice-none-feat-molten-wit-feat-level-1", { rarity: [], source: [] }],
        ]),
        recentlyInvalidatedStepIds: new Set<string>(),
        scrollById: new Map([["grant-choice-none-feat-molten-wit-feat-level-1:options", 20]]),
      },
      {
        buildPlan: async () => ({
          recommendedTargetLevel: 1,
          targetLevel: 1,
          steps: [
            grantChoiceStep(
              "grant-choice-none-feat-molten-wit-feat-level-1",
              "Compendium.pf2e.feats-srd.Item.molten-wit"
            ),
            grantChoiceStep(
              "grant-choice-none-feat-general-training-feat-level-1",
              "Compendium.pf2e.feats-srd.Item.general-training"
            ),
          ],
        }),
        resetAncestryBoostDraft: () => false,
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => false,
      }
    );

    await expect(
      (service as any).invalidateGrantSelectionsBySourceUuid("Compendium.pf2e.feats-srd.Item.molten-wit")
    ).resolves.toEqual(["grant-choice-none-feat-molten-wit-feat-level-1"]);
    expect(draft.selections["grant-choice-none-feat-molten-wit-feat-level-1"]).toBeUndefined();
  });
});

function selection(slotId: string, itemType: string, documentId: string) {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "classfeature" : null,
    name: documentId,
    level: 1,
  };
}

function classBranchStep(slotId: string, dependsOn: "class" | "deity"): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "class-branch",
    slotKind: "class-branch",
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "feat",
      featTypes: ["classfeature"],
      maxLevel: 1,
    },
    branch: {
      slotId,
      selectorPackId: "test.pack",
      selectorDocumentId: slotId,
      selectorUuid: `Compendium.test.pack.Item.${slotId}`,
      selectorName: "Cause",
      selectorRuleIndex: 0,
      flag: "cause",
      optionTag: slotId,
      classSlug: "champion",
      dependsOn,
    },
  };
}

function classChoiceStep(slotId: string, dependsOn: "class" | "deity"): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: slotId,
    description: "",
    required: true,
    slotId,
    classChoice: {
      slotId,
      sourcePackId: "test.pack",
      sourceDocumentId: slotId,
      sourceUuid: `Compendium.test.pack.Item.${slotId}`,
      sourceName: slotId,
      sourceRuleIndex: 0,
      flag: "choice",
      classSlug: "champion",
      dependsOn,
      options: [],
    },
  };
}

function spellChoiceStep(slotId: string, dependsOn: "class" | "class-branch"): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "spell",
    },
    spellChoice: {
      slotId,
      sourcePackId: "test.pack",
      sourceDocumentId: slotId,
      sourceUuid: `Compendium.test.pack.Item.${slotId}`,
      sourceName: slotId,
      classSlug: "wizard",
      dependsOn,
      destination: {
        type: "spellbook",
        key: "wizard-arcane-prepared",
        label: "Wizard spellbook",
        entryName: "Wizard spellbook",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 1,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
    },
  };
}

function grantChoiceStep(slotId: string, selectorUuid: string): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "pick-item",
    slotKind: "grant-choice",
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "feat",
    },
    grantSelection: {
      slotId,
      sourceItemType: "feat",
      selectorPackId: "pf2e.feats-srd",
      selectorDocumentId: selectorUuid.split(".").at(-1) ?? selectorUuid,
      selectorUuid,
      selectorName: selectorUuid,
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "feat",
      itemType: "feat",
      classSlug: null,
      dependsOn: null,
      filters: {
        itemType: "feat",
      },
    },
  };
}
