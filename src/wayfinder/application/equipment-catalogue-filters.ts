import type { EquipmentCatalogueEntry } from "./equipment-catalogue-service.js";

export const EQUIPMENT_CATALOGUE_FILTER_KEYS = [
  "availability",
  "level",
  "rarity",
  "source",
  "titan-mauler",
  "trait",
  "type",
] as const;

export type EquipmentCatalogueFilterKey = (typeof EQUIPMENT_CATALOGUE_FILTER_KEYS)[number];
export type EquipmentCatalogueFilterMap = Readonly<Record<string, readonly string[]>>;

export interface EquipmentCatalogueFilterDefaults {
  readonly policyAvailable: boolean;
  readonly titanMaulerEligible: boolean;
}

export interface NormalizedEquipmentCatalogueFilters {
  readonly query: string;
  readonly queryTerms: readonly string[];
  readonly itemTypes: ReadonlySet<string>;
  readonly rarities: ReadonlySet<string>;
  readonly publicationSlugs: ReadonlySet<string>;
  readonly traits: ReadonlySet<string>;
  readonly levelRange: { readonly minimum: number; readonly maximum: number } | null;
  readonly policyAvailable: boolean;
  readonly titanMaulerEligible: boolean;
}

export function normalizeEquipmentCatalogueFilters(input: {
  readonly query?: string;
  readonly filters?: EquipmentCatalogueFilterMap;
  readonly defaults?: Partial<EquipmentCatalogueFilterDefaults>;
}): NormalizedEquipmentCatalogueFilters {
  const filters = input.filters ?? {};
  const defaults = input.defaults ?? {};
  return Object.freeze({
    query: input.query?.trim() ?? "",
    queryTerms: Object.freeze(tokenize(input.query ?? "")),
    itemTypes: normalizedSet(filters.type),
    rarities: normalizedSet(filters.rarity),
    publicationSlugs: normalizedSet(filters.source),
    traits: normalizedSet(filters.trait),
    levelRange: normalizeLevelRange(filters.level?.[0]),
    policyAvailable: normalizeDefaultOnMode(filters.availability, "available", defaults.policyAvailable === true),
    titanMaulerEligible: normalizeDefaultOnMode(
      filters["titan-mauler"],
      "eligible",
      defaults.titanMaulerEligible === true
    ),
  });
}

export function matchesEquipmentCatalogueFilters(
  entry: EquipmentCatalogueEntry,
  filters: NormalizedEquipmentCatalogueFilters,
  excludedKey?: EquipmentCatalogueFilterKey
): boolean {
  if (excludedKey !== "availability" && filters.policyAvailable && !entry.available) return false;
  if (excludedKey !== "titan-mauler" && filters.titanMaulerEligible && !isTitanMaulerEligibleEntry(entry)) {
    return false;
  }
  if (excludedKey !== "type" && filters.itemTypes.size > 0 && !filters.itemTypes.has(entry.itemType)) return false;
  if (excludedKey !== "rarity" && filters.rarities.size > 0 && !filters.rarities.has(entry.rarity)) return false;
  if (
    excludedKey !== "source" &&
    filters.publicationSlugs.size > 0 &&
    !filters.publicationSlugs.has(entry.publicationSlug)
  ) {
    return false;
  }
  if (
    excludedKey !== "trait" &&
    filters.traits.size > 0 &&
    [...filters.traits].some((trait) => !entry.traits.includes(trait))
  ) {
    return false;
  }
  if (
    excludedKey !== "level" &&
    filters.levelRange &&
    (entry.level < filters.levelRange.minimum || entry.level > filters.levelRange.maximum)
  ) {
    return false;
  }
  if (filters.queryTerms.length === 0) return true;
  const searchable = normalizeSearchText(
    [entry.name, entry.itemType, entry.publicationSlug, ...entry.traits].join(" ")
  );
  return filters.queryTerms.every((term) => searchable.includes(term));
}

export function isTitanMaulerEligibleEntry(entry: EquipmentCatalogueEntry): boolean {
  return (
    entry.available &&
    entry.level === 0 &&
    entry.itemType === "weapon" &&
    !entry.traits.includes("unarmed") &&
    entry.price.kind === "priced" &&
    entry.price.copperValue !== null &&
    entry.price.copperValue <= 900 &&
    entry.price.sourceQuantity === 1 &&
    (entry.rarity === "common" || entry.policyDecision.characterAccessRef !== null)
  );
}

export function equipmentCatalogueSourceLabel(publicationSlug: string): string {
  return humanizeIdentifier(publicationSlug);
}

export function equipmentCatalogueFilterValue(
  entry: EquipmentCatalogueEntry,
  key: EquipmentCatalogueFilterKey
): string {
  switch (key) {
    case "availability":
      return entry.available ? "available" : "unavailable";
    case "level":
      return String(entry.level);
    case "rarity":
      return entry.rarity;
    case "source":
      return entry.publicationSlug;
    case "titan-mauler":
      return isTitanMaulerEligibleEntry(entry) ? "eligible" : "ineligible";
    case "trait":
      throw new TypeError("Trait facets have multiple values per equipment entry.");
    case "type":
      return entry.itemType;
  }
}

export function normalizeEquipmentCatalogueFilterValues(values: readonly string[] | undefined): string[] {
  return [...normalizedSet(values)];
}

function normalizeDefaultOnMode(
  values: readonly string[] | undefined,
  enabledValue: string,
  fallback: boolean
): boolean {
  if (!values) return fallback;
  if (values.includes("all")) return false;
  return values.includes(enabledValue);
}

function normalizeLevelRange(value: string | undefined): { minimum: number; maximum: number } | null {
  if (!value) return null;
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || minimum > maximum) {
    return null;
  }
  return Object.freeze({ minimum, maximum });
}

function normalizedSet(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(
    (values ?? [])
      .map((value) => normalizeSearchText(value))
      .filter((value) => value.length > 0)
      .sort((left, right) => left.localeCompare(right))
  );
}

function tokenize(value: string): string[] {
  return [...new Set(normalizeSearchText(value).split(" ").filter(Boolean))];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}
