import { clearSelectionState, invalidateSelectionState, invalidateSelectionsByPrefix } from "../invalidation.js";
import { getSlotIdKind, SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";
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
            if (slotId === SLOT_IDS.ancestry) {
                cleared += invalidateSingletonChoicesBySourceSync("ancestry").length;
                cleared += invalidateSingletonChoicesBySourceSync("heritage").length;
                cleared += invalidateGrantSelectionsBySourceSync("ancestry").length;
                cleared += invalidateGrantSelectionsBySourceSync("heritage").length;
                cleared += invalidateFlagChoicesBySourceSync("ancestry").length;
                cleared += invalidateFlagChoicesBySourceSync("heritage").length;
                cleared += invalidateFlagChoicesByDependencySync("ancestry").length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.languageChoice).length;
            }
            else if (slotId === SLOT_IDS.heritage) {
                cleared += invalidateSingletonChoicesBySourceSync("heritage").length;
                cleared += invalidateGrantSelectionsBySourceSync("heritage").length;
                cleared += invalidateFlagChoicesBySourceSync("heritage").length;
            }
            else if (slotId === SLOT_IDS.background) {
                cleared += invalidateSingletonChoicesBySourceSync("background").length;
                cleared += invalidateGrantSelectionsBySourceSync("background").length;
                cleared += invalidateFlagChoicesBySourceSync("background").length;
            }
            else if (slotId === SLOT_IDS.deity) {
                cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
                cleared += invalidateSingletonChoicesBySourceSync("deity").length;
                cleared += invalidateGrantSelectionsByDependencySync("deity").length;
            }
            else if (slotId === SLOT_IDS.class) {
                cleared += invalidateByPrefix(SLOT_PREFIXES.deity).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.classBranch).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.skillTraining).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.spellChoice).length;
                cleared += invalidateByPrefix(SLOT_PREFIXES.classFeat).length;
                cleared += invalidateSingletonChoicesBySourceSync("class").length;
                cleared += invalidateSingletonChoicesBySourceSync("deity").length;
                cleared += invalidateGrantSelectionsByDependencySync("class").length;
                cleared += invalidateFlagChoicesByDependencySync("class").length;
            }
            else if (getSlotIdKind(slotId) === "ancestry-feat") {
                cleared += invalidateGrantSelectionsBySourceSync("feat").length;
                cleared += invalidateGrantSelectionsBySourceSync("classfeature").length;
                cleared += invalidateFlagChoicesBySourceSync("feat").length;
                cleared += invalidateFlagChoicesBySourceSync("classfeature").length;
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
        async invalidateClassChoicesBySourceChoice(sourceUuid, flag) {
            const normalizedSourceUuid = normalizeUuid(sourceUuid);
            const normalizedFlag = normalizeFlag(flag);
            if (!normalizedSourceUuid || !normalizedFlag) {
                return [];
            }
            return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
                return (step.kind === "class-choice" &&
                    (step.classChoice.dependsOnChoices?.some((dependency) => normalizeUuid(dependency.sourceUuid) === normalizedSourceUuid &&
                        normalizeFlag(dependency.flag) === normalizedFlag) ??
                        false));
            });
        },
        async invalidateSingletonChoicesBySource(sourceItemType) {
            return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
                return step.kind === "singleton-choice" && step.singletonChoice?.sourceItemType === sourceItemType;
            });
        },
        async invalidateGrantSelectionsBySource(sourceItemType) {
            return invalidateGrantSelectionsBySourceSync(sourceItemType);
        },
        async invalidateGrantSelectionsByDependency(dependency) {
            return invalidateGrantSelectionsByDependencySync(dependency);
        },
        async invalidateFlagChoicesBySource(sourceItemType) {
            return invalidateFlagChoicesBySourceSync(sourceItemType);
        },
        async invalidateFlagChoicesByDependency(dependency) {
            return invalidateFlagChoicesByDependencySync(dependency);
        },
        async invalidateGrantSelectionsBySourceUuid(sourceUuid) {
            const normalizedSourceUuid = normalizeUuid(sourceUuid);
            if (!normalizedSourceUuid) {
                return [];
            }
            return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
                return step.kind === "pick-item" && normalizeUuid(step.grantSelection?.selectorUuid) === normalizedSourceUuid;
            });
        },
    };
    function invalidateSingletonChoicesBySourceSync(sourceItemType) {
        const invalidated = [];
        for (const slotId of Object.keys(state.draft.singletonChoices)) {
            if (!slotId.startsWith(`singleton-choice-${sourceItemType}-`)) {
                continue;
            }
            invalidated.push(...invalidate(slotId));
        }
        return invalidated;
    }
    function invalidateGrantSelectionsBySourceSync(sourceItemType) {
        const invalidated = [];
        for (const slotId of candidateGrantChoiceSlotIds()) {
            if (!isGrantChoiceSlotIdForSource(slotId, sourceItemType)) {
                continue;
            }
            invalidated.push(...invalidate(slotId));
        }
        return invalidated;
    }
    function invalidateGrantSelectionsByDependencySync(dependency) {
        const invalidated = [];
        for (const slotId of candidateGrantChoiceSlotIds()) {
            if (!isGrantChoiceSlotIdForDependency(slotId, dependency)) {
                continue;
            }
            invalidated.push(...invalidate(slotId));
        }
        return invalidated;
    }
    function candidateGrantChoiceSlotIds() {
        return Array.from(new Set([
            ...Object.keys(state.draft.selections),
            ...state.previewValueByStepId.keys(),
            ...state.pickerFiltersByStepId.keys(),
            ...[...state.scrollById.keys()].map((key) => key.split(":")[0] ?? key),
        ]));
    }
    function invalidateFlagChoicesBySourceSync(sourceItemType) {
        const invalidated = [];
        for (const slotId of candidateFlagChoiceSlotIds()) {
            if (!isFlagChoiceSlotIdForSource(slotId, sourceItemType)) {
                continue;
            }
            invalidated.push(...invalidate(slotId));
        }
        return invalidated;
    }
    function invalidateFlagChoicesByDependencySync(dependency) {
        const invalidated = [];
        for (const slotId of candidateFlagChoiceSlotIds()) {
            if (!isFlagChoiceSlotIdForDependency(slotId, dependency)) {
                continue;
            }
            invalidated.push(...invalidate(slotId));
        }
        return invalidated;
    }
    function candidateFlagChoiceSlotIds() {
        return Array.from(new Set([
            ...Object.keys(state.draft.selections),
            ...state.previewValueByStepId.keys(),
            ...state.pickerFiltersByStepId.keys(),
            ...[...state.scrollById.keys()].map((key) => key.split(":")[0] ?? key),
        ]));
    }
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
function isGrantChoiceSlotIdForSource(slotId, sourceItemType) {
    return new RegExp(`^grant-choice-(?:class|deity|none)-${sourceItemType}-`).test(slotId);
}
function isGrantChoiceSlotIdForDependency(slotId, dependency) {
    return slotId.startsWith(`grant-choice-${dependency}-`);
}
function isFlagChoiceSlotIdForSource(slotId, sourceItemType) {
    return new RegExp("^flag-choice-(?:ancestry|class|none)-" + sourceItemType + "-").test(slotId);
}
function isFlagChoiceSlotIdForDependency(slotId, dependency) {
    return slotId.startsWith("flag-choice-" + dependency + "-");
}
function normalizeUuid(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
function normalizeFlag(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
//# sourceMappingURL=selection-invalidation-service.js.map