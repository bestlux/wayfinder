import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
import { cloneData } from "../../shared/cloning.js";
import { evaluateWayfinderDraftReadiness, } from "../domain/step-evaluation.js";
export async function applyDraftLifecycle(args) {
    if (args.draft.acquisitionCorrupt) {
        return {
            kind: "warning",
            warning: "draft-not-ready",
            blockers: [
                {
                    code: "dependency-review",
                    stepId: "starting-equipment",
                    slotId: "starting-equipment",
                    title: "Starting equipment recovery",
                    message: "The saved starting-equipment state is malformed and must be cleared or repaired before Apply.",
                },
            ],
        };
    }
    if (args.draft.acquisition && args.acquisitionExecutionAvailable !== true) {
        return {
            kind: "warning",
            warning: "draft-not-ready",
            blockers: [
                {
                    code: "dependency-review",
                    stepId: "starting-equipment",
                    slotId: "starting-equipment",
                    title: "Starting equipment",
                    message: "Starting-equipment Apply is unavailable until its prepared item executor is active.",
                },
            ],
        };
    }
    const recoveryOnly = args.steps.length === 0 && hasApplyRecoveryState(args.draft);
    if (args.steps.length === 0 && !recoveryOnly) {
        return {
            kind: "warning",
            warning: "no-pending-steps",
            blockers: [],
        };
    }
    if ((args.additionalBlockers?.length ?? 0) > 0) {
        return {
            kind: "warning",
            warning: "draft-not-ready",
            blockers: cloneData(args.additionalBlockers ?? []),
        };
    }
    if (!recoveryOnly) {
        const readiness = await evaluateWayfinderDraftReadiness(args.steps, args.evaluateStep);
        if (!readiness.ready) {
            return {
                kind: "warning",
                warning: "draft-not-ready",
                blockers: readiness.blockers,
            };
        }
    }
    const confirmed = (await args.confirmApply?.(recoveryOnly
        ? buildRecoveryFinalizationConfirmationMessage(args.actorName, args.reviewLines)
        : buildApplyConfirmationMessage(args.actorName, args.steps.length, args.reviewLines))) ?? true;
    if (!confirmed) {
        return {
            kind: "cancelled",
        };
    }
    const applyAttemptDraft = buildApplyAttemptDraft(args.draft, args.steps, args.appliedSpellRarityAttestations ?? []);
    await args.beforeApply?.(applyAttemptDraft);
    const appliedAt = (args.now ?? defaultNow)();
    const buildFinalActorUpdate = (currentState) => {
        const completedStepIds = mergeCompletedStepIds(currentState?.completedStepIds ?? args.existingCompletedStepIds ?? [], [...applyAttemptDraft.applyCompletedStepIds, ...applyAttemptDraft.applyAttemptStepIds]);
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
                lastAppliedSpellRarityAttestations: cloneData(applyAttemptDraft.applySpellRarityAttestations),
            },
        };
    };
    if (recoveryOnly) {
        if (!args.finalizeRecoveredDraft) {
            throw new Error("Wayfinder cannot finalize this recovery draft safely.");
        }
        await args.finalizeRecoveredDraft(cloneData(applyAttemptDraft.applyRecoveryActorUpdate), buildFinalActorUpdate);
    }
    else {
        await args.applyDraftToActor(buildFinalActorUpdate);
    }
    return {
        kind: "applied",
        nextDraft: normalizeDraft(null, args.currentLevel),
    };
}
export function buildApplyAttemptDraft(draft, steps, appliedSpellRarityAttestations = []) {
    const nextDraft = cloneData(draft);
    const alreadyRecovering = hasApplyRecoveryState(draft);
    const currentStepIds = steps.map((step) => step.id);
    const currentStepIdSet = new Set(currentStepIds);
    nextDraft.applyCompletedStepIds = mergeCompletedStepIds(nextDraft.applyCompletedStepIds, nextDraft.applyAttemptStepIds.filter((stepId) => !currentStepIdSet.has(stepId)));
    nextDraft.applyAttemptStepIds = mergeCompletedStepIds([], currentStepIds);
    if (!alreadyRecovering) {
        nextDraft.applySpellRarityAttestations = cloneData(appliedSpellRarityAttestations);
    }
    return nextDraft;
}
export function hasApplyRecoveryState(draft) {
    return (draft.applyAttemptStepIds.length > 0 ||
        draft.applyCompletedStepIds.length > 0 ||
        Object.keys(draft.applyRecoveryActorUpdate).length > 0 ||
        draft.applySpellRarityAttestations.length > 0);
}
export class WayfinderRecoveryDraftConflictError extends Error {
    constructor() {
        super("This actor has a newer partial-Apply recovery draft. Reopen Wayfinder before changing or saving it.");
        this.name = "WayfinderRecoveryDraftConflictError";
    }
}
export function assertRecoveryDraftWriteAllowed(liveDraft, candidateDraft) {
    if (!hasApplyRecoveryState(liveDraft)) {
        return;
    }
    const liveRecoveryStepIds = new Set([...liveDraft.applyCompletedStepIds, ...liveDraft.applyAttemptStepIds]);
    const candidateRecoveryStepIds = new Set([
        ...candidateDraft.applyCompletedStepIds,
        ...candidateDraft.applyAttemptStepIds,
    ]);
    const preservesRecovery = hasApplyRecoveryState(candidateDraft) &&
        semanticDraftFingerprint(liveDraft) === semanticDraftFingerprint(candidateDraft) &&
        liveDraft.applyCompletedStepIds.every((stepId) => candidateDraft.applyCompletedStepIds.includes(stepId)) &&
        [...liveRecoveryStepIds].every((stepId) => candidateRecoveryStepIds.has(stepId)) &&
        Object.entries(liveDraft.applyRecoveryActorUpdate).every(([path, value]) => path in candidateDraft.applyRecoveryActorUpdate &&
            JSON.stringify(candidateDraft.applyRecoveryActorUpdate[path]) === JSON.stringify(value)) &&
        JSON.stringify(liveDraft.applySpellRarityAttestations) ===
            JSON.stringify(candidateDraft.applySpellRarityAttestations);
    if (!preservesRecovery) {
        throw new WayfinderRecoveryDraftConflictError();
    }
}
function semanticDraftFingerprint(draft) {
    const semanticDraft = buildDraftPatch(draft);
    semanticDraft.applyAttemptStepIds = [];
    semanticDraft.applyCompletedStepIds = [];
    semanticDraft.applyRecoveryActorUpdate = {};
    semanticDraft.applySpellRarityAttestations = [];
    semanticDraft.updatedAt = null;
    return JSON.stringify(semanticDraft);
}
function mergeCompletedStepIds(existingStepIds, nextStepIds) {
    return Array.from(new Set([
        ...existingStepIds.filter((stepId) => typeof stepId === "string" && stepId.length > 0),
        ...nextStepIds.filter((stepId) => typeof stepId === "string" && stepId.length > 0),
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
    count += Object.keys(draft.spellRarityAttestations).length;
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
export function buildApplyConfirmationMessage(actorName, stepCount, reviewLines = []) {
    const heading = `Apply ${stepCount} Wayfinder step(s) to ${actorName}?`;
    return reviewLines.length > 0 ? `${heading}\n\n${reviewLines.join("\n")}` : heading;
}
function buildRecoveryFinalizationConfirmationMessage(actorName, reviewLines = []) {
    const heading = `Finish recording the recovered Wayfinder Apply for ${actorName}? No build steps remain to reapply.`;
    return reviewLines.length > 0 ? `${heading}\n\n${reviewLines.join("\n")}` : heading;
}
function defaultNow() {
    return new Date().toISOString();
}
//# sourceMappingURL=draft-lifecycle-service.js.map