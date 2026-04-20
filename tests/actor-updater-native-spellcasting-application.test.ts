import { describe, expect, it, vi } from "vitest";
import { syncNativeClassSpellcasting } from "../src/actor-updater/native-spellcasting-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("actor-updater native spellcasting application", () => {
  it("repairs a cleric divine font entry and replaces obsolete font spells", async () => {
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
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Cleric",
            system: {
              slug: "cleric",
              keyAbility: {
                selected: "wis",
              },
            },
          },
          {
            id: "prepared-1",
            type: "spellcastingEntry",
            name: "Divine Prepared Spells",
            flags: {
              [MODULE_ID]: {
                destinationKey: "cleric-divine-prepared",
                importedBy: MODULE_ID,
              },
            },
            system: {
              ability: { value: "wis" },
              prepared: { value: "prepared", flexible: false },
              tradition: { value: "divine" },
              showSlotlessLevels: { value: true },
              slots: {
                slot0: {
                  max: 5,
                  value: 5,
                  prepared: Array.from({ length: 5 }, () => ({ id: null, expended: false })),
                },
                slot1: {
                  max: 3,
                  value: 3,
                  prepared: Array.from({ length: 3 }, () => ({ id: null, expended: false })),
                },
              },
            },
          },
          {
            id: "font-entry-1",
            type: "spellcastingEntry",
            name: "Divine Font (Harmful)",
            flags: {
              [MODULE_ID]: {
                destinationKey: "cleric-divine-font-harm",
                importedBy: MODULE_ID,
              },
            },
            system: {
              ability: { value: "wis" },
              prepared: { value: "prepared", flexible: false },
              tradition: { value: "divine" },
              showSlotlessLevels: { value: false },
              slots: {
                slot1: {
                  max: 4,
                  value: 4,
                  prepared: Array.from({ length: 4 }, () => ({ id: "harm-spell-1", expended: false })),
                },
              },
            },
          },
          {
            id: "harm-spell-1",
            type: "spell",
            name: "Harm",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.spells-srd.Item.wdA52JJnsuQWeyqz",
              },
            },
            system: {
              location: { value: "font-entry-1" },
              level: { value: 1 },
              traits: {
                traditions: ["divine"],
                value: [],
              },
            },
          },
        ] as any[],
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
      deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
        actor.items.contents = actor.items.contents.filter((item: any) => !ids.includes(item.id));
        return [];
      }),
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              if (documentId !== "rfZpqmj0AIIdkVIs") {
                return null;
              }

              return {
                id: documentId,
                name: "Heal",
                toObject: () => ({
                  name: "Heal",
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
    draft.classChoices["class-choice-cleric-divine-font-level-1"] = "heal";

    await syncNativeClassSpellcasting(actor as any, draft);

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["harm-spell-1"]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        name: "Heal",
        type: "spell",
        system: expect.objectContaining({
          location: {
            value: "font-entry-1",
          },
        }),
      }),
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "font-entry-1",
        [`flags.${MODULE_ID}.destinationKey`]: "cleric-divine-font-heal",
      }),
    ]);
  });
});
