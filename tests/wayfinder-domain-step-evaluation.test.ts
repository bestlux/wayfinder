import { describe, expect, it, vi } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import {
  evaluateWayfinderDraftReadiness,
  evaluateWayfinderStep,
  getWayfinderStepStatus,
  isWayfinderStepComplete,
} from "../src/wayfinder/domain/step-evaluation";
import {
  createBoostStep,
  createClassArchetypeStep,
  createClassChoiceStep,
  createLanguageChoiceStep,
  createSkillTrainingStep,
  createSpellChoiceStep,
  getStepModeLabel,
} from "../src/wayfinder/domain/step-types";

describe("wayfinder domain step evaluation", () => {
  it("evaluates every planned step once and fails closed on an inconsistent result", async () => {
    const steps = [createManualStep("first"), createManualStep("second")];
    const evaluateStep = vi.fn(async (step: (typeof steps)[number]) => ({
      state: "incomplete" as const,
      complete: false as const,
      status: "Choose one",
      issue: null,
      step,
    }));

    const readiness = await evaluateWayfinderDraftReadiness(steps, evaluateStep as never);

    expect(evaluateStep).toHaveBeenCalledTimes(2);
    expect(readiness.ready).toBe(false);
  });

  it("treats explicit Standard as a complete class-archetype decision", async () => {
    const draft = createEmptyDraft(1);
    const step = createClassArchetypeStep(1, {
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
    });
    draft.classArchetypeChoices[step.slotId] = "standard";

    expect(await isWayfinderStepComplete(step, draft, {} as EffectiveBuildState)).toBe(true);
    expect(await getWayfinderStepStatus(step, draft, new Set(), {} as EffectiveBuildState)).toBe("Standard class path");
    expect(getStepModeLabel(step.kind)).toBe("Class Archetype");
  });

  it("uses typed class-choice metadata to resolve the selected label", async () => {
    const draft = createEmptyDraft(1);
    const step = createClassChoiceStep(1, {
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
    });
    draft.classChoices[step.slotId] = "holy";

    expect(await getWayfinderStepStatus(step, draft, new Set<string>(), {} as EffectiveBuildState)).toBe("Holy");
    expect(getStepModeLabel(step.kind)).toBe("Class Choice");
  });

  it("tracks spell-choice completion against the step count", async () => {
    const draft = createEmptyDraft(1);
    const step = createSpellChoiceStep(1, "Wizard spellbook", "", {
      slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "wizard-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
      sourceName: "Wizard Spellcasting",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "spellbook",
        key: "wizard-arcane-prepared",
        label: "Wizard spellbook",
        entryName: "Arcane Prepared Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
    });
    draft.spellChoices[step.slotId] = [spellSelection(step.slotId, "magic-missile", "Magic Missile")];
    expect(await isWayfinderStepComplete(step, draft, {} as EffectiveBuildState)).toBe(false);
    expect(await getWayfinderStepStatus(step, draft, new Set<string>(), {} as EffectiveBuildState)).toBe("1/2 chosen");
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "incomplete",
      complete: false,
      issue: { code: "missing-choice", message: "Wizard spellbook: choose 1 more spell." },
    });

    draft.spellChoices[step.slotId]?.push(spellSelection(step.slotId, "fear", "Fear"));
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toEqual({
      state: "complete",
      complete: true,
      status: "Ready to apply",
      issue: null,
    });

    draft.spellChoices[step.slotId]?.push(spellSelection(step.slotId, "force-barrage", "Force Barrage"));
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "excess",
      complete: false,
      status: "3/2 chosen · remove 1",
      issue: { code: "too-many-choices", message: "Wizard spellbook: remove 1 extra spell choice." },
    });

    draft.spellChoices[step.slotId]?.pop();
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "complete",
      complete: true,
      issue: null,
    });
  });

  it("classifies incomplete, complete, and excess language choices", async () => {
    const draft = createEmptyDraft(1);
    const step = createLanguageChoiceStep(1, {
      slotId: "language-choice-level-1",
      sourceItemType: "ancestry",
      sourceName: "Human",
      grantedLanguages: ["common"],
      count: 2,
      options: [
        { value: "draconic", label: "Draconic", requiresGmApproval: false },
        { value: "dwarven", label: "Dwarven", requiresGmApproval: false },
        { value: "elven", label: "Elven", requiresGmApproval: false },
      ],
    });

    draft.languageChoices[step.slotId] = ["draconic"];
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "incomplete",
      issue: { code: "missing-choice", message: "Bonus languages: choose 1 more language." },
    });

    draft.languageChoices[step.slotId]?.push("dwarven");
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "complete",
      complete: true,
      issue: null,
    });

    draft.languageChoices[step.slotId]?.push("elven");
    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "excess",
      status: "3/2 chosen · remove 1",
      issue: { code: "too-many-choices", message: "Bonus languages: remove 1 extra language choice." },
    });
  });

  it("reports an overfilled training draft as excess with corrective copy", async () => {
    const draft = createEmptyDraft(1);
    const step = createSkillTrainingStep(1, "Wizard training", "", {
      classSlug: "wizard",
      className: "Wizard",
      fixedSkills: ["arcana"],
      fixedLores: [],
      choiceRules: [],
      loreChoices: [],
      additionalCount: 1,
    });
    draft.skillTrainings[step.slotId] = {
      ruleChoices: {},
      additional: ["society", "occultism"],
      loreChoices: {},
    };

    await expect(evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState)).resolves.toMatchObject({
      state: "excess",
      complete: false,
      status: "2/1 chosen · remove 1",
      issue: { code: "too-many-choices", message: "Wizard training: remove 1 extra training choice." },
    });
  });

  it("keeps earlier gradual boost steps complete as their shared native batch grows", async () => {
    const draft = createEmptyDraft(3);
    const buildState = {
      levelBoosts: {
        1: [],
        5: ["str", "dex"],
        10: [],
        15: [],
        20: [],
      },
    } as EffectiveBuildState;
    const level2 = createBoostStep(2, "Level 2 ability boost", "", {
      batchLevel: 5,
      requiredCount: 1,
      grantCount: 1,
    });
    const level3 = createBoostStep(3, "Level 3 ability boost", "", {
      batchLevel: 5,
      requiredCount: 2,
      grantCount: 1,
    });
    expect(await isWayfinderStepComplete(level2, draft, buildState)).toBe(true);
    expect(await isWayfinderStepComplete(level3, draft, buildState)).toBe(true);
    expect(await getWayfinderStepStatus(level2, draft, new Set(), buildState)).toBe("Ready to apply");
  });
});

function spellSelection(slotId: string, documentId: string, name: string): SelectionRef {
  return {
    slotId,
    packId: "pf2e.spells-srd",
    documentId,
    uuid: `Compendium.pf2e.spells-srd.Item.${documentId}`,
    itemType: "spell",
    featType: null,
    name,
    level: 1,
  };
}

function createManualStep(id: string) {
  return {
    id,
    level: 1,
    kind: "manual" as const,
    slotKind: "class" as const,
    title: id,
    description: "",
    required: true,
    slotId: id,
  };
}
