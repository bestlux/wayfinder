import type { DraftState, GrantSelectionMeta, PendingStep, SelectionRef } from "../types.js";
import { buildGrantChoiceStepsFromRules } from "./grant-choice/step-builders.js";

export interface GrantChoiceSourceContext {
  sourceItemType: Extract<GrantSelectionMeta["sourceItemType"], "ancestry" | "heritage" | "background" | "feat">;
  sourceSelection: SelectionRef | null;
  sourceDocument: unknown | null;
}

interface BuildGrantChoiceStepsParams {
  draft: DraftState;
  targetLevel: number;
  hasClassSelection: boolean;
  hasDeitySelection: boolean;
  sources: GrantChoiceSourceContext[];
  extractSlug: (document: unknown) => string | null;
  readExistingGrantedSelection: (grant: GrantSelectionMeta) => string | null;
}

export async function buildGrantChoiceSteps(params: BuildGrantChoiceStepsParams): Promise<PendingStep[]> {
  if (params.targetLevel < 1) {
    return [];
  }

  return params.sources
    .flatMap((source) =>
      buildGrantChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
      })
    )
    .filter((step) => {
      const dependency = step.grantSelection?.dependsOn ?? null;
      if (dependency === "class" && !params.hasClassSelection) {
        return false;
      }
      if (dependency === "deity" && !params.hasDeitySelection) {
        return false;
      }

      return (
        !step.grantSelection ||
        !shouldSkipExistingStep(
          params.draft.selections[step.slotId],
          params.readExistingGrantedSelection(step.grantSelection)
        )
      );
    });
}

function shouldSkipExistingStep(draftSelection: SelectionRef | undefined, actorSelection: string | null): boolean {
  return !!actorSelection && !draftSelection;
}
