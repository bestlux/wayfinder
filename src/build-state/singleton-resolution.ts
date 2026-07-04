import { fetchSelectionDocument } from "../pack/access.js";
import { cloneData } from "../shared/cloning.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import type { DraftState } from "../types.js";
import { findDraftSelectionByType } from "../wayfinder/draft-decisions.js";
import type {
  BuildStateActor,
  BuildStateActorItem,
  BuildStateDocument,
  ResolvedBuildStateDocument,
  SingletonItemType,
} from "./document-types.js";

export async function getEffectiveSingletonDocument(
  actor: BuildStateActor,
  draft: DraftState,
  itemType: SingletonItemType
): Promise<ResolvedBuildStateDocument | null> {
  const draftSelection = findDraftSelectionByType(draft, itemType);
  if (draftSelection) {
    const draftDocument = await fetchSelectionDocument(draftSelection);
    if (draftDocument) {
      return toPlainDocument(draftDocument);
    }
  }

  const actorItem = listActorItems(actor).find((item) => item?.type === itemType);
  if (!actorItem) {
    return null;
  }

  const sourceDocument = await resolveSourceDocumentFromActorItem(actorItem, itemType);
  return toPlainDocument(sourceDocument ?? actorItem);
}

export function listActorItems(actor: unknown): BuildStateActorItem[] {
  const items = (actor as BuildStateActor | null | undefined)?.items;
  if (Array.isArray(items)) {
    return items;
  }

  if (items && typeof items === "object" && Array.isArray(items.contents)) {
    return items.contents;
  }

  return [];
}

async function resolveSourceDocumentFromActorItem(
  actorItem: BuildStateActorItem,
  itemType: SingletonItemType
): Promise<ResolvedBuildStateDocument | null> {
  const sourceId = actorItem?.flags?.core?.sourceId;
  if (typeof sourceId !== "string" || !sourceId.startsWith("Compendium.")) {
    return null;
  }

  const parsed = parseCompendiumItemUuid(sourceId);
  if (!parsed) {
    return null;
  }

  return fetchSelectionDocument({
    slotId: `${itemType}-level-1`,
    packId: parsed.packId,
    documentId: parsed.documentId,
    uuid: sourceId,
    itemType,
    featType: null,
    name: actorItem.name ?? "",
    level: null,
  });
}

function toPlainDocument(
  document: BuildStateDocument | BuildStateActorItem | null | undefined
): ResolvedBuildStateDocument | null {
  if (!document) {
    return null;
  }

  if (typeof (document as { toObject?: () => unknown }).toObject === "function") {
    return cloneData((document as { toObject: () => unknown }).toObject()) as ResolvedBuildStateDocument;
  }

  return cloneData(document) as ResolvedBuildStateDocument;
}
