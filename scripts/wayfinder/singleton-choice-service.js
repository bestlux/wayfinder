import { buildSingletonChoiceStepsFromRules } from "./singleton-choice/step-builders.js";
export async function buildSingletonChoiceSteps(params) {
    const steps = params.sources.flatMap((source) => buildSingletonChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
        localize: params.localize,
    }));
    return steps
        .filter((step) => step.level <= params.targetLevel)
        .filter((step) => !shouldSkipExistingStep(params.draft.singletonChoices[step.slotId], params.readExistingSingletonChoiceSelection(step.singletonChoice)));
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
//# sourceMappingURL=singleton-choice-service.js.map