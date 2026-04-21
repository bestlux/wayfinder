import { buildClassBranchStepsFromRules, buildClassChoiceStepsFromRules, buildClassGrantedItemStepsFromRules, buildClassTrainingStepsFromRules, } from "./class-choice/step-builders.js";
import { createPickItemStep } from "./domain/step-types.js";
export async function buildClassTrainingSteps(params) {
    const { draftClassSelection, targetLevel, fetchSelectionDocument, extractSlug, localize } = params;
    if (!draftClassSelection || targetLevel < 1) {
        return [];
    }
    const effectiveClassDocument = await fetchSelectionDocument(draftClassSelection);
    return buildClassTrainingStepsFromRules({
        effectiveClassDocument,
        extractSlug,
        localize,
    });
}
export async function buildClassFeatSteps(params) {
    const { effectiveClassDocument, targetLevel, fulfilledCount } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classFeatLevelValues = effectiveClassDocument.system?.classFeatLevels?.value;
    const classFeatLevels = Array.isArray(classFeatLevelValues)
        ? classFeatLevelValues
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 1 && value <= targetLevel)
            .map((value) => Math.floor(value))
        : [];
    if (classFeatLevels.length === 0) {
        return [];
    }
    const milestones = Array.from(new Set(classFeatLevels)).sort((left, right) => left - right);
    const startIndex = Math.min(Math.max(0, fulfilledCount), milestones.length);
    return milestones.slice(startIndex).map((level) => createPickItemStep("class-feat", level, `Level ${level} class feat`, "Pick a class or archetype feat unlocked at this milestone.", {
        itemType: "feat",
        featTypes: ["class", "archetype"],
        maxLevel: level,
    }));
}
export async function buildClassBranchSteps(params) {
    const steps = await buildClassBranchStepsFromRules(params);
    return steps.filter((step) => !shouldSkipExistingStep(params.draft.branchSelections[step.slotId], params.readExistingBranchSelection(step.branch)));
}
export async function buildClassGrantedItemSteps(params) {
    const steps = await buildClassGrantedItemStepsFromRules(params);
    return steps.filter((step) => !step.grantSelection ||
        !shouldSkipExistingStep(params.draft.selections[step.slotId], params.readExistingGrantedSelection(step.grantSelection)));
}
export async function buildClassChoiceSteps(params) {
    const steps = await buildClassChoiceStepsFromRules(params);
    return steps.filter((step) => !shouldSkipExistingStep(params.draft.classChoices[step.slotId], params.readExistingClassChoiceSelection(step.classChoice)));
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
//# sourceMappingURL=class-choice-service.js.map