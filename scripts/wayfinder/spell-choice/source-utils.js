import { sourceIdOf } from "../../shared/source-id.js";
export function findClassFeatureSource(classDocument, featureName) {
    const classItems = Object.values(classDocument.system?.items ?? {});
    const entry = classItems.find((item) => item.name === featureName && typeof item.uuid === "string");
    const parsed = typeof entry?.uuid === "string" ? parseCompendiumUuid(entry.uuid) : null;
    return {
        sourcePackId: parsed?.packId ?? null,
        sourceDocumentId: parsed?.documentId ?? null,
        sourceUuid: typeof entry?.uuid === "string" ? entry.uuid : null,
        sourceName: featureName,
    };
}
export function sourceRefFromDocument(document) {
    if (!document) {
        return null;
    }
    const sourceUuid = sourceIdOf(document);
    const parsed = sourceUuid ? parseCompendiumUuid(sourceUuid) : null;
    return {
        sourcePackId: parsed?.packId ?? null,
        sourceDocumentId: parsed?.documentId ?? null,
        sourceUuid,
        sourceName: String(document.name ?? "Class Feature"),
    };
}
export function fallbackSourceRef(sourceName) {
    return {
        sourcePackId: null,
        sourceDocumentId: null,
        sourceUuid: null,
        sourceName,
    };
}
export function selectionFromActorItem(item, slotId) {
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
        itemType: String(item.type ?? "spell"),
        featType: null,
        name: String(item.name ?? "Spell"),
        level: typeof item.system?.level?.value === "number" ? item.system.level.value : null,
    };
}
export function dedupeSelections(selections) {
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
export function parseCompendiumUuid(uuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid);
    if (!match) {
        return null;
    }
    return {
        packId: match[1],
        documentId: match[2],
    };
}
//# sourceMappingURL=source-utils.js.map