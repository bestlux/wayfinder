export type SlotKind =
  | "ancestry"
  | "heritage"
  | "background"
  | "class"
  | "deity"
  | "grant-choice"
  | "singleton-choice"
  | "language-choice"
  | "skill-training"
  | "class-branch"
  | "class-choice"
  | "spell-choice"
  | "ancestry-feat"
  | "class-feat"
  | "skill-feat"
  | "general-feat"
  | "ability-boosts"
  | "skill-increase";

export type StepKind =
  | "pick-item"
  | "manual"
  | "boost"
  | "skill-increase"
  | "singleton-choice"
  | "language-choice"
  | "class-branch"
  | "class-choice"
  | "spell-choice"
  | "skill-training";

export type PickItemSlotKind = Exclude<
  SlotKind,
  | "ability-boosts"
  | "class-branch"
  | "class-choice"
  | "language-choice"
  | "skill-increase"
  | "skill-training"
  | "spell-choice"
>;

export type ChoicePredicate =
  | string
  | { or?: ChoicePredicate[]; nor?: ChoicePredicate[]; not?: ChoicePredicate }
  | ChoicePredicate[];

export interface StepFilters {
  itemType: string;
  featTypes?: string[];
  maxLevel?: number;
  predicate?: ChoicePredicate[];
}

export interface ClassBranchMeta {
  slotId: string;
  selectorPackId: string;
  selectorDocumentId: string;
  selectorUuid: string;
  selectorName: string;
  selectorRuleIndex: number;
  flag: string;
  optionTag: string;
  classSlug: string | null;
  dependsOn: "class" | "deity";
}

export type GrantSelectionSourceItemType = "classfeature" | "ancestry" | "heritage" | "background" | "feat";
export type GrantSelectionDependency = "class" | "deity" | null;

export interface GrantSelectionMeta {
  slotId: string;
  sourceItemType: GrantSelectionSourceItemType;
  selectorPackId: string;
  selectorDocumentId: string;
  selectorUuid: string;
  selectorName: string;
  selectorRuleIndex: number;
  grantRuleIndex: number;
  flag: string;
  itemType: string;
  classSlug: string | null;
  dependsOn: GrantSelectionDependency;
  filters: StepFilters;
}

export type ClassGrantMeta = GrantSelectionMeta;

export interface ClassChoiceMeta {
  slotId: string;
  sourcePackId: string;
  sourceDocumentId: string;
  sourceUuid: string;
  sourceName: string;
  sourceRuleIndex: number;
  flag: string;
  classSlug: string | null;
  dependsOn: "class" | "deity";
  options: Array<{
    value: string;
    label: string;
    img: string | null;
    detail: string | null;
  }>;
}

export interface SingletonChoiceMeta {
  slotId: string;
  sourceItemType: "ancestry" | "heritage" | "background" | "class" | "deity" | "feat";
  sourcePackId: string;
  sourceDocumentId: string;
  sourceUuid: string;
  sourceName: string;
  sourceRuleIndex: number;
  flag: string;
  prompt: string | null;
  predicate: ChoicePredicate[];
  rollOption: string | null;
  options: Array<{
    value: string;
    label: string;
    img: string | null;
    detail: string | null;
  }>;
}

export interface LanguageChoiceMeta {
  slotId: string;
  sourceItemType: "ancestry";
  sourceName: string;
  grantedLanguages: string[];
  count: number;
  options: Array<{
    value: string;
    label: string;
  }>;
}

export interface SpellChoiceDestination {
  type: "spellbook" | "prepared";
  key: string;
  label: string;
  entryName: string;
  tradition: string;
  ability: string;
  prepared: "prepared";
}

export interface SpellChoiceMeta {
  slotId: string;
  sourcePackId: string | null;
  sourceDocumentId: string | null;
  sourceUuid: string | null;
  sourceName: string;
  classSlug: string | null;
  dependsOn: "class" | "class-branch";
  destination: SpellChoiceDestination;
  count: number;
  minRank: number;
  maxRank: number;
  cantrip: boolean;
  curriculumSpellNames: string[];
  additionalAllowedSpellNames: string[];
  restrictToCommon: boolean;
}

export interface SkillTrainingPersistenceMeta {
  sourceItemType: "ancestry" | "heritage" | "background" | "class" | "feat";
  sourcePackId: string;
  sourceDocumentId: string;
  sourceUuid: string;
  sourceRuleIndex: number;
}

export interface SkillTrainingChoiceMeta {
  key: string;
  flag: string;
  prompt: string;
  sourceLabel: string;
  options: Array<{ slug: string; label: string }>;
  fallbackPrompt?: string;
  fallbackOptions?: Array<{ slug: string; label: string }>;
  persistence: SkillTrainingPersistenceMeta | null;
}

export interface SkillTrainingLoreChoiceMeta {
  key: string;
  flag: string;
  prompt: string;
  sourceLabel: string;
  placeholder: string;
  suggestions: string[];
  allowCustom: boolean;
  persistence: SkillTrainingPersistenceMeta | null;
}

export interface SkillTrainingMeta {
  classSlug: string;
  className: string;
  fixedSkills: string[];
  fixedLores: string[];
  choiceRules: SkillTrainingChoiceMeta[];
  loreChoices: SkillTrainingLoreChoiceMeta[];
  additionalCount: number;
}

interface BasePendingStep<K extends StepKind, S extends SlotKind> {
  id: string;
  level: number;
  kind: K;
  slotKind: S;
  title: string;
  description: string;
  required: boolean;
  slotId: string;
}

interface NoStepExtras {
  filters?: never;
  branch?: never;
  grantSelection?: never;
  singletonChoice?: never;
  languageChoice?: never;
  classChoice?: never;
  spellChoice?: never;
  training?: never;
}

export interface PickItemStep extends BasePendingStep<"pick-item", PickItemSlotKind> {
  filters: StepFilters;
  branch?: never;
  grantSelection?: GrantSelectionMeta;
  classChoice?: never;
  spellChoice?: never;
  training?: never;
}

export interface ManualStep extends BasePendingStep<"manual", SlotKind>, NoStepExtras {}

export interface BoostStep extends BasePendingStep<"boost", "ability-boosts">, NoStepExtras {}

export interface SkillIncreaseStep extends BasePendingStep<"skill-increase", "skill-increase">, NoStepExtras {}

export interface SkillTrainingStep extends BasePendingStep<"skill-training", "skill-training"> {
  filters?: never;
  branch?: never;
  grantSelection?: never;
  classChoice?: never;
  spellChoice?: never;
  training: SkillTrainingMeta;
}

export interface SingletonChoiceStep extends BasePendingStep<"singleton-choice", "singleton-choice"> {
  filters?: never;
  branch?: never;
  grantSelection?: never;
  singletonChoice: SingletonChoiceMeta;
  classChoice?: never;
  spellChoice?: never;
  training?: never;
}

export interface LanguageChoiceStep extends BasePendingStep<"language-choice", "language-choice"> {
  filters?: never;
  branch?: never;
  grantSelection?: never;
  singletonChoice?: never;
  languageChoice: LanguageChoiceMeta;
  classChoice?: never;
  spellChoice?: never;
  training?: never;
}

export interface ClassBranchStep extends BasePendingStep<"class-branch", "class-branch"> {
  filters: StepFilters;
  branch: ClassBranchMeta;
  grantSelection?: never;
  classChoice?: never;
  spellChoice?: never;
  training?: never;
}

export interface ClassChoiceStep extends BasePendingStep<"class-choice", "class-choice"> {
  filters?: never;
  branch?: never;
  grantSelection?: never;
  classChoice: ClassChoiceMeta;
  spellChoice?: never;
  training?: never;
}

export interface SpellChoiceStep extends BasePendingStep<"spell-choice", "spell-choice"> {
  filters: StepFilters;
  branch?: never;
  grantSelection?: never;
  classChoice?: never;
  spellChoice: SpellChoiceMeta;
  training?: never;
}

export type PendingStep =
  | PickItemStep
  | ManualStep
  | BoostStep
  | SkillIncreaseStep
  | SkillTrainingStep
  | SingletonChoiceStep
  | LanguageChoiceStep
  | ClassBranchStep
  | ClassChoiceStep
  | SpellChoiceStep;

export type SelectionStep = PickItemStep | ClassBranchStep;

interface StepOptions {
  required?: boolean;
  slotId?: string;
}

interface PickItemStepOptions extends StepOptions {
  grantSelection?: GrantSelectionMeta;
}

interface ClassBranchStepOptions extends StepOptions {
  title?: string;
  description?: string;
  filters?: StepFilters;
}

interface ClassChoiceStepOptions extends StepOptions {
  title?: string;
  description?: string;
}

interface SingletonChoiceStepOptions extends StepOptions {
  title?: string;
  description?: string;
}

interface LanguageChoiceStepOptions extends StepOptions {
  title?: string;
  description?: string;
}

interface SpellChoiceStepOptions extends StepOptions {
  filters?: StepFilters;
}

function createBaseStep<K extends StepKind, S extends SlotKind>(
  kind: K,
  slotKind: S,
  level: number,
  title: string,
  description: string,
  options: StepOptions = {}
): BasePendingStep<K, S> {
  const slotId = options.slotId ?? `${slotKind}-level-${level}`;
  return {
    id: slotId,
    level,
    kind,
    slotKind,
    title,
    description,
    required: options.required ?? true,
    slotId,
  };
}

export function createPickItemStep(
  slotKind: PickItemSlotKind,
  level: number,
  title: string,
  description: string,
  filters: StepFilters,
  options: PickItemStepOptions = {}
): PickItemStep {
  return {
    ...createBaseStep("pick-item", slotKind, level, title, description, options),
    filters,
    ...(options.grantSelection ? { grantSelection: options.grantSelection } : {}),
  };
}

export function createManualStep(
  slotKind: SlotKind,
  level: number,
  title: string,
  description: string,
  options: StepOptions = {}
): ManualStep {
  return createBaseStep("manual", slotKind, level, title, description, options);
}

export function createBoostStep(
  level: number,
  title: string,
  description: string,
  options: StepOptions = {}
): BoostStep {
  return createBaseStep("boost", "ability-boosts", level, title, description, options);
}

export function createSkillIncreaseStep(
  level: number,
  title: string,
  description: string,
  options: StepOptions = {}
): SkillIncreaseStep {
  return createBaseStep("skill-increase", "skill-increase", level, title, description, options);
}

export function createSkillTrainingStep(
  level: number,
  title: string,
  description: string,
  training: SkillTrainingMeta,
  options: StepOptions = {}
): SkillTrainingStep {
  const slotId = options.slotId ?? `skill-training-${training.classSlug}-level-${level}`;
  return {
    ...createBaseStep("skill-training", "skill-training", level, title, description, {
      ...options,
      slotId,
    }),
    training,
  };
}

export function createSingletonChoiceStep(
  level: number,
  singletonChoice: SingletonChoiceMeta,
  options: SingletonChoiceStepOptions = {}
): SingletonChoiceStep {
  return {
    ...createBaseStep(
      "singleton-choice",
      "singleton-choice",
      level,
      options.title ?? singletonChoice.sourceName,
      options.description ?? singletonChoice.prompt ?? "",
      {
        ...options,
        slotId: options.slotId ?? singletonChoice.slotId,
      }
    ),
    singletonChoice,
  };
}

export function createLanguageChoiceStep(
  level: number,
  languageChoice: LanguageChoiceMeta,
  options: LanguageChoiceStepOptions = {}
): LanguageChoiceStep {
  return {
    ...createBaseStep(
      "language-choice",
      "language-choice",
      level,
      options.title ?? "Bonus languages",
      options.description ?? "Choose the additional languages this character knows at 1st level.",
      {
        ...options,
        slotId: options.slotId ?? languageChoice.slotId,
      }
    ),
    languageChoice,
  };
}

export function createClassBranchStep(
  level: number,
  branch: ClassBranchMeta,
  options: ClassBranchStepOptions = {}
): ClassBranchStep {
  return {
    ...createBaseStep(
      "class-branch",
      "class-branch",
      level,
      options.title ?? branch.selectorName,
      options.description ?? `Choose the ${branch.selectorName.toLowerCase()} option that defines this class path.`,
      {
        ...options,
        slotId: options.slotId ?? branch.slotId,
      }
    ),
    filters: options.filters ?? {
      itemType: "feat",
      featTypes: ["classfeature"],
      maxLevel: level,
    },
    branch,
  };
}

export function createClassChoiceStep(
  level: number,
  classChoice: ClassChoiceMeta,
  options: ClassChoiceStepOptions = {}
): ClassChoiceStep {
  return {
    ...createBaseStep(
      "class-choice",
      "class-choice",
      level,
      options.title ?? classChoice.sourceName,
      options.description ?? "",
      {
        ...options,
        slotId: options.slotId ?? classChoice.slotId,
      }
    ),
    classChoice,
  };
}

export function createSpellChoiceStep(
  level: number,
  title: string,
  description: string,
  spellChoice: SpellChoiceMeta,
  options: SpellChoiceStepOptions = {}
): SpellChoiceStep {
  return {
    ...createBaseStep("spell-choice", "spell-choice", level, title, description, {
      ...options,
      slotId: options.slotId ?? spellChoice.slotId,
    }),
    filters: options.filters ?? {
      itemType: "spell",
    },
    spellChoice,
  };
}

export function isPickItemStep(step: Pick<PendingStep, "kind">): step is PickItemStep {
  return step.kind === "pick-item";
}

export function isClassBranchStep(step: Pick<PendingStep, "kind">): step is ClassBranchStep {
  return step.kind === "class-branch";
}

export function isClassChoiceStep(step: Pick<PendingStep, "kind">): step is ClassChoiceStep {
  return step.kind === "class-choice";
}

export function isSingletonChoiceStep(step: Pick<PendingStep, "kind">): step is SingletonChoiceStep {
  return step.kind === "singleton-choice";
}

export function isLanguageChoiceStep(step: Pick<PendingStep, "kind">): step is LanguageChoiceStep {
  return step.kind === "language-choice";
}

export function isManualStep(step: Pick<PendingStep, "kind">): step is ManualStep {
  return step.kind === "manual";
}

export function isSelectionStep(step: Pick<PendingStep, "kind">): step is SelectionStep {
  return step.kind === "pick-item" || step.kind === "class-branch";
}

export function isSkillIncreaseStep(step: Pick<PendingStep, "kind">): step is SkillIncreaseStep {
  return step.kind === "skill-increase";
}

export function isSkillTrainingStep(step: Pick<PendingStep, "kind">): step is SkillTrainingStep {
  return step.kind === "skill-training";
}

export function isSpellChoiceStep(step: Pick<PendingStep, "kind">): step is SpellChoiceStep {
  return step.kind === "spell-choice";
}

const SLOT_KIND_SORT_WEIGHTS: Record<SlotKind, number> = {
  ancestry: 0,
  heritage: 1,
  "ancestry-feat": 2,
  background: 3,
  class: 4,
  "ability-boosts": 5,
  "grant-choice": 6,
  deity: 7,
  "singleton-choice": 8,
  "class-choice": 9,
  "class-branch": 10,
  "skill-training": 11,
  "language-choice": 12,
  "spell-choice": 13,
  "class-feat": 14,
  "skill-feat": 15,
  "general-feat": 16,
  "skill-increase": 17,
};

const STEP_MODE_LABELS: Record<StepKind, string> = {
  "pick-item": "Selection",
  manual: "Manual",
  boost: "Boosts",
  "skill-increase": "Skill",
  "singleton-choice": "Choice",
  "language-choice": "Languages",
  "class-branch": "Class Path",
  "class-choice": "Class Choice",
  "spell-choice": "Spells",
  "skill-training": "Training",
};

export function getStepModeLabel(kind: StepKind): string {
  return STEP_MODE_LABELS[kind];
}

export function sortWeightForSlotKind(kind: SlotKind): number {
  return SLOT_KIND_SORT_WEIGHTS[kind];
}
