import { listActorItems } from "../build-state.js";
import { itemMatchesSourceId, sourceIdOf } from "../shared/source-id.js";
export function readExistingBranchSelection(actor, branch) {
    return readRulesSelection(findActorItemBySourceId(actor, branch.selectorUuid), branch.flag);
}
export function readExistingGrantedSelection(actor, grant) {
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
export function readExistingClassChoiceSelection(actor, choice) {
    return readRulesSelection(findActorItemBySourceId(actor, choice.sourceUuid), choice.flag);
}
export function readExistingSingletonChoiceSelection(actor, choice) {
    return readRulesSelection(findActorItemBySourceId(actor, choice.sourceUuid), choice.flag);
}
export function readExistingLanguageSelections(actor) {
    const sourceLanguages = readLanguageValues(actor
        ?._source) ?? readLanguageValues(actor);
    return sourceLanguages ?? [];
}
export function readExistingSingletonSourceSelection(actor, itemType) {
    const item = listTypedActorItems(actor).find((entry) => entry.type === itemType) ?? null;
    const sourceId = sourceIdOf(item);
    if (!item || !sourceId) {
        return null;
    }
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(sourceId);
    if (!match) {
        return null;
    }
    return {
        slotId: `${itemType}-level-1`,
        packId: match[1],
        documentId: match[2],
        uuid: sourceId,
        itemType,
        featType: null,
        name: item.name ?? "",
        level: 1,
    };
}
function findActorItemBySourceId(actor, sourceId) {
    return listTypedActorItems(actor).find((item) => itemMatchesSourceId(item, sourceId)) ?? null;
}
function findGrantedActorItem(actor, selectorItem, grant) {
    const selectorId = typeof selectorItem.id === "string" ? selectorItem.id : null;
    if (!selectorId) {
        return null;
    }
    const grantedItemId = selectorItem.flags?.pf2e?.itemGrants?.[grant.flag]?.id;
    if (typeof grantedItemId === "string" && grantedItemId.length > 0) {
        return listTypedActorItems(actor).find((item) => item.id === grantedItemId) ?? null;
    }
    return (listTypedActorItems(actor).find((item) => item.type === grant.itemType && item.flags?.pf2e?.grantedBy?.id === selectorId) ?? null);
}
function readRulesSelection(item, flag) {
    const selection = item?.flags?.pf2e?.rulesSelections?.[flag];
    return typeof selection === "string" && selection.length > 0 ? selection : null;
}
function readLanguageValues(source) {
    const detailsHolder = source && typeof source === "object" && "system" in source
        ? source.system
        : source;
    const value = detailsHolder?.details?.languages?.value;
    if (!Array.isArray(value)) {
        return null;
    }
    return Array.from(new Set(value
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
        .filter((entry) => entry.length > 0)));
}
function listTypedActorItems(actor) {
    return listActorItems(actor).filter((item) => !!item && typeof item === "object");
}
//# sourceMappingURL=existing-selection-service.js.map