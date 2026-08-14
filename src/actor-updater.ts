import {
  type DraftApplyPhase,
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "./actor-updater/prepared-draft-application.js";
import type { SelectorActorLike } from "./selector-application.js";
import type { ActorLike } from "./shared/actor-model.js";
import type { DraftState, PendingStep, SelectionRef } from "./types.js";

type DraftMutationActor = SelectorActorLike &
  ActorLike & {
    update?: ActorLike["update"];
  };

export interface ApplyDraftOptions {
  beforePhase?: (phase: DraftApplyPhase) => void | Promise<void>;
  finalActorUpdate?: Record<string, unknown>;
  validateActorAuthority?: (actor: DraftMutationActor) => boolean;
  validateSelectionEligibility?: (selection: SelectionRef, step: PendingStep) => boolean | Promise<boolean>;
  validSkillSlugs?: ReadonlySet<string>;
}

const inFlightByActor = new WeakMap<object, Map<string, Promise<Record<string, unknown>>>>();
const queueByActor = new WeakMap<object, Promise<void>>();

export function applyDraftToActor(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  options: ApplyDraftOptions = {}
): Promise<Record<string, unknown>> {
  const actorKey = actor as object;
  const operationKey = draftApplyOperationKey(draft, steps);
  const actorOperations = inFlightByActor.get(actorKey) ?? new Map<string, Promise<Record<string, unknown>>>();
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
  const settled = promise.then(
    () => undefined,
    () => undefined
  );
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

function draftApplyOperationKey(draft: DraftState, steps: PendingStep[]): string {
  return JSON.stringify({
    draft,
    steps,
  });
}

export type { DraftApplyPhase } from "./actor-updater/prepared-draft-application.js";
export { DraftApplyPhaseError } from "./actor-updater/prepared-draft-application.js";
