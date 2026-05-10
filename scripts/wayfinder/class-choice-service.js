import { buildClassBranchStepsFromRules, buildClassChoiceStepsFromRules, buildClassGrantedItemStepsFromRules, buildClassTrainingStepsFromRules, } from "./class-choice/step-builders.js";
import { remainingCreationBoostChoices } from "./domain/boost-rules.js";
import { createPickItemStep } from "./domain/step-types.js";
import { discoverSourceSkillTrainingMeta } from "./skill-training/source-discovery.js";
export async function buildClassTrainingSteps(params) {
    const { draftClassSelection, sourceSelections = [], targetLevel, effectiveBuildState, fetchSelectionDocument, extractSlug, localize, } = params;
    if (!draftClassSelection || targetLevel < 1) {
        return [];
    }
    if (!effectiveBuildState.ancestry ||
        !effectiveBuildState.background ||
        !effectiveBuildState.class ||
        remainingCreationBoostChoices(effectiveBuildState) > 0) {
        return [];
    }
    const effectiveClassDocument = await fetchSelectionDocument(draftClassSelection);
    const steps = buildClassTrainingStepsFromRules({
        effectiveClassDocument,
        classSelection: draftClassSelection,
        extractSlug,
        localize,
        intelligenceModifier: effectiveBuildState.projectedAbilities.int.modifier,
    });
    const sourceTraining = discoverSourceSkillTrainingMeta({
        sources: sourceSelections,
        localize,
    });
    return steps.map((step) => ({
        ...step,
        training: {
            ...step.training,
            fixedSkills: Array.from(new Set([...step.training.fixedSkills, ...sourceTraining.fixedSkills])),
            fixedLores: Array.from(new Set([...step.training.fixedLores, ...sourceTraining.fixedLores])),
            choiceRules: [...step.training.choiceRules, ...sourceTraining.choiceRules],
            loreChoices: [...step.training.loreChoices, ...sourceTraining.loreChoices],
        },
    }));
}
export async function buildClassFeatSteps(params) {
    return buildFeatStepsFromClassLevels({
        ...params,
        levelField: "classFeatLevels",
        slotKind: "class-feat",
        title: (level) => `Level ${level} class feat`,
        description: "Pick a class or archetype feat unlocked at this milestone.",
        filters: (level) => ({
            itemType: "feat",
            featTypes: ["class", "archetype"],
            maxLevel: level,
        }),
    });
}
export async function buildClassSkillFeatSteps(params) {
    return buildFeatStepsFromClassLevels({
        ...params,
        levelField: "skillFeatLevels",
        slotKind: "skill-feat",
        title: (level) => `Level ${level} skill feat`,
        description: "Pick the skill feat unlocked at this class milestone.",
        filters: (level) => ({
            itemType: "feat",
            featTypes: ["skill"],
            maxLevel: level,
        }),
    });
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
function buildFeatStepsFromClassLevels(args) {
    const { effectiveClassDocument, levelField, slotKind, targetLevel, fulfilledCount } = args;
    if (!effectiveClassDocument) {
        return [];
    }
    const rawLevels = effectiveClassDocument.system?.[levelField]?.value;
    const levels = Array.isArray(rawLevels)
        ? rawLevels
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 1 && value <= targetLevel)
            .map((value) => Math.floor(value))
        : [];
    if (levels.length === 0) {
        return [];
    }
    const milestones = Array.from(new Set(levels)).sort((left, right) => left - right);
    const fulfilledSlotIds = fulfilledStepIdsForKind(args.fulfilledStepIds ?? [], slotKind);
    const effectiveMilestones = fulfilledSlotIds.size > 0
        ? milestones.filter((level) => !fulfilledSlotIds.has(`${slotKind}-level-${level}`))
        : milestones.slice(Math.min(Math.max(0, fulfilledCount), milestones.length));
    return effectiveMilestones.map((level) => createPickItemStep(slotKind, level, args.title(level), args.description, args.filters(level)));
}
function fulfilledStepIdsForKind(fulfilledStepIds, slotKind) {
    const prefix = `${slotKind}-level-`;
    return new Set(fulfilledStepIds.filter((slotId) => slotId.startsWith(prefix)));
}
//# sourceMappingURL=class-choice-service.js.map