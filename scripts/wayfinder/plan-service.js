import { buildProgressionPlan, sortPendingSteps } from "../progression.js";
import { getWayfinderStepStatus as getDomainStepStatus, isWayfinderStepComplete as isDomainStepComplete, } from "./domain/step-evaluation.js";
import { getStepModeLabel } from "./domain/step-types.js";
export async function buildWayfinderPlan(snapshot, draft, deps) {
    const plan = buildProgressionPlan(snapshot, draft.targetLevel);
    const [classFeatSteps, classSkillFeatSteps, trainingSteps, grantChoiceSteps, singletonChoiceSteps, languageChoiceSteps, branchSteps, grantedItemSteps, classChoiceSteps, spellChoiceSteps,] = await Promise.all([
        deps.buildClassFeatSteps(snapshot, draft, plan.targetLevel),
        deps.buildClassSkillFeatSteps(snapshot, draft, plan.targetLevel),
        deps.buildClassTrainingSteps(snapshot, draft, plan.targetLevel),
        deps.buildGrantChoiceSteps(snapshot, draft, plan.targetLevel),
        deps.buildSingletonChoiceSteps(snapshot, draft, plan.targetLevel),
        deps.buildLanguageChoiceSteps(snapshot, draft, plan.targetLevel),
        deps.buildClassBranchSteps(snapshot, draft, plan.targetLevel),
        deps.buildClassGrantedItemSteps(snapshot, draft, plan.targetLevel),
        deps.buildClassChoiceSteps(snapshot, draft, plan.targetLevel),
        deps.buildSpellChoiceSteps(snapshot, draft, plan.targetLevel),
    ]);
    return {
        ...plan,
        steps: sortPendingSteps([
            ...plan.steps,
            ...classFeatSteps,
            ...classSkillFeatSteps,
            ...grantedItemSteps,
            ...trainingSteps,
            ...grantChoiceSteps,
            ...singletonChoiceSteps,
            ...languageChoiceSteps,
            ...branchSteps,
            ...classChoiceSteps,
            ...spellChoiceSteps,
        ]),
    };
}
export async function resolveActiveStep(steps, activeStepId, isStepComplete) {
    if (steps.length === 0) {
        return { activeStep: null, activeStepId: null };
    }
    const explicit = steps.find((step) => step.id === activeStepId);
    if (explicit) {
        return { activeStep: explicit, activeStepId: explicit.id };
    }
    let nextIncomplete = null;
    for (const step of steps) {
        if (!(await isStepComplete(step))) {
            nextIncomplete = step;
            break;
        }
    }
    nextIncomplete ??= steps[0];
    return { activeStep: nextIncomplete, activeStepId: nextIncomplete.id };
}
export async function isWayfinderStepComplete(step, draft, effectiveBuildState, deps) {
    return isDomainStepComplete(step, draft, effectiveBuildState, deps);
}
export async function getWayfinderStepStatus(step, draft, recentlyInvalidatedStepIds, effectiveBuildState, deps) {
    return getDomainStepStatus(step, draft, recentlyInvalidatedStepIds, effectiveBuildState, deps);
}
export function modeLabel(kind) {
    return getStepModeLabel(kind);
}
//# sourceMappingURL=plan-service.js.map