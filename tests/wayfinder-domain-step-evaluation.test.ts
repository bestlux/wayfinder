import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { getWayfinderStepStatus, isWayfinderStepComplete } from "../src/wayfinder/domain/step-evaluation";
import {
  createBoostStep,
  createClassArchetypeStep,
  createClassChoiceStep,
  createSpellChoiceStep,
  getStepModeLabel,
} from "../src/wayfinder/domain/step-types";

describe("wayfinder domain step evaluation", () => {
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

    expect(
      await isWayfinderStepComplete(step, draft, {} as EffectiveBuildState, {
        isTrainingStepComplete: () => false,
      })
    ).toBe(true);
    expect(
      await getWayfinderStepStatus(step, draft, new Set(), {} as EffectiveBuildState, {
        isTrainingStepComplete: () => false,
      })
    ).toBe("Standard class path");
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

    expect(
      await getWayfinderStepStatus(step, draft, new Set<string>(), {} as EffectiveBuildState, {
        isTrainingStepComplete: () => false,
      })
    ).toBe("Holy");
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
    draft.spellChoices[step.slotId] = [
      {
        slotId: step.slotId,
        packId: "pf2e.spells-srd",
        documentId: "magic-missile",
        uuid: "Compendium.pf2e.spells-srd.Item.magic-missile",
        itemType: "spell",
        featType: null,
        name: "Magic Missile",
        level: 1,
      },
    ];

    expect(
      await isWayfinderStepComplete(step, draft, {} as EffectiveBuildState, {
        isTrainingStepComplete: () => false,
      })
    ).toBe(false);
    expect(
      await getWayfinderStepStatus(step, draft, new Set<string>(), {} as EffectiveBuildState, {
        isTrainingStepComplete: () => false,
      })
    ).toBe("1/2 chosen");
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
    const deps = { isTrainingStepComplete: () => false };

    expect(await isWayfinderStepComplete(level2, draft, buildState, deps)).toBe(true);
    expect(await isWayfinderStepComplete(level3, draft, buildState, deps)).toBe(true);
    expect(await getWayfinderStepStatus(level2, draft, new Set(), buildState, deps)).toBe("Ready to apply");
  });
});
