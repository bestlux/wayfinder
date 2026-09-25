import { buildBloodragerSpellChoiceSteps } from "../spell-choice/bloodrager-step-builder.js";
import type { ClassContributor } from "./types.js";

export const barbarianContributor: ClassContributor = {
  slug: "barbarian",
  async buildSpellChoiceSteps(args) {
    return buildBloodragerSpellChoiceSteps({
      draft: args.draft,
      targetLevel: args.targetLevel,
      effectiveClassFeatureDocuments: args.effectiveClassFeatureDocuments ?? [],
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
    });
  },
};
