import { createEmptyDraft } from "../../draft-service.js";
import type { DraftState } from "../../types.js";
import type { DraftSaveState } from "./draft-persistence-service.js";

export type ExternalDraftRefreshDecision = "acknowledge" | "adopt" | "defer" | "conflict";

export interface ExternalDraftRefreshInput {
  localDraft: DraftState | null;
  liveDraft: DraftState | null;
  currentLevel: number;
  saveState: DraftSaveState;
  lifecycleBusy: boolean;
}

export function decideExternalDraftRefresh(input: ExternalDraftRefreshInput): ExternalDraftRefreshDecision {
  const localDraft = input.localDraft ?? createEmptyDraft(input.currentLevel);
  const liveDraft = input.liveDraft ?? createEmptyDraft(input.currentLevel);
  if (draftContentFingerprint(localDraft) === draftContentFingerprint(liveDraft)) {
    return "acknowledge";
  }

  if (input.saveState.phase === "saving" && !input.lifecycleBusy) {
    return "defer";
  }

  const saveIsClean =
    (input.saveState.phase === "idle" || input.saveState.phase === "saved") &&
    input.saveState.revision === input.saveState.durableRevision;
  return saveIsClean && !input.lifecycleBusy ? "adopt" : "conflict";
}

export function actorUpdateTouchesWayfinderDraft(changes: unknown, moduleId: string): boolean {
  if (!isRecord(changes)) {
    return false;
  }
  if (`flags.${moduleId}.draft` in changes) {
    return true;
  }

  const flags = changes.flags;
  if (!isRecord(flags)) {
    return false;
  }
  const moduleFlags = flags[moduleId];
  return isRecord(moduleFlags) && ("draft" in moduleFlags || "-=draft" in moduleFlags);
}

function draftContentFingerprint(draft: DraftState): string {
  return JSON.stringify({ ...draft, updatedAt: null });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
