export function spellMatchesChoice(item, choice, entryId) {
    if (item?.type !== "spell") {
        return false;
    }
    const itemEntryId = typeof item?.system?.location?.value === "string"
        ? item.system.location.value
        : typeof item?.system?.location === "string"
            ? item.system.location
            : null;
    if (itemEntryId !== entryId) {
        return false;
    }
    const traditions = Array.isArray(item?.system?.traits?.traditions)
        ? item.system.traits.traditions.map((value) => value.trim().toLowerCase())
        : [];
    if (!traditions.includes(choice.destination.tradition)) {
        return false;
    }
    const traits = Array.isArray(item?.system?.traits?.value)
        ? item.system.traits.value.map((value) => value.trim().toLowerCase())
        : [];
    const isCantrip = traits.includes("cantrip");
    if (choice.cantrip !== isCantrip) {
        return false;
    }
    const level = Number(item?.system?.level?.value ?? 0);
    const rank = choice.cantrip ? 0 : level;
    if (rank < choice.minRank || rank > choice.maxRank) {
        return false;
    }
    const itemName = String(item?.name ?? "");
    const additionalAllowedSpellNames = choice.additionalAllowedSpellNames ?? [];
    const restrictToCommon = choice.restrictToCommon ?? false;
    if (choice.curriculumSpellNames.length === 0) {
        if (additionalAllowedSpellNames.some((name) => namesMatch(name, itemName))) {
            return true;
        }
        if (!restrictToCommon) {
            return true;
        }
        const rarity = String(item?.system?.traits?.rarity ?? "")
            .trim()
            .toLowerCase();
        return rarity === "" || rarity === "common";
    }
    return choice.curriculumSpellNames.some((name) => namesMatch(name, itemName));
}
function namesMatch(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
//# sourceMappingURL=spell-matching.js.map