export function acquisitionPreAggregationMaterial(line, resolvedAllowanceId) {
    return {
        version: 1,
        sourceUuid: line.sourceUuid,
        documentFingerprint: line.documentFingerprint,
        priceFingerprint: line.priceFingerprint,
        itemLevel: line.itemLevel,
        permanence: line.permanence,
        componentKind: line.componentKind,
        policyDecision: line.policyDecision,
        funding: fundingMaterial(line.funding, resolvedAllowanceId),
        stackingIntent: line.stackingIntent,
        priceBasis: acquisitionPriceBasis(line.price),
        separateLineId: line.stackingIntent === "separate" ? line.lineId : null,
        plannedContainerId: null,
    };
}
export function canonicalAcquisitionAggregationKey(material) {
    return canonicalJson(material);
}
export function aggregateRequestedQuantity(prices) {
    let total = 0;
    for (const price of prices) {
        total += price.requestedQuantity;
        if (!Number.isSafeInteger(total))
            throw new RangeError("Aggregated acquisition quantity exceeds safe arithmetic.");
    }
    return total;
}
export function acquisitionPriceBasis(price) {
    return {
        basePrice: price.basePrice,
        size: price.size,
        sizeSensitive: price.sizeSensitive,
        preciousMaterial: price.preciousMaterial,
        adjustedBulkPriceCopper: price.adjustedBulkPriceCopper,
        configurationPriceCopper: price.configurationPriceCopper,
        pricePer: price.pricePer,
        sourceQuantity: price.sourceQuantity,
        unitPriceCopper: price.unitPriceCopper,
    };
}
function fundingMaterial(funding, resolvedAllowanceId) {
    return { funding, resolvedAllowanceId };
}
function canonicalJson(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object") {
        const record = value;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(",")}}`;
    }
    throw new TypeError("Acquisition aggregation material contains an unsupported value.");
}
//# sourceMappingURL=acquisition-aggregation.js.map