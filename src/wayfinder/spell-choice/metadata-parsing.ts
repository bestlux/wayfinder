import type { SpellChoiceDeityDocument, SpellChoiceSchoolDocument } from "./types.js";

interface DeitySpellAccess {
  names: string[];
  uuids: string[];
}

export interface WitchPatronLessonSpellAccess {
  names: string[];
  uuids: string[];
}

export interface SorcerousGiftSpellAccess {
  name: string;
  uuid: string;
}

export function parseCurriculumSpells(raw: unknown): Record<number, string[]> {
  const description = typeof raw === "string" ? raw : "";
  const result: Record<number, string[]> = {};
  let insideCurriculumSection = false;

  for (const match of description.matchAll(
    /<li\b[^>]*>([\s\S]*?)<\/li>|<p\b[^>]*>([\s\S]*?)<\/p>|<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>|<hr\b[^>]*\/?\s*>/gi
  )) {
    const listItem = match[1];
    if (listItem !== undefined) {
      const paragraphWrapped = /^\s*<p\b/i.test(listItem);
      const row = curriculumRowFromBlock(listItem);
      if (row && (!paragraphWrapped || insideCurriculumSection)) {
        addCurriculumRow(result, row);
      }
      continue;
    }

    const paragraph = match[2];
    if (paragraph === undefined) {
      insideCurriculumSection = false;
      continue;
    }

    const row = curriculumRowFromBlock(paragraph);
    if (!row) {
      insideCurriculumSection = false;
      continue;
    }

    if (isCurriculumHeading(row.label)) {
      insideCurriculumSection = true;
      continue;
    }

    if (insideCurriculumSection && rankFromCurriculumLabel(row.label) !== null) {
      addCurriculumRow(result, row);
      continue;
    }

    insideCurriculumSection = false;
  }

  return result;
}

interface CurriculumRow {
  label: string;
  content: string;
}

function curriculumRowFromBlock(raw: string): CurriculumRow | null {
  const trimmed = raw.trim();
  const paragraphContent = /^<p\b[^>]*>([\s\S]*)<\/p>$/i.exec(trimmed)?.[1] ?? trimmed;
  const match = /^\s*<strong>([^<]+?)<\/strong>\s*:?\s*([\s\S]*)$/i.exec(paragraphContent);
  if (!match) {
    return null;
  }

  return {
    label: String(match[1] ?? ""),
    content: String(match[2] ?? ""),
  };
}

function isCurriculumHeading(label: string): boolean {
  const normalized = label.trim().replace(/:$/, "").toLowerCase();
  return normalized === "curriculum" || normalized === "additional curriculum" || normalized === "sin spells";
}

function addCurriculumRow(result: Record<number, string[]>, row: CurriculumRow): void {
  const rank = rankFromCurriculumLabel(row.label);
  if (rank === null) {
    return;
  }

  result[rank] = collectCurriculumSpellNames(row.content);
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

export function parseWitchPatronLessonSpellAccess(
  document: SpellChoiceSchoolDocument | null
): WitchPatronLessonSpellAccess {
  const description = String(document?.system?.description?.value ?? "");
  const lessonText = /familiar learns([\s\S]*?)<\/p>/i.exec(description)?.[1] ?? "";
  const names = new Set<string>();
  const uuids = new Set<string>();

  for (const match of lessonText.matchAll(
    /@UUID\[(Compendium\.pf2e\.spells-srd\.Item\.([^\]]+))\](?:\{([^}]+)\})?/gi
  )) {
    const uuid = String(match[1] ?? "").trim();
    const name = normalizeCurriculumSpellName(match[3] ?? match[2] ?? "");
    if (uuid) {
      uuids.add(uuid);
    }
    if (name && !/^[A-Za-z0-9]{16}$/.test(name)) {
      names.add(name);
    }
  }

  return {
    names: Array.from(names),
    uuids: Array.from(uuids),
  };
}

export function parseSorcerousGiftSpellAccess(
  document: SpellChoiceSchoolDocument | null
): Partial<Record<number, SorcerousGiftSpellAccess>> {
  const description = String(document?.system?.description?.value ?? "");
  const giftText = /<strong>(?:Sorcerous Gifts|Granted Spells)<\/strong>([\s\S]*?)<\/p>/i.exec(description)?.[1] ?? "";
  const gifts: Partial<Record<number, SorcerousGiftSpellAccess>> = {};

  for (const segment of giftText.split(/[;,]/)) {
    const label = /^\s*(cantrip|\d+(?:st|nd|rd|th))\s*:?/i.exec(segment)?.[1] ?? "";
    const references = Array.from(
      segment.matchAll(/@UUID\[(Compendium\.pf2e\.spells-srd\.Item\.[^\]]+)\](?:\{([^}]+)\})?/gi)
    );
    const rank = rankFromCurriculumLabel(label);
    const uuid = String(references[0]?.[1] ?? "").trim();
    const name = normalizeCurriculumSpellName(references[0]?.[2] ?? "");
    if (rank !== null && references.length === 1 && uuid) {
      gifts[rank] = { name, uuid };
    }
  }

  return gifts;
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
