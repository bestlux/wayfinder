const TRADITIONS = ["arcane", "divine", "occult", "primal"];
export function findClassFeatureDocumentByOtherTag(documents, otherTag) {
    const normalized = otherTag.trim().toLowerCase();
    return (documents.find((document) => {
        const tags = document.system?.traits?.otherTags;
        return Array.isArray(tags) && tags.some((tag) => String(tag).trim().toLowerCase() === normalized);
    }) ?? null);
}
export function parseTraditionFromClassFeatureDocument(document, fallback) {
    const description = String(document?.system?.description?.value ?? "").toLowerCase();
    const proficiencies = document?.system?.proficiencies;
    const alias = String(proficiencies?.aliases?.witch ?? "").toLowerCase();
    for (const tradition of TRADITIONS) {
        if (alias === tradition) {
            return tradition;
        }
        if (description.includes(`<strong>spell list</strong> ${tradition}`) ||
            description.includes(`<strong>tradition</strong> ${tradition}`) ||
            description.includes(`spell list</strong> ${tradition}`) ||
            description.includes(`tradition</strong> ${tradition}`)) {
            return tradition;
        }
    }
    return fallback;
}
//# sourceMappingURL=tradition-utils.js.map