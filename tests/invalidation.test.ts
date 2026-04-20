import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  clearSelectionState,
  invalidateSelectionState,
  invalidateSelectionsByPrefix,
} from "../src/wayfinder/invalidation";
import { SLOT_IDS, SLOT_PREFIXES } from "../src/wayfinder/slot-ids";

describe("wayfinder invalidation helpers", () => {
  it("clears slot state, resets boosts, and drops transient UI state", () => {
    const draft = createEmptyDraft(1);
    draft.selections[SLOT_IDS.ancestry] = selection(SLOT_IDS.ancestry, "ancestry", "human");
    draft.boosts.ancestry.modeTouched = true;

    const previewValueByStepId = new Map<string, string>([[SLOT_IDS.ancestry, "human"]]);
    const recentlyInvalidatedStepIds = new Set<string>();
    const scrollById = new Map<string, number>([
      [SLOT_IDS.ancestry, 5],
      [`${SLOT_IDS.ancestry}:options`, 10],
    ]);

    let ancestryResetCount = 0;

    expect(
      clearSelectionState({ draft, previewValueByStepId, recentlyInvalidatedStepIds, scrollById }, SLOT_IDS.ancestry, {
        resetAncestryBoostDraft: () => {
          ancestryResetCount += 1;
          draft.boosts.ancestry.modeTouched = false;
          return true;
        },
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => false,
      })
    ).toBe(1);

    expect(draft.selections[SLOT_IDS.ancestry]).toBeUndefined();
    expect(ancestryResetCount).toBe(1);
    expect(recentlyInvalidatedStepIds.has(SLOT_IDS.abilityBoostsLevel1)).toBe(true);
    expect(previewValueByStepId.has(SLOT_IDS.ancestry)).toBe(false);
    expect(scrollById.size).toBe(0);
  });

  it("marks invalidated slots and clears all matching decision buckets for a prefix", () => {
    const draft = createEmptyDraft(3);
    draft.selections["class-feat-level-2"] = selection("class-feat-level-2", "feat", "reach-spell");
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "feat",
      "school-of-battle-magic"
    );
    draft.classChoices["class-choice-wizard-thesis-level-1"] = "spell-substitution";

    const previewValueByStepId = new Map<string, string>();
    const recentlyInvalidatedStepIds = new Set<string>();
    const scrollById = new Map<string, number>();
    const state = { draft, previewValueByStepId, recentlyInvalidatedStepIds, scrollById };
    const hooks = {
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => false,
    };

    expect(invalidateSelectionState(state, "class-choice-wizard-thesis-level-1", hooks)).toEqual([
      "class-choice-wizard-thesis-level-1",
    ]);
    expect(recentlyInvalidatedStepIds.has("class-choice-wizard-thesis-level-1")).toBe(true);

    expect(invalidateSelectionsByPrefix(state, SLOT_PREFIXES.classBranch, hooks)).toEqual([
      "class-branch-arcane-school-level-1",
    ]);
    expect(draft.branchSelections["class-branch-arcane-school-level-1"]).toBeUndefined();
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
