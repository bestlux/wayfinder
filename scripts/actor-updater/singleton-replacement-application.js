import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { selectedClassArchetypeSelection } from "../wayfinder/class-archetype/registry.js";
import { SINGLETON_ITEM_TYPES } from "./selection-constants.js";
import { createEmbeddedSource } from "./selection-source-application.js";
export async function replaceSingletonItem(actor, selection, draft, steps, deps) {
    const existing = listActorItems(actor).filter((item) => item?.type === selection.itemType);
    const existingIds = existing.map((item) => item.id).filter((id) => typeof id === "string");
    if (existingIds.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
        await actor.deleteEmbeddedDocuments("Item", existingIds);
    }
    const source = await createEmbeddedSource(selection, draft, steps, deps);
    if (source && typeof actor.createEmbeddedDocuments === "function") {
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}
export async function replaceSingletonItems(actor, selections, draft, steps, deps) {
    const singletonSelections = selections.filter((selection) => SINGLETON_ITEM_TYPES.has(selection.itemType));
    if (singletonSelections.length === 0) {
        return;
    }
    const replacesClass = singletonSelections.some((selection) => selection.itemType === "class");
    const classArchetypeSelection = replacesClass ? selectedClassArchetypeSelection(draft) : null;
    const batchedSelections = [...singletonSelections, ...(classArchetypeSelection ? [classArchetypeSelection] : [])];
    const selectedTypes = new Set(singletonSelections.map((selection) => selection.itemType));
    const sources = (await Promise.all(batchedSelections.map((selection) => createEmbeddedSource(selection, draft, steps, deps)))).filter((source) => !!source);
    const existing = listActorItems(actor).filter((item) => selectedTypes.has(item?.type ?? "") ||
        (replacesClass &&
            typeof item?.flags?.[MODULE_ID]?.slotId === "string" &&
            item.flags[MODULE_ID].slotId.startsWith("class-archetype-")));
    const existingIds = existing.map((item) => item.id).filter((id) => typeof id === "string");
    if (existingIds.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
        await actor.deleteEmbeddedDocuments("Item", existingIds);
    }
    if (sources.length > 0 && typeof actor.createEmbeddedDocuments === "function") {
        await actor.createEmbeddedDocuments("Item", sources);
    }
}
//# sourceMappingURL=singleton-replacement-application.js.map