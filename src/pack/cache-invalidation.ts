import { invalidatePackSourceCaches } from "./access.js";

interface CompendiumDocumentLike {
  pack?: string | null;
}

export function registerPackSourceCacheInvalidation(onCompendiumChange?: () => void): void {
  const invalidateIfCompendiumDocument = (document: CompendiumDocumentLike): void => {
    if (!document.pack) {
      return;
    }

    invalidatePackSourceCaches();
    onCompendiumChange?.();
  };

  Hooks.on("createItem", invalidateIfCompendiumDocument);
  Hooks.on("updateItem", invalidateIfCompendiumDocument);
  Hooks.on("deleteItem", invalidateIfCompendiumDocument);
}
