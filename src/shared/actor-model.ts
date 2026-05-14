export type LooseRecord = Record<string, unknown>;

export interface ActorModuleFlags extends LooseRecord {
  importedBy?: unknown;
  slotId?: unknown;
  destinationKey?: unknown;
}

export interface ActorItemFlags extends LooseRecord {
  core?: {
    sourceId?: unknown;
  };
  pf2e?: {
    rulesSelections?: Record<string, unknown>;
    grantedBy?: {
      id?: unknown;
      onDelete?: unknown;
    };
    itemGrants?: Record<string, unknown>;
  } & LooseRecord;
  "wayfinder-pf2e"?: ActorModuleFlags;
}

export interface PreparedSlotLike {
  id?: string | null;
  expended?: unknown;
}

export interface SpellSlotGroupLike {
  max?: unknown;
  value?: unknown;
  prepared?: PreparedSlotLike[];
}

export interface ItemSystemLike extends LooseRecord {
  ability?: {
    value?: unknown;
    selected?: unknown;
  };
  boosts?: Record<string, { value?: unknown; selected?: unknown } & LooseRecord>;
  font?: unknown;
  keyAbility?: {
    value?: unknown;
    selected?: unknown;
  };
  level?: {
    value?: unknown;
    taken?: unknown;
  };
  location?: { value?: unknown } | string;
  prepared?: {
    value?: unknown;
    flexible?: unknown;
  };
  rules?: LooseRecord[];
  showSlotlessLevels?: {
    value?: unknown;
  };
  slots?: Record<string, SpellSlotGroupLike>;
  tradition?: {
    value?: unknown;
  };
  traits?: {
    traditions?: unknown;
    value?: unknown;
  };
  voluntary?: {
    flaws?: unknown;
    boost?: unknown;
  };
}

export interface EmbeddedItemSource extends LooseRecord {
  name?: string;
  type?: string;
  img?: string;
  flags?: ActorItemFlags & LooseRecord;
  system?: ItemSystemLike;
  _stats?: LooseRecord;
}

export interface ActorItemLike extends EmbeddedItemSource {
  id?: string;
  sourceId?: string | null;
}

export interface FeatSlotLike {
  id?: string;
  level?: number | null;
  feat?: unknown;
}

export interface FeatGroupLike {
  slots?: Record<string, FeatSlotLike>;
}

export interface ActorLike extends LooseRecord {
  system?: {
    details?: {
      level?: {
        value?: unknown;
      };
    };
    build?: {
      attributes?: {
        boosts?: Record<string, unknown>;
      };
    };
    skills?: Record<string, { rank?: unknown } & LooseRecord>;
  } & LooseRecord;
  items?:
    | {
        contents?: ActorItemLike[];
      }
    | ActorItemLike[];
  feats?: {
    get?: (groupId: string) => FeatGroupLike | null | undefined;
    insertFeat?: (
      document: unknown,
      slotData: { groupId: string; slotId: string | null } | null
    ) => Promise<ActorItemLike[]>;
  } & LooseRecord;
  createEmbeddedDocuments?: (type: "Item", sources: EmbeddedItemSource[]) => Promise<ActorItemLike[]>;
  deleteEmbeddedDocuments?: (type: "Item", ids: string[]) => Promise<unknown>;
  updateEmbeddedDocuments?: (type: "Item", updates: LooseRecord[]) => Promise<unknown>;
  update?: (updates: LooseRecord) => Promise<unknown>;
  prepareData?: () => void;
}

export interface SelectionDocumentLike {
  id?: string;
  name?: string;
  toObject(): EmbeddedItemSource;
}

export interface PackLike {
  metadata?: {
    id?: string;
  };
  getDocument(documentId: string): Promise<SelectionDocumentLike | null>;
}

export interface GameLike {
  packs?: Map<string, PackLike>;
}
