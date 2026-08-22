import { enrichHtml } from "../../shared/foundry-compat.js";
export function createEquipmentPreviewProjector(options = {}) {
    const enrich = options.enrich ?? enrichHtml;
    let cached = null;
    return {
        async project(preview) {
            const fields = previewSourceFields(preview.source);
            if (!fields)
                return null;
            const fieldsIdentity = JSON.stringify(fields);
            if (cached?.sourceUuid === preview.sourceUuid &&
                cached.previewIdentity === preview.previewIdentity &&
                cached.fieldsIdentity === fieldsIdentity) {
                return cached.value;
            }
            let description;
            try {
                const enriched = await enrich(fields.description, { async: true });
                if (typeof enriched !== "string")
                    return null;
                description = enriched;
            }
            catch {
                // Never fall back to rendering un-enriched compendium HTML.
                return null;
            }
            const value = Object.freeze({
                sourceUuid: preview.sourceUuid,
                description,
                bulkLabel: fields.bulk === null ? null : formatBulk(fields.bulk),
                handsLabel: fields.usage === null ? null : handsForUsage(fields.usage),
            });
            cached = { sourceUuid: preview.sourceUuid, previewIdentity: preview.previewIdentity, fieldsIdentity, value };
            return value;
        },
    };
}
function previewSourceFields(source) {
    if (!source)
        return null;
    const system = record(source.system);
    if (!system)
        return null;
    const description = optionalNestedValue(system, "description", isString);
    const bulk = optionalNestedValue(system, "bulk", isBulk);
    const usage = optionalNestedValue(system, "usage", isString);
    if (!description.valid || !bulk.valid || !usage.valid)
        return null;
    return {
        description: description.value ?? "",
        bulk: bulk.value,
        usage: usage.value,
    };
}
function optionalNestedValue(parent, key, validate) {
    const nestedValue = parent[key];
    if (nestedValue === undefined)
        return { valid: true, value: null };
    const nested = record(nestedValue);
    if (!nested || !("value" in nested) || !validate(nested.value))
        return { valid: false };
    return { valid: true, value: nested.value };
}
function formatBulk(value) {
    const normal = Math.floor(value);
    const light = Math.round((value - normal) * 10);
    if (value === 0)
        return "—";
    if (light === 0)
        return String(normal);
    if (normal === 0 && light === 1)
        return "L";
    if (normal === 0)
        return `${light}L`;
    return `${normal}; ${light}L`;
}
function handsForUsage(usage) {
    switch (usage) {
        case "held-in-one-hand":
            return "1";
        case "held-in-one-plus-hands":
            return "1+";
        case "held-in-one-or-two-hands":
            return "1–2";
        case "held-in-two-hands":
            return "2";
        default:
            return null;
    }
}
function isBulk(value) {
    return (typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        Math.abs(value * 10 - Math.round(value * 10)) < Number.EPSILON);
}
function isString(value) {
    return typeof value === "string";
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
//# sourceMappingURL=equipment-preview-projector.js.map