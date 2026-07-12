import { OFFICIAL_PACKS, SKILL_LABELS } from "../constants.js";
import { getExtraPackSetting } from "../settings.js";
import { toCompendiumItemUuid } from "../shared/compendium.js";
import { mergePackIds, parseCompendiumAllowlist } from "../source-filter.js";
import type { OptionContext, PendingStep, StepFilters } from "../types.js";
import { cacheTraitCatalog, getCachedTraitCatalog, getGamePack, getPackIndex, type PackIndexEntry } from "./access.js";
import { hasUnsupportedEmbeddedChoiceSet } from "./embedded-choice-policy.js";
import {
  extractEntrySlug,
  extractEntryTraits,
  namesMatch,
  normalizeTraitList,
  numericOrNull,
  resolveFeatType,
  stringOrNull,
} from "./entry.js";
import {
  matchesChoicePredicate,
  matchesCurrentClassMulticlassDedication,
  matchesItemType,
  matchesStaticPredicate,
  matchesUuidAllowlist,
  matchesUuidChoicePredicate,
} from "./predicates.js";

interface Pf2ePackConfigLike {
  ancestryTraits?: Record<string, unknown>;
  classTraits?: Record<string, unknown>;
}

type PackServiceGlobals = typeof globalThis & {
  CONFIG?: {
    PF2E?: Pf2ePackConfigLike;
  };
};

export function resolvePackIds(slotKind: PendingStep["slotKind"], filters?: StepFilters | null): string[] {
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

export function matchesFilters(
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

  if (hasUnsupportedEmbeddedChoiceSet(entry, packId, step, context)) {
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

  if (step.slotKind === "archetype-feat") {
    return matchesArchetypeFeatContext(entry, context);
  }

  if (step.slotKind === "skill-feat") {
    return matchesSkillFeatContext(entry, context);
  }

  return true;
}

export async function getTraitCatalog(slotKind: PendingStep["slotKind"]): Promise<Set<string>> {
  if (slotKind === "spell-choice" || slotKind === "archetype-feat") {
    return new Set();
  }

  const cacheKey = slotKind === "class-feat" ? "class" : "ancestry-heritage";
  const cached = getCachedTraitCatalog(cacheKey);
  if (cached) {
    return cached;
  }

  const configuredTraits = getConfiguredTraitCatalog(cacheKey);
  if (configuredTraits.size > 0) {
    cacheTraitCatalog(cacheKey, configuredTraits);
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

  cacheTraitCatalog(cacheKey, traits);
  return traits;
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

function matchesArchetypeFeatContext(entry: PackIndexEntry, context: OptionContext): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "class") {
    return false;
  }

  const traits = extractEntryTraits(entry);
  return context.hasDedicationFeat ? traits.includes("archetype") : traits.includes("dedication");
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
