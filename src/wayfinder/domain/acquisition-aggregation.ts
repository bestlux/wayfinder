import type { AcquisitionFunding, AcquisitionLineDraft, AcquisitionPriceSnapshot } from "./acquisition-types.js";

export function acquisitionPreAggregationMaterial(
  line: AcquisitionLineDraft,
  resolvedAllowanceId: string | null
): Record<string, unknown> {
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
    ...(line.kitExpansion ? { kitExpansion: line.kitExpansion } : {}),
  };
}

export function canonicalAcquisitionAggregationKey(material: Record<string, unknown>): string {
  return canonicalJson(material);
}

export function findCurrencyCartAggregationTargets(
  lines: readonly AcquisitionLineDraft[],
  incoming: AcquisitionLineDraft
): readonly AcquisitionLineDraft[] {
  const incomingKey = currencyCartAggregationKey(incoming);
  if (incomingKey === null) return [];
  return lines.filter((line) => currencyCartAggregationKey(line) === incomingKey);
}

export function aggregateRequestedQuantity(prices: readonly AcquisitionPriceSnapshot[]): number {
  let total = 0;
  for (const price of prices) {
    total += price.requestedQuantity;
    if (!Number.isSafeInteger(total)) throw new RangeError("Aggregated acquisition quantity exceeds safe arithmetic.");
  }
  return total;
}

export function acquisitionPriceBasis(price: AcquisitionPriceSnapshot): Record<string, unknown> {
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
    ...(price.configurationComponents ? { configurationComponents: price.configurationComponents } : {}),
  };
}

function fundingMaterial(funding: AcquisitionFunding, resolvedAllowanceId: string | null): Record<string, unknown> {
  return { funding, resolvedAllowanceId };
}

function currencyCartAggregationKey(line: AcquisitionLineDraft): string | null {
  if (
    line.stackingIntent !== "aggregate" ||
    line.funding.lane !== "currency" ||
    line.kitExpansion ||
    line.price.configurationComponents
  ) {
    return null;
  }
  return canonicalAcquisitionAggregationKey(acquisitionPreAggregationMaterial(line, null));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Acquisition aggregation material contains an unsupported value.");
}
