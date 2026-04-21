import { listActorItems } from "../../build-state.js";
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
  const selectedBySlot = actorItems
    .filter(
      (item) =>
        item.type === "spell" &&
        item.flags?.["pf2e-wayfinder"]?.slotId === choice.slotId &&
        spellMatchesChoice(item, choice, entryId)
    )
    .map((item) => selectionFromActorItem(item, choice.slotId))
    .filter((selection): selection is SelectionRef => !!selection);
  if (selectedBySlot.length > 0) {
    return dedupeSelections(selectedBySlot).slice(0, choice.count);
  }

  const eligible = actorItems
    .filter((item) => spellMatchesChoice(item, choice, entryId))
    .map((item) => selectionFromActorItem(item, choice.slotId))
    .filter((selection): selection is SelectionRef => !!selection);

  return dedupeSelections(eligible).slice(0, choice.count);
}
