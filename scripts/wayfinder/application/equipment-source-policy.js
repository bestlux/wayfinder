export const CORE_EQUIPMENT_PACK_ID = "pf2e.equipment-srd";
/**
 * Projects only the packs PF2E classified for its equipment browser tab. The raw
 * world setting is deliberately not a discovery source: stale or malformed
 * setting keys must not turn an adjacent feat/spell pack into equipment.
 */
export function discoverInstalledEquipmentPackDescriptors(input) {
    const installed = new Map();
    for (const value of collectionValues(input.packs)) {
        const pack = record(value);
        const metadata = record(pack.metadata);
        const id = nonEmpty(pack.collection) ? pack.collection.trim() : nonEmpty(metadata.id) ? metadata.id.trim() : "";
        if (id)
            installed.set(id, pack);
    }
    const equipment = record(input.pf2eEquipmentPacks);
    const ids = new Set(Object.keys(equipment).filter(nonEmpty));
    if (installed.has(CORE_EQUIPMENT_PACK_ID))
        ids.add(CORE_EQUIPMENT_PACK_ID);
    return [...ids]
        .sort((left, right) => left.localeCompare(right))
        .flatMap((id) => {
        const pack = installed.get(id);
        if (!pack)
            return [];
        const metadata = record(pack.metadata);
        const browser = record(equipment[id]);
        const family = packFamily(id);
        const label = firstNonEmpty(browser.name, metadata.label, id);
        const packageName = firstNonEmpty(browser.package, metadata.packageName, family);
        const documentName = firstNonEmpty(pack.documentName, metadata.type) || null;
        return [{ id, family, label, packageName, documentName }];
    });
}
export function normalizePf2eEquipmentSources(input) {
    const packRoot = record(input.compendiumBrowserPacks);
    const rawEquipment = record(packRoot.equipment);
    const families = new Set(input.allowedPackFamilies.map(packFamily).filter(nonEmpty));
    const diagnostics = [];
    const effectivePackIds = [];
    const descriptors = new Map();
    for (const descriptor of [...input.installedEquipmentPacks].sort((left, right) => left.id.localeCompare(right.id))) {
        if (!nonEmpty(descriptor.id) || descriptors.has(descriptor.id))
            continue;
        descriptors.set(descriptor.id, descriptor);
        if (!families.has(packFamily(descriptor.id)))
            continue;
        if (record(rawEquipment[descriptor.id]).load === false)
            continue;
        if (descriptor.documentName !== null && descriptor.documentName !== "Item") {
            diagnostics.push(sourceDiagnostic("equipment-pack-not-item", descriptor.id, null, `Equipment pack ${descriptor.id} is not an Item compendium and was excluded.`));
            continue;
        }
        effectivePackIds.push(descriptor.id);
    }
    // Raw equipment entries can outlive an uninstalled package. Report enabled,
    // allowed stale entries, but never treat entries from another PF2E tab as equipment.
    for (const packId of Object.keys(rawEquipment).sort((left, right) => left.localeCompare(right))) {
        if (!nonEmpty(packId) || descriptors.has(packId) || !families.has(packFamily(packId)))
            continue;
        if (record(rawEquipment[packId]).load === false)
            continue;
        diagnostics.push(sourceDiagnostic("equipment-pack-missing", packId, null, `Enabled equipment pack ${packId} is not installed or is unavailable to the current user.`));
    }
    const sourceRoot = record(input.compendiumBrowserSources);
    const sources = record(sourceRoot.sources);
    const knownSourceSlugs = Object.keys(sources).sort((left, right) => left.localeCompare(right));
    const enabledSourceSlugs = Object.entries(sources)
        .filter(([, value]) => record(value).load !== false)
        .map(([slug]) => slug)
        .sort((left, right) => left.localeCompare(right));
    return {
        effectivePackIds: uniqueSorted(effectivePackIds),
        enabledSourceSlugs,
        knownSourceSlugs,
        showEmptySources: sourceRoot.showEmptySources === true,
        showUnknownSources: sourceRoot.showUnknownSources === true,
        diagnostics: sortEquipmentSourceDiagnostics(diagnostics),
    };
}
export function sourceDiagnostic(code, packId, sourceIdentity, message) {
    return Object.freeze({ code, packId, sourceIdentity, message });
}
export function sortEquipmentSourceDiagnostics(diagnostics) {
    return [...diagnostics].sort((left, right) => left.packId.localeCompare(right.packId) ||
        (left.sourceIdentity ?? "").localeCompare(right.sourceIdentity ?? "") ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message));
}
function collectionValues(value) {
    if (Array.isArray(value))
        return value;
    const values = record(value).values;
    if (typeof values !== "function")
        return [];
    try {
        return [...values.call(value)];
    }
    catch {
        return [];
    }
}
function packFamily(value) {
    return (value.split(".")[0] ?? value).trim().toLowerCase();
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function firstNonEmpty(...values) {
    return values.find(nonEmpty)?.trim() ?? "";
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
//# sourceMappingURL=equipment-source-policy.js.map