import { DRAFT_FLAG, MODULE_ID } from "../../constants.js";
import { normalizeDraft } from "../../draft-service.js";
import type { DraftState } from "../../types.js";
import {
  assertRecoveryDraftWriteAllowed,
  buildSaveDraftUpdate,
  hasApplyRecoveryState,
  WayfinderRecoveryDraftConflictError,
} from "./draft-lifecycle-service.js";

export type PersistedDraftSnapshot = DraftState | null;

export interface DraftFlagActor {
  getFlag: (scope: string, key: string) => unknown;
  update: (updates: Record<string, unknown>, operation?: Record<string, unknown>) => Promise<unknown>;
}

interface ActiveDraftWriteGuardOperation {
  actor: DraftFlagActor;
  assertCurrent: () => void;
  observed: boolean;
  blocked: boolean;
  failure: unknown;
}

const DRAFT_WRITE_GUARD_OPERATION_OPTION = "wayfinderPf2eDraftWriteGuardOperationId";
const activeDraftWriteGuardOperations = new Map<string, ActiveDraftWriteGuardOperation>();
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

export class PersistedDraftWriteGuard {
  #expectedFingerprint: string;

  constructor(initialSnapshot: PersistedDraftSnapshot) {
    this.#expectedFingerprint = persistedDraftFingerprint(initialSnapshot);
  }

  assertCurrent(currentSnapshot: PersistedDraftSnapshot): void {
    if (persistedDraftFingerprint(currentSnapshot) !== this.#expectedFingerprint) {
      throw new WayfinderDraftWriteConflictError();
    }
  }

  captureExpectation(): (currentSnapshot: PersistedDraftSnapshot) => void {
    const expectedFingerprint = this.#expectedFingerprint;
    return (currentSnapshot) => {
      if (persistedDraftFingerprint(currentSnapshot) !== expectedFingerprint) {
        throw new WayfinderDraftWriteConflictError();
      }
    };
  }

  acceptCurrent(currentSnapshot: PersistedDraftSnapshot): void {
    this.#expectedFingerprint = persistedDraftFingerprint(currentSnapshot);
  }
}

export function registerPersistedDraftWriteGuardHook(): void {
  if (draftWriteGuardHookRegistered) return;
  Hooks.on("preUpdateActor", evaluatePersistedDraftWriteGuardHook);
  draftWriteGuardHookRegistered = true;
}

export function evaluatePersistedDraftWriteGuardHook(
  actor: DraftFlagActor,
  _changes: unknown,
  operation: unknown
): boolean | void {
  if (!isRecord(operation)) return;
  const operationId = operation[DRAFT_WRITE_GUARD_OPERATION_OPTION];
  if (typeof operationId !== "string") return;
  const activeOperation = activeDraftWriteGuardOperations.get(operationId);
  if (!activeOperation) return;
  activeOperation.observed = true;
  if (activeOperation.actor !== actor) {
    activeOperation.blocked = true;
    activeOperation.failure = new WayfinderDraftWriteConflictError();
    return false;
  }

  try {
    activeOperation.assertCurrent();
  } catch (error) {
    activeOperation.blocked = true;
    activeOperation.failure = error;
    return false;
  }
}

export async function updateActorWithPersistedDraftPrecondition(
  actor: DraftFlagActor,
  updates: Record<string, unknown>,
  assertCurrent: () => void
): Promise<unknown> {
  let operationId: string;
  do {
    operationId = `${MODULE_ID}:${nextDraftWriteGuardOperationId++}`;
  } while (activeDraftWriteGuardOperations.has(operationId));
  const activeOperation: ActiveDraftWriteGuardOperation = {
    actor,
    assertCurrent,
    observed: false,
    blocked: false,
    failure: null,
  };
  activeDraftWriteGuardOperations.set(operationId, activeOperation);
  try {
    assertCurrent();
    let updatedActor: unknown;
    let updateRejected = false;
    let updateFailure: unknown;
    try {
      updatedActor = await actor.update(updates, {
        [DRAFT_WRITE_GUARD_OPERATION_OPTION]: operationId,
      });
    } catch (error) {
      updateRejected = true;
      updateFailure = error;
    }
    if (activeOperation.blocked) {
      throw activeOperation.failure;
    }
    if (draftWriteGuardHookRegistered && !activeOperation.observed) {
      throw new WayfinderDraftPreUpdateGuardUnavailableError();
    }
    if (updateRejected) {
      throw updateFailure;
    }
    return updatedActor;
  } finally {
    activeDraftWriteGuardOperations.delete(operationId);
  }
}

export function assertFailedApplyRecoveryCandidateCurrent(
  guard: PersistedDraftWriteGuard,
  currentSnapshot: PersistedDraftSnapshot,
  failedPhase: string | null
): void {
  // Before finalize-actor, Wayfinder has not written the draft flag as part of
  // Apply. Any changed candidate therefore came from another client and must
  // not be accepted as the new baseline for a recovery save. Finalize errors
  // are handled separately because a partial final update can be Wayfinder's
  // own draft clear and still require restoration.
  if (failedPhase !== "finalize-actor") {
    guard.assertCurrent(currentSnapshot);
  }
}

export function readPersistedDraftSnapshot(actor: DraftFlagActor, currentLevel: number): PersistedDraftSnapshot {
  const rawDraft = actor.getFlag(MODULE_ID, "draft");
  return rawDraft === null || rawDraft === undefined ? null : normalizeDraft(rawDraft, currentLevel);
}

export async function saveDraftWithWriteGuard(
  actor: DraftFlagActor,
  candidateDraft: DraftState,
  currentLevel: number,
  guard: PersistedDraftWriteGuard
): Promise<void> {
  const assertExpected = guard.captureExpectation();
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
  let updateFailure: unknown;
  try {
    await updateActorWithPersistedDraftPrecondition(actor, update, assertCurrent);
  } catch (error) {
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
  if (updateRejected) {
    throw updateFailure;
  }
  throw new Error("Foundry did not persist Wayfinder's complete draft candidate.");
}

export async function clearDraftWithWriteGuard(
  actor: DraftFlagActor,
  currentLevel: number,
  guard: PersistedDraftWriteGuard
): Promise<void> {
  const assertExpected = guard.captureExpectation();
  const assertCurrent = () => {
    const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
    assertExpected(liveDraft);
    if (liveDraft && hasApplyRecoveryState(liveDraft)) {
      throw new WayfinderRecoveryDraftConflictError();
    }
  };

  let updateRejected = false;
  let updateFailure: unknown;
  try {
    await updateActorWithPersistedDraftPrecondition(actor, { [DRAFT_FLAG]: null }, assertCurrent);
  } catch (error) {
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

export function assertDraftSideEffectAllowed(
  actor: DraftFlagActor,
  currentLevel: number,
  guard: PersistedDraftWriteGuard
): void {
  const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
  guard.assertCurrent(liveDraft);
  if (liveDraft && hasApplyRecoveryState(liveDraft)) {
    throw new WayfinderRecoveryDraftConflictError();
  }
}

export function capturePersistedDraftPrecondition(
  actor: DraftFlagActor,
  currentLevel: number,
  guard: PersistedDraftWriteGuard
): () => void {
  const assertExpected = guard.captureExpectation();
  return () => assertExpected(readPersistedDraftSnapshot(actor, currentLevel));
}

export function captureDraftSideEffectPrecondition(
  actor: DraftFlagActor,
  currentLevel: number,
  guard: PersistedDraftWriteGuard
): () => void {
  const assertExpected = guard.captureExpectation();
  return () => {
    const liveDraft = readPersistedDraftSnapshot(actor, currentLevel);
    assertExpected(liveDraft);
    if (liveDraft && hasApplyRecoveryState(liveDraft)) {
      throw new WayfinderRecoveryDraftConflictError();
    }
  };
}

function persistedDraftFingerprint(snapshot: PersistedDraftSnapshot): string {
  return snapshot === null ? "null" : JSON.stringify(snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
