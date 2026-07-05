import { toCompendiumItemUuid } from "../shared/compendium.js";
import type { OptionContext, OptionRecord, PendingStep, SelectionRef } from "../types.js";
import { getGamePack, getPackIndex } from "./access.js";
import { extractEntrySlug, extractEntryTraits, numericOrNull, resolveFeatType, stringOrNull } from "./entry.js";
import { getTraitCatalog, matchesFilters, resolvePackIds } from "./filter-policy.js";

const EMPTY_OPTION_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  classHasSpellcasting: false,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

export async function getOptionsForStep(
  step: PendingStep,
  context: OptionContext = EMPTY_OPTION_CONTEXT
): Promise<OptionRecord[]> {
  if ((step.kind !== "pick-item" && step.kind !== "class-branch" && step.kind !== "spell-choice") || !step.filters) {
    return [];
  }

  const packIds = resolvePackIds(step.slotKind, step.filters);
  const traitCatalog = await getTraitCatalog(step.slotKind);
  const results: OptionRecord[] = [];

  for (const packId of packIds) {
    const pack = getGamePack(packId);
    if (!pack) {
      continue;
    }

    const index = await getPackIndex(pack, packId);
    for (const entry of index) {
      if (!matchesFilters(entry, packId, step, context, traitCatalog)) {
        continue;
      }

      const level = numericOrNull(entry?.system?.level?.value);
      const featType = resolveFeatType(entry);
      const slug = extractEntrySlug(entry);
      const traits = extractEntryTraits(entry);
      const documentId = String(entry._id);
      const uuid = toCompendiumItemUuid(packId, documentId);
      if (isSelectedInDifferentDraftSlot(step, uuid, context) || isOwnedByActor(uuid, context)) {
        continue;
      }

      const name = String(entry.name ?? "Unknown Option");

      results.push({
        value: `${packId}:${documentId}`,
        packId,
        documentId,
        uuid,
        img: String(entry.img ?? ""),
        itemType: String(entry.type ?? ""),
        featType,
        name,
        level,
        slug,
        traits,
        rarity: stringOrNull(entry?.system?.traits?.rarity),
        source: stringOrNull(entry?.system?.publication?.title),
        label: level === null ? name : `${name} (Level ${level})`,
      });
    }
  }

  return dedupeAndSort(results);
}

export async function resolveSelection(
  rawValue: string,
  step: PendingStep,
  context: OptionContext = EMPTY_OPTION_CONTEXT
): Promise<SelectionRef | null> {
  const options = await getOptionsForStep(step, context);
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
    level: selected.level,
    slug: selected.slug,
  };
}

function isSelectedInDifferentDraftSlot(step: PendingStep, uuid: string, context: OptionContext): boolean {
  const selectedUuidsBySlotId = context.selectedUuidsBySlotId ?? {};
  const normalizedUuid = uuid.trim().toLowerCase();
  return Object.entries(selectedUuidsBySlotId).some(
    ([slotId, selectedUuid]) => slotId !== step.slotId && selectedUuid.trim().toLowerCase() === normalizedUuid
  );
}

function isOwnedByActor(uuid: string, context: OptionContext): boolean {
  const actorSourceIds = context.actorSourceIds ?? [];
  if (actorSourceIds.length === 0) {
    return false;
  }

  const normalizedUuid = uuid.trim().toLowerCase();
  return actorSourceIds.some((sourceId) => sourceId.trim().toLowerCase() === normalizedUuid);
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
