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
  const items = listActorItems(actor).map(asSpellcastingEntry);
  return (
    items.find(
      (item) =>
        item?.type === "spellcastingEntry" && item?.flags?.["wayfinder-pf2e"]?.destinationKey === choice.destination.key
    ) ??
    items.find(
      (item) => itemMatchesSpellcastingEntry(item, choice) && String(item?.name ?? "") === choice.destination.entryName
    ) ??
    items.find((item) => itemMatchesSpellcastingEntry(item, choice)) ??
    null
  );
}

export function wizardMaxSpellRank(level: number): number {
  return Math.max(1, Math.min(9, Math.ceil(level / 2)));
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
