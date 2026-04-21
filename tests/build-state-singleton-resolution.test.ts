import { beforeEach, describe, expect, it } from "vitest";
import { getEffectiveSingletonDocument } from "../src/build-state/singleton-resolution";
import { createEmptyDraft } from "../src/draft-service";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("build-state singleton resolution", () => {
  beforeEach(() => {
    testGlobals.game = {
      packs: new Map(),
    } as any;
  });

  it("prefers a drafted singleton document over the actor item", async () => {
    setPack("pf2e.ancestries", {
      human: {
        name: "Draft Human",
        type: "ancestry",
        toObject: () => structuredClone({ name: "Draft Human", type: "ancestry" }),
      },
    });

    const actor = {
      items: {
        contents: [
          {
            type: "ancestry",
            name: "Actor Human",
          },
        ],
      },
    };
    const draft = createEmptyDraft(1);
    draft.selections["ancestry-level-1"] = selection("pf2e.ancestries", "human", "Draft Human", "ancestry");

    const result = await getEffectiveSingletonDocument(actor, draft, "ancestry");

    expect(result?.name).toBe("Draft Human");
  });

  it("falls back to the actor item when no draft singleton exists", async () => {
    const actor = {
      items: {
        contents: [
          {
            type: "background",
            name: "Actor Background",
            system: {
              boosts: {
                free: {
                  value: ["str", "dex"],
                  selected: "str",
                },
              },
            },
          },
        ],
      },
    };

    const result = await getEffectiveSingletonDocument(actor, createEmptyDraft(1), "background");

    expect(result).toEqual({
      type: "background",
      name: "Actor Background",
      system: {
        boosts: {
          free: {
            value: ["str", "dex"],
            selected: "str",
          },
        },
      },
    });
  });
});

function setPack(id: string, documents: Record<string, any>): void {
  testGlobals.game.packs.set(id, {
    metadata: { id },
    async getDocument(documentId: string) {
      return documents[documentId] ?? null;
    },
  });
}

function selection(packId: string, documentId: string, name: string, itemType: string) {
  return {
    slotId: `${itemType}-level-1`,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType: null,
    name,
    level: 1,
  };
}
