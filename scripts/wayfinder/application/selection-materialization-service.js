import { MODULE_ID } from "../../constants.js";
import { usesNativeGrantItemCreation } from "../../shared/grant-creation-policy.js";
import { sourceIdOf } from "../../shared/source-id.js";
export function isSelectionMaterializedOnActor(actorItems, selection, step) {
    const selectionUuid = normalizeUuid(selection.uuid);
    if (!selectionUuid)
        return false;
    const items = actorItems.map((item) => item);
    const matchingItems = items.filter((item) => normalizeUuid(sourceIdOf(item)) === selectionUuid);
    if (matchingItems.some((item) => {
        const moduleFlags = item.flags?.[MODULE_ID];
        const slotId = isRecord(moduleFlags) ? moduleFlags.slotId : null;
        return typeof slotId === "string" && slotId === selection.slotId;
    })) {
        return true;
    }
    const nativeGrant = step.grantSelection;
    if (!usesNativeGrantItemCreation(step) || !nativeGrant)
        return false;
    const selectorUuid = normalizeUuid(nativeGrant.selectorUuid);
    if (!selectorUuid)
        return false;
    const itemsById = new Map(items.flatMap((item) => (typeof item.id === "string" && item.id.length > 0 ? [[item.id, item]] : [])));
    return matchingItems.some((item) => {
        if (typeof item.id !== "string" || item.id.length === 0)
            return false;
        const granterId = item.flags?.pf2e?.grantedBy?.id;
        if (typeof granterId !== "string" || granterId.length === 0)
            return false;
        const granter = itemsById.get(granterId);
        if (!granter || normalizeUuid(sourceIdOf(granter)) !== selectorUuid)
            return false;
        return Object.values(granter.flags?.pf2e?.itemGrants ?? {}).some((grant) => isRecord(grant) && grant.id === item.id);
    });
}
function normalizeUuid(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=selection-materialization-service.js.map