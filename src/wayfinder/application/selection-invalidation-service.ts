import type { PendingStep } from "../../types.js";
import { clearSelectionState, invalidateSelectionState, invalidateSelectionsByPrefix } from "../invalidation.js";
import { SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";

export interface SelectionInvalidationState {
  draft: Parameters<typeof clearSelectionState>[0]["draft"];
  previewValueByStepId: Parameters<typeof clearSelectionState>[0]["previewValueByStepId"];
  recentlyInvalidatedStepIds: Parameters<typeof clearSelectionState>[0]["recentlyInvalidatedStepIds"];
  scrollById: Parameters<typeof clearSelectionState>[0]["scrollById"];
}

export interface SelectionInvalidationDependencies {
  buildPlan: () => Promise<{ steps: PendingStep[] }>;
  resetAncestryBoostDraft: () => boolean;
  resetBackgroundBoostDraft: () => boolean;
  resetClassBoostDraft: () => boolean;
}

export function createSelectionInvalidationService(
  state: SelectionInvalidationState,
  deps: SelectionInvalidationDependencies
) {
  const resetHooks = {
    resetAncestryBoostDraft: deps.resetAncestryBoostDraft,
    resetBackgroundBoostDraft: deps.resetBackgroundBoostDraft,
    resetClassBoostDraft: deps.resetClassBoostDraft,
  };

  const invalidateByPrefix = (prefix: string): string[] => invalidateSelectionsByPrefix(state, prefix, resetHooks);
  const invalidate = (slotId: string): string[] => invalidateSelectionState(state, slotId, resetHooks);

  return {
    clearSelection(slotId: string): number {
      let cleared = clearSelectionState(state, slotId, resetHooks);
      if (cleared === 0) {
        return 0;
      }

      if (slotId === SLOT_IDS.ancestry) {
        cleared += invalidateSingletonChoicesBySourceSync("ancestry").length;
        cleared += invalidateSingletonChoicesBySourceSync("heritage").length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.languageChoice).length;
      } else if (slotId === SLOT_IDS.heritage) {
        cleared += invalidateSingletonChoicesBySourceSync("heritage").length;
      } else if (slotId === SLOT_IDS.background) {
        cleared += invalidateSingletonChoicesBySourceSync("background").length;
      } else if (slotId === SLOT_IDS.deity) {
        cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
        cleared += invalidateSingletonChoicesBySourceSync("deity").length;
      } else if (slotId === SLOT_IDS.class) {
        cleared += invalidateByPrefix(SLOT_PREFIXES.deity).length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.classBranch).length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.skillTraining).length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.spellChoice).length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.classFeat).length;
        cleared += invalidateSingletonChoicesBySourceSync("class").length;
        cleared += invalidateSingletonChoicesBySourceSync("deity").length;
      }

      return cleared;
    },

    invalidateSelection(slotId: string): string[] {
      return invalidate(slotId);
    },

    invalidateSelectionsByPrefix(prefix: string): string[] {
      return invalidateByPrefix(prefix);
    },

    async invalidateBranchSelectionsByDependency(dependency: "class" | "deity"): Promise<string[]> {
      return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
        return step.kind === "class-branch" && step.branch?.dependsOn === dependency;
      });
    },

    async invalidateSpellChoicesByDependency(dependency: "class" | "class-branch"): Promise<string[]> {
      return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
        return step.kind === "spell-choice" && step.spellChoice?.dependsOn === dependency;
      });
    },

    async invalidateClassChoicesByDependency(dependency: "class" | "deity"): Promise<string[]> {
      return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
        return step.kind === "class-choice" && step.classChoice?.dependsOn === dependency;
      });
    },

    async invalidateSingletonChoicesBySource(
      sourceItemType: "ancestry" | "heritage" | "background" | "class" | "deity"
    ): Promise<string[]> {
      return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
        return step.kind === "singleton-choice" && step.singletonChoice?.sourceItemType === sourceItemType;
      });
    },
  };

  function invalidateSingletonChoicesBySourceSync(
    sourceItemType: "ancestry" | "heritage" | "background" | "class" | "deity"
  ): string[] {
    const invalidated: string[] = [];
    for (const slotId of Object.keys(state.draft.singletonChoices)) {
      if (!slotId.startsWith(`singleton-choice-${sourceItemType}-`)) {
        continue;
      }

      invalidated.push(...invalidate(slotId));
    }

    return invalidated;
  }
}

function invalidateMatchingPlanSteps(
  plan: { steps: PendingStep[] },
  invalidateSelection: (slotId: string) => string[],
  matches: (step: PendingStep) => boolean
): string[] {
  const invalidated: string[] = [];
  for (const step of plan.steps) {
    if (!matches(step)) {
      continue;
    }

    invalidated.push(...invalidateSelection(step.slotId));
  }

  return invalidated;
}
