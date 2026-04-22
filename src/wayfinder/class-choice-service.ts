import type { EffectiveBuildState } from "../build-state.js";
import type {
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  DraftState,
  PendingStep,
  SelectionRef,
} from "../types.js";
import {
  buildClassBranchStepsFromRules,
  buildClassChoiceStepsFromRules,
  buildClassGrantedItemStepsFromRules,
  buildClassTrainingStepsFromRules,
} from "./class-choice/step-builders.js";
import { remainingCreationBoostChoices } from "./domain/boost-rules.js";
import { createPickItemStep } from "./domain/step-types.js";

interface BuildClassTrainingStepsParams {
  draftClassSelection: SelectionRef | null;
  targetLevel: number;
  effectiveBuildState: EffectiveBuildState;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}

interface BuildClassFeatStepsParams {
  effectiveClassDocument: unknown | null;
  targetLevel: number;
  fulfilledCount: number;
}

interface BuildClassBranchStepsParams {
  draft: DraftState;
  effectiveClassDocument: unknown | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
  readExistingBranchSelection: (branch: ClassBranchMeta) => string | null;
}

interface BuildClassGrantedItemStepsParams {
  draft: DraftState;
  effectiveClassDocument: unknown | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
  readExistingGrantedSelection: (grant: ClassGrantMeta) => string | null;
}

interface BuildClassChoiceStepsParams {
  draft: DraftState;
  effectiveClassDocument: unknown | null;
  effectiveDeityDocument: unknown | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
  readExistingClassChoiceSelection: (choice: ClassChoiceMeta) => string | null;
}

interface ClassDocumentLike {
  system?: {
    classFeatLevels?: {
      value?: unknown;
    };
  };
}

export async function buildClassTrainingSteps(params: BuildClassTrainingStepsParams): Promise<PendingStep[]> {
  const { draftClassSelection, targetLevel, effectiveBuildState, fetchSelectionDocument, extractSlug, localize } =
    params;
  if (!draftClassSelection || targetLevel < 1) {
    return [];
  }

  if (
    !effectiveBuildState.ancestry ||
    !effectiveBuildState.background ||
    !effectiveBuildState.class ||
    remainingCreationBoostChoices(effectiveBuildState) > 0
  ) {
    return [];
  }

  const effectiveClassDocument = await fetchSelectionDocument(draftClassSelection);
  return buildClassTrainingStepsFromRules({
    effectiveClassDocument,
    extractSlug,
    localize,
    intelligenceModifier: effectiveBuildState.projectedAbilities.int.modifier,
  });
}

export async function buildClassFeatSteps(params: BuildClassFeatStepsParams): Promise<PendingStep[]> {
  const { effectiveClassDocument, targetLevel, fulfilledCount } = params;
  if (!effectiveClassDocument) {
    return [];
  }

  const classFeatLevelValues = (effectiveClassDocument as ClassDocumentLike).system?.classFeatLevels?.value;
  const classFeatLevels = Array.isArray(classFeatLevelValues)
    ? classFeatLevelValues
        .map((value) => Number(value))
        .filter((value): value is number => Number.isFinite(value) && value >= 1 && value <= targetLevel)
        .map((value) => Math.floor(value))
    : [];

  if (classFeatLevels.length === 0) {
    return [];
  }

  const milestones = Array.from(new Set(classFeatLevels)).sort((left, right) => left - right);
  const startIndex = Math.min(Math.max(0, fulfilledCount), milestones.length);

  return milestones.slice(startIndex).map((level) =>
    createPickItemStep(
      "class-feat",
      level,
      `Level ${level} class feat`,
      "Pick a class or archetype feat unlocked at this milestone.",
      {
        itemType: "feat",
        featTypes: ["class", "archetype"],
        maxLevel: level,
      }
    )
  );
}

export async function buildClassBranchSteps(params: BuildClassBranchStepsParams): Promise<PendingStep[]> {
  const steps = await buildClassBranchStepsFromRules(params);
  return steps.filter(
    (step) =>
      !shouldSkipExistingStep(
        params.draft.branchSelections[step.slotId],
        params.readExistingBranchSelection(step.branch)
      )
  );
}

export async function buildClassGrantedItemSteps(params: BuildClassGrantedItemStepsParams): Promise<PendingStep[]> {
  const steps = await buildClassGrantedItemStepsFromRules(params);
  return steps.filter(
    (step) =>
      !step.grantSelection ||
      !shouldSkipExistingStep(
        params.draft.selections[step.slotId],
        params.readExistingGrantedSelection(step.grantSelection)
      )
  );
}

export async function buildClassChoiceSteps(params: BuildClassChoiceStepsParams): Promise<PendingStep[]> {
  const steps = await buildClassChoiceStepsFromRules(params);
  return steps.filter(
    (step) =>
      !shouldSkipExistingStep(
        params.draft.classChoices[step.slotId],
        params.readExistingClassChoiceSelection(step.classChoice)
      )
  );
}

function shouldSkipExistingStep(
  draftSelection: SelectionRef | string | undefined,
  actorSelection: string | null
): boolean {
  return !!actorSelection && !draftSelection;
}
