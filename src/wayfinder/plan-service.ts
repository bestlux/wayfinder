import type { inspectActor } from "../actor-inspector.js";
import type { EffectiveBuildState } from "../build-state.js";
import { buildProgressionPlan, sortPendingSteps } from "../progression.js";
import type { DraftState, PendingStep, StepKind } from "../types.js";
import {
  getWayfinderStepStatus as getDomainStepStatus,
  isWayfinderStepComplete as isDomainStepComplete,
  type StepEvaluationDependencies,
} from "./domain/step-evaluation.js";
import { getStepModeLabel } from "./domain/step-types.js";

type ActorSnapshot = ReturnType<typeof inspectActor>;

interface BuildPlanDependencies {
  buildClassFeatSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassTrainingSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildSingletonChoiceSteps: (
    snapshot: ActorSnapshot,
    draft: DraftState,
    targetLevel: number
  ) => Promise<PendingStep[]>;
  buildLanguageChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassBranchSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassGrantedItemSteps: (
    snapshot: ActorSnapshot,
    draft: DraftState,
    targetLevel: number
  ) => Promise<PendingStep[]>;
  buildClassChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildSpellChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
}

export async function buildWayfinderPlan(
  snapshot: ActorSnapshot,
  draft: DraftState,
  deps: BuildPlanDependencies
): Promise<ReturnType<typeof buildProgressionPlan>> {
  const plan = buildProgressionPlan(snapshot, draft.targetLevel);
  const [
    classFeatSteps,
    trainingSteps,
    singletonChoiceSteps,
    languageChoiceSteps,
    branchSteps,
    grantedItemSteps,
    classChoiceSteps,
    spellChoiceSteps,
  ] = await Promise.all([
    deps.buildClassFeatSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassTrainingSteps(snapshot, draft, plan.targetLevel),
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
      ...grantedItemSteps,
      ...trainingSteps,
      ...singletonChoiceSteps,
      ...languageChoiceSteps,
      ...branchSteps,
      ...classChoiceSteps,
      ...spellChoiceSteps,
    ]),
  };
}

export async function resolveActiveStep(
  steps: PendingStep[],
  activeStepId: string | null,
  isStepComplete: (step: PendingStep) => Promise<boolean>
): Promise<{ activeStep: PendingStep | null; activeStepId: string | null }> {
  if (steps.length === 0) {
    return { activeStep: null, activeStepId: null };
  }

  const explicit = steps.find((step) => step.id === activeStepId);
  if (explicit) {
    return { activeStep: explicit, activeStepId: explicit.id };
  }

  let nextIncomplete: PendingStep | null = null;
  for (const step of steps) {
    if (!(await isStepComplete(step))) {
      nextIncomplete = step;
      break;
    }
  }

  nextIncomplete ??= steps[0];
  return { activeStep: nextIncomplete, activeStepId: nextIncomplete.id };
}

export async function isWayfinderStepComplete(
  step: PendingStep,
  draft: DraftState,
  effectiveBuildState: EffectiveBuildState,
  deps: StepEvaluationDependencies
): Promise<boolean> {
  return isDomainStepComplete(step, draft, effectiveBuildState, deps);
}

export async function getWayfinderStepStatus(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: Set<string>,
  effectiveBuildState: EffectiveBuildState,
  deps: StepEvaluationDependencies
): Promise<string> {
  return getDomainStepStatus(step, draft, recentlyInvalidatedStepIds, effectiveBuildState, deps);
}

export function modeLabel(kind: StepKind): string {
  return getStepModeLabel(kind);
}
