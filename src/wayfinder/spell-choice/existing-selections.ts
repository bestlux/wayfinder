import { listActorItems } from "../../build-state.js";
import { MODULE_ID } from "../../constants.js";
import { findSpellcastingEntryForChoice } from "../../shared/spellcasting.js";
import type { SelectionRef, SpellChoiceMeta } from "../../types.js";
import { dedupeSelections, selectionFromActorItem } from "./source-utils.js";
import { spellMatchesChoice } from "./spell-matching.js";
import type { SpellChoiceItem } from "./types.js";

export function readExistingSpellChoiceSelections(actor: unknown, choice: SpellChoiceMeta): SelectionRef[] {
  const entry = findSpellcastingEntryForChoice(actor, choice);
  if (!entry?.id) {
    return [];
  }

  const entryId = String(entry.id);
  const actorItems = listActorItems(actor) as SpellChoiceItem[];
  const completedStepIds = readWayfinderCompletedStepIds(actor);
  const selectedBySlot = actorItems
    .filter(
      (item) =>
        item.type === "spell" && wayfinderSlotId(item) === choice.slotId && spellMatchesChoice(item, choice, entryId)
    )
    .map((item) => selectionFromActorItem(item, choice.slotId))
    .filter((selection): selection is SelectionRef => !!selection);
  if (selectedBySlot.length > 0) {
    return dedupeSelections(selectedBySlot).slice(0, choice.count);
  }

  if (completedStepIds && !completedStepIds.has(choice.slotId)) {
    return [];
  }

  const choiceLevel = levelFromSpellChoiceSlotId(choice.slotId);
  const currentActorLevel = actorLevel(actor);
  if (choiceLevel !== null && currentActorLevel !== null && choiceLevel > currentActorLevel) {
    return [];
  }

  const eligible = actorItems
    .filter((item) => {
      const slotId = wayfinderSlotId(item);
      return (!slotId || slotId === choice.slotId) && spellMatchesChoice(item, choice, entryId);
    })
    .map((item) => selectionFromActorItem(item, choice.slotId))
    .filter((selection): selection is SelectionRef => !!selection);

  return dedupeSelections(eligible).slice(0, choice.count);
}

function actorLevel(actor: unknown): number | null {
  const value = (actor as { system?: { details?: { level?: { value?: unknown } } } } | null)?.system?.details?.level
    ?.value;
  const level = Number(value);
  return value !== null && value !== undefined && Number.isFinite(level) ? Math.max(0, Math.floor(level)) : null;
}

function levelFromSpellChoiceSlotId(slotId: string): number | null {
  const match = /-level-(\d+)$/.exec(slotId);
  const level = Number(match?.[1]);
  return Number.isInteger(level) ? level : null;
}

function readWayfinderCompletedStepIds(actor: unknown): Set<string> | null {
  const completedStepIds = (actor as { flags?: { [MODULE_ID]?: { state?: { completedStepIds?: unknown } } } } | null)
    ?.flags?.[MODULE_ID]?.state?.completedStepIds;
  if (!Array.isArray(completedStepIds)) {
    return null;
  }

  return new Set(completedStepIds.filter((stepId): stepId is string => typeof stepId === "string"));
}

function wayfinderSlotId(item: SpellChoiceItem): string | null {
  const value = item.flags?.[MODULE_ID]?.slotId;
  return typeof value === "string" && value.length > 0 ? value : null;
}
