import { listActorItems } from "../build-state.js";
export function findSpellcastingEntryForChoice(actor, choice) {
    return findSpellcastingEntryForChoiceInItems(listActorItems(actor), choice);
}
export function findSpellcastingEntryForChoiceInItems(actorItems, choice) {
    const items = actorItems.map(asSpellcastingEntry);
    const keyedEntry = items.find((item) => item?.type === "spellcastingEntry" && item?.flags?.["wayfinder-pf2e"]?.destinationKey === choice.destination.key);
    if (keyedEntry || choice.destination.entryReuse === "key-only") {
        return keyedEntry ?? null;
    }
    return (items.find((item) => itemMatchesSpellcastingEntry(item, choice) && String(item?.name ?? "") === choice.destination.entryName) ??
        items.find((item) => itemMatchesSpellcastingEntry(item, choice)) ??
        null);
}
export function wizardMaxSpellRank(level) {
    return Math.max(1, Math.min(9, Math.ceil(level / 2)));
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