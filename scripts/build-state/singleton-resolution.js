import { fetchSelectionDocument } from "../pack/access.js";
import { cloneData } from "../shared/cloning.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { findDraftSelectionByType } from "../wayfinder/draft-decisions.js";
export async function getEffectiveSingletonDocument(actor, draft, itemType) {
    const draftSelection = findDraftSelectionByType(draft, itemType);
    if (draftSelection) {
        const draftDocument = await fetchSelectionDocument(draftSelection);
        if (draftDocument) {
            return toPlainDocument(draftDocument);
        }
    }
    const actorItem = listActorItems(actor).find((item) => item?.type === itemType);
    if (!actorItem) {
        return null;
    }
    const sourceDocument = await resolveSourceDocumentFromActorItem(actorItem, itemType);
    return toPlainDocument(sourceDocument ?? actorItem);
}
export function listActorItems(actor) {
    const items = actor?.items;
    if (Array.isArray(items)) {
        return items;
    }
    if (items && typeof items === "object" && Array.isArray(items.contents)) {
        return items.contents;
    }
    return [];
}
async function resolveSourceDocumentFromActorItem(actorItem, itemType) {
    const sourceId = actorItem?.flags?.core?.sourceId;
    if (typeof sourceId !== "string" || !sourceId.startsWith("Compendium.")) {
        return null;
    }
    const parsed = parseCompendiumItemUuid(sourceId);
    if (!parsed) {
        return null;
    }
    return fetchSelectionDocument({
        slotId: `${itemType}-level-1`,
        packId: parsed.packId,
        documentId: parsed.documentId,
        uuid: sourceId,
        itemType,
        featType: null,
        name: actorItem.name ?? "",
        level: null,
    });
}
function toPlainDocument(document) {
    if (!document) {
        return null;
    }
    if (typeof document.toObject === "function") {
        return cloneData(document.toObject());
    }
    return cloneData(document);
}
//# sourceMappingURL=singleton-resolution.js.map