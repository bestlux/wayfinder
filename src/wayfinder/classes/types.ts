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
}

export interface BuildClassSpellChoiceStepsArgs extends BuildClassContributionDependencies {
  draft: DraftState;
  currentLevel: number;
  targetLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  effectiveDeityDocument: SpellChoiceDeityDocument | null;
  effectiveSchoolDocument: SpellChoiceSchoolDocument | null;
  effectiveClassFeatureDocuments?: SpellChoiceSchoolDocument[];
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export interface ClassContributor {
  slug: string;
  buildSpellChoiceSteps?: (args: BuildClassSpellChoiceStepsArgs) => Promise<PendingStep[]>;
}
