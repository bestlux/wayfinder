import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { sortPendingSteps } from "../src/progression";
import type { ActorSnapshot, PendingStep } from "../src/types";
import { choiceRuleIdentity } from "../src/wayfinder/domain/choice-rule-ownership";
import {
  createBoostStep,
  createClassBranchStep,
  createClassChoiceStep,
  createLanguageChoiceStep,
  createPickItemStep,
  createSingletonChoiceStep,
  createSkillTrainingStep,
  createSpellChoiceStep,
  createStartingEquipmentStep,
} from "../src/wayfinder/domain/step-types";
import {
  buildWayfinderPlan,
  getWayfinderStepStatus,
  modeLabel,
  resolveActiveStep,
} from "../src/wayfinder/plan-service";

describe("wayfinder plan service", () => {
  it("falls back to the first incomplete step when no active step is pinned", async () => {
    const steps: PendingStep[] = [
      {
        id: "ancestry-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "ancestry",
        title: "Ancestry",
        description: "",
        required: true,
        slotId: "ancestry-level-1",
        filters: { itemType: "ancestry" },
      },
      {
        id: "heritage-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "heritage",
        title: "Heritage",
        description: "",
        required: true,
        slotId: "heritage-level-1",
        filters: { itemType: "heritage" },
      },
    ];

    const resolved = await resolveActiveStep(steps, null, async (step) => step.slotId === "ancestry-level-1");
    expect(resolved.activeStepId).toBe("heritage-level-1");
  });

  it("reports invalidated pick steps as needing attention", async () => {
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

    const status = await getWayfinderStepStatus(
      step,
      createEmptyDraft(1),
      new Set(["heritage-level-1"]),
      {} as EffectiveBuildState
    );

    expect(status).toBe("Needs attention");
    expect(modeLabel("class-branch")).toBe("Class Path");
  });

  it("orders class choices before dependent class branches at the same level", () => {
    const steps = sortPendingSteps([
      createClassBranchStep(
        1,
        {
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
        {
          title: "Cause",
          description: "",
        }
      ),
      createClassChoiceStep(1, {
        slotId: "class-choice-deity-champion-sanctification-level-1",
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
          { value: "none", label: "None", img: null, detail: null },
        ],
      }),
    ]);

    expect(steps.map((step) => step.slotId)).toEqual([
      "class-choice-deity-champion-sanctification-level-1",
      "class-branch-cause-level-1",
    ]);
  });

  it("orders same-source class choices by rule index before title", () => {
    const sourceUuid = "Compendium.pf2e.classfeatures.Item.0jSS6pgNXsC8k4o7";
    const steps = sortPendingSteps([
      createClassChoiceStep(
        1,
        {
          slotId: "class-choice-elemental-instinct-elementalInstinctDamage-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "elemental-instinct",
          sourceUuid,
          sourceName: "Elemental Instinct",
          sourceRuleIndex: 1,
          flag: "elementalInstinctDamage",
          classSlug: "barbarian",
          dependsOn: "class",
          options: [{ value: "cold", label: "Cold", img: null, detail: null }],
        },
        {
          title: "Damage",
          description: "",
        }
      ),
      createClassChoiceStep(
        1,
        {
          slotId: "class-choice-elemental-instinct-elementalInstinctElement-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "elemental-instinct",
          sourceUuid,
          sourceName: "Elemental Instinct",
          sourceRuleIndex: 0,
          flag: "elementalInstinctElement",
          classSlug: "barbarian",
          dependsOn: "class",
          options: [{ value: "water", label: "Water", img: null, detail: null }],
        },
        {
          title: "Element",
          description: "",
        }
      ),
    ]);

    expect(steps.map((step) => step.slotId)).toEqual([
      "class-choice-elemental-instinct-elementalInstinctElement-level-1",
      "class-choice-elemental-instinct-elementalInstinctDamage-level-1",
    ]);
  });

  it("orders level 1 boosts, training, languages, and class details in rules-aligned sequence", () => {
    const steps = sortPendingSteps([
      createSkillTrainingStep(
        1,
        "Wizard training",
        "",
        {
          classSlug: "wizard",
          className: "Wizard",
          fixedSkills: ["arcana"],
          fixedLores: [],
          choiceRules: [],
          loreChoices: [],
          additionalCount: 5,
        },
        {
          slotId: "skill-training-wizard-level-1",
        }
      ),
      createLanguageChoiceStep(
        1,
        {
          slotId: "language-choice-level-1",
          sourceItemType: "ancestry",
          sourceName: "Human",
          grantedLanguages: ["common"],
          count: 2,
          options: [
            { value: "draconic", label: "Draconic", requiresGmApproval: false },
            { value: "dwarven", label: "Dwarven", requiresGmApproval: false },
          ],
        },
        {
          title: "Bonus languages",
          description: "",
        }
      ),
      createSpellChoiceStep(1, "Wizard spell choice", "", {
        slotId: "spell-choice-wizard-school-level-1",
        classSlug: "wizard",
        sourceName: "Arcane School",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.arcane-school",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "arcane-school",
        dependsOn: "class",
        destination: {
          type: "spellbook",
          key: "wizard-spellbook",
          label: "Spellbook",
          entryName: "Wizard Spellbook",
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
        restrictToCommon: true,
      }),
      createPickItemStep("class-feat", 1, "Level 1 class feat", "", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 1,
      }),
      createClassChoiceStep(1, {
        slotId: "class-choice-wizard-thesis-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "arcane-thesis",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.arcane-thesis",
        sourceName: "Arcane Thesis",
        sourceRuleIndex: 0,
        flag: "arcaneThesis",
        classSlug: "wizard",
        dependsOn: "class",
        options: [{ value: "staff-nexus", label: "Staff Nexus", img: null, detail: null }],
      }),
      createBoostStep(1, "Assign creation boosts", ""),
    ]);

    expect(steps.map((step) => step.slotKind)).toEqual([
      "ability-boosts",
      "class-choice",
      "skill-training",
      "language-choice",
      "spell-choice",
      "class-feat",
    ]);
  });

  it("orders starting equipment after every level-1 choice", () => {
    const steps = sortPendingSteps([
      createStartingEquipmentStep(1),
      createPickItemStep("class-feat", 1, "Class feat", "", { itemType: "feat" }),
      createBoostStep(1, "Creation boosts", ""),
    ]);

    expect(steps.map((step) => step.slotKind)).toEqual(["ability-boosts", "class-feat", "starting-equipment"]);
  });

  it("adds starting equipment until one valid completed manifest fulfills it globally", async () => {
    const snapshot = {
      actorId: "actor-1",
      level: 0,
      isBlank: true,
      freeArchetypeEnabled: false,
      campaignFeatSections: [],
      gradualBoostsEnabled: false,
      singletonSlots: { ancestry: false, heritage: false, background: false, class: false, deity: false },
      featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
      fulfilledStepIds: [],
      sourceIds: [],
      namesByType: {},
      skillRanks: {},
    } satisfies ActorSnapshot;
    const deps = emptyPlanDependencies();

    const levelOne = await buildWayfinderPlan(snapshot, createEmptyDraft(1), deps);
    expect(levelOne.steps.at(-1)?.slotId).toBe("starting-equipment-level-1");

    const fulfilled = await buildWayfinderPlan(
      { ...snapshot, fulfilledStepIds: ["starting-equipment-level-1"] },
      createEmptyDraft(1),
      deps
    );
    expect(fulfilled.steps.some((step) => step.kind === "starting-equipment")).toBe(false);

    for (const targetLevel of [2, 5, 20]) {
      const higherLevel = await buildWayfinderPlan(
        { ...snapshot, level: Math.max(0, targetLevel - 1) },
        createEmptyDraft(targetLevel),
        deps
      );
      expect(higherLevel.steps.at(-1)?.slotId).toBe(`starting-equipment-level-${targetLevel}`);

      const higherLevelFulfilled = await buildWayfinderPlan(
        {
          ...snapshot,
          level: Math.max(0, targetLevel - 1),
          fulfilledStepIds: [`starting-equipment-level-${targetLevel}`],
        },
        createEmptyDraft(targetLevel),
        deps
      );
      expect(higherLevelFulfilled.steps.some((step) => step.kind === "starting-equipment")).toBe(false);
    }

    for (const targetLevel of [1, 2, 5, 20]) {
      const globallyFulfilled = await buildWayfinderPlan(
        {
          ...snapshot,
          level: Math.max(0, targetLevel - 1),
          hasValidCompletedAcquisitionManifest: true,
          fulfilledStepIds: [],
        },
        createEmptyDraft(targetLevel),
        deps
      );
      expect(globallyFulfilled.steps.some((step) => step.kind === "starting-equipment")).toBe(false);
    }
  });

  it("uses class-specific skill feat cadence instead of duplicating generic skill feat steps", async () => {
    const draft = createEmptyDraft(5);
    const plan = await buildWayfinderPlan(
      {
        actorId: "actor-1",
        level: 1,
        isBlank: false,
        freeArchetypeEnabled: false,
        campaignFeatSections: [],
        gradualBoostsEnabled: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 1,
          class: 0,
          archetype: 0,
          skill: 1,
          general: 0,
        },
        fulfilledStepIds: ["skill-feat-level-1"],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      } satisfies ActorSnapshot,
      draft,
      {
        buildClassFeatSteps: async () => [],
        buildClassSkillFeatSteps: async () => [
          createPickItemStep("skill-feat", 2, "Level 2 skill feat", "", {
            itemType: "feat",
            featTypes: ["skill"],
            maxLevel: 2,
          }),
          createPickItemStep("skill-feat", 3, "Level 3 skill feat", "", {
            itemType: "feat",
            featTypes: ["skill"],
            maxLevel: 3,
          }),
          createPickItemStep("skill-feat", 4, "Level 4 skill feat", "", {
            itemType: "feat",
            featTypes: ["skill"],
            maxLevel: 4,
          }),
          createPickItemStep("skill-feat", 5, "Level 5 skill feat", "", {
            itemType: "feat",
            featTypes: ["skill"],
            maxLevel: 5,
          }),
        ],
        buildClassTrainingSteps: async () => [],
        buildGrantChoiceSteps: async () => [],
        buildFlagChoiceSteps: async () => [],
        buildSingletonChoiceSteps: async () => [],
        buildLanguageChoiceSteps: async () => [],
        buildClassArchetypeSteps: async () => [],
        buildClassBranchSteps: async () => [],
        buildClassGrantedItemSteps: async () => [],
        buildClassChoiceSteps: async () => [],
        buildSpellChoiceSteps: async () => [],
      }
    );

    expect(plan.steps.filter((step) => step.slotKind === "skill-feat").map((step) => step.slotId)).toEqual([
      "skill-feat-level-2",
      "skill-feat-level-3",
      "skill-feat-level-4",
      "skill-feat-level-5",
    ]);
  });

  it("registers one owner per ChoiceSet rule and prefers the apply-safe class-choice lane", async () => {
    const sourceUuid = "Compendium.pf2e.classfeatures.Item.Deity (Cleric)";
    const singletonStep = createSingletonChoiceStep(2, {
      slotId: "singleton-choice-classfeature-deity-cleric-sanctification-level-2",
      sourceItemType: "classfeature",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "Deity (Cleric)",
      sourceUuid,
      sourceName: "Deity (Cleric)",
      sourceRuleIndex: 2,
      flag: "sanctification",
      prompt: "Sanctification",
      predicate: [],
      rollOption: null,
      options: [{ value: "holy", label: "Holy", img: null, detail: null }],
    });
    const classChoiceStep = createClassChoiceStep(2, {
      slotId: "class-choice-deity-cleric-sanctification-level-2",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "Deity (Cleric)",
      sourceUuid,
      sourceName: "Deity (Cleric)",
      sourceRuleIndex: 2,
      flag: "sanctification",
      classSlug: "fighter",
      dependsOn: "deity",
      options: [{ value: "holy", label: "Holy", img: null, detail: null }],
    });

    const plan = await buildWayfinderPlan(
      {
        actorId: "actor-1",
        level: 1,
        isBlank: false,
        freeArchetypeEnabled: false,
        campaignFeatSections: [],
        gradualBoostsEnabled: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 0,
          class: 0,
          archetype: 0,
          skill: 0,
          general: 0,
        },
        fulfilledStepIds: [],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      } satisfies ActorSnapshot,
      createEmptyDraft(2),
      {
        buildClassFeatSteps: async () => [],
        buildClassSkillFeatSteps: async () => [],
        buildClassTrainingSteps: async () => [],
        buildGrantChoiceSteps: async () => [],
        buildFlagChoiceSteps: async () => [],
        buildSingletonChoiceSteps: async () => [singletonStep],
        buildLanguageChoiceSteps: async () => [],
        buildClassArchetypeSteps: async () => [],
        buildClassBranchSteps: async () => [],
        buildClassGrantedItemSteps: async () => [],
        buildClassChoiceSteps: async () => [classChoiceStep],
        buildSpellChoiceSteps: async () => [],
      }
    );

    const identity = choiceRuleIdentity(classChoiceStep);
    expect(identity).toMatchObject({
      sourceUuid,
      ruleIndex: 2,
      flag: "sanctification",
    });
    expect(plan.steps.filter((step) => choiceRuleIdentity(step)?.key === identity?.key)).toEqual([classChoiceStep]);
  });
});

function emptyPlanDependencies() {
  return {
    buildClassFeatSteps: async () => [],
    buildClassSkillFeatSteps: async () => [],
    buildClassTrainingSteps: async () => [],
    buildGrantChoiceSteps: async () => [],
    buildFlagChoiceSteps: async () => [],
    buildSingletonChoiceSteps: async () => [],
    buildLanguageChoiceSteps: async () => [],
    buildClassArchetypeSteps: async () => [],
    buildClassBranchSteps: async () => [],
    buildClassGrantedItemSteps: async () => [],
    buildClassChoiceSteps: async () => [],
    buildSpellChoiceSteps: async () => [],
  };
}
