import type { PendingStep } from "../../types.js";
import { clearSelectionState, invalidateSelectionState, invalidateSelectionsByPrefix } from "../invalidation.js";
import { getSlotIdKind, SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";

export interface SelectionInvalidationState {
  draft: Parameters<typeof clearSelectionState>[0]["draft"];
  previewValueByStepId: Parameters<typeof clearSelectionState>[0]["previewValueByStepId"];
  pickerFiltersByStepId: Parameters<typeof clearSelectionState>[0]["pickerFiltersByStepId"];
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
        cleared += invalidateGrantSelectionsBySourceSync("ancestry").length;
        cleared += invalidateGrantSelectionsBySourceSync("heritage").length;
        cleared += invalidateFlagChoicesBySourceSync("ancestry").length;
        cleared += invalidateFlagChoicesBySourceSync("heritage").length;
        cleared += invalidateFlagChoicesByDependencySync("ancestry").length;
        cleared += invalidateByPrefix(SLOT_PREFIXES.languageChoice).length;
      } else if (slotId === SLOT_IDS.heritage) {
        cleared += invalidateSingletonChoicesBySourceSync("heritage").length;
        cleared += invalidateGrantSelectionsBySourceSync("heritage").length;
        cleared += invalidateFlagChoicesBySourceSync("heritage").length;
      } else if (slotId === SLOT_IDS.background) {
        cleared += invalidateSingletonChoicesBySourceSync("background").length;
        cleared += invalidateGrantSelectionsBySourceSync("background").length;
        cleared += invalidateFlagChoicesBySourceSync("background").length;
      } else if (slotId === SLOT_IDS.deity) {
        cleared += invalidateByPrefix(SLOT_PREFIXES.classChoice).length;
        cleared += invalidateSingletonChoicesBySourceSync("deity").length;
        cleared += invalidateGrantSelectionsByDependencySync("deity").length;
      } else if (slotId === SLOT_IDS.class) {
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
      } else if (getSlotIdKind(slotId) === "ancestry-feat") {
        cleared += invalidateGrantSelectionsBySourceSync("feat").length;
        cleared += invalidateGrantSelectionsBySourceSync("classfeature").length;
        cleared += invalidateFlagChoicesBySourceSync("feat").length;
        cleared += invalidateFlagChoicesBySourceSync("classfeature").length;
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

    async invalidateGrantSelectionsBySource(
      sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
    ): Promise<string[]> {
      return invalidateGrantSelectionsBySourceSync(sourceItemType);
    },

    async invalidateGrantSelectionsByDependency(dependency: "class" | "deity"): Promise<string[]> {
      return invalidateGrantSelectionsByDependencySync(dependency);
    },

    async invalidateFlagChoicesBySource(
      sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
    ): Promise<string[]> {
      return invalidateFlagChoicesBySourceSync(sourceItemType);
    },

    async invalidateFlagChoicesByDependency(dependency: "ancestry" | "class"): Promise<string[]> {
      return invalidateFlagChoicesByDependencySync(dependency);
    },

    async invalidateGrantSelectionsBySourceUuid(sourceUuid: string): Promise<string[]> {
      const normalizedSourceUuid = normalizeUuid(sourceUuid);
      if (!normalizedSourceUuid) {
        return [];
      }

      return invalidateMatchingPlanSteps(await deps.buildPlan(), invalidate, (step) => {
        return step.kind === "pick-item" && normalizeUuid(step.grantSelection?.selectorUuid) === normalizedSourceUuid;
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

  function invalidateGrantSelectionsBySourceSync(
    sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
  ): string[] {
    const invalidated: string[] = [];
    for (const slotId of candidateGrantChoiceSlotIds()) {
      if (!isGrantChoiceSlotIdForSource(slotId, sourceItemType)) {
        continue;
      }

      invalidated.push(...invalidate(slotId));
    }

    return invalidated;
  }

  function invalidateGrantSelectionsByDependencySync(dependency: "class" | "deity"): string[] {
    const invalidated: string[] = [];
    for (const slotId of candidateGrantChoiceSlotIds()) {
      if (!isGrantChoiceSlotIdForDependency(slotId, dependency)) {
        continue;
      }

      invalidated.push(...invalidate(slotId));
    }

    return invalidated;
  }

  function candidateGrantChoiceSlotIds(): string[] {
    return Array.from(
      new Set([
        ...Object.keys(state.draft.selections),
        ...state.previewValueByStepId.keys(),
        ...state.pickerFiltersByStepId.keys(),
        ...[...state.scrollById.keys()].map((key) => key.split(":")[0] ?? key),
      ])
    );
  }

  function invalidateFlagChoicesBySourceSync(
    sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
  ): string[] {
    const invalidated: string[] = [];
    for (const slotId of candidateFlagChoiceSlotIds()) {
      if (!isFlagChoiceSlotIdForSource(slotId, sourceItemType)) {
        continue;
      }

      invalidated.push(...invalidate(slotId));
    }

    return invalidated;
  }

  function invalidateFlagChoicesByDependencySync(dependency: "ancestry" | "class"): string[] {
    const invalidated: string[] = [];
    for (const slotId of candidateFlagChoiceSlotIds()) {
      if (!isFlagChoiceSlotIdForDependency(slotId, dependency)) {
        continue;
      }

      invalidated.push(...invalidate(slotId));
    }

    return invalidated;
  }

  function candidateFlagChoiceSlotIds(): string[] {
    return Array.from(
      new Set([
        ...Object.keys(state.draft.selections),
        ...state.previewValueByStepId.keys(),
        ...state.pickerFiltersByStepId.keys(),
        ...[...state.scrollById.keys()].map((key) => key.split(":")[0] ?? key),
      ])
    );
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

function isGrantChoiceSlotIdForSource(
  slotId: string,
  sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
): boolean {
  return new RegExp(`^grant-choice-(?:class|deity|none)-${sourceItemType}-`).test(slotId);
}

function isGrantChoiceSlotIdForDependency(slotId: string, dependency: "class" | "deity"): boolean {
  return slotId.startsWith(`grant-choice-${dependency}-`);
}

function isFlagChoiceSlotIdForSource(
  slotId: string,
  sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
): boolean {
  return new RegExp("^flag-choice-(?:ancestry|class|none)-" + sourceItemType + "-").test(slotId);
}

function isFlagChoiceSlotIdForDependency(slotId: string, dependency: "ancestry" | "class"): boolean {
  return slotId.startsWith("flag-choice-" + dependency + "-");
}

function normalizeUuid(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
