import type { DraftState, ModuleState } from "./types.js";

const DRAFT_VERSION = 1;
const STATE_VERSION = 1;

export function createEmptyDraft(targetLevel = 1): DraftState {
  return {
    version: DRAFT_VERSION,
    targetLevel: clampLevel(targetLevel),
    selections: {},
    manual: {},
    updatedAt: null
  };
}

export function createEmptyState(): ModuleState {
  return {
    version: STATE_VERSION,
    lastAppliedAt: null,
    lastTargetLevel: null,
    completedStepIds: []
  };
}

export function normalizeDraft(raw: unknown, fallbackTargetLevel: number): DraftState {
  const draft = isRecord(raw) ? raw as Partial<DraftState> : {};

  return {
    version: DRAFT_VERSION,
    targetLevel: clampLevel(typeof draft.targetLevel === "number" ? draft.targetLevel : fallbackTargetLevel),
    selections: sanitizeSelections(draft.selections),
    manual: sanitizeManual(draft.manual),
    updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : null
  };
}

export function normalizeState(raw: unknown): ModuleState {
  const state = isRecord(raw) ? raw as Partial<ModuleState> : {};

  return {
    version: STATE_VERSION,
    lastAppliedAt: typeof state.lastAppliedAt === "string" ? state.lastAppliedAt : null,
    lastTargetLevel: typeof state.lastTargetLevel === "number" ? clampLevel(state.lastTargetLevel) : null,
    completedStepIds: Array.isArray(state.completedStepIds)
      ? state.completedStepIds.filter((value): value is string => typeof value === "string")
      : []
  };
}

export function buildDraftPatch(draft: DraftState): DraftState {
  return {
    ...draft,
    version: DRAFT_VERSION,
    updatedAt: new Date().toISOString()
  };
}

function sanitizeSelections(raw: unknown): DraftState["selections"] {
  if (!isRecord(raw)) {
    return {};
  }

  const result: DraftState["selections"] = {};
  for (const slotId of Object.keys(raw)) {
    const value = raw[slotId];
    if (!isRecord(value)) {
      continue;
    }

    const selection = value as Record<string, unknown>;
    const packId = selection.packId;
    const documentId = selection.documentId;
    const uuid = selection.uuid;
    const name = selection.name;

    if (typeof packId !== "string" || typeof documentId !== "string" || typeof uuid !== "string" || typeof name !== "string") {
      continue;
    }

    result[slotId] = {
      slotId,
      packId,
      documentId,
      uuid,
      itemType: typeof selection.itemType === "string" ? selection.itemType : "",
      featType: typeof selection.featType === "string" ? selection.featType : null,
      name,
      level: typeof selection.level === "number" ? clampLevel(selection.level) : null
    };
  }

  return result;
}

function sanitizeManual(raw: unknown): DraftState["manual"] {
  if (!isRecord(raw)) {
    return {};
  }

  const result: DraftState["manual"] = {};
  for (const stepId of Object.keys(raw)) {
    const value = raw[stepId];
    result[stepId] = value === true;
  }
  return result;
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }

  return Math.min(20, Math.max(1, Math.floor(level)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
