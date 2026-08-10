import { listActorItems } from "../build-state.js";
import type { SpellChoiceMeta } from "../types.js";

interface SpellcastingEntryLike {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  flags?: {
    "wayfinder-pf2e"?: {
      destinationKey?: unknown;
    };
  };
  system?: {
    tradition?: {
      value?: unknown;
    };
    prepared?: {
      value?: unknown;
    };
    ability?: {
      value?: unknown;
    };
  };
}

export function findSpellcastingEntryForChoice(actor: unknown, choice: SpellChoiceMeta): SpellcastingEntryLike | null {
  return findSpellcastingEntryForChoiceInItems(listActorItems(actor), choice);
}

export function findSpellcastingEntryForChoiceInItems(
  actorItems: unknown[],
  choice: SpellChoiceMeta
): SpellcastingEntryLike | null {
  return findSpellcastingEntriesForChoiceInItems(actorItems, choice)[0] ?? null;
}

export function findSpellcastingEntriesForChoiceInItems(
  actorItems: unknown[],
  choice: SpellChoiceMeta
): SpellcastingEntryLike[] {
  const items = actorItems.map(asSpellcastingEntry);
  const keyedEntries = items.filter(
    (item) =>
      item?.type === "spellcastingEntry" && item?.flags?.["wayfinder-pf2e"]?.destinationKey === choice.destination.key
  );
  if (keyedEntries.length > 0 || choice.destination.entryReuse === "key-only") {
    return keyedEntries.filter((entry): entry is SpellcastingEntryLike => entry !== null);
  }

  const matchingEntries = items.filter((item) => itemMatchesSpellcastingEntry(item, choice));
  const namedEntries = matchingEntries.filter((item) => String(item?.name ?? "") === choice.destination.entryName);
  return (namedEntries.length > 0 ? namedEntries : matchingEntries).filter(
    (entry): entry is SpellcastingEntryLike => entry !== null
  );
}

export function wizardMaxSpellRank(level: number): number {
  return Math.max(1, Math.min(10, Math.ceil(level / 2)));
}

export function magusMaxSpellRank(level: number): number {
  return Math.min(9, wizardMaxSpellRank(level));
}

function asSpellcastingEntry(value: unknown): SpellcastingEntryLike | null {
  return value && typeof value === "object" ? (value as SpellcastingEntryLike) : null;
}

function itemMatchesSpellcastingEntry(item: SpellcastingEntryLike | null, choice: SpellChoiceMeta): boolean {
  return (
    item?.type === "spellcastingEntry" &&
    String(item?.system?.tradition?.value ?? "")
      .trim()
      .toLowerCase() === choice.destination.tradition &&
    String(item?.system?.prepared?.value ?? "")
      .trim()
      .toLowerCase() === choice.destination.prepared &&
    String(item?.system?.ability?.value ?? "")
      .trim()
      .toLowerCase() === choice.destination.ability
  );
}
