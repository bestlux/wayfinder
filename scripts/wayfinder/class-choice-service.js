import { slugifyName } from "../shared/slug.js";
import { buildClassBranchStepsFromRules, buildClassChoiceStepsFromFeatureSources, buildClassChoiceStepsFromRules, buildClassGrantedItemStepsFromRules, buildClassTrainingStepsFromRules, } from "./class-choice/step-builders.js";
import { remainingCreationBoostChoices } from "./domain/boost-rules.js";
import { createPickItemStep } from "./domain/step-types.js";
import { matchesChoicePredicateList } from "./rule-data.js";
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
    const classChoiceSteps = await buildClassChoiceStepsFromRules({
        ...params,
        effectiveDeityDocument: null,
        localize: (value) => value,
    });
    const rollOptions = buildDraftClassBranchRollOptions(params.draft, steps, classChoiceSteps);
    return steps.filter((step) => branchPredicateMatches(step.branch, rollOptions) &&
        !shouldSkipExistingStep(params.draft.branchSelections[step.slotId], params.readExistingBranchSelection(step.branch)));
}
function branchPredicateMatches(branch, rollOptions) {
    if (!Array.isArray(branch.predicate) || branch.predicate.length === 0) {
        return true;
    }
    return matchesChoicePredicateList(branch.predicate, (statement) => rollOptions.has(statement.toLowerCase()));
}
function buildDraftClassBranchRollOptions(draft, branchSteps, classChoiceSteps) {
    const rollOptions = new Set();
    const classSelection = Object.values(draft.selections).find((selection) => selection.itemType === "class");
    if (classSelection?.name) {
        rollOptions.add(`class:${slugifyName(classSelection.name)}`);
    }
    for (const step of classChoiceSteps) {
        if (step.kind !== "class-choice") {
            continue;
        }
        const value = draft.classChoices[step.slotId];
        if (typeof value !== "string" || value.length === 0) {
            continue;
        }
        if (step.classChoice.rollOption) {
            rollOptions.add(`${step.classChoice.rollOption}:${value}`.toLowerCase());
        }
        rollOptions.add(`${step.classChoice.flag}:${value}`.toLowerCase());
    }
    for (const [slotId, value] of Object.entries(draft.classChoices)) {
        for (const key of possibleClassChoiceRollOptionKeys(slotId)) {
            rollOptions.add(`${key}:${value}`.toLowerCase());
        }
    }
    for (const step of branchSteps) {
        if (step.kind !== "class-branch" || !step.branch?.rollOption) {
            continue;
        }
        const selection = draft.branchSelections[step.slotId];
        if (selection?.name) {
            rollOptions.add(`${step.branch.rollOption}:${slugifyName(selection.name)}`.toLowerCase());
        }
    }
    return rollOptions;
}
function possibleClassChoiceRollOptionKeys(slotId) {
    const match = /^class-choice-(.+)-level-\d+$/.exec(slotId);
    if (!match?.[1]) {
        return [];
    }
    const parts = match[1].split("-");
    return parts.map((_, index) => parts.slice(index).join("-")).filter(Boolean);
}
export async function buildClassGrantedItemSteps(params) {
    const steps = await buildClassGrantedItemStepsFromRules(params);
    return steps.filter((step) => !step.grantSelection ||
        !shouldSkipExistingStep(params.draft.selections[step.slotId], params.readExistingGrantedSelection(step.grantSelection)));
}
export async function buildClassChoiceSteps(params) {
    const classSlug = params.effectiveClassDocument ? params.extractSlug(params.effectiveClassDocument) : null;
    const steps = [
        ...(await buildClassChoiceStepsFromRules(params)),
        ...buildClassChoiceStepsFromFeatureSources({
            classFeatures: params.additionalClassFeatures ?? [],
            classSlug,
            effectiveDeityDocument: params.effectiveDeityDocument,
            extractSlug: params.extractSlug,
            localize: params.localize,
        }),
    ];
    return dedupeStepsBySlotId(steps).filter((step) => !shouldSkipExistingStep(params.draft.classChoices[step.slotId], params.readExistingClassChoiceSelection(step.classChoice)));
}
function dedupeStepsBySlotId(steps) {
    const bySlotId = new Map();
    for (const step of steps) {
        bySlotId.set(step.slotId, step);
    }
    return Array.from(bySlotId.values());
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