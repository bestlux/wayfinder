import { buildBloodragerSpellChoiceSteps } from "../spell-choice/bloodrager-step-builder.js";
export const barbarianContributor = {
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
//# sourceMappingURL=barbarian-contributor.js.map