import { DRAFT_FLAG, MODULE_ID, STATE_FLAG } from "../../constants.js";
import { normalizeState } from "../../draft-service.js";
import { cloneData } from "../../shared/cloning.js";
import { forceFoundryLeafReplacement } from "../../shared/foundry-data-operators.js";
import type { DraftState, ExistingCharacterHistory, ModuleState } from "../../types.js";
import { buildSaveDraftUpdate } from "./draft-lifecycle-service.js";
import type { DraftFlagActor, PersistedDraftWriteGuard } from "./draft-write-guard.js";
import {
  captureDraftSideEffectPrecondition,
  readPersistedDraftSnapshot,
  updateActorWithPersistedDraftPrecondition,
} from "./draft-write-guard.js";
import { withExistingCharacterHistory } from "./existing-character-history-service.js";

export class ExistingCharacterImportRoundTripError extends Error {
  constructor() {
    super("Foundry did not persist the imported history and cleared equipment draft together.");
    this.name = "ExistingCharacterImportRoundTripError";
  }
}

export function clearAcquisitionForExistingCharacterImport(draft: DraftState): DraftState {
  return {
    ...cloneData(draft),
    acquisition: null,
    acquisitionCorrupt: false,
    equipmentPolicyRequests: [],
  };
}

export function hasExecutableAcquisition(draft: DraftState, state: ModuleState): boolean {
  return draft.acquisition !== null && state.existingCharacterHistory === null;
}

export async function persistExistingCharacterImport(args: {
  actor: DraftFlagActor;
  currentLevel: number;
  guard: PersistedDraftWriteGuard;
  draft: DraftState;
  state: ModuleState;
  history: ExistingCharacterHistory;
}): Promise<DraftState> {
  const nextDraft = clearAcquisitionForExistingCharacterImport(args.draft);
  const nextState = withExistingCharacterHistory(args.state, args.history);
  const assertCurrent = captureDraftSideEffectPrecondition(args.actor, args.currentLevel, args.guard);
  const draftUpdate = buildSaveDraftUpdate(nextDraft);

  await updateActorWithPersistedDraftPrecondition(
    args.actor,
    {
      [DRAFT_FLAG]: forceFoundryLeafReplacement(draftUpdate[DRAFT_FLAG]),
      [STATE_FLAG]: forceFoundryLeafReplacement(nextState),
    },
    assertCurrent,
    { render: false }
  );

  const persistedDraft = readPersistedDraftSnapshot(args.actor, args.currentLevel);
  const persistedState = normalizeState(args.actor.getFlag(MODULE_ID, "state"));
  if (
    !persistedDraft ||
    persistedDraft.acquisition !== null ||
    persistedDraft.acquisitionCorrupt ||
    persistedDraft.equipmentPolicyRequests.length > 0 ||
    draftContentFingerprint(persistedDraft) !== draftContentFingerprint(nextDraft) ||
    JSON.stringify(persistedState.existingCharacterHistory) !== JSON.stringify(args.history)
  ) {
    throw new ExistingCharacterImportRoundTripError();
  }

  args.guard.acceptCurrent(persistedDraft);
  return cloneData(persistedDraft);
}

function draftContentFingerprint(draft: DraftState): string {
  return JSON.stringify({ ...draft, updatedAt: null });
}
