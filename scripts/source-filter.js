export function parseCompendiumAllowlist(raw) {
    return String(raw ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}
export function mergePackIds(basePackIds, extraPackIds) {
    return Array.from(new Set([...basePackIds, ...extraPackIds]));
}
//# sourceMappingURL=source-filter.js.map