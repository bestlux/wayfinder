import type { inspectActor } from "../actor-inspector.js";
import type { BOOST_LEVELS, EffectiveBuildState } from "../build-state.js";
import { SKILL_LABELS } from "../constants.js";
import { buildProgressionPlan, sortPendingSteps } from "../progression.js";
import type { DraftState, PendingStep, StepKind } from "../types.js";
import { formatSlug } from "./formatting.js";
import {
  isAncestryBoostSectionComplete,
  isBackgroundBoostSectionComplete,
  isClassBoostSectionComplete,
  remainingCreationBoostChoices,
} from "./panes/boost-pane.js";

type ActorSnapshot = ReturnType<typeof inspectActor>;

interface BuildPlanDependencies {
  buildClassFeatSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassTrainingSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassBranchSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
  buildClassGrantedItemSteps: (
    snapshot: ActorSnapshot,
    draft: DraftState,
    targetLevel: number
  ) => Promise<PendingStep[]>;
  buildClassChoiceSteps: (snapshot: ActorSnapshot, draft: DraftState, targetLevel: number) => Promise<PendingStep[]>;
}

interface StepEvaluationDependencies {
  isTrainingStepComplete: (step: PendingStep) => boolean;
}

export async function buildWayfinderPlan(
  snapshot: ActorSnapshot,
  draft: DraftState,
  deps: BuildPlanDependencies
): Promise<ReturnType<typeof buildProgressionPlan>> {
  const plan = buildProgressionPlan(snapshot, draft.targetLevel);
  const [classFeatSteps, trainingSteps, branchSteps, grantedItemSteps, classChoiceSteps] = await Promise.all([
    deps.buildClassFeatSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassTrainingSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassBranchSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassGrantedItemSteps(snapshot, draft, plan.targetLevel),
    deps.buildClassChoiceSteps(snapshot, draft, plan.targetLevel),
  ]);

  return {
    ...plan,
    steps: sortPendingSteps([
      ...plan.steps,
      ...classFeatSteps,
      ...grantedItemSteps,
      ...trainingSteps,
      ...branchSteps,
      ...classChoiceSteps,
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
  if (step.kind === "manual") {
    return draft.manual[step.slotId] === true;
  }

  if (step.kind === "pick-item") {
    return !!draft.selections[step.slotId];
  }

  if (step.kind === "class-branch") {
    return !!draft.branchSelections[step.slotId];
  }

  if (step.kind === "class-choice") {
    return typeof draft.classChoices[step.slotId] === "string" && draft.classChoices[step.slotId].length > 0;
  }

  if (step.kind === "skill-training") {
    return deps.isTrainingStepComplete(step);
  }

  if (step.kind === "skill-increase") {
    return typeof draft.skillIncreases[step.slotId] === "string" && draft.skillIncreases[step.slotId].length > 0;
  }

  if (step.level === 1) {
    return (
      !!effectiveBuildState.ancestry &&
      !!effectiveBuildState.background &&
      !!effectiveBuildState.class &&
      isAncestryBoostSectionComplete(effectiveBuildState) &&
      isBackgroundBoostSectionComplete(effectiveBuildState) &&
      isClassBoostSectionComplete(effectiveBuildState) &&
      effectiveBuildState.levelBoosts[1].length === effectiveBuildState.allowedBoosts[1]
    );
  }

  const level = step.level as (typeof BOOST_LEVELS)[number];
  return effectiveBuildState.levelBoosts[level].length === effectiveBuildState.allowedBoosts[level];
}

export async function getWayfinderStepStatus(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: Set<string>,
  effectiveBuildState: EffectiveBuildState,
  deps: StepEvaluationDependencies
): Promise<string> {
  if (step.kind === "manual") {
    return draft.manual[step.slotId] === true ? "Ready to apply" : "Needs manual review";
  }

  if (step.kind === "pick-item") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.selections[step.slotId]) {
      return "Needs attention";
    }
    return draft.selections[step.slotId]?.name ?? "Choose one";
  }

  if (step.kind === "class-branch") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.branchSelections[step.slotId]) {
      return "Needs attention";
    }
    return draft.branchSelections[step.slotId]?.name ?? "Choose one";
  }

  if (step.kind === "class-choice") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.classChoices[step.slotId]) {
      return "Needs attention";
    }

    const selected = draft.classChoices[step.slotId];
    const selectedOption = step.classChoice?.options.find((option) => option.value === selected);
    return selectedOption?.label ?? "Choose one";
  }

  if (step.kind === "skill-training") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !deps.isTrainingStepComplete(step)) {
      return "Needs attention";
    }

    const training = draft.skillTrainings[step.slotId];
    const selectedCount = training
      ? Object.values(training.ruleChoices).filter(Boolean).length + training.additional.length
      : 0;
    const total = (step.training?.choiceRules.length ?? 0) + (step.training?.additionalCount ?? 0);
    return selectedCount >= total && total > 0 ? "Ready to apply" : `${selectedCount}/${total} chosen`;
  }

  if (step.kind === "skill-increase") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.skillIncreases[step.slotId]) {
      return "Needs attention";
    }

    const slug = draft.skillIncreases[step.slotId];
    return slug ? `${SKILL_LABELS[slug] ?? formatSlug(slug)} selected` : "Choose one";
  }

  if (
    recentlyInvalidatedStepIds.has(step.slotId) &&
    !(await isWayfinderStepComplete(step, draft, effectiveBuildState, deps))
  ) {
    return "Needs attention";
  }

  if (
    step.level === 1 &&
    (!effectiveBuildState.ancestry || !effectiveBuildState.background || !effectiveBuildState.class)
  ) {
    return "Choose ancestry, background, and class first";
  }

  const remaining =
    step.level === 1
      ? remainingCreationBoostChoices(effectiveBuildState)
      : Math.max(
          0,
          effectiveBuildState.allowedBoosts[step.level as (typeof BOOST_LEVELS)[number]] -
            effectiveBuildState.levelBoosts[step.level as (typeof BOOST_LEVELS)[number]].length
        );

  return remaining === 0 ? "Ready to apply" : `${remaining} choice${remaining === 1 ? "" : "s"} remaining`;
}

export function modeLabel(kind: StepKind): string {
  switch (kind) {
    case "pick-item":
      return "Selection";
    case "skill-increase":
      return "Skill";
    case "skill-training":
      return "Training";
    case "class-branch":
      return "Class Path";
    case "class-choice":
      return "Class Choice";
    case "boost":
      return "Boosts";
    default:
      return "Manual";
  }
}
