import { listActorItems } from "../../build-state.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { findSpellcastingEntryForChoice } from "../../shared/spellcasting.js";
import { spellMatchesChoice } from "./spell-matching.js";
export function readExistingSpellChoiceSelections(actor, choice) {
    const entry = findSpellcastingEntryForChoice(actor, choice);
    if (!entry?.id) {
        return [];
    }
    const entryId = String(entry.id);
    const selectedBySlot = listActorItems(actor)
        .filter((item) => item?.type === "spell" &&
        item?.flags?.["pf2e-wayfinder"]?.slotId === choice.slotId &&
        spellMatchesChoice(item, choice, entryId))
        .map((item) => selectionFromActorItem(item, choice.slotId))
        .filter((selection) => !!selection);
    if (selectedBySlot.length > 0) {
        return dedupeSelections(selectedBySlot).slice(0, choice.count);
    }
    const eligible = listActorItems(actor)
        .filter((item) => spellMatchesChoice(item, choice, entryId))
        .map((item) => selectionFromActorItem(item, choice.slotId))
        .filter((selection) => !!selection);
    return dedupeSelections(eligible).slice(0, choice.count);
}
function selectionFromActorItem(item, slotId) {
    const sourceUuid = sourceIdOf(item);
    const parsed = sourceUuid ? parseCompendiumUuid(sourceUuid) : null;
    if (!parsed || !sourceUuid) {
        return null;
    }
    return {
        slotId,
        packId: parsed.packId,
        documentId: parsed.documentId,
        uuid: sourceUuid,
        itemType: String(item?.type ?? "spell"),
        featType: null,
        name: String(item?.name ?? "Spell"),
        level: typeof item?.system?.level?.value === "number" ? item.system.level.value : null,
    };
}
function parseCompendiumUuid(uuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid);
    if (!match) {
        return null;
    }
    return {
        packId: match[1],
        documentId: match[2],
    };
}
function dedupeSelections(selections) {
    const seen = new Set();
    const result = [];
    for (const selection of selections) {
        if (seen.has(selection.uuid)) {
            continue;
        }
        seen.add(selection.uuid);
        result.push(selection);
    }
    return result;
}
//# sourceMappingURL=existing-selections.js.map