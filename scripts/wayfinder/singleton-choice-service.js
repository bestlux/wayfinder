import { matchesChoicePredicateList } from "./rule-data.js";
import { buildSingletonChoiceStepsFromRules } from "./singleton-choice/step-builders.js";
export async function buildSingletonChoiceSteps(params) {
    const steps = params.sources.flatMap((source) => buildSingletonChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
        localize: params.localize,
    }));
    const activeRollOptions = buildActiveRollOptions(steps, params.draft, params.readExistingSingletonChoiceSelection);
    return steps
        .filter((step) => step.level <= params.targetLevel)
        .filter((step) => matchesPredicate(step.singletonChoice.predicate, activeRollOptions))
        .filter((step) => !shouldSkipExistingStep(params.draft.singletonChoices[step.slotId], params.readExistingSingletonChoiceSelection(step.singletonChoice)));
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
function buildActiveRollOptions(steps, draft, readExistingSingletonChoiceSelection) {
    const active = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const step of steps) {
            if (step.kind !== "singleton-choice" || !matchesPredicate(step.singletonChoice.predicate, active)) {
                continue;
            }
            const selectedValue = draft.singletonChoices[step.slotId] ?? readExistingSingletonChoiceSelection(step.singletonChoice);
            const rollOption = step.singletonChoice.rollOption;
            if (!selectedValue || !rollOption) {
                continue;
            }
            const activeRollOption = `${rollOption}:${selectedValue}`;
            if (!active.has(activeRollOption)) {
                active.add(activeRollOption);
                changed = true;
            }
        }
    }
    return active;
}
function matchesPredicate(predicate, activeRollOptions) {
    return matchesChoicePredicateList(predicate, (statement) => activeRollOptions.has(statement));
}
//# sourceMappingURL=singleton-choice-service.js.map