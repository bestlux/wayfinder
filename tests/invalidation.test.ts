import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PickerFilterState } from "../src/types";
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
    const pickerFiltersByStepId = new Map<string, PickerFilterState>([
      [SLOT_IDS.ancestry, { rank: [], rarity: ["common"], source: [] }],
    ]);
    const recentlyInvalidatedStepIds = new Set<string>();
    const scrollById = new Map<string, number>([
      [SLOT_IDS.ancestry, 5],
      [`${SLOT_IDS.ancestry}:options`, 10],
    ]);

    let ancestryResetCount = 0;

    expect(
      clearSelectionState(
        { draft, previewValueByStepId, pickerFiltersByStepId, recentlyInvalidatedStepIds, scrollById },
        SLOT_IDS.ancestry,
        {
          resetAncestryBoostDraft: () => {
            ancestryResetCount += 1;
            draft.boosts.ancestry.modeTouched = false;
            return true;
          },
          resetBackgroundBoostDraft: () => false,
          resetClassBoostDraft: () => false,
        }
      )
    ).toBe(1);

    expect(draft.selections[SLOT_IDS.ancestry]).toBeUndefined();
    expect(ancestryResetCount).toBe(1);
    expect(recentlyInvalidatedStepIds.has(SLOT_IDS.abilityBoostsLevel1)).toBe(true);
    expect(previewValueByStepId.has(SLOT_IDS.ancestry)).toBe(false);
    expect(pickerFiltersByStepId.has(SLOT_IDS.ancestry)).toBe(false);
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
    const pickerFiltersByStepId = new Map<string, PickerFilterState>();
    const recentlyInvalidatedStepIds = new Set<string>();
    const scrollById = new Map<string, number>();
    const state = { draft, previewValueByStepId, pickerFiltersByStepId, recentlyInvalidatedStepIds, scrollById };
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

  it("invalidates filter-only dependent steps for a prefix", () => {
    const draft = createEmptyDraft(1);
    const previewValueByStepId = new Map<string, string>([["class-branch-cause-level-1", "test.pack:paladin"]]);
    const pickerFiltersByStepId = new Map<string, PickerFilterState>([
      ["class-branch-cause-level-1", { rank: [], rarity: ["common"], source: ["Player Core"] }],
    ]);
    const recentlyInvalidatedStepIds = new Set<string>();
    const scrollById = new Map<string, number>([["class-branch-cause-level-1:options", 24]]);
    const state = { draft, previewValueByStepId, pickerFiltersByStepId, recentlyInvalidatedStepIds, scrollById };
    const hooks = {
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => false,
    };

    expect(invalidateSelectionsByPrefix(state, SLOT_PREFIXES.classBranch, hooks)).toEqual([
      "class-branch-cause-level-1",
    ]);
    expect(previewValueByStepId.has("class-branch-cause-level-1")).toBe(false);
    expect(pickerFiltersByStepId.has("class-branch-cause-level-1")).toBe(false);
    expect(scrollById.has("class-branch-cause-level-1:options")).toBe(false);
  });

  it("invalidates scroll-only dependent steps for a prefix", () => {
    const draft = createEmptyDraft(1);
    const previewValueByStepId = new Map<string, string>();
    const pickerFiltersByStepId = new Map<string, PickerFilterState>();
    const recentlyInvalidatedStepIds = new Set<string>();
    const scrollById = new Map<string, number>([
      ["class-branch-cause-level-1:options", 24],
      ["class-branch-cause-level-1:preview", 6],
    ]);
    const state = { draft, previewValueByStepId, pickerFiltersByStepId, recentlyInvalidatedStepIds, scrollById };
    const hooks = {
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => false,
    };

    expect(invalidateSelectionsByPrefix(state, SLOT_PREFIXES.classBranch, hooks)).toEqual([
      "class-branch-cause-level-1",
    ]);
    expect(scrollById.size).toBe(0);
  });

  it("preserves player attestations on ordinary spell clear but removes them on dependency invalidation", () => {
    const slotId = "spell-choice-wizard-level-1";
    const draft = createEmptyDraft(1);
    draft.spellChoices[slotId] = [selection(slotId, "spell", "forbidding-ward")];
    draft.spellRarityAttestations[slotId] = unresolvedAttestation(slotId);
    const state = {
      draft,
      previewValueByStepId: new Map<string, string>(),
      pickerFiltersByStepId: new Map<string, PickerFilterState>(),
      recentlyInvalidatedStepIds: new Set<string>(),
      scrollById: new Map<string, number>(),
    };
    const hooks = {
      resetAncestryBoostDraft: () => false,
      resetBackgroundBoostDraft: () => false,
      resetClassBoostDraft: () => false,
    };

    expect(clearSelectionState(state, slotId, hooks)).toBe(1);
    expect(draft.spellChoices[slotId]).toBeUndefined();
    expect(draft.spellRarityAttestations[slotId]).toEqual(unresolvedAttestation(slotId));

    expect(invalidateSelectionState(state, slotId, hooks)).toEqual([slotId]);
    expect(draft.spellRarityAttestations[slotId]).toBeUndefined();
  });

  it("includes attestation-only spell slots in prefix invalidation", () => {
    const slotId = "spell-choice-wizard-level-1";
    const draft = createEmptyDraft(1);
    draft.spellRarityAttestations[slotId] = unresolvedAttestation(slotId);
    const state = {
      draft,
      previewValueByStepId: new Map<string, string>(),
      pickerFiltersByStepId: new Map<string, PickerFilterState>(),
      recentlyInvalidatedStepIds: new Set<string>(),
      scrollById: new Map<string, number>(),
    };

    expect(
      invalidateSelectionsByPrefix(state, SLOT_PREFIXES.spellChoice, {
        resetAncestryBoostDraft: () => false,
        resetBackgroundBoostDraft: () => false,
        resetClassBoostDraft: () => false,
      })
    ).toEqual([slotId]);
    expect(draft.spellRarityAttestations).toEqual({});
  });
});

function unresolvedAttestation(slotId: string) {
  return {
    version: 1 as const,
    kind: "spell-rarity-access" as const,
    trust: "player-attestation" as const,
    status: "unresolved" as const,
    slotId,
    migratedFrom: "legacy-boolean" as const,
  };
}

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
