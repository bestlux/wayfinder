import type {
  AbilityKey,
  BoostLevel,
  OptionRecord,
  PickerFilterKind,
  PickerInfoState,
  SingletonChoiceMeta,
} from "../types.js";

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
  disclosure?: string | null;
  selected: boolean;
  selectedLabel: string;
  value: string;
}

export interface PickerFilterGroupPane {
  key: PickerFilterKind;
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

export type PaneTemplateKind =
  | "pick-item"
  | "manual"
  | "boost"
  | "skill-increase"
  | "skill-training"
  | "singleton-choice"
  | "language-choice"
  | "class-choice"
  | "spell-choice";

export interface PickStepPane {
  kind: "pick-item";
  templateKind: "pick-item";
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
  templateKind: "manual";
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
  templateKind: "boost";
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
    level: number;
    batchLevel: BoostLevel;
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
  templateKind: "skill-increase";
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
  key: string;
  prompt: string;
  sourceLabel: string;
  selectedSlug: string | null;
  selectedLabel: string | null;
  unavailableLegend: string | null;
  options: Array<{
    slug: string;
    label: string;
    currentRank: number;
    currentRankLabel: string;
    currentRankCode: string;
    keyAbility: string | null;
    selected: boolean;
    disabled: boolean;
    disabledReason: string | null;
  }>;
}

export interface SkillTrainingLoreChoicePane {
  key: string;
  prompt: string;
  sourceLabel: string;
  value: string;
  placeholder: string;
  allowCustom: boolean;
  suggestions: Array<{
    value: string;
    selected: boolean;
  }>;
}

export interface SkillTrainingStepPane {
  kind: "skill-training";
  templateKind: "skill-training";
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
  fixedLores: string[];
  choiceSections: SkillTrainingRuleChoicePane[];
  loreSections: SkillTrainingLoreChoicePane[];
  additionalCount: number;
  additionalRemaining: number;
  additionalSkills: Array<SkillOption & { selected: boolean }>;
}

export interface ClassChoiceStepPane {
  kind: "class-choice" | "class-archetype";
  templateKind: "class-choice";
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
  eyebrow: string;
  action: "select-class-choice" | "select-class-archetype";
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
  templateKind: "singleton-choice";
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
  sourceName: string;
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  options: Array<{
    value: string;
    label: string;
    img: string | null;
    detail: string | null;
    selected: boolean;
  }>;
}

interface LanguageChoiceOptionPane {
  value: string;
  label: string;
  requiresGmApproval: boolean;
  selected: boolean;
}

export interface LanguageChoiceStepPane {
  kind: "language-choice";
  templateKind: "language-choice";
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
  sourceOptions: LanguageChoiceOptionPane[];
  approvalOptions: LanguageChoiceOptionPane[];
  approvalOptionCount: number;
  approvalOptionsOpen: boolean;
}

export interface SpellChoiceStepPane {
  kind: "spell-choice";
  templateKind: "spell-choice";
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
  excessCount: number;
  selectionState: "incomplete" | "complete" | "excess" | "invalid";
  resultCount: number;
  contextNote: string | null;
  infoState: PickerInfoState | null;
  destinationLabel: string;
  sourceName: string;
  rarityAccess: {
    visible: boolean;
    available: boolean;
    granted: boolean;
    locked: boolean;
    state: "none" | "unresolved" | "stale" | "attested" | "unused";
    basisLabel: string | null;
    reason: string | null;
    authorName: string | null;
    attestedAt: string | null;
    descriptionId: string;
  };
  filterGroups: PickerFilterGroupPane[];
  selectedSpells: Array<{
    value: string;
    name: string;
    rankLabel: string;
  }>;
  options: Array<
    OptionRecord & {
      selected: boolean;
      previewing: boolean;
      sourceLabel: string;
      rankLabel: string;
    }
  >;
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
