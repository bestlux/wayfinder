import { executePreparedDraftApplication, prepareDraftApplication, } from "./actor-updater/prepared-draft-application.js";
import { enqueueActorOperation } from "./shared/actor-operation-queue.js";
import { cloneData } from "./shared/cloning.js";
const inFlightByActor = new WeakMap();
const operationIdentityByReference = new WeakMap();
let nextOperationIdentity = 1;
export function applyDraftToActor(actor, draft, steps, options = {}) {
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
        const prepared = await prepareDraftApplication(actor, draftSnapshot, stepSnapshots, {
            validateActorAuthority: options.validateActorAuthority,
            validateSelectionEligibility: options.validateSelectionEligibility,
            validSkillSlugs: options.validSkillSlugs,
        });
        const result = await executePreparedDraftApplication(prepared, {
            beforePhase: options.beforePhase,
            finalActorUpdate,
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
function draftApplyOperationKey(draft, steps, options) {
    return JSON.stringify({
        draft,
        steps,
        finalActorUpdate: options.finalActorUpdate ?? null,
        beforePhase: operationIdentity(options.beforePhase),
        validateActorAuthority: operationIdentity(options.validateActorAuthority),
        validateSelectionEligibility: operationIdentity(options.validateSelectionEligibility),
        validSkillSlugs: options.validSkillSlugs ? Array.from(options.validSkillSlugs).sort() : null,
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