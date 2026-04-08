import { MODULE_ID } from "./constants.js";
import { fetchSelectionDocument } from "./pack-service.js";
const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);
export async function applyDraftToActor(actor, draft, steps) {
    const selections = orderSelections(draft, steps);
    for (const selection of selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType))) {
        await replaceSingletonItem(actor, selection);
    }
    const featSources = [];
    for (const selection of selections.filter((entry) => entry.itemType === "feat")) {
        if (hasSourceId(actor, selection.uuid)) {
            continue;
        }
        const source = await createEmbeddedSource(selection);
        if (source) {
            featSources.push(source);
        }
    }
    if (featSources.length > 0) {
        await actor.createEmbeddedDocuments("Item", featSources);
    }
    const currentLevel = Number(actor?.system?.details?.level?.value ?? 1) || 1;
    if (draft.targetLevel > currentLevel) {
        await actor.update({
            "system.details.level.value": draft.targetLevel
        });
    }
}
async function replaceSingletonItem(actor, selection) {
    const existing = Array.from(actor?.items ?? []).filter((item) => item.type === selection.itemType);
    if (existing.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", existing.map((item) => item.id));
    }
    const source = await createEmbeddedSource(selection);
    if (source) {
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}
async function createEmbeddedSource(selection) {
    const document = await fetchSelectionDocument(selection);
    if (!document) {
        return null;
    }
    const source = document.toObject();
    delete source._id;
    source.flags ??= {};
    source.flags.core ??= {};
    source.flags.core.sourceId = selection.uuid;
    source.flags[MODULE_ID] = {
        importedBy: MODULE_ID,
        slotId: selection.slotId
    };
    return source;
}
function orderSelections(draft, steps) {
    const order = new Map();
    steps.forEach((step, index) => order.set(step.slotId, index));
    return Object.values(draft.selections).sort((left, right) => {
        return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
    });
}
function hasSourceId(actor, sourceId) {
    return Array.from(actor?.items ?? []).some((item) => item?.flags?.core?.sourceId === sourceId);
}
//# sourceMappingURL=actor-updater.js.map