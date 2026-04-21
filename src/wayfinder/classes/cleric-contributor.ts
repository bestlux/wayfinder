import { buildClericSpellChoiceSteps } from "../spell-choice/cleric-step-builder.js";
import type { ClassContributor } from "./types.js";

const CLERIC_CLASS_SLUG = "cleric";

export const clericContributor: ClassContributor = {
  slug: CLERIC_CLASS_SLUG,
  async buildSpellChoiceSteps(args) {
    return buildClericSpellChoiceSteps({
      draft: args.draft,
      effectiveClassDocument: args.effectiveClassDocument,
      effectiveDeityDocument: args.effectiveDeityDocument,
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
      classSlug: CLERIC_CLASS_SLUG,
    });
  },
};
