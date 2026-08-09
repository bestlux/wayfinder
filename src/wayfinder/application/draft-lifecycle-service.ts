import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
import type { DraftState, ExistingCharacterHistory, PendingStep } from "../../types.js";

export interface ApplyDraftLifecycleArgs {
  actorName: string;
  currentLevel: number;
  draft: DraftState;
  existingCompletedStepIds?: string[];
  existingCharacterHistory?: ExistingCharacterHistory | null;
  steps: PendingStep[];
  isStepComplete: (step: PendingStep) => Promise<boolean>;
  confirmApply?: (message: string) => boolean | Promise<boolean>;
  applyDraftToActor: () => Promise<Record<string, unknown> | void>;
  updateActor: (update: Record<string, unknown>) => Promise<void>;
  applyTimeoutMs?: number;
  now?: () => string;
}

export const DEFAULT_APPLY_TIMEOUT_MS = 30_000;

export type ApplyDraftLifecycleResult =
  | { kind: "warning"; warning: "missing-selections" | "no-pending-steps" }
  | { kind: "cancelled" }
  | { kind: "applied"; nextDraft: DraftState };

export async function applyDraftLifecycle(args: ApplyDraftLifecycleArgs): Promise<ApplyDraftLifecycleResult> {
  if (args.steps.length === 0) {
    return {
      kind: "warning",
      warning: "no-pending-steps",
    };
  }

  const completion = await Promise.all(args.steps.map((step) => args.isStepComplete(step)));
  if (completion.some((value) => !value)) {
    return {
      kind: "warning",
      warning: "missing-selections",
    };
  }

  const confirmed =
    (await args.confirmApply?.(buildApplyConfirmationMessage(args.actorName, args.steps.length))) ?? true;
  if (!confirmed) {
    return {
      kind: "cancelled",
    };
  }

  return withTimeout(completeApply(args), args.applyTimeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS, args.actorName);
}

async function completeApply(args: ApplyDraftLifecycleArgs): Promise<ApplyDraftLifecycleResult> {
  const actorUpdate = (await args.applyDraftToActor()) ?? {};
  const completedStepIds = mergeCompletedStepIds(args.existingCompletedStepIds ?? [], args.steps);
  await args.updateActor({
    ...actorUpdate,
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, actorName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Applying the Wayfinder draft to ${actorName} did not finish within ${timeoutMs}ms. The actor may be partially updated.`
        )
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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
