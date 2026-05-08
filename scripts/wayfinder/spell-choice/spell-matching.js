export function spellMatchesChoice(item, choice, entryId) {
    if (item.type !== "spell") {
        return false;
    }
    const itemEntryId = readLocationId(item);
    if (itemEntryId !== entryId) {
        return false;
    }
    const traits = readNormalizedStringList(item.system?.traits?.value);
    const isCantrip = traits.includes("cantrip");
    if (choice.cantrip !== isCantrip) {
        return false;
    }
    const level = Number(item.system?.level?.value ?? 0);
    const rank = choice.cantrip ? 0 : level;
    if (rank < choice.minRank || rank > choice.maxRank) {
        return false;
    }
    const itemName = String(item.name ?? "");
    const additionalAllowedSpellNames = choice.additionalAllowedSpellNames ?? [];
    const additionalAllowedSpellUuids = new Set((choice.additionalAllowedSpellUuids ?? []).map((uuid) => uuid.trim().toLowerCase()).filter(Boolean));
    const restrictToCommon = choice.restrictToCommon ?? false;
    if (choice.curriculumSpellNames.length === 0) {
        if (additionalAllowedSpellNames.some((name) => namesMatch(name, itemName)) ||
            readSourceIds(item).some((sourceId) => additionalAllowedSpellUuids.has(sourceId.trim().toLowerCase()))) {
            return true;
        }
        const traditions = readNormalizedStringList(item.system?.traits?.traditions);
        if (!traditions.includes(choice.destination.tradition)) {
            return false;
        }
        if (!restrictToCommon) {
            return true;
        }
        const rarity = String(item.system?.traits?.rarity ?? "")
            .trim()
            .toLowerCase();
        return rarity === "" || rarity === "common";
    }
    return choice.curriculumSpellNames.some((name) => namesMatch(name, itemName));
}
function namesMatch(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
function readNormalizedStringList(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim().toLowerCase())
        : [];
}
function readLocationId(item) {
    const location = item.system?.location;
    if (typeof location === "string") {
        return location;
    }
    return typeof location?.value === "string" ? location.value : null;
}
function readSourceIds(item) {
    const stats = item._stats;
    return [item.sourceId, item.flags?.core?.sourceId, stats?.compendiumSource].filter((value) => typeof value === "string" && value.trim().length > 0);
}
//# sourceMappingURL=spell-matching.js.map