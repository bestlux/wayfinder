import { MODULE_ID } from "../../constants.js";
import { normalizePlannedClassGrant, } from "../domain/class-grant-reconciliation.js";
import { CLASS_GRANT_PROFILE_UUIDS, THAUMATURGE_FIXED_IMPLEMENTS, THAUMATURGE_IMPLEMENT_ORIGINS, } from "../domain/physical-grant-route-registry.js";
/** A durable in-flight native pair can restore only its missing original selector. */
export function findThaumaturgeNativeSelectorRecovery(args) {
    const { draft, actorItems } = args;
    const grant = normalizePlannedClassGrant(args.grant);
    const acquisition = draft.acquisition;
    if (!grant ||
        !grant.profileId.startsWith("thaumaturge-") ||
        !acquisition?.baseline ||
        Object.keys(draft.applyRecoveryActorUpdate).length === 0 ||
        !Object.keys(draft.applyRecoveryActorUpdate).every((path) => path.startsWith("system.")) ||
        acquisition.targetLevel !== draft.targetLevel ||
        ![...draft.applyAttemptStepIds, ...draft.applyCompletedStepIds].includes(grant.origin.sourceSlotId))
        return null;
    const origin = THAUMATURGE_IMPLEMENT_ORIGINS.find((entry) => entry.slotId === grant.origin.sourceSlotId);
    const implement = THAUMATURGE_FIXED_IMPLEMENTS.find((entry) => grant.granterSourceUuid === `Compendium.pf2e.classfeatures.Item.${entry.featureId}`);
    const persisted = acquisition.plannedClassGrants.filter((entry) => entry.grantId === grant.grantId);
    const root = draft.selections["class-level-1"];
    const selection = draft.branchSelections[grant.origin.sourceSlotId];
    if (!origin ||
        !implement ||
        origin.level > draft.targetLevel ||
        persisted.length !== 1 ||
        !same(normalizePlannedClassGrant(persisted[0]), grant) ||
        root?.slotId !== "class-level-1" ||
        root.itemType !== "class" ||
        root.uuid !== CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass ||
        selection?.slotId !== origin.slotId ||
        selection.uuid !== grant.origin.sourceUuid ||
        selection.itemType !== "feat" ||
        selection.featType !== "classfeature")
        return null;
    const classes = actorItems.filter((item) => item.itemType === "class");
    const features = actorItems.filter((item) => item.sourceUuid === grant.granterSourceUuid);
    const physicals = actorItems.filter((item) => item.sourceUuid === grant.expected.sourceUuid);
    const classItem = classes[0];
    const feature = features[0];
    const physical = physicals[0];
    if (classes.length !== 1 ||
        classItem?.sourceUuid !== CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass ||
        features.length !== 1 ||
        feature?.itemType !== "feat" ||
        feature.quantity !== 1 ||
        feature.wayfinderImportedBy !== MODULE_ID ||
        feature.wayfinderSlotId !== origin.slotId ||
        feature.locationItemId !== null ||
        !feature.grantedByItemId ||
        !/^[A-Za-z0-9]{16}$/u.test(feature.grantedByItemId) ||
        physicals.length !== 1 ||
        physical?.itemType !== "equipment" ||
        physical.quantity !== 1 ||
        physical.grantedByItemId !== feature.itemId ||
        physical.acquisitionIdentity !== null ||
        feature.itemGrants?.[`${implement.slug}Implement`] !== physical.itemId ||
        actorItems.some((item) => item.itemId !== feature.itemId &&
            (item.grantedByItemId === feature.grantedByItemId ||
                item.locationItemId === feature.grantedByItemId ||
                Object.values(item.itemGrants ?? {}).includes(feature.grantedByItemId))) ||
        acquisition.baseline.physicalItems.some((item) => item.itemId === physical.itemId || item.sourceUuid === physical.sourceUuid))
        return null;
    const parentsById = actorItems.filter((item) => item.itemId === feature.grantedByItemId);
    const parentsBySource = actorItems.filter((item) => item.sourceUuid === origin.selectorUuid);
    const parent = parentsById[0];
    if (parent) {
        // A previous repair may have persisted its parent before a later write
        // failed. Resume only that same owned route, including its empty child
        // record before the final reciprocal update has completed.
        if (parentsById.length !== 1 ||
            parentsBySource.length !== 1 ||
            parentsBySource[0]?.itemId !== parent.itemId ||
            parent.sourceUuid !== origin.selectorUuid ||
            parent.itemType !== "feat" ||
            parent.quantity !== 1 ||
            parent.wayfinderImportedBy !== MODULE_ID ||
            parent.wayfinderSlotId !== origin.slotId ||
            parent.locationItemId !== classItem.itemId ||
            parent.grantedByItemId !== null ||
            !Object.entries(parent.itemGrants ?? {}).every(([key, id]) => key === "implement" && id === feature.itemId))
            return null;
    }
    else if (parentsBySource.length !== 0)
        return null;
    return {
        selectorItemId: feature.grantedByItemId,
        selectorSourceUuid: origin.selectorUuid,
        featureItemId: feature.itemId,
        physicalItemId: physical.itemId,
        originSlotId: origin.slotId,
    };
}
function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
//# sourceMappingURL=thaumaturge-native-selector-recovery.js.map