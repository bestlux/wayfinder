import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import {
  clearDraftSlotDecisions,
  findDraftSelectionByType,
  hasDuplicateDraftSelection,
  listDraftDecisionSlotIds,
  readDraftStepSelection,
  writeDraftStepSelection,
} from "../src/wayfinder/draft-decisions";

describe("draft-decisions", () => {
  it("finds singleton draft selections by item type", () => {
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "class", "wizard");

    expect(findDraftSelectionByType(draft, "class")?.uuid).toBe("Compendium.test.pack.Item.wizard");
    expect(findDraftSelectionByType(draft, "deity")).toBeNull();
  });

  it("detects duplicates across regular and branch selections", () => {
    const draft = createEmptyDraft(1);
    const duplicate = selection("class-branch-arcane-school-level-1", "feat", "school-of-battle-magic");
    draft.selections["class-feat-level-2"] = {
      ...duplicate,
      slotId: "class-feat-level-2",
    };

    expect(hasDuplicateDraftSelection(draft, duplicate)).toBe(true);
    expect(hasDuplicateDraftSelection(draft, selection("deity-level-1", "deity", "iomedae"))).toBe(false);
  });

  it("reads and writes the correct selection bucket for each step kind", () => {
    const draft = createEmptyDraft(1);
    const branchStep = step("class-branch", "class-branch-arcane-school-level-1");
    const pickStep = step("pick-item", "class-level-1");

    const classSelection = selection("class-level-1", "class", "wizard");
    const branchSelection = selection("class-branch-arcane-school-level-1", "feat", "school-of-battle-magic");

    expect(writeDraftStepSelection(draft, pickStep, classSelection)).toBeNull();
    expect(writeDraftStepSelection(draft, branchStep, branchSelection)).toBeNull();

    expect(readDraftStepSelection(draft, pickStep)?.uuid).toBe(classSelection.uuid);
    expect(readDraftStepSelection(draft, branchStep)?.uuid).toBe(branchSelection.uuid);
  });

  it("clears all stored decision types for a slot id and reports unique decision slots", () => {
    const draft = createEmptyDraft(5);
    draft.selections["class-level-1"] = selection("class-level-1", "class", "wizard");
    draft.branchSelections["class-choice-wizard-thesis-level-1"] = selection(
      "class-choice-wizard-thesis-level-1",
      "feat",
      "spell-substitution"
    );
    draft.classChoices["class-choice-wizard-thesis-level-1"] = "spell-substitution";
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: { wizardSkill: "arcana" },
      additional: ["society"],
    };
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      selection("spell-choice-wizard-spellbook-rank-1-level-1", "spell", "magic-missile"),
    ];

    expect(listDraftDecisionSlotIds(draft)).toEqual([
      "class-level-1",
      "class-choice-wizard-thesis-level-1",
      "skill-training-wizard-level-1",
      "spell-choice-wizard-spellbook-rank-1-level-1",
    ]);

    expect(clearDraftSlotDecisions(draft, "class-choice-wizard-thesis-level-1")).toBe(true);
    expect(draft.branchSelections["class-choice-wizard-thesis-level-1"]).toBeUndefined();
    expect(draft.classChoices["class-choice-wizard-thesis-level-1"]).toBeUndefined();
    expect(clearDraftSlotDecisions(draft, "missing-slot")).toBe(false);
  });
});

function step(kind: PendingStep["kind"], slotId: string): Pick<PendingStep, "kind" | "slotId"> {
  return { kind, slotId };
}

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
