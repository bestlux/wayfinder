import { OFFICIAL_PACKS, SKILL_LABELS } from "../constants.js";
import { getExtraPackSetting } from "../settings.js";
import { toCompendiumItemUuid } from "../shared/compendium.js";
import { expandCompendiumAllowlist, mergePackIds, parseCompendiumAllowlist } from "../source-filter.js";
import { isSpellRarityWithinCeiling, spellChoiceRarityCeiling } from "../wayfinder/spell-choice/rarity-access.js";
import { cacheTraitCatalog, getCachedTraitCatalog, getGamePack, getGamePackIds, getPackIndex, } from "./access.js";
import { classifyArchetypeLegality } from "./archetype-legality.js";
import { hasUnsupportedEmbeddedChoiceSet } from "./embedded-choice-policy.js";
import { extractEntrySlug, extractEntryTraits, namesMatch, normalizeTraitList, numericOrNull, resolveFeatType, stringOrNull, } from "./entry.js";
import { isPlayerSelectableRoot } from "./player-option-eligibility.js";
import { evaluateChoicePredicate, evaluateStaticPredicateMatch, evaluateUuidChoicePredicate, matchesCurrentClassMulticlassDedication, matchesItemType, matchesUuidAllowlist, } from "./predicates.js";
export function resolvePackIds(slotKind, filters) {
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
export function matchesFilters(entry, packId, step, context, traitCatalog) {
    return classifyFilterDecision(entry, packId, step, context, traitCatalog).kind === "include";
}
const INCLUDE = { kind: "include" };
const ORDINARY_EXCLUSION = { kind: "exclude", category: "ordinary-legality" };
const POLICY_GRANT_SUPPRESSION = {
    kind: "exclude",
    category: "fail-closed-policy",
    reason: "unvalidated-granted-choice",
};
const POLICY_ELIGIBILITY_SUPPRESSION = {
    kind: "exclude",
    category: "fail-closed-policy",
    reason: "unvalidated-eligibility",
};
export function classifyFilterDecision(entry, packId, step, context, traitCatalog) {
    const filters = step.filters;
    if (!filters) {
        return INCLUDE;
    }
    if (!matchesItemType(entry, filters.itemType)) {
        return ORDINARY_EXCLUSION;
    }
    if (!isPlayerSelectableRoot(entry, filters.itemType)) {
        return ORDINARY_EXCLUSION;
    }
    let policyUncertainty = null;
    if (Array.isArray(filters.contextPredicate) && filters.contextPredicate.length > 0) {
        const result = evaluateStaticPredicateMatch(filters.contextPredicate, entry, context);
        if (result === false) {
            return ORDINARY_EXCLUSION;
        }
        if (result === "unknown")
            policyUncertainty = POLICY_ELIGIBILITY_SUPPRESSION;
    }
    if (filters.uuids?.length && !matchesUuidAllowlist(entry, packId, filters.uuids)) {
        return ORDINARY_EXCLUSION;
    }
    if (filters.uuidPredicates) {
        const result = evaluateUuidChoicePredicate(entry, packId, filters.uuidPredicates, context);
        if (result === false) {
            return ORDINARY_EXCLUSION;
        }
        if (result === "unknown")
            policyUncertainty = POLICY_ELIGIBILITY_SUPPRESSION;
    }
    if (hasUnsupportedEmbeddedChoiceSet(entry, packId, step, context)) {
        policyUncertainty ??= POLICY_GRANT_SUPPRESSION;
    }
    if (Array.isArray(filters.featTypes)) {
        const featType = resolveFeatType(entry);
        if (!featType || !filters.featTypes.includes(featType)) {
            return ORDINARY_EXCLUSION;
        }
    }
    if (!matchesTraitFilters(entry, filters)) {
        return ORDINARY_EXCLUSION;
    }
    if (typeof filters.maxLevel === "number") {
        const level = numericOrNull(entry?.system?.level?.value);
        if (level === null || !Number.isInteger(level) || level < 0 || level > filters.maxLevel) {
            return ORDINARY_EXCLUSION;
        }
    }
    if (Array.isArray(filters.predicate) && filters.predicate.length > 0) {
        const result = evaluateChoicePredicate(filters.predicate, entry, context);
        if (result === false) {
            return ORDINARY_EXCLUSION;
        }
        if (result === "unknown")
            policyUncertainty = POLICY_ELIGIBILITY_SUPPRESSION;
        if (matchesCurrentClassMulticlassDedication(entry, filters.predicate, context)) {
            return ORDINARY_EXCLUSION;
        }
    }
    if (step.slotKind === "heritage" && context.ancestrySlug) {
        const heritageAncestrySlug = stringOrNull(entry?.system?.ancestry?.slug);
        if (heritageAncestrySlug && heritageAncestrySlug !== context.ancestrySlug) {
            return ORDINARY_EXCLUSION;
        }
    }
    if (step.slotKind === "class-branch") {
        return withPolicyUncertainty(ordinaryDecision(matchesClassBranchContext(entry, step, context)), policyUncertainty);
    }
    if (step.slotKind === "spell-choice") {
        return withPolicyUncertainty(ordinaryDecision(matchesSpellChoiceContext(entry, packId, step)), policyUncertainty);
    }
    if (step.slotKind === "ancestry-feat" || isAncestryCampaignFeatCandidate(step, entry)) {
        return withPolicyUncertainty(ordinaryDecision(matchesAncestryFeatContext(entry, context, traitCatalog)), policyUncertainty);
    }
    if (step.slotKind === "class-feat") {
        return withPolicyUncertainty(classifyClassFeatContext(entry, packId, context), policyUncertainty);
    }
    if (step.slotKind === "archetype-feat") {
        return withPolicyUncertainty(classifyArchetypeFeatContext(entry, packId, context), policyUncertainty);
    }
    if (step.slotKind === "skill-feat") {
        return withPolicyUncertainty(ordinaryDecision(matchesSkillFeatContext(entry, context)), policyUncertainty);
    }
    if (step.slotKind === "general-feat" && stringOrNull(entry?.system?.category) === "skill") {
        return withPolicyUncertainty(ordinaryDecision(matchesSkillFeatContext(entry, context)), policyUncertainty);
    }
    return policyUncertainty ?? INCLUDE;
}
function ordinaryDecision(matches) {
    return matches ? INCLUDE : ORDINARY_EXCLUSION;
}
function withPolicyUncertainty(decision, policyUncertainty) {
    if (decision.kind === "exclude" && decision.category === "ordinary-legality") {
        return decision;
    }
    if (policyUncertainty?.kind === "exclude" &&
        policyUncertainty.category === "fail-closed-policy" &&
        policyUncertainty.reason === "unvalidated-eligibility") {
        return policyUncertainty;
    }
    return decision.kind === "exclude" ? decision : (policyUncertainty ?? INCLUDE);
}
export async function getPackageAncestryCatalog() {
    const catalog = new Map();
    for (const packId of resolvePackIds("ancestry")) {
        const pack = getGamePack(packId);
        if (!pack) {
            continue;
        }
        const packageId = packageIdFromPackId(packId);
        const packageAncestries = catalog.get(packageId) ?? new Set();
        for (const entry of await getPackIndex(pack, packId)) {
            if (stringOrNull(entry.type)?.trim().toLowerCase() !== "ancestry") {
                continue;
            }
            const slug = extractEntrySlug(entry);
            if (slug) {
                packageAncestries.add(slug);
            }
        }
        catalog.set(packageId, packageAncestries);
    }
    return catalog;
}
export function matchesHeritageContext(entry, packId, context, packageAncestries) {
    return classifyHeritageContext(entry, packId, context, packageAncestries).kind === "include";
}
export function classifyHeritageContext(entry, packId, context, packageAncestries) {
    if (!context.ancestrySlug) {
        return INCLUDE;
    }
    const heritageAncestrySlug = stringOrNull(entry?.system?.ancestry?.slug);
    if (heritageAncestrySlug) {
        return ordinaryDecision(heritageAncestrySlug === context.ancestrySlug);
    }
    if (OFFICIAL_PACKS.heritage.some((officialPackId) => officialPackId === packId)) {
        return INCLUDE;
    }
    const inferredAncestries = packageAncestries.get(packageIdFromPackId(packId));
    if (inferredAncestries?.size === 1) {
        return ordinaryDecision(inferredAncestries.has(context.ancestrySlug));
    }
    return POLICY_ELIGIBILITY_SUPPRESSION;
}
function packageIdFromPackId(packId) {
    return packId.split(".", 1)[0] ?? packId;
}
export async function getTraitCatalog(slotKind) {
    if (slotKind === "spell-choice" || slotKind === "archetype-feat") {
        return new Set();
    }
    const catalogKind = slotKind === "class-feat" ? "class" : "ancestry-heritage";
    const configuredTraits = getConfiguredTraitCatalog(catalogKind);
    const packIds = catalogKind === "class"
        ? resolvePackIds("class")
        : mergePackIds(resolvePackIds("ancestry"), resolvePackIds("heritage"));
    const cacheKey = identityCatalogCacheKey(catalogKind, configuredTraits, packIds);
    const cached = getCachedTraitCatalog(cacheKey);
    if (cached) {
        return cached;
    }
    const traits = new Set(configuredTraits);
    for (const packId of packIds) {
        const pack = getGamePack(packId);
        if (!pack) {
            continue;
        }
        const index = await getPackIndex(pack, packId);
        for (const entry of index) {
            if (!isRootIdentityDocument(entry, catalogKind)) {
                continue;
            }
            const slug = extractEntrySlug(entry);
            if (slug) {
                traits.add(slug);
            }
        }
    }
    cacheTraitCatalog(cacheKey, traits);
    return traits;
}
function identityCatalogCacheKey(kind, configuredTraits, packIds) {
    const configuredSignature = Array.from(configuredTraits).sort().join(",");
    const packSignature = [...packIds].sort().join(",");
    return `${kind}|configured:${configuredSignature}|packs:${packSignature}`;
}
function isRootIdentityDocument(entry, kind) {
    const itemType = stringOrNull(entry.type)?.trim().toLowerCase();
    return kind === "class" ? itemType === "class" : itemType === "ancestry" || itemType === "heritage";
}
function isAncestryCampaignFeatCandidate(step, entry) {
    return step.slotKind === "campaign-feat" && resolveFeatType(entry) === "ancestry";
}
function matchesTraitFilters(entry, filters) {
    const traits = new Set(extractEntryTraits(entry));
    if (filters.omitTraits?.some((trait) => traits.has(trait))) {
        return false;
    }
    if (!filters.traits?.length) {
        return true;
    }
    return filters.traitConjunction === "and"
        ? filters.traits.every((trait) => traits.has(trait))
        : filters.traits.some((trait) => traits.has(trait));
}
function matchesAncestryFeatContext(entry, context, traitCatalog) {
    const category = stringOrNull(entry?.system?.category);
    if (category && category !== "ancestry") {
        return false;
    }
    if (requiresSpellcastingClassFeature(entry) && !context.classHasSpellcasting) {
        return false;
    }
    const traits = extractEntryTraits(entry);
    const dependencyTraits = new Set([...context.ancestryTraits, ...context.heritageTraits]);
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
function requiresSpellcastingClassFeature(entry) {
    return [...extractPrerequisiteText(entry), stringOrNull(entry?.system?.description?.value) ?? ""].some((text) => /\bspellcasting class feature\b/i.test(text));
}
function extractPrerequisiteText(entry) {
    const values = entry?.system?.prerequisites?.value;
    return Array.isArray(values)
        ? values.flatMap((value) => {
            if (typeof value === "string") {
                return [value];
            }
            const text = value?.value;
            return typeof text === "string" ? [text] : [];
        })
        : [];
}
function classifyClassFeatContext(entry, packId, context) {
    const category = stringOrNull(entry?.system?.category);
    if (category && category !== "class") {
        return ORDINARY_EXCLUSION;
    }
    const classSlug = context.classSlug;
    if (!classSlug) {
        return INCLUDE;
    }
    const traits = extractEntryTraits(entry);
    const isArchetypeFeat = traits.includes("archetype") || traits.includes("dedication");
    if (isArchetypeFeat) {
        return archetypeDecision(entry, packId, context);
    }
    return ordinaryDecision(traits.includes(classSlug));
}
function classifyArchetypeFeatContext(entry, packId, context) {
    const category = stringOrNull(entry?.system?.category);
    if (category && category !== "class") {
        return ORDINARY_EXCLUSION;
    }
    const traits = extractEntryTraits(entry);
    return traits.includes("archetype") || traits.includes("dedication")
        ? archetypeDecision(entry, packId, context)
        : ORDINARY_EXCLUSION;
}
function archetypeDecision(entry, packId, context) {
    const decision = classifyArchetypeLegality(entry, packId, context, matchesSkillRankPrerequisites);
    return decision.matches ? INCLUDE : decision.failClosed ? POLICY_ELIGIBILITY_SUPPRESSION : ORDINARY_EXCLUSION;
}
function matchesSkillFeatContext(entry, context) {
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
const RECALL_KNOWLEDGE_SKILLS = new Set([
    "arcana",
    "crafting",
    "medicine",
    "nature",
    "occultism",
    "religion",
    "society",
]);
function matchesSkillRankPrerequisites(entry, context) {
    const requirements = extractSkillTrainingRequirements(extractPrerequisiteText(entry));
    if (requirements.length === 0) {
        return true;
    }
    const skillRanks = context.skillRanks ?? {};
    return requirements.every((requirement) => matchesSkillTrainingRequirement(requirement, skillRanks));
}
function extractSkillTrainingRequirements(prerequisites) {
    return prerequisites.flatMap((prerequisite) => {
        const text = prerequisite.trim().toLowerCase();
        const proficiency = /\b(trained|expert|master|legendary) in\b/.exec(text)?.[1];
        const requiredRank = proficiencyRank(proficiency);
        if (requiredRank === null) {
            return [];
        }
        if (/\btrained in at least one skill\b/.test(text)) {
            return [{ kind: "any-skill", requiredRank: 1 }];
        }
        if (/\btrained in a skill with the recall knowledge action\b/.test(text)) {
            return [{ kind: "recall-knowledge", requiredRank: 1 }];
        }
        if (/\btrained in lore\b/.test(text)) {
            return [{ kind: "any-lore", requiredRank: 1 }];
        }
        const slugs = extractNamedSkillSlugs(text);
        return slugs.length > 0 ? [{ kind: "one-of", requiredRank, slugs }] : [];
    });
}
function proficiencyRank(value) {
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
function extractNamedSkillSlugs(text) {
    const slugs = new Set();
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
function matchesSkillTrainingRequirement(requirement, skillRanks) {
    switch (requirement.kind) {
        case "any-skill":
            return Object.values(skillRanks).some((rank) => rank >= requirement.requiredRank);
        case "any-lore":
            return Object.entries(skillRanks).some(([slug, rank]) => rank >= requirement.requiredRank && isLoreSkillSlug(slug));
        case "recall-knowledge":
            return Object.entries(skillRanks).some(([slug, rank]) => rank >= requirement.requiredRank && (RECALL_KNOWLEDGE_SKILLS.has(slug) || isLoreSkillSlug(slug)));
        case "one-of":
            return requirement.slugs.some((slug) => (skillRanks[slug] ?? 0) >= requirement.requiredRank);
    }
}
function isLoreSkillSlug(slug) {
    return slug === "lore" || slug.endsWith("-lore");
}
function normalizeSkillSlug(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized.length > 0 ? normalized : null;
}
function matchesClassBranchContext(entry, step, context) {
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
        if (sanctification === "none" && (isHoly || isUnholy)) {
            return false;
        }
    }
    return true;
}
function matchesSpellChoiceContext(entry, packId, step) {
    const spellChoice = step.spellChoice;
    if (!spellChoice) {
        return false;
    }
    const traditions = Array.isArray(entry?.system?.traits?.traditions)
        ? entry.system.traits.traditions
            .filter((value) => typeof value === "string")
            .map((value) => value.trim().toLowerCase())
        : [];
    const excludedTraditions = spellChoice.excludedTraditions ?? [];
    const entrySlug = extractEntrySlug(entry);
    const allowedSpellSlugs = spellChoice.allowedSpellSlugs ?? [];
    const isExplicitlyAllowed = !!entrySlug && allowedSpellSlugs.includes(entrySlug);
    const documentId = String(entry._id ?? "");
    const entryUuid = documentId ? toCompendiumItemUuid(packId, documentId) : "";
    const entryName = String(entry?.name ?? "");
    const additionalAllowedSpellNames = spellChoice.additionalAllowedSpellNames ?? [];
    const additionalAllowedSpellUuids = new Set((spellChoice.additionalAllowedSpellUuids ?? []).map((uuid) => uuid.trim().toLowerCase()).filter(Boolean));
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
    }
    else if (!traditions.includes(spellChoice.destination.tradition)) {
        return false;
    }
    if (spellChoice.curriculumSpellNames.length === 0) {
        const rarity = stringOrNull(entry?.system?.traits?.rarity)?.trim().toLowerCase() ?? "";
        return isSpellRarityWithinCeiling(rarity, spellChoiceRarityCeiling(spellChoice));
    }
    return spellChoice.curriculumSpellNames.some((name) => namesMatch(name, entryName));
}
function getConfiguredTraitCatalog(kind) {
    const pf2eConfig = globalThis.CONFIG?.PF2E;
    const traitMap = kind === "class" ? pf2eConfig?.classTraits : pf2eConfig?.ancestryTraits;
    if (!traitMap || typeof traitMap !== "object") {
        return new Set();
    }
    return new Set(Object.keys(traitMap)
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean));
}
//# sourceMappingURL=filter-policy.js.map