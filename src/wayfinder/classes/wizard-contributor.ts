import { buildWizardSpellChoiceSteps } from "../spell-choice/wizard-step-builder.js";
import type { ClassContributor } from "./types.js";

const WIZARD_CLASS_SLUG = "wizard";

export const wizardContributor: ClassContributor = {
  slug: WIZARD_CLASS_SLUG,
  async buildSpellChoiceSteps(args) {
    return buildWizardSpellChoiceSteps({
      draft: args.draft,
      currentLevel: args.currentLevel,
      effectiveClassDocument: args.effectiveClassDocument,
      effectiveSchoolDocument: args.effectiveSchoolDocument,
      targetLevel: args.targetLevel,
      extractSlug: args.extractSlug,
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
      classSlug: WIZARD_CLASS_SLUG,
    });
  },
};
