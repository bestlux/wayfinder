import { DRAFT_FLAG, MODULE_ID } from "../../constants.js";
import { normalizeDraft } from "../../draft-service.js";
import { assertRecoveryDraftWriteAllowed, buildSaveDraftUpdate, hasApplyRecoveryState, WayfinderRecoveryDraftConflictError, } from "./draft-lifecycle-service.js";
const DRAFT_WRITE_GUARD_OPERATION_OPTION = "wayfinderPf2eDraftWriteGuardOperationId";
const activeDraftWriteGuardOperations = new Map();
let draftWriteGuardHookRegistered = false;
let nextDraftWriteGuardOperationId = 1;
export class WayfinderDraftWriteConflictError extends Error {
    constructor() {
        super("This actor's Wayfinder draft changed in another window. Reopen Wayfinder before saving over it.");
        this.name = "WayfinderDraftWriteConflictError";
    }
}
export class WayfinderDraftPreUpdateGuardUnavailableError extends Error {
    constructor() {
        super("Foundry did not run Wayfinder's persisted-draft pre-update guard.");
        this.name = "WayfinderDraftPreUpdateGuardUnavailableError";
    }
}
export class WayfinderDraftRoundTripError extends Error {
    constructor(outcome, options = {}) {
        super(outcome === "unchanged"
            ? "Foundry did not persist the complete draft. The last durable draft remains intact; reopen before continuing."
            : outcome === "restored"
                ? "Foundry altered the draft while saving. Wayfinder restored the last durable draft; reopen before continuing."
                : "Foundry altered the draft while saving, and Wayfinder could not prove that the last durable draft was restored.", options);
        this.name = "WayfinderDraftRoundTripError";
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
    captureExpectation() {
        const expectedFingerprint = this.#expectedFingerprint;
        return (currentSnapshot) => {
            if (persistedDraftFingerprint(currentSnapshot) !== expectedFingerprint) {
                throw new WayfinderDraftWriteConflictError();
            }
        };
    }
    acceptCurrent(currentSnapshot) {
        this.#expectedFingerprint = persistedDraftFingerprint(currentSnapshot);
    }
}
export function registerPersistedDraftWriteGuardHook() {
    if (draftWriteGuardHookRegistered)
        return;
    Hooks.on("preUpdateActor", evaluatePersistedDraftWriteGuardHook);
    draftWriteGuardHookRegistered = true;
}
export function evaluatePersistedDraftWriteGuardHook(actor, _changes, operation) {
    if (!isRecord(operation))
        return;
    const operationId = operation[DRAFT_WRITE_GUARD_OPERATION_OPTION];
    if (typeof operationId !== "string")
        return;
    const activeOperation = activeDraftWriteGuardOperations.get(operationId);
    if (!activeOperation)
        return;
    activeOperation.observed = true;
    if (activeOperation.actor !== actor) {
        activeOperation.blocked = true;
        activeOperation.failure = new WayfinderDraftWriteConflictError();
        return false;
    }
    try {
        activeOperation.assertCurrent();
    }
    catch (error) {
        activeOperation.blocked = true;
        activeOperation.failure = error;
        return false;
    }
}
export async function updateActorWithPersistedDraftPrecondition(actor, updates, assertCurrent, operation = {}) {
    let operationId;
    do {
        operationId = `${MODULE_ID}:${nextDraftWriteGuardOperationId++}`;
    } while (activeDraftWriteGuardOperations.has(operationId));
    const activeOperation = {
        actor,
        assertCurrent,
        observed: false,
        blocked: false,
        failure: null,
    };
    activeDraftWriteGuardOperations.set(operationId, activeOperation);
    try {
        assertCurrent();
        let updatedActor;
        let updateRejected = false;
        let updateFailure;
        try {
            updatedActor = await actor.update(updates, {
                ...operation,
                [DRAFT_WRITE_GUARD_OPERATION_OPTION]: operationId,
            });
        }
        catch (error) {
            updateRejected = true;
            updateFailure = error;
        }
        if (activeOperation.blocked) {
            throw activeOperation.failure;
        }
        if (updateRejected) {
            throw updateFailure;
        }
        if (draftWriteGuardHookRegistered && !activeOperation.observed) {
            throw new WayfinderDraftPreUpdateGuardUnavailableError();
        }
        return updatedActor;
    }
    finally {
        activeDraftWriteGuardOperations.delete(operationId);
    }
}
export function assertFailedApplyRecoveryCandidateCurrent(guard, currentSnapshot, failedPhase) {
    // Before finalize-actor, Wayfinder has not written the draft flag as part of
    // Apply. Any changed candidate therefore came from another client and must
    // not be accepted as the new baseline for a recovery save. Finalize errors
    // are handled separately because a partial final update can be Wayfinder's
    // own draft clear and still require restoration.
    if (failedPhase !== "finalize-actor") {
        guard.assertCurrent(currentSnapshot);
    }
}
export function readPersistedDraftSnapshot(actor, currentLevel) {
    const rawDraft = actor.getFlag(MODULE_ID, "draft");
    return rawDraft === null || rawDraft === undefined ? null : normalizeDraft(rawDraft, currentLevel);
}
export async function saveDraftWithWriteGuard(actor, candidateDraft, currentLevel, guard) {
    const assertExpected = guard.captureExpectation();
    const durableBeforeSave = readPersistedDraftSnapshot(actor, currentLevel);
    assertExpected(durableBeforeSave);
    if (persistedDraftContentFingerprint(durableBeforeSave) === persistedDraftContentFingerprint(candidateDraft)) {
        guard.acceptCurrent(durableBeforeSave);
        return;
    }
    const assertCurrent = () => {
        const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
        assertExpected(liveDraft);
        if (liveDraft) {
            assertRecoveryDraftWriteAllowed(liveDraft, candidateDraft);
        }
    };
    const update = buildSaveDraftUpdate(candidateDraft);
    const expectedDraft = normalizeDraft(update[DRAFT_FLAG], currentLevel);
    let updateRejected = false;
    let updateFailure;
    try {
        await updateActorWithPersistedDraftPrecondition(actor, update, assertCurrent, {
            recursive: false,
            render: false,
        });
    }
    catch (error) {
        updateRejected = true;
        updateFailure = error;
    }
    if (updateFailure instanceof WayfinderDraftPreUpdateGuardUnavailableError) {
        throw updateFailure;
    }
    const observedDraft = readPersistedDraftSnapshot(actor, currentLevel);
    if (persistedDraftFingerprint(observedDraft) === persistedDraftFingerprint(expectedDraft)) {
        guard.acceptCurrent(observedDraft);
        return;
    }
    if (persistedDraftFingerprint(observedDraft) === persistedDraftFingerprint(durableBeforeSave)) {
        if (updateRejected)
            throw updateFailure;
        throw new WayfinderDraftRoundTripError("unchanged");
    }
    if (snapshotCarriesAttemptIdentity(observedDraft, expectedDraft)) {
        try {
            await restoreDurableDraft(actor, currentLevel, observedDraft, durableBeforeSave);
            guard.acceptCurrent(durableBeforeSave);
        }
        catch (restoreError) {
            throw new WayfinderDraftRoundTripError("unproven", { cause: restoreError });
        }
        throw new WayfinderDraftRoundTripError("restored", { cause: updateRejected ? updateFailure : undefined });
    }
    if (updateRejected) {
        throw updateFailure;
    }
    throw new WayfinderDraftRoundTripError("unproven");
}
export async function clearDraftWithWriteGuard(actor, currentLevel, guard) {
    const assertExpected = guard.captureExpectation();
    const assertCurrent = () => {
        const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
        assertExpected(liveDraft);
        if (liveDraft && hasApplyRecoveryState(liveDraft)) {
            throw new WayfinderRecoveryDraftConflictError();
        }
    };
    let updateRejected = false;
    let updateFailure;
    try {
        await updateActorWithPersistedDraftPrecondition(actor, { [DRAFT_FLAG]: null }, assertCurrent);
    }
    catch (error) {
        updateRejected = true;
        updateFailure = error;
    }
    if (updateFailure instanceof WayfinderDraftPreUpdateGuardUnavailableError) {
        throw updateFailure;
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
export function capturePersistedDraftPrecondition(actor, currentLevel, guard) {
    const assertExpected = guard.captureExpectation();
    return () => assertExpected(readPersistedDraftSnapshot(actor, currentLevel));
}
export function captureDraftSideEffectPrecondition(actor, currentLevel, guard) {
    const assertExpected = guard.captureExpectation();
    return () => {
        const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
        assertExpected(liveDraft);
        if (liveDraft && hasApplyRecoveryState(liveDraft)) {
            throw new WayfinderRecoveryDraftConflictError();
        }
    };
}
function persistedDraftFingerprint(snapshot) {
    return snapshot === null ? "null" : JSON.stringify(snapshot);
}
function persistedDraftContentFingerprint(snapshot) {
    return snapshot === null ? "null" : JSON.stringify({ ...snapshot, updatedAt: null });
}
function snapshotCarriesAttemptIdentity(observedDraft, expectedDraft) {
    return (observedDraft !== null &&
        expectedDraft !== null &&
        typeof expectedDraft.updatedAt === "string" &&
        expectedDraft.updatedAt.length > 0 &&
        observedDraft.updatedAt === expectedDraft.updatedAt);
}
async function restoreDurableDraft(actor, currentLevel, rejectedDraft, durableDraft) {
    const rejectedFingerprint = persistedDraftFingerprint(rejectedDraft);
    const assertRejectedCurrent = () => {
        if (persistedDraftFingerprint(readPersistedDraftSnapshot(actor, currentLevel)) !== rejectedFingerprint) {
            throw new WayfinderDraftWriteConflictError();
        }
    };
    const update = durableDraft === null ? { [DRAFT_FLAG]: null } : buildSaveDraftUpdate(durableDraft);
    if (durableDraft !== null && isRecord(update[DRAFT_FLAG])) {
        update[DRAFT_FLAG].updatedAt = durableDraft.updatedAt;
    }
    await updateActorWithPersistedDraftPrecondition(actor, update, assertRejectedCurrent, {
        recursive: false,
        render: false,
    });
    const restoredDraft = readPersistedDraftSnapshot(actor, currentLevel);
    if (persistedDraftFingerprint(restoredDraft) !== persistedDraftFingerprint(durableDraft)) {
        throw new Error("Foundry did not restore the exact last durable Wayfinder draft.");
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=draft-write-guard.js.map