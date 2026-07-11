import { describe, expect, it, vi } from "vitest";
import { syncNativeClassSpellcasting } from "../src/actor-updater/native-spellcasting-application";
import { spellLocationId } from "../src/actor-updater/spellcasting-entry-support";
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

  it.each([
    [1, { slot0: 5, slot1: 1 }, 1, 4],
    [2, { slot0: 5, slot1: 2 }, 1, 4],
    [3, { slot0: 5, slot1: 2, slot2: 1 }, 2, 4],
    [4, { slot0: 5, slot1: 2, slot2: 2 }, 2, 4],
    [5, { slot0: 5, slot2: 2, slot3: 2 }, 3, 5],
  ] as const)("builds Battle Creed prepared slots and Battle Font at target level %i", async (targetLevel, expectedPreparedSlots, fontRank, fontCount) => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Cleric",
          system: { slug: "cleric", keyAbility: { selected: "wis" } },
        },
        {
          id: "battle-creed-1",
          type: "feat",
          name: "Battle Creed",
          sourceId: "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5",
          system: { slug: "battle-creed", category: "classfeature" },
        },
      ],
    });
    setGamePacks({
      "pf2e.spells-srd": {
        "7ZinJNzxq0XF0oMx": {
          name: "Bane",
          type: "spell",
          system: { level: { value: 1 }, traits: { traditions: ["divine"], value: [] } },
        },
        XSujb7EsSwKl19Uu: {
          name: "Bless",
          type: "spell",
          system: { level: { value: 1 }, traits: { traditions: ["divine"], value: [] } },
        },
      },
    });
    const draft = createEmptyDraft(targetLevel);

    await syncNativeClassSpellcasting(actor as any, draft);

    const preparedEntry = actor.items.contents.find(
      (item) => item.flags?.[MODULE_ID]?.destinationKey === "cleric-divine-prepared"
    );
    const battleFont = actor.items.contents.find(
      (item) => item.flags?.[MODULE_ID]?.destinationKey === "cleric-battle-font"
    );
    expect(
      Object.fromEntries(
        Object.entries(preparedEntry?.system?.slots ?? {}).map(([slotKey, group]) => [slotKey, group.max])
      )
    ).toEqual(expectedPreparedSlots);
    expect(battleFont).toMatchObject({
      name: "Battle Font",
      system: {
        proficiency: { slug: "cleric" },
        slots: {
          [`slot${fontRank}`]: {
            max: fontCount,
            value: fontCount,
            prepared: Array.from({ length: fontCount }, () => ({ id: null, expended: false })),
          },
        },
      },
    });
    const fontSpells = actor.items.contents.filter(
      (item) => item.type === "spell" && spellLocationId(item) === battleFont?.id
    );
    expect(fontSpells.map((item) => item.sourceId).sort()).toEqual([
      "Compendium.pf2e.spells-srd.Item.7ZinJNzxq0XF0oMx",
      "Compendium.pf2e.spells-srd.Item.XSujb7EsSwKl19Uu",
    ]);
    expect(actor.items.contents.some((item) => String(item.name).startsWith("Divine Font ("))).toBe(false);
  });

  it("zeros obsolete Battle Creed ranks when an existing level-1 entry advances to level 5", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Cleric",
          system: { slug: "cleric", keyAbility: { selected: "wis" } },
        },
        {
          id: "battle-creed-1",
          type: "feat",
          name: "Battle Creed",
          sourceId: "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5",
          system: { slug: "battle-creed", category: "classfeature" },
        },
        {
          id: "prepared-1",
          type: "spellcastingEntry",
          name: "Divine Prepared Spells",
          flags: { [MODULE_ID]: { destinationKey: "cleric-divine-prepared", importedBy: MODULE_ID } },
          system: {
            prepared: { value: "prepared", flexible: false },
            tradition: { value: "divine" },
            slots: {
              slot0: { max: 5, value: 5, prepared: Array.from({ length: 5 }, () => ({ id: null })) },
              slot1: { max: 1, value: 1, prepared: [{ id: null }] },
            },
          },
        },
        {
          id: "font-1",
          type: "spellcastingEntry",
          name: "Battle Font",
          flags: { [MODULE_ID]: { destinationKey: "cleric-battle-font", importedBy: MODULE_ID } },
          system: {
            prepared: { value: "prepared", flexible: false },
            tradition: { value: "divine" },
            slots: {
              slot1: { max: 4, value: 4, prepared: Array.from({ length: 4 }, () => ({ id: null })) },
            },
          },
        },
      ],
    });
    setGamePacks({
      "pf2e.spells-srd": {
        "7ZinJNzxq0XF0oMx": {
          name: "Bane",
          type: "spell",
          system: { level: { value: 1 }, traits: { traditions: ["divine"], value: [] } },
        },
        XSujb7EsSwKl19Uu: {
          name: "Bless",
          type: "spell",
          system: { level: { value: 1 }, traits: { traditions: ["divine"], value: [] } },
        },
      },
    });

    await syncNativeClassSpellcasting(actor as any, createEmptyDraft(5));

    const prepared = actor.items.contents.find((item) => item.id === "prepared-1");
    const font = actor.items.contents.find((item) => item.id === "font-1");
    expect(prepared?.system?.slots).toMatchObject({
      slot1: { max: 0, value: 0, prepared: [] },
      slot2: { max: 2 },
      slot3: { max: 2 },
    });
    expect(font?.system?.slots).toMatchObject({
      slot1: { max: 0, value: 0, prepared: [] },
      slot3: { max: 5 },
    });
  });

  it("preserves valid Battle Font preparation and clears foreign prepared spell ids on rerun", async () => {
    const { actor } = buildActorHarness({
      level: 5,
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Cleric",
          system: { slug: "cleric", keyAbility: { selected: "wis" } },
        },
        {
          id: "battle-creed-1",
          type: "feat",
          name: "Battle Creed",
          sourceId: "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5",
          system: { slug: "battle-creed", category: "classfeature" },
        },
      ],
    });
    setGamePacks({
      "pf2e.spells-srd": {
        "7ZinJNzxq0XF0oMx": { name: "Bane", type: "spell", system: { level: { value: 1 } } },
        XSujb7EsSwKl19Uu: { name: "Bless", type: "spell", system: { level: { value: 1 } } },
      },
    });
    const draft = createEmptyDraft(5);

    await syncNativeClassSpellcasting(actor as any, draft);
    const battleFont = actor.items.contents.find(
      (item) => item.flags?.[MODULE_ID]?.destinationKey === "cleric-battle-font"
    )!;
    const bane = actor.items.contents.find(
      (item) => item.sourceId === "Compendium.pf2e.spells-srd.Item.7ZinJNzxq0XF0oMx"
    )!;
    battleFont.system!.slots!.slot3.prepared = [
      { id: bane.id!, expended: true },
      { id: "foreign-spell", expended: true },
      { id: null, expended: false },
      { id: null, expended: false },
      { id: null, expended: false },
    ];

    await syncNativeClassSpellcasting(actor as any, createEmptyDraft(5));

    expect(battleFont.system?.slots?.slot3.prepared).toEqual([
      { id: bane.id, expended: true },
      { id: null, expended: false },
      { id: null, expended: false },
      { id: null, expended: false },
      { id: null, expended: false },
    ]);
    expect(
      actor.items.contents.filter((item) => item.type === "spell" && spellLocationId(item) === battleFont.id)
    ).toHaveLength(2);
  });
});
