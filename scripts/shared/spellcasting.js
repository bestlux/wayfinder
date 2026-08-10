import { listActorItems } from "../build-state.js";
export function findSpellcastingEntryForChoice(actor, choice) {
    return findSpellcastingEntryForChoiceInItems(listActorItems(actor), choice);
}
export function findSpellcastingEntryForChoiceInItems(actorItems, choice) {
    return findSpellcastingEntriesForChoiceInItems(actorItems, choice)[0] ?? null;
}
export function findSpellcastingEntriesForChoiceInItems(actorItems, choice) {
    const items = actorItems.map(asSpellcastingEntry);
    const keyedEntries = items.filter((item) => item?.type === "spellcastingEntry" && item?.flags?.["wayfinder-pf2e"]?.destinationKey === choice.destination.key);
    if (keyedEntries.length > 0 || choice.destination.entryReuse === "key-only") {
        return keyedEntries.filter((entry) => entry !== null);
    }
    const matchingEntries = items.filter((item) => itemMatchesSpellcastingEntry(item, choice));
    const namedEntries = matchingEntries.filter((item) => String(item?.name ?? "") === choice.destination.entryName);
    return (namedEntries.length > 0 ? namedEntries : matchingEntries).filter((entry) => entry !== null);
}
export function wizardMaxSpellRank(level) {
    return Math.max(1, Math.min(10, Math.ceil(level / 2)));
}
export function magusMaxSpellRank(level) {
    return Math.min(9, wizardMaxSpellRank(level));
}
function asSpellcastingEntry(value) {
    return value && typeof value === "object" ? value : null;
}
function itemMatchesSpellcastingEntry(item, choice) {
    return (item?.type === "spellcastingEntry" &&
        String(item?.system?.tradition?.value ?? "")
            .trim()
            .toLowerCase() === choice.destination.tradition &&
        String(item?.system?.prepared?.value ?? "")
            .trim()
            .toLowerCase() === choice.destination.prepared &&
        String(item?.system?.ability?.value ?? "")
            .trim()
            .toLowerCase() === choice.destination.ability);
}
//# sourceMappingURL=spellcasting.js.map