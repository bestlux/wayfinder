import type { ChoicePredicate, DraftState, PendingStep, SelectionRef, SingletonChoiceMeta } from "../types.js";
import { buildSingletonChoiceStepsFromRules } from "./singleton-choice/step-builders.js";

export interface SingletonChoiceSourceContext {
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  sourceSelection: SelectionRef | null;
  sourceDocument: unknown | null;
}

interface BuildSingletonChoiceStepsParams {
  draft: DraftState;
  targetLevel: number;
  sources: SingletonChoiceSourceContext[];
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
  readExistingSingletonChoiceSelection: (choice: SingletonChoiceMeta) => string | null;
}

export async function buildSingletonChoiceSteps(params: BuildSingletonChoiceStepsParams): Promise<PendingStep[]> {
  const steps = params.sources.flatMap((source) =>
    buildSingletonChoiceStepsFromRules({
      sourceItemType: source.sourceItemType,
      effectiveSourceDocument: source.sourceDocument,
      sourceSelection: source.sourceSelection,
      extractSlug: params.extractSlug,
      localize: params.localize,
    })
  );
  const activeRollOptions = buildActiveRollOptions(steps, params.draft, params.readExistingSingletonChoiceSelection);

  return steps
    .filter((step) => step.level <= params.targetLevel)
    .filter((step) => matchesPredicate(step.singletonChoice.predicate, activeRollOptions))
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

function buildActiveRollOptions(
  steps: PendingStep[],
  draft: DraftState,
  readExistingSingletonChoiceSelection: (choice: SingletonChoiceMeta) => string | null
): Set<string> {
  const active = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const step of steps) {
      if (step.kind !== "singleton-choice" || !matchesPredicate(step.singletonChoice.predicate, active)) {
        continue;
      }

      const selectedValue =
        draft.singletonChoices[step.slotId] ?? readExistingSingletonChoiceSelection(step.singletonChoice);
      const rollOption = step.singletonChoice.rollOption;
      if (!selectedValue || !rollOption) {
        continue;
      }

      const activeRollOption = `${rollOption}:${selectedValue}`;
      if (!active.has(activeRollOption)) {
        active.add(activeRollOption);
        changed = true;
      }
    }
  }

  return active;
}

function matchesPredicate(predicate: ChoicePredicate[], activeRollOptions: Set<string>): boolean {
  return predicate.every((entry) => matchesPredicateEntry(entry, activeRollOptions));
}

function matchesPredicateEntry(predicate: ChoicePredicate, activeRollOptions: Set<string>): boolean {
  if (typeof predicate === "string") {
    return activeRollOptions.has(predicate);
  }

  if (Array.isArray(predicate)) {
    return predicate.every((entry) => matchesPredicateEntry(entry, activeRollOptions));
  }

  if (Array.isArray(predicate.or)) {
    return predicate.or.some((entry) => matchesPredicateEntry(entry, activeRollOptions));
  }

  if (Array.isArray(predicate.nor)) {
    return predicate.nor.every((entry) => !matchesPredicateEntry(entry, activeRollOptions));
  }

  if (predicate.not) {
    return !matchesPredicateEntry(predicate.not, activeRollOptions);
  }

  return true;
}
