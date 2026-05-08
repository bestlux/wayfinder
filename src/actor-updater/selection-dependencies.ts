import type { EmbeddedItemSource, SelectionDocumentLike } from "../shared/actor-model.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";

export interface CreateEmbeddedSourceDependencies {
  fetchSelectionDocument: (selection: SelectionRef) => Promise<SelectionDocumentLike | null>;
  stripPreselectedClassFeatureEntries: (source: EmbeddedItemSource, draft: DraftState, steps: PendingStep[]) => void;
  stripPreselectedClassBranchEntries: (source: EmbeddedItemSource, draft: DraftState, steps: PendingStep[]) => void;
}

export interface InsertFeatSelectionDependencies {
  fetchSelectionDocument: (selection: SelectionRef) => Promise<SelectionDocumentLike | null>;
  createEmbeddedSource: (
    selection: SelectionRef,
    draft?: DraftState,
    steps?: PendingStep[]
  ) => Promise<EmbeddedItemSource | null>;
}
