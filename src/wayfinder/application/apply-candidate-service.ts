import type { DraftState, ModuleState, PendingStep } from "../../types.js";

export interface ApplyActorSnapshot {
  level: number;
  skillRanks: Record<string, number>;
}

export interface AssertApplyCandidateCurrentArgs<TActor extends ApplyActorSnapshot = ApplyActorSnapshot> {
  actorSnapshot: TActor;
  stateSnapshot: ModuleState;
  draftSnapshot: DraftState;
  stepSnapshots: PendingStep[];
  currentDraft: () => DraftState | null;
  inspectCurrentActor: () => TActor;
  readCurrentState: () => ModuleState;
  buildCurrentSteps: (actor: TActor, draft: DraftState) => Promise<PendingStep[]>;
}

export class WayfinderApplyDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WayfinderApplyDriftError";
  }
}

export async function assertApplyCandidateCurrent<TActor extends ApplyActorSnapshot>(
  args: AssertApplyCandidateCurrentArgs<TActor>
): Promise<void> {
  if (fingerprint(args.currentDraft()) !== fingerprint(args.draftSnapshot)) {
    throw new WayfinderApplyDriftError(
      "The draft changed while Apply was being confirmed. Review the latest choices and apply again."
    );
  }

  const currentActor = args.inspectCurrentActor();
  const currentState = args.readCurrentState();
  const currentSteps = await args.buildCurrentSteps(currentActor, args.draftSnapshot);
  const actorStateChanged =
    currentActor.level !== args.actorSnapshot.level ||
    fingerprint(currentActor.skillRanks) !== fingerprint(args.actorSnapshot.skillRanks);
  if (
    actorStateChanged ||
    fingerprint(currentState) !== fingerprint(args.stateSnapshot) ||
    fingerprint(currentSteps) !== fingerprint(args.stepSnapshots)
  ) {
    throw new WayfinderApplyDriftError(
      "The actor or Wayfinder plan changed while Apply was being confirmed. Review the refreshed plan and try again."
    );
  }
}

export async function persistApplyCandidateIfCurrent<TActor extends ApplyActorSnapshot>(
  args: AssertApplyCandidateCurrentArgs<TActor>,
  persistCandidate: () => Promise<void>
): Promise<void> {
  await assertApplyCandidateCurrent(args);
  await persistCandidate();
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}
