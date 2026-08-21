import { MODULE_ID } from "../../constants.js";
import { sourceIdOf } from "../../shared/source-id.js";
import {
  type ClassGrantReconciliationResultV1,
  type PreparedClassGrantPlanV1,
  reconcilePreparedClassGrants,
} from "../domain/class-grant-reconciliation.js";
import {
  createEconomicBaseline,
  type EconomicAdmissionResult,
  type EconomicBaselineDifference,
  type EconomicBaselineV1,
  type EconomicHistoryFacts,
  type EconomicRetryExpectation,
  evaluateEconomicAdmission,
  executeWithEconomicBaselineRevalidation,
  normalizeAcquisitionIdentity,
} from "../domain/economic-baseline.js";
import type { EquipmentHigherLevelStartEvidence } from "../domain/equipment-policy.js";
import { captureObservedClassGrantItems } from "./class-grant-projection-service.js";

interface PhysicalItemLike {
  id?: unknown;
  type?: unknown;
  quantity?: unknown;
  isTemporary?: unknown;
  isCurrency?: unknown;
  assetValue?: { copperValue?: unknown };
  isOfType?: (...types: string[]) => boolean;
  container?: { id?: unknown } | null;
  sourceId?: unknown;
  flags?: Record<string, unknown> & {
    core?: { sourceId?: unknown };
    [MODULE_ID]?: { acquisition?: unknown };
  };
  _stats?: { compendiumSource?: unknown };
  _source?: {
    system?: {
      quantity?: unknown;
      containerId?: unknown;
      price?: { value?: unknown; per?: unknown };
    };
  };
  subitems?: { contents?: readonly PhysicalItemLike[] } | readonly PhysicalItemLike[];
  system?: {
    quantity?: unknown;
    containerId?: unknown;
    category?: unknown;
    slug?: unknown;
    temporary?: unknown;
  };
}

export interface EconomicActorLike {
  id?: unknown;
  inventory?: { currency?: { copperValue?: unknown }; coins?: { copperValue?: unknown } };
  items?: { contents?: readonly PhysicalItemLike[] } | readonly PhysicalItemLike[];
}

export function captureActorEconomicBaseline(
  actor: EconomicActorLike,
  options: { capturedAt?: string } = {}
): EconomicBaselineV1 {
  if (typeof actor.id !== "string" || actor.id.trim().length === 0) {
    throw new TypeError("Economic baseline capture requires an actor ID.");
  }
  const currencyCopper = actor.inventory?.currency?.copperValue ?? actor.inventory?.coins?.copperValue;
  if (!Number.isSafeInteger(currencyCopper) || (currencyCopper as number) < 0) {
    throw new TypeError("PF2E actor currency is missing or malformed.");
  }
  const physicalItems = [];
  let validatedCurrencyCopper = 0;
  for (const { item, parentItemId } of actorItems(actor)) {
    if (typeof item.isOfType !== "function") {
      throw new TypeError("PF2E physical item classification is unavailable.");
    }
    if (!item.isOfType("physical")) continue;
    if (isTemporaryPhysicalItem(item)) continue;
    const quantity = validatedQuantity(item);
    if (parentItemId === null && isCurrencyItem(item)) {
      validateCurrencySource(item);
      const assetCopper = item.assetValue?.copperValue;
      if (!Number.isSafeInteger(assetCopper) || (assetCopper as number) < 0) {
        throw new TypeError("A PF2E currency item has an invalid effective value.");
      }
      validatedCurrencyCopper = safeCopperAdd(validatedCurrencyCopper, assetCopper as number);
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
    currencyCopper: currencyCopper as number,
    physicalItems,
  });
}

function isTemporaryPhysicalItem(item: PhysicalItemLike): boolean {
  const prepared = item.isTemporary;
  const system = item.system?.temporary;
  if (prepared !== undefined && typeof prepared !== "boolean") {
    throw new TypeError("A PF2E physical item has malformed temporary-item classification.");
  }
  if (system !== undefined && typeof system !== "boolean") {
    throw new TypeError("A PF2E physical item has malformed prepared temporary state.");
  }
  if (prepared !== undefined && system !== undefined && prepared !== system) {
    throw new TypeError("A PF2E physical item's temporary-item classification disagrees with its prepared state.");
  }
  // PF2E materializes some class resources, including Alchemist Versatile Vials,
  // as explicit temporary physical documents. They are usable inventory, but not
  // durable character wealth. Source identity, zero Price, and the infused trait
  // alone are insufficient: only PF2E's prepared temporary classification excludes
  // the document from economic admission.
  return prepared === true;
}

export function evaluateActorEconomicAdmission(args: {
  actor: EconomicActorLike;
  draftId: string;
  batchId: string;
  targetLevel: number;
  higherLevelStartEvidence: EquipmentHigherLevelStartEvidence;
  history: EconomicHistoryFacts;
  retryExpectation?: EconomicRetryExpectation | null;
  preparedClassGrantPlan: PreparedClassGrantPlanV1;
  classGrantPhase: ClassGrantReconciliationResultV1["phase"];
  capturedAt?: string;
}): EconomicAdmissionResult {
  const classGrantReconciliation = reconcilePreparedClassGrants({
    plan: args.preparedClassGrantPlan,
    actorItems: captureObservedClassGrantItems(args.actor),
    phase: args.classGrantPhase,
  });
  return evaluateEconomicAdmission({
    baseline: captureActorEconomicBaseline(args.actor, { capturedAt: args.capturedAt }),
    draftId: args.draftId,
    batchId: args.batchId,
    targetLevel: args.targetLevel,
    higherLevelStartEvidence: args.higherLevelStartEvidence,
    history: args.history,
    retryExpectation: args.retryExpectation,
    classGrantReconciliation,
    preparedClassGrantPlan: args.preparedClassGrantPlan,
  });
}

export function executeWithActorEconomicBaselineRevalidation<T>(args: {
  actor: EconomicActorLike;
  reviewed: EconomicBaselineV1;
  capturedAt?: () => string;
  write: () => T | Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false; differences: readonly EconomicBaselineDifference[] }> {
  return executeWithEconomicBaselineRevalidation({
    reviewed: args.reviewed,
    captureCurrent: () =>
      captureActorEconomicBaseline(args.actor, { capturedAt: args.capturedAt?.() ?? new Date().toISOString() }),
    write: args.write,
  });
}

function actorItems(actor: EconomicActorLike): readonly { item: PhysicalItemLike; parentItemId: string | null }[] {
  const items = actor.items;
  const contents = Array.isArray(items)
    ? (items as readonly PhysicalItemLike[])
    : (items as { contents?: readonly PhysicalItemLike[] } | undefined)?.contents;
  if (!Array.isArray(contents)) throw new TypeError("PF2E actor item collection is unavailable.");
  const entries: { item: PhysicalItemLike; parentItemId: string | null }[] = [];
  const visited = new Set<PhysicalItemLike>();
  const visit = (item: PhysicalItemLike, parentItemId: string | null): void => {
    if (visited.has(item)) throw new TypeError("PF2E actor item nesting contains a cycle.");
    visited.add(item);
    entries.push({ item, parentItemId });
    const subitems = item.subitems;
    const nested = Array.isArray(subitems)
      ? (subitems as readonly PhysicalItemLike[])
      : (subitems as { contents?: readonly PhysicalItemLike[] } | undefined)?.contents;
    if (nested !== undefined && !Array.isArray(nested)) {
      throw new TypeError("PF2E physical subitem collection is malformed.");
    }
    const itemId = typeof item.id === "string" && item.id.length > 0 ? item.id : null;
    if ((nested?.length ?? 0) > 0 && !itemId) {
      throw new TypeError("A PF2E item with nested physical documents is missing its stable identity.");
    }
    for (const child of nested ?? []) visit(child, itemId);
  };
  for (const item of contents) visit(item, null);
  return entries;
}

function isCurrencyItem(item: PhysicalItemLike): boolean {
  if (!item.isOfType?.("treasure")) return false;
  if (typeof item.isCurrency === "boolean") return item.isCurrency;
  return item.system?.category === "coin" || item.system?.category === "credstick" || item.system?.slug === "upb";
}

function validatedQuantity(item: PhysicalItemLike): number {
  const prepared = item.quantity ?? item.system?.quantity;
  const raw = item._source?.system?.quantity;
  if (
    !Number.isSafeInteger(prepared) ||
    (prepared as number) < 0 ||
    !Number.isSafeInteger(raw) ||
    (raw as number) < 0 ||
    prepared !== raw
  ) {
    throw new TypeError(`PF2E physical item ${String(item.id ?? "unknown")} has an invalid quantity.`);
  }
  return prepared as number;
}

function validatedContainerId(item: PhysicalItemLike): string | null {
  const raw = item._source?.system?.containerId ?? null;
  const prepared = item.system?.containerId ?? null;
  const related = item.container?.id ?? null;
  if (
    (raw !== null && typeof raw !== "string") ||
    (prepared !== null && typeof prepared !== "string") ||
    (related !== null && typeof related !== "string") ||
    raw !== prepared ||
    (related !== null && related !== raw)
  ) {
    throw new TypeError(`PF2E physical item ${String(item.id ?? "unknown")} has an invalid container link.`);
  }
  return raw as string | null;
}

function validateCurrencySource(item: PhysicalItemLike): void {
  const price = item._source?.system?.price;
  if (!price || !isRecord(price.value)) {
    throw new TypeError("A PF2E currency item has a missing raw price.");
  }
  for (const value of Object.values(price.value)) {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new TypeError("A PF2E currency item has a malformed raw price.");
    }
  }
  if (price.per !== undefined && (!Number.isSafeInteger(price.per) || (price.per as number) < 1)) {
    throw new TypeError("A PF2E currency item has a malformed price unit.");
  }
}

function validateContainerGraph(items: readonly { itemId: string; containerId: string | null }[]): void {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  if (byId.size !== items.length) throw new TypeError("The PF2E actor has duplicate physical item IDs.");
  for (const item of items) {
    const visited = new Set([item.itemId]);
    let containerId = item.containerId;
    while (containerId !== null) {
      const container = byId.get(containerId);
      if (!container) throw new TypeError(`PF2E physical item ${item.itemId} has a dangling container link.`);
      if (visited.has(containerId))
        throw new TypeError(`PF2E physical item ${item.itemId} has a cyclic container link.`);
      visited.add(containerId);
      containerId = container.containerId;
    }
  }
}

function safeCopperAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("PF2E currency exceeds the safe copper range.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
