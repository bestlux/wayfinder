import { buildPalatineDetectiveSpellChoiceSteps } from "../spell-choice/class-archetype-step-builder.js";
import type { ClassContributor } from "./types.js";

export const investigatorContributor: ClassContributor = {
  slug: "investigator",
  async buildSpellChoiceSteps(args) {
    return buildPalatineDetectiveSpellChoiceSteps({
      draft: args.draft,
      targetLevel: args.targetLevel,
      effectiveClassFeatureDocuments: args.effectiveClassFeatureDocuments ?? [],
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
    });
  },
};
