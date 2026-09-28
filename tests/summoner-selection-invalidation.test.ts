import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PickerFilterState, SelectionRef } from "../src/types";
import { selectClassChoiceValue } from "../src/wayfinder/application/selection-command-service";
import { createSelectionInvalidationService } from "../src/wayfinder/application/selection-invalidation-service";
import { discoverClassChoiceMeta } from "../src/wayfinder/class-choice/rule-discovery";
import { createClassChoiceStep } from "../src/wayfinder/domain/step-types";
import { pf2e841DragonEidolonEntry } from "./fixtures/pf2e-841-eidolons";

const SLOT = "class-choice-dragon-eidolon-eidolonTradition-level-1";
const CANTRIPS = "spell-choice-summoner-cantrips-level-1";
const REPERTOIRE = "spell-choice-summoner-repertoire-rank-1-level-1";
const ref: SelectionRef = {
  slotId: "class-branch-eidolon-level-1",
  itemType: "feat",
  featType: "classfeature",
  level: 1,
  packId: "pf2e.classfeatures",
  documentId: "JttI3raKFGG4C8up",
  uuid: "Compendium.pf2e.classfeatures.Item.JttI3raKFGG4C8up",
  name: "Dragon Eidolon",
};

function setup() {
  const draft = createEmptyDraft(4);
  draft.classChoices[SLOT] = "arcane";
  draft.branchSelections[ref.slotId] = ref;
  draft.spellChoices[CANTRIPS] = [{ ...ref, slotId: CANTRIPS, itemType: "spell", name: "Arcane cantrip" }];
  draft.spellChoices[REPERTOIRE] = [{ ...ref, slotId: REPERTOIRE, itemType: "spell", name: "Arcane spell" }];
  draft.spellChoices["spell-choice-other"] = [{ ...ref, slotId: "spell-choice-other", itemType: "spell" }];
  // Include an attestation-only slot to verify the prefix clears access notes too.
  draft.spellRarityAttestations["spell-choice-summoner-attestation-only"] = {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "unresolved",
    slotId: "spell-choice-summoner-attestation-only",
    migratedFrom: "legacy-boolean",
  };
  const state = {
    draft,
    previewValueByStepId: new Map<string, string>(),
    pickerFiltersByStepId: new Map<string, PickerFilterState>(),
    recentlyInvalidatedStepIds: new Set<string>(),
    scrollById: new Map<string, number>(),
  };
  const choice = discoverClassChoiceMeta({
    sourceDocument: pf2e841DragonEidolonEntry(),
    sourceSelection: ref,
    classSlug: "summoner",
    extractSlug: () => "dragon-eidolon",
    localize: (s) => s,
    rollOptions: new Set(),
  })[0];
  const service = createSelectionInvalidationService(state, {
    buildPlan: async () => ({ steps: [] }),
    resetAncestryBoostDraft: () => false,
    resetBackgroundBoostDraft: () => false,
    resetClassBoostDraft: () => false,
  });
  return { state, service, step: createClassChoiceStep(1, choice) };
}

describe("Summoner tradition invalidation", () => {
  it.each([
    "primal",
    "arcane",
  ])("clears dependent spells when choosing/toggling %s, without dropping the eidolon", async (value) => {
    const { state, service, step } = setup();
    await selectClassChoiceValue(state, step, value, service);
    expect(state.draft.classChoices[SLOT]).toBe(value === "arcane" ? undefined : value);
    expect(state.draft.branchSelections[ref.slotId]).toEqual(ref);
    expect(Object.keys(state.draft.spellChoices)).toEqual(["spell-choice-other"]);
    expect(state.draft.spellRarityAttestations).toEqual({});
  });

  it("also clears dependent spells through the generic Clear control", () => {
    const { state, service } = setup();
    service.clearSelection(SLOT);
    expect(state.draft.classChoices[SLOT]).toBeUndefined();
    expect(state.draft.branchSelections[ref.slotId]).toEqual(ref);
    expect(Object.keys(state.draft.spellChoices)).toEqual(["spell-choice-other"]);
    expect(state.draft.spellRarityAttestations).toEqual({});
  });
});
