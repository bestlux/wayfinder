import type { EffectiveBuildState } from "../../build-state.js";
import { SKILL_LABELS } from "../../constants.js";
import type { DraftState, PendingStep, SkillTrainingStep, StepKind } from "../../types.js";
import { formatSlug } from "../formatting.js";
import {
  isAncestryBoostSectionComplete,
  isBackgroundBoostSectionComplete,
  isClassBoostSectionComplete,
  remainingCreationBoostChoices,
} from "./boost-rules.js";
import type { SkillProgression } from "./skill-progression.js";
import { getStepModeLabel } from "./step-types.js";

export type WayfinderStepReadinessState = "complete" | "incomplete" | "excess" | "invalid";

export type WayfinderStepIssueCode =
  | "missing-choice"
  | "too-many-choices"
  | "manual-review"
  | "dependency-review"
  | "access-attestation"
  | "selection-ineligible"
  | "skill-progression"
  | "equipment-review";

export interface WayfinderStepIssue {
  code: WayfinderStepIssueCode;
  stepId: string;
  slotId: string;
  lineId?: string;
  focusId?: string;
  title: string;
  message: string;
}

export type WayfinderStepEvaluation =
  | {
      state: "complete";
      complete: true;
      status: string;
      issue: null;
    }
  | {
      state: Exclude<WayfinderStepReadinessState, "complete">;
      complete: false;
      status: string;
      issue: WayfinderStepIssue;
    };

export interface WayfinderDraftReadiness {
  ready: boolean;
  evaluations: WayfinderStepEvaluation[];
  blockers: WayfinderStepIssue[];
  firstBlocker: WayfinderStepIssue | null;
}

export class WayfinderDraftNotReadyError extends Error {
  readonly blockers: WayfinderStepIssue[];

  constructor(blockers: WayfinderStepIssue[]) {
    const firstBlocker = blockers[0];
    super(firstBlocker?.message ?? "This draft is not ready to apply yet.");
    this.name = "WayfinderDraftNotReadyError";
    this.blockers = blockers;
  }
}

export async function evaluateWayfinderDraftReadiness(
  steps: PendingStep[],
  evaluateStep: (step: PendingStep) => Promise<WayfinderStepEvaluation>
): Promise<WayfinderDraftReadiness> {
  const evaluations = await Promise.all(steps.map((step) => evaluateStep(step)));
  const blockers = evaluations.flatMap(({ issue }) => (issue ? [issue] : []));
  return {
    ready: steps.length > 0 && evaluations.every((evaluation) => evaluation.complete),
    evaluations,
    blockers,
    firstBlocker: blockers[0] ?? null,
  };
}

export async function assertDraftBackedStepsReady(
  steps: PendingStep[],
  draft: DraftState,
  skillProgression?: SkillProgression
): Promise<void> {
  const evaluations = await Promise.all(
    steps.flatMap((step) =>
      step.kind === "boost"
        ? []
        : [evaluateWayfinderStep(step, draft, new Set(), {} as EffectiveBuildState, skillProgression)]
    )
  );
  const blockers = evaluations.flatMap(({ issue }) => (issue ? [issue] : []));
  if (blockers.length > 0) {
    throw new WayfinderDraftNotReadyError(blockers);
  }
}

export async function evaluateWayfinderStep(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: ReadonlySet<string>,
  effectiveBuildState: EffectiveBuildState,
  skillProgression?: SkillProgression
): Promise<WayfinderStepEvaluation> {
  const skillStep = skillProgression?.stepsBySlotId[step.slotId];
  if (skillStep && skillStep.issues.length > 0) {
    return {
      state: "invalid",
      complete: false,
      status: "Needs attention",
      issue: {
        code: "skill-progression",
        stepId: step.id,
        slotId: step.slotId,
        title: step.title,
        message: `${step.title}: a skill choice no longer matches the active progression; review it before applying.`,
      },
    };
  }
  const complete = await isWayfinderStepComplete(step, draft, effectiveBuildState, skillProgression);
  const status = await getWayfinderStepStatus(
    step,
    draft,
    recentlyInvalidatedStepIds,
    effectiveBuildState,
    skillProgression
  );
  if (complete) {
    return { state: "complete", complete: true, status, issue: null };
  }

  const issue = buildStepIssue(step, draft, recentlyInvalidatedStepIds, status);
  const equipmentInvalid =
    step.kind === "starting-equipment" &&
    (draft.acquisitionCorrupt ||
      (draft.acquisition?.disposition.kind === "unreviewed" && draft.acquisition.disposition.invalidatedFrom !== null));
  return {
    state:
      issue.code === "too-many-choices"
        ? "excess"
        : equipmentInvalid || recentlyInvalidatedStepIds.has(step.slotId)
          ? "invalid"
          : "incomplete",
    complete: false,
    status,
    issue,
  };
}

export async function isWayfinderStepComplete(
  step: PendingStep,
  draft: DraftState,
  effectiveBuildState: EffectiveBuildState,
  skillProgression?: SkillProgression
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

  if (step.kind === "class-archetype") {
    return typeof draft.classArchetypeChoices[step.slotId] === "string";
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
    return (draft.spellChoices[step.slotId]?.length ?? 0) === step.spellChoice.count;
  }

  if (step.kind === "skill-training") {
    return (
      skillProgression?.stepsBySlotId[step.slotId]?.progress.complete ?? isTrainingStepCompleteFromDraft(step, draft)
    );
  }

  if (step.kind === "skill-increase") {
    return (
      skillProgression?.stepsBySlotId[step.slotId]?.progress.complete ??
      (typeof draft.skillIncreases[step.slotId] === "string" && draft.skillIncreases[step.slotId].length > 0)
    );
  }

  if (step.kind === "starting-equipment") {
    const acquisition = draft.acquisition;
    if (draft.acquisitionCorrupt || !acquisition) return false;
    if (acquisition.disposition.kind === "handoff") {
      return !!acquisition.disposition.acknowledgedByUserId && !!acquisition.disposition.acknowledgedAt;
    }
    return acquisition.disposition.kind === "purchase-ledger" || acquisition.disposition.kind === "retain-all";
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

  return (
    step.kind === "boost" && effectiveBuildState.levelBoosts[step.boost.batchLevel].length >= step.boost.requiredCount
  );
}

export async function getWayfinderStepStatus(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: ReadonlySet<string>,
  effectiveBuildState: EffectiveBuildState,
  skillProgression?: SkillProgression
): Promise<string> {
  if (step.kind === "manual") {
    return draft.manual[step.slotId] === true ? "Ready to apply" : "Not done yet";
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

  if (step.kind === "class-archetype") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.classArchetypeChoices[step.slotId]) {
      return "Needs attention";
    }
    const selected = draft.classArchetypeChoices[step.slotId];
    return step.classArchetype.options.find((option) => option.value === selected)?.label ?? "Choose one";
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

    if (selectedCount > total) {
      const excess = selectedCount - total;
      return `${selectedCount}/${total} chosen · remove ${excess}`;
    }
    return selectedCount === total && total > 0 ? "Ready to apply" : `${selectedCount}/${total} chosen`;
  }

  if (step.kind === "spell-choice") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && (draft.spellChoices[step.slotId]?.length ?? 0) === 0) {
      return "Needs attention";
    }

    const selectedCount = draft.spellChoices[step.slotId]?.length ?? 0;
    const total = step.spellChoice.count;
    if (selectedCount > total) {
      const excess = selectedCount - total;
      return `${selectedCount}/${total} chosen · remove ${excess}`;
    }
    return selectedCount === total && total > 0 ? "Ready to apply" : `${selectedCount}/${total} chosen`;
  }

  if (step.kind === "skill-training") {
    const compiledProgress = skillProgression?.stepsBySlotId[step.slotId]?.progress;
    if (
      recentlyInvalidatedStepIds.has(step.slotId) &&
      !(compiledProgress?.complete ?? isTrainingStepCompleteFromDraft(step, draft))
    ) {
      return "Needs attention";
    }

    const progress = compiledProgress ?? getSkillTrainingProgress(step, draft);
    if (progress.excessCount > 0) {
      return `${progress.selectedCount}/${progress.requiredCount} chosen · remove ${progress.excessCount}`;
    }
    return progress.complete && progress.requiredCount > 0
      ? "Ready to apply"
      : `${progress.selectedCount}/${progress.requiredCount} chosen`;
  }

  if (step.kind === "skill-increase") {
    if (recentlyInvalidatedStepIds.has(step.slotId) && !draft.skillIncreases[step.slotId]) {
      return "Needs attention";
    }

    const slug = draft.skillIncreases[step.slotId];
    return slug ? `${SKILL_LABELS[slug] ?? formatSlug(slug)} selected` : "Choose one";
  }

  if (step.kind === "starting-equipment") {
    if (draft.acquisitionCorrupt) return "Draft is damaged";
    const acquisition = draft.acquisition;
    if (!acquisition) return "Not started";
    switch (acquisition.disposition.kind) {
      case "purchase-ledger":
        return "Kit confirmed";
      case "retain-all":
        return "Keeping all your coin";
      case "handoff":
        return acquisition.disposition.acknowledgedByUserId && acquisition.disposition.acknowledgedAt
          ? "Handled on your sheet"
          : "Needs your OK";
      case "unreviewed":
        return acquisition.disposition.invalidatedFrom ? "Something changed, check it" : "Choose your gear";
    }
  }

  if (
    recentlyInvalidatedStepIds.has(step.slotId) &&
    !(await isWayfinderStepComplete(step, draft, effectiveBuildState, skillProgression))
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
      : step.kind === "boost"
        ? Math.max(0, step.boost.requiredCount - effectiveBuildState.levelBoosts[step.boost.batchLevel].length)
        : 0;

  return remaining === 0 ? "Ready to apply" : `${remaining} choice${remaining === 1 ? "" : "s"} remaining`;
}

export function modeLabel(kind: StepKind): string {
  return getStepModeLabel(kind);
}

function buildStepIssue(
  step: PendingStep,
  draft: DraftState,
  recentlyInvalidatedStepIds: ReadonlySet<string>,
  status: string
): WayfinderStepIssue {
  const exactChoiceProgress = getExactChoiceProgress(step, draft);
  if (exactChoiceProgress) {
    const { choiceNoun, missingNoun, remainingCount } = exactChoiceProgress;
    if (exactChoiceProgress.excessCount > 0) {
      const excess = exactChoiceProgress.excessCount;
      return {
        code: "too-many-choices",
        stepId: step.id,
        slotId: step.slotId,
        title: step.title,
        message: `${step.title}: remove ${excess} extra ${choiceNoun}${excess === 1 ? "" : "s"}.`,
      };
    }

    return {
      code: "missing-choice",
      stepId: step.id,
      slotId: step.slotId,
      title: step.title,
      message: `${step.title}: choose ${remainingCount} more ${missingNoun}${remainingCount === 1 ? "" : "s"}.`,
    };
  }

  if (step.kind === "manual") {
    return {
      code: "manual-review",
      stepId: step.id,
      slotId: step.slotId,
      title: step.title,
      message: `${step.title}: mark it done once you have handled it on the sheet.`,
    };
  }

  if (step.kind === "starting-equipment") {
    const acquisition = draft.acquisition;
    const lineId =
      acquisition?.disposition.kind === "unreviewed" &&
      acquisition.disposition.invalidatedFrom !== null &&
      acquisition.lines.length === 1 &&
      acquisition.disposition.reasons.some((reason) => ["document", "price", "quantity"].includes(reason))
        ? acquisition.lines[0]?.lineId
        : undefined;
    const focusId =
      draft.acquisitionCorrupt || !acquisition
        ? "starting-equipment-initialize"
        : acquisition.disposition.kind === "handoff"
          ? "starting-equipment-handoff"
          : lineId
            ? `starting-equipment-line:${lineId}`
            : "starting-equipment-review";
    return {
      code: "equipment-review",
      stepId: step.id,
      slotId: step.slotId,
      ...(lineId ? { lineId } : {}),
      focusId,
      title: step.title,
      message: `${step.title}: ${lowercaseInitial(status)}.`,
    };
  }

  if (recentlyInvalidatedStepIds.has(step.slotId)) {
    return {
      code: "dependency-review",
      stepId: step.id,
      slotId: step.slotId,
      title: step.title,
      message: `${step.title}: an earlier choice changed, so give this another look.`,
    };
  }

  return {
    code: "missing-choice",
    stepId: step.id,
    slotId: step.slotId,
    title: step.title,
    message: `${step.title}: ${lowercaseInitial(status)}.`,
  };
}

function getExactChoiceProgress(
  step: PendingStep,
  draft: DraftState
): {
  choiceNoun: "language choice" | "spell choice" | "training choice";
  missingNoun: "language" | "spell" | "training choice";
  selectedCount: number;
  requiredCount: number;
  remainingCount: number;
  excessCount: number;
} | null {
  if (step.kind === "language-choice") {
    const selectedCount = draft.languageChoices[step.slotId]?.length ?? 0;
    const requiredCount = step.languageChoice.count;
    return {
      choiceNoun: "language choice",
      missingNoun: "language",
      selectedCount,
      requiredCount,
      remainingCount: Math.max(0, requiredCount - selectedCount),
      excessCount: Math.max(0, selectedCount - requiredCount),
    };
  }
  if (step.kind === "spell-choice") {
    const selectedCount = draft.spellChoices[step.slotId]?.length ?? 0;
    const requiredCount = step.spellChoice.count;
    return {
      choiceNoun: "spell choice",
      missingNoun: "spell",
      selectedCount,
      requiredCount,
      remainingCount: Math.max(0, requiredCount - selectedCount),
      excessCount: Math.max(0, selectedCount - requiredCount),
    };
  }
  if (step.kind === "skill-training") {
    return {
      choiceNoun: "training choice",
      missingNoun: "training choice",
      ...getSkillTrainingProgress(step, draft),
    };
  }
  return null;
}

function getSkillTrainingProgress(
  step: SkillTrainingStep,
  draft: DraftState
): {
  selectedCount: number;
  requiredCount: number;
  remainingCount: number;
  excessCount: number;
  complete: boolean;
} {
  const training = draft.skillTrainings[step.slotId];
  const selectedRuleCount = step.training.choiceRules.filter((rule) => {
    const selection = training?.ruleChoices[rule.key];
    return typeof selection === "string" && selection.length > 0;
  }).length;
  const selectedLoreCount = step.training.loreChoices.filter((choice) => {
    const selection = training?.loreChoices[choice.key];
    return typeof selection === "string" && selection.trim().length > 0;
  }).length;
  const additionalCount = training?.additional.length ?? 0;
  const requiredCount =
    step.training.choiceRules.length + step.training.additionalCount + step.training.loreChoices.length;
  const selectedCount = selectedRuleCount + additionalCount + selectedLoreCount;
  const remainingCount =
    step.training.choiceRules.length -
    selectedRuleCount +
    Math.max(0, step.training.additionalCount - additionalCount) +
    (step.training.loreChoices.length - selectedLoreCount);
  const excessCount = Math.max(0, additionalCount - step.training.additionalCount);
  return {
    selectedCount,
    requiredCount,
    remainingCount,
    excessCount,
    complete: remainingCount === 0 && excessCount === 0,
  };
}

export function isTrainingStepCompleteFromDraft(step: SkillTrainingStep, draft: DraftState): boolean {
  return getSkillTrainingProgress(step, draft).complete;
}

function lowercaseInitial(value: string): string {
  return value.length > 0 ? `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}` : "finish this step";
}
