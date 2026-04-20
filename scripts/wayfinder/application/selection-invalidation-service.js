import { clearSelectionState, invalidateSelectionState, invalidateSelectionsByPrefix } from "../invalidation.js";
import { SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";
export function createSelectionInvalidationService(state, deps) {
    const resetHooks = {
        resetAncestryBoostDraft: deps.resetAncestryBoostDraft,
        resetBackgroundBoostDraft: deps.resetBackgroundBoostDraft,
        resetClassBoostDraft: deps.resetClassBoostDraft,
    };
    const invalidateByPrefix = (prefix) => invalidateSelectionsByPrefix(state, prefix, resetHooks);
    const invalidate = (slotId) => invalidateSelectionState(state, slotId, resetHooks);
    return {
        clearSelection(slotId) {
            let cleared = clearSelectionState(state, slotId, resetHooks);
            if (cleared === 0) {
                return 0;
            }
            if (slotId === SLOT_IDS.deity) {
                cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
            }
            else if (slotId === SLOT_IDS.class) {
                cleared += invalidateByPrefix(SLOT_PREFIXES.deity).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.classBranch).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.skillTraining).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.spellChoice).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.classFeat).length;
            }
            return cleared;
        },
        invalidateSelection(slotId) {
            return invalidate(slotId);
        },
        invalidateSelectionsByPrefix(prefix) {
            return invalidateByPrefix(prefix);
        },
        async invalidateBranchSelectionsByDependency(dependency) {
            return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
                return step.kind === "class-branch" && step.branch?.dependsOn === dependency;
            });
        },
        async invalidateSpellChoicesByDependency(dependency) {
            return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
                return step.kind === "spell-choice" && step.spellChoice?.dependsOn === dependency;
            });
        },
        async invalidateClassChoicesByDependency(dependency) {
            return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
                return step.kind === "class-choice" && step.classChoice?.dependsOn === dependency;
            });
        },
    };
}
function invalidateMatchingPlanSteps(plan, invalidateSelection, matches) {
    const invalidated = [];
    for (const step of plan.steps) {
        if (!matches(step)) {
            continue;
        }
        invalidated.push(...invalidateSelection(step.slotId));
    }
    return invalidated;
}
//# sourceMappingURL=selection-invalidation-service.js.map