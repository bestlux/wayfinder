import { describe, expect, it, vi } from "vitest";
import { applySpellChoiceDraft } from "../src/actor-updater/spell-choice-application";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef, SpellChoiceMeta } from "../src/types";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("actor-updater spell choice application", () => {
  it("creates a prepared spellcasting entry and assigns drafted spells into prepared slots", async () => {
    const createdItems: any[] = [];
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
          },
        },
      },
      items: {
        contents: [] as any[],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) => {
        const created = sources.map((source, index) => {
          const item = {
            id: `created-${createdItems.length + index + 1}`,
            type: source.type,
            name: source.name,
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
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              if (documentId !== "bless") {
                return null;
              }

              return {
                id: documentId,
                name: "Bless",
                toObject: () => ({
                  name: "Bless",
                  type: "spell",
                  system: {
                    level: { value: 1 },
                    traits: {
                      traditions: ["divine"],
                      value: [],
                    },
                  },
                }),
              };
            },
          },
        ],
      ]),
    } as any;

    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-cleric-rank-1-level-1"] = [
      selection("spell-choice-cleric-rank-1-level-1", "bless", "Bless"),
    ];

    await applySpellChoiceDraft(actor as any, draft, [
      spellChoiceStep("spell-choice-cleric-rank-1-level-1", clericPreparedChoice("spell-choice-cleric-rank-1-level-1")),
    ]);

    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Divine Prepared Spells",
        type: "spellcastingEntry",
      }),
    ]);
    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      expect.objectContaining({
        name: "Bless",
        type: "spell",
        system: expect.objectContaining({
          location: {
            value: "created-1",
          },
        }),
      }),
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "created-1",
        "system.slots": expect.objectContaining({
          slot1: expect.objectContaining({
            prepared: [
              { id: "created-2", expended: false },
              { id: null, expended: false },
            ],
          }),
        }),
      }),
    ]);
  });
});

function spellChoiceStep(slotId: string, spellChoice: SpellChoiceMeta): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Prepared spell",
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "spell",
    },
    spellChoice,
  };
}

function clericPreparedChoice(slotId: string): SpellChoiceMeta {
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
    count: 1,
    minRank: 1,
    maxRank: 1,
    cantrip: false,
    curriculumSpellNames: [],
    additionalAllowedSpellNames: [],
    restrictToCommon: true,
  };
}

function selection(slotId: string, documentId: string, name: string): SelectionRef {
  return {
    slotId,
    packId: "pf2e.spells-srd",
    documentId,
    uuid: `Compendium.pf2e.spells-srd.Item.${documentId}`,
    itemType: "spell",
    featType: null,
    name,
    level: 1,
  };
}
