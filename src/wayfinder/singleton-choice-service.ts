import type { DraftState, PendingStep, SelectionRef, SingletonChoiceMeta } from "../types.js";
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
