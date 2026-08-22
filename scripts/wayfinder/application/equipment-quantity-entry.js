/**
 * Converts the cart's player-facing materialized quantity into the absolute
 * requested quantity owned by the acquisition command service.
 */
export function parseMaterializedEquipmentQuantity(rawValue, sourceQuantity) {
    if (!Number.isSafeInteger(sourceQuantity) || sourceQuantity < 1) {
        throw new TypeError("Starting-equipment source quantity must be a positive integer.");
    }
    const maximum = Math.floor(Number.MAX_SAFE_INTEGER / sourceQuantity) * sourceQuantity;
    const materializedQuantity = Number(rawValue);
    if (!rawValue.trim() ||
        !Number.isSafeInteger(materializedQuantity) ||
        materializedQuantity < sourceQuantity ||
        materializedQuantity > maximum) {
        return { ok: false, reason: "invalid-integer", minimum: sourceQuantity, maximum };
    }
    if (materializedQuantity % sourceQuantity !== 0) {
        return { ok: false, reason: "invalid-stack-multiple", multiple: sourceQuantity };
    }
    return { ok: true, requestedQuantity: materializedQuantity / sourceQuantity };
}
//# sourceMappingURL=equipment-quantity-entry.js.map