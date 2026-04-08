import { OFFICIAL_PACKS } from "./constants.js";
import { getExtraPackSetting } from "./settings.js";
import { mergePackIds, parseCompendiumAllowlist } from "./source-filter.js";
import type { OptionRecord, PendingStep, SelectionRef } from "./types.js";

const indexCache = new Map<string, any[]>();

export async function getOptionsForStep(step: PendingStep): Promise<OptionRecord[]> {
  if (step.kind !== "pick-item" || !step.filters) {
    return [];
  }

  const packIds = resolvePackIds(step.slotKind);
  const results: OptionRecord[] = [];

  for (const packId of packIds) {
    const pack = game.packs?.get(packId);
    if (!pack) {
      continue;
    }

    const index = await getPackIndex(pack);
    for (const entry of index) {
      if (!matchesFilters(entry, step.filters)) {
        continue;
      }

      const level = numericOrNull(entry?.system?.level?.value);
      const featType = stringOrNull(entry?.system?.featType?.value);
      const documentId = String(entry._id);
      const uuid = `Compendium.${pack.metadata.id}.${documentId}`;
      const name = String(entry.name ?? "Unknown Option");

      results.push({
        value: `${pack.metadata.id}:${documentId}`,
        packId: pack.metadata.id,
        documentId,
        uuid,
        img: String(entry.img ?? ""),
        itemType: String(entry.type ?? ""),
        featType,
        name,
        level,
        rarity: stringOrNull(entry?.system?.traits?.rarity),
        source: stringOrNull(entry?.system?.publication?.title),
        label: level === null ? name : `${name} (Level ${level})`
      });
    }
  }

  return dedupeAndSort(results);
}

export async function resolveSelection(rawValue: string, step: PendingStep): Promise<SelectionRef | null> {
  const options = await getOptionsForStep(step);
  const selected = options.find((option) => option.value === rawValue);
  if (!selected) {
    return null;
  }

  return {
    slotId: step.slotId,
    packId: selected.packId,
    documentId: selected.documentId,
    uuid: selected.uuid,
    itemType: selected.itemType,
    featType: selected.featType,
    name: selected.name,
    level: selected.level
  };
}

export async function fetchSelectionDocument(selection: SelectionRef): Promise<any | null> {
  const pack = game.packs?.get(selection.packId);
  if (!pack) {
    return null;
  }

  return pack.getDocument(selection.documentId);
}

function resolvePackIds(slotKind: PendingStep["slotKind"]): string[] {
  const extras = parseCompendiumAllowlist(getExtraPackSetting());

  switch (slotKind) {
    case "ancestry":
      return mergePackIds([...OFFICIAL_PACKS.ancestry], extras);
    case "heritage":
      return mergePackIds([...OFFICIAL_PACKS.heritage], extras);
    case "background":
      return mergePackIds([...OFFICIAL_PACKS.background], extras);
    case "class":
      return mergePackIds([...OFFICIAL_PACKS.class], extras);
    default:
      return mergePackIds([...OFFICIAL_PACKS.feat], extras);
  }
}

async function getPackIndex(pack: any): Promise<any[]> {
  if (indexCache.has(pack.metadata.id)) {
    return indexCache.get(pack.metadata.id) ?? [];
  }

  const index = await pack.getIndex({
    fields: [
      "img",
      "type",
      "system.level.value",
      "system.featType.value",
      "system.traits.rarity",
      "system.publication.title"
    ]
  });

  const contents = Array.from(index ?? []);
  indexCache.set(pack.metadata.id, contents);
  return contents;
}

function matchesFilters(entry: any, filters: PendingStep["filters"]): boolean {
  if (!filters) {
    return true;
  }

  if (String(entry?.type ?? "") !== filters.itemType) {
    return false;
  }

  if (filters.featTypes?.length) {
    const featType = String(entry?.system?.featType?.value ?? "");
    if (!filters.featTypes.includes(featType)) {
      return false;
    }
  }

  if (typeof filters.maxLevel === "number") {
    const level = numericOrNull(entry?.system?.level?.value);
    if (level !== null && level > filters.maxLevel) {
      return false;
    }
  }

  return true;
}

function dedupeAndSort(options: OptionRecord[]): OptionRecord[] {
  const deduped = new Map<string, OptionRecord>();
  for (const option of options) {
    deduped.set(option.uuid, option);
  }

  return Array.from(deduped.values()).sort((left, right) => {
    const leftLevel = left.level ?? 0;
    const rightLevel = right.level ?? 0;
    if (leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }
    return left.name.localeCompare(right.name);
  });
}

function numericOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
