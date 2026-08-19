import { DRAFT_FLAG, STATE_FLAG } from "../../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../../draft-service.js";
import { cloneData } from "../../shared/cloning.js";
import { normalizeAcquisitionCurrencyConvergenceWitness } from "../domain/acquisition-currency-convergence.js";
import { recordAcquisitionCurrencyConvergenceWitness } from "../domain/acquisition-draft.js";
import { assertPreparedAcquisitionIdentityPlanMatches } from "../domain/acquisition-identity.js";
import { assertCompletedAcquisitionManifestMatchesIdentityPlan, completedClassGrantsMatchFinalReconciliation, manifestsDescribeSameOutcome, normalizeCompletedAcquisitionManifest, } from "../domain/completed-acquisition-manifest.js";
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
    if (args.draft.acquisition) {
        try {
            if (!args.assertAcquisitionApplyAuthority) {
                throw new Error("Starting-equipment Apply requires current acquisition authority.");
            }
            args.assertAcquisitionApplyAuthority();
        }
        catch (error) {
            return {
                kind: "warning",
                warning: "draft-not-ready",
                blockers: [
                    {
                        code: "dependency-review",
                        stepId: "starting-equipment-authority",
                        slotId: "starting-equipment",
                        title: "Starting equipment authority",
                        message: error instanceof Error ? error.message : "Starting-equipment Apply authority is unavailable.",
                    },
                ],
            };
        }
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
    const buildFinalActorUpdate = (currentState, evidence) => {
        const completedAcquisitionManifest = resolveCompletedAcquisitionManifest({
            draft: args.draft,
            currentState,
            evidence: evidence?.acquisition ?? { kind: "none" },
            classGrantReconciliations: evidence?.classGrantReconciliations ?? [],
        });
        const finalAppliedAt = args.draft.acquisition ? (completedAcquisitionManifest?.appliedAt ?? appliedAt) : appliedAt;
        const completedStepIds = mergeCompletedStepIds(currentState?.completedStepIds ?? args.existingCompletedStepIds ?? [], [...applyAttemptDraft.applyCompletedStepIds, ...applyAttemptDraft.applyAttemptStepIds]);
        return {
            [DRAFT_FLAG]: null,
            [STATE_FLAG]: {
                ...createEmptyState(),
                lastAppliedAt: finalAppliedAt,
                lastTargetLevel: args.draft.targetLevel,
                completedStepIds,
                existingCharacterHistory: currentState
                    ? currentState.existingCharacterHistory
                    : (args.existingCharacterHistory ?? null),
                lastAppliedSpellRarityAttestations: cloneData(applyAttemptDraft.applySpellRarityAttestations),
                completedAcquisitionManifest,
                completedAcquisitionManifestCorrupt: currentState?.completedAcquisitionManifestCorrupt === true,
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
function resolveCompletedAcquisitionManifest(args) {
    const existing = args.currentState?.completedAcquisitionManifest ?? null;
    if (!args.draft.acquisition) {
        if (args.evidence.kind !== "none") {
            throw new Error("A non-acquisition Apply cannot persist starting-equipment completion evidence.");
        }
        return cloneData(existing);
    }
    if (args.currentState?.completedAcquisitionManifestCorrupt === true) {
        throw new Error("The actor's completed starting-equipment manifest is malformed and cannot be replaced.");
    }
    if (args.evidence.kind !== "completed") {
        throw new Error("Starting-equipment Apply cannot clear its draft without completed manifest evidence.");
    }
    assertPreparedAcquisitionIdentityPlanMatches({
        plan: args.evidence.identityPlan,
        actorId: args.evidence.manifest.actorId,
        draft: args.draft.acquisition,
    });
    const candidate = normalizeCompletedAcquisitionManifest(args.evidence.manifest);
    if (!candidate ||
        candidate.id !== args.draft.acquisition.manifestId ||
        candidate.draftId !== args.draft.acquisition.draftId ||
        candidate.batchId !== args.draft.acquisition.batchId ||
        candidate.targetLevel !== args.draft.acquisition.targetLevel) {
        throw new Error("Starting-equipment completion evidence does not match the current acquisition draft.");
    }
    const finalReconciliations = args.classGrantReconciliations.filter((entry) => entry.phase === "final");
    if (finalReconciliations.length !== 1 ||
        !completedClassGrantsMatchFinalReconciliation(candidate, finalReconciliations[0])) {
        throw new Error("Starting-equipment completion evidence differs from final class-grant reconciliation.");
    }
    assertCompletedAcquisitionManifestMatchesIdentityPlan(candidate, args.evidence.identityPlan);
    if (!existing)
        return candidate;
    if (existing.id !== candidate.id ||
        existing.batchId !== candidate.batchId ||
        !manifestsDescribeSameOutcome(existing, candidate)) {
        throw new Error("A completed starting-equipment manifest already exists for another outcome.");
    }
    return cloneData(existing);
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
        draft.applySpellRarityAttestations.length > 0 ||
        draft.acquisition?.currencyConvergenceWitness != null);
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
        preservesAcquisitionCurrencyConvergenceWitness(liveDraft, candidateDraft) &&
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
    if (semanticDraft.acquisition) {
        semanticDraft.acquisition = { ...semanticDraft.acquisition, currencyConvergenceWitness: null };
    }
    semanticDraft.updatedAt = null;
    return JSON.stringify(semanticDraft);
}
function preservesAcquisitionCurrencyConvergenceWitness(liveDraft, candidateDraft) {
    const liveWitness = liveDraft.acquisition?.currencyConvergenceWitness ?? null;
    const candidateWitness = candidateDraft.acquisition?.currencyConvergenceWitness ?? null;
    if (liveWitness)
        return JSON.stringify(liveWitness) === JSON.stringify(candidateWitness);
    if (!candidateWitness)
        return true;
    if (!liveDraft.acquisition || !candidateDraft.acquisition)
        return false;
    const normalized = normalizeAcquisitionCurrencyConvergenceWitness(candidateWitness);
    if (!normalized)
        return false;
    try {
        const enriched = recordAcquisitionCurrencyConvergenceWitness(liveDraft.acquisition, normalized);
        return JSON.stringify(enriched.currencyConvergenceWitness) === JSON.stringify(candidateWitness);
    }
    catch {
        return false;
    }
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