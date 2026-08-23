import { describe, expect, it } from "vitest";

import {
  itemLevelWithinCurrencyBoundary,
  resolveEquipmentItemLevelBoundary,
} from "../src/wayfinder/domain/equipment-item-level-boundary";

describe("equipment item-level boundary", () => {
  it("admits level-1 items to the level-1 catalogue and currency lane", () => {
    const effectiveBoundary = resolveEquipmentItemLevelBoundary(1, "level-1-equivalent");
    const permanentSelectionBoundary = resolveEquipmentItemLevelBoundary(1, "permanent-items");
    const lumpSumSelectionBoundary = resolveEquipmentItemLevelBoundary(1, "lump-sum");

    expect(effectiveBoundary).toEqual({ catalogueMaximum: 1, currencyMaximum: 1 });
    expect(permanentSelectionBoundary).toEqual(effectiveBoundary);
    expect(lumpSumSelectionBoundary).toEqual(effectiveBoundary);
    expect(itemLevelWithinCurrencyBoundary(effectiveBoundary, 1)).toBe(true);
    expect(itemLevelWithinCurrencyBoundary(effectiveBoundary, 2)).toBe(false);
  });

  it("keeps higher-level allowance and residual-currency boundaries distinct", () => {
    const permanent = resolveEquipmentItemLevelBoundary(5, "permanent-items");
    const lumpSum = resolveEquipmentItemLevelBoundary(5, "lump-sum");

    expect(permanent).toEqual({ catalogueMaximum: 5, currencyMaximum: 4 });
    expect(lumpSum).toEqual({ catalogueMaximum: 4, currencyMaximum: 4 });
    expect(itemLevelWithinCurrencyBoundary(permanent, 5)).toBe(false);
  });

  it("rejects an inconsistent level-1 recipe target", () => {
    expect(() => resolveEquipmentItemLevelBoundary(2, "level-1-equivalent")).toThrow(/level-1 target/u);
  });

  it("rejects custom level-1 funding instead of silently changing its semantics", () => {
    expect(() => resolveEquipmentItemLevelBoundary(1, "custom-lump-sum")).toThrow(/cannot use a custom lump-sum/u);
  });
});
