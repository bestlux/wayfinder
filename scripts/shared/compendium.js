export function parseCompendiumItemUuid(uuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid.trim());
    return match ? { packId: match[1], documentId: match[2] } : null;
}
//# sourceMappingURL=compendium.js.map