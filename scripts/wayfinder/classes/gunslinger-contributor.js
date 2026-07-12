import { buildSpellshotSpellChoiceSteps } from "../spell-choice/class-archetype-step-builder.js";
export const gunslingerContributor = {
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
//# sourceMappingURL=gunslinger-contributor.js.map