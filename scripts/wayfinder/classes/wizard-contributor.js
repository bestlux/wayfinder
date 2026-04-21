import { buildWizardSpellChoiceSteps } from "../spell-choice/wizard-step-builder.js";
const WIZARD_CLASS_SLUG = "wizard";
export const wizardContributor = {
    slug: WIZARD_CLASS_SLUG,
    async buildPlanSteps(args) {
        return buildWizardSpellChoiceSteps({
            draft: args.draft,
            currentLevel: args.currentLevel,
            effectiveClassDocument: args.effectiveClassDocument,
            effectiveSchoolDocument: args.effectiveSchoolDocument,
            targetLevel: args.targetLevel,
            extractSlug: args.deps.extractSlug,
            readExistingSpellChoiceSelections: args.deps.readExistingSpellChoiceSelections,
            classSlug: WIZARD_CLASS_SLUG,
        });
    },
};
//# sourceMappingURL=wizard-contributor.js.map