import { buildSpellshotSpellChoiceSteps } from "../spell-choice/class-archetype-step-builder.js";
import type { ClassContributor } from "./types.js";

export const gunslingerContributor: ClassContributor = {
  slug: "gunslinger",
  async buildSpellChoiceSteps(args) {
    return buildSpellshotSpellChoiceSteps({
      draft: args.draft,
      targetLevel: args.targetLevel,
      effectiveClassFeatureDocuments: args.effectiveClassFeatureDocuments ?? [],
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
    });
  },
};
