function stringOrNull(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function normalizedSlug(value) {
    const rawValue = stringOrNull(value);
    return rawValue ? slugifyName(rawValue) : null;
}
export function slugifyName(value) {
    const name = stringOrNull(value);
    if (!name) {
        return null;
    }
    return (name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || null);
}
export function extractDocumentSlug(document) {
    const slugDocument = document;
    return (normalizedSlug(slugDocument?.slug) ??
        normalizedSlug(slugDocument?.system?.slug) ??
        normalizedSlug(slugDocument?.system?.ancestry?.slug) ??
        slugifyName(slugDocument?.name));
}
//# sourceMappingURL=slug.js.map