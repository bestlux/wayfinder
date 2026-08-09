import { OFFICIAL_PACKS, SKILL_LABELS } from "../constants.js";
import { getExtraPackSetting } from "../settings.js";
import { toCompendiumItemUuid } from "../shared/compendium.js";
import { expandCompendiumAllowlist, mergePackIds, parseCompendiumAllowlist } from "../source-filter.js";
import type { OptionContext, PendingStep, StepFilters } from "../types.js";
import { isSpellRarityWithinCeiling, spellChoiceRarityCeiling } from "../wayfinder/spell-choice/rarity-access.js";
import {
  cacheTraitCatalog,
  getCachedTraitCatalog,
  getGamePack,
  getGamePackIds,
  getPackIndex,
  type PackIndexEntry,
} from "./access.js";
import { matchesArchetypeLegality } from "./archetype-legality.js";
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
  const extras = expandCompendiumAllowlist(parseCompendiumAllowlist(getExtraPackSetting()), getGamePackIds());
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

  if (step.slotKind === "ancestry-feat" || isAncestryCampaignFeatStep(step)) {
    return matchesAncestryFeatContext(entry, context, traitCatalog);
  }

  if (step.slotKind === "class-feat") {
    return matchesClassFeatContext(entry, packId, context, traitCatalog);
  }

  if (step.slotKind === "archetype-feat") {
    return matchesArchetypeFeatContext(entry, packId, context);
  }

  if (step.slotKind === "skill-feat") {
    return matchesSkillFeatContext(entry, context);
  }

  if (step.slotKind === "general-feat" && stringOrNull(entry?.system?.category) === "skill") {
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

function isAncestryCampaignFeatStep(step: PendingStep): boolean {
  return (
    step.slotKind === "campaign-feat" &&
    step.campaignFeat?.supported.length === 1 &&
    step.campaignFeat.supported[0] === "ancestry"
  );
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

function matchesClassFeatContext(
  entry: PackIndexEntry,
  packId: string,
  context: OptionContext,
  _traitCatalog: Set<string>
): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "class") {
    return false;
  }

  const classSlug = context.classSlug;
  if (!classSlug) {
    return true;
  }

  const traits = extractEntryTraits(entry);
  const isArchetypeFeat = traits.includes("archetype") || traits.includes("dedication");
  if (isArchetypeFeat) {
    return matchesArchetypeLegality(entry, packId, context, matchesSkillRankPrerequisites);
  }

  return traits.includes(classSlug);
}

function matchesArchetypeFeatContext(entry: PackIndexEntry, packId: string, context: OptionContext): boolean {
  const category = stringOrNull(entry?.system?.category);
  if (category && category !== "class") {
    return false;
  }

  const traits = extractEntryTraits(entry);
  return (
    (traits.includes("archetype") || traits.includes("dedication")) &&
    matchesArchetypeLegality(entry, packId, context, matchesSkillRankPrerequisites)
  );
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

  return matchesSkillRankPrerequisites(entry, context);
}

type SkillTrainingRequirement =
  | { kind: "any-skill"; requiredRank: 1 }
  | { kind: "any-lore"; requiredRank: 1 }
  | { kind: "recall-knowledge"; requiredRank: 1 }
  | { kind: "one-of"; requiredRank: 1 | 2 | 3 | 4; slugs: string[] };

const RECALL_KNOWLEDGE_SKILLS = new Set([
  "arcana",
  "crafting",
  "medicine",
  "nature",
  "occultism",
  "religion",
  "society",
]);

function matchesSkillRankPrerequisites(entry: PackIndexEntry, context: OptionContext): boolean {
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
    const proficiency = /\b(trained|expert|master|legendary) in\b/.exec(text)?.[1];
    const requiredRank = proficiencyRank(proficiency);
    if (requiredRank === null) {
      return [];
    }

    if (/\btrained in at least one skill\b/.test(text)) {
      return [{ kind: "any-skill", requiredRank: 1 } satisfies SkillTrainingRequirement];
    }

    if (/\btrained in a skill with the recall knowledge action\b/.test(text)) {
      return [{ kind: "recall-knowledge", requiredRank: 1 } satisfies SkillTrainingRequirement];
    }

    if (/\btrained in lore\b/.test(text)) {
      return [{ kind: "any-lore", requiredRank: 1 } satisfies SkillTrainingRequirement];
    }

    const slugs = extractNamedSkillSlugs(text);
    return slugs.length > 0 ? [{ kind: "one-of", requiredRank, slugs } satisfies SkillTrainingRequirement] : [];
  });
}

function proficiencyRank(value: string | undefined): 1 | 2 | 3 | 4 | null {
  switch (value) {
    case "trained":
      return 1;
    case "expert":
      return 2;
    case "master":
      return 3;
    case "legendary":
      return 4;
    default:
      return null;
  }
}

function extractNamedSkillSlugs(text: string): string[] {
  const slugs = new Set<string>();
  for (const [slug, label] of Object.entries(SKILL_LABELS)) {
    if (text.includes(label.toLowerCase())) {
      slugs.add(slug);
    }
  }

  const proficiencyText = text.split(/\b(?:trained|expert|master|legendary) in\b/).at(-1) ?? text;
  const parts = proficiencyText.split(/[,;]|\bor\b|\band\b/);
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
      return Object.values(skillRanks).some((rank) => rank >= requirement.requiredRank);
    case "any-lore":
      return Object.entries(skillRanks).some(
        ([slug, rank]) => rank >= requirement.requiredRank && isLoreSkillSlug(slug)
      );
    case "recall-knowledge":
      return Object.entries(skillRanks).some(
        ([slug, rank]) =>
          rank >= requirement.requiredRank && (RECALL_KNOWLEDGE_SKILLS.has(slug) || isLoreSkillSlug(slug))
      );
    case "one-of":
      return requirement.slugs.some((slug) => (skillRanks[slug] ?? 0) >= requirement.requiredRank);
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

  if (spellChoice.curriculumSpellNames.length === 0) {
    const rarity = stringOrNull(entry?.system?.traits?.rarity)?.trim().toLowerCase() ?? "";
    return isSpellRarityWithinCeiling(rarity, spellChoiceRarityCeiling(spellChoice));
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
