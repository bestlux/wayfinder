import { listActorItems } from "../build-state.js";
export function readExistingBranchSelection(actor, branch) {
    const selectorItem = findActorItemBySourceId(actor, branch.selectorUuid);
    const rulesSelection = selectorItem?.flags?.pf2e?.rulesSelections?.[branch.flag];
    return typeof rulesSelection === "string" && rulesSelection.length > 0 ? rulesSelection : null;
}
export function readExistingGrantedSelection(actor, grant) {
    const selectorItem = findActorItemBySourceId(actor, grant.selectorUuid);
    if (!selectorItem?.id) {
        return null;
    }
    const rulesSelection = selectorItem?.flags?.pf2e?.rulesSelections?.[grant.flag];
    if (typeof rulesSelection === "string" && rulesSelection.length > 0) {
        return rulesSelection;
    }
    const grantedItemId = selectorItem?.flags?.pf2e?.itemGrants?.[grant.flag]?.id;
    const grantedItem = (typeof grantedItemId === "string" && grantedItemId.length > 0
        ? listActorItems(actor).find((item) => item?.id === grantedItemId)
        : null) ??
        listActorItems(actor).find((item) => item?.type === grant.itemType && item?.flags?.pf2e?.grantedBy?.id === selectorItem.id) ??
        null;
    return sourceIdOf(grantedItem);
}
export function readExistingClassChoiceSelection(actor, choice) {
    const sourceItem = findActorItemBySourceId(actor, choice.sourceUuid);
    const rulesSelection = sourceItem?.flags?.pf2e?.rulesSelections?.[choice.flag];
    return typeof rulesSelection === "string" && rulesSelection.length > 0 ? rulesSelection : null;
}
function findActorItemBySourceId(actor, sourceId) {
    return listActorItems(actor).find((item) => sourceIdOf(item) === sourceId) ?? null;
}
function sourceIdOf(item) {
    const sourceId = item?.sourceId ?? item?.flags?.core?.sourceId ?? item?._stats?.compendiumSource ?? null;
    return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}
//# sourceMappingURL=existing-selection-service.js.map