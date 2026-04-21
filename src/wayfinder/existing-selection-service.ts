import { listActorItems } from "../build-state.js";
import { itemMatchesSourceId, sourceIdOf } from "../shared/source-id.js";
import type { ClassBranchMeta, ClassChoiceMeta, ClassGrantMeta } from "../types.js";

interface ActorItemLike {
  id?: unknown;
  type?: unknown;
  flags?: {
    pf2e?: {
      rulesSelections?: Record<string, unknown>;
      itemGrants?: Record<string, { id?: unknown }>;
      grantedBy?: {
        id?: unknown;
      };
    };
  };
}

export function readExistingBranchSelection(actor: unknown, branch: ClassBranchMeta): string | null {
  return readRulesSelection(findActorItemBySourceId(actor, branch.selectorUuid), branch.flag);
}

export function readExistingGrantedSelection(actor: unknown, grant: ClassGrantMeta): string | null {
  const selectorItem = findActorItemBySourceId(actor, grant.selectorUuid);
  if (!selectorItem) {
    return null;
  }

  const rulesSelection = readRulesSelection(selectorItem, grant.flag);
  if (rulesSelection) {
    return rulesSelection;
  }

  return sourceIdOf(findGrantedActorItem(actor, selectorItem, grant));
}

export function readExistingClassChoiceSelection(actor: unknown, choice: ClassChoiceMeta): string | null {
  return readRulesSelection(findActorItemBySourceId(actor, choice.sourceUuid), choice.flag);
}

function findActorItemBySourceId(actor: unknown, sourceId: string): ActorItemLike | null {
  return listTypedActorItems(actor).find((item) => itemMatchesSourceId(item, sourceId)) ?? null;
}

function findGrantedActorItem(
  actor: unknown,
  selectorItem: ActorItemLike,
  grant: ClassGrantMeta
): ActorItemLike | null {
  const selectorId = typeof selectorItem.id === "string" ? selectorItem.id : null;
  if (!selectorId) {
    return null;
  }

  const grantedItemId = selectorItem.flags?.pf2e?.itemGrants?.[grant.flag]?.id;
  if (typeof grantedItemId === "string" && grantedItemId.length > 0) {
    return listTypedActorItems(actor).find((item) => item.id === grantedItemId) ?? null;
  }

  return (
    listTypedActorItems(actor).find(
      (item) => item.type === grant.itemType && item.flags?.pf2e?.grantedBy?.id === selectorId
    ) ?? null
  );
}

function readRulesSelection(item: ActorItemLike | null, flag: string): string | null {
  const selection = item?.flags?.pf2e?.rulesSelections?.[flag];
  return typeof selection === "string" && selection.length > 0 ? selection : null;
}

function listTypedActorItems(actor: unknown): ActorItemLike[] {
  return listActorItems(actor).filter((item): item is ActorItemLike => !!item && typeof item === "object");
}
