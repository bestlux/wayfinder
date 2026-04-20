export function sourceIdOf(value) {
    const carrier = value;
    const sourceId = carrier?.sourceId ?? carrier?.flags?.core?.sourceId ?? carrier?._stats?.compendiumSource ?? null;
    return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}
export function itemMatchesSourceId(item, sourceId) {
    return sourceIdOf(item) === sourceId;
}
//# sourceMappingURL=source-id.js.map