import { resolveUuid } from "../shared/foundry-compat.js";
const indexCache = new Map();
const traitCatalogCache = new Map();
export async function fetchSelectionDocument(selection) {
    const pack = getGamePack(selection.packId);
    const document = pack ? await pack.getDocument(selection.documentId) : null;
    if (document) {
        return document;
    }
    return resolveUuid(selection.uuid);
}
export function clearPackServiceCache() {
    indexCache.clear();
    traitCatalogCache.clear();
}
export async function getPackIndex(pack, packId) {
    if (indexCache.has(packId)) {
        return indexCache.get(packId) ?? [];
    }
    const index = await pack.getIndex({
        fields: [
            "img",
            "type",
            "system.description.value",
            "system.slug",
            "system.level.value",
            "system.featType.value",
            "system.ancestry.slug",
            "system.category",
            "system.rules",
            "system.prerequisites.value",
            "system.traits.value",
            "system.traits.traditions",
            "system.traits.otherTags",
            "system.traits.rarity",
            "system.publication.title",
        ],
    });
    const contents = Array.from(index ?? []);
    indexCache.set(packId, contents);
    return contents;
}
export function getCachedTraitCatalog(cacheKey) {
    return traitCatalogCache.get(cacheKey);
}
export function cacheTraitCatalog(cacheKey, traits) {
    traitCatalogCache.set(cacheKey, traits);
}
export function getGamePack(packId) {
    return globalThis.game?.packs?.get(packId) ?? null;
}
//# sourceMappingURL=access.js.map