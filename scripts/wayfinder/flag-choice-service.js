import { buildFlagChoiceStepsFromRules } from "./flag-choice/step-builders.js";
export async function buildFlagChoiceSteps(params) {
    return params.sources
        .flatMap((source) => buildFlagChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
        localize: params.localize,
        actorContext: params.actorContext,
        requireResolvedActorPlaceholders: true,
    }))
        .filter((step) => step.level <= params.targetLevel)
        .filter((step) => !step.flagChoice ||
        !shouldSkipExistingStep(params.draft.selections[step.slotId], params.readExistingFlagChoiceSelection(step.flagChoice)));
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
//# sourceMappingURL=flag-choice-service.js.map