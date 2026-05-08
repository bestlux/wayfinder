export function preloadHandlebarsTemplates(paths) {
    const loadTemplates = compatGlobals().foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loadTemplates !== "function") {
        throw new Error("Foundry v14 handlebars template loader is unavailable.");
    }
    return loadTemplates(paths);
}
export async function enrichHtml(content, options = {}) {
    const textEditor = compatGlobals().foundry?.applications?.ux?.TextEditor;
    const implementation = textEditor?.implementation;
    const enrichHTML = implementation?.enrichHTML ?? textEditor?.enrichHTML;
    if (typeof enrichHTML !== "function") {
        throw new Error("Foundry v14 TextEditor HTML enricher is unavailable.");
    }
    return enrichHTML.call(implementation ?? textEditor, content, options);
}
export function foundryDeleteValue() {
    const ForcedDeletion = compatGlobals().foundry?.data?.operators?.ForcedDeletion;
    if (typeof ForcedDeletion !== "function") {
        throw new Error("Foundry v14 forced-deletion operator is unavailable.");
    }
    return new ForcedDeletion();
}
export function resolveUuid(uuid) {
    const fromUuid = compatGlobals().foundry?.utils?.fromUuid;
    if (typeof fromUuid !== "function") {
        throw new Error("Foundry v14 UUID resolver is unavailable.");
    }
    return fromUuid(uuid);
}
function compatGlobals() {
    return globalThis;
}
//# sourceMappingURL=foundry-compat.js.map