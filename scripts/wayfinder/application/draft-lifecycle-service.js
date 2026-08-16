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
    await args.beforeApply?.();
    const appliedAt = (args.now ?? defaultNow)();
    await args.applyDraftToActor((currentState) => {
        const completedStepIds = mergeCompletedStepIds(currentState?.completedStepIds ?? args.existingCompletedStepIds ?? [], args.steps);
        return {
            [DRAFT_FLAG]: null,
            [STATE_FLAG]: {
                ...createEmptyState(),
                lastAppliedAt: appliedAt,
                lastTargetLevel: args.draft.targetLevel,
                completedStepIds,
                existingCharacterHistory: currentState
                    ? currentState.existingCharacterHistory
                    : (args.existingCharacterHistory ?? null),
            },
        };
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
export async function clearDraftLifecycle(args) {
    const discardedDecisionCount = countDraftLosses(args.draft, args.currentLevel);
    const confirmed = await args.confirmClear(buildClearDraftConfirmationMessage(discardedDecisionCount));
    if (!confirmed) {
        return { kind: "cancelled" };
    }
    await args.clearPersistedDraft();
    return {
        kind: "cleared",
        nextDraft: createEmptyDraft(args.currentLevel),
        discardedDecisionCount,
    };
}
export function countDraftLosses(draft, currentLevel) {
    let count = draft.targetLevel !== currentLevel ? 1 : 0;
    count += Object.keys(draft.selections).length;
    count += Object.values(draft.manual).filter(Boolean).length;
    count += Object.keys(draft.skillIncreases).length;
    count += Object.keys(draft.branchSelections).length;
    count += Object.keys(draft.classArchetypeChoices).length;
    count += Object.keys(draft.singletonChoices).length;
    count += Object.keys(draft.classChoices).length;
    count += Object.values(draft.languageChoices).reduce((total, values) => total + values.length, 0);
    count += Object.values(draft.spellChoices).reduce((total, values) => total + values.length, 0);
    count += Object.values(draft.spellRarityAccess).filter(Boolean).length;
    for (const training of Object.values(draft.skillTrainings)) {
        count += Object.keys(training.ruleChoices).length;
        count += training.additional.length;
        count += Object.keys(training.loreChoices).length;
    }
    const ancestry = draft.boosts.ancestry;
    count += ancestry.modeTouched ? 1 : 0;
    count += Object.values(ancestry.selectedBoosts).filter((value) => value !== null).length;
    count += ancestry.alternateBoosts.length;
    count += ancestry.voluntary.touched ? 1 : 0;
    count += ancestry.voluntary.flaws.length;
    count += ancestry.voluntary.boost ? 1 : 0;
    count += Object.values(draft.boosts.background.selectedBoosts).filter((value) => value !== null).length;
    count += draft.boosts.class.keyAbility ? 1 : 0;
    count += Object.values(draft.boosts.levels).reduce((total, values) => total + values.length, 0);
    return count;
}
export function buildClearDraftConfirmationMessage(discardedDecisionCount) {
    if (discardedDecisionCount === 0) {
        return "Clear this empty Wayfinder draft?";
    }
    const noun = discardedDecisionCount === 1 ? "decision" : "decisions";
    return `Clear ${discardedDecisionCount} drafted ${noun}? This cannot be undone.`;
}
function buildApplyConfirmationMessage(actorName, stepCount) {
    return `Apply ${stepCount} Wayfinder step(s) to ${actorName}?`;
}
function defaultNow() {
    return new Date().toISOString();
}
//# sourceMappingURL=draft-lifecycle-service.js.map