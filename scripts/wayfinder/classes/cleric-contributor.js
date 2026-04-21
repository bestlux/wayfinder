import { buildClericSpellChoiceSteps } from "../spell-choice/cleric-step-builder.js";
const CLERIC_CLASS_SLUG = "cleric";
export const clericContributor = {
    slug: CLERIC_CLASS_SLUG,
    async buildPlanSteps(args) {
        return buildClericSpellChoiceSteps({
            draft: args.draft,
            effectiveClassDocument: args.effectiveClassDocument,
            effectiveDeityDocument: args.effectiveDeityDocument,
            readExistingSpellChoiceSelections: args.deps.readExistingSpellChoiceSelections,
            classSlug: CLERIC_CLASS_SLUG,
        });
    },
};
//# sourceMappingURL=cleric-contributor.js.map