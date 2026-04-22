import type { AbilityKey, BoostLevel, OptionRecord, PickerInfoState } from "../types.js";

export interface StepNavRow {
  id: string;
  index: number;
  level: number;
  title: string;
  active: boolean;
  complete: boolean;
  invalidated: boolean;
  modeLabel: string;
  status: string;
  firstInLevel: boolean;
}

export interface SummaryItem {
  label: string;
  value: string;
  complete: boolean;
}

export interface DetailRow {
  label: string;
  value: string;
}

export interface PreviewPane {
  title: string;
  img: string;
  source: string | null;
  rarity: string | null;
  tags: string[];
  details: DetailRow[];
  description: string;
  selected: boolean;
  selectedLabel: string;
  value: string;
}

export interface PickerFilterGroupPane {
  key: "rarity" | "source";
  label: string;
  summaryLabel: string;
  selectedCount: number;
  isOpen: boolean;
  options: Array<{
    value: string;
    label: string;
    count: number;
    selected: boolean;
  }>;
}

export interface PickStepPane {
  kind: "pick-item";
  isPickItem: true;
  isManual: false;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  search: string;
  activeFilterCount: number;
  selectedValue: string;
  selectedLabel: string | null;
  resultCount: number;
  contextNote: string | null;
  infoState: PickerInfoState | null;
  filterGroups: PickerFilterGroupPane[];
  options: Array<OptionRecord & { selected: boolean; previewing: boolean; sourceLabel: string }>;
  preview: PreviewPane | null;
}

export interface ManualStepPane {
  kind: "manual";
  isPickItem: false;
  isManual: true;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
}

export interface BoostAttributeButton {
  attribute: AbilityKey;
  label: string;
  selected: boolean;
  disabled: boolean;
  partial?: boolean;
}

export interface VoluntaryFlawButton {
  attribute: AbilityKey;
  label: string;
  flawSelected: boolean;
  flawDisabled: boolean;
  secondFlawSelected: boolean;
  secondFlawDisabled: boolean;
  showSecondFlaw: boolean;
  boostSelected: boolean;
  boostDisabled: boolean;
  showBoost: boolean;
}

export interface BoostAbilitySummary {
  attribute: AbilityKey;
  label: string;
  modifierLabel: string;
  partial: boolean;
}

export interface BoostStepPane {
  kind: "boost";
  isPickItem: false;
  isManual: false;
  isBoost: true;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  blocked: boolean;
  blockedTitle: string | null;
  blockedMessage: string | null;
  completed: boolean;
  selectedLabel: string;
  abilitySummary: BoostAbilitySummary[];
  ancestrySection: null | {
    mode: "standard" | "alternate";
    canToggleAlternate: boolean;
    remaining: number;
    buttons: BoostAttributeButton[];
  };
  voluntarySection: null | {
    enabled: boolean;
    legacy: boolean;
    buttons: VoluntaryFlawButton[];
  };
  backgroundSection: null | {
    remaining: number;
    buttons: BoostAttributeButton[];
  };
  classSection: null | {
    options: BoostAttributeButton[];
  };
  levelSection: {
    level: BoostLevel;
    remaining: number;
    buttons: BoostAttributeButton[];
  };
}

export interface SkillOption {
  slug: string;
  label: string;
  currentRank: number;
  currentRankLabel: string;
  currentRankCode: string;
  targetRank: number;
  targetRankLabel: string;
  targetRankCode: string;
  selected: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

export interface SkillIncreaseStepPane {
  kind: "skill-increase";
  isPickItem: false;
  isManual: false;
  isBoost: false;
  isSkillIncrease: true;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
  maxRankLabel: string;
  skills: SkillOption[];
}

export interface SkillTrainingRuleChoicePane {
  flag: string;
  prompt: string;
  selectedSlug: string | null;
  selectedLabel: string | null;
  options: Array<{
    slug: string;
    label: string;
    selected: boolean;
  }>;
}

export interface SkillTrainingStepPane {
  kind: "skill-training";
  isPickItem: false;
  isManual: false;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: true;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
  className: string;
  fixedSkills: string[];
  choiceSections: SkillTrainingRuleChoicePane[];
  additionalCount: number;
  additionalRemaining: number;
  additionalSkills: Array<SkillOption & { selected: boolean }>;
}

export interface ClassChoiceStepPane {
  kind: "class-choice";
  isPickItem: false;
  isManual: false;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: true;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
  sourceName: string;
  dependsOn: "class" | "deity";
  blocked: boolean;
  blockedTitle: string | null;
  blockedMessage: string | null;
  options: Array<{
    value: string;
    label: string;
    img: string | null;
    detail: string | null;
    selected: boolean;
  }>;
}

export interface SingletonChoiceStepPane {
  kind: "singleton-choice";
  isPickItem: false;
  isManual: false;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: true;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
  sourceName: string;
  sourceItemType: "ancestry" | "heritage" | "background" | "class" | "deity";
  options: Array<{
    value: string;
    label: string;
    img: string | null;
    detail: string | null;
    selected: boolean;
  }>;
}

export interface LanguageChoiceStepPane {
  kind: "language-choice";
  isPickItem: false;
  isManual: false;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: true;
  isClassChoice: false;
  isSpellChoice: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string | null;
  selectedValues: string[];
  selectedCount: number;
  requiredCount: number;
  remainingCount: number;
  sourceName: string;
  grantedLanguages: string[];
  options: Array<{
    value: string;
    label: string;
    selected: boolean;
  }>;
}

export interface SpellChoiceStepPane {
  kind: "spell-choice";
  isPickItem: false;
  isManual: false;
  isBoost: false;
  isSkillIncrease: false;
  isSkillTraining: false;
  isSingletonChoice: false;
  isLanguageChoice: false;
  isClassChoice: false;
  isSpellChoice: true;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  search: string;
  activeFilterCount: number;
  selectedValues: string[];
  selectedLabel: string | null;
  selectedCount: number;
  requiredCount: number;
  remainingCount: number;
  resultCount: number;
  contextNote: string | null;
  infoState: PickerInfoState | null;
  destinationLabel: string;
  sourceName: string;
  filterGroups: PickerFilterGroupPane[];
  options: Array<OptionRecord & { selected: boolean; previewing: boolean; sourceLabel: string }>;
  preview: PreviewPane | null;
}

export type ActivePane =
  | PickStepPane
  | ManualStepPane
  | BoostStepPane
  | SkillIncreaseStepPane
  | SkillTrainingStepPane
  | SingletonChoiceStepPane
  | LanguageChoiceStepPane
  | ClassChoiceStepPane
  | SpellChoiceStepPane
  | null;
