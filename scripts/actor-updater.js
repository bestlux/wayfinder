import { executePreparedDraftApplication, prepareDraftApplication, } from "./actor-updater/prepared-draft-application.js";
const inFlightByActor = new WeakMap();
const queueByActor = new WeakMap();
export function applyDraftToActor(actor, draft, steps, options = {}) {
    const actorKey = actor;
    const operationKey = draftApplyOperationKey(draft, steps);
    const actorOperations = inFlightByActor.get(actorKey) ?? new Map();
    const inFlight = actorOperations.get(operationKey);
    if (inFlight !== undefined) {
        return inFlight;
    }
    const previous = queueByActor.get(actorKey) ?? Promise.resolve();
    const promise = previous
        .catch(() => undefined)
        .then(async () => {
        const prepared = await prepareDraftApplication(actor, draft, steps, {
            validateActorAuthority: options.validateActorAuthority,
            validateSelectionEligibility: options.validateSelectionEligibility,
            validSkillSlugs: options.validSkillSlugs,
        });
        const result = await executePreparedDraftApplication(prepared, {
            beforePhase: options.beforePhase,
            finalActorUpdate: options.finalActorUpdate,
        });
        return result.actorUpdate;
    });
    actorOperations.set(operationKey, promise);
    inFlightByActor.set(actorKey, actorOperations);
    const settled = promise.then(() => undefined, () => undefined);
    queueByActor.set(actorKey, settled);
    void settled.finally(() => {
        if (actorOperations.get(operationKey) === promise) {
            actorOperations.delete(operationKey);
        }
        if (actorOperations.size === 0 && inFlightByActor.get(actorKey) === actorOperations) {
            inFlightByActor.delete(actorKey);
        }
        if (queueByActor.get(actorKey) === settled) {
            queueByActor.delete(actorKey);
        }
    });
    return promise;
}
function draftApplyOperationKey(draft, steps) {
    return JSON.stringify({
        draft,
        steps,
    });
}
export { DraftApplyPhaseError } from "./actor-updater/prepared-draft-application.js";
//# sourceMappingURL=actor-updater.js.map