import { OFFICIAL_PACKS } from "./constants.js";
import { getExtraPackSetting } from "./settings.js";
import { extractDocumentSlug } from "./shared/slug.js";
import { mergePackIds, parseCompendiumAllowlist } from "./source-filter.js";
const indexCache = new Map();
const traitCatalogCache = new Map();
const EMPTY_OPTION_CONTEXT = {
    ancestrySlug: null,
    ancestryTraits: [],
    heritageTraits: [],
    classSlug: null,
    deitySelected: false,
    sanctification: null,
    hasDedicationFeat: false,
};
export async function getOptionsForStep(step, context = EMPTY_OPTION_CONTEXT) {
    if ((step.kind !== "pick-item" && step.kind !== "class-branch" && step.kind !== "spell-choice") || !step.filters) {
        return [];
    }
    const packIds = resolvePackIds(step.slotKind);
    const traitCatalog = await getTraitCatalog(step.slotKind);
    const results = [];
    for (const packId of packIds) {
        const pack = getGamePack(packId);
        if (!pack) {
            continue;
        }
        const index = await getPackIndex(pack, packId);
        for (const entry of index) {
            if (!matchesFilters(entry, step, context, traitCatalog)) {
                continue;
            }
            const level = numericOrNull(entry?.system?.level?.value);
            const featType = resolveFeatType(entry);
            const slug = extractEntrySlug(entry);
            const traits = extractEntryTraits(entry);
            const documentId = String(entry._id);
            const uuid = toCompendiumItemUuid(packId, documentId);
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
export async function resolveSelection(rawValue, step, context = EMPTY_OPTION_CONTEXT) {
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
export async function fetchSelectionDocument(selection) {
    const pack = getGamePack(selection.packId);
    if (!pack) {
        return null;
    }
    return pack.getDocument(selection.documentId);
}
function toCompendiumItemUuid(packId, documentId) {
    return `Compendium.${packId}.Item.${documentId}`;
}
export function clearPackServiceCache() {
    indexCache.clear();
    traitCatalogCache.clear();
}
export function getPickerInfoState(step, context, optionCount, filteredCount, search, hasActiveFilters = false) {
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
    if (filteredCount === 0 && (search.trim() || hasActiveFilters)) {
        const searchActive = search.trim().length > 0;
        return {
            tone: "search",
            eyebrow: hasActiveFilters ? "Filters active" : "Search results",
            title: searchActive && hasActiveFilters
                ? "No choices match this search and filters"
                : hasActiveFilters
                    ? "No choices match current filters"
                    : "No choices match this search",
            message: searchActive && hasActiveFilters
                ? "Adjust the search or remove a filter to widen the list again."
                : hasActiveFilters
                    ? "Remove or change a filter to widen the list again."
                    : "Adjust the search terms to widen the list again.",
        };
    }
    return null;
}
export function getPickerBlockedState(step, context) {
    switch (step.slotKind) {
        case "heritage":
            return context.ancestrySlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose an ancestry first",
                    message: "Wayfinder filters heritages from the drafted ancestry. Pick the ancestry step before reviewing heritage options.",
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
                    message: "Class feat options are filtered from the drafted class. Pick the class step before reviewing class feats.",
                };
        case "class-branch":
            if (step.branch?.dependsOn === "deity" && !context.deitySelected) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a deity first",
                    message: "This class path depends on the drafted deity and sanctification state. Resolve the deity step before reviewing these branch options.",
                };
            }
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Class branch options are pulled from the drafted class's selector features. Pick the class step before reviewing branch options.",
                };
        case "deity":
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Wayfinder only offers deity choices when a drafted class grants them. Pick the class step before reviewing deity options.",
                };
        case "spell-choice":
            if (!context.classSlug) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Wayfinder only offers spellbook choices after the drafted class defines the casting tradition and destination.",
                };
            }
            if (step.spellChoice?.dependsOn === "class-branch" && step.spellChoice.curriculumSpellNames.length === 0) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose an arcane school first",
                    message: "This spell choice depends on the drafted arcane school. Resolve the school step before reviewing curriculum spells.",
                };
            }
            return null;
        default:
            return null;
    }
}
function resolvePackIds(slotKind) {
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
async function getPackIndex(pack, packId) {
    if (indexCache.has(packId)) {
        return indexCache.get(packId) ?? [];
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
function matchesFilters(entry, step, context, traitCatalog) {
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
        return matchesSpellChoiceContext(entry, step);
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
function dedupeAndSort(options) {
    const deduped = new Map();
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
function numericOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function stringOrNull(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}
function extractEntrySlug(entry) {
    return extractDocumentSlug(entry);
}
function extractEntryTraits(entry) {
    return Array.from(new Set([
        ...normalizeTraitList(entry?.system?.traits?.value),
        ...normalizeTraitList(entry?.system?.traits?.otherTags),
    ]));
}
function resolveFeatType(entry) {
    return stringOrNull(entry?.system?.featType?.value) ?? stringOrNull(entry?.system?.category);
}
function matchesAncestryFeatContext(entry, context, traitCatalog) {
    const category = stringOrNull(entry?.system?.category);
    if (category && category !== "ancestry") {
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
function matchesClassFeatContext(entry, context, _traitCatalog) {
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
function matchesSkillFeatContext(entry) {
    const category = stringOrNull(entry?.system?.category);
    if (category && category !== "skill") {
        return false;
    }
    const traits = extractEntryTraits(entry);
    return !traits.includes("archetype") && !traits.includes("dedication");
}
function matchesClassBranchContext(entry, step, context) {
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
    return !branch.classSlug || traits.length === 0 || traits.includes(branch.classSlug);
}
function matchesSpellChoiceContext(entry, step) {
    const spellChoice = step.spellChoice;
    if (!spellChoice) {
        return false;
    }
    const traditions = Array.isArray(entry?.system?.traits?.traditions)
        ? entry.system.traits.traditions
            .filter((value) => typeof value === "string")
            .map((value) => value.trim().toLowerCase())
        : [];
    if (!traditions.includes(spellChoice.destination.tradition)) {
        return false;
    }
    const traits = extractEntryTraits(entry);
    const isCantrip = traits.includes("cantrip");
    if (spellChoice.cantrip !== isCantrip) {
        return false;
    }
    const rank = spellChoice.cantrip ? 0 : numericOrNull(entry?.system?.level?.value);
    if (rank === null || rank < spellChoice.minRank || rank > spellChoice.maxRank) {
        return false;
    }
    const entryName = String(entry?.name ?? "");
    const additionalAllowedSpellNames = spellChoice.additionalAllowedSpellNames ?? [];
    const restrictToCommon = spellChoice.restrictToCommon ?? false;
    if (additionalAllowedSpellNames.some((name) => namesMatch(name, entryName))) {
        return true;
    }
    if (spellChoice.curriculumSpellNames.length === 0) {
        if (!restrictToCommon) {
            return true;
        }
        const rarity = stringOrNull(entry?.system?.traits?.rarity)?.trim().toLowerCase() ?? "";
        return rarity === "" || rarity === "common";
    }
    return spellChoice.curriculumSpellNames.some((name) => namesMatch(name, entryName));
}
function matchesChoicePredicate(predicate, entry, context) {
    if (typeof predicate === "string") {
        return matchesChoicePredicateString(predicate, entry, context);
    }
    if (Array.isArray(predicate)) {
        return predicate.every((entryPredicate) => matchesChoicePredicate(entryPredicate, entry, context));
    }
    if (Array.isArray(predicate.or)) {
        return predicate.or.some((entryPredicate) => matchesChoicePredicate(entryPredicate, entry, context));
    }
    if (Array.isArray(predicate.nor)) {
        return predicate.nor.every((entryPredicate) => !matchesChoicePredicate(entryPredicate, entry, context));
    }
    if (predicate.not) {
        return !matchesChoicePredicate(predicate.not, entry, context);
    }
    return true;
}
function matchesChoicePredicateString(statement, entry, context) {
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
    if (resolved.startsWith("item:")) {
        const expectedSlug = resolved.slice("item:".length).trim().toLowerCase();
        return itemSlug === expectedSlug;
    }
    if (resolved.startsWith("feature:")) {
        return false;
    }
    return false;
}
function resolveInjectedPredicateString(statement, context) {
    const trimmed = statement.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.replace(/\{actor\|([^}]+)\}/g, (_, path) => {
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
function matchesCurrentClassMulticlassDedication(entry, predicate, context) {
    const classSlug = context.classSlug?.trim().toLowerCase();
    if (!classSlug || !predicateIncludesString(predicate, "item:trait:multiclass")) {
        return false;
    }
    return extractEntryTraits(entry).includes(classSlug);
}
function predicateIncludesString(predicate, target) {
    if (typeof predicate === "string") {
        return predicate.includes(target);
    }
    if (Array.isArray(predicate)) {
        return predicate.some((entry) => predicateIncludesString(entry, target));
    }
    return ((Array.isArray(predicate.or) && predicate.or.some((entry) => predicateIncludesString(entry, target))) ||
        (Array.isArray(predicate.nor) && predicate.nor.some((entry) => predicateIncludesString(entry, target))) ||
        (!!predicate.not && predicateIncludesString(predicate.not, target)));
}
function normalizeTraitList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)));
}
function namesMatch(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
async function getTraitCatalog(slotKind) {
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
    const packIds = cacheKey === "class"
        ? resolvePackIds("class")
        : mergePackIds(resolvePackIds("ancestry"), resolvePackIds("heritage"));
    const traits = new Set();
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
function getGamePack(packId) {
    return globalThis.game?.packs?.get(packId) ?? null;
}
//# sourceMappingURL=pack-service.js.map