import { MODULE_ID } from "../../constants.js";
import { usesNativeGrantItemCreation } from "../../shared/grant-creation-policy.js";
import { sourceIdOf } from "../../shared/source-id.js";
import type { PendingStep, SelectionRef } from "../../types.js";

export function isSelectionMaterializedOnActor(
  actorItems: readonly unknown[],
  selection: SelectionRef,
  step: PendingStep
): boolean {
  const selectionUuid = normalizeUuid(selection.uuid);
  if (!selectionUuid) return false;

  const items = actorItems.map((item) => item as MaterializedActorItem);
  const matchingItems = items.filter((item) => normalizeUuid(sourceIdOf(item)) === selectionUuid);
  if (
    matchingItems.some((item) => {
      const moduleFlags = item.flags?.[MODULE_ID];
      const slotId = isRecord(moduleFlags) ? moduleFlags.slotId : null;
      return typeof slotId === "string" && slotId === selection.slotId;
    })
  ) {
    return true;
  }

  const nativeGrant = step.grantSelection;
  if (!usesNativeGrantItemCreation(step) || !nativeGrant) return false;
  const selectorUuid = normalizeUuid(nativeGrant.selectorUuid);
  if (!selectorUuid) return false;

  const itemsById = new Map(
    items.flatMap((item) => (typeof item.id === "string" && item.id.length > 0 ? [[item.id, item] as const] : []))
  );
  return matchingItems.some((item) => {
    if (typeof item.id !== "string" || item.id.length === 0) return false;
    const granterId = item.flags?.pf2e?.grantedBy?.id;
    if (typeof granterId !== "string" || granterId.length === 0) return false;
    const granter = itemsById.get(granterId);
    if (!granter || normalizeUuid(sourceIdOf(granter)) !== selectorUuid) return false;
    return Object.values(granter.flags?.pf2e?.itemGrants ?? {}).some(
      (grant) => isRecord(grant) && grant.id === item.id
    );
  });
}

type MaterializedActorItem = {
  id?: unknown;
  sourceId?: unknown;
  flags?: {
    core?: { sourceId?: unknown };
    pf2e?: {
      grantedBy?: { id?: unknown };
      itemGrants?: Record<string, unknown>;
    };
  } & Record<string, unknown>;
  _stats?: { compendiumSource?: unknown };
};

function normalizeUuid(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
