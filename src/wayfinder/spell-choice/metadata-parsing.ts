import type { SpellChoiceDeityDocument } from "./types.js";

interface DeitySpellAccess {
  names: string[];
  uuids: string[];
}

export function parseCurriculumSpells(raw: unknown): Record<number, string[]> {
  const description = typeof raw === "string" ? raw : "";
  const matches = description.matchAll(/<li><strong>([^<]+?)<\/strong>\s*:?\s*([\s\S]*?)<\/li>/gi);
  const result: Record<number, string[]> = {};

  for (const [, label, content] of matches) {
    const rank = rankFromCurriculumLabel(label);
    if (rank === null) {
      continue;
    }

    result[rank] = collectCurriculumSpellNames(String(content));
  }

  return result;
}

export function parseDeitySpellNames(document: SpellChoiceDeityDocument | null, rank: number): string[] {
  return parseDeitySpellAccess(document, rank).names;
}

export function parseDeitySpellAccess(document: SpellChoiceDeityDocument | null, rank: number): DeitySpellAccess {
  const value = document?.system?.spells?.[String(rank)];
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  const names = new Set<string>();
  const uuids = new Set<string>();

  for (const raw of rawValues) {
    const name = spellNameFromDeityReference(raw);
    if (name) {
      names.add(name);
    }

    const uuid = spellUuidFromDeityReference(raw);
    if (uuid) {
      uuids.add(uuid);
    }
  }

  return {
    names: Array.from(names),
    uuids: Array.from(uuids),
  };
}

function collectCurriculumSpellNames(content: string): string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\](?:\{([^}]+)\})?/gi)) {
    const name = normalizeCurriculumSpellName(match[2] ?? match[1] ?? "");
    if (name) {
      names.add(name);
    }
  }

  for (const match of content.matchAll(
    /<a\b[^>]*data-uuid="Compendium\.pf2e\.spells-srd\.Item\.[^"]+"[^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const name = normalizeCurriculumSpellName(match[1] ?? "");
    if (name) {
      names.add(name);
    }
  }

  return Array.from(names);
}

function rankFromCurriculumLabel(label: string): number | null {
  const normalized = label.trim().replace(/:$/, "").toLowerCase();
  if (normalized === "cantrips" || normalized === "cantrip") {
    return 0;
  }

  const map: Record<string, number> = {
    "1st": 1,
    "2nd": 2,
    "3rd": 3,
    "4th": 4,
    "5th": 5,
    "6th": 6,
    "7th": 7,
    "8th": 8,
    "9th": 9,
  };
  return map[normalized] ?? null;
}

function spellNameFromDeityReference(raw: unknown): string | null {
  const reference = spellReferenceString(raw);
  if (!reference) {
    return null;
  }

  const match = /\.Item\.(.+)$/.exec(reference);
  const name = match?.[1] ?? reference;
  if (/^[A-Za-z0-9]{16}$/.test(name)) {
    return null;
  }

  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function spellUuidFromDeityReference(raw: unknown): string | null {
  const reference = spellReferenceString(raw);
  return reference?.startsWith("Compendium.") ? reference : null;
}

function spellReferenceString(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  for (const key of ["uuid", "value", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function decodeCompendiumName(raw: string): string {
  return decodeURIComponent(raw).replace(/\+/g, " ").trim();
}

function normalizeCurriculumSpellName(raw: string): string {
  const decoded = decodeCompendiumName(raw);
  return decoded
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
