import type { EffectiveBuildState } from "../build-state.js";
import { slugifyName } from "../shared/slug.js";
import type {
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  DraftState,
  PendingStep,
  SelectionRef,
} from "../types.js";
import {
  classArchetypeProfilesForSelector,
  classArchetypeSlotId,
  isBattleCreedSelected,
  STANDARD_CLASS_PATH,
} from "./class-archetype/registry.js";
import {
  buildClassBranchStepsFromRules,
  buildClassChoiceStepsFromFeatureSources,
  buildClassChoiceStepsFromRules,
  buildClassGrantedItemStepsFromRules,
  buildClassTrainingStepsFromRules,
  type ClassFeatureSelectionSource,
} from "./class-choice/step-builders.js";
import { remainingCreationBoostChoices } from "./domain/boost-rules.js";
import {
  createPickItemStep,
  createSkillTrainingStep,
  type PickItemSlotKind,
  type StepFilters,
} from "./domain/step-types.js";
import { matchesChoicePredicateList } from "./rule-data.js";
import { discoverSourceSkillTrainingMeta, type SkillTrainingSourceContext } from "./skill-training/source-discovery.js";

interface BuildClassTrainingStepsParams {
  draftClassSelection: SelectionRef | null;
  includeBaseClassTraining?: boolean;
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
  fulfilledStepIds?: readonly string[];
  reservedStepIds?: readonly string[];
}

interface BuildClassSkillFeatStepsParams {
  effectiveClassDocument: unknown | null;
  targetLevel: number;
  fulfilledCount: number;
  fulfilledStepIds?: readonly string[];
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
  additionalClassFeatures?: ClassFeatureSelectionSource[];
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
    includeBaseClassTraining = true,
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
    includeBaseClassTraining &&
    (!effectiveBuildState.ancestry ||
      !effectiveBuildState.background ||
      !effectiveBuildState.class ||
      remainingCreationBoostChoices(effectiveBuildState) > 0)
  ) {
    return [];
  }

  const effectiveClassDocument = await fetchSelectionDocument(draftClassSelection);
  const sourceTraining = discoverSourceSkillTrainingMeta({
    sources: sourceSelections,
    localize,
  });
  if (!includeBaseClassTraining) {
    const sourceSelection = sourceSelections.find((source) => source.sourceSelection)?.sourceSelection ?? null;
    const hasSourceTraining =
      sourceTraining.fixedSkills.length > 0 ||
      sourceTraining.fixedLores.length > 0 ||
      sourceTraining.choiceRules.length > 0 ||
      sourceTraining.loreChoices.length > 0;
    if (!sourceSelection || !hasSourceTraining) {
      return [];
    }

    const sourceSlug = sourceSelection.slug ?? slugifyName(sourceSelection.name) ?? sourceSelection.documentId;
    const level = Math.max(1, sourceSelection.level ?? 1);
    return [
      createSkillTrainingStep(
        level,
        `${sourceSelection.name} skill training`,
        `Choose the skill training granted by ${sourceSelection.name}.`,
        {
          classSlug: extractSlug(effectiveClassDocument) ?? "class",
          className: sourceSelection.name,
          ...sourceTraining,
          additionalCount: 0,
        },
        {
          slotId: `skill-training-${sourceSlug}-level-${level}`,
        }
      ),
    ];
  }

  const steps = buildClassTrainingStepsFromRules({
    effectiveClassDocument,
    classSelection: draftClassSelection,
    extractSlug,
    localize,
    intelligenceModifier: effectiveBuildState.projectedAbilities.int.modifier,
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
    reservedStepIds: params.reservedStepIds,
  });
}

export async function buildClassSkillFeatSteps(params: BuildClassSkillFeatStepsParams): Promise<PendingStep[]> {
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

export async function buildClassBranchSteps(params: BuildClassBranchStepsParams): Promise<PendingStep[]> {
  const steps = await buildClassBranchStepsFromRules(params);
  const classChoiceSteps = await buildClassChoiceStepsFromRules({
    ...params,
    effectiveDeityDocument: null,
    localize: (value) => value,
  });
  const rollOptions = buildDraftClassBranchRollOptions(params.draft, steps, classChoiceSteps);
  return steps.filter((step) => {
    const existingSelection = params.readExistingBranchSelection(step.branch);
    if (
      classArchetypeProfilesForSelector(step.branch).length > 0 &&
      !params.draft.branchSelections[step.slotId] &&
      !existingSelection &&
      params.draft.classArchetypeChoices[classArchetypeSlotId(step.branch)] !== STANDARD_CLASS_PATH
    ) {
      return false;
    }

    return (
      branchPredicateMatches(step.branch, rollOptions) &&
      !shouldSkipExistingStep(params.draft.branchSelections[step.slotId], existingSelection)
    );
  });
}

function branchPredicateMatches(branch: ClassBranchMeta, rollOptions: Set<string>): boolean {
  if (!Array.isArray(branch.predicate) || branch.predicate.length === 0) {
    return true;
  }

  return matchesChoicePredicateList(branch.predicate, (statement) => rollOptions.has(statement.toLowerCase()));
}

function buildDraftClassBranchRollOptions(
  draft: DraftState,
  branchSteps: PendingStep[],
  classChoiceSteps: PendingStep[]
): Set<string> {
  const rollOptions = new Set<string>();
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

function possibleClassChoiceRollOptionKeys(slotId: string): string[] {
  const match = /^class-choice-(.+)-level-\d+$/.exec(slotId);
  if (!match?.[1]) {
    return [];
  }

  const parts = match[1].split("-");
  return parts.map((_, index) => parts.slice(index).join("-")).filter(Boolean);
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
  const classSlug = params.effectiveClassDocument ? params.extractSlug(params.effectiveClassDocument) : null;
  const steps = [
    ...(await buildClassChoiceStepsFromRules({
      ...params,
      selectedValuesBySlotId: params.draft.classChoices,
    })),
    ...buildClassChoiceStepsFromFeatureSources({
      classFeatures: params.additionalClassFeatures ?? [],
      classSlug,
      effectiveDeityDocument: params.effectiveDeityDocument,
      extractSlug: params.extractSlug,
      localize: params.localize,
      selectedValuesBySlotId: params.draft.classChoices,
    }),
  ];
  return dedupeStepsBySlotId(steps).filter(
    (step) =>
      !(
        isBattleCreedSelected(params.draft) &&
        step.kind === "class-choice" &&
        step.classChoice.flag === "divineFont"
      ) &&
      !shouldSkipExistingStep(
        params.draft.classChoices[step.slotId],
        params.readExistingClassChoiceSelection(step.classChoice)
      )
  );
}

function dedupeStepsBySlotId<T extends PendingStep>(steps: T[]): T[] {
  const bySlotId = new Map<string, T>();
  for (const step of steps) {
    bySlotId.set(step.slotId, step);
  }
  return Array.from(bySlotId.values());
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
  fulfilledStepIds?: readonly string[];
  reservedStepIds?: readonly string[];
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
  const reservedSlotIds = fulfilledStepIdsForKind(args.reservedStepIds ?? [], slotKind);
  const availableMilestones = milestones.filter((level) => !reservedSlotIds.has(`${slotKind}-level-${level}`));
  const fulfilledSlotIds = fulfilledStepIdsForKind(args.fulfilledStepIds ?? [], slotKind);
  const effectiveMilestones =
    fulfilledSlotIds.size > 0
      ? availableMilestones.filter((level) => !fulfilledSlotIds.has(`${slotKind}-level-${level}`))
      : availableMilestones.slice(Math.min(Math.max(0, fulfilledCount), availableMilestones.length));

  return effectiveMilestones.map((level) =>
    createPickItemStep(slotKind, level, args.title(level), args.description, args.filters(level))
  );
}

function fulfilledStepIdsForKind(fulfilledStepIds: readonly string[], slotKind: string): Set<string> {
  const prefix = `${slotKind}-level-`;
  return new Set(fulfilledStepIds.filter((slotId) => slotId.startsWith(prefix)));
}
