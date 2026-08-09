export const SPELL_RARITY_CEILINGS = ["common", "uncommon", "rare", "unique"];
const SPELL_RARITY_RANK = new Map(SPELL_RARITY_CEILINGS.map((rarity, index) => [rarity, index]));
export function normalizeSpellRarityCeiling(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return SPELL_RARITY_CEILINGS.includes(normalized)
        ? normalized
        : "common";
}
export function isSpellRarityWithinCeiling(rarity, ceiling) {
    const normalizedRarity = typeof rarity === "string" ? rarity.trim().toLowerCase() : "";
    if (normalizedRarity === "" || ceiling === "unique") {
        return true;
    }
    const rarityRank = SPELL_RARITY_RANK.get(normalizedRarity);
    return rarityRank !== undefined && rarityRank <= (SPELL_RARITY_RANK.get(ceiling) ?? 0);
}
export function canGrantRestrictedSpellRarityAccess(step, ceiling = "common") {
    return ceiling !== "unique" && hasRestrictedSpellRarityPolicy(step);
}
export function withRestrictedSpellRarityAccess(step, ceiling, accessGranted) {
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
export function spellChoiceRarityCeiling(choice) {
    return choice.rarityCeiling ?? (choice.restrictToCommon === true ? "common" : "unique");
}
function hasRestrictedSpellRarityPolicy(step) {
    return (step.kind === "spell-choice" &&
        spellChoiceRarityCeiling(step.spellChoice) !== "unique" &&
        (step.spellChoice.allowedSpellSlugs?.length ?? 0) === 0 &&
        step.spellChoice.curriculumSpellNames.length === 0);
}
//# sourceMappingURL=rarity-access.js.map