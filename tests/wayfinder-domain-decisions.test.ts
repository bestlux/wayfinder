import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { ClassChoiceMeta, SelectionRef, SpellChoiceMeta } from "../src/types";
import {
  listDraftDecisions,
  readDraftStepDecision,
  readDraftStepSelection,
  writeDraftStepSelection,
} from "../src/wayfinder/domain/draft-decisions";
import {
  createClassArchetypeStep,
  createClassBranchStep,
  createClassChoiceStep,
  createPickItemStep,
  createSpellChoiceStep,
} from "../src/wayfinder/domain/step-types";

describe("wayfinder domain draft decisions", () => {
  it("lists typed draft decisions across the current storage buckets", () => {
    const draft = createEmptyDraft(5);
    draft.selections["class-level-1"] = selection("class-level-1", "class", "wizard");
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "feat",
      "school-of-battle-magic"
    );
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "standard";
    draft.classChoices["class-choice-wizard-thesis-level-1"] = "spell-substitution";
    draft.skillIncreases["skill-increase-level-3"] = "arcana";
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: { thesis: "arcana" },
      additional: ["society"],
      loreChoices: {},
    };
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      selection("spell-choice-wizard-spellbook-rank-1-level-1", "spell", "magic-missile"),
    ];
    draft.manual["manual-review-level-1"] = true;

    expect(listDraftDecisions(draft).map((decision) => `${decision.kind}:${decision.slotId}`)).toEqual([
      "selection:class-level-1",
      "class-branch:class-branch-arcane-school-level-1",
      "class-archetype:class-archetype-doctrine-level-1",
      "class-choice:class-choice-wizard-thesis-level-1",
      "manual:manual-review-level-1",
      "skill-increase:skill-increase-level-3",
      "skill-training:skill-training-wizard-level-1",
      "spell-choice:spell-choice-wizard-spellbook-rank-1-level-1",
    ]);
  });

  it("reads and writes decisions using the canonical step variants", () => {
    const draft = createEmptyDraft(1);
    const pickStep = createPickItemStep("class", 1, "Choose a class", "", {
      itemType: "class",
    });
    const branchStep = createClassBranchStep(1, branchMeta());
    const archetypeStep = createClassArchetypeStep(1, classArchetypeMeta());
    const classChoiceStep = createClassChoiceStep(1, classChoiceMeta());
    const spellChoiceStep = createSpellChoiceStep(1, "Wizard spellbook", "", spellChoiceMeta());

    const classSelection = selection("class-level-1", "class", "wizard");
    const branchSelection = selection("class-branch-arcane-school-level-1", "feat", "school-of-battle-magic");

    expect(writeDraftStepSelection(draft, pickStep, classSelection)).toBeNull();
    expect(writeDraftStepSelection(draft, branchStep, branchSelection)).toBeNull();

    draft.classChoices[classChoiceStep.slotId] = "spell-substitution";
    draft.classArchetypeChoices[archetypeStep.slotId] = "battle-creed";
    draft.spellChoices[spellChoiceStep.slotId] = [
      selection(spellChoiceStep.slotId, "spell", "magic-missile"),
      selection(spellChoiceStep.slotId, "spell", "mage-armor"),
    ];

    expect(readDraftStepSelection(draft, pickStep)?.uuid).toBe(classSelection.uuid);
    expect(readDraftStepSelection(draft, branchStep)?.uuid).toBe(branchSelection.uuid);
    expect(readDraftStepDecision(draft, archetypeStep)).toEqual({
      kind: "class-archetype",
      slotId: archetypeStep.slotId,
      value: "battle-creed",
    });
    expect(readDraftStepDecision(draft, classChoiceStep)).toMatchObject({
      kind: "class-choice",
      slotId: classChoiceStep.slotId,
      value: "spell-substitution",
    });
    expect(readDraftStepDecision(draft, spellChoiceStep)).toMatchObject({
      kind: "spell-choice",
      slotId: spellChoiceStep.slotId,
      selections: expect.arrayContaining([
        expect.objectContaining({ documentId: "magic-missile" }),
        expect.objectContaining({ documentId: "mage-armor" }),
      ]),
    });
  });
});

function selection(slotId: string, itemType: string, documentId: string): SelectionRef {
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

function branchMeta() {
  return {
    slotId: "class-branch-arcane-school-level-1",
    selectorPackId: "pf2e.classfeatures",
    selectorDocumentId: "wizard-arcane-school",
    selectorUuid: "Compendium.pf2e.classfeatures.Item.wizard-arcane-school",
    selectorName: "Arcane School",
    selectorRuleIndex: 0,
    flag: "school",
    optionTag: "arcane-school",
    classSlug: "wizard",
    dependsOn: "class",
  } as const;
}

function classChoiceMeta(): ClassChoiceMeta {
  return {
    slotId: "class-choice-wizard-thesis-level-1",
    sourcePackId: "pf2e.classfeatures",
    sourceDocumentId: "wizard-thesis",
    sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-thesis",
    sourceName: "Arcane Thesis",
    sourceRuleIndex: 1,
    flag: "thesis",
    classSlug: "wizard",
    dependsOn: "class",
    options: [
      { value: "spell-substitution", label: "Spell Substitution", img: null, detail: null },
      { value: "spell-blending", label: "Spell Blending", img: null, detail: null },
    ],
  };
}

function classArchetypeMeta() {
  return {
    slotId: "class-archetype-doctrine-level-1",
    standardValue: "standard",
    sourceName: "Doctrine",
    selector: {
      ...branchMeta(),
      slotId: "class-branch-doctrine-level-1",
      selectorName: "Doctrine",
      optionTag: "cleric-doctrine",
      classSlug: "cleric",
    },
    options: [
      { value: "standard", label: "Standard", img: null, detail: null },
      { value: "battle-creed", label: "Battle Creed", img: null, detail: null },
    ],
  };
}

function spellChoiceMeta(): SpellChoiceMeta {
  return {
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
  };
}
