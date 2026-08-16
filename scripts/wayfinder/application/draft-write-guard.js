import { DRAFT_FLAG, MODULE_ID } from "../../constants.js";
import { normalizeDraft } from "../../draft-service.js";
import { assertRecoveryDraftWriteAllowed, buildSaveDraftUpdate, hasApplyRecoveryState, WayfinderRecoveryDraftConflictError, } from "./draft-lifecycle-service.js";
export class WayfinderDraftWriteConflictError extends Error {
    constructor() {
        super("This actor's Wayfinder draft changed in another window. Reopen Wayfinder before saving over it.");
        this.name = "WayfinderDraftWriteConflictError";
    }
}
export class PersistedDraftWriteGuard {
    #expectedFingerprint;
    constructor(initialSnapshot) {
        this.#expectedFingerprint = persistedDraftFingerprint(initialSnapshot);
    }
    assertCurrent(currentSnapshot) {
        if (persistedDraftFingerprint(currentSnapshot) !== this.#expectedFingerprint) {
            throw new WayfinderDraftWriteConflictError();
        }
    }
    acceptCurrent(currentSnapshot) {
        this.#expectedFingerprint = persistedDraftFingerprint(currentSnapshot);
    }
}
export function readPersistedDraftSnapshot(actor, currentLevel) {
    const rawDraft = actor.getFlag(MODULE_ID, "draft");
    return rawDraft === null || rawDraft === undefined ? null : normalizeDraft(rawDraft, currentLevel);
}
export async function saveDraftWithWriteGuard(actor, candidateDraft, currentLevel, guard) {
    const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
    guard.assertCurrent(liveDraft);
    if (liveDraft) {
        assertRecoveryDraftWriteAllowed(liveDraft, candidateDraft);
    }
    const update = buildSaveDraftUpdate(candidateDraft);
    const expectedDraft = normalizeDraft(update[DRAFT_FLAG], currentLevel);
    let updateRejected = false;
    let updateFailure;
    try {
        await actor.update(update);
    }
    catch (error) {
        updateRejected = true;
        updateFailure = error;
    }
    const observedDraft = readPersistedDraftSnapshot(actor, currentLevel);
    if (persistedDraftFingerprint(observedDraft) === persistedDraftFingerprint(expectedDraft)) {
        guard.acceptCurrent(observedDraft);
        return;
    }
    if (updateRejected) {
        throw updateFailure;
    }
    throw new Error("Foundry did not persist Wayfinder's complete draft candidate.");
}
export async function clearDraftWithWriteGuard(actor, currentLevel, guard) {
    const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
    guard.assertCurrent(liveDraft);
    if (liveDraft && hasApplyRecoveryState(liveDraft)) {
        throw new WayfinderRecoveryDraftConflictError();
    }
    let updateRejected = false;
    let updateFailure;
    try {
        await actor.update({ [DRAFT_FLAG]: null });
    }
    catch (error) {
        updateRejected = true;
        updateFailure = error;
    }
    const observedDraft = readPersistedDraftSnapshot(actor, currentLevel);
    if (observedDraft === null) {
        guard.acceptCurrent(null);
        return;
    }
    if (updateRejected) {
        throw updateFailure;
    }
    throw new Error("Foundry did not clear the Wayfinder draft.");
}
export function assertDraftSideEffectAllowed(actor, currentLevel, guard) {
    const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
    guard.assertCurrent(liveDraft);
    if (liveDraft && hasApplyRecoveryState(liveDraft)) {
        throw new WayfinderRecoveryDraftConflictError();
    }
}
function persistedDraftFingerprint(snapshot) {
    return snapshot === null ? "null" : JSON.stringify(snapshot);
}
//# sourceMappingURL=draft-write-guard.js.map