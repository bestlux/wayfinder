import type { SpellChoiceMeta } from "../../types.js";
import type { SpellChoiceItem } from "./types.js";

export function spellMatchesChoice(item: SpellChoiceItem, choice: SpellChoiceMeta, entryId: string): boolean {
  if (item.type !== "spell") {
    return false;
  }

  const itemEntryId = readLocationId(item);
  if (itemEntryId !== entryId) {
    return false;
  }

  const traditions = readNormalizedStringList(item.system?.traits?.traditions);
  if (!traditions.includes(choice.destination.tradition)) {
    return false;
  }

  const traits = readNormalizedStringList(item.system?.traits?.value);
  const isCantrip = traits.includes("cantrip");
  if (choice.cantrip !== isCantrip) {
    return false;
  }

  const level = Number(item.system?.level?.value ?? 0);
  const rank = choice.cantrip ? 0 : level;
  if (rank < choice.minRank || rank > choice.maxRank) {
    return false;
  }

  const itemName = String(item.name ?? "");
  const additionalAllowedSpellNames = choice.additionalAllowedSpellNames ?? [];
  const restrictToCommon = choice.restrictToCommon ?? false;
  if (choice.curriculumSpellNames.length === 0) {
    if (additionalAllowedSpellNames.some((name) => namesMatch(name, itemName))) {
      return true;
    }

    if (!restrictToCommon) {
      return true;
    }

    const rarity = String(item.system?.traits?.rarity ?? "")
      .trim()
      .toLowerCase();
    return rarity === "" || rarity === "common";
  }

  return choice.curriculumSpellNames.some((name) => namesMatch(name, itemName));
}

function namesMatch(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function readNormalizedStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().toLowerCase())
    : [];
}

function readLocationId(item: SpellChoiceItem): string | null {
  const location = item.system?.location;
  if (typeof location === "string") {
    return location;
  }

  return typeof location?.value === "string" ? location.value : null;
}
