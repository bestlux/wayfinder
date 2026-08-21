import type { inspectActor } from "../actor-inspector.js";
import type { EffectiveBuildState } from "../build-state.js";
import { buildProgressionPlan, sortPendingSteps } from "../progression.js";
import type { DraftState, PendingStep, StepKind } from "../types.js";
import { dedupeChoiceRuleSteps } from "./domain/choice-rule-ownership.js";
import {
  evaluateWayfinderStep as evaluateDomainStep,
  getWayfinderStepStatus as getDomainStepStatus,
  isWayfinderStepComplete as isDomainStepComplete,
  type WayfinderStepEvaluation,
} from "./domain/step-evaluation.js";
import { createStartingEquipmentStep, getStepModeLabel } from "./domain/step-types.js";

type ActorSnapshot = ReturnType<typeof inspectActor>;

interface BuildPlanDependencies {
  buildClassFeatSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassSkillFeatSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassTrainingSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildGrantChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildFlagChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildSingletonChoiceSteps: (
    snapshot: ActorSnapshot,
    draft: DraftState,
    targetLevel: number
  ) => Promise<PendingStep[]>;
  buildLanguageChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassArchetypeSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
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
    classSkillFeatSteps,
    trainingSteps,
    grantChoiceSteps,
    flagChoiceSteps,
    singletonChoiceSteps,
    languageChoiceSteps,
    classArchetypeSteps,
    branchSteps,
    grantedItemSteps,
    classChoiceSteps,
    spellChoiceSteps,
  ] = await Promise.all([
    deps.buildClassFeatSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassSkillFeatSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassTrainingSteps(snapshot, draft, plan.targetLevel),
    deps.buildGrantChoiceSteps(snapshot, draft, plan.targetLevel),
    deps.buildFlagChoiceSteps(snapshot, draft, plan.targetLevel),
    deps.buildSingletonChoiceSteps(snapshot, draft, plan.targetLevel),
    deps.buildLanguageChoiceSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassArchetypeSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassBranchSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassGrantedItemSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassChoiceSteps(snapshot, draft, plan.targetLevel),
    deps.buildSpellChoiceSteps(snapshot, draft, plan.targetLevel),
  ]);
  const progressionSteps =
    classSkillFeatSteps.length > 0 ? plan.steps.filter((step) => step.slotKind !== "skill-feat") : plan.steps;

  const registeredSteps = dedupeChoiceRuleSteps([
    ...progressionSteps,
    ...classFeatSteps,
    ...classSkillFeatSteps,
    ...grantedItemSteps,
    ...trainingSteps,
    ...grantChoiceSteps,
    ...flagChoiceSteps,
    ...singletonChoiceSteps,
    ...languageChoiceSteps,
    ...classArchetypeSteps,
    ...branchSteps,
    ...classChoiceSteps,
    ...spellChoiceSteps,
  ]);

  const equipmentSlotId = `starting-equipment-level-${plan.targetLevel}`;
  const targetLevelSteps = !snapshot.fulfilledStepIds.includes(equipmentSlotId)
    ? [...registeredSteps, createStartingEquipmentStep(plan.targetLevel)]
    : registeredSteps;

  return {
    ...plan,
    steps: sortPendingSteps(targetLevelSteps),
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
  effectiveBuildState: EffectiveBuildState
): Promise<boolean> {
  return isDomainStepComplete(step, draft, effectiveBuildState);
}

export async function getWayfinderStepStatus(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: Set<string>,
  effectiveBuildState: EffectiveBuildState
): Promise<string> {
  return getDomainStepStatus(step, draft, recentlyInvalidatedStepIds, effectiveBuildState);
}

export async function evaluateWayfinderStep(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: ReadonlySet<string>,
  effectiveBuildState: EffectiveBuildState
): Promise<WayfinderStepEvaluation> {
  return evaluateDomainStep(step, draft, recentlyInvalidatedStepIds, effectiveBuildState);
}

export function modeLabel(kind: StepKind): string {
  return getStepModeLabel(kind);
}
