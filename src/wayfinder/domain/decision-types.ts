export interface SelectionRef {
  slotId: string;
  packId: string;
  documentId: string;
  uuid: string;
  itemType: string;
  featType: string | null;
  name: string;
  level: number | null;
  slug?: string | null;
}

export interface SkillTrainingDraft {
  ruleChoices: Record<string, string>;
  additional: string[];
  loreChoices: Record<string, string>;
}

export interface ItemSelectionDecision {
  kind: "selection";
  slotId: string;
  selection: SelectionRef;
}

export interface BranchSelectionDecision {
  kind: "class-branch";
  slotId: string;
  selection: SelectionRef;
}

export interface ClassArchetypeDecision {
  kind: "class-archetype";
  slotId: string;
  value: string;
}

export interface ClassChoiceDecision {
  kind: "class-choice";
  slotId: string;
  value: string;
}

export interface SingletonChoiceDecision {
  kind: "singleton-choice";
  slotId: string;
  value: string;
}

export interface LanguageChoiceDecision {
  kind: "language-choice";
  slotId: string;
  selections: string[];
}

export interface ManualDecision {
  kind: "manual";
  slotId: string;
  complete: boolean;
}

export interface SkillIncreaseDecision {
  kind: "skill-increase";
  slotId: string;
  skillSlug: string;
}

export interface SkillTrainingDecision {
  kind: "skill-training";
  slotId: string;
  training: SkillTrainingDraft;
}

export interface SpellChoiceDecision {
  kind: "spell-choice";
  slotId: string;
  selections: SelectionRef[];
}

export type DraftDecision =
  | ItemSelectionDecision
  | BranchSelectionDecision
  | ClassArchetypeDecision
  | SingletonChoiceDecision
  | LanguageChoiceDecision
  | ClassChoiceDecision
  | ManualDecision
  | SkillIncreaseDecision
  | SkillTrainingDecision
  | SpellChoiceDecision;
