import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
import type { DraftState, ExistingCharacterHistory, PendingStep } from "../../types.js";
import {
  evaluateWayfinderDraftReadiness,
  type WayfinderStepEvaluation,
  type WayfinderStepIssue,
} from "../domain/step-evaluation.js";

export interface ApplyDraftLifecycleArgs {
  actorName: string;
  currentLevel: number;
  draft: DraftState;
  existingCompletedStepIds?: string[];
  existingCharacterHistory?: ExistingCharacterHistory | null;
  steps: PendingStep[];
  evaluateStep: (step: PendingStep) => Promise<WayfinderStepEvaluation>;
  confirmApply?: (message: string) => boolean | Promise<boolean>;
  applyDraftToActor: (finalActorUpdate: Record<string, unknown>) => Promise<void>;
  now?: () => string;
}

export type ApplyDraftLifecycleResult =
  | { kind: "warning"; warning: "draft-not-ready" | "no-pending-steps"; blockers: WayfinderStepIssue[] }
  | { kind: "cancelled" }
  | { kind: "applied"; nextDraft: DraftState };

export async function applyDraftLifecycle(args: ApplyDraftLifecycleArgs): Promise<ApplyDraftLifecycleResult> {
  if (args.steps.length === 0) {
    return {
      kind: "warning",
      warning: "no-pending-steps",
      blockers: [],
    };
  }

  const readiness = await evaluateWayfinderDraftReadiness(args.steps, args.evaluateStep);
  if (!readiness.ready) {
    return {
      kind: "warning",
      warning: "draft-not-ready",
      blockers: readiness.blockers,
    };
  }

  const confirmed =
    (await args.confirmApply?.(buildApplyConfirmationMessage(args.actorName, args.steps.length))) ?? true;
  if (!confirmed) {
    return {
      kind: "cancelled",
    };
  }

  const completedStepIds = mergeCompletedStepIds(args.existingCompletedStepIds ?? [], args.steps);
  await args.applyDraftToActor({
    [DRAFT_FLAG]: null,
    [STATE_FLAG]: {
      ...createEmptyState(),
      lastAppliedAt: (args.now ?? defaultNow)(),
      lastTargetLevel: args.draft.targetLevel,
      completedStepIds,
      existingCharacterHistory: args.existingCharacterHistory ?? null,
    },
  });

  return {
    kind: "applied",
    nextDraft: normalizeDraft(null, args.currentLevel),
  };
}

function mergeCompletedStepIds(existingStepIds: string[], steps: PendingStep[]): string[] {
  return Array.from(
    new Set([
      ...existingStepIds.filter((stepId) => typeof stepId === "string" && stepId.length > 0),
      ...steps.map((step) => step.id),
    ])
  );
}

export function buildSaveDraftUpdate(draft: DraftState): Record<string, unknown> {
  return {
    [DRAFT_FLAG]: buildDraftPatch(draft),
  };
}

export function createClearedDraftResult(currentLevel: number): {
  nextDraft: DraftState;
  actorUpdate: Record<string, unknown>;
} {
  return {
    nextDraft: createEmptyDraft(currentLevel),
    actorUpdate: {
      [DRAFT_FLAG]: null,
    },
  };
}

function buildApplyConfirmationMessage(actorName: string, stepCount: number): string {
  return `Apply ${stepCount} Wayfinder step(s) to ${actorName}?`;
}

function defaultNow(): string {
  return new Date().toISOString();
}
