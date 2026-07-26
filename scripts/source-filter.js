export function parseCompendiumAllowlist(raw) {
    return String(raw ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}
export function expandCompendiumAllowlist(patterns, availablePackIds) {
    const expanded = [];
    for (const pattern of patterns) {
        if (pattern === "*") {
            expanded.push(...availablePackIds);
            continue;
        }
        if (isModulePrefixPattern(pattern)) {
            const prefix = pattern.slice(0, -1);
            expanded.push(...availablePackIds.filter((packId) => packId.startsWith(prefix)));
            continue;
        }
        if (!pattern.includes("*")) {
            expanded.push(pattern);
        }
    }
    return Array.from(new Set(expanded));
}
export function mergePackIds(basePackIds, extraPackIds) {
    return Array.from(new Set([...basePackIds, ...extraPackIds]));
}
function isModulePrefixPattern(pattern) {
    return pattern.length > 2 && pattern.endsWith(".*") && pattern.indexOf("*") === pattern.length - 1;
}
//# sourceMappingURL=source-filter.js.map