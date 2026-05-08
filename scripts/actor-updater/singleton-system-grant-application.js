import { listActorItems } from "../build-state.js";
import { fetchSelectionDocument } from "../pack-service.js";
import { buildItemGrantRecord, stampGrantedItemSource } from "../shared/pf2e-item-source.js";
import { applyManualGrantChoices, grantSourceMatches, readManualSystemItemGrants, selectionFromSystemGrant, } from "./manual-system-item-grants.js";
import { createEmbeddedSource } from "./selection-source-application.js";
const DEFAULT_INSERT_DEPS = {
    fetchSelectionDocument,
    createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};
export async function createSingletonSystemGrantItems(actor, draft, steps, deps = DEFAULT_INSERT_DEPS) {
    if (typeof actor.createEmbeddedDocuments !== "function") {
        return;
    }
    const actorItems = listActorItems(actor);
    for (const granter of actorItems) {
        const grants = readManualSystemItemGrants(granter);
        if (!grants.length || !granter.id) {
            continue;
        }
        for (const grant of grants) {
            if (actorItems.some((item) => grantSourceMatches(item, grant.uuid))) {
                continue;
            }
            const selection = selectionFromSystemGrant(grant);
            const source = await deps.createEmbeddedSource(selection, draft, steps);
            if (!source) {
                continue;
            }
            source.system ??= {};
            source.system.location = granter.id;
            stampGrantedItemSource(source, { sourceId: grant.uuid, slotId: selection.slotId, granterId: granter.id });
            applyManualGrantChoices(source, grant.defaultChoices);
            const created = await actor.createEmbeddedDocuments("Item", [source]);
            const createdItem = Array.isArray(created) ? (created[0] ?? null) : null;
            if (!createdItem?.id || typeof actor.updateEmbeddedDocuments !== "function") {
                continue;
            }
            await actor.updateEmbeddedDocuments("Item", [
                {
                    _id: granter.id,
                    [`flags.pf2e.itemGrants.${grant.key}`]: buildItemGrantRecord(createdItem.id),
                },
            ]);
        }
    }
}
//# sourceMappingURL=singleton-system-grant-application.js.map