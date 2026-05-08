import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { itemMatchesSourceId, sourceIdOf } from "../shared/source-id.js";
import { SINGLETON_ITEM_TYPES } from "./selection-constants.js";
export async function stampSelectionFlags(actor, items, selection) {
    if (!Array.isArray(items) || items.length === 0 || typeof actor?.updateEmbeddedDocuments !== "function") {
        return;
    }
    const updates = [];
    for (const item of items) {
        if (!item?.id ||
            hasConflictingItemType(item, selection) ||
            isPf2eGrantedChildItem(item) ||
            hasConflictingSourceId(item, selection.uuid)) {
            continue;
        }
        updates.push({
            _id: item.id,
            "flags.core.sourceId": selection.uuid,
            [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
            [`flags.${MODULE_ID}.slotId`]: selection.slotId,
        });
    }
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
}
export async function restoreSingletonSourceSlotFlags(actor, draft) {
    if (typeof actor.updateEmbeddedDocuments !== "function") {
        return;
    }
    const actorItems = listActorItems(actor);
    const updates = [];
    for (const selection of Object.values(draft.selections)) {
        if (!SINGLETON_ITEM_TYPES.has(selection.itemType)) {
            continue;
        }
        const item = actorItems.find((entry) => itemMatchesSourceId(entry, selection.uuid));
        if (!item?.id || item.flags?.[MODULE_ID]?.slotId === selection.slotId) {
            continue;
        }
        updates.push({
            _id: item.id,
            [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
            [`flags.${MODULE_ID}.slotId`]: selection.slotId,
        });
    }
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
}
function isPf2eGrantedChildItem(item) {
    const grantedBy = item.flags?.pf2e?.grantedBy;
    return !!grantedBy && typeof grantedBy === "object";
}
function hasConflictingItemType(item, selection) {
    return typeof item.type === "string" && item.type.length > 0 && item.type !== selection.itemType;
}
function hasConflictingSourceId(item, sourceId) {
    const itemSourceId = sourceIdOf(item);
    return !!itemSourceId && itemSourceId !== sourceId;
}
//# sourceMappingURL=selection-flags.js.map