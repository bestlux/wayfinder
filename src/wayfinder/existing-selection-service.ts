import type { BuildStateActorItem } from "../build-state/document-types.js";
import { listActorItems } from "../build-state.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { itemMatchesSourceId, sourceIdOf } from "../shared/source-id.js";
import type {
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  FlagChoiceMeta,
  SelectionRef,
  SingletonChoiceMeta,
} from "../types.js";

interface ActorItemLike extends BuildStateActorItem {
  flags?: BuildStateActorItem["flags"] & {
    pf2e?: {
      rulesSelections?: Record<string, unknown>;
      itemGrants?: Record<string, { id?: unknown }>;
      grantedBy?: {
        id?: unknown;
      };
    };
    system?: {
      rulesSelections?: Record<string, unknown>;
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

export function readExistingFlagChoiceSelection(actor: unknown, choice: FlagChoiceMeta): string | null {
  return readRulesSelection(findActorItemBySourceId(actor, choice.sourceUuid), choice.flag);
}

export function readExistingClassChoiceSelection(actor: unknown, choice: ClassChoiceMeta): string | null {
  return readRulesSelection(findActorItemBySourceId(actor, choice.sourceUuid), choice.flag);
}

export function readExistingSingletonChoiceSelection(actor: unknown, choice: SingletonChoiceMeta): string | null {
  return readRulesSelection(findActorItemBySourceId(actor, choice.sourceUuid), choice.flag);
}

export function readExistingLanguageSelections(actor: unknown): string[] {
  const sourceLanguages =
    readLanguageValues(
      (actor as { _source?: { system?: { details?: { languages?: { value?: unknown } } } } } | null | undefined)
        ?._source
    ) ?? readLanguageValues(actor as { system?: { details?: { languages?: { value?: unknown } } } } | null | undefined);

  return sourceLanguages ?? [];
}

export function readExistingSingletonSourceSelection(
  actor: unknown,
  itemType: "ancestry" | "heritage" | "background" | "class" | "deity"
): SelectionRef | null {
  const item = listTypedActorItems(actor).find((entry) => entry.type === itemType) ?? null;
  const sourceId = sourceIdOf(item);
  if (!item || !sourceId) {
    return null;
  }

  const parsed = parseCompendiumItemUuid(sourceId);
  if (!parsed) {
    return null;
  }

  return {
    slotId: `${itemType}-level-1`,
    packId: parsed.packId,
    documentId: parsed.documentId,
    uuid: sourceId,
    itemType,
    featType: null,
    name: item.name ?? "",
    level: 1,
  };
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
  const selection = item?.flags?.system?.rulesSelections?.[flag] ?? item?.flags?.pf2e?.rulesSelections?.[flag];
  return typeof selection === "string" && selection.length > 0 ? selection : null;
}

function readLanguageValues(
  source:
    | { _source?: never; system?: { details?: { languages?: { value?: unknown } } } }
    | { details?: { languages?: { value?: unknown } } }
    | null
    | undefined
): string[] | null {
  const detailsHolder =
    source && typeof source === "object" && "system" in source
      ? (source as { system?: { details?: { languages?: { value?: unknown } } } }).system
      : (source as { details?: { languages?: { value?: unknown } } } | null | undefined);
  const value = detailsHolder?.details?.languages?.value;
  if (!Array.isArray(value)) {
    return null;
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
        .filter((entry) => entry.length > 0)
    )
  );
}

function listTypedActorItems(actor: unknown): ActorItemLike[] {
  return listActorItems(actor).filter((item): item is ActorItemLike => !!item && typeof item === "object");
}
