export type SlotKind =
  | "ancestry"
  | "heritage"
  | "background"
  | "class"
  | "deity"
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
  | "class-branch"
  | "class-choice"
  | "spell-choice"
  | "skill-training";
export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type BoostLevel = 1 | 5 | 10 | 15 | 20;

export interface VoluntaryFlawDraft {
  touched: boolean;
  enabled: boolean;
  legacy: boolean;
  boost: AbilityKey | null;
  flaws: AbilityKey[];
}

export interface BoostDraftState {
  ancestry: {
    modeTouched: boolean;
    mode: "standard" | "alternate";
    selectedBoosts: Record<string, AbilityKey | null>;
    alternateBoosts: AbilityKey[];
    voluntary: VoluntaryFlawDraft;
  };
  background: {
    selectedBoosts: Record<string, AbilityKey | null>;
  };
  class: {
    keyAbility: AbilityKey | null;
  };
  levels: Record<string, AbilityKey[]>;
}

export interface SelectionRef {
  slotId: string;
  packId: string;
  documentId: string;
  uuid: string;
  itemType: string;
  featType: string | null;
  name: string;
  level: number | null;
}

export interface DraftState {
  version: number;
  targetLevel: number;
  selections: Record<string, SelectionRef>;
  boosts: BoostDraftState;
  manual: Record<string, boolean>;
  skillIncreases: Record<string, string>;
  skillTrainings: Record<string, SkillTrainingDraft>;
  branchSelections: Record<string, SelectionRef>;
  classChoices: Record<string, string>;
  spellChoices: Record<string, SelectionRef[]>;
  updatedAt: string | null;
}

export interface SkillTrainingDraft {
  ruleChoices: Record<string, string>;
  additional: string[];
}

export interface ModuleState {
  version: number;
  lastAppliedAt: string | null;
  lastTargetLevel: number | null;
  completedStepIds: string[];
}

export interface ActorSnapshot {
  actorId: string;
  level: number;
  isBlank: boolean;
  singletonSlots: Record<"ancestry" | "heritage" | "background" | "class" | "deity", boolean>;
  featCounts: {
    ancestry: number;
    class: number;
    archetype: number;
    skill: number;
    general: number;
  };
  sourceIds: string[];
  namesByType: Record<string, string[]>;
  skillRanks: Record<string, number>;
}

export interface StepFilters {
  itemType: string;
  featTypes?: string[];
  maxLevel?: number;
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

export interface ClassGrantMeta {
  slotId: string;
  selectorPackId: string;
  selectorDocumentId: string;
  selectorUuid: string;
  selectorName: string;
  selectorRuleIndex: number;
  grantRuleIndex: number;
  flag: string;
  itemType: "deity";
  classSlug: string | null;
}

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

export interface PendingStep {
  id: string;
  level: number;
  kind: StepKind;
  slotKind: SlotKind;
  title: string;
  description: string;
  required: boolean;
  slotId: string;
  filters?: StepFilters;
  branch?: ClassBranchMeta;
  grantSelection?: ClassGrantMeta;
  classChoice?: ClassChoiceMeta;
  spellChoice?: SpellChoiceMeta;
  training?: {
    classSlug: string;
    className: string;
    fixedSkills: string[];
    choiceRules: Array<{
      ruleIndex: number;
      flag: string;
      prompt: string;
      options: Array<{ slug: string; label: string }>;
    }>;
    additionalCount: number;
  };
}

export interface ProgressionPlan {
  recommendedTargetLevel: number;
  targetLevel: number;
  steps: PendingStep[];
}

export interface OptionRecord {
  value: string;
  packId: string;
  documentId: string;
  uuid: string;
  img: string;
  itemType: string;
  featType: string | null;
  name: string;
  level: number | null;
  slug: string | null;
  traits: string[];
  rarity: string | null;
  source: string | null;
  label: string;
}

export interface OptionContext {
  ancestrySlug: string | null;
  ancestryTraits: string[];
  heritageTraits: string[];
  classSlug: string | null;
  deitySelected?: boolean;
  sanctification?: "holy" | "unholy" | "none" | null;
  hasDedicationFeat: boolean;
}

export interface PickerInfoState {
  tone: "blocked" | "empty" | "search";
  eyebrow: string;
  title: string;
  message: string;
}

export interface ActorSummary {
  currentLevel: number;
  needsCreation: boolean;
  itemTypes: Set<string>;
  ancestrySlug: string | null;
}

export interface StepSelection {
  id: string;
  name: string;
  uuid?: string;
  slug?: string;
  type?: string;
  badge?: string;
  detail?: string;
  updatePath?: string;
  value?: number | string | string[];
}

export interface WayfinderDraft {
  schemaVersion: number;
  targetLevel: number;
  currentStepIndex: number;
  selections: Record<string, StepSelection[]>;
  updatedAt: string;
}

export interface WayfinderStep {
  id: string;
  level: number;
  label: string;
  detail: string;
  guidance: string;
  kind:
    | "ancestry"
    | "heritage"
    | "background"
    | "class"
    | "deity"
    | "class-branch"
    | "class-choice"
    | "initial-ability-boosts"
    | "ability-boosts"
    | "ancestry-feat"
    | "class-feat"
    | "skill-feat"
    | "general-feat"
    | "skill-increase";
  sourceKind: "item" | "ability" | "skill";
  selectionMode: "single" | "multi";
  selectionCount: number;
}

export interface SourceFilter {
  includeOfficialSources: boolean;
  additionalPackIds: string[];
}
