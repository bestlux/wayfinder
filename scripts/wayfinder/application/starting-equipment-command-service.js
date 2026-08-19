import { acknowledgeAcquisitionHandoff, createAcquisitionDraft, createAcquisitionPolicySnapshot, invalidateAcquisitionReview, normalizeAcquisitionDraft, recordEconomicAdmission, recordPlannedClassGrants, } from "../domain/acquisition-draft.js";
import { mintAcquisitionIdentitySeed } from "../domain/acquisition-identity.js";
import { createAcquisitionPriceSnapshot, evaluateAcquisitionLedger, reviewPurchaseLedger, reviewRetainAll, } from "../domain/acquisition-ledger.js";
import { createPreparedClassGrantPlan } from "../domain/class-grant-reconciliation.js";
import { prepareCurrentClassGrantPlan, projectCurrentClassGrants } from "./class-grant-projection-service.js";
import { evaluateActorEconomicAdmission } from "./economic-baseline-service.js";
import { resolveEquipmentPolicyForActor } from "./equipment-policy-service.js";
const DEFAULT_DEPS = {
    mintIdentity: mintAcquisitionIdentitySeed,
    resolvePolicy: resolveEquipmentPolicyForActor,
    projectClassGrants: projectCurrentClassGrants,
    prepareClassGrantPlan: prepareCurrentClassGrantPlan,
    evaluateAdmission: evaluateActorEconomicAdmission,
    evaluateLedger: evaluateAcquisitionLedger,
};
export async function executeStartingEquipmentCommand(command, context, deps = DEFAULT_DEPS) {
    assertCommandContext(context);
    if (context.draft.acquisitionCorrupt) {
        throw new TypeError("The starting-equipment draft is malformed and cannot be changed.");
    }
    const before = context.draft.acquisition;
    let acquisition;
    let statusNote;
    switch (command.type) {
        case "initialize": {
            const initialized = before ? null : await initializeAcquisition(context, deps);
            acquisition = before ?? initialized.acquisition;
            statusNote = before
                ? "Starting equipment is already set up."
                : initialized.pendingTitanSelection
                    ? "Starting-equipment policy is ready. Choose the required Titan Mauler weapon before review."
                    : "Starting-equipment policy is ready for review.";
            break;
        }
        case "add-line":
            acquisition = addPreparedLine(requireAcquisition(context.draft), command.line);
            statusNote = "Item added to the starting-equipment cart.";
            break;
        case "remove-line":
            acquisition = removeLine(requireAcquisition(context.draft), command.lineId);
            statusNote = "Item removed from the starting-equipment cart.";
            break;
        case "set-quantity":
            acquisition = setLineQuantity(requireAcquisition(context.draft), command.lineId, command.quantity);
            statusNote = "Starting-equipment quantity updated.";
            break;
        case "review-purchases": {
            const prepared = await prepareLedger(context, deps);
            acquisition = reviewPurchaseLedger(prepared.acquisition, prepared.ledger, reviewer(context));
            statusNote = "Starting-equipment purchases reviewed.";
            break;
        }
        case "retain-all": {
            const prepared = await prepareLedger(context, deps);
            acquisition = reviewRetainAll(prepared.acquisition, prepared.ledger, reviewer(context));
            statusNote = "All remaining starting wealth will be retained.";
            break;
        }
        case "acknowledge-handoff":
            acquisition = acknowledgeAcquisitionHandoff(requireAcquisition(context.draft), {
                userId: context.userId,
                acknowledgedAt: context.now(),
            });
            statusNote = "PF2E inventory-sheet handoff acknowledged.";
            break;
    }
    return { acquisition, changed: acquisition !== before, statusNote };
}
async function initializeAcquisition(context, deps) {
    const identity = deps.mintIdentity();
    const policy = deps.resolvePolicy({
        actor: context.actor,
        draftId: identity.draftId,
        targetLevel: 1,
        selectedRecipe: null,
    });
    const recipe = { kind: policy.worldRecipePolicy.defaultRecipe };
    let acquisition = {
        ...createAcquisitionDraft({ ...identity, targetLevel: 1, recipe }),
        policySnapshot: createAcquisitionPolicySnapshot(policy, recipe),
    };
    const projectionDraft = { ...context.draft, acquisition };
    const classGrantProjection = await deps.projectClassGrants(context.actor, projectionDraft, context.steps);
    const unexpectedBlocker = classGrantProjection.blockers.find((blocker) => blocker.code !== "titan-selection-required");
    if (unexpectedBlocker)
        throw new Error(unexpectedBlocker.message);
    const pendingTitanSelection = classGrantProjection.blockers.some((blocker) => blocker.code === "titan-selection-required");
    acquisition = recordPlannedClassGrants(acquisition, classGrantProjection.grants);
    const subject = acquisition.policySnapshot.material.subject;
    const classGrantPlan = classGrantProjection.preparedPlan ??
        createPreparedClassGrantPlan({
            actorId: subject.actorId,
            draftId: acquisition.draftId,
            batchId: acquisition.batchId,
            targetLevel: acquisition.targetLevel,
            grants: classGrantProjection.grants,
        });
    const admission = deps.evaluateAdmission({
        actor: context.actor,
        draftId: acquisition.draftId,
        batchId: acquisition.batchId,
        targetLevel: acquisition.targetLevel,
        higherLevelStartEvidence: acquisition.policySnapshot.material.higherLevelStartEvidence,
        history: {
            previousCharacterAppliedAt: context.moduleState.lastAppliedAt,
            previousTargetLevel: context.moduleState.lastTargetLevel,
            completedAcquisitionManifestId: context.moduleState.completedAcquisitionManifest?.id ?? null,
            completedAcquisitionManifestCorrupt: context.moduleState.completedAcquisitionManifestCorrupt,
        },
        preparedClassGrantPlan: classGrantPlan,
        classGrantPhase: "before-acquisition",
        capturedAt: context.now(),
    });
    if (admission.kind === "blocked")
        throw new Error(admission.message);
    return { acquisition: recordEconomicAdmission(acquisition, admission), pendingTitanSelection };
}
async function prepareLedger(context, deps) {
    let acquisition = requireAcquisition(context.draft);
    const projectionDraft = { ...context.draft, acquisition };
    const classGrantPlan = await deps.prepareClassGrantPlan(context.actor, projectionDraft, context.steps);
    acquisition = recordPlannedClassGrants(acquisition, classGrantPlan.grants);
    const ledger = deps.evaluateLedger(acquisition, classGrantPlan);
    return { acquisition, ledger };
}
function reviewer(context) {
    return { userId: context.userId, reviewedAt: context.now() };
}
function addPreparedLine(draft, line) {
    if (draft.disposition.kind === "handoff")
        throw new TypeError("A PF2E-sheet handoff cannot accept cart items.");
    if (draft.lines.some((candidate) => candidate.lineId === line.lineId)) {
        throw new TypeError("The starting-equipment line already exists.");
    }
    const candidate = normalizeAcquisitionDraft({ ...draft, lines: [...draft.lines, line] });
    if (!candidate)
        throw new TypeError("The prepared starting-equipment line is malformed.");
    return invalidateAcquisitionReview(candidate, ["document"]);
}
function removeLine(draft, lineId) {
    if (draft.disposition.kind === "handoff")
        throw new TypeError("A PF2E-sheet handoff cannot change cart items.");
    if (!lineId.trim())
        throw new TypeError("Removing equipment requires a line ID.");
    const lines = draft.lines.filter((line) => line.lineId !== lineId);
    if (lines.length === draft.lines.length)
        throw new TypeError("The starting-equipment line no longer exists.");
    return invalidateAcquisitionReview({ ...draft, lines }, ["document"]);
}
function setLineQuantity(draft, lineId, quantity) {
    if (draft.disposition.kind === "handoff")
        throw new TypeError("A PF2E-sheet handoff cannot change cart items.");
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        throw new TypeError("Starting-equipment quantity must be a positive integer.");
    }
    const index = draft.lines.findIndex((line) => line.lineId === lineId);
    if (index < 0)
        throw new TypeError("The starting-equipment line no longer exists.");
    const current = draft.lines[index];
    const price = createAcquisitionPriceSnapshot({
        basePrice: current.price.basePrice,
        size: current.price.size,
        sizeSensitive: current.price.sizeSensitive,
        preciousMaterial: current.price.preciousMaterial,
        adjustedBulkPriceCopper: current.price.adjustedBulkPriceCopper,
        configurationPriceCopper: current.price.configurationPriceCopper,
        pricePer: current.price.pricePer,
        sourceQuantity: current.price.sourceQuantity,
        requestedQuantity: quantity,
    });
    if (price.ok === false)
        throw new TypeError(price.message);
    const lines = [...draft.lines];
    lines[index] = { ...current, price: price.value };
    return invalidateAcquisitionReview({ ...draft, lines }, ["quantity"]);
}
function requireAcquisition(draft) {
    if (draft.acquisitionCorrupt)
        throw new TypeError("The starting-equipment draft is malformed and cannot be changed.");
    if (!draft.acquisition)
        throw new TypeError("Set up starting equipment before changing its review state.");
    return draft.acquisition;
}
function assertCommandContext(context) {
    if (context.draft.targetLevel !== 1) {
        throw new TypeError("The Wave 2 starting-equipment tracer is available only for a level-1 target.");
    }
    if (!context.steps.some((step) => step.kind === "starting-equipment" && step.level === 1)) {
        throw new TypeError("The current plan does not contain the level-1 starting-equipment step.");
    }
    if (!context.userId.trim() || !Number.isFinite(Date.parse(context.now()))) {
        throw new TypeError("Starting-equipment commands require a current user and valid timestamp.");
    }
}
//# sourceMappingURL=starting-equipment-command-service.js.map