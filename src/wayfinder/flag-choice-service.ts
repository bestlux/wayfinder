import type { DraftState, FlagChoiceMeta, PendingStep, SelectionRef } from "../types.js";
import type { ChoiceFilterActorContext } from "./choice-set-filters.js";
import { buildFlagChoiceStepsFromRules } from "./flag-choice/step-builders.js";

export interface FlagChoiceSourceContext {
  sourceItemType: FlagChoiceMeta["sourceItemType"];
  sourceSelection: SelectionRef | null;
  sourceDocument: unknown | null;
}

interface BuildFlagChoiceStepsParams {
  draft: DraftState;
  targetLevel: number;
  sources: FlagChoiceSourceContext[];
  extractSlug: (document: unknown) => string | null;
  localize?: (value: string) => string;
  actorContext?: ChoiceFilterActorContext | null;
  readExistingFlagChoiceSelection: (choice: FlagChoiceMeta) => string | null;
}

export async function buildFlagChoiceSteps(params: BuildFlagChoiceStepsParams): Promise<PendingStep[]> {
  return params.sources
    .flatMap((source) =>
      buildFlagChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
        localize: params.localize,
        actorContext: params.actorContext,
        requireResolvedActorPlaceholders: true,
      })
    )
    .filter((step) => step.level <= params.targetLevel)
    .filter(
      (step) =>
        !step.flagChoice ||
        !shouldSkipExistingStep(
          params.draft.selections[step.slotId],
          params.readExistingFlagChoiceSelection(step.flagChoice)
        )
    );
}

function shouldSkipExistingStep(draftSelection: SelectionRef | undefined, actorSelection: string | null): boolean {
  return !!actorSelection && !draftSelection;
}
