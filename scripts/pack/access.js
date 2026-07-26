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
            "folder",
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
export function resolvePackFamilyId(packId, folderValue) {
    const pack = getGamePack(packId);
    let folder = resolvePackFolder(pack, folderValue);
    if (!folder) {
        return null;
    }
    const visited = new Set();
    while (true) {
        const folderId = packFolderId(folder);
        if (!folderId || visited.has(folderId)) {
            return null;
        }
        visited.add(folderId);
        const parent = resolvePackFolder(pack, folder.parent ?? folder.folder);
        if (!parent) {
            return null;
        }
        if (normalizeFolderName(parent.name) === "archetype") {
            return `${packId}:${folderId}`;
        }
        folder = parent;
    }
}
function resolvePackFolder(pack, value) {
    if (value && typeof value === "object") {
        return value;
    }
    const folderId = typeof value === "string" ? value : null;
    const globals = globalThis;
    return folderId ? (pack?.folders?.get(folderId) ?? globals.game?.folders?.get(folderId) ?? null) : null;
}
function packFolderId(folder) {
    const value = folder.id ?? folder._id;
    return typeof value === "string" && value.length > 0 ? value : null;
}
function normalizeFolderName(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
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
export function getGamePackIds() {
    const packs = globalThis.game?.packs;
    if (!packs) {
        return [];
    }
    return Array.from(packs.entries())
        .filter(([, pack]) => {
        const documentName = pack.documentName ?? pack.metadata?.type;
        return typeof documentName !== "string" || documentName === "Item";
    })
        .map(([packId]) => packId);
}
//# sourceMappingURL=access.js.map