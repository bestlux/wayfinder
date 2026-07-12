import { buildPalatineDetectiveSpellChoiceSteps } from "../spell-choice/class-archetype-step-builder.js";
export const investigatorContributor = {
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
//# sourceMappingURL=investigator-contributor.js.map