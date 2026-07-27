import { buildSingletonChoiceStepsFromRules } from "./singleton-choice/step-builders.js";
export async function buildSingletonChoiceSteps(params) {
    const activeRollOptions = new Set(params.activeRollOptions ?? []);
    let steps = [];
    let changed = true;
    while (changed) {
        steps = params.sources.flatMap((source) => buildSingletonChoiceStepsFromRules({
            sourceItemType: source.sourceItemType,
            effectiveSourceDocument: source.sourceDocument,
            sourceSelection: source.sourceSelection,
            sourceLevel: source.sourceLevel,
            extractSlug: params.extractSlug,
            localize: params.localize,
            activeRollOptions,
        }));
        changed = addSelectedRollOptions(activeRollOptions, steps, params.draft, params.readExistingSingletonChoiceSelection);
    }
    return steps
        .filter((step) => step.level <= params.targetLevel)
        .filter((step) => !shouldSkipExistingStep(params.draft.singletonChoices[step.slotId], params.readExistingSingletonChoiceSelection(step.singletonChoice)));
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
function addSelectedRollOptions(active, steps, draft, readExistingSingletonChoiceSelection) {
    let changed = false;
    for (const step of steps) {
        if (step.kind !== "singleton-choice") {
            continue;
        }
        const selectedValue = draft.singletonChoices[step.slotId] ?? readExistingSingletonChoiceSelection(step.singletonChoice);
        const rollOption = step.singletonChoice.rollOption;
        if (!selectedValue || !rollOption) {
            continue;
        }
        const activeRollOption = `${rollOption}:${selectedValue}`.toLowerCase();
        if (!active.has(activeRollOption)) {
            active.add(activeRollOption);
            changed = true;
        }
    }
    return changed;
}
//# sourceMappingURL=singleton-choice-service.js.map