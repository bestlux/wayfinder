import { buildClericSpellChoiceSteps } from "../spell-choice/cleric-step-builder.js";
const CLERIC_CLASS_SLUG = "cleric";
export const clericContributor = {
    slug: CLERIC_CLASS_SLUG,
    async buildSpellChoiceSteps(args) {
        return buildClericSpellChoiceSteps({
            draft: args.draft,
            effectiveClassDocument: args.effectiveClassDocument,
            effectiveDeityDocument: args.effectiveDeityDocument,
            effectiveClassFeatureDocuments: args.effectiveClassFeatureDocuments ?? [],
            readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
            classSlug: CLERIC_CLASS_SLUG,
        });
    },
};
//# sourceMappingURL=cleric-contributor.js.map