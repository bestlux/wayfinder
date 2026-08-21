export function usesNativeGrantItemCreation(step) {
    if (step?.kind !== "pick-item" || step.slotKind !== "grant-choice") {
        return false;
    }
    if (step.staticGrantReplacement) {
        return true;
    }
    if (!step.grantSelection) {
        return false;
    }
    // Guided choices on a statically granted child belong to the parent grant's
    // creation transaction. The prepared child source already carries the exact
    // ChoiceSet selections, so PF2E can create its dynamic descendants without
    // staging an unowned copy of the child ahead of its parent.
    if (step.grantSelection.staticGrantOwner) {
        return true;
    }
    const staticUuidCount = step.grantSelection.filters.uuids?.length ?? step.filters.uuids?.length ?? 0;
    const itemType = step.grantSelection.itemType || step.filters.itemType;
    return step.grantSelection.sourceItemType === "feat" || (staticUuidCount > 0 && itemType === "feat");
}
//# sourceMappingURL=grant-creation-policy.js.map