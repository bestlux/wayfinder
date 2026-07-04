import { extractDocumentSlug } from "../shared/slug.js";
import type { PackIndexEntry } from "./access.js";

export function numericOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractEntrySlug(entry: unknown): string | null {
  return extractDocumentSlug(entry);
}

export function extractEntryTraits(entry: PackIndexEntry): string[] {
  return Array.from(
    new Set([
      ...normalizeTraitList(entry?.system?.traits?.value),
      ...normalizeTraitList(entry?.system?.traits?.otherTags),
    ])
  );
}

export function resolveFeatType(entry: PackIndexEntry): string | null {
  return stringOrNull(entry?.system?.featType?.value) ?? stringOrNull(entry?.system?.category);
}

export function normalizeTraitList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function namesMatch(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
