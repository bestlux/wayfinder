import type { AcquisitionDraftState } from "./wayfinder/domain/acquisition-types.js";
import type { SelectionRef, SkillTrainingDraft } from "./wayfinder/domain/decision-types.js";
import type { CampaignFeatFilter as CampaignFeatFilterType, PendingStep } from "./wayfinder/domain/step-types.js";

export type { DraftDecision, SelectionRef, SkillTrainingDraft } from "./wayfinder/domain/decision-types.js";
export type {
  BoostStep,
  CampaignFeatFilter,
  CampaignFeatMeta,
  ChoicePredicate,
  ClassArchetypeMeta,
  ClassArchetypeStep,
  ClassBranchMeta,
  ClassBranchStep,
  ClassChoiceMeta,
  ClassChoiceStep,
  ClassGrantMeta,
  FlagChoiceMeta,
  GrantSelectionMeta,
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
  SpellChoicePublication,
  SpellChoiceStep,
  StaticGrantReplacementMeta,
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
  acquisition: AcquisitionDraftState | null;
  applyAttemptStepIds: string[];
  applyCompletedStepIds: string[];
  applyRecoveryActorUpdate: Record<string, unknown>;
  applySpellRarityAttestations: AppliedSpellRarityAttestation[];
  selections: Record<string, SelectionRef>;
  boosts: BoostDraftState;
  manual: Record<string, boolean>;
  skillIncreases: Record<string, string>;
  skillTrainings: Record<string, SkillTrainingDraft>;
  branchSelections: Record<string, SelectionRef>;
  classArchetypeChoices: Record<string, string>;
  singletonChoices: Record<string, string>;
  languageChoices: Record<string, string[]>;
  classChoices: Record<string, string>;
  spellChoices: Record<string, SelectionRef[]>;
  spellRarityAttestations: Record<string, SpellRarityAttestation>;
  updatedAt: string | null;
}

export interface ModuleState {
  version: number;
  lastAppliedAt: string | null;
  lastTargetLevel: number | null;
  completedStepIds: string[];
  existingCharacterHistory: ExistingCharacterHistory | null;
  lastAppliedSpellRarityAttestations: AppliedSpellRarityAttestation[];
}

export type SpellRarityAttestationBasis = "rules-access" | "reported-gm-permission";

export interface SpellRarityAttestationSubject {
  actorId: string;
  slotId: string;
  stepId: string;
  targetLevel: number;
  stepLevel: number;
  destinationKey: string;
  stepRarityCeiling: "common" | "uncommon" | "rare" | "unique";
  worldRarityCeiling: "common" | "uncommon" | "rare" | "unique";
}

export interface UnresolvedSpellRarityAccess {
  version: 1;
  kind: "spell-rarity-access";
  trust: "player-attestation";
  status: "unresolved";
  slotId: string;
  migratedFrom: "legacy-boolean";
}

export interface AttestedSpellRarityAccess {
  version: 1;
  kind: "spell-rarity-access";
  trust: "player-attestation";
  status: "attested";
  subject: SpellRarityAttestationSubject;
  claimedBasis: SpellRarityAttestationBasis;
  reason: string;
  authorUserId: string;
  authorName: string;
  attestedAt: string;
}

export type SpellRarityAttestation = UnresolvedSpellRarityAccess | AttestedSpellRarityAccess;

export interface AppliedSpellRarityAttestation extends AttestedSpellRarityAccess {
  subjectLabel: string;
  selectedSpells: SelectionRef[];
}

export interface ExistingCharacterHistoryEntry {
  slotId: string;
  level: number;
  category: "foundation" | "feat" | "ability-boost" | "skill-increase" | "other";
  label: string;
  value: string;
  status: "mapped" | "review";
  sourceUuid: string | null;
}

export interface ExistingCharacterHistory {
  version: 1;
  importedAt: string;
  actorLevel: number;
  entries: ExistingCharacterHistoryEntry[];
}

export interface ActorSnapshot {
  actorId: string;
  level: number;
  isBlank: boolean;
  freeArchetypeEnabled: boolean;
  campaignFeatSections: CampaignFeatSectionSnapshot[];
  gradualBoostsEnabled: boolean;
  singletonSlots: Record<"ancestry" | "heritage" | "background" | "class" | "deity", boolean>;
  featCounts: {
    ancestry: number;
    class: number;
    archetype: number;
    skill: number;
    general: number;
  };
  fulfilledStepIds: string[];
  sourceIds: string[];
  namesByType: Record<string, string[]>;
  skillRanks: Record<string, number>;
}

export interface CampaignFeatSlotSnapshot {
  id: string;
  level: number;
  fulfilled: boolean;
  filter: CampaignFeatFilterSnapshot | null;
}

export type CampaignFeatFilterSnapshot = CampaignFeatFilterType;

export interface CampaignFeatSectionSnapshot {
  id: string;
  label: string;
  supported: string[];
  filter: CampaignFeatFilterSnapshot;
  slots: CampaignFeatSlotSnapshot[];
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
  disclosure?: string | null;
}

export interface ProjectedArchetypeFeat {
  uuid: string | null;
  name: string;
  slug: string | null;
  traits: string[];
  familyIds: string[];
  dedicationLockout: {
    requiredFollowUpCount: number;
    countingFamilyIds: string[];
    allowedDedicationFamilyIds: string[];
  } | null;
  unresolvedLockoutException: "allowed-dedication" | "follow-up-qualification" | null;
}

export interface OptionContext {
  ancestrySlug: string | null;
  ancestryTraits: string[];
  heritageTraits: string[];
  classSlug: string | null;
  classHasSpellcasting: boolean;
  deitySelected?: boolean;
  sanctification?: "holy" | "unholy" | "none" | null;
  hasDedicationFeat: boolean;
  selectedUuidsBySlotId?: Record<string, string>;
  selectedSpellChoicesBySlotId?: Record<
    string,
    {
      destinationKey: string;
      uuids: string[];
    }
  >;
  actorSourceIds?: string[];
  actorSpellUuidsByDestinationKey?: Record<string, string[]>;
  rollOptions?: string[];
  skillRanks?: Record<string, number>;
  projectedArchetypeFeats?: ProjectedArchetypeFeat[];
}

export interface PickerInfoState {
  tone: "blocked" | "empty" | "search";
  eyebrow: string;
  title: string;
  message: string;
}

export type PickerFilterKind = "rank" | "rarity" | "source";

export interface PickerFilterState {
  rank: string[];
  rarity: string[];
  source: string[];
}
