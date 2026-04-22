import type { EffectiveBuildState } from "../../build-state.js";
import { SKILL_LABELS } from "../../constants.js";
import type { BoostLevel, DraftState, PendingStep, SkillTrainingStep, StepKind } from "../../types.js";
import { formatSlug } from "../formatting.js";
import {
  isAncestryBoostSectionComplete,
  isBackgroundBoostSectionComplete,
  isClassBoostSectionComplete,
  remainingCreationBoostChoices,
} from "./boost-rules.js";
import { getStepModeLabel } from "./step-types.js";

export interface StepEvaluationDependencies {
  isTrainingStepComplete: (step: SkillTrainingStep) => boolean;
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

  if (step.kind === "singleton-choice") {
    return typeof draft.singletonChoices[step.slotId] === "string" && draft.singletonChoices[step.slotId].length > 0;
  }

  if (step.kind === "language-choice") {
    return (draft.languageChoices[step.slotId]?.length ?? 0) === step.languageChoice.count;
  }

  if (step.kind === "spell-choice") {
    return (draft.spellChoices[step.slotId]?.length ?? 0) >= step.spellChoice.count;
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

  const level = step.level as BoostLevel;
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
    const selectedOption = step.classChoice.options.find((option) => option.value === selected);
    return selectedOption?.label ?? "Choose one";
  }

  if (step.kind === "singleton-choice") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.singletonChoices[step.slotId]) {
      return "Needs attention";
    }

    const selected = draft.singletonChoices[step.slotId];
    const selectedOption = step.singletonChoice.options.find((option) => option.value === selected);
    return selectedOption?.label ?? "Choose one";
  }

  if (step.kind === "language-choice") {
    const selectedCount = draft.languageChoices[step.slotId]?.length ?? 0;
    const total = step.languageChoice.count;
    if (recentlyInvalidatedStepIds.has(step.slotId) && selectedCount !== total) {
      return "Needs attention";
    }

    return selectedCount === total && total > 0 ? "Ready to apply" : `${selectedCount}/${total} chosen`;
  }

  if (step.kind === "spell-choice") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && (draft.spellChoices[step.slotId]?.length ?? 0) === 0) {
      return "Needs attention";
    }

    const selectedCount = draft.spellChoices[step.slotId]?.length ?? 0;
    const total = step.spellChoice.count;
    return selectedCount >= total && total > 0 ? "Ready to apply" : `${selectedCount}/${total} chosen`;
  }

  if (step.kind === "skill-training") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !deps.isTrainingStepComplete(step)) {
      return "Needs attention";
    }

    const training = draft.skillTrainings[step.slotId];
    const selectedCount = training
      ? Object.values(training.ruleChoices).filter(Boolean).length +
        training.additional.length +
        Object.values(training.loreChoices).filter((value) => typeof value === "string" && value.trim().length > 0)
          .length
      : 0;
    const total = step.training.choiceRules.length + step.training.additionalCount + step.training.loreChoices.length;
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
          effectiveBuildState.allowedBoosts[step.level as BoostLevel] -
            effectiveBuildState.levelBoosts[step.level as BoostLevel].length
        );

  return remaining === 0 ? "Ready to apply" : `${remaining} choice${remaining === 1 ? "" : "s"} remaining`;
}

export function modeLabel(kind: StepKind): string {
  return getStepModeLabel(kind);
}
