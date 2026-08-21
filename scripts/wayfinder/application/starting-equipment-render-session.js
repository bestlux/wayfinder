import { MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS } from "../panes/starting-equipment-pane.js";
export const EQUIPMENT_POLICY_PART = "equipment-policy";
export const EQUIPMENT_CATALOGUE_PART = "equipment-catalogue";
export const EQUIPMENT_DETAIL_PART = "equipment-detail";
export const EQUIPMENT_CART_PART = "equipment-cart";
export const EQUIPMENT_STATUS_PART = "equipment-status";
export const EQUIPMENT_RENDER_PARTS = [
    EQUIPMENT_POLICY_PART,
    EQUIPMENT_CATALOGUE_PART,
    EQUIPMENT_DETAIL_PART,
    EQUIPMENT_CART_PART,
    EQUIPMENT_STATUS_PART,
];
export function startingEquipmentRenderIdentity(draft, stepId, sourceRevision) {
    const acquisition = draft.acquisition;
    return {
        stepId,
        targetLevel: draft.targetLevel,
        policyRevision: acquisition
            ? `${acquisition.draftId}:${acquisition.batchId}:${acquisition.policySnapshot?.fingerprint ?? "awaiting-authority"}`
            : "not-initialized",
        sourceRevision,
    };
}
export function createStartingEquipmentRenderSession(args) {
    assertBoundedPane(args.pane);
    return {
        identity: { ...args.identity },
        viewRevision: args.viewRevision,
        step: args.step,
        evaluation: args.evaluation,
        pane: args.pane,
    };
}
export function canDeriveStartingEquipmentRender(session, identity, request) {
    return (sameStartingEquipmentRenderIdentity(session.identity, identity) &&
        request.stepId === identity.stepId &&
        request.sourceRevision === identity.sourceRevision &&
        request.viewRevision > session.viewRevision);
}
export function advanceStartingEquipmentRenderSession(session, request, pane) {
    if (request.stepId !== session.identity.stepId || request.sourceRevision !== session.identity.sourceRevision) {
        throw new Error("Starting-equipment render request belongs to another prepared session.");
    }
    if (request.viewRevision <= session.viewRevision) {
        throw new Error("Starting-equipment render request is stale.");
    }
    assertBoundedPane(pane);
    return { ...session, viewRevision: request.viewRevision, pane };
}
export function startingEquipmentPartsForIntent(intent) {
    switch (intent) {
        case "search":
        case "facet":
        case "preview":
            return [EQUIPMENT_CATALOGUE_PART, EQUIPMENT_DETAIL_PART];
        case "recipe":
            return [EQUIPMENT_POLICY_PART, EQUIPMENT_STATUS_PART];
        case "quantity":
            return [...EQUIPMENT_RENDER_PARTS];
    }
}
export function canUseStartingEquipmentCommandPartial(draft, intent) {
    const acquisition = draft.acquisition;
    if (!acquisition || draft.acquisitionCorrupt)
        return false;
    if (intent === "recipe")
        return acquisition.policySnapshot === null;
    return acquisition.policySnapshot !== null && acquisition.disposition.kind === "unreviewed";
}
function sameStartingEquipmentRenderIdentity(left, right) {
    return (left.stepId === right.stepId &&
        left.targetLevel === right.targetLevel &&
        left.policyRevision === right.policyRevision &&
        left.sourceRevision === right.sourceRevision);
}
function assertBoundedPane(pane) {
    if (pane.catalogue.items.length > MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS) {
        throw new RangeError("Starting-equipment render sessions may only retain the bounded visible catalogue page.");
    }
}
//# sourceMappingURL=starting-equipment-render-session.js.map