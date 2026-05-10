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
import { createPickItemStep, type PickItemSlotKind, type StepFilters } from "./domain/step-types.js";
import { discoverSourceSkillTrainingMeta, type SkillTrainingSourceContext } from "./skill-training/source-discovery.js";

interface BuildClassTrainingStepsParams {
  draftClassSelection: SelectionRef | null;
  sourceSelections?: SkillTrainingSourceContext[];
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

interface BuildClassSkillFeatStepsParams {
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
    skillFeatLevels?: {
      value?: unknown;
    };
  };
}

export async function buildClassTrainingSteps(params: BuildClassTrainingStepsParams): Promise<PendingStep[]> {
  const {
    draftClassSelection,
    sourceSelections = [],
    targetLevel,
    effectiveBuildState,
    fetchSelectionDocument,
    extractSlug,
    localize,
  } = params;
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

export async function buildClassFeatSteps(params: BuildClassFeatStepsParams): Promise<PendingStep[]> {
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

export async function buildClassSkillFeatSteps(params: BuildClassSkillFeatStepsParams): Promise<PendingStep[]> {
  const initialSteps = await buildFeatStepsFromClassLevels({
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

  return initialSteps.filter((step) => step.level === 1);
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

function buildFeatStepsFromClassLevels(args: {
  effectiveClassDocument: unknown | null;
  levelField: "classFeatLevels" | "skillFeatLevels";
  slotKind: PickItemSlotKind;
  targetLevel: number;
  fulfilledCount: number;
  title: (level: number) => string;
  description: string;
  filters: (level: number) => StepFilters;
}): PendingStep[] {
  const { effectiveClassDocument, levelField, slotKind, targetLevel, fulfilledCount } = args;
  if (!effectiveClassDocument) {
    return [];
  }

  const rawLevels = (effectiveClassDocument as ClassDocumentLike).system?.[levelField]?.value;
  const levels = Array.isArray(rawLevels)
    ? rawLevels
        .map((value) => Number(value))
        .filter((value): value is number => Number.isFinite(value) && value >= 1 && value <= targetLevel)
        .map((value) => Math.floor(value))
    : [];

  if (levels.length === 0) {
    return [];
  }

  const milestones = Array.from(new Set(levels)).sort((left, right) => left - right);
  const startIndex = Math.min(Math.max(0, fulfilledCount), milestones.length);

  return milestones
    .slice(startIndex)
    .map((level) => createPickItemStep(slotKind, level, args.title(level), args.description, args.filters(level)));
}
