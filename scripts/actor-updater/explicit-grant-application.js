import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { usesNativeGrantItemCreation } from "../shared/grant-creation-policy.js";
import { buildItemGrantRecord, stampGrantedItemSource } from "../shared/pf2e-item-source.js";
import { itemMatchesSourceId, sourceIdOf } from "../shared/source-id.js";
import { EXPLICIT_GRANT_SOURCE_ITEM_TYPES } from "./selection-constants.js";
import { createEmbeddedSource } from "./selection-source-application.js";
const DEFAULT_INSERT_DEPS = {
    fetchSelectionDocument,
    createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};
export async function createSingletonGrantItems(actor, draft, steps, deps = DEFAULT_INSERT_DEPS) {
    if (typeof actor.createEmbeddedDocuments !== "function") {
        return;
    }
    for (const step of steps) {
        if (step.kind !== "pick-item" ||
            !step.grantSelection ||
            !EXPLICIT_GRANT_SOURCE_ITEM_TYPES.has(step.grantSelection.sourceItemType) ||
            usesNativeGrantItemCreation(step)) {
            continue;
        }
        const grantedSelection = draft.selections[step.slotId];
        if (!grantedSelection) {
            continue;
        }
        const actorItems = listActorItems(actor);
        const granter = actorItems.find((item) => itemMatchesSourceId(item, step.grantSelection.selectorUuid));
        if (!granter?.id) {
            continue;
        }
        if (actorItems.some((item) => itemMatchesSourceId(item, grantedSelection.uuid))) {
            continue;
        }
        const source = await deps.createEmbeddedSource(grantedSelection, draft, steps);
        if (!source) {
            continue;
        }
        stampGrantedItemSource(source, {
            sourceId: grantedSelection.uuid,
            slotId: step.slotId,
            granterId: granter.id,
        });
        const created = await actor.createEmbeddedDocuments("Item", [source]);
        const createdItem = Array.isArray(created) ? (created[0] ?? null) : null;
        if (!createdItem?.id || typeof actor.updateEmbeddedDocuments !== "function") {
            continue;
        }
        const granterSlotId = resolveExplicitGrantSourceSlotId(step.grantSelection.sourceItemType, draft, granter);
        await actor.updateEmbeddedDocuments("Item", [
            {
                _id: granter.id,
                ...(granterSlotId
                    ? {
                        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
                        [`flags.${MODULE_ID}.slotId`]: granterSlotId,
                    }
                    : {}),
                [`flags.pf2e.itemGrants.${step.grantSelection.flag}`]: buildItemGrantRecord(createdItem.id, { nested: null }),
            },
        ]);
    }
}
function resolveExplicitGrantSourceSlotId(sourceItemType, draft, granter) {
    const draftSlotId = Object.values(draft.selections).find((selection) => selection.uuid === sourceIdOf(granter))?.slotId ?? null;
    if (draftSlotId) {
        return draftSlotId;
    }
    switch (sourceItemType) {
        case "ancestry":
        case "heritage":
        case "background":
            return `${sourceItemType}-level-1`;
        default:
            return null;
    }
}
//# sourceMappingURL=explicit-grant-application.js.map