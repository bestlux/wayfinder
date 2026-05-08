import type { PendingStep } from "../../types.js";
import type { ClassContributor } from "../classes/types.js";
import {
  asSpellChoiceClassDocument,
  asSpellChoiceDeityDocument,
  asSpellChoiceSchoolDocument,
  type BuildSpellChoiceStepsParams,
} from "./types.js";

export async function buildSpellChoiceStepsForContributor(
  params: BuildSpellChoiceStepsParams,
  contributor?: ClassContributor
): Promise<PendingStep[]> {
  const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
  if (!effectiveClassDocument) {
    return [];
  }

  return (
    (await contributor?.buildSpellChoiceSteps?.({
      draft: params.draft,
      currentLevel: params.currentLevel,
      targetLevel: params.targetLevel,
      effectiveClassDocument,
      effectiveDeityDocument: asSpellChoiceDeityDocument(params.effectiveDeityDocument),
      effectiveSchoolDocument: asSpellChoiceSchoolDocument(params.effectiveSchoolDocument),
      effectiveClassFeatureDocuments: (params.effectiveClassFeatureDocuments ?? [])
        .map((document) => asSpellChoiceSchoolDocument(document))
        .filter((document): document is NonNullable<typeof document> => document !== null),
      extractSlug: params.extractSlug,
      readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
    })) ?? []
  );
}
