export function parseCompendiumItemUuid(uuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid.trim());
    return match ? { packId: match[1], documentId: match[2] } : null;
}
export function toCompendiumItemUuid(packId, documentId) {
    return `Compendium.${packId}.Item.${documentId}`;
}
//# sourceMappingURL=compendium.js.map