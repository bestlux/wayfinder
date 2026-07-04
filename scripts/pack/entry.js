import { extractDocumentSlug } from "../shared/slug.js";
export function numericOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
export function stringOrNull(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}
export function extractEntrySlug(entry) {
    return extractDocumentSlug(entry);
}
export function extractEntryTraits(entry) {
    return Array.from(new Set([
        ...normalizeTraitList(entry?.system?.traits?.value),
        ...normalizeTraitList(entry?.system?.traits?.otherTags),
    ]));
}
export function resolveFeatType(entry) {
    return stringOrNull(entry?.system?.featType?.value) ?? stringOrNull(entry?.system?.category);
}
export function normalizeTraitList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)));
}
export function namesMatch(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
export function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=entry.js.map