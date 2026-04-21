import type { PendingStep } from "../../types.js";
import { getClassContributor } from "../classes/registry.js";
import {
  asSpellChoiceClassDocument,
  asSpellChoiceDeityDocument,
  asSpellChoiceSchoolDocument,
  type BuildSpellChoiceStepsParams,
} from "./types.js";

export async function buildSpellChoiceSteps(params: BuildSpellChoiceStepsParams): Promise<PendingStep[]> {
  const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
  if (!effectiveClassDocument) {
    return [];
  }

  return getClassContributor(params.extractSlug(effectiveClassDocument)).buildPlanSteps({
    draft: params.draft,
    currentLevel: params.currentLevel,
    targetLevel: params.targetLevel,
    effectiveClassDocument,
    effectiveDeityDocument: asSpellChoiceDeityDocument(params.effectiveDeityDocument),
    effectiveSchoolDocument: asSpellChoiceSchoolDocument(params.effectiveSchoolDocument),
    deps: {
      extractSlug: params.extractSlug,
      readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
    },
  });
}
