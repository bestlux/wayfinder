import type { PendingStep } from "../../types.js";

export const SPELL_RARITY_CEILINGS = ["common", "uncommon", "rare", "unique"] as const;
export type SpellRarityCeiling = (typeof SPELL_RARITY_CEILINGS)[number];

const SPELL_RARITY_RANK = new Map(SPELL_RARITY_CEILINGS.map((rarity, index) => [rarity, index]));

export function normalizeSpellRarityCeiling(value: unknown): SpellRarityCeiling {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SPELL_RARITY_CEILINGS.includes(normalized as SpellRarityCeiling)
    ? (normalized as SpellRarityCeiling)
    : "common";
}

export function isSpellRarityWithinCeiling(rarity: unknown, ceiling: SpellRarityCeiling): boolean {
  const normalizedRarity = typeof rarity === "string" ? rarity.trim().toLowerCase() : "";
  if (normalizedRarity === "" || ceiling === "unique") {
    return true;
  }

  const rarityRank = SPELL_RARITY_RANK.get(normalizedRarity as SpellRarityCeiling);
  return rarityRank !== undefined && rarityRank <= (SPELL_RARITY_RANK.get(ceiling) ?? 0);
}

export function canGrantRestrictedSpellRarityAccess(
  step: PendingStep,
  ceiling: SpellRarityCeiling = "common"
): boolean {
  return ceiling !== "unique" && hasRestrictedSpellRarityPolicy(step);
}

export function withRestrictedSpellRarityAccess(
  step: PendingStep,
  ceiling: SpellRarityCeiling,
  accessGranted: boolean
): PendingStep {
  if (!hasRestrictedSpellRarityPolicy(step) || step.kind !== "spell-choice") {
    return step;
  }

  const currentCeiling = spellChoiceRarityCeiling(step.spellChoice);
  const effectiveCeiling = accessGranted
    ? "unique"
    : (SPELL_RARITY_RANK.get(ceiling) ?? 0) > (SPELL_RARITY_RANK.get(currentCeiling) ?? 0)
      ? ceiling
      : currentCeiling;
  if (effectiveCeiling === currentCeiling) {
    return step;
  }

  return {
    ...step,
    spellChoice: {
      ...step.spellChoice,
      restrictToCommon: false,
      rarityCeiling: effectiveCeiling,
    },
  };
}

export function spellChoiceRarityCeiling(choice: {
  restrictToCommon?: boolean;
  rarityCeiling?: SpellRarityCeiling;
}): SpellRarityCeiling {
  return choice.rarityCeiling ?? (choice.restrictToCommon === true ? "common" : "unique");
}

function hasRestrictedSpellRarityPolicy(step: PendingStep): boolean {
  return (
    step.kind === "spell-choice" &&
    spellChoiceRarityCeiling(step.spellChoice) !== "unique" &&
    (step.spellChoice.allowedSpellSlugs?.length ?? 0) === 0 &&
    step.spellChoice.curriculumSpellNames.length === 0
  );
}
