export const EQUIPMENT_CATALOGUE_FILTER_KEYS = [
    "availability",
    "level",
    "rarity",
    "source",
    "titan-mauler",
    "trait",
    "type",
];
export function normalizeEquipmentCatalogueFilters(input) {
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
        titanMaulerEligible: normalizeDefaultOnMode(filters["titan-mauler"], "eligible", defaults.titanMaulerEligible === true),
    });
}
export function matchesEquipmentCatalogueFilters(entry, filters, excludedKey) {
    if (excludedKey !== "availability" && filters.policyAvailable && !entry.available)
        return false;
    if (excludedKey !== "titan-mauler" && filters.titanMaulerEligible && !isTitanMaulerEligibleEntry(entry)) {
        return false;
    }
    if (excludedKey !== "type" && filters.itemTypes.size > 0 && !filters.itemTypes.has(entry.itemType))
        return false;
    if (excludedKey !== "rarity" && filters.rarities.size > 0 && !filters.rarities.has(entry.rarity))
        return false;
    if (excludedKey !== "source" &&
        filters.publicationSlugs.size > 0 &&
        !filters.publicationSlugs.has(entry.publicationSlug)) {
        return false;
    }
    if (excludedKey !== "trait" && filters.traits.size > 0 && !entry.traits.some((trait) => filters.traits.has(trait))) {
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
export function buildEquipmentCatalogueFacetOptions(entries, filters, key, selectedValues = []) {
    const values = new Set(selectedValues.map((value) => normalizeSearchText(value)).filter(Boolean));
    if (key === "availability")
        values.add("available");
    else if (key === "titan-mauler")
        values.add("eligible");
    else {
        for (const entry of entries) {
            if (key === "trait")
                for (const trait of entry.traits)
                    values.add(trait);
            else
                values.add(equipmentCatalogueFilterValue(entry, key));
        }
    }
    const counts = new Map();
    for (const entry of entries) {
        if (!matchesEquipmentCatalogueFilters(entry, filters, key))
            continue;
        const entryValues = key === "trait" ? entry.traits : [equipmentCatalogueFilterValue(entry, key)];
        for (const value of new Set(entryValues))
            counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const normalizedSelected = new Set(selectedValues.map((value) => normalizeSearchText(value)).filter(Boolean));
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
    const values = [
        ...new Set(entries.filter((entry) => matchesEquipmentCatalogueFilters(entry, filters, "level")).map((entry) => entry.level)),
    ].sort((left, right) => left - right);
    if (values.length < 2)
        return null;
    const fullMinimum = values[0];
    const fullMaximum = values.at(-1);
    const minimum = filters.levelRange
        ? (values.find((value) => value >= filters.levelRange.minimum) ?? fullMaximum)
        : fullMinimum;
    const maximumCandidate = filters.levelRange
        ? ([...values].reverse().find((value) => value <= filters.levelRange.maximum) ?? fullMinimum)
        : fullMaximum;
    const maximum = Math.max(minimum, maximumCandidate);
    return Object.freeze({
        values: Object.freeze(values),
        minimum,
        maximum,
        fullMinimum,
        fullMaximum,
        active: minimum !== fullMinimum || maximum !== fullMaximum,
    });
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
export function normalizeEquipmentCatalogueFilterValues(values) {
    return [...normalizedSet(values)];
}
function normalizeDefaultOnMode(values, enabledValue, fallback) {
    if (!values)
        return fallback;
    if (values.includes("all"))
        return false;
    return values.includes(enabledValue);
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
function normalizedSet(values) {
    return new Set((values ?? [])
        .map((value) => normalizeSearchText(value))
        .filter((value) => value.length > 0)
        .sort((left, right) => left.localeCompare(right)));
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