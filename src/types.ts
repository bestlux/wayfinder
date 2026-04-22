import type { SelectionRef, SkillTrainingDraft } from "./wayfinder/domain/decision-types.js";
import type { PendingStep } from "./wayfinder/domain/step-types.js";

export type { DraftDecision, SelectionRef, SkillTrainingDraft } from "./wayfinder/domain/decision-types.js";
export type {
  BoostStep,
  ClassBranchMeta,
  ClassBranchStep,
  ClassChoiceMeta,
  ClassChoiceStep,
  ClassGrantMeta,
  LanguageChoiceMeta,
  LanguageChoiceStep,
  ManualStep,
  PendingStep,
  PickItemSlotKind,
  PickItemStep,
  SelectionStep,
  SingletonChoiceMeta,
  SingletonChoiceStep,
  SkillIncreaseStep,
  SkillTrainingChoiceMeta,
  SkillTrainingLoreChoiceMeta,
  SkillTrainingMeta,
  SkillTrainingPersistenceMeta,
  SkillTrainingStep,
  SlotKind,
  SpellChoiceDestination,
  SpellChoiceMeta,
  SpellChoiceStep,
  StepFilters,
  StepKind,
} from "./wayfinder/domain/step-types.js";
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

export interface DraftState {
  version: number;
  targetLevel: number;
  selections: Record<string, SelectionRef>;
  boosts: BoostDraftState;
  manual: Record<string, boolean>;
  skillIncreases: Record<string, string>;
  skillTrainings: Record<string, SkillTrainingDraft>;
  branchSelections: Record<string, SelectionRef>;
  singletonChoices: Record<string, string>;
  languageChoices: Record<string, string[]>;
  classChoices: Record<string, string>;
  spellChoices: Record<string, SelectionRef[]>;
  updatedAt: string | null;
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

export type PickerFilterKind = "rarity" | "source";

export interface PickerFilterState {
  rarity: string[];
  source: string[];
}
