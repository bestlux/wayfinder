import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import { levelFromSelectionSlotId, selectionTakenLevel } from "../src/wayfinder/selection-level";

describe("wayfinder selection acquisition levels", () => {
  it("prefers the progression slot over an item's minimum level", () => {
    const selection: SelectionRef = {
      slotId: "general-feat-level-3",
      packId: "pf2e.feats-srd",
      documentId: "adopted-ancestry",
      uuid: "Compendium.pf2e.feats-srd.Item.adopted-ancestry",
      itemType: "feat",
      featType: "general",
      name: "Adopted Ancestry",
      level: 1,
    };

    expect(selectionTakenLevel(selection)).toBe(3);
    expect(levelFromSelectionSlotId("general-feat-level-3")).toBe(3);
  });
});
