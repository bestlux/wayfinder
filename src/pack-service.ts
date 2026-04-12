import { OFFICIAL_PACKS } from "./constants.js";
import { getExtraPackSetting } from "./settings.js";
import { mergePackIds, parseCompendiumAllowlist } from "./source-filter.js";
import type { OptionContext, OptionRecord, PendingStep, PickerInfoState, SelectionRef } from "./types.js";

const indexCache = new Map<string, any[]>();
const traitCatalogCache = new Map<string, Set<string>>();
const EMPTY_OPTION_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  hasDedicationFeat: false,
};

export async function getOptionsForStep(
  step: PendingStep,
  context: OptionContext = EMPTY_OPTION_CONTEXT
): Promise<OptionRecord[]> {
  if ((step.kind !== "pick-item" && step.kind !== "class-branch") || !step.filters) {
    return [];
  }

  const packIds = resolvePackIds(step.slotKind);
  const traitCatalog = await getTraitCatalog(step.slotKind);
  const results: OptionRecord[] = [];

  for (const packId of packIds) {
    const pack = game.packs?.get(packId);
    if (!pack) {
      continue;
    }

    const index = await getPackIndex(pack);
    for (const entry of index) {
      if (!matchesFilters(entry, step, context, traitCatalog)) {
        continue;
      }

      const level = numericOrNull(entry?.system?.level?.value);
      const featType = resolveFeatType(entry);
      const slug = extractEntrySlug(entry);
      const traits = extractEntryTraits(entry);
      const documentId = String(entry._id);
      const uuid = toCompendiumItemUuid(pack.metadata.id, documentId);
      const name = String(entry.name ?? "Unknown Option");

      results.push({
        value: `${pack.metadata.id}:${documentId}`,
        packId: pack.metadata.id,
        documentId,
        uuid,
        img: String(entry.img ?? ""),
        itemType: String(entry.type ?? ""),
        featType,
        name,
        level,
        slug,
        traits,
        rarity: stringOrNull(entry?.system?.traits?.rarity),
        source: stringOrNull(entry?.system?.publication?.title),
        label: level === null ? name : `${name} (Level ${level})`,
      });
    }
  }

  return dedupeAndSort(results);
}

export async function resolveSelection(
  rawValue: string,
  step: PendingStep,
  context: OptionContext = EMPTY_OPTION_CONTEXT
): Promise<SelectionRef | null> {
  const options = await getOptionsForStep(step, context);
  const selected = options.find((option) => option.value === rawValue);
  if (!selected) {
    return null;
  }

  return {
    slotId: step.slotId,
    packId: selected.packId,
    documentId: selected.documentId,
    uuid: selected.uuid,
    itemType: selected.itemType,
    featType: selected.featType,
    name: selected.name,
    level: selected.level,
  };
}

export async function fetchSelectionDocument(selection: SelectionRef): Promise<any | null> {
  const pack = game.packs?.get(selection.packId);
  if (!pack) {
    return null;
  }

  return pack.getDocument(selection.documentId);
}

function toCompendiumItemUuid(packId: string, documentId: string): string {
  return `Compendium.${packId}.Item.${documentId}`;
}

export function clearPackServiceCache(): void {
  indexCache.clear();
  traitCatalogCache.clear();
}

export function getPickerInfoState(
  step: PendingStep,
  context: OptionContext,
  optionCount: number,
  filteredCount: number,
  search: string
): PickerInfoState | null {
  const blocked = getPickerBlockedState(step, context);
  if (blocked) {
    return blocked;
  }

  if (optionCount === 0) {
    return {
      tone: "empty",
      eyebrow: "No matching sources",
      title: "No valid options are available",
      message: "The enabled compendia do not currently provide any choices that fit this step.",
    };
  }

  if (search.trim() && filteredCount === 0) {
    return {
      tone: "search",
      eyebrow: "Search results",
      title: "No choices match this search",
      message: "Adjust the search terms to widen the list again.",
    };
  }

  return null;
}

export function getPickerBlockedState(step: PendingStep, context: OptionContext): PickerInfoState | null {
  switch (step.slotKind) {
    case "heritage":
      return context.ancestrySlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose an ancestry first",
            message:
              "Wayfinder filters heritages from the drafted ancestry. Pick the ancestry step before reviewing heritage options.",
          };
    case "ancestry-feat":
      return context.ancestryTraits.length > 0
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose an ancestry before ancestry feats",
            message: "Ancestry feats are filtered from the drafted ancestry and any versatile heritage tags.",
          };
    case "class-feat":
      return context.classSlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose a class first",
            message:
              "Class feat options are filtered from the drafted class. Pick the class step before reviewing class feats.",
          };
    case "class-branch":
      return context.classSlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose a class first",
            message:
              "Class branch options are pulled from the drafted class's selector features. Pick the class step before reviewing branch options.",
          };
    default:
      return null;
  }
}

function resolvePackIds(slotKind: PendingStep["slotKind"]): string[] {
  const extras = parseCompendiumAllowlist(getExtraPackSetting());

  switch (slotKind) {
    case "ancestry":
      return mergePackIds([...OFFICIAL_PACKS.ancestry], extras);
    case "heritage":
      return mergePackIds([...OFFICIAL_PACKS.heritage], extras);
    case "background":
      return mergePackIds([...OFFICIAL_PACKS.background], extras);
    case "class":
      return mergePackIds([...OFFICIAL_PACKS.class], extras);
    case "class-branch":
      return mergePackIds([...OFFICIAL_PACKS.classFeature], extras);
    default:
      return mergePackIds([...OFFICIAL_PACKS.feat], extras);
  }
}

async function getPackIndex(pack: any): Promise<any[]> {
  if (indexCache.has(pack.metadata.id)) {
    return indexCache.get(pack.metadata.id) ?? [];
  }

  const index = await pack.getIndex({
    fields: [
      "img",
      "type",
      "system.slug",
      "system.level.value",
      "system.featType.value",
      "system.ancestry.slug",
      "system.category",
      "system.traits.value",
      "system.traits.otherTags",
      "system.traits.rarity",
      "system.publication.title",
    ],
  });

  const contents = Array.from(index ?? []);
  indexCache.set(pack.metadata.id, contents);
  return contents;
}

function matchesFilters(entry: any, step: PendingStep, context: OptionContext, traitCatalog: Set<string>): boolean {
  const filters = step.filters;
  if (!filters) {
    return true;
  }

  if (String(entry?.type ?? "") !== filters.itemType) {
    return false;
  }

  if (filters.featTypes?.length) {
    const featType = resolveFeatType(entry);
    if (!featType || !filters.featTypes.includes(featType)) {
      return false;
    }
  }

  if (typeof filters.maxLevel === "number") {
    const level = numericOrNull(entry?.system?.level?.value);
    if (level !== null && level > filters.maxLevel) {
      return false;
    }
  }

  if (step.slotKind === "heritage" && context.ancestrySlug) {
    const heritageAncestrySlug = stringOrNull(entry?.system?.ancestry?.slug);
    if (heritageAncestrySlug && heritageAncestrySlug !== context.ancestrySlug) {
      return false;
    }
  }

  if (step.slotKind === "class-branch") {
    return matchesClassBranchContext(entry, step, context);
  }

  if (step.slotKind === "ancestry-feat") {
    return matchesAncestryFeatContext(entry, context, traitCatalog);
  }

  if (step.slotKind === "class-feat") {
    return matchesClassFeatContext(entry, context, traitCatalog);
  }

  if (step.slotKind === "skill-feat") {
    return matchesSkillFeatContext(entry);
  }

  return true;
}

function dedupeAndSort(options: OptionRecord[]): OptionRecord[] {
  const deduped = new Map<string, OptionRecord>();
  for (const option of options) {
    deduped.set(option.uuid, option);
  }

  return Array.from(deduped.values()).sort((left, right) => {
    const leftLevel = left.level ?? 0;
    const rightLevel = right.level ?? 0;
    if (leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }
    return left.name.localeCompare(right.name);
  });
}

function numericOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractEntrySlug(entry: any): string | null {
  return stringOrNull(entry?.system?.slug) ?? stringOrNull(entry?.system?.ancestry?.slug) ?? slugifyName(entry?.name);
}

function extractEntryTraits(entry: any): string[] {
  return normalizeTraitList(entry?.system?.traits?.value);
}

function resolveFeatType(entry: any): string | null {
  return stringOrNull(entry?.system?.featType?.value) ?? stringOrNull(entry?.system?.category);
}

function matchesAncestryFeatContext(entry: any, context: OptionContext, traitCatalog: Set<string>): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "ancestry") {
    return false;
  }

  const traits = extractEntryTraits(entry);
  const dependencyTraits = new Set<string>([...context.ancestryTraits, ...context.heritageTraits]);
  if (dependencyTraits.size === 0) {
    return true;
  }

  const gatingTraits = traits.filter((trait) => dependencyTraits.has(trait));
  if (gatingTraits.length > 0) {
    return true;
  }

  const ancestryOrHeritageNamedTraits = traits.filter((trait) => traitCatalog.has(trait));
  return ancestryOrHeritageNamedTraits.length === 0;
}

function matchesClassFeatContext(entry: any, context: OptionContext, _traitCatalog: Set<string>): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "class") {
    return false;
  }

  const classSlug = context.classSlug;
  if (!classSlug) {
    return true;
  }

  const traits = extractEntryTraits(entry);
  if (traits.includes(classSlug)) {
    return true;
  }

  const isArchetypeFeat = traits.includes("archetype") || traits.includes("dedication");
  if (isArchetypeFeat) {
    return context.hasDedicationFeat ? traits.includes("archetype") : traits.includes("dedication");
  }

  return false;
}

function matchesSkillFeatContext(entry: any): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "skill") {
    return false;
  }

  const traits = extractEntryTraits(entry);
  return !traits.includes("archetype") && !traits.includes("dedication");
}

function matchesClassBranchContext(entry: any, step: PendingStep, context: OptionContext): boolean {
  const branch = step.branch;
  if (!branch) {
    return false;
  }

  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "classfeature") {
    return false;
  }

  if (branch.classSlug && context.classSlug && branch.classSlug !== context.classSlug) {
    return false;
  }

  const otherTags = normalizeTraitList(entry?.system?.traits?.otherTags);
  if (!otherTags.includes(branch.optionTag)) {
    return false;
  }

  const traits = extractEntryTraits(entry);
  return !branch.classSlug || traits.length === 0 || traits.includes(branch.classSlug);
}

function normalizeTraitList(value: unknown): string[] {
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

async function getTraitCatalog(slotKind: PendingStep["slotKind"]): Promise<Set<string>> {
  const cacheKey = slotKind === "class-feat" ? "class" : "ancestry-heritage";
  const cached = traitCatalogCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const configuredTraits = getConfiguredTraitCatalog(cacheKey);
  if (configuredTraits.size > 0) {
    traitCatalogCache.set(cacheKey, configuredTraits);
    return configuredTraits;
  }

  const packIds =
    cacheKey === "class"
      ? resolvePackIds("class")
      : mergePackIds(resolvePackIds("ancestry"), resolvePackIds("heritage"));

  const traits = new Set<string>();
  for (const packId of packIds) {
    const pack = game.packs?.get(packId);
    if (!pack) {
      continue;
    }

    const index = await getPackIndex(pack);
    for (const entry of index) {
      const slug = extractEntrySlug(entry);
      if (slug) {
        traits.add(slug);
      }
    }
  }

  traitCatalogCache.set(cacheKey, traits);
  return traits;
}

function getConfiguredTraitCatalog(kind: "class" | "ancestry-heritage"): Set<string> {
  const pf2eConfig = globalThis.CONFIG?.PF2E;
  const traitMap = kind === "class" ? pf2eConfig?.classTraits : pf2eConfig?.ancestryTraits;

  if (!traitMap || typeof traitMap !== "object") {
    return new Set();
  }

  return new Set(
    Object.keys(traitMap)
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean)
  );
}

function slugifyName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || null;
}
