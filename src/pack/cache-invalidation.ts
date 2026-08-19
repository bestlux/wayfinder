import { invalidatePackSourceCaches } from "./access.js";

interface CompendiumDocumentLike {
  pack?: string | null;
}

export function invalidatePackSources(onCompendiumChange?: () => void): void {
  invalidatePackSourceCaches();
  onCompendiumChange?.();
}

export function registerPackSourceCacheInvalidation(onCompendiumChange?: (packId: string) => void): void {
  const invalidateIfCompendiumDocument = (document: CompendiumDocumentLike): void => {
    if (!document.pack) {
      return;
    }

    invalidatePackSourceCaches();
    onCompendiumChange?.(document.pack);
  };

  Hooks.on("createItem", invalidateIfCompendiumDocument);
  Hooks.on("updateItem", invalidateIfCompendiumDocument);
  Hooks.on("deleteItem", invalidateIfCompendiumDocument);
}
