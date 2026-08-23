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

export interface EquipmentCatalogueFacetOption {
  readonly key: Exclude<EquipmentCatalogueFilterKey, "level">;
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

export interface EquipmentCatalogueLevelFacet {
  readonly values: readonly number[];
  readonly minimum: number;
  readonly maximum: number;
  readonly fullMinimum: number;
  readonly fullMaximum: number;
  readonly active: boolean;
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
    itemTypes: normalizedIdentifierSet(filters.type),
    rarities: normalizedIdentifierSet(filters.rarity),
    publicationSlugs: normalizedIdentifierSet(filters.source),
    traits: normalizedIdentifierSet(filters.trait),
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
  if (
    excludedKey !== "type" &&
    filters.itemTypes.size > 0 &&
    !filters.itemTypes.has(normalizeIdentifier(entry.itemType))
  ) {
    return false;
  }
  if (
    excludedKey !== "rarity" &&
    filters.rarities.size > 0 &&
    !filters.rarities.has(normalizeIdentifier(entry.rarity))
  ) {
    return false;
  }
  if (
    excludedKey !== "source" &&
    filters.publicationSlugs.size > 0 &&
    !filters.publicationSlugs.has(normalizeIdentifier(entry.publicationSlug))
  ) {
    return false;
  }
  if (
    excludedKey !== "trait" &&
    filters.traits.size > 0 &&
    !entry.traits.some((trait) => filters.traits.has(normalizeIdentifier(trait)))
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

export function buildEquipmentCatalogueFacetOptions(
  entries: readonly EquipmentCatalogueEntry[],
  filters: NormalizedEquipmentCatalogueFilters,
  key: Exclude<EquipmentCatalogueFilterKey, "level">,
  selectedValues: readonly string[] = []
): EquipmentCatalogueFacetOption[] {
  const values = new Set(selectedValues.map((value) => normalizeIdentifier(value)).filter(Boolean));
  if (key === "availability") values.add("available");
  else if (key === "titan-mauler") values.add("eligible");
  else {
    for (const entry of entries) {
      if (key === "trait") for (const trait of entry.traits) values.add(normalizeIdentifier(trait));
      else values.add(equipmentCatalogueFilterValue(entry, key));
    }
  }

  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!matchesEquipmentCatalogueFilters(entry, filters, key)) continue;
    const entryValues =
      key === "trait"
        ? entry.traits.map((trait) => normalizeIdentifier(trait))
        : [equipmentCatalogueFilterValue(entry, key)];
    for (const value of new Set(entryValues)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const normalizedSelected = new Set(selectedValues.map((value) => normalizeIdentifier(value)).filter(Boolean));
  return [...values]
    .map((value) => ({
      key,
      value,
      label: equipmentCatalogueFacetValueLabel(key, value),
      count: counts.get(value) ?? 0,
    }))
    .filter(
      (option) =>
        option.count > 0 || normalizedSelected.has(option.value) || key === "availability" || key === "titan-mauler"
    )
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
}

export function buildEquipmentCatalogueLevelFacet(
  entries: readonly EquipmentCatalogueEntry[],
  filters: NormalizedEquipmentCatalogueFilters
): EquipmentCatalogueLevelFacet | null {
  const contextualValues = [
    ...new Set(
      entries.filter((entry) => matchesEquipmentCatalogueFilters(entry, filters, "level")).map((entry) => entry.level)
    ),
  ].sort((left, right) => left - right);
  const allValues = [...new Set(entries.map((entry) => entry.level))].sort((left, right) => left - right);
  const requested = filters.levelRange;
  const allMinimum = allValues[0];
  const allMaximum = allValues.at(-1);
  const active =
    requested !== null &&
    (allMinimum === undefined || requested.minimum > allMinimum || requested.maximum < (allMaximum ?? allMinimum));
  if (contextualValues.length < 2 && !active) return null;
  const values = [
    ...new Set([
      ...(contextualValues.length < 2 ? allValues : contextualValues),
      ...(requested ? [requested.minimum, requested.maximum] : []),
    ]),
  ].sort((left, right) => left - right);
  const fullMinimum = allMinimum ?? requested?.minimum;
  const fullMaximum = allMaximum ?? requested?.maximum;
  if (fullMinimum === undefined || fullMaximum === undefined || values.length === 0) return null;
  const minimum = requested?.minimum ?? contextualValues[0] ?? fullMinimum;
  const maximum = requested?.maximum ?? contextualValues.at(-1) ?? fullMaximum;
  return Object.freeze({
    values: Object.freeze(values),
    minimum,
    maximum,
    fullMinimum,
    fullMaximum,
    active,
  });
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

function equipmentCatalogueFacetValueLabel(key: Exclude<EquipmentCatalogueFilterKey, "level">, value: string): string {
  switch (key) {
    case "availability":
      return value === "available" ? "Policy available" : humanizeIdentifier(value);
    case "source":
      return equipmentCatalogueSourceLabel(value);
    case "titan-mauler":
      return value === "eligible" ? "Titan Mauler eligible" : humanizeIdentifier(value);
    case "rarity":
    case "trait":
    case "type":
      return humanizeIdentifier(value);
  }
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
      return normalizeIdentifier(entry.rarity);
    case "source":
      return normalizeIdentifier(entry.publicationSlug);
    case "titan-mauler":
      return isTitanMaulerEligibleEntry(entry) ? "eligible" : "ineligible";
    case "trait":
      throw new TypeError("Trait facets have multiple values per equipment entry.");
    case "type":
      return normalizeIdentifier(entry.itemType);
  }
}

export function normalizeEquipmentCatalogueFilterValues(values: readonly string[] | undefined): string[] {
  return [...normalizedIdentifierSet(values)];
}

function normalizeDefaultOnMode(
  values: readonly string[] | undefined,
  enabledValue: string,
  fallback: boolean
): boolean {
  if (!values) return fallback;
  const normalized = normalizedIdentifierSet(values);
  if (normalized.has("all")) return false;
  return normalized.has(enabledValue);
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

function normalizedIdentifierSet(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(
    (values ?? [])
      .map((value) => normalizeIdentifier(value))
      .filter((value) => value.length > 0)
      .sort((left, right) => left.localeCompare(right))
  );
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
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
