import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
import type { DraftState, PendingStep } from "../../types.js";

export interface ApplyDraftLifecycleArgs {
  actorName: string;
  currentLevel: number;
  draft: DraftState;
  steps: PendingStep[];
  isStepComplete: (step: PendingStep) => Promise<boolean>;
  confirmApply?: (message: string) => boolean;
  applyDraftToActor: () => Promise<Record<string, unknown> | void>;
  updateActor: (update: Record<string, unknown>) => Promise<void>;
  now?: () => string;
}

export type ApplyDraftLifecycleResult =
  | { kind: "warning"; warning: "missing-selections" }
  | { kind: "cancelled" }
  | { kind: "applied"; nextDraft: DraftState };

export async function applyDraftLifecycle(args: ApplyDraftLifecycleArgs): Promise<ApplyDraftLifecycleResult> {
  const completion = await Promise.all(args.steps.map((step) => args.isStepComplete(step)));
  if (completion.some((value) => !value)) {
    return {
      kind: "warning",
      warning: "missing-selections",
    };
  }

  const confirmed = args.confirmApply?.(buildApplyConfirmationMessage(args.actorName, args.steps.length)) ?? true;
  if (!confirmed) {
    return {
      kind: "cancelled",
    };
  }

  const actorUpdate = (await args.applyDraftToActor()) ?? {};
  await args.updateActor({
    ...actorUpdate,
    [DRAFT_FLAG]: null,
    [STATE_FLAG]: {
      ...createEmptyState(),
      lastAppliedAt: (args.now ?? defaultNow)(),
      lastTargetLevel: args.draft.targetLevel,
      completedStepIds: args.steps.map((step) => step.id),
    },
  });

  return {
    kind: "applied",
    nextDraft: normalizeDraft(null, args.currentLevel),
  };
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
