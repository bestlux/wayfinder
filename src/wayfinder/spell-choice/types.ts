import type { ActorItemFlags, ActorItemLike, ActorLike } from "../../shared/actor-model.js";
import type { DraftState, SelectionRef, SpellChoiceMeta } from "../../types.js";

export interface SourceRef {
  sourcePackId: string | null;
  sourceDocumentId: string | null;
  sourceUuid: string | null;
  sourceName: string;
}

export interface SpellChoiceFeatureReference {
  name?: unknown;
  uuid?: unknown;
}

interface SpellChoiceSourceCarrier {
  name?: unknown;
  sourceId?: unknown;
  flags?: {
    core?: {
      sourceId?: unknown;
    };
  };
  _stats?: {
    compendiumSource?: unknown;
  };
}

export interface SpellChoiceClassDocument extends SpellChoiceSourceCarrier {
  system?: {
    slug?: unknown;
    items?: Record<string, SpellChoiceFeatureReference>;
  } & Record<string, unknown>;
}

export interface SpellChoiceSchoolDocument extends SpellChoiceSourceCarrier {
  system?: {
    slug?: unknown;
    description?: {
      value?: unknown;
    };
  } & Record<string, unknown>;
}

export interface SpellChoiceDeityDocument extends SpellChoiceSourceCarrier {
  system?: {
    spells?: Record<string, unknown>;
  } & Record<string, unknown>;
}

export type SpellChoiceDocumentLike = SpellChoiceClassDocument | SpellChoiceSchoolDocument | SpellChoiceDeityDocument;

export type ReadExistingSpellChoiceSelections = (choice: SpellChoiceMeta) => SelectionRef[];

export interface BuildSpellChoiceStepsParams {
  draft: DraftState;
  currentLevel: number;
  effectiveClassDocument: unknown | null;
  effectiveDeityDocument: unknown | null;
  effectiveSchoolDocument: unknown | null;
  effectiveClassFeatureDocuments?: unknown[];
  targetLevel: number;
  extractSlug: (document: SpellChoiceDocumentLike | null) => string | null;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export interface BuildWizardSpellChoiceStepsParams {
  draft: DraftState;
  currentLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  effectiveSchoolDocument: SpellChoiceSchoolDocument | null;
  effectiveClassFeatureDocuments: SpellChoiceSchoolDocument[];
  targetLevel: number;
  extractSlug: (document: SpellChoiceDocumentLike | null) => string | null;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
  classSlug: string;
}

export interface BuildClericSpellChoiceStepsParams {
  draft: DraftState;
  effectiveClassDocument: SpellChoiceClassDocument;
  effectiveDeityDocument: SpellChoiceDeityDocument | null;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
  classSlug: string;
}

export interface SpellChoiceItem extends Omit<ActorItemLike, "flags" | "system"> {
  flags?: ActorItemFlags & {
    "wayfinder-pf2e"?: {
      slotId?: unknown;
    };
  };
  system?: ActorItemLike["system"] & {
    traits?: {
      rarity?: unknown;
      traditions?: unknown;
      value?: unknown;
    };
  };
}

export type SpellChoiceActor = ActorLike;

export function asSpellChoiceClassDocument(value: unknown): SpellChoiceClassDocument | null {
  return isRecord(value) ? (value as SpellChoiceClassDocument) : null;
}

export function asSpellChoiceSchoolDocument(value: unknown): SpellChoiceSchoolDocument | null {
  return isRecord(value) ? (value as SpellChoiceSchoolDocument) : null;
}

export function asSpellChoiceDeityDocument(value: unknown): SpellChoiceDeityDocument | null {
  return isRecord(value) ? (value as SpellChoiceDeityDocument) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
