import { buildGrantChoiceStepsFromRules } from "./grant-choice/step-builders.js";
export async function buildGrantChoiceSteps(params) {
    if (params.targetLevel < 1) {
        return [];
    }
    return params.sources
        .flatMap((source) => buildGrantChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
    }))
        .filter((step) => {
        const dependency = step.grantSelection?.dependsOn ?? null;
        if (dependency === "class" && !params.hasClassSelection) {
            return false;
        }
        if (dependency === "deity" && !params.hasDeitySelection) {
            return false;
        }
        return (!step.grantSelection ||
            !shouldSkipExistingStep(params.draft.selections[step.slotId], params.readExistingGrantedSelection(step.grantSelection)));
    });
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
//# sourceMappingURL=grant-choice-service.js.map