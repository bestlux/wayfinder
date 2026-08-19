import { invalidatePackSourceCaches } from "./access.js";
export function invalidatePackSources(onCompendiumChange) {
    invalidatePackSourceCaches();
    onCompendiumChange?.();
}
export function registerPackSourceCacheInvalidation(onCompendiumChange) {
    const invalidateIfCompendiumDocument = (document) => {
        if (!document.pack) {
            return;
        }
        invalidatePackSources(onCompendiumChange);
    };
    Hooks.on("createItem", invalidateIfCompendiumDocument);
    Hooks.on("updateItem", invalidateIfCompendiumDocument);
    Hooks.on("deleteItem", invalidateIfCompendiumDocument);
}
//# sourceMappingURL=cache-invalidation.js.map