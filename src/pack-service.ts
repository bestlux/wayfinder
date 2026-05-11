import type { BuildStateDocument } from "./build-state/document-types.js";
import { OFFICIAL_PACKS, SKILL_LABELS } from "./constants.js";
import { getExtraPackSetting } from "./settings.js";
import type { ItemSystemLike, LooseRecord, PackLike, SelectionDocumentLike } from "./shared/actor-model.js";
import { toCompendiumItemUuid } from "./shared/compendium.js";
import { resolveUuid } from "./shared/foundry-compat.js";
import { extractDocumentSlug } from "./shared/slug.js";
import { mergePackIds, parseCompendiumAllowlist } from "./source-filter.js";
import type {
  ChoicePredicate,
  OptionContext,
  OptionRecord,
  PendingStep,
  PickerInfoState,
  SelectionRef,
  StepFilters,
} from "./types.js";
import { predicateIncludesString } from "./wayfinder/rule-data.js";

interface PackEntryTraitsLike {
  rarity?: string;
  traditions?: string[];
  value?: string[];
  otherTags?: string[];
}

interface PackEntrySystemLike {
  slug?: unknown;
  level?: {
    value?: unknown;
  };
  featType?: {
    value?: unknown;
  };
  rules?: LooseRecord[];
  ancestry?: {
    slug?: unknown;
  } | null;
  category?: unknown;
  prerequisites?: {
    value?: unknown;
  };
  traits?: PackEntryTraitsLike;
  publication?: {
    title?: string;
  };
  description?: {
    value?: string;
  };
}

interface PackIndexEntry {
  _id?: unknown;
  name?: unknown;
  img?: unknown;
  type?: unknown;
  system?: PackEntrySystemLike;
}

interface PackDocumentLike extends SelectionDocumentLike {
  name: string;
  img: string;
  type?: string;
  system?: PackDocumentSystemLike;
}

type PackDocumentSystemLike = NonNullable<BuildStateDocument["system"]> &
  ItemSystemLike & {
    slug?: unknown;
    featType?: {
      value?: unknown;
    };
    ancestry?: {
      slug?: unknown;
    } | null;
    category?: unknown;
    publication?: {
      title?: string;
    };
    description?: {
      value?: string;
    };
    traits?: NonNullable<ItemSystemLike["traits"]> & {
      rarity?: string;
      traditions?: string[];
      value?: string[];
      otherTags?: string[];
    };
    rules?: LooseRecord[];
  };

type GamePackLike = Omit<PackLike, "getDocument"> & {
  getDocument(documentId: string): Promise<PackDocumentLike | null>;
  getIndex(options: { fields: string[] }): Promise<Iterable<PackIndexEntry> | null | undefined>;
};

interface Pf2ePackConfigLike {
  ancestryTraits?: Record<string, unknown>;
  classTraits?: Record<string, unknown>;
}

type PackServiceGlobals = typeof globalThis & {
  CONFIG?: {
    PF2E?: Pf2ePackConfigLike;
  };
  game?: {
    packs?: Map<string, GamePackLike>;
  };
};

const indexCache = new Map<string, PackIndexEntry[]>();
const traitCatalogCache = new Map<string, Set<string>>();
const EMPTY_OPTION_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  classHasSpellcasting: false,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

export async function getOptionsForStep(
  step: PendingStep,
  context: OptionContext = EMPTY_OPTION_CONTEXT
): Promise<OptionRecord[]> {
  if ((step.kind !== "pick-item" && step.kind !== "class-branch" && step.kind !== "spell-choice") || !step.filters) {
    return [];
  }

  const packIds = resolvePackIds(step.slotKind, step.filters);
  const traitCatalog = await getTraitCatalog(step.slotKind);
  const results: OptionRecord[] = [];

  for (const packId of packIds) {
    const pack = getGamePack(packId);
    if (!pack) {
      continue;
    }

    const index = await getPackIndex(pack, packId);
    for (const entry of index) {
      if (!matchesFilters(entry, packId, step, context, traitCatalog)) {
        continue;
      }

      const level = numericOrNull(entry?.system?.level?.value);
      const featType = resolveFeatType(entry);
      const slug = extractEntrySlug(entry);
      const traits = extractEntryTraits(entry);
      const documentId = String(entry._id);
      const uuid = toCompendiumItemUuid(packId, documentId);
      if (isSelectedInDifferentDraftSlot(step, uuid, context) || isOwnedByActor(uuid, context)) {
        continue;
      }

      const name = String(entry.name ?? "Unknown Option");

      results.push({
        value: `${packId}:${documentId}`,
        packId,
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

function isSelectedInDifferentDraftSlot(step: PendingStep, uuid: string, context: OptionContext): boolean {
  const selectedUuidsBySlotId = context.selectedUuidsBySlotId ?? {};
  const normalizedUuid = uuid.trim().toLowerCase();
  return Object.entries(selectedUuidsBySlotId).some(
    ([slotId, selectedUuid]) => slotId !== step.slotId && selectedUuid.trim().toLowerCase() === normalizedUuid
  );
}

function isOwnedByActor(uuid: string, context: OptionContext): boolean {
  const actorSourceIds = context.actorSourceIds ?? [];
  if (actorSourceIds.length === 0) {
    return false;
  }

  const normalizedUuid = uuid.trim().toLowerCase();
  return actorSourceIds.some((sourceId) => sourceId.trim().toLowerCase() === normalizedUuid);
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

export async function fetchSelectionDocument(selection: SelectionRef): Promise<PackDocumentLike | null> {
  const pack = getGamePack(selection.packId);
  const document = pack ? await pack.getDocument(selection.documentId) : null;
  if (document) {
    return document;
  }

  return resolveUuid<PackDocumentLike>(selection.uuid);
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
  search: string,
  hasActiveFilters = false
): PickerInfoState | null {
  const blocked = getPickerBlockedState(step, context);
  if (blocked) {
    return blocked;
  }

  if (optionCount === 0) {
    if (hidesUnsupportedEmbeddedChoiceSets(step)) {
      return {
        tone: "empty",
        eyebrow: "Unsupported guided options",
        title: "No guided options are available",
        message:
          "Nothing directly guided is available here. Wayfinder hides direct options that require unsupported follow-up choices; use the PF2E sheet for those choices for now.",
      };
    }

    return {
      tone: "empty",
      eyebrow: "No matching sources",
      title: "No valid options are available",
      message: "Nothing in your enabled sources matches this step. Ask your GM if more content can be allowlisted.",
    };
  }

  if (filteredCount === 0 && (search.trim() || hasActiveFilters)) {
    const searchActive = search.trim().length > 0;
    return {
      tone: "search",
      eyebrow: hasActiveFilters ? "Filters active" : "Search results",
      title:
        searchActive && hasActiveFilters
          ? "No choices match this search and filters"
          : hasActiveFilters
            ? "No choices match current filters"
            : "No choices match this search",
      message:
        searchActive && hasActiveFilters
          ? "Adjust the search or remove a filter to widen the list again."
          : hasActiveFilters
            ? "Remove or change a filter to widen the list again."
            : "Adjust the search terms to widen the list again.",
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
              "Pick an ancestry first — heritages depend on it, and your options will show up here once that's set.",
          };
    case "ancestry-feat":
      if (context.ancestryTraits.length === 0) {
        return {
          tone: "blocked",
          eyebrow: "Prerequisite required",
          title: "Choose an ancestry before ancestry feats",
          message: "Ancestry feats are filtered from the drafted ancestry and any versatile heritage tags.",
        };
      }

      return context.classSlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose a class before ancestry feats",
            message:
              "Some ancestry feats depend on class features such as spellcasting. Pick the class step before reviewing ancestry feat options.",
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
      if (step.branch?.dependsOn === "deity" && !context.deitySelected) {
        return {
          tone: "blocked",
          eyebrow: "Prerequisite required",
          title: "Choose a deity first",
          message:
            "This class path depends on the drafted deity and sanctification state. Resolve the deity step before reviewing these branch options.",
        };
      }

      return context.classSlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose a class first",
            message:
              "Pick a class first. Each class has its own branch — domain, doctrine, racket, and so on — and we'll show those once we know which class you're playing.",
          };
    case "deity":
      return context.classSlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "Prerequisite required",
            title: "Choose a class first",
            message:
              "Wayfinder only offers deity choices when a drafted class grants them. Pick the class step before reviewing deity options.",
          };
    case "spell-choice":
      if (step.spellChoice?.dependsOn === "class" && !context.classSlug) {
        return {
          tone: "blocked",
          eyebrow: "Prerequisite required",
          title: "Choose a class first",
          message: "Pick a class first. Spell options depend on what tradition you'll be casting from.",
        };
      }

      if (requiresResolvedCurriculum(step)) {
        return {
          tone: "blocked",
          eyebrow: "Prerequisite required",
          title: "Choose an arcane school first",
          message:
            "This spell choice depends on the drafted arcane school. Resolve the school step before reviewing curriculum spells.",
        };
      }

      return null;
    default:
      return null;
  }
}

function requiresResolvedCurriculum(step: PendingStep): boolean {
  const spellChoice = step.spellChoice;
  return (
    !!spellChoice &&
    spellChoice.dependsOn === "class-branch" &&
    spellChoice.curriculumSpellNames.length === 0 &&
    spellChoice.requiresCurriculum !== false
  );
}

function resolvePackIds(slotKind: PendingStep["slotKind"], filters?: StepFilters | null): string[] {
  const extras = parseCompendiumAllowlist(getExtraPackSetting());
  if (filters?.packIds?.length) {
    return mergePackIds(filters.packIds, extras);
  }

  switch (slotKind) {
    case "ancestry":
      return mergePackIds([...OFFICIAL_PACKS.ancestry], extras);
    case "heritage":
      return mergePackIds([...OFFICIAL_PACKS.heritage], extras);
    case "background":
      return mergePackIds([...OFFICIAL_PACKS.background], extras);
    case "class":
      return mergePackIds([...OFFICIAL_PACKS.class], extras);
    case "deity":
      return mergePackIds([...OFFICIAL_PACKS.deity], extras);
    case "class-branch":
      return mergePackIds([...OFFICIAL_PACKS.classFeature], extras);
    case "spell-choice":
      return mergePackIds([...OFFICIAL_PACKS.spell], extras);
    default:
      return mergePackIds([...OFFICIAL_PACKS.feat], extras);
  }
}

async function getPackIndex(pack: GamePackLike, packId: string): Promise<PackIndexEntry[]> {
  if (indexCache.has(packId)) {
    return indexCache.get(packId) ?? [];
  }

  const index = await pack.getIndex({
    fields: [
      "img",
      "type",
      "system.description.value",
      "system.slug",
      "system.level.value",
      "system.featType.value",
      "system.ancestry.slug",
      "system.category",
      "system.rules",
      "system.prerequisites.value",
      "system.traits.value",
      "system.traits.traditions",
      "system.traits.otherTags",
      "system.traits.rarity",
      "system.publication.title",
    ],
  });

  const contents = Array.from(index ?? []);
  indexCache.set(packId, contents);
  return contents;
}

function matchesFilters(
  entry: PackIndexEntry,
  packId: string,
  step: PendingStep,
  context: OptionContext,
  traitCatalog: Set<string>
): boolean {
  const filters = step.filters;
  if (!filters) {
    return true;
  }

  if (!matchesItemType(entry, filters.itemType)) {
    return false;
  }

  if (Array.isArray(filters.contextPredicate) && filters.contextPredicate.length > 0) {
    if (!matchesStaticPredicate(filters.contextPredicate, entry, context)) {
      return false;
    }
  }

  if (filters.uuids?.length && !matchesUuidAllowlist(entry, packId, filters.uuids)) {
    return false;
  }

  if (filters.uuidPredicates && !matchesUuidChoicePredicate(entry, packId, filters.uuidPredicates, context)) {
    return false;
  }

  if (hasUnsupportedEmbeddedChoiceSet(entry, step)) {
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

  if (Array.isArray(filters.predicate) && filters.predicate.length > 0) {
    if (!matchesChoicePredicate(filters.predicate, entry, context)) {
      return false;
    }

    if (matchesCurrentClassMulticlassDedication(entry, filters.predicate, context)) {
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

  if (step.slotKind === "spell-choice") {
    return matchesSpellChoiceContext(entry, packId, step);
  }

  if (step.slotKind === "ancestry-feat") {
    return matchesAncestryFeatContext(entry, context, traitCatalog);
  }

  if (step.slotKind === "class-feat") {
    return matchesClassFeatContext(entry, context, traitCatalog);
  }

  if (step.slotKind === "skill-feat") {
    return matchesSkillFeatContext(entry, context);
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

function extractEntrySlug(entry: unknown): string | null {
  return extractDocumentSlug(entry);
}

function extractEntryTraits(entry: PackIndexEntry): string[] {
  return Array.from(
    new Set([
      ...normalizeTraitList(entry?.system?.traits?.value),
      ...normalizeTraitList(entry?.system?.traits?.otherTags),
    ])
  );
}

function resolveFeatType(entry: PackIndexEntry): string | null {
  return stringOrNull(entry?.system?.featType?.value) ?? stringOrNull(entry?.system?.category);
}

function matchesAncestryFeatContext(entry: PackIndexEntry, context: OptionContext, traitCatalog: Set<string>): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "ancestry") {
    return false;
  }

  if (requiresSpellcastingClassFeature(entry) && !context.classHasSpellcasting) {
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

function requiresSpellcastingClassFeature(entry: PackIndexEntry): boolean {
  return [...extractPrerequisiteText(entry), stringOrNull(entry?.system?.description?.value) ?? ""].some((text) =>
    /\bspellcasting class feature\b/i.test(text)
  );
}

function extractPrerequisiteText(entry: PackIndexEntry): string[] {
  const values = entry?.system?.prerequisites?.value;
  return Array.isArray(values)
    ? values.flatMap((value) => {
        if (typeof value === "string") {
          return [value];
        }

        const text = (value as { value?: unknown } | null)?.value;
        return typeof text === "string" ? [text] : [];
      })
    : [];
}

function matchesClassFeatContext(entry: PackIndexEntry, context: OptionContext, _traitCatalog: Set<string>): boolean {
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

function matchesSkillFeatContext(entry: PackIndexEntry, context: OptionContext): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "skill") {
    return false;
  }

  const traits = extractEntryTraits(entry);
  if (traits.includes("archetype") || traits.includes("dedication")) {
    return false;
  }

  return matchesSkillFeatTrainingPrerequisites(entry, context);
}

type SkillTrainingRequirement =
  | { kind: "any-skill" }
  | { kind: "any-lore" }
  | { kind: "recall-knowledge" }
  | { kind: "one-of"; slugs: string[] };

const RECALL_KNOWLEDGE_SKILLS = new Set([
  "arcana",
  "crafting",
  "medicine",
  "nature",
  "occultism",
  "religion",
  "society",
]);

function matchesSkillFeatTrainingPrerequisites(entry: PackIndexEntry, context: OptionContext): boolean {
  const requirements = extractSkillTrainingRequirements(extractPrerequisiteText(entry));
  if (requirements.length === 0) {
    return true;
  }

  const skillRanks = context.skillRanks ?? {};
  return requirements.every((requirement) => matchesSkillTrainingRequirement(requirement, skillRanks));
}

function extractSkillTrainingRequirements(prerequisites: string[]): SkillTrainingRequirement[] {
  return prerequisites.flatMap((prerequisite): SkillTrainingRequirement[] => {
    const text = prerequisite.trim().toLowerCase();
    if (!/\btrained in\b/.test(text)) {
      return [];
    }

    if (/\btrained in at least one skill\b/.test(text)) {
      return [{ kind: "any-skill" } satisfies SkillTrainingRequirement];
    }

    if (/\btrained in a skill with the recall knowledge action\b/.test(text)) {
      return [{ kind: "recall-knowledge" } satisfies SkillTrainingRequirement];
    }

    if (/\btrained in lore\b/.test(text)) {
      return [{ kind: "any-lore" } satisfies SkillTrainingRequirement];
    }

    const slugs = extractNamedSkillSlugs(text);
    return slugs.length > 0 ? [{ kind: "one-of", slugs } satisfies SkillTrainingRequirement] : [];
  });
}

function extractNamedSkillSlugs(text: string): string[] {
  const slugs = new Set<string>();
  for (const [slug, label] of Object.entries(SKILL_LABELS)) {
    if (text.includes(label.toLowerCase())) {
      slugs.add(slug);
    }
  }

  const trainedText = text.split(/\btrained in\b/).at(-1) ?? text;
  const parts = trainedText.split(/[,;]|\bor\b|\band\b/);
  for (const part of parts) {
    const match = part.trim().match(/^([a-z][a-z -]*?) lore\b/);
    if (match?.[1]) {
      const loreSlug = normalizeSkillSlug(`${match[1]} lore`);
      if (loreSlug) {
        slugs.add(loreSlug);
      }
    }
  }

  return Array.from(slugs);
}

function matchesSkillTrainingRequirement(
  requirement: SkillTrainingRequirement,
  skillRanks: Record<string, number>
): boolean {
  switch (requirement.kind) {
    case "any-skill":
      return Object.values(skillRanks).some((rank) => rank >= 1);
    case "any-lore":
      return Object.entries(skillRanks).some(([slug, rank]) => rank >= 1 && isLoreSkillSlug(slug));
    case "recall-knowledge":
      return Object.entries(skillRanks).some(
        ([slug, rank]) => rank >= 1 && (RECALL_KNOWLEDGE_SKILLS.has(slug) || isLoreSkillSlug(slug))
      );
    case "one-of":
      return requirement.slugs.some((slug) => (skillRanks[slug] ?? 0) >= 1);
  }
}

function isLoreSkillSlug(slug: string): boolean {
  return slug === "lore" || slug.endsWith("-lore");
}

function normalizeSkillSlug(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function matchesClassBranchContext(entry: PackIndexEntry, step: PendingStep, context: OptionContext): boolean {
  const branch = step.branch;
  if (!branch) {
    return false;
  }

  if (branch.classSlug && context.classSlug && branch.classSlug !== context.classSlug) {
    return false;
  }

  const traits = extractEntryTraits(entry);
  if (traits.includes("class-archetype")) {
    return false;
  }

  if (!Array.isArray(step.filters?.predicate) || step.filters.predicate.length === 0) {
    const otherTags = normalizeTraitList(entry?.system?.traits?.otherTags);
    if (!otherTags.includes(branch.optionTag)) {
      return false;
    }
  }

  if (branch.optionTag === "champion-cause") {
    const sanctification = context.sanctification ?? null;
    const isHoly = traits.includes("holy");
    const isUnholy = traits.includes("unholy");
    if (sanctification === "holy" && isUnholy) {
      return false;
    }
    if (sanctification === "unholy" && isHoly) {
      return false;
    }
    if ((sanctification === null || sanctification === "none") && (isHoly || isUnholy)) {
      return false;
    }
  }

  return true;
}

function hasUnsupportedEmbeddedChoiceSet(entry: PackIndexEntry, step: PendingStep): boolean {
  if (!entryHasChoiceSetRule(entry)) {
    return false;
  }

  if (step.kind === "class-branch") {
    return !Array.isArray(step.filters?.predicate) || step.filters.predicate.length === 0;
  }

  if (step.kind !== "pick-item" || step.slotKind === "grant-choice") {
    return false;
  }

  return ["ancestry-feat", "class-feat", "general-feat", "skill-feat"].includes(step.slotKind);
}

function hidesUnsupportedEmbeddedChoiceSets(step: PendingStep): boolean {
  if (step.kind === "class-branch") {
    return !Array.isArray(step.filters?.predicate) || step.filters.predicate.length === 0;
  }

  if (step.kind !== "pick-item" || step.slotKind === "grant-choice") {
    return false;
  }

  return ["ancestry-feat", "class-feat", "general-feat", "skill-feat"].includes(step.slotKind);
}

function entryHasChoiceSetRule(entry: PackIndexEntry): boolean {
  const rules = entry?.system?.rules;
  return Array.isArray(rules) && rules.some((rule) => isRecord(rule) && rule.key === "ChoiceSet");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function matchesSpellChoiceContext(entry: PackIndexEntry, packId: string, step: PendingStep): boolean {
  const spellChoice = step.spellChoice;
  if (!spellChoice) {
    return false;
  }

  const traditions = Array.isArray(entry?.system?.traits?.traditions)
    ? entry.system.traits.traditions
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim().toLowerCase())
    : [];
  const excludedTraditions = spellChoice.excludedTraditions ?? [];
  const entrySlug = extractEntrySlug(entry);
  const allowedSpellSlugs = spellChoice.allowedSpellSlugs ?? [];
  const isExplicitlyAllowed = !!entrySlug && allowedSpellSlugs.includes(entrySlug);
  const documentId = String(entry._id ?? "");
  const entryUuid = documentId ? toCompendiumItemUuid(packId, documentId) : "";
  const entryName = String(entry?.name ?? "");
  const additionalAllowedSpellNames = spellChoice.additionalAllowedSpellNames ?? [];
  const additionalAllowedSpellUuids = new Set(
    (spellChoice.additionalAllowedSpellUuids ?? []).map((uuid) => uuid.trim().toLowerCase()).filter(Boolean)
  );
  const isAdditionallyAllowedByUuid = additionalAllowedSpellUuids.has(entryUuid.toLowerCase());
  const traits = extractEntryTraits(entry);
  const isCantrip = traits.includes("cantrip");
  if (spellChoice.cantrip !== isCantrip) {
    return false;
  }

  const rank = spellChoice.cantrip ? 0 : numericOrNull(entry?.system?.level?.value);
  if (rank === null || rank < spellChoice.minRank || rank > spellChoice.maxRank) {
    return false;
  }

  if (allowedSpellSlugs.length > 0) {
    return isExplicitlyAllowed;
  }

  if (isExplicitlyAllowed) {
    return true;
  }

  if (isAdditionallyAllowedByUuid) {
    return true;
  }

  if (additionalAllowedSpellNames.some((name) => namesMatch(name, entryName))) {
    return true;
  }

  if (excludedTraditions.length > 0) {
    if (traditions.some((tradition) => excludedTraditions.includes(tradition))) {
      return false;
    }
  } else if (!traditions.includes(spellChoice.destination.tradition)) {
    return false;
  }

  const restrictToCommon = spellChoice.restrictToCommon ?? false;

  if (spellChoice.curriculumSpellNames.length === 0) {
    if (!restrictToCommon) {
      return true;
    }

    const rarity = stringOrNull(entry?.system?.traits?.rarity)?.trim().toLowerCase() ?? "";
    return rarity === "" || rarity === "common";
  }

  return spellChoice.curriculumSpellNames.some((name) => namesMatch(name, entryName));
}

function matchesChoicePredicate(predicate: ChoicePredicate, entry: PackIndexEntry, context: OptionContext): boolean {
  return evaluateStaticPredicate(predicate, (statement) => evaluateStaticPredicateString(statement, entry, context));
}

function matchesUuidAllowlist(entry: PackIndexEntry, packId: string, allowedUuids: string[]): boolean {
  const allowed = new Set(allowedUuids.map(normalizeUuid).filter(Boolean));
  if (allowed.size === 0) {
    return true;
  }

  return entryUuidCandidates(entry, packId).some((candidate) => allowed.has(normalizeUuid(candidate)));
}

function matchesUuidChoicePredicate(
  entry: PackIndexEntry,
  packId: string,
  uuidPredicates: Record<string, ChoicePredicate[]>,
  context: OptionContext
): boolean {
  const predicatesByUuid = new Map(
    Object.entries(uuidPredicates).map(([uuid, predicate]) => [normalizeUuid(uuid), predicate] as const)
  );
  for (const candidate of entryUuidCandidates(entry, packId)) {
    const predicate = predicatesByUuid.get(normalizeUuid(candidate));
    if (predicate) {
      return matchesStaticPredicate(predicate, entry, context);
    }
  }

  return true;
}

function entryUuidCandidates(entry: PackIndexEntry, packId: string): string[] {
  const candidates: string[] = [];
  const documentId = stringOrNull(entry._id);
  const name = stringOrNull(entry.name);
  const slug = extractEntrySlug(entry);
  if (documentId) {
    candidates.push(toCompendiumItemUuid(packId, documentId));
  }
  if (name) {
    candidates.push(toCompendiumItemUuid(packId, name));
  }
  if (slug) {
    candidates.push(toCompendiumItemUuid(packId, slug));
  }

  return candidates;
}

function normalizeUuid(value: string): string {
  return value.trim().toLowerCase();
}

function matchesChoicePredicateString(statement: string, entry: PackIndexEntry, context: OptionContext): boolean {
  const resolved = resolveInjectedPredicateString(statement, context);
  if (!resolved) {
    return false;
  }

  const itemSlug = extractEntrySlug(entry);
  const itemTraits = extractEntryTraits(entry);
  if (resolved.startsWith("item:level:")) {
    const expectedLevel = Number(resolved.slice("item:level:".length));
    const level = numericOrNull(entry?.system?.level?.value);
    return Number.isFinite(expectedLevel) && level === expectedLevel;
  }

  if (resolved.startsWith("item:type:")) {
    const expectedType = resolved.slice("item:type:".length).trim().toLowerCase();
    return matchesItemType(entry, expectedType);
  }

  if (resolved.startsWith("item:category:")) {
    const expectedCategory = resolved.slice("item:category:".length).trim().toLowerCase();
    const category = stringOrNull(entry?.system?.category)?.trim().toLowerCase();
    const featType = resolveFeatType(entry)?.trim().toLowerCase();
    return category === expectedCategory || featType === expectedCategory;
  }

  if (resolved.startsWith("item:trait:")) {
    const expectedTrait = resolved.slice("item:trait:".length).trim().toLowerCase();
    return itemTraits.includes(expectedTrait);
  }

  if (resolved.startsWith("item:tag:")) {
    const expectedTag = resolved.slice("item:tag:".length).trim().toLowerCase();
    return itemTraits.includes(expectedTag);
  }

  if (resolved.startsWith("item:")) {
    const expectedSlug = resolved.slice("item:".length).trim().toLowerCase();
    return itemSlug === expectedSlug;
  }

  if (resolved.startsWith("feature:")) {
    return false;
  }

  return false;
}

function matchesStaticPredicate(predicate: ChoicePredicate, entry: PackIndexEntry, context: OptionContext): boolean {
  return evaluateStaticPredicate(predicate, (statement) => evaluateStaticPredicateString(statement, entry, context));
}

function matchesItemType(entry: PackIndexEntry, expectedType: string): boolean {
  const normalizedExpected = expectedType.trim().toLowerCase();
  const entryType = String(entry?.type ?? "")
    .trim()
    .toLowerCase();
  if (normalizedExpected === "feature") {
    return entryType === "feat" && resolveFeatType(entry)?.trim().toLowerCase() === "classfeature";
  }

  return entryType === normalizedExpected;
}

function evaluateStaticPredicate(
  predicate: ChoicePredicate,
  evaluateString: (statement: string) => boolean | "unknown"
): boolean {
  if (typeof predicate === "string") {
    return evaluateString(predicate) === true;
  }

  if (Array.isArray(predicate)) {
    return predicate.every((entry) => evaluateStaticPredicate(entry, evaluateString));
  }

  const comparison = evaluateComparisonPredicate(predicate, evaluateString);
  if (comparison !== null) {
    return comparison;
  }

  if (Array.isArray(predicate.or)) {
    return predicate.or.some((entry) => evaluateStaticPredicate(entry, evaluateString));
  }

  if (Array.isArray(predicate.nor)) {
    return predicate.nor.every((entry) => evaluateStringOrTree(entry, evaluateString) === false);
  }

  if (predicate.not) {
    return evaluateStringOrTree(predicate.not, evaluateString) === false;
  }

  return true;
}

function evaluateComparisonPredicate(
  predicate: Exclude<ChoicePredicate, string | ChoicePredicate[]>,
  evaluateString: (statement: string) => boolean | "unknown"
): boolean | null {
  for (const [operator, comparator] of [
    ["lt", predicate.lt],
    ["lte", predicate.lte],
    ["gt", predicate.gt],
    ["gte", predicate.gte],
  ] as const) {
    if (!Array.isArray(comparator) || comparator.length !== 2) {
      continue;
    }

    const [left, right] = comparator;
    if (typeof left !== "string" || (typeof right !== "number" && typeof right !== "string")) {
      return false;
    }

    const resolved = evaluateString(`${operator}:${left}:${right}`);
    return resolved === true;
  }

  return null;
}

function evaluateStringOrTree(
  predicate: ChoicePredicate,
  evaluateString: (statement: string) => boolean | "unknown"
): boolean | "unknown" {
  if (typeof predicate === "string") {
    return evaluateString(predicate);
  }

  if (Array.isArray(predicate)) {
    return predicate.every((entry) => evaluateStringOrTree(entry, evaluateString) === true) ? true : "unknown";
  }

  if (Array.isArray(predicate.or)) {
    if (predicate.or.some((entry) => evaluateStringOrTree(entry, evaluateString) === true)) {
      return true;
    }
    return predicate.or.every((entry) => evaluateStringOrTree(entry, evaluateString) === false) ? false : "unknown";
  }

  if (Array.isArray(predicate.nor)) {
    if (predicate.nor.some((entry) => evaluateStringOrTree(entry, evaluateString) === true)) {
      return false;
    }
    return predicate.nor.every((entry) => evaluateStringOrTree(entry, evaluateString) === false) ? true : "unknown";
  }

  if (predicate.not) {
    const value = evaluateStringOrTree(predicate.not, evaluateString);
    return value === "unknown" ? "unknown" : !value;
  }

  return true;
}

function evaluateStaticPredicateString(
  statement: string,
  entry: PackIndexEntry,
  context: OptionContext
): boolean | "unknown" {
  const trimmed = statement.trim().toLowerCase();
  if (!trimmed) {
    return "unknown";
  }

  const activeRollOptions = new Set((context.rollOptions ?? []).map((option) => option.trim().toLowerCase()));
  if (activeRollOptions.has(trimmed)) {
    return true;
  }

  if (trimmed.startsWith("class:")) {
    return context.classSlug?.trim().toLowerCase() === trimmed.slice("class:".length);
  }

  if (trimmed.startsWith("ancestry:")) {
    return context.ancestrySlug?.trim().toLowerCase() === trimmed.slice("ancestry:".length);
  }

  const skillRankMatch = /^skill:([^:]+):rank:(\d+)$/.exec(trimmed);
  if (skillRankMatch) {
    const skillSlug = skillRankMatch[1] ?? "";
    const expectedRank = Number(skillRankMatch[2]);
    const rank = context.skillRanks?.[skillSlug] ?? 0;
    return Number.isFinite(expectedRank) && rank === expectedRank;
  }

  if (trimmed.startsWith("item:")) {
    return matchesChoicePredicateString(statement, entry, context);
  }

  const comparisonMatch = /^(lt|lte|gt|gte):item:level:(\d+)$/.exec(trimmed);
  if (comparisonMatch) {
    const level = numericOrNull(entry?.system?.level?.value);
    const expected = Number(comparisonMatch[2]);
    if (level === null || !Number.isFinite(expected)) {
      return false;
    }

    switch (comparisonMatch[1]) {
      case "lt":
        return level < expected;
      case "lte":
        return level <= expected;
      case "gt":
        return level > expected;
      case "gte":
        return level >= expected;
    }
  }

  return "unknown";
}

function resolveInjectedPredicateString(statement: string, context: OptionContext): string | null {
  const trimmed = statement.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\{actor\|([^}]+)\}/g, (_, path: string) => {
    switch (path.trim()) {
      case "system.details.class.trait":
        return context.classSlug ?? "";
      case "system.details.ancestry.trait":
        return context.ancestrySlug ?? "";
      default:
        return "";
    }
  });
}

function matchesCurrentClassMulticlassDedication(
  entry: PackIndexEntry,
  predicate: ChoicePredicate[],
  context: OptionContext
): boolean {
  const classSlug = context.classSlug?.trim().toLowerCase();
  if (!classSlug || !predicateIncludesString(predicate, "item:trait:multiclass")) {
    return false;
  }

  return extractEntryTraits(entry).includes(classSlug);
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

function namesMatch(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

async function getTraitCatalog(slotKind: PendingStep["slotKind"]): Promise<Set<string>> {
  if (slotKind === "spell-choice") {
    return new Set();
  }

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
    const pack = getGamePack(packId);
    if (!pack) {
      continue;
    }

    const index = await getPackIndex(pack, packId);
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
  const pf2eConfig = (globalThis as PackServiceGlobals).CONFIG?.PF2E;
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

function getGamePack(packId: string): GamePackLike | null {
  return (globalThis as PackServiceGlobals).game?.packs?.get(packId) ?? null;
}
