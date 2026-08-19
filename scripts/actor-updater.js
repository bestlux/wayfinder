import { executePreparedDraftApplication, executeRecoveredDraftFinalization, prepareDraftApplication, } from "./actor-updater/prepared-draft-application.js";
import { enqueueActorOperation } from "./shared/actor-operation-queue.js";
import { cloneData } from "./shared/cloning.js";
import { captureObservedClassGrantItems } from "./wayfinder/application/class-grant-projection-service.js";
import { reconcilePreparedClassGrants, } from "./wayfinder/domain/class-grant-reconciliation.js";
const inFlightByActor = new WeakMap();
const operationIdentityByReference = new WeakMap();
let nextOperationIdentity = 1;
export function applyDraftToActor(actor, draft, steps, options) {
    assertRequiredActorAuthority(actor, options?.validateActorAuthority);
    if (draft.acquisition &&
        (!options.executeAcquisitionItems || !options.verifyAcquisitionOutcome || !options.readCurrentAcquisitionHistory)) {
        throw new Error("Starting-equipment Apply requires prepared acquisition execution and verification.");
    }
    const actorKey = actor;
    const draftSnapshot = cloneData(draft);
    const stepSnapshots = cloneData(steps);
    const finalActorUpdate = options.finalActorUpdate ? cloneData(options.finalActorUpdate) : undefined;
    const operationKey = draftApplyOperationKey(draftSnapshot, stepSnapshots, {
        ...options,
        finalActorUpdate,
    });
    const actorOperations = inFlightByActor.get(actorKey) ?? new Map();
    const inFlight = actorOperations.get(operationKey);
    if (inFlight !== undefined) {
        return inFlight;
    }
    const promise = enqueueActorOperation(actorKey, async () => {
        await options.beforePrepare?.();
        const prepared = await prepareDraftApplication(actor, draftSnapshot, stepSnapshots, {
            validateActorAuthority: options.validateActorAuthority,
            spellRarityCeiling: options.spellRarityCeiling,
            validateSelectionEligibility: options.validateSelectionEligibility,
            validSkillSlugs: options.validSkillSlugs,
            prepareClassGrantPlan: options.prepareClassGrantPlan,
        });
        const result = await executePreparedDraftApplication(prepared, {
            onCheckpoint: options.onCheckpoint,
            finalActorUpdate,
            resolveFinalActorUpdate: options.resolveFinalActorUpdate,
            beforeFinalActorUpdate: options.beforeFinalActorUpdate,
            persistFinalActorUpdate: options.persistFinalActorUpdate,
            executeAcquisitionItems: options.executeAcquisitionItems,
            verifyAcquisitionOutcome: options.verifyAcquisitionOutcome,
            readCurrentAcquisitionHistory: options.readCurrentAcquisitionHistory,
            acquisitionFinalEvidence: options.acquisitionFinalEvidence,
        });
        return result.actorUpdate;
    });
    actorOperations.set(operationKey, promise);
    inFlightByActor.set(actorKey, actorOperations);
    void promise
        .finally(() => {
        if (actorOperations.get(operationKey) === promise) {
            actorOperations.delete(operationKey);
        }
        if (actorOperations.size === 0 && inFlightByActor.get(actorKey) === actorOperations) {
            inFlightByActor.delete(actorKey);
        }
    })
        .catch(() => undefined);
    return promise;
}
export function finalizeRecoveredDraftOnActor(actor, options) {
    assertRequiredActorAuthority(actor, options?.validateActorAuthority);
    return enqueueActorOperation(actor, async () => {
        await options.beforeFinalize?.();
        const classGrantReconciliations = [];
        if (options.classGrantRecovery.kind === "required") {
            const plan = await options.classGrantRecovery.preparePlan(actor);
            const reconciliation = reconcilePreparedClassGrants({
                plan,
                actorItems: captureObservedClassGrantItems(actor),
                phase: "final",
            });
            classGrantReconciliations.push(reconciliation);
            const acquisitionFinalEvidence = await options.classGrantRecovery.verifyAcquisitionRecovery({
                actor,
                plan,
                finalClassGrantReconciliation: reconciliation,
            });
            if (acquisitionFinalEvidence.manifest.disposition !== "handoff" &&
                reconciliation.entries.some((entry) => entry.status !== "resolved")) {
                throw new Error("Planned class equipment is missing or ambiguous during recovery finalization.");
            }
            const result = await executeRecoveredDraftFinalization(actor, {
                resolveFinalActorUpdate: options.resolveFinalActorUpdate,
                beforeFinalActorUpdate: options.beforeFinalActorUpdate,
                persistFinalActorUpdate: options.persistFinalActorUpdate,
                onCheckpoint: options.onCheckpoint,
                recoveryActorUpdate: cloneData(options.recoveryActorUpdate),
                validateActorAuthority: options.validateActorAuthority,
                classGrantReconciliations,
                acquisitionFinalEvidence,
            });
            return result.actorUpdate;
        }
        const result = await executeRecoveredDraftFinalization(actor, {
            resolveFinalActorUpdate: options.resolveFinalActorUpdate,
            beforeFinalActorUpdate: options.beforeFinalActorUpdate,
            persistFinalActorUpdate: options.persistFinalActorUpdate,
            onCheckpoint: options.onCheckpoint,
            recoveryActorUpdate: cloneData(options.recoveryActorUpdate),
            validateActorAuthority: options.validateActorAuthority,
            classGrantReconciliations,
        });
        return result.actorUpdate;
    });
}
function assertRequiredActorAuthority(actor, validateActorAuthority) {
    if (!validateActorAuthority || !validateActorAuthority(actor)) {
        throw new Error("The current user can no longer modify this PF2E character.");
    }
}
function draftApplyOperationKey(draft, steps, options) {
    return JSON.stringify({
        draft,
        steps,
        finalActorUpdate: options.finalActorUpdate ?? null,
        beforePrepare: operationIdentity(options.beforePrepare),
        beforeFinalActorUpdate: operationIdentity(options.beforeFinalActorUpdate),
        persistFinalActorUpdate: operationIdentity(options.persistFinalActorUpdate),
        onCheckpoint: operationIdentity(options.onCheckpoint),
        resolveFinalActorUpdate: operationIdentity(options.resolveFinalActorUpdate),
        validateActorAuthority: operationIdentity(options.validateActorAuthority),
        spellRarityCeiling: options.spellRarityCeiling,
        validateSelectionEligibility: operationIdentity(options.validateSelectionEligibility),
        validSkillSlugs: options.validSkillSlugs ? Array.from(options.validSkillSlugs).sort() : null,
        prepareClassGrantPlan: operationIdentity(options.prepareClassGrantPlan),
        executeAcquisitionItems: operationIdentity(options.executeAcquisitionItems),
        verifyAcquisitionOutcome: operationIdentity(options.verifyAcquisitionOutcome),
        readCurrentAcquisitionHistory: operationIdentity(options.readCurrentAcquisitionHistory),
        acquisitionFinalEvidence: options.acquisitionFinalEvidence ?? null,
    });
}
function operationIdentity(value) {
    if (!value) {
        return null;
    }
    const existing = operationIdentityByReference.get(value);
    if (existing !== undefined) {
        return existing;
    }
    const identity = nextOperationIdentity++;
    operationIdentityByReference.set(value, identity);
    return identity;
}
export { DraftApplyPhaseError } from "./actor-updater/prepared-draft-application.js";
//# sourceMappingURL=actor-updater.js.map