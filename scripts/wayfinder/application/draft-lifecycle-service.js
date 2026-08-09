import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
export const DEFAULT_APPLY_TIMEOUT_MS = 30_000;
export async function applyDraftLifecycle(args) {
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
    const confirmed = (await args.confirmApply?.(buildApplyConfirmationMessage(args.actorName, args.steps.length))) ?? true;
    if (!confirmed) {
        return {
            kind: "cancelled",
        };
    }
    return withTimeout(completeApply(args), args.applyTimeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS, args.actorName);
}
async function completeApply(args) {
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
function withTimeout(promise, timeoutMs, actorName) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Applying the Wayfinder draft to ${actorName} did not finish within ${timeoutMs}ms. The actor may be partially updated.`));
        }, timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
function mergeCompletedStepIds(existingStepIds, steps) {
    return Array.from(new Set([
        ...existingStepIds.filter((stepId) => typeof stepId === "string" && stepId.length > 0),
        ...steps.map((step) => step.id),
    ]));
}
export function buildSaveDraftUpdate(draft) {
    return {
        [DRAFT_FLAG]: buildDraftPatch(draft),
    };
}
export function createClearedDraftResult(currentLevel) {
    return {
        nextDraft: createEmptyDraft(currentLevel),
        actorUpdate: {
            [DRAFT_FLAG]: null,
        },
    };
}
function buildApplyConfirmationMessage(actorName, stepCount) {
    return `Apply ${stepCount} Wayfinder step(s) to ${actorName}?`;
}
function defaultNow() {
    return new Date().toISOString();
}
//# sourceMappingURL=draft-lifecycle-service.js.map