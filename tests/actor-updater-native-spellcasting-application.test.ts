import { describe, expect, it, vi } from "vitest";
import { syncNativeClassSpellcasting } from "../src/actor-updater/native-spellcasting-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import { buildActorHarness, setGamePacks } from "./support/actor-updater-fixtures";

describe("actor-updater native spellcasting application", () => {
  it("creates cleric prepared and divine font spellcasting entries from chosen font state", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Cleric",
          system: {
            slug: "cleric",
            keyAbility: {
              value: ["wis"],
              selected: "wis",
            },
          },
        },
        {
          id: "deity-1",
          type: "deity",
          name: "Gorum",
          system: {
            font: ["heal", "harm"],
          },
        },
      ],
    });

    setGamePacks({
      "pf2e.spells-srd": {
        rfZpqmj0AIIdkVIs: {
          name: "Heal",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
        wdA52JJnsuQWeyqz: {
          name: "Harm",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    await syncNativeClassSpellcasting(actor as any, draft);

    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Divine Prepared Spells",
        type: "spellcastingEntry",
        flags: {
          [MODULE_ID]: {
            importedBy: MODULE_ID,
            destinationKey: "cleric-divine-prepared",
          },
        },
        system: expect.objectContaining({
          slots: expect.objectContaining({
            slot0: expect.objectContaining({
              max: 5,
              value: 5,
              prepared: Array.from({ length: 5 }, () => ({ id: null, expended: false })),
            }),
            slot1: expect.objectContaining({
              max: 2,
              value: 2,
              prepared: Array.from({ length: 2 }, () => ({ id: null, expended: false })),
            }),
          }),
        }),
      }),
    ]);
    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      expect.objectContaining({
        name: "Divine Font (Harmful)",
        type: "spellcastingEntry",
        flags: {
          [MODULE_ID]: {
            importedBy: MODULE_ID,
            destinationKey: "cleric-divine-font-harm",
          },
        },
      }),
    ]);
    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(3, "Item", [
      expect.objectContaining({
        name: "Harm",
        type: "spell",
        system: expect.objectContaining({
          location: {
            value: "created-2",
          },
        }),
      }),
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "created-2",
        "system.slots": {
          slot1: {
            max: 4,
            value: 4,
            prepared: Array.from({ length: 4 }, () => ({ id: "created-3", expended: false })),
          },
        },
      }),
    ]);
  });

  it("repairs cleric entries without wiping prepared spells and scales divine font by level", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const { actor } = buildActorHarness({
      level: 5,
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Cleric",
          system: {
            slug: "cleric",
            keyAbility: {
              value: ["wis"],
              selected: "wis",
            },
          },
        },
        {
          id: "deity-1",
          type: "deity",
          name: "Gorum",
          system: {
            font: ["heal", "harm"],
          },
        },
        {
          id: "entry-main",
          type: "spellcastingEntry",
          name: "Divine Prepared Spells",
          flags: {
            [MODULE_ID]: {
              importedBy: MODULE_ID,
              destinationKey: "cleric-divine-prepared",
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
                prepared: [
                  { id: "cantrip-1", expended: false },
                  { id: null, expended: false },
                  { id: null, expended: false },
                  { id: null, expended: false },
                  { id: null, expended: false },
                ],
              },
              slot1: {
                max: 3,
                value: 3,
                prepared: [
                  { id: "spell-1", expended: true },
                  { id: null, expended: false },
                  { id: null, expended: false },
                ],
              },
              slot2: {
                max: 2,
                value: 2,
                prepared: [
                  { id: "spell-2", expended: false },
                  { id: null, expended: false },
                ],
              },
            },
          },
        },
        {
          id: "entry-font",
          type: "spellcastingEntry",
          name: "Divine Font (Healing)",
          flags: {
            [MODULE_ID]: {
              importedBy: MODULE_ID,
              destinationKey: "cleric-divine-font-heal",
            },
          },
          system: {
            ability: { value: "wis" },
            prepared: { value: "prepared", flexible: false },
            tradition: { value: "divine" },
            showSlotlessLevels: { value: false },
            slots: {
              slot3: {
                max: 4,
                value: 4,
                prepared: [
                  { id: "font-heal-1", expended: true },
                  { id: "font-heal-1", expended: false },
                  { id: "font-heal-1", expended: false },
                  { id: "font-heal-1", expended: false },
                ],
              },
            },
          },
        },
        {
          id: "font-heal-1",
          type: "spell",
          name: "Heal",
          flags: {
            core: {
              sourceId: "Compendium.pf2e.spells-srd.Item.rfZpqmj0AIIdkVIs",
            },
          },
          system: {
            location: { value: "entry-font" },
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
      ],
    });
    actor.updateEmbeddedDocuments = updateEmbeddedDocuments;

    const draft = createEmptyDraft(5);
    draft.targetLevel = 5;
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "heal";

    await syncNativeClassSpellcasting(actor as any, draft);

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "entry-main",
        "system.slots": expect.objectContaining({
          slot0: expect.objectContaining({
            prepared: [
              { id: "cantrip-1", expended: false },
              { id: null, expended: false },
              { id: null, expended: false },
              { id: null, expended: false },
              { id: null, expended: false },
            ],
          }),
          slot1: expect.objectContaining({
            max: 3,
            prepared: [
              { id: "spell-1", expended: true },
              { id: null, expended: false },
              { id: null, expended: false },
            ],
          }),
          slot2: expect.objectContaining({
            max: 3,
            prepared: [
              { id: "spell-2", expended: false },
              { id: null, expended: false },
              { id: null, expended: false },
            ],
          }),
          slot3: expect.objectContaining({
            max: 2,
            prepared: [
              { id: null, expended: false },
              { id: null, expended: false },
            ],
          }),
        }),
      }),
    ]);
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "entry-font",
        "system.slots": {
          slot3: {
            max: 5,
            value: 5,
            prepared: [
              { id: "font-heal-1", expended: true },
              { id: "font-heal-1", expended: false },
              { id: "font-heal-1", expended: false },
              { id: "font-heal-1", expended: false },
              { id: "font-heal-1", expended: false },
            ],
          },
        },
      }),
    ]);
  });

  it("repairs a cleric divine font entry and replaces obsolete font spells", async () => {
    const { actor } = buildActorHarness({
      items: [
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
      ],
    });

    setGamePacks({
      "pf2e.spells-srd": {
        rfZpqmj0AIIdkVIs: {
          name: "Heal",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
      },
    });

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
