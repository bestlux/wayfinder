export const EQUIPMENT_CATALOGUE_FILTER_KEYS = [
    "availability",
    "level",
    "rarity",
    "source",
    "titan-mauler",
    "trait",
    "type",
];
const FILTER_FAILURE = Object.freeze({
    availability: 1 << 0,
    level: 1 << 1,
    rarity: 1 << 2,
    source: 1 << 3,
    titanMauler: 1 << 4,
    trait: 1 << 5,
    type: 1 << 6,
    query: 1 << 7,
});
const FACET_KEYS = Object.freeze(["availability", "type", "rarity", "source", "trait"]);
const IMMUTABLE_ENTRY_FILTER_FACTS = new WeakMap();
export function normalizeEquipmentCatalogueFilters(input) {
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
        titanMaulerEligible: normalizeDefaultOnMode(filters["titan-mauler"], "eligible", defaults.titanMaulerEligible === true),
    });
}
export function matchesEquipmentCatalogueFilters(entry, filters, excludedKey) {
    if (excludedKey !== "availability" && filters.policyAvailable && !entry.available)
        return false;
    if (excludedKey !== "titan-mauler" && filters.titanMaulerEligible && !isTitanMaulerEligibleEntry(entry)) {
        return false;
    }
    if (excludedKey !== "type" &&
        filters.itemTypes.size > 0 &&
        !filters.itemTypes.has(normalizeIdentifier(entry.itemType))) {
        return false;
    }
    if (excludedKey !== "rarity" &&
        filters.rarities.size > 0 &&
        !filters.rarities.has(normalizeIdentifier(entry.rarity))) {
        return false;
    }
    if (excludedKey !== "source" &&
        filters.publicationSlugs.size > 0 &&
        !filters.publicationSlugs.has(normalizeIdentifier(entry.publicationSlug))) {
        return false;
    }
    if (excludedKey !== "trait" &&
        filters.traits.size > 0 &&
        !entry.traits.some((trait) => filters.traits.has(normalizeIdentifier(trait)))) {
        return false;
    }
    if (excludedKey !== "level" &&
        filters.levelRange &&
        (entry.level < filters.levelRange.minimum || entry.level > filters.levelRange.maximum)) {
        return false;
    }
    if (filters.queryTerms.length === 0)
        return true;
    const searchable = normalizeSearchText([entry.name, entry.itemType, entry.publicationSlug, ...entry.traits].join(" "));
    return filters.queryTerms.every((term) => searchable.includes(term));
}
/**
 * Projects matches and excluded-key facets in one catalogue pass.
 *
 * The older focused helpers below remain useful at their narrow interface and as
 * reference semantics. Runtime browsing uses this deeper projection so each entry's
 * normalized facts and query text are built once per filter change.
 */
export function projectEquipmentCatalogueFilters(input) {
    const { entries, filters } = input;
    const selectedValues = input.selectedValues ?? {};
    const projectedKeys = input.includeTitanMaulerFacet
        ? [...FACET_KEYS, "titan-mauler"]
        : FACET_KEYS;
    const valuesByKey = new Map();
    const countsByKey = new Map();
    const selectedByKey = new Map();
    for (const key of projectedKeys) {
        const selected = normalizedIdentifierSet(selectedValues[key]);
        const values = new Set(selected);
        if (key === "availability")
            values.add("available");
        if (key === "titan-mauler")
            values.add("eligible");
        valuesByKey.set(key, values);
        countsByKey.set(key, new Map());
        selectedByKey.set(key, selected);
    }
    const matchedEntries = [];
    const allLevels = new Set();
    const contextualLevels = new Set();
    for (const entry of entries) {
        const facts = equipmentCatalogueEntryFilterFacts(entry, filters.queryTerms.length > 0);
        allLevels.add(facts.level);
        valuesByKey.get("type")?.add(facts.itemType);
        valuesByKey.get("rarity")?.add(facts.rarity);
        valuesByKey.get("source")?.add(facts.publicationSlug);
        for (const trait of facts.traits)
            valuesByKey.get("trait")?.add(trait);
        const failures = equipmentCatalogueFilterFailures(facts, filters);
        if (failures === 0)
            matchedEntries.push(entry);
        if ((failures & ~FILTER_FAILURE.level) === 0)
            contextualLevels.add(facts.level);
        countProjectedFacetValue("availability", facts.available ? "available" : "unavailable", failures);
        countProjectedFacetValue("type", facts.itemType, failures);
        countProjectedFacetValue("rarity", facts.rarity, failures);
        countProjectedFacetValue("source", facts.publicationSlug, failures);
        for (const trait of facts.traits)
            countProjectedFacetValue("trait", trait, failures);
        if (input.includeTitanMaulerFacet) {
            countProjectedFacetValue("titan-mauler", facts.titanMaulerEligible ? "eligible" : "ineligible", failures);
        }
    }
    const facets = projectedKeys.flatMap((key) => {
        const values = valuesByKey.get(key) ?? new Set();
        const counts = countsByKey.get(key) ?? new Map();
        const selected = selectedByKey.get(key) ?? new Set();
        return [...values]
            .map((value) => ({
            key,
            value,
            label: equipmentCatalogueFacetValueLabel(key, value),
            count: counts.get(value) ?? 0,
        }))
            .filter((option) => option.count > 0 || selected.has(option.value) || key === "availability" || key === "titan-mauler")
            .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
    });
    return Object.freeze({
        matchedEntries: Object.freeze(matchedEntries),
        facets: Object.freeze(facets),
        levelFacet: buildEquipmentCatalogueLevelFacetFromValues(allLevels, contextualLevels, filters.levelRange),
    });
    function countProjectedFacetValue(key, value, failures) {
        const excludedFailure = filterFailureForFacet(key);
        if ((failures & ~excludedFailure) !== 0)
            return;
        const counts = countsByKey.get(key);
        if (!counts)
            return;
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
}
export function rankEquipmentCatalogueMatches(entries, query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
        const available = [];
        const unavailable = [];
        for (const entry of entries)
            (entry.available ? available : unavailable).push(entry);
        return available.concat(unavailable);
    }
    return entries
        .map((entry, index) => ({ entry, index, relevance: catalogueQueryRelevance(entry, normalizedQuery) }))
        .sort((left, right) => Number(right.entry.available) - Number(left.entry.available) ||
        left.relevance - right.relevance ||
        left.index - right.index)
        .map(({ entry }) => entry);
}
export function buildEquipmentCatalogueFacetOptions(entries, filters, key, selectedValues = []) {
    const values = new Set(selectedValues.map((value) => normalizeIdentifier(value)).filter(Boolean));
    if (key === "availability")
        values.add("available");
    else if (key === "titan-mauler")
        values.add("eligible");
    else {
        for (const entry of entries) {
            if (key === "trait")
                for (const trait of entry.traits)
                    values.add(normalizeIdentifier(trait));
            else
                values.add(equipmentCatalogueFilterValue(entry, key));
        }
    }
    const counts = new Map();
    for (const entry of entries) {
        if (!matchesEquipmentCatalogueFilters(entry, filters, key))
            continue;
        const entryValues = key === "trait"
            ? entry.traits.map((trait) => normalizeIdentifier(trait))
            : [equipmentCatalogueFilterValue(entry, key)];
        for (const value of new Set(entryValues))
            counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const normalizedSelected = new Set(selectedValues.map((value) => normalizeIdentifier(value)).filter(Boolean));
    return [...values]
        .map((value) => ({
        key,
        value,
        label: equipmentCatalogueFacetValueLabel(key, value),
        count: counts.get(value) ?? 0,
    }))
        .filter((option) => option.count > 0 || normalizedSelected.has(option.value) || key === "availability" || key === "titan-mauler")
        .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
}
export function buildEquipmentCatalogueLevelFacet(entries, filters) {
    const contextualValues = new Set(entries.filter((entry) => matchesEquipmentCatalogueFilters(entry, filters, "level")).map((entry) => entry.level));
    const allValues = new Set(entries.map((entry) => entry.level));
    return buildEquipmentCatalogueLevelFacetFromValues(allValues, contextualValues, filters.levelRange);
}
function buildEquipmentCatalogueLevelFacetFromValues(allLevelValues, contextualLevelValues, requested) {
    const contextualValues = [...contextualLevelValues].sort((left, right) => left - right);
    const allValues = [...allLevelValues].sort((left, right) => left - right);
    const allMinimum = allValues[0];
    const allMaximum = allValues.at(-1);
    const active = requested !== null &&
        (allMinimum === undefined || requested.minimum > allMinimum || requested.maximum < (allMaximum ?? allMinimum));
    if (contextualValues.length < 2 && !active)
        return null;
    const values = [
        ...new Set([
            ...(contextualValues.length < 2 ? allValues : contextualValues),
            ...(requested ? [requested.minimum, requested.maximum] : []),
        ]),
    ].sort((left, right) => left - right);
    const fullMinimum = allMinimum ?? requested?.minimum;
    const fullMaximum = allMaximum ?? requested?.maximum;
    if (fullMinimum === undefined || fullMaximum === undefined || values.length === 0)
        return null;
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
function equipmentCatalogueEntryFilterFacts(entry, includeSearchText) {
    const cacheable = Object.isFrozen(entry) &&
        Object.isFrozen(entry.traits) &&
        Object.isFrozen(entry.price) &&
        Object.isFrozen(entry.policyDecision);
    const cached = cacheable ? IMMUTABLE_ENTRY_FILTER_FACTS.get(entry) : undefined;
    if (cached && (!includeSearchText || cached.searchable !== null))
        return cached;
    const searchable = includeSearchText
        ? normalizeSearchText([entry.name, entry.itemType, entry.publicationSlug, ...entry.traits].join(" "))
        : null;
    const facts = cached
        ? Object.freeze({ ...cached, searchable })
        : Object.freeze({
            available: entry.available,
            itemType: normalizeIdentifier(entry.itemType),
            level: entry.level,
            publicationSlug: normalizeIdentifier(entry.publicationSlug),
            rarity: normalizeIdentifier(entry.rarity),
            searchable,
            titanMaulerEligible: isTitanMaulerEligibleEntry(entry),
            traits: Object.freeze([...new Set(entry.traits.map((trait) => normalizeIdentifier(trait)))]),
        });
    if (cacheable)
        IMMUTABLE_ENTRY_FILTER_FACTS.set(entry, facts);
    return facts;
}
function equipmentCatalogueFilterFailures(facts, filters) {
    let failures = 0;
    if (filters.policyAvailable && !facts.available)
        failures |= FILTER_FAILURE.availability;
    if (filters.titanMaulerEligible && !facts.titanMaulerEligible)
        failures |= FILTER_FAILURE.titanMauler;
    if (filters.itemTypes.size > 0 && !filters.itemTypes.has(facts.itemType))
        failures |= FILTER_FAILURE.type;
    if (filters.rarities.size > 0 && !filters.rarities.has(facts.rarity))
        failures |= FILTER_FAILURE.rarity;
    if (filters.publicationSlugs.size > 0 && !filters.publicationSlugs.has(facts.publicationSlug)) {
        failures |= FILTER_FAILURE.source;
    }
    if (filters.traits.size > 0 && !facts.traits.some((trait) => filters.traits.has(trait))) {
        failures |= FILTER_FAILURE.trait;
    }
    if (filters.levelRange && (facts.level < filters.levelRange.minimum || facts.level > filters.levelRange.maximum)) {
        failures |= FILTER_FAILURE.level;
    }
    if (filters.queryTerms.length > 0 && !filters.queryTerms.every((term) => facts.searchable?.includes(term))) {
        failures |= FILTER_FAILURE.query;
    }
    return failures;
}
function filterFailureForFacet(key) {
    switch (key) {
        case "availability":
            return FILTER_FAILURE.availability;
        case "rarity":
            return FILTER_FAILURE.rarity;
        case "source":
            return FILTER_FAILURE.source;
        case "titan-mauler":
            return FILTER_FAILURE.titanMauler;
        case "trait":
            return FILTER_FAILURE.trait;
        case "type":
            return FILTER_FAILURE.type;
    }
}
function catalogueQueryRelevance(entry, normalizedQuery) {
    const name = entry.name.trim().toLocaleLowerCase();
    if (name === normalizedQuery)
        return 0;
    if (name.startsWith(normalizedQuery))
        return 1;
    if (name.includes(normalizedQuery))
        return 2;
    return 3;
}
export function isTitanMaulerEligibleEntry(entry) {
    return (entry.available &&
        entry.level === 0 &&
        entry.itemType === "weapon" &&
        !entry.traits.includes("unarmed") &&
        entry.price.kind === "priced" &&
        entry.price.copperValue !== null &&
        entry.price.copperValue <= 900 &&
        entry.price.sourceQuantity === 1 &&
        (entry.rarity === "common" || entry.policyDecision.characterAccessRef !== null));
}
export function equipmentCatalogueSourceLabel(publicationSlug) {
    return humanizeIdentifier(publicationSlug);
}
function equipmentCatalogueFacetValueLabel(key, value) {
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
export function equipmentCatalogueFilterValue(entry, key) {
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
export function normalizeEquipmentCatalogueFilterValues(values) {
    return [...normalizedIdentifierSet(values)];
}
function normalizeDefaultOnMode(values, enabledValue, fallback) {
    if (!values)
        return fallback;
    const normalized = normalizedIdentifierSet(values);
    if (normalized.has("all"))
        return false;
    return normalized.has(enabledValue);
}
function normalizeLevelRange(value) {
    if (!value)
        return null;
    const match = /^(\d+):(\d+)$/.exec(value);
    if (!match)
        return null;
    const minimum = Number(match[1]);
    const maximum = Number(match[2]);
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || minimum > maximum) {
        return null;
    }
    return Object.freeze({ minimum, maximum });
}
function normalizedIdentifierSet(values) {
    return new Set((values ?? [])
        .map((value) => normalizeIdentifier(value))
        .filter((value) => value.length > 0)
        .sort((left, right) => left.localeCompare(right)));
}
function normalizeIdentifier(value) {
    return value.trim().toLowerCase();
}
function tokenize(value) {
    return [...new Set(normalizeSearchText(value).split(" ").filter(Boolean))];
}
function normalizeSearchText(value) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}
function humanizeIdentifier(value) {
    return value.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}
//# sourceMappingURL=equipment-catalogue-filters.js.map