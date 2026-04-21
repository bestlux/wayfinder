import type { DraftState, PendingStep } from "../../types.js";
import type {
  ReadExistingSpellChoiceSelections,
  SpellChoiceClassDocument,
  SpellChoiceDeityDocument,
  SpellChoiceDocumentLike,
  SpellChoiceSchoolDocument,
} from "../spell-choice/types.js";

export interface BuildClassContributionDependencies {
  extractSlug: (document: SpellChoiceDocumentLike | null) => string | null;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export interface BuildClassContributionArgs {
  draft: DraftState;
  currentLevel: number;
  targetLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  effectiveDeityDocument: SpellChoiceDeityDocument | null;
  effectiveSchoolDocument: SpellChoiceSchoolDocument | null;
  deps: BuildClassContributionDependencies;
}

export interface ClassContributor {
  slug: string;
  buildPlanSteps(args: BuildClassContributionArgs): Promise<PendingStep[]>;
}
