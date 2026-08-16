export class WayfinderApplyDriftError extends Error {
    constructor(message) {
        super(message);
        this.name = "WayfinderApplyDriftError";
    }
}
export async function assertApplyCandidateCurrent(args) {
    if (fingerprint(args.currentDraft()) !== fingerprint(args.draftSnapshot)) {
        throw new WayfinderApplyDriftError("The draft changed while Apply was being confirmed. Review the latest choices and apply again.");
    }
    const currentActor = args.inspectCurrentActor();
    const currentState = args.readCurrentState();
    const currentSteps = await args.buildCurrentSteps(currentActor, args.draftSnapshot);
    const actorStateChanged = currentActor.level !== args.actorSnapshot.level ||
        fingerprint(currentActor.skillRanks) !== fingerprint(args.actorSnapshot.skillRanks);
    if (actorStateChanged ||
        fingerprint(currentState) !== fingerprint(args.stateSnapshot) ||
        fingerprint(currentSteps) !== fingerprint(args.stepSnapshots)) {
        throw new WayfinderApplyDriftError("The actor or Wayfinder plan changed while Apply was being confirmed. Review the refreshed plan and try again.");
    }
}
export async function persistApplyCandidateIfCurrent(args, persistCandidate) {
    await assertApplyCandidateCurrent(args);
    await persistCandidate();
}
function fingerprint(value) {
    return JSON.stringify(value);
}
//# sourceMappingURL=apply-candidate-service.js.map