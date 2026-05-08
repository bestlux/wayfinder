import { buildWizardSpellChoiceSteps } from "../spell-choice/wizard-step-builder.js";
const WIZARD_CLASS_SLUG = "wizard";
export const wizardContributor = {
    slug: WIZARD_CLASS_SLUG,
    async buildSpellChoiceSteps(args) {
        return buildWizardSpellChoiceSteps({
            draft: args.draft,
            currentLevel: args.currentLevel,
            effectiveClassDocument: args.effectiveClassDocument,
            effectiveSchoolDocument: args.effectiveSchoolDocument,
            effectiveClassFeatureDocuments: args.effectiveClassFeatureDocuments ?? [],
            targetLevel: args.targetLevel,
            extractSlug: args.extractSlug,
            readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
            classSlug: WIZARD_CLASS_SLUG,
        });
    },
};
//# sourceMappingURL=wizard-contributor.js.map