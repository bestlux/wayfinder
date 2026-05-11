import { listActorItems } from "../../build-state.js";
import { MODULE_ID } from "../../constants.js";
import { findSpellcastingEntryForChoice } from "../../shared/spellcasting.js";
import { dedupeSelections, selectionFromActorItem } from "./source-utils.js";
import { spellMatchesChoice } from "./spell-matching.js";
export function readExistingSpellChoiceSelections(actor, choice) {
    const entry = findSpellcastingEntryForChoice(actor, choice);
    if (!entry?.id) {
        return [];
    }
    const entryId = String(entry.id);
    const actorItems = listActorItems(actor);
    const completedStepIds = readWayfinderCompletedStepIds(actor);
    const selectedBySlot = actorItems
        .filter((item) => item.type === "spell" && wayfinderSlotId(item) === choice.slotId && spellMatchesChoice(item, choice, entryId))
        .map((item) => selectionFromActorItem(item, choice.slotId))
        .filter((selection) => !!selection);
    if (selectedBySlot.length > 0) {
        return dedupeSelections(selectedBySlot).slice(0, choice.count);
    }
    if (completedStepIds && !completedStepIds.has(choice.slotId)) {
        return [];
    }
    const eligible = actorItems
        .filter((item) => {
        const slotId = wayfinderSlotId(item);
        return (!slotId || slotId === choice.slotId) && spellMatchesChoice(item, choice, entryId);
    })
        .map((item) => selectionFromActorItem(item, choice.slotId))
        .filter((selection) => !!selection);
    return dedupeSelections(eligible).slice(0, choice.count);
}
function readWayfinderCompletedStepIds(actor) {
    const completedStepIds = actor
        ?.flags?.[MODULE_ID]?.state?.completedStepIds;
    if (!Array.isArray(completedStepIds)) {
        return null;
    }
    return new Set(completedStepIds.filter((stepId) => typeof stepId === "string"));
}
function wayfinderSlotId(item) {
    const value = item.flags?.[MODULE_ID]?.slotId;
    return typeof value === "string" && value.length > 0 ? value : null;
}
//# sourceMappingURL=existing-selections.js.map