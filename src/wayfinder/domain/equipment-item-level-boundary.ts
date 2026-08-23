import type { ResolvedEquipmentRecipe } from "./equipment-policy.js";

export type EquipmentItemLevelRecipeKind = ResolvedEquipmentRecipe["kind"];

export interface EquipmentItemLevelBoundary {
  /** Highest item level exposed by the catalogue for any funding lane. */
  readonly catalogueMaximum: number;
  /** Highest item level that starting currency can fund. */
  readonly currencyMaximum: number;
}

/**
 * Resolve the recipe's item-level limits once for browse presentation and prepared acquisition.
 *
 * Level 1 is its own 15 gp starting-money recipe and permits at-level items. Higher-level
 * permanent-item recipes expose at-level items only for allowances, while their residual currency
 * and both lump-sum recipes remain limited to items below the target level.
 */
export function resolveEquipmentItemLevelBoundary(
  targetLevel: number,
  recipeKind: EquipmentItemLevelRecipeKind
): EquipmentItemLevelBoundary {
  if (!Number.isSafeInteger(targetLevel) || targetLevel < 1 || targetLevel > 20) {
    throw new TypeError("Equipment item-level boundaries require a target level from 1 through 20.");
  }
  if (targetLevel === 1) {
    if (recipeKind === "custom-lump-sum") {
      throw new TypeError("Level-1 acquisition cannot use a custom lump-sum recipe.");
    }
    return Object.freeze({ catalogueMaximum: 1, currencyMaximum: 1 });
  }
  if (recipeKind === "level-1-equivalent" && targetLevel !== 1) {
    throw new TypeError("The level-1 starting-money recipe requires a level-1 target.");
  }

  const belowTargetMaximum = targetLevel - 1;
  return Object.freeze({
    catalogueMaximum:
      recipeKind === "level-1-equivalent" || recipeKind === "permanent-items" ? targetLevel : belowTargetMaximum,
    currencyMaximum: recipeKind === "level-1-equivalent" ? targetLevel : belowTargetMaximum,
  });
}

export function itemLevelWithinCurrencyBoundary(boundary: EquipmentItemLevelBoundary, itemLevel: number): boolean {
  return Number.isSafeInteger(itemLevel) && itemLevel >= 0 && itemLevel <= boundary.currencyMaximum;
}
