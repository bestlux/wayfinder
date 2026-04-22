import type { AbilityKey } from "../types.js";

export type SingletonItemType = "ancestry" | "heritage" | "background" | "class" | "deity";

export interface BuildStateBoostRecord {
  value: AbilityKey[];
  selected: AbilityKey | null;
}
export type EffectiveBoostRecord = BuildStateBoostRecord;

export interface BuildStateVoluntaryRecord {
  touched?: boolean;
  enabled?: boolean;
  legacy?: boolean;
  boost?: AbilityKey | null;
  flaws?: AbilityKey[];
}

export interface BuildStateDocument {
  name?: string;
  type?: string;
  toObject?: () => unknown;
  system?: {
    additionalLanguages?: {
      count?: number;
      value?: string[];
      custom?: string;
    };
    boosts?: Record<string, BuildStateBoostRecord>;
    alternateAncestryBoosts?: unknown;
    languages?: {
      value?: string[];
      custom?: string;
    };
    voluntary?: BuildStateVoluntaryRecord;
    keyAbility?: {
      value?: AbilityKey[];
      selected?: AbilityKey | null;
    };
  };
}

export type ResolvedBuildStateDocument = BuildStateDocument & {
  name: string;
};

export interface BuildStateActorItem {
  id?: string;
  type?: string;
  name?: string;
  flags?: {
    core?: {
      sourceId?: unknown;
    };
  };
  system?: Record<string, unknown>;
}

export interface BuildStateActor {
  items?: { contents?: BuildStateActorItem[] } | BuildStateActorItem[];
  system?: {
    details?: {
      level?: {
        value?: unknown;
      };
      languages?: {
        value?: string[];
        details?: string;
      };
    };
    build?: {
      attributes?: {
        boosts?: Record<number, unknown>;
      };
    };
  };
}
