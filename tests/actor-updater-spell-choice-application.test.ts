import { describe, expect, it, vi } from "vitest";
import { applySpellChoiceDraft } from "../src/actor-updater/spell-choice-application";
import { createEmptyDraft } from "../src/draft-service";
import {
  buildActorHarness,
  clericSpellChoice,
  selection,
  setGamePacks,
  spellChoiceStep,
  wizardSpellChoice,
} from "./support/actor-updater-fixtures";

describe("actor-updater spell choice application", () => {
  it("creates a prepared spellcasting entry and assigns cleric cantrips and spells into prepared slots", async () => {
    const { actor } = buildActorHarness();

    setGamePacks({
      "pf2e.spells-srd": {
        daze: {
          name: "Daze",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: ["cantrip"],
            },
          },
        },
        guidance: {
          name: "Guidance",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: ["cantrip"],
            },
          },
        },
        light: {
          name: "Light",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: ["cantrip"],
            },
          },
        },
        "read-aura": {
          name: "Read Aura",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: ["cantrip"],
            },
          },
        },
        "divine-lance": {
          name: "Divine Lance",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: ["cantrip"],
            },
          },
        },
        bless: {
          name: "Bless",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
        bane: {
          name: "Bane",
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
    draft.spellChoices["spell-choice-cleric-cantrips-level-1"] = [
      selection("spell-choice-cleric-cantrips-level-1", "pf2e.spells-srd", "daze", "spell", "Daze"),
      selection("spell-choice-cleric-cantrips-level-1", "pf2e.spells-srd", "guidance", "spell", "Guidance"),
      selection("spell-choice-cleric-cantrips-level-1", "pf2e.spells-srd", "light", "spell", "Light"),
      selection("spell-choice-cleric-cantrips-level-1", "pf2e.spells-srd", "read-aura", "spell", "Read Aura"),
      selection("spell-choice-cleric-cantrips-level-1", "pf2e.spells-srd", "divine-lance", "spell", "Divine Lance"),
    ];
    draft.spellChoices["spell-choice-cleric-rank-1-level-1"] = [
      selection("spell-choice-cleric-rank-1-level-1", "pf2e.spells-srd", "bless", "spell", "Bless"),
      selection("spell-choice-cleric-rank-1-level-1", "pf2e.spells-srd", "bane", "spell", "Bane"),
    ];

    await applySpellChoiceDraft(actor as any, draft, [
      spellChoiceStep(
        "spell-choice-cleric-cantrips-level-1",
        clericSpellChoice("spell-choice-cleric-cantrips-level-1", 5, 0, 0, true),
        "Cleric prepared cantrips"
      ),
      spellChoiceStep(
        "spell-choice-cleric-rank-1-level-1",
        clericSpellChoice("spell-choice-cleric-rank-1-level-1", 2, 1, 1, false),
        "Cleric prepared spells"
      ),
    ]);

    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Divine Prepared Spells",
        type: "spellcastingEntry",
      }),
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenLastCalledWith("Item", [
      expect.objectContaining({
        _id: "created-1",
        "system.slots": expect.objectContaining({
          slot0: expect.objectContaining({
            prepared: [
              { id: "created-2", expended: false },
              { id: "created-3", expended: false },
              { id: "created-4", expended: false },
              { id: "created-5", expended: false },
              { id: "created-6", expended: false },
            ],
          }),
          slot1: expect.objectContaining({
            prepared: [
              { id: "created-7", expended: false },
              { id: "created-8", expended: false },
            ],
          }),
        }),
      }),
    ]);
  });

  it("creates a wizard spellcasting entry and adds drafted spell choices without duplicates", async () => {
    const { actor, createdItems } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Wizard",
          system: {
            keyAbility: {
              value: ["int"],
              selected: "int",
            },
          },
        },
      ],
    });

    setGamePacks({
      "pf2e.spells-srd": {
        shield: {
          name: "Shield",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["arcane"],
              value: ["cantrip"],
            },
          },
        },
        "magic-missile": {
          name: "Magic Missile",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["arcane"],
              value: [],
            },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-wizard-spellbook-cantrips-level-1"] = [
      selection("spell-choice-wizard-spellbook-cantrips-level-1", "pf2e.spells-srd", "shield", "spell", "Shield"),
    ];
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      selection(
        "spell-choice-wizard-spellbook-rank-1-level-1",
        "pf2e.spells-srd",
        "magic-missile",
        "spell",
        "Magic Missile"
      ),
    ];

    const cantripStep = spellChoiceStep(
      "spell-choice-wizard-spellbook-cantrips-level-1",
      wizardSpellChoice("spell-choice-wizard-spellbook-cantrips-level-1", 10, 0, 0, true),
      "Wizard spellbook cantrips"
    );
    const rankOneStep = spellChoiceStep(
      "spell-choice-wizard-spellbook-rank-1-level-1",
      wizardSpellChoice("spell-choice-wizard-spellbook-rank-1-level-1", 5, 1, 1, false),
      "Wizard spellbook spells"
    );

    await applySpellChoiceDraft(actor as any, draft, [cantripStep, rankOneStep]);

    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Arcane Prepared Spells",
        type: "spellcastingEntry",
        flags: {
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            destinationKey: "wizard-arcane-prepared",
          },
        },
        system: expect.objectContaining({
          showSlotlessLevels: {
            value: true,
          },
          slots: expect.objectContaining({
            slot0: expect.objectContaining({
              max: 6,
              value: 6,
            }),
            slot1: expect.objectContaining({
              max: 3,
              value: 3,
            }),
          }),
        }),
      }),
    ]);

    await applySpellChoiceDraft(actor as any, draft, [cantripStep, rankOneStep]);

    expect(
      createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.spells-srd.Item.magic-missile")
    ).toHaveLength(1);
    expect(createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.spells-srd.Item.shield")).toHaveLength(1);
  });

  it("preserves existing prepared spells when repairing a wizard spellcasting entry", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Wizard",
          system: {
            keyAbility: {
              value: ["int"],
              selected: "int",
            },
          },
        },
        {
          id: "entry-1",
          type: "spellcastingEntry",
          name: "Arcane Prepared Spells",
          flags: {
            "pf2e-wayfinder": {
              destinationKey: "wizard-arcane-prepared",
              importedBy: "pf2e-wayfinder",
            },
          },
          system: {
            ability: { value: "int" },
            prepared: { value: "prepared", flexible: false },
            tradition: { value: "arcane" },
            showSlotlessLevels: { value: true },
            slots: {
              slot0: {
                max: 6,
                value: 6,
                prepared: Array.from({ length: 6 }, (_, index) => ({
                  id: index === 0 ? "spell-cantrip-1" : null,
                  expended: false,
                })),
              },
              slot1: {
                max: 3,
                value: 3,
                prepared: [
                  { id: "spell-rank-1", expended: true },
                  { id: null, expended: false },
                  { id: null, expended: false },
                ],
              },
            },
          },
        },
      ],
    });
    actor.updateEmbeddedDocuments = updateEmbeddedDocuments;

    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      selection(
        "spell-choice-wizard-spellbook-rank-1-level-1",
        "pf2e.spells-srd",
        "magic-missile",
        "spell",
        "Magic Missile"
      ),
    ];

    setGamePacks({
      "pf2e.spells-srd": {
        "magic-missile": {
          name: "Magic Missile",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["arcane"],
              value: [],
            },
          },
        },
      },
    });

    await applySpellChoiceDraft(actor as any, draft, [
      spellChoiceStep(
        "spell-choice-wizard-spellbook-rank-1-level-1",
        wizardSpellChoice("spell-choice-wizard-spellbook-rank-1-level-1", 5, 1, 1, false),
        "Wizard spellbook spells"
      ),
    ]);

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "entry-1",
        "system.slots": expect.objectContaining({
          slot0: expect.objectContaining({
            prepared: Array.from({ length: 6 }, (_, index) => ({
              id: index === 0 ? "spell-cantrip-1" : null,
              expended: false,
            })),
          }),
          slot1: expect.objectContaining({
            prepared: [
              { id: "spell-rank-1", expended: true },
              { id: null, expended: false },
              { id: null, expended: false },
            ],
          }),
        }),
      }),
    ]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        name: "Magic Missile",
        type: "spell",
        system: expect.objectContaining({
          location: {
            value: "entry-1",
          },
        }),
      }),
    ]);
  });

  it("replaces obsolete spellbook imports for the same wayfinder slot on reapply", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Wizard",
          system: {
            keyAbility: {
              value: ["int"],
              selected: "int",
            },
          },
        },
        {
          id: "entry-1",
          type: "spellcastingEntry",
          name: "Arcane Prepared Spells",
          flags: {
            "pf2e-wayfinder": {
              destinationKey: "wizard-arcane-prepared",
              importedBy: "pf2e-wayfinder",
            },
          },
          system: {
            ability: { value: "int" },
            prepared: { value: "prepared", flexible: false },
            tradition: { value: "arcane" },
            showSlotlessLevels: { value: true },
            slots: {
              slot0: {
                max: 6,
                value: 6,
                prepared: Array.from({ length: 6 }, () => ({ id: null, expended: false })),
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
          id: "old-spell-1",
          type: "spell",
          name: "Old Curriculum Spell",
          sourceId: "Compendium.pf2e.spells-srd.Item.old-curriculum-spell",
          flags: {
            core: {
              sourceId: "Compendium.pf2e.spells-srd.Item.old-curriculum-spell",
            },
            "pf2e-wayfinder": {
              slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
            },
          },
          system: {
            location: { value: "entry-1" },
            level: { value: 1 },
            traits: {
              traditions: ["arcane"],
              value: [],
            },
          },
        },
      ],
    });

    setGamePacks({
      "pf2e.spells-srd": {
        "new-curriculum-spell": {
          name: "New Curriculum Spell",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["arcane"],
              value: [],
            },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-wizard-curriculum-rank-1-level-1"] = [
      selection(
        "spell-choice-wizard-curriculum-rank-1-level-1",
        "pf2e.spells-srd",
        "new-curriculum-spell",
        "spell",
        "New Curriculum Spell"
      ),
    ];

    await applySpellChoiceDraft(actor as any, draft, [
      spellChoiceStep(
        "spell-choice-wizard-curriculum-rank-1-level-1",
        {
          ...wizardSpellChoice("spell-choice-wizard-curriculum-rank-1-level-1", 2, 1, 1, false),
          dependsOn: "class-branch",
          curriculumSpellNames: ["New Curriculum Spell"],
        },
        "Arcane school curriculum spells"
      ),
    ]);

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["old-spell-1"]);
    expect(actor.createEmbeddedDocuments).toHaveBeenLastCalledWith("Item", [
      expect.objectContaining({
        name: "New Curriculum Spell",
        type: "spell",
      }),
    ]);
  });

  it("creates unified-theory wizard spellcasting entries without curriculum slot bonuses", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Wizard",
          system: {
            keyAbility: {
              value: ["int"],
              selected: "int",
            },
          },
        },
      ],
    });

    setGamePacks({
      "pf2e.spells-srd": {
        "magic-missile": {
          name: "Magic Missile",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["arcane"],
              value: [],
            },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "pf2e.classfeatures",
      "xYYhJtGhFSWNifcO",
      "feat",
      "School of Unified Magical Theory",
      "classfeature"
    );
    draft.spellChoices["spell-choice-wizard-unified-rank-1-level-1"] = [
      selection(
        "spell-choice-wizard-unified-rank-1-level-1",
        "pf2e.spells-srd",
        "magic-missile",
        "spell",
        "Magic Missile"
      ),
    ];

    await applySpellChoiceDraft(actor as any, draft, [
      spellChoiceStep(
        "spell-choice-wizard-unified-rank-1-level-1",
        wizardSpellChoice("spell-choice-wizard-unified-rank-1-level-1", 1, 1, 1, false),
        "Unified theory bonus spell"
      ),
    ]);

    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Arcane Prepared Spells",
        type: "spellcastingEntry",
        system: expect.objectContaining({
          slots: expect.objectContaining({
            slot0: expect.objectContaining({
              max: 5,
              value: 5,
            }),
            slot1: expect.objectContaining({
              max: 2,
              value: 2,
            }),
          }),
        }),
      }),
    ]);
  });

  it("clamps existing spell slot values when wizard entry capacity shrinks", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const { actor } = buildActorHarness({
      items: [
        {
          id: "class-1",
          type: "class",
          name: "Wizard",
          system: {
            keyAbility: {
              value: ["int"],
              selected: "int",
            },
          },
        },
        {
          id: "entry-1",
          type: "spellcastingEntry",
          name: "Arcane Prepared Spells",
          flags: {
            "pf2e-wayfinder": {
              destinationKey: "wizard-arcane-prepared",
              importedBy: "pf2e-wayfinder",
            },
          },
          system: {
            ability: { value: "int" },
            prepared: { value: "prepared", flexible: false },
            tradition: { value: "arcane" },
            showSlotlessLevels: { value: true },
            slots: {
              slot0: {
                max: 6,
                value: 6,
                prepared: Array.from({ length: 6 }, () => ({ id: null, expended: false })),
              },
              slot1: {
                max: 3,
                value: 3,
                prepared: Array.from({ length: 3 }, () => ({ id: null, expended: false })),
              },
            },
          },
        },
      ],
    });
    actor.updateEmbeddedDocuments = updateEmbeddedDocuments;

    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "pf2e.classfeatures",
      "xYYhJtGhFSWNifcO",
      "feat",
      "School of Unified Magical Theory",
      "classfeature"
    );
    draft.spellChoices["spell-choice-wizard-unified-rank-1-level-1"] = [
      selection(
        "spell-choice-wizard-unified-rank-1-level-1",
        "pf2e.spells-srd",
        "magic-missile",
        "spell",
        "Magic Missile"
      ),
    ];

    await applySpellChoiceDraft(actor as any, draft, [
      spellChoiceStep(
        "spell-choice-wizard-unified-rank-1-level-1",
        wizardSpellChoice("spell-choice-wizard-unified-rank-1-level-1", 1, 1, 1, false),
        "Unified theory bonus spell"
      ),
    ]);

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "entry-1",
        "system.slots": expect.objectContaining({
          slot0: expect.objectContaining({
            max: 5,
            value: 5,
          }),
          slot1: expect.objectContaining({
            max: 2,
            value: 2,
          }),
        }),
      }),
    ]);
  });
});
