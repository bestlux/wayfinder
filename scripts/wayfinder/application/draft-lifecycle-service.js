import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
import { evaluateWayfinderDraftReadiness, } from "../domain/step-evaluation.js";
export async function applyDraftLifecycle(args) {
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
    const confirmed = (await args.confirmApply?.(buildApplyConfirmationMessage(args.actorName, args.steps.length))) ?? true;
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