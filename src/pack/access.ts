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
  additionalLanguages?: unknown;
  ancestryFeatLevels?: unknown;
  boosts?: unknown;
  classFeatLevels?: unknown;
  generalFeatLevels?: unknown;
  languages?: unknown;
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
  skillFeatLevels?: unknown;
  skillIncreaseLevels?: unknown;
  description?: {
    value?: string;
  };
}

export interface PackIndexEntry {
  _id?: unknown;
  folder?: unknown;
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
  folders?: {
    get(id: string): PackFolderLike | null | undefined;
  };
  getDocument(documentId: string): Promise<PackDocumentLike | null>;
  getIndex(options: { fields: string[] }): Promise<Iterable<PackIndexEntry> | null | undefined>;
};

interface PackFolderLike {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  folder?: unknown;
  parent?: unknown;
}

type PackServiceGlobals = typeof globalThis & {
  game?: {
    folders?: {
      get(id: string): PackFolderLike | null | undefined;
    };
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
  invalidatePackSourceCaches();
}

/**
 * Invalidates every cache derived from the currently enabled compendium sources.
 *
 * Settings and Foundry document hooks can call this before rerendering pickers so
 * newly enabled or edited packs cannot reuse stale indexes or identity catalogs.
 */
export function invalidatePackSourceCaches(): void {
  indexCache.clear();
  traitCatalogCache.clear();
}

export async function getPackIndex(pack: GamePackLike, packId: string): Promise<PackIndexEntry[]> {
  if (indexCache.has(packId)) {
    return indexCache.get(packId) ?? [];
  }

  const index = await pack.getIndex({
    fields: [
      "folder",
      "img",
      "type",
      "system.additionalLanguages",
      "system.ancestryFeatLevels",
      "system.description.value",
      "system.boosts",
      "system.classFeatLevels",
      "system.generalFeatLevels",
      "system.languages",
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
      "system.skillFeatLevels",
      "system.skillIncreaseLevels",
    ],
  });

  const contents = Array.from(index ?? []);
  indexCache.set(packId, contents);
  return contents;
}

export function resolvePackFamilyId(packId: string, folderValue: unknown): string | null {
  const pack = getGamePack(packId);
  let folder = resolvePackFolder(pack, folderValue);
  if (!folder) {
    return null;
  }

  const visited = new Set<string>();
  while (true) {
    const folderId = packFolderId(folder);
    if (!folderId || visited.has(folderId)) {
      return null;
    }
    visited.add(folderId);

    const parent = resolvePackFolder(pack, folder.parent ?? folder.folder);
    if (!parent) {
      return null;
    }

    if (normalizeFolderName(parent.name) === "archetype") {
      return `${packId}:${folderId}`;
    }

    folder = parent;
  }
}

function resolvePackFolder(pack: GamePackLike | null, value: unknown): PackFolderLike | null {
  if (value && typeof value === "object") {
    return value as PackFolderLike;
  }

  const folderId = typeof value === "string" ? value : null;
  const globals = globalThis as PackServiceGlobals;
  return folderId ? (pack?.folders?.get(folderId) ?? globals.game?.folders?.get(folderId) ?? null) : null;
}

function packFolderId(folder: PackFolderLike): string | null {
  const value = folder.id ?? folder._id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeFolderName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

export function getGamePackIds(): string[] {
  const packs = (globalThis as PackServiceGlobals).game?.packs;
  if (!packs) {
    return [];
  }

  return Array.from(packs.entries())
    .filter(([, pack]) => {
      const documentName = pack.documentName ?? pack.metadata?.type;
      return typeof documentName !== "string" || documentName === "Item";
    })
    .map(([packId]) => packId);
}
