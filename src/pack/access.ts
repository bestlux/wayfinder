import type { BuildStateDocument } from "../build-state/document-types.js";
import type { ItemSystemLike, LooseRecord, PackLike, SelectionDocumentLike } from "../shared/actor-model.js";
import { resolveUuid } from "../shared/foundry-compat.js";
import type { SelectionRef } from "../types.js";

export interface PackEntryTraitsLike {
  rarity?: string;
  traditions?: string[];
  value?: string[];
  otherTags?: string[];
}

export interface PackEntrySystemLike {
  slug?: unknown;
  level?: {
    value?: unknown;
  };
  featType?: {
    value?: unknown;
  };
  rules?: LooseRecord[];
  ancestry?: {
    slug?: unknown;
  } | null;
  category?: unknown;
  prerequisites?: {
    value?: unknown;
  };
  traits?: PackEntryTraitsLike;
  publication?: {
    title?: string;
  };
  description?: {
    value?: string;
  };
}

export interface PackIndexEntry {
  _id?: unknown;
  name?: unknown;
  img?: unknown;
  type?: unknown;
  system?: PackEntrySystemLike;
}

export interface PackDocumentLike extends SelectionDocumentLike {
  name: string;
  img: string;
  type?: string;
  system?: PackDocumentSystemLike;
}

type PackDocumentSystemLike = NonNullable<BuildStateDocument["system"]> &
  ItemSystemLike & {
    slug?: unknown;
    featType?: {
      value?: unknown;
    };
    ancestry?: {
      slug?: unknown;
    } | null;
    category?: unknown;
    publication?: {
      title?: string;
    };
    description?: {
      value?: string;
    };
    traits?: NonNullable<ItemSystemLike["traits"]> & {
      rarity?: string;
      traditions?: string[];
      value?: string[];
      otherTags?: string[];
    };
    rules?: LooseRecord[];
  };

export type GamePackLike = Omit<PackLike, "getDocument"> & {
  getDocument(documentId: string): Promise<PackDocumentLike | null>;
  getIndex(options: { fields: string[] }): Promise<Iterable<PackIndexEntry> | null | undefined>;
};

type PackServiceGlobals = typeof globalThis & {
  game?: {
    packs?: Map<string, GamePackLike>;
  };
};

const indexCache = new Map<string, PackIndexEntry[]>();
const traitCatalogCache = new Map<string, Set<string>>();

export async function fetchSelectionDocument(selection: SelectionRef): Promise<PackDocumentLike | null> {
  const pack = getGamePack(selection.packId);
  const document = pack ? await pack.getDocument(selection.documentId) : null;
  if (document) {
    return document;
  }

  return resolveUuid<PackDocumentLike>(selection.uuid);
}

export function clearPackServiceCache(): void {
  indexCache.clear();
  traitCatalogCache.clear();
}

export async function getPackIndex(pack: GamePackLike, packId: string): Promise<PackIndexEntry[]> {
  if (indexCache.has(packId)) {
    return indexCache.get(packId) ?? [];
  }

  const index = await pack.getIndex({
    fields: [
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

export function getCachedTraitCatalog(cacheKey: string): Set<string> | undefined {
  return traitCatalogCache.get(cacheKey);
}

export function cacheTraitCatalog(cacheKey: string, traits: Set<string>): void {
  traitCatalogCache.set(cacheKey, traits);
}

export function getGamePack(packId: string): GamePackLike | null {
  return (globalThis as PackServiceGlobals).game?.packs?.get(packId) ?? null;
}
