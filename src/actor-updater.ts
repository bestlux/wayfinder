import {
  type DraftApplyCheckpointHook,
  executePreparedDraftApplication,
  executeRecoveredDraftFinalization,
  prepareDraftApplication,
} from "./actor-updater/prepared-draft-application.js";
import type { SelectorActorLike } from "./selector-application.js";
import type { ActorLike } from "./shared/actor-model.js";
import { enqueueActorOperation } from "./shared/actor-operation-queue.js";
import { cloneData } from "./shared/cloning.js";
import type { DraftState, PendingStep, SelectionRef } from "./types.js";

type DraftMutationActor = SelectorActorLike &
  ActorLike & {
    update?: ActorLike["update"];
  };

export interface ApplyDraftOptions {
  beforePrepare?: () => void | Promise<void>;
  onCheckpoint?: DraftApplyCheckpointHook;
  finalActorUpdate?: Record<string, unknown>;
  resolveFinalActorUpdate?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  validateActorAuthority?: (actor: DraftMutationActor) => boolean;
  validateSelectionEligibility?: (selection: SelectionRef, step: PendingStep) => boolean | Promise<boolean>;
  validSkillSlugs?: ReadonlySet<string>;
}

export interface FinalizeRecoveredDraftOptions {
  beforeFinalize?: () => void | Promise<void>;
  onCheckpoint?: DraftApplyCheckpointHook;
  recoveryActorUpdate: Record<string, unknown>;
  resolveFinalActorUpdate: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  validateActorAuthority?: (actor: DraftMutationActor) => boolean;
}

const inFlightByActor = new WeakMap<object, Map<string, Promise<Record<string, unknown>>>>();
const operationIdentityByReference = new WeakMap<object, number>();
let nextOperationIdentity = 1;

export function applyDraftToActor(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  options: ApplyDraftOptions = {}
): Promise<Record<string, unknown>> {
  const actorKey = actor as object;
  const draftSnapshot = cloneData(draft);
  const stepSnapshots = cloneData(steps);
  const finalActorUpdate = options.finalActorUpdate ? cloneData(options.finalActorUpdate) : undefined;
  const operationKey = draftApplyOperationKey(draftSnapshot, stepSnapshots, {
    ...options,
    finalActorUpdate,
  });
  const actorOperations = inFlightByActor.get(actorKey) ?? new Map<string, Promise<Record<string, unknown>>>();
  const inFlight = actorOperations.get(operationKey);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const promise = enqueueActorOperation(actorKey, async () => {
    await options.beforePrepare?.();
    const prepared = await prepareDraftApplication(actor, draftSnapshot, stepSnapshots, {
      validateActorAuthority: options.validateActorAuthority,
      validateSelectionEligibility: options.validateSelectionEligibility,
      validSkillSlugs: options.validSkillSlugs,
    });
    const resolvedFinalActorUpdate = options.resolveFinalActorUpdate
      ? cloneData(await options.resolveFinalActorUpdate())
      : finalActorUpdate;
    const result = await executePreparedDraftApplication(prepared, {
      onCheckpoint: options.onCheckpoint,
      finalActorUpdate: resolvedFinalActorUpdate,
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

export function finalizeRecoveredDraftOnActor(
  actor: DraftMutationActor,
  options: FinalizeRecoveredDraftOptions
): Promise<Record<string, unknown>> {
  return enqueueActorOperation(actor as object, async () => {
    await options.beforeFinalize?.();
    const finalActorUpdate = cloneData(await options.resolveFinalActorUpdate());
    const result = await executeRecoveredDraftFinalization(actor, {
      finalActorUpdate,
      onCheckpoint: options.onCheckpoint,
      recoveryActorUpdate: cloneData(options.recoveryActorUpdate),
      validateActorAuthority: options.validateActorAuthority,
    });
    return result.actorUpdate;
  });
}

function draftApplyOperationKey(draft: DraftState, steps: PendingStep[], options: ApplyDraftOptions): string {
  return JSON.stringify({
    draft,
    steps,
    finalActorUpdate: options.finalActorUpdate ?? null,
    beforePrepare: operationIdentity(options.beforePrepare),
    onCheckpoint: operationIdentity(options.onCheckpoint),
    resolveFinalActorUpdate: operationIdentity(options.resolveFinalActorUpdate),
    validateActorAuthority: operationIdentity(options.validateActorAuthority),
    validateSelectionEligibility: operationIdentity(options.validateSelectionEligibility),
    validSkillSlugs: options.validSkillSlugs ? Array.from(options.validSkillSlugs).sort() : null,
  });
}

function operationIdentity(value: object | undefined): number | null {
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

export type {
  DraftApplyCheckpoint,
  DraftApplyCheckpointHook,
  DraftApplyPhase,
  DraftApplyWriteOperation,
} from "./actor-updater/prepared-draft-application.js";
export { DraftApplyPhaseError } from "./actor-updater/prepared-draft-application.js";
