import { vi } from "vitest";
import type {
  ActorItemLike,
  ActorLike,
  EmbeddedItemSource,
  GameLike,
  SelectionDocumentLike,
} from "../../src/shared/actor-model";
import type { PendingStep, SelectionRef, SpellChoiceMeta } from "../../src/types";

type PackDocumentDefinition = {
  name: string;
  type: string;
  system?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  img?: string;
  _stats?: Record<string, unknown>;
};

type ChoiceOption = {
  value: string;
  label: string;
  img: string | null;
  detail: string | null;
};

type ActorHarnessOptions = {
  level?: number;
  items?: ActorItemLike[];
};

type HarnessActor = ActorLike & {
  items: {
    contents: ActorItemLike[];
  };
  createEmbeddedDocuments: ReturnType<typeof vi.fn>;
  deleteEmbeddedDocuments: ReturnType<typeof vi.fn>;
  updateEmbeddedDocuments: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

type TestSelectionDocumentLike = SelectionDocumentLike & {
  type?: string;
  img?: string;
  system?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  _stats?: Record<string, unknown>;
};

export const testGlobals = globalThis as typeof globalThis & { game: GameLike };

export function buildActorHarness(options: ActorHarnessOptions = {}) {
  const createdItems: ActorItemLike[] = [];
  let nextId = 1;
  const actor: HarnessActor = {
    system: {
      details: {
        level: {
          value: options.level ?? 1,
        },
      },
      build: {
        attributes: {
          boosts: {
            1: [],
            5: [],
            10: [],
            15: [],
            20: [],
          },
        },
      },
    },
    items: {
      contents: [...(options.items ?? [])] as ActorItemLike[],
    },
    createEmbeddedDocuments: vi.fn(async (_type: string, sources: EmbeddedItemSource[]) => {
      const created = sources.map((source) => {
        const item: ActorItemLike = {
          id: `created-${nextId++}`,
          type: source.type,
          name: source.name,
          sourceId: typeof source.flags?.core?.sourceId === "string" ? source.flags.core.sourceId : null,
          flags: source.flags ?? {},
          system: source.system ?? {},
          _stats: source._stats ?? {},
        };
        createdItems.push(item);
        actor.items.contents.push(item);
        return item;
      });
      return created;
    }),
    deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
      actor.items.contents = actor.items.contents.filter((item) => !item.id || !ids.includes(item.id));
      return [];
    }),
    updateEmbeddedDocuments: vi.fn(async (_type: string, updates: Array<Record<string, unknown>>) => {
      for (const update of updates) {
        const itemId = typeof update._id === "string" ? update._id : null;
        if (!itemId) {
          continue;
        }

        const item = actor.items.contents.find((entry) => entry.id === itemId);
        if (!item) {
          continue;
        }

        for (const [path, value] of Object.entries(update)) {
          if (path === "_id") {
            continue;
          }

          setByPath(item, path, cloneValue(value));
        }
      }

      return [];
    }),
    update: vi.fn(async (updates: Record<string, unknown>) => {
      for (const [path, value] of Object.entries(updates)) {
        setByPath(actor, path, cloneValue(value));
      }

      return {};
    }),
  };

  return { actor, createdItems };
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;

  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  const leaf = segments.at(-1);
  if (!leaf) {
    return;
  }

  cursor[leaf] = value;
}

export function setGamePacks(packs: Record<string, Record<string, PackDocumentDefinition>>): void {
  testGlobals.game = {
    packs: new Map(
      Object.entries(packs).map(([packId, documents]) => [
        packId,
        {
          metadata: { id: packId },
          async getDocument(documentId: string) {
            const document = documents[documentId];
            if (!document) {
              return null;
            }

            const selectionDocument: TestSelectionDocumentLike = {
              id: documentId,
              name: document.name,
              type: document.type,
              img: document.img,
              system: cloneValue(document.system ?? {}),
              flags: cloneValue(document.flags ?? {}),
              _stats: cloneValue(document._stats ?? {}),
              toObject: () => ({
                name: document.name,
                type: document.type,
                img: document.img,
                system: cloneValue(document.system ?? {}),
                flags: cloneValue(document.flags ?? {}),
                _stats: cloneValue(document._stats ?? {}),
              }),
            };
            return selectionDocument;
          },
        },
      ])
    ),
  };
}

export function selection(
  slotId: string,
  packId: string,
  documentId: string,
  itemType: string,
  name: string,
  featType: string | null = null,
  level = 1
): SelectionRef {
  return {
    slotId,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType,
    name,
    level,
  };
}

export function classSelectionStep(): PendingStep {
  return {
    id: "class-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "class",
    title: "Choose a class",
    description: "",
    required: true,
    slotId: "class-level-1",
    filters: {
      itemType: "class",
    },
  };
}

export function deitySelectionStep(): PendingStep {
  return {
    id: "deity-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "deity",
    title: "Choose a deity",
    description: "",
    required: true,
    slotId: "deity-level-1",
    filters: {
      itemType: "deity",
    },
    grantSelection: {
      slotId: "deity-level-1",
      sourceItemType: "classfeature",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "deity-cleric",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      selectorName: "Deity",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "deity",
      itemType: "deity",
      classSlug: "cleric",
      dependsOn: "class",
      filters: {
        itemType: "deity",
      },
    },
  };
}

export function classBranchStep(args: {
  slotId: string;
  title: string;
  selectorDocumentId: string;
  selectorName: string;
  flag: string;
  optionTag: string;
  classSlug: string;
}): PendingStep {
  return {
    id: args.slotId,
    level: 1,
    kind: "class-branch",
    slotKind: "class-branch",
    title: args.title,
    description: "",
    required: true,
    slotId: args.slotId,
    filters: {
      itemType: "feat",
      featTypes: ["classfeature"],
      maxLevel: 1,
    },
    branch: {
      slotId: args.slotId,
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: args.selectorDocumentId,
      selectorUuid: `Compendium.pf2e.classfeatures.Item.${args.selectorDocumentId}`,
      selectorName: args.selectorName,
      selectorRuleIndex: 0,
      flag: args.flag,
      optionTag: args.optionTag,
      classSlug: args.classSlug,
      dependsOn: "class",
    },
  };
}

export function classChoiceStep(args: {
  slotId: string;
  title: string;
  sourceDocumentId: string;
  sourceName: string;
  sourceRuleIndex: number;
  flag: string;
  classSlug: string;
  dependsOn: "class" | "deity";
  options: ChoiceOption[];
}): PendingStep {
  return {
    id: args.slotId,
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: args.title,
    description: "",
    required: true,
    slotId: args.slotId,
    classChoice: {
      slotId: args.slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: args.sourceDocumentId,
      sourceUuid: `Compendium.pf2e.classfeatures.Item.${args.sourceDocumentId}`,
      sourceName: args.sourceName,
      sourceRuleIndex: args.sourceRuleIndex,
      flag: args.flag,
      classSlug: args.classSlug,
      dependsOn: args.dependsOn,
      options: args.options,
    },
  };
}

export function spellChoiceStep(slotId: string, spellChoice: SpellChoiceMeta, title = "Prepared spell"): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title,
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "spell",
    },
    spellChoice,
  };
}

export function clericSpellChoice(
  slotId: string,
  count: number,
  minRank: number,
  maxRank: number,
  cantrip: boolean
): SpellChoiceMeta {
  return {
    slotId,
    sourcePackId: "pf2e.classfeatures",
    sourceDocumentId: "cleric-spellcasting",
    sourceUuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
    sourceName: "Cleric Spellcasting",
    classSlug: "cleric",
    dependsOn: "class",
    destination: {
      type: "prepared",
      key: "cleric-divine-prepared",
      label: "Divine prepared spells",
      entryName: "Divine Prepared Spells",
      tradition: "divine",
      ability: "wis",
      prepared: "prepared",
    },
    count,
    minRank,
    maxRank,
    cantrip,
    curriculumSpellNames: [],
    additionalAllowedSpellNames: [],
    restrictToCommon: true,
  };
}

export function clericPreparedChoice(slotId: string): SpellChoiceMeta {
  return clericSpellChoice(slotId, 1, 1, 1, false);
}

export function wizardSpellChoice(
  slotId: string,
  count: number,
  minRank: number,
  maxRank: number,
  cantrip: boolean
): SpellChoiceMeta {
  return {
    slotId,
    sourcePackId: "pf2e.classfeatures",
    sourceDocumentId: "wizard-spellcasting",
    sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
    sourceName: "Wizard Spellcasting",
    classSlug: "wizard",
    dependsOn: "class",
    destination: {
      type: "spellbook",
      key: "wizard-arcane-prepared",
      label: "Wizard spellbook",
      entryName: "Arcane Prepared Spells",
      tradition: "arcane",
      ability: "int",
      prepared: "prepared",
    },
    count,
    minRank,
    maxRank,
    cantrip,
    curriculumSpellNames: [],
    additionalAllowedSpellNames: [],
    restrictToCommon: false,
  };
}
