export type SlotKind =
  | "ancestry"
  | "heritage"
  | "background"
  | "class"
  | "ancestry-feat"
  | "class-feat"
  | "skill-feat"
  | "general-feat"
  | "ability-boosts"
  | "skill-increase";

export type StepKind = "pick-item" | "manual";

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
  manual: Record<string, boolean>;
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
  singletonSlots: Record<"ancestry" | "heritage" | "background" | "class", boolean>;
  featCounts: {
    ancestry: number;
    class: number;
    archetype: number;
    skill: number;
    general: number;
  };
  sourceIds: string[];
  namesByType: Record<string, string[]>;
}

export interface StepFilters {
  itemType: string;
  featTypes?: string[];
  maxLevel?: number;
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
  rarity: string | null;
  source: string | null;
  label: string;
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
