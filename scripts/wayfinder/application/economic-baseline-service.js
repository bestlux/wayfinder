import { MODULE_ID } from "../../constants.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { createEconomicBaseline, evaluateEconomicAdmission, executeWithEconomicBaselineRevalidation, normalizeAcquisitionIdentity, } from "../domain/economic-baseline.js";
export function captureActorEconomicBaseline(actor, options = {}) {
    if (typeof actor.id !== "string" || actor.id.trim().length === 0) {
        throw new TypeError("Economic baseline capture requires an actor ID.");
    }
    const currencyCopper = actor.inventory?.currency?.copperValue ?? actor.inventory?.coins?.copperValue;
    if (!Number.isSafeInteger(currencyCopper) || currencyCopper < 0) {
        throw new TypeError("PF2E actor currency is missing or malformed.");
    }
    const physicalItems = [];
    let validatedCurrencyCopper = 0;
    for (const { item, parentItemId } of actorItems(actor)) {
        if (typeof item.isOfType !== "function") {
            throw new TypeError("PF2E physical item classification is unavailable.");
        }
        if (!item.isOfType("physical"))
            continue;
        const quantity = validatedQuantity(item);
        if (parentItemId === null && isCurrencyItem(item)) {
            validateCurrencySource(item);
            const assetCopper = item.assetValue?.copperValue;
            if (!Number.isSafeInteger(assetCopper) || assetCopper < 0) {
                throw new TypeError("A PF2E currency item has an invalid effective value.");
            }
            validatedCurrencyCopper = safeCopperAdd(validatedCurrencyCopper, assetCopper);
            continue;
        }
        if (typeof item.id !== "string" || item.id.trim().length === 0 || typeof item.type !== "string") {
            throw new TypeError("A PF2E physical item is missing its stable identity.");
        }
        const containerId = parentItemId ?? validatedContainerId(item);
        const rawAcquisitionIdentity = item.flags?.[MODULE_ID]?.acquisition;
        const acquisitionIdentity = normalizeAcquisitionIdentity(rawAcquisitionIdentity);
        if (rawAcquisitionIdentity !== undefined && rawAcquisitionIdentity !== null && !acquisitionIdentity) {
            throw new TypeError(`PF2E physical item ${item.id} has a malformed Wayfinder acquisition identity.`);
        }
        physicalItems.push({
            itemId: item.id,
            type: item.type,
            sourceUuid: sourceIdOf(item),
            quantity,
            containerId,
            acquisitionIdentity,
        });
    }
    if (validatedCurrencyCopper !== currencyCopper) {
        throw new TypeError("PF2E raw currency documents disagree with the actor's effective currency total.");
    }
    validateContainerGraph(physicalItems);
    return createEconomicBaseline({
        actorId: actor.id,
        capturedAt: options.capturedAt ?? new Date().toISOString(),
        currencyCopper: currencyCopper,
        physicalItems,
    });
}
export function evaluateActorEconomicAdmission(args) {
    return evaluateEconomicAdmission({
        baseline: captureActorEconomicBaseline(args.actor, { capturedAt: args.capturedAt }),
        draftId: args.draftId,
        batchId: args.batchId,
        targetLevel: args.targetLevel,
        higherLevelStartEvidence: args.higherLevelStartEvidence,
        history: args.history,
        retryExpectation: args.retryExpectation,
        unresolvedClassGrantItemIds: args.unresolvedClassGrantItemIds,
        ambiguousClassGrantItemIds: args.ambiguousClassGrantItemIds,
    });
}
export function executeWithActorEconomicBaselineRevalidation(args) {
    return executeWithEconomicBaselineRevalidation({
        reviewed: args.reviewed,
        captureCurrent: () => captureActorEconomicBaseline(args.actor, { capturedAt: args.capturedAt?.() ?? new Date().toISOString() }),
        write: args.write,
    });
}
function actorItems(actor) {
    const items = actor.items;
    const contents = Array.isArray(items)
        ? items
        : items?.contents;
    if (!Array.isArray(contents))
        throw new TypeError("PF2E actor item collection is unavailable.");
    const entries = [];
    const visited = new Set();
    const visit = (item, parentItemId) => {
        if (visited.has(item))
            throw new TypeError("PF2E actor item nesting contains a cycle.");
        visited.add(item);
        entries.push({ item, parentItemId });
        const subitems = item.subitems;
        const nested = Array.isArray(subitems)
            ? subitems
            : subitems?.contents;
        if (nested !== undefined && !Array.isArray(nested)) {
            throw new TypeError("PF2E physical subitem collection is malformed.");
        }
        const itemId = typeof item.id === "string" && item.id.length > 0 ? item.id : null;
        if ((nested?.length ?? 0) > 0 && !itemId) {
            throw new TypeError("A PF2E item with nested physical documents is missing its stable identity.");
        }
        for (const child of nested ?? [])
            visit(child, itemId);
    };
    for (const item of contents)
        visit(item, null);
    return entries;
}
function isCurrencyItem(item) {
    if (!item.isOfType?.("treasure"))
        return false;
    if (typeof item.isCurrency === "boolean")
        return item.isCurrency;
    return item.system?.category === "coin" || item.system?.category === "credstick" || item.system?.slug === "upb";
}
function validatedQuantity(item) {
    const prepared = item.quantity ?? item.system?.quantity;
    const raw = item._source?.system?.quantity;
    if (!Number.isSafeInteger(prepared) ||
        prepared < 0 ||
        !Number.isSafeInteger(raw) ||
        raw < 0 ||
        prepared !== raw) {
        throw new TypeError(`PF2E physical item ${String(item.id ?? "unknown")} has an invalid quantity.`);
    }
    return prepared;
}
function validatedContainerId(item) {
    const raw = item._source?.system?.containerId ?? null;
    const prepared = item.system?.containerId ?? null;
    const related = item.container?.id ?? null;
    if ((raw !== null && typeof raw !== "string") ||
        (prepared !== null && typeof prepared !== "string") ||
        (related !== null && typeof related !== "string") ||
        raw !== prepared ||
        (related !== null && related !== raw)) {
        throw new TypeError(`PF2E physical item ${String(item.id ?? "unknown")} has an invalid container link.`);
    }
    return raw;
}
function validateCurrencySource(item) {
    const price = item._source?.system?.price;
    if (!price || !isRecord(price.value)) {
        throw new TypeError("A PF2E currency item has a missing raw price.");
    }
    for (const value of Object.values(price.value)) {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError("A PF2E currency item has a malformed raw price.");
        }
    }
    if (price.per !== undefined && (!Number.isSafeInteger(price.per) || price.per < 1)) {
        throw new TypeError("A PF2E currency item has a malformed price unit.");
    }
}
function validateContainerGraph(items) {
    const byId = new Map(items.map((item) => [item.itemId, item]));
    if (byId.size !== items.length)
        throw new TypeError("The PF2E actor has duplicate physical item IDs.");
    for (const item of items) {
        const visited = new Set([item.itemId]);
        let containerId = item.containerId;
        while (containerId !== null) {
            const container = byId.get(containerId);
            if (!container)
                throw new TypeError(`PF2E physical item ${item.itemId} has a dangling container link.`);
            if (visited.has(containerId))
                throw new TypeError(`PF2E physical item ${item.itemId} has a cyclic container link.`);
            visited.add(containerId);
            containerId = container.containerId;
        }
    }
}
function safeCopperAdd(left, right) {
    const value = left + right;
    if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError("PF2E currency exceeds the safe copper range.");
    return value;
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=economic-baseline-service.js.map