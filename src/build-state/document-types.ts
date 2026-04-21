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
    boosts?: Record<string, BuildStateBoostRecord>;
    alternateAncestryBoosts?: unknown;
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
    build?: {
      attributes?: {
        boosts?: Record<number, unknown>;
      };
    };
  };
}
