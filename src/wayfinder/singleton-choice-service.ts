import type { DraftState, PendingStep, SelectionRef, SingletonChoiceMeta, SingletonChoiceStep } from "../types.js";
import { buildSingletonChoiceStepsFromRules } from "./singleton-choice/step-builders.js";

export interface SingletonChoiceSourceContext {
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  sourceSelection: SelectionRef | null;
  sourceDocument: unknown | null;
  sourceLevel?: number;
}

interface BuildSingletonChoiceStepsParams {
  draft: DraftState;
  targetLevel: number;
  sources: SingletonChoiceSourceContext[];
  activeRollOptions?: ReadonlySet<string>;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
  readExistingSingletonChoiceSelection: (choice: SingletonChoiceMeta) => string | null;
}

export async function buildSingletonChoiceSteps(params: BuildSingletonChoiceStepsParams): Promise<PendingStep[]> {
  const activeRollOptions = new Set(params.activeRollOptions ?? []);
  let steps: SingletonChoiceStep[] = [];
  let changed = true;
  while (changed) {
    steps = params.sources.flatMap((source) =>
      buildSingletonChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        sourceLevel: source.sourceLevel,
        extractSlug: params.extractSlug,
        localize: params.localize,
        activeRollOptions,
        selectedChoices: params.draft.singletonChoices,
      })
    );
    changed = addSelectedRollOptions(
      activeRollOptions,
      steps,
      params.draft,
      params.readExistingSingletonChoiceSelection
    );
  }

  return steps
    .filter((step) => step.level <= params.targetLevel)
    .filter(
      (step) =>
        !shouldSkipExistingStep(
          params.draft.singletonChoices[step.slotId],
          params.readExistingSingletonChoiceSelection(step.singletonChoice)
        )
    );
}

function shouldSkipExistingStep(draftSelection: string | undefined, actorSelection: string | null): boolean {
  return !!actorSelection && !draftSelection;
}

function addSelectedRollOptions(
  active: Set<string>,
  steps: PendingStep[],
  draft: DraftState,
  readExistingSingletonChoiceSelection: (choice: SingletonChoiceMeta) => string | null
): boolean {
  let changed = false;
  for (const step of steps) {
    if (step.kind !== "singleton-choice") {
      continue;
    }

    const selectedValue =
      draft.singletonChoices[step.slotId] ?? readExistingSingletonChoiceSelection(step.singletonChoice);
    const rollOption = step.singletonChoice.rollOption;
    if (!selectedValue || !rollOption) {
      continue;
    }

    const activeRollOption = `${rollOption}:${selectedValue}`.toLowerCase();
    if (!active.has(activeRollOption)) {
      active.add(activeRollOption);
      changed = true;
    }
  }

  return changed;
}
