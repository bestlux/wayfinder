import { listActorItems } from "../build-state.js";
import { sourceIdOf } from "../shared/source-id.js";
import type { ClassBranchMeta, ClassChoiceMeta, ClassGrantMeta } from "../types.js";

export function readExistingBranchSelection(actor: any, branch: ClassBranchMeta): string | null {
  const selectorItem = findActorItemBySourceId(actor, branch.selectorUuid);
  const rulesSelection = selectorItem?.flags?.pf2e?.rulesSelections?.[branch.flag];
  return typeof rulesSelection === "string" && rulesSelection.length > 0 ? rulesSelection : null;
}

export function readExistingGrantedSelection(actor: any, grant: ClassGrantMeta): string | null {
  const selectorItem = findActorItemBySourceId(actor, grant.selectorUuid);
  if (!selectorItem?.id) {
    return null;
  }

  const rulesSelection = selectorItem?.flags?.pf2e?.rulesSelections?.[grant.flag];
  if (typeof rulesSelection === "string" && rulesSelection.length > 0) {
    return rulesSelection;
  }

  const grantedItemId = selectorItem?.flags?.pf2e?.itemGrants?.[grant.flag]?.id;
  const grantedItem =
    (typeof grantedItemId === "string" && grantedItemId.length > 0
      ? listActorItems(actor).find((item: any) => item?.id === grantedItemId)
      : null) ??
    listActorItems(actor).find(
      (item: any) => item?.type === grant.itemType && item?.flags?.pf2e?.grantedBy?.id === selectorItem.id
    ) ??
    null;

  return sourceIdOf(grantedItem);
}

export function readExistingClassChoiceSelection(actor: any, choice: ClassChoiceMeta): string | null {
  const sourceItem = findActorItemBySourceId(actor, choice.sourceUuid);
  const rulesSelection = sourceItem?.flags?.pf2e?.rulesSelections?.[choice.flag];
  return typeof rulesSelection === "string" && rulesSelection.length > 0 ? rulesSelection : null;
}

function findActorItemBySourceId(actor: any, sourceId: string): any | null {
  return listActorItems(actor).find((item: any) => sourceIdOf(item) === sourceId) ?? null;
}
