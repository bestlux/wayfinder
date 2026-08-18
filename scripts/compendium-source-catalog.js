import { OFFICIAL_PACKS } from "./constants.js";
import { expandCompendiumAllowlist, parseCompendiumAllowlist } from "./source-filter.js";
export const COMPENDIUM_COUNT_FIELDS = ["type", "system.category", "system.featType.value"];
const OFFICIAL_PACK_IDS = new Set(Object.values(OFFICIAL_PACKS).flat());
export function emptyCompendiumContentCounts() {
    return {
        totalItems: 0,
        relevantTotal: 0,
        ancestry: 0,
        heritage: 0,
        background: 0,
        class: 0,
        deity: 0,
        feats: 0,
        ancestryFeats: 0,
        classFeats: 0,
        skillFeats: 0,
        generalFeats: 0,
        classFeatures: 0,
        spells: 0,
        other: 0,
    };
}
export function classifyCompendiumEntries(entries) {
    const counts = emptyCompendiumContentCounts();
    for (const entry of entries) {
        counts.totalItems += 1;
        const type = normalizedIdentifier(entry?.type);
        switch (type) {
            case "ancestry":
                counts.ancestry += 1;
                break;
            case "heritage":
                counts.heritage += 1;
                break;
            case "background":
                counts.background += 1;
                break;
            case "class":
                counts.class += 1;
                break;
            case "deity":
                counts.deity += 1;
                break;
            case "spell":
                counts.spells += 1;
                break;
            case "feat": {
                counts.feats += 1;
                const featType = normalizedIdentifier(entry.system?.category) ?? normalizedIdentifier(entry.system?.featType?.value);
                if (featType === "ancestry")
                    counts.ancestryFeats += 1;
                if (featType === "class" || featType === "archetype")
                    counts.classFeats += 1;
                if (featType === "skill")
                    counts.skillFeats += 1;
                if (featType === "general")
                    counts.generalFeats += 1;
                if (featType === "classfeature")
                    counts.classFeatures += 1;
                break;
            }
        }
    }
    counts.relevantTotal =
        counts.ancestry + counts.heritage + counts.background + counts.class + counts.deity + counts.feats + counts.spells;
    counts.other = Math.max(0, counts.totalItems - counts.relevantTotal);
    return counts;
}
export function discoverItemCompendia() {
    const globals = globalThis;
    const packs = globals.game?.packs;
    if (!packs)
        return [];
    return Array.from(packs.entries())
        .filter(([, pack]) => isItemCompendium(pack))
        .map(([id, pack]) => {
        const packageId = stringOrNull(pack.metadata?.packageName) ?? id.split(".")[0] ?? id;
        return {
            id,
            title: stringOrNull(pack.title) ?? stringOrNull(pack.metadata?.label) ?? id,
            packageId,
            packageTitle: packageTitle(packageId, globals),
            official: OFFICIAL_PACK_IDS.has(id),
            status: "pending",
            counts: emptyCompendiumContentCounts(),
        };
    })
        .sort(compareCatalogRows);
}
export async function scanCompendiumCatalog(rows, concurrency = 5) {
    const globals = globalThis;
    const result = rows.map((row) => ({ ...row, counts: { ...row.counts } }));
    let nextIndex = 0;
    const requestedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
    const workerCount = Math.max(1, Math.min(requestedConcurrency, result.length || 1));
    async function scanNext() {
        while (nextIndex < result.length) {
            const index = nextIndex;
            nextIndex += 1;
            const row = result[index];
            if (!row)
                continue;
            const pack = globals.game?.packs?.get(row.id);
            if (!pack) {
                row.status = "error";
                continue;
            }
            try {
                const entries = await pack.getIndex({ fields: [...COMPENDIUM_COUNT_FIELDS] });
                row.counts = classifyCompendiumEntries(entries ?? []);
                row.status = "ready";
            }
            catch (_error) {
                row.status = "error";
            }
        }
    }
    await Promise.all(Array.from({ length: workerCount }, () => scanNext()));
    return result;
}
export function resolveCompendiumSelection(raw, availablePackIds) {
    const tokens = Array.from(new Set(parseCompendiumAllowlist(raw)));
    const available = new Set(availablePackIds);
    const legacyPatterns = tokens.filter((token) => token.includes("*"));
    const exactIds = tokens.filter((token) => !token.includes("*"));
    const expanded = expandCompendiumAllowlist(tokens, availablePackIds);
    return {
        selectedIds: expanded.filter((id) => available.has(id)),
        unavailableExactIds: exactIds.filter((id) => !available.has(id)),
        legacyPatterns,
        unmatchedLegacyPatterns: legacyPatterns.filter((pattern) => expandCompendiumAllowlist([pattern], availablePackIds).length === 0),
        hasGlobalWildcard: legacyPatterns.includes("*"),
    };
}
export function serializeCompendiumSelection(ids, preservedLegacyPatterns = []) {
    const exactIds = Array.from(ids)
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && !id.includes("*") && !OFFICIAL_PACK_IDS.has(id));
    const legacyPatterns = Array.from(preservedLegacyPatterns)
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.includes("*"));
    return Array.from(new Set([...exactIds, ...legacyPatterns]))
        .sort((left, right) => left.localeCompare(right))
        .join(", ");
}
export function findUnavailableSelectedCompendiumIds(selectedIds, availablePackIds) {
    const available = new Set(availablePackIds);
    return Array.from(new Set(selectedIds))
        .filter((id) => !isOfficialCompendium(id) && !available.has(id))
        .sort((left, right) => left.localeCompare(right));
}
export function isOfficialCompendium(packId) {
    return OFFICIAL_PACK_IDS.has(packId);
}
function isItemCompendium(pack) {
    const documentName = normalizedIdentifier(pack.documentName) ?? normalizedIdentifier(pack.metadata?.type);
    return documentName === "item";
}
function packageTitle(packageId, globals) {
    const moduleTitle = stringOrNull(globals.game?.modules?.get(packageId)?.title);
    if (moduleTitle)
        return moduleTitle;
    if (normalizedIdentifier(globals.game?.system?.id) === packageId.toLowerCase()) {
        return stringOrNull(globals.game?.system?.title) ?? packageId;
    }
    return packageId === "world" ? "World" : packageId;
}
function compareCatalogRows(left, right) {
    if (left.official !== right.official)
        return left.official ? -1 : 1;
    return (left.packageTitle.localeCompare(right.packageTitle) ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id));
}
function stringOrNull(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
function normalizedIdentifier(value) {
    return stringOrNull(value)?.toLowerCase() ?? null;
}
//# sourceMappingURL=compendium-source-catalog.js.map