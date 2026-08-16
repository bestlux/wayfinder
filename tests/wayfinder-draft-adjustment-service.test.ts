import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  adjustDraftTargetLevel,
  type DraftAdjustmentState,
  setManualStepComplete,
  setTrainingRuleSelection,
  syncLanguageChoiceSelections,
  syncSkillTrainingSelections,
  toggleAncestryMode,
  toggleBoostChoice,
  toggleSkillIncreaseSelection,
  toggleTrainingSkillSelection,
  toggleVoluntaryEnabled,
  toggleVoluntaryLegacy,
} from "../src/wayfinder/application/draft-adjustment-service";
import { createBoostStep } from "../src/wayfinder/domain/step-types";

describe("wayfinder draft adjustment service", () => {
  it("toggles skill increases on and off without disturbing other draft state", () => {
    const draft = createEmptyDraft(3);
    const state = adjustmentState(draft);

    expect(toggleSkillIncreaseSelection(state, "skill-increase-level-3", "arcana")).toBe(true);
    expect(draft.skillIncreases["skill-increase-level-3"]).toBe("arcana");

    expect(toggleSkillIncreaseSelection(state, "skill-increase-level-3", "arcana")).toBe(true);
    expect(draft.skillIncreases["skill-increase-level-3"]).toBeUndefined();
  });

  it("caps additional training picks based on the step metadata", () => {
    const draft = createEmptyDraft(1);
    const state = adjustmentState(draft);
    const step: PendingStep = {
      id: "skill-training-wizard-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Wizard training",
      description: "",
      required: true,
      slotId: "skill-training-wizard-level-1",
      training: {
        classSlug: "wizard",
        className: "Wizard",
        fixedSkills: [],
        fixedLores: [],
        choiceRules: [],
        loreChoices: [],
        additionalCount: 1,
      },
    };

    expect(toggleTrainingSkillSelection(state, step, "arcana")).toBe(true);
    expect(draft.skillTrainings[step.slotId]?.additional).toEqual(["arcana"]);

    expect(toggleTrainingSkillSelection(state, step, "nature")).toBe(true);
    expect(draft.skillTrainings[step.slotId]?.additional).toEqual(["arcana"]);

    expect(toggleTrainingSkillSelection(state, step, "arcana")).toBe(true);
    expect(draft.skillTrainings[step.slotId]?.additional).toEqual([]);
  });

  it("does not create no-op additional training selections when none are allowed", () => {
    const draft = createEmptyDraft(1);
    const state = adjustmentState(draft);
    const step: PendingStep = {
      id: "skill-training-wizard-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Wizard training",
      description: "",
      required: true,
      slotId: "skill-training-wizard-level-1",
      training: {
        classSlug: "wizard",
        className: "Wizard",
        fixedSkills: [],
        fixedLores: [],
        choiceRules: [],
        loreChoices: [],
        additionalCount: 0,
      },
    };

    expect(toggleTrainingSkillSelection(state, step, "arcana")).toBe(false);
    expect(draft.skillTrainings[step.slotId]).toBeUndefined();
  });

  it("switches ancestry mode and clears the opposing draft choices", () => {
    const draft = createEmptyDraft(1);
    draft.boosts.ancestry.mode = "standard";
    draft.boosts.ancestry.selectedBoosts = { first: "str" };
    const state = adjustmentState(draft);

    expect(toggleAncestryMode(state, "standard")).toBe(true);
    expect(draft.boosts.ancestry.modeTouched).toBe(true);
    expect(draft.boosts.ancestry.mode).toBe("alternate");
    expect(draft.boosts.ancestry.selectedBoosts).toEqual({});

    draft.boosts.ancestry.alternateBoosts = ["dex", "int"];
    expect(toggleAncestryMode(state, "alternate")).toBe(true);
    expect(draft.boosts.ancestry.mode).toBe("standard");
    expect(draft.boosts.ancestry.alternateBoosts).toEqual([]);
  });

  it("toggles voluntary flaws and clears legacy data when disabled", () => {
    const draft = createEmptyDraft(1);
    draft.boosts.ancestry.voluntary.enabled = true;
    draft.boosts.ancestry.voluntary.legacy = true;
    draft.boosts.ancestry.voluntary.boost = "cha";
    draft.boosts.ancestry.voluntary.flaws = ["str", "str"];
    const state = adjustmentState(draft);

    expect(toggleVoluntaryEnabled(state)).toBe(true);
    expect(draft.boosts.ancestry.voluntary).toEqual({
      touched: true,
      enabled: false,
      legacy: false,
      boost: null,
      flaws: [],
    });

    draft.boosts.ancestry.voluntary.flaws = ["str", "str", "dex"];
    expect(toggleVoluntaryLegacy(state)).toBe(true);
    expect(draft.boosts.ancestry.voluntary.enabled).toBe(true);
    expect(draft.boosts.ancestry.voluntary.legacy).toBe(true);
    expect(draft.boosts.ancestry.voluntary.flaws).toEqual(["str", "str"]);

    expect(toggleVoluntaryLegacy(state)).toBe(true);
    expect(draft.boosts.ancestry.voluntary.legacy).toBe(false);
    expect(draft.boosts.ancestry.voluntary.flaws).toEqual(["str"]);
  });

  it("toggles boost choices and clears invalidated markers for the active step", () => {
    const draft = createEmptyDraft(5);
    const state = adjustmentState(draft, ["ability-boosts-level-5"]);
    const buildState = {
      ancestry: null,
      heritage: null,
      background: null,
      class: null,
      deity: null,
      languages: null,
      levelBoosts: {
        1: [],
        5: ["str"],
        10: [],
        15: [],
        20: [],
      },
      allowedBoosts: {
        1: 4,
        5: 4,
        10: 0,
        15: 0,
        20: 0,
      },
      projectedAbilities: {
        str: { key: "str", modifier: 1, partial: false, boostCount: 1, flawCount: 0 },
        dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        int: { key: "int", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      },
    } satisfies EffectiveBuildState;

    const step = createBoostStep(5, "Level 5 ability boosts", "");
    expect(toggleBoostChoice(state, buildState, step, "level-5", "dex")).toBe(true);
    expect(draft.boosts.levels["5"]).toEqual(["str", "dex"]);
    expect(state.recentlyInvalidatedStepIds.has("ability-boosts-level-5")).toBe(false);
  });

  it("stores gradual choices in the native batch and enforces one unique ordered choice per step", () => {
    const draft = createEmptyDraft(3);
    const state = adjustmentState(draft);
    const buildState = {
      ancestry: null,
      heritage: null,
      background: null,
      class: null,
      deity: null,
      languages: null,
      levelBoosts: {
        1: [],
        5: ["str"],
        10: [],
        15: [],
        20: [],
      },
      allowedBoosts: {
        1: 4,
        5: 2,
        10: 0,
        15: 0,
        20: 0,
      },
      projectedAbilities: {
        str: { key: "str", modifier: 1, partial: false, boostCount: 1, flawCount: 0 },
        dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        int: { key: "int", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      },
    } satisfies EffectiveBuildState;
    const step = createBoostStep(3, "Level 3 ability boost", "", {
      batchLevel: 5,
      requiredCount: 2,
      grantCount: 1,
    });

    expect(toggleBoostChoice(state, buildState, step, "level-5", "str")).toBe(false);
    expect(toggleBoostChoice(state, buildState, step, "level-5", "dex")).toBe(true);
    expect(draft.boosts.levels).toEqual({ 5: ["str", "dex"] });
    expect(toggleBoostChoice(state, buildState, step, "level-5", "con")).toBe(true);
    expect(draft.boosts.levels).toEqual({ 5: ["str", "con"] });
  });

  it("trims drafted language choices when the projected build lowers the allowance", () => {
    const draft = createEmptyDraft(1);
    draft.languageChoices["language-choice-level-1"] = ["draconic", "dwarven"];
    const state = adjustmentState(draft);
    const buildState = {
      ancestry: null,
      heritage: null,
      background: null,
      class: null,
      deity: null,
      languages: {
        sourceLanguages: [],
        grantedLanguages: ["common"],
        selectableLanguages: ["draconic"],
        maxSelections: 1,
      },
      levelBoosts: {
        1: [],
        5: [],
        10: [],
        15: [],
        20: [],
      },
      allowedBoosts: {
        1: 4,
        5: 0,
        10: 0,
        15: 0,
        20: 0,
      },
      projectedAbilities: {
        str: { key: "str", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        int: { key: "int", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      },
    } satisfies EffectiveBuildState;

    expect(syncLanguageChoiceSelections(state, buildState, [])).toBe(true);
    expect(draft.languageChoices["language-choice-level-1"]).toEqual(["draconic"]);
    expect(state.recentlyInvalidatedStepIds.has("language-choice-level-1")).toBe(true);
  });

  it("keeps a configured GM-approved language exposed by the current plan", () => {
    const draft = createEmptyDraft(1);
    draft.languageChoices["language-choice-level-1"] = ["goblin"];
    const state = adjustmentState(draft);
    const buildState = {
      ancestry: null,
      heritage: null,
      background: null,
      class: null,
      deity: null,
      languages: {
        sourceLanguages: [],
        grantedLanguages: ["common"],
        selectableLanguages: ["draconic"],
        maxSelections: 1,
      },
      levelBoosts: {
        1: [],
        5: [],
        10: [],
        15: [],
        20: [],
      },
      allowedBoosts: {
        1: 4,
        5: 0,
        10: 0,
        15: 0,
        20: 0,
      },
      projectedAbilities: {
        str: { key: "str", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        int: { key: "int", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
        cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      },
    } satisfies EffectiveBuildState;

    expect(
      syncLanguageChoiceSelections(state, buildState, [
        {
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
            options: [{ value: "goblin", label: "Goblin", requiresGmApproval: true }],
          },
        },
      ])
    ).toBe(false);
    expect(draft.languageChoices["language-choice-level-1"]).toEqual(["goblin"]);
  });

  it("trims drafted class training picks when the projected build lowers the allowance", () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: {},
      additional: ["arcana", "nature"],
      loreChoices: {},
    };
    const state = adjustmentState(draft);
    const steps: PendingStep[] = [
      {
        id: "skill-training-wizard-level-1",
        level: 1,
        kind: "skill-training",
        slotKind: "skill-training",
        title: "Wizard training",
        description: "",
        required: true,
        slotId: "skill-training-wizard-level-1",
        training: {
          classSlug: "wizard",
          className: "Wizard",
          fixedSkills: [],
          fixedLores: [],
          choiceRules: [],
          loreChoices: [],
          additionalCount: 1,
        },
      },
    ];

    expect(syncSkillTrainingSelections(state, steps, {})).toBe(true);
    expect(draft.skillTrainings["skill-training-wizard-level-1"]?.additional).toEqual(["arcana"]);
    expect(state.recentlyInvalidatedStepIds.has("skill-training-wizard-level-1")).toBe(true);
  });

  it("retains a valid dedication fallback skill when the preferred skill is already trained", () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: { "feat:necromancer-dedication:dedication-skill-1": "arcana" },
      additional: [],
      loreChoices: {},
    };
    const state = adjustmentState(draft);
    const steps = [necromancerTrainingStep()];

    expect(
      syncSkillTrainingSelections(state, steps, {
        "skill-training-fighter-level-1": { occultism: 1 },
      })
    ).toBe(false);
    expect(draft.skillTrainings["skill-training-fighter-level-1"]?.ruleChoices).toEqual({
      "feat:necromancer-dedication:dedication-skill-1": "arcana",
    });
    expect(state.recentlyInvalidatedStepIds).toEqual(new Set());
  });

  it("clears a dedication fallback skill when its preferred skill becomes available again", () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: { "feat:necromancer-dedication:dedication-skill-1": "arcana" },
      additional: ["athletics"],
      loreChoices: {},
    };
    const state = adjustmentState(draft);

    expect(
      syncSkillTrainingSelections(state, [necromancerTrainingStep()], {
        "skill-training-fighter-level-1": { occultism: 0 },
      })
    ).toBe(true);
    expect(draft.skillTrainings["skill-training-fighter-level-1"]?.ruleChoices).toEqual({});
    expect(state.recentlyInvalidatedStepIds).toEqual(new Set(["skill-training-fighter-level-1"]));
  });

  it.each([
    {
      label: "already trained",
      additional: ["athletics"],
      ranks: { occultism: 1, arcana: 1 },
    },
    {
      label: "reserved elsewhere in the step",
      additional: ["arcana"],
      ranks: { occultism: 1, arcana: 0 },
    },
  ])("clears a dedication fallback that is $label", ({ additional, ranks }) => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: { "feat:necromancer-dedication:dedication-skill-1": "arcana" },
      additional,
      loreChoices: {},
    };
    const state = adjustmentState(draft);

    expect(
      syncSkillTrainingSelections(state, [necromancerTrainingStep()], {
        "skill-training-fighter-level-1": ranks,
      })
    ).toBe(true);
    expect(draft.skillTrainings["skill-training-fighter-level-1"]?.ruleChoices).toEqual({});
  });

  it("updates manual completion and training rule choices, and clamps target level changes", () => {
    const draft = createEmptyDraft(2);
    const state = adjustmentState(draft);

    expect(setManualStepComplete(state, "manual-review-level-2", true)).toBe(true);
    expect(draft.manual["manual-review-level-2"]).toBe(true);

    expect(setTrainingRuleSelection(state, "skill-training-wizard-level-1", "arcana", "arcana")).toBe(true);
    expect(draft.skillTrainings["skill-training-wizard-level-1"]).toEqual({
      ruleChoices: { arcana: "arcana" },
      additional: [],
      loreChoices: {},
    });

    expect(adjustDraftTargetLevel(draft, 2, 5)).toBe(true);
    expect(draft.targetLevel).toBe(7);
    expect(adjustDraftTargetLevel(draft, 2, -10)).toBe(true);
    expect(draft.targetLevel).toBe(2);
    expect(adjustDraftTargetLevel(draft, 2, 30)).toBe(true);
    expect(draft.targetLevel).toBe(20);
  });
});

function adjustmentState(draft = createEmptyDraft(1), invalidatedStepIds: string[] = []): DraftAdjustmentState {
  return {
    draft,
    recentlyInvalidatedStepIds: new Set(invalidatedStepIds),
  };
}

function necromancerTrainingStep(): PendingStep {
  return {
    id: "skill-training-fighter-level-1",
    level: 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: "Fighter skill training",
    description: "",
    required: true,
    slotId: "skill-training-fighter-level-1",
    training: {
      classSlug: "fighter",
      className: "Fighter",
      fixedSkills: [],
      fixedLores: [],
      choiceRules: [
        {
          key: "feat:necromancer-dedication:dedication-skill-1",
          flag: "feat:necromancer-dedication:dedication-skill-1",
          prompt: "Choose Occultism",
          sourceLabel: "Necromancer Dedication",
          options: [{ slug: "occultism", label: "Occultism" }],
          fallbackPrompt: "Choose a skill",
          fallbackOptions: [
            { slug: "arcana", label: "Arcana" },
            { slug: "society", label: "Society" },
          ],
          persistence: null,
        },
      ],
      loreChoices: [],
      additionalCount: 3,
    },
  };
}
