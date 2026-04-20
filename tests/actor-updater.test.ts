import { describe, expect, it, vi } from "vitest";
import { applyDraftToActor } from "../src/actor-updater";
import { createEmptyDraft } from "../src/draft-service";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("actor-updater", () => {
  it("writes drafted boost state back to PF2E item and actor fields on apply", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const update = vi.fn(async () => ({}));
    const actor = {
      system: {
        details: {
          level: {
            value: 5,
          },
        },
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "wis"],
              5: [],
              10: [],
              15: [],
              20: [],
            },
          },
        },
      },
      items: {
        contents: [ancestryItem(), backgroundItem(), classItem()],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update,
    };

    const draft = createEmptyDraft(5);
    draft.boosts.ancestry.modeTouched = true;
    draft.boosts.ancestry.mode = "alternate";
    draft.boosts.ancestry.alternateBoosts = ["dex", "int"];
    draft.boosts.ancestry.voluntary = {
      touched: true,
      enabled: true,
      legacy: true,
      boost: "cha",
      flaws: ["str", "str"],
    };
    draft.boosts.background.selectedBoosts = {
      restricted: "dex",
      free: "wis",
    };
    draft.boosts.class.keyAbility = "wis";
    draft.boosts.levels["5"] = ["str", "dex", "int", "cha"];

    await applyDraftToActor(actor as any, draft, []);

    expect(updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "ancestry-1",
        "system.alternateAncestryBoosts": ["dex", "int"],
        "system.boosts.fixed.selected": "con",
        "system.boosts.free.selected": null,
        "system.voluntary.flaws": ["str", "str"],
        "system.voluntary.boost": "cha",
      },
      {
        _id: "background-1",
        "system.boosts.restricted.selected": "dex",
        "system.boosts.free.selected": "wis",
      },
      {
        _id: "class-1",
        "system.keyAbility.selected": "wis",
      },
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      "system.build.attributes.boosts.1": ["str", "dex", "con", "wis"],
      "system.build.attributes.boosts.5": ["str", "dex", "int", "cha"],
      "system.build.attributes.boosts.10": [],
      "system.build.attributes.boosts.15": [],
      "system.build.attributes.boosts.20": [],
    });
  });

  it("inserts drafted feats into PF2E feat slots instead of creating raw bonus feats", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const insertFeat = vi.fn(async (_item: unknown, _options: { groupId: string; slotId: string }) => [
      { id: "created-feat-1" },
    ]);
    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.feats-srd",
          {
            metadata: { id: "pf2e.feats-srd" },
            async getDocument(documentId: string) {
              if (documentId !== "adapted-cantrip") {
                return null;
              }

              return {
                id: documentId,
                name: "Adapted Cantrip",
                toObject: () => ({
                  name: "Adapted Cantrip",
                  type: "feat",
                  system: {
                    category: "ancestry",
                    level: { value: 1 },
                    location: null,
                  },
                }),
              };
            },
          },
        ],
      ]),
    } as any;

    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [],
      },
      feats: {
        get(groupId: string) {
          if (groupId !== "ancestry") {
            return null;
          }

          return {
            slots: {
              "ancestry-1": {
                id: "ancestry-1",
                level: 1,
                feat: null,
              },
            },
          };
        },
        insertFeat,
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    const draft = createEmptyDraft(1);
    draft.selections["ancestry-feat-level-1"] = {
      slotId: "ancestry-feat-level-1",
      packId: "pf2e.feats-srd",
      documentId: "adapted-cantrip",
      uuid: "Compendium.pf2e.feats-srd.Item.adapted-cantrip",
      itemType: "feat",
      featType: "ancestry",
      name: "Adapted Cantrip",
      level: 1,
    };

    await applyDraftToActor(actor as any, draft, [
      {
        id: "ancestry-feat-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "ancestry-feat",
        title: "Level 1 ancestry feat",
        description: "",
        required: true,
        slotId: "ancestry-feat-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["ancestry"],
          maxLevel: 1,
        },
      },
    ]);

    expect(insertFeat).toHaveBeenCalledTimes(1);
    expect(insertFeat.mock.calls[0]?.[1]).toEqual({
      groupId: "ancestry",
      slotId: "ancestry-1",
    });
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "created-feat-1",
        "flags.core.sourceId": "Compendium.pf2e.feats-srd.Item.adapted-cantrip",
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "ancestry-feat-level-1",
      },
    ]);
  });

  it("applies drafted skill increases in level order and stacks repeated picks", async () => {
    const update = vi.fn(async () => ({}));
    const actor = {
      system: {
        details: {
          level: {
            value: 5,
          },
        },
        skills: {
          acrobatics: { rank: 1 },
          arcana: { rank: 0 },
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
        contents: [],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      update,
    };

    const draft = createEmptyDraft(5);
    draft.skillIncreases["skill-increase-level-3"] = "acrobatics";
    draft.skillIncreases["skill-increase-level-5"] = "acrobatics";

    await applyDraftToActor(actor as any, draft, []);

    expect(update).toHaveBeenNthCalledWith(1, {
      "system.build.attributes.boosts.1": [],
      "system.build.attributes.boosts.5": [],
      "system.build.attributes.boosts.10": [],
      "system.build.attributes.boosts.15": [],
      "system.build.attributes.boosts.20": [],
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      "system.skills.acrobatics.rank": 3,
      "system.skills.arcana.rank": 0,
    });
  });

  it("applies fighter class training choices to class rules and trained skills", async () => {
    const update = vi.fn(async () => ({}));
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
          },
        },
        skills: {
          acrobatics: { rank: 0 },
          athletics: { rank: 0 },
          crafting: { rank: 0 },
          medicine: { rank: 0 },
          society: { rank: 0 },
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
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Fighter",
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "fighterSkill",
                  choices: [
                    { value: "acrobatics", label: "Acrobatics" },
                    { value: "athletics", label: "Athletics" },
                  ],
                },
                {
                  key: "ActiveEffectLike",
                  path: "system.skills.{item|flags.system.rulesSelections.fighterSkill}.rank",
                  value: 1,
                },
              ],
            },
          },
        ],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update,
    };

    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: {
        fighterSkill: "athletics",
      },
      additional: ["crafting", "medicine", "society"],
    };

    await applyDraftToActor(actor as any, draft, [
      {
        id: "skill-training-fighter-level-1",
        level: 1,
        kind: "skill-training",
        slotKind: "skill-training",
        title: "Fighter skill training",
        description: "",
        required: true,
        slotId: "skill-training-fighter-level-1",
        training: {
          classSlug: "fighter",
          className: "Fighter",
          fixedSkills: [],
          choiceRules: [
            {
              ruleIndex: 0,
              flag: "fighterSkill",
              prompt: "Choose a class skill",
              options: [
                { slug: "acrobatics", label: "Acrobatics" },
                { slug: "athletics", label: "Athletics" },
              ],
            },
          ],
          additionalCount: 3,
        },
      },
    ]);

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "class-1",
        "flags.pf2e.rulesSelections.fighterSkill": "athletics",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "fighterSkill",
            choices: [
              { value: "acrobatics", label: "Acrobatics" },
              { value: "athletics", label: "Athletics" },
            ],
            selection: "athletics",
          },
          {
            key: "ActiveEffectLike",
            path: "system.skills.{item|flags.system.rulesSelections.fighterSkill}.rank",
            value: 1,
          },
        ],
      },
    ]);
    expect(update).toHaveBeenNthCalledWith(1, {
      "system.skills.athletics.rank": 1,
      "system.skills.crafting.rank": 1,
      "system.skills.medicine.rank": 1,
      "system.skills.society.rank": 1,
    });
  });

  it("writes class-branch selections onto selector features and creates the granted branch item", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const createEmbeddedDocuments = vi.fn(async () => [{ id: "branch-child-1" }]);
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
          {
            id: "selector-1",
            type: "feat",
            sourceId: "Compendium.pf2e.classfeatures.Item.uGuCGQvUmioFV2Bd",
            flags: {
              pf2e: {
                rulesSelections: {},
                itemGrants: {},
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "roguesRacket",
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.roguesRacket}",
                },
              ],
            },
          },
        ],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.classfeatures",
          {
            metadata: { id: "pf2e.classfeatures" },
            async getDocument(documentId: string) {
              if (documentId !== "ZvfxtUMtfIOLYHyg") {
                return null;
              }

              return {
                id: documentId,
                name: "Scoundrel",
                toObject: () => ({
                  name: "Scoundrel",
                  type: "feat",
                  system: {
                    category: "classfeature",
                    level: { value: 1 },
                  },
                }),
              };
            },
          },
        ],
      ]),
    } as any;

    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-rogues-racket-level-1"] = {
      slotId: "class-branch-rogues-racket-level-1",
      packId: "pf2e.classfeatures",
      documentId: "ZvfxtUMtfIOLYHyg",
      uuid: "Compendium.pf2e.classfeatures.Item.ZvfxtUMtfIOLYHyg",
      itemType: "feat",
      featType: "classfeature",
      name: "Scoundrel",
      level: 1,
    };

    await applyDraftToActor(actor as any, draft, [
      {
        id: "class-branch-rogues-racket-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Rogue's Racket",
        description: "",
        required: true,
        slotId: "class-branch-rogues-racket-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-rogues-racket-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "uGuCGQvUmioFV2Bd",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.uGuCGQvUmioFV2Bd",
          selectorName: "Rogue's Racket",
          selectorRuleIndex: 0,
          flag: "roguesRacket",
          optionTag: "rogue-racket",
          classSlug: "rogue",
          dependsOn: "class",
        },
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Scoundrel",
        type: "feat",
        _stats: {
          compendiumSource: "Compendium.pf2e.classfeatures.Item.ZvfxtUMtfIOLYHyg",
        },
        system: {
          category: "classfeature",
          level: { value: 1 },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.ZvfxtUMtfIOLYHyg",
          },
          pf2e: {
            grantedBy: {
              id: "selector-1",
              onDelete: "cascade",
            },
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-branch-rogues-racket-level-1",
          },
        },
      },
    ]);
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "selector-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "roguesRacket",
            selection: "Compendium.pf2e.classfeatures.Item.ZvfxtUMtfIOLYHyg",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.roguesRacket}",
          },
        ],
        "flags.pf2e.rulesSelections.roguesRacket": "Compendium.pf2e.classfeatures.Item.ZvfxtUMtfIOLYHyg",
        "flags.pf2e.itemGrants.roguesRacket": {
          id: "branch-child-1",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e-wayfinder.slotId": "class-branch-rogues-racket-level-1",
      },
      {
        _id: "branch-child-1",
        "flags.core.sourceId": "Compendium.pf2e.classfeatures.Item.ZvfxtUMtfIOLYHyg",
        "flags.pf2e.grantedBy": {
          id: "selector-1",
          onDelete: "cascade",
        },
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "class-branch-rogues-racket-level-1",
      },
    ]);
  });

  it("applies both wizard branch selections onto their selector features and granted items", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    let grantedIndex = 0;
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) =>
      sources.map(() => ({ id: `wizard-branch-${++grantedIndex}` }))
    );
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
          {
            id: "selector-school",
            type: "feat",
            sourceId: "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
            flags: {
              pf2e: {
                rulesSelections: {},
                itemGrants: {},
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "arcaneSchool",
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.arcaneSchool}",
                },
              ],
            },
          },
          {
            id: "selector-thesis",
            type: "feat",
            sourceId: "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
            flags: {
              pf2e: {
                rulesSelections: {},
                itemGrants: {},
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "arcaneThesis",
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.arcaneThesis}",
                },
              ],
            },
          },
        ],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.classfeatures",
          {
            metadata: { id: "pf2e.classfeatures" },
            async getDocument(documentId: string) {
              if (documentId === "school-battle-magic") {
                return {
                  id: documentId,
                  name: "School of Battle Magic",
                  toObject: () => ({
                    name: "School of Battle Magic",
                    type: "feat",
                    system: {
                      category: "classfeature",
                      level: { value: 1 },
                    },
                  }),
                };
              }

              if (documentId === "spell-blending") {
                return {
                  id: documentId,
                  name: "Spell Blending",
                  toObject: () => ({
                    name: "Spell Blending",
                    type: "feat",
                    system: {
                      category: "classfeature",
                      level: { value: 1 },
                    },
                  }),
                };
              }

              return null;
            },
          },
        ],
      ]),
    } as any;

    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-arcane-school-level-1"] = {
      slotId: "class-branch-arcane-school-level-1",
      packId: "pf2e.classfeatures",
      documentId: "school-battle-magic",
      uuid: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
      itemType: "feat",
      featType: "classfeature",
      name: "School of Battle Magic",
      level: 1,
    };
    draft.branchSelections["class-branch-arcane-thesis-level-1"] = {
      slotId: "class-branch-arcane-thesis-level-1",
      packId: "pf2e.classfeatures",
      documentId: "spell-blending",
      uuid: "Compendium.pf2e.classfeatures.Item.spell-blending",
      itemType: "feat",
      featType: "classfeature",
      name: "Spell Blending",
      level: 1,
    };

    await applyDraftToActor(actor as any, draft, [
      {
        id: "class-branch-arcane-school-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane School",
        description: "",
        required: true,
        slotId: "class-branch-arcane-school-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-arcane-school-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "arcane-school-selector",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
      },
      {
        id: "class-branch-arcane-thesis-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane Thesis",
        description: "",
        required: true,
        slotId: "class-branch-arcane-thesis-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-arcane-thesis-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "arcane-thesis-selector",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
          selectorName: "Arcane Thesis",
          selectorRuleIndex: 0,
          flag: "arcaneThesis",
          optionTag: "wizard-arcane-thesis",
          classSlug: "wizard",
          dependsOn: "class",
        },
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        name: "School of Battle Magic",
        type: "feat",
        _stats: {
          compendiumSource: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
        },
        system: {
          category: "classfeature",
          level: { value: 1 },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
          },
          pf2e: {
            grantedBy: {
              id: "selector-school",
              onDelete: "cascade",
            },
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-branch-arcane-school-level-1",
          },
        },
      },
    ]);
    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      {
        name: "Spell Blending",
        type: "feat",
        _stats: {
          compendiumSource: "Compendium.pf2e.classfeatures.Item.spell-blending",
        },
        system: {
          category: "classfeature",
          level: { value: 1 },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.spell-blending",
          },
          pf2e: {
            grantedBy: {
              id: "selector-thesis",
              onDelete: "cascade",
            },
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-branch-arcane-thesis-level-1",
          },
        },
      },
    ]);
    expect(updateEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        _id: "selector-school",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "arcaneSchool",
            selection: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.arcaneSchool}",
          },
        ],
        "flags.pf2e.rulesSelections.arcaneSchool": "Compendium.pf2e.classfeatures.Item.school-battle-magic",
        "flags.pf2e.itemGrants.arcaneSchool": {
          id: "wizard-branch-1",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e-wayfinder.slotId": "class-branch-arcane-school-level-1",
      },
      {
        _id: "wizard-branch-1",
        "flags.core.sourceId": "Compendium.pf2e.classfeatures.Item.school-battle-magic",
        "flags.pf2e.grantedBy": {
          id: "selector-school",
          onDelete: "cascade",
        },
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "class-branch-arcane-school-level-1",
      },
    ]);
    expect(updateEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      {
        _id: "selector-thesis",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "arcaneThesis",
            selection: "Compendium.pf2e.classfeatures.Item.spell-blending",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.arcaneThesis}",
          },
        ],
        "flags.pf2e.rulesSelections.arcaneThesis": "Compendium.pf2e.classfeatures.Item.spell-blending",
        "flags.pf2e.itemGrants.arcaneThesis": {
          id: "wizard-branch-2",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e-wayfinder.slotId": "class-branch-arcane-thesis-level-1",
      },
      {
        _id: "wizard-branch-2",
        "flags.core.sourceId": "Compendium.pf2e.classfeatures.Item.spell-blending",
        "flags.pf2e.grantedBy": {
          id: "selector-thesis",
          onDelete: "cascade",
        },
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "class-branch-arcane-thesis-level-1",
      },
    ]);
  });

  it("preseeds wizard branch selectors during class creation so PF2E does not need to prompt", async () => {
    const createdItems: any[] = [];
    let idCounter = 0;
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) => {
      const created = sources.map((source) => {
        const item = {
          id: `created-${++idCounter}`,
          type: source.type,
          name: source.name,
          sourceId: source.flags?.core?.sourceId ?? null,
          flags: source.flags ?? {},
          system: source.system ?? {},
        };
        createdItems.push(item);
        return item;
      });
      actor.items.contents.push(...created);
      return created;
    });
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.classes",
          {
            metadata: { id: "pf2e.classes" },
            async getDocument(documentId: string) {
              if (documentId !== "wizard") {
                return null;
              }

              return {
                id: documentId,
                name: "Wizard",
                toObject: () => ({
                  name: "Wizard",
                  type: "class",
                  system: {
                    items: {
                      school: {
                        level: 1,
                        uuid: "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
                        name: "Arcane School",
                      },
                      thesis: {
                        level: 1,
                        uuid: "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
                        name: "Arcane Thesis",
                      },
                      bond: {
                        level: 1,
                        uuid: "Compendium.pf2e.classfeatures.Item.arcane-bond",
                        name: "Arcane Bond",
                      },
                    },
                  },
                }),
              };
            },
          },
        ],
        [
          "pf2e.classfeatures",
          {
            metadata: { id: "pf2e.classfeatures" },
            async getDocument(documentId: string) {
              switch (documentId) {
                case "arcane-school-selector":
                  return {
                    id: documentId,
                    name: "Arcane School",
                    toObject: () => ({
                      name: "Arcane School",
                      type: "feat",
                      system: {
                        category: "classfeature",
                        rules: [
                          {
                            key: "ChoiceSet",
                            flag: "arcaneSchool",
                          },
                          {
                            key: "GrantItem",
                            uuid: "{item|flags.system.rulesSelections.arcaneSchool}",
                          },
                        ],
                      },
                    }),
                  };
                case "arcane-thesis-selector":
                  return {
                    id: documentId,
                    name: "Arcane Thesis",
                    toObject: () => ({
                      name: "Arcane Thesis",
                      type: "feat",
                      system: {
                        category: "classfeature",
                        rules: [
                          {
                            key: "ChoiceSet",
                            flag: "arcaneThesis",
                          },
                          {
                            key: "GrantItem",
                            uuid: "{item|flags.system.rulesSelections.arcaneThesis}",
                          },
                        ],
                      },
                    }),
                  };
                case "school-battle-magic":
                  return {
                    id: documentId,
                    name: "School of Battle Magic",
                    toObject: () => ({
                      name: "School of Battle Magic",
                      type: "feat",
                      system: {
                        category: "classfeature",
                        level: { value: 1 },
                      },
                    }),
                  };
                case "spell-blending":
                  return {
                    id: documentId,
                    name: "Spell Blending",
                    toObject: () => ({
                      name: "Spell Blending",
                      type: "feat",
                      system: {
                        category: "classfeature",
                        level: { value: 1 },
                      },
                    }),
                  };
                default:
                  return null;
              }
            },
          },
        ],
      ]),
    } as any;

    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = {
      slotId: "class-level-1",
      packId: "pf2e.classes",
      documentId: "wizard",
      uuid: "Compendium.pf2e.classes.Item.wizard",
      itemType: "class",
      featType: null,
      name: "Wizard",
      level: 1,
    };
    draft.branchSelections["class-branch-arcane-school-level-1"] = {
      slotId: "class-branch-arcane-school-level-1",
      packId: "pf2e.classfeatures",
      documentId: "school-battle-magic",
      uuid: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
      itemType: "feat",
      featType: "classfeature",
      name: "School of Battle Magic",
      level: 1,
    };
    draft.branchSelections["class-branch-arcane-thesis-level-1"] = {
      slotId: "class-branch-arcane-thesis-level-1",
      packId: "pf2e.classfeatures",
      documentId: "spell-blending",
      uuid: "Compendium.pf2e.classfeatures.Item.spell-blending",
      itemType: "feat",
      featType: "classfeature",
      name: "Spell Blending",
      level: 1,
    };

    await applyDraftToActor(actor as any, draft, [
      {
        id: "class-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "class",
        title: "Choose a class",
        description: "",
        required: true,
        slotId: "class-level-1",
        filters: { itemType: "class" },
      },
      {
        id: "class-branch-arcane-school-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane School",
        description: "",
        required: true,
        slotId: "class-branch-arcane-school-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-arcane-school-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "arcane-school-selector",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
      },
      {
        id: "class-branch-arcane-thesis-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane Thesis",
        description: "",
        required: true,
        slotId: "class-branch-arcane-thesis-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-arcane-thesis-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "arcane-thesis-selector",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
          selectorName: "Arcane Thesis",
          selectorRuleIndex: 0,
          flag: "arcaneThesis",
          optionTag: "wizard-arcane-thesis",
          classSlug: "wizard",
          dependsOn: "class",
        },
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        name: "Wizard",
        type: "class",
        _stats: {
          compendiumSource: "Compendium.pf2e.classes.Item.wizard",
        },
        system: {
          items: {
            bond: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.arcane-bond",
              name: "Arcane Bond",
            },
          },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classes.Item.wizard",
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-level-1",
          },
        },
      },
    ]);

    const createdSources = createEmbeddedDocuments.mock.calls.flatMap((call) => call[1] as any[]);
    const schoolSelectorCall = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.arcane-school-selector"
    );
    const thesisSelectorCall = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector"
    );

    expect(schoolSelectorCall).toBeTruthy();
    expect(thesisSelectorCall).toBeTruthy();
    expect(schoolSelectorCall.system.location).toBe("created-1");
    expect(schoolSelectorCall.system.rules[0].selection).toBe("Compendium.pf2e.classfeatures.Item.school-battle-magic");
    expect(schoolSelectorCall.system.rules).toHaveLength(1);
    expect(schoolSelectorCall.flags.pf2e.rulesSelections.arcaneSchool).toBe(
      "Compendium.pf2e.classfeatures.Item.school-battle-magic"
    );
    expect(thesisSelectorCall.system.location).toBe("created-1");
    expect(thesisSelectorCall.system.rules[0].selection).toBe("Compendium.pf2e.classfeatures.Item.spell-blending");
    expect(thesisSelectorCall.system.rules).toHaveLength(1);
    expect(thesisSelectorCall.flags.pf2e.rulesSelections.arcaneThesis).toBe(
      "Compendium.pf2e.classfeatures.Item.spell-blending"
    );
    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(3, "Item", [
      {
        name: "School of Battle Magic",
        type: "feat",
        _stats: {
          compendiumSource: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
        },
        system: {
          category: "classfeature",
          level: { value: 1 },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-battle-magic",
          },
          pf2e: {
            grantedBy: {
              id: "created-2",
              onDelete: "cascade",
            },
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-branch-arcane-school-level-1",
          },
        },
      },
    ]);
    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(5, "Item", [
      {
        name: "Spell Blending",
        type: "feat",
        _stats: {
          compendiumSource: "Compendium.pf2e.classfeatures.Item.spell-blending",
        },
        system: {
          category: "classfeature",
          level: { value: 1 },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.spell-blending",
          },
          pf2e: {
            grantedBy: {
              id: "created-4",
              onDelete: "cascade",
            },
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-branch-arcane-thesis-level-1",
          },
        },
      },
    ]);
    expect(
      createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.school-battle-magic")
    ).toHaveLength(1);
    expect(
      createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.spell-blending")
    ).toHaveLength(1);
  });

  it("preseeds cleric deity-driven class features during class creation", async () => {
    const createdItems: any[] = [];
    let idCounter = 0;
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) => {
      const created = sources.map((source) => {
        const item = {
          id: `created-${++idCounter}`,
          type: source.type,
          name: source.name,
          sourceId: source.flags?.core?.sourceId ?? null,
          flags: source.flags ?? {},
          system: source.system ?? {},
        };
        createdItems.push(item);
        actor.items.contents.push(item);
        return item;
      });
      return created;
    });
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.classes",
          {
            metadata: { id: "pf2e.classes" },
            async getDocument(documentId: string) {
              if (documentId !== "cleric") {
                return null;
              }

              return {
                id: documentId,
                name: "Cleric",
                toObject: () => ({
                  name: "Cleric",
                  type: "class",
                  system: {
                    items: {
                      deity: {
                        level: 1,
                        uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
                        name: "Deity",
                      },
                      font: {
                        level: 1,
                        uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
                        name: "Divine Font",
                      },
                      spellcasting: {
                        level: 1,
                        uuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
                        name: "Cleric Spellcasting",
                      },
                    },
                  },
                }),
              };
            },
          },
        ],
        [
          "pf2e.classfeatures",
          {
            metadata: { id: "pf2e.classfeatures" },
            async getDocument(documentId: string) {
              switch (documentId) {
                case "deity-cleric":
                  return {
                    id: documentId,
                    name: "Deity",
                    toObject: () => ({
                      name: "Deity",
                      type: "feat",
                      system: {
                        category: "classfeature",
                        rules: [
                          {
                            key: "ChoiceSet",
                            flag: "deity",
                            choices: {
                              itemType: "deity",
                            },
                          },
                          {
                            key: "GrantItem",
                            uuid: "{item|flags.system.rulesSelections.deity}",
                          },
                          {
                            key: "ChoiceSet",
                            flag: "sanctification",
                            choices: [
                              { value: "holy", label: "Holy" },
                              { value: "unholy", label: "Unholy" },
                            ],
                          },
                        ],
                      },
                    }),
                  };
                case "divine-font":
                  return {
                    id: documentId,
                    name: "Divine Font",
                    toObject: () => ({
                      name: "Divine Font",
                      type: "feat",
                      system: {
                        category: "classfeature",
                        rules: [
                          {
                            key: "ChoiceSet",
                            flag: "divineFont",
                            choices: [
                              { value: "heal", label: "Heal" },
                              { value: "harm", label: "Harm" },
                            ],
                          },
                        ],
                      },
                    }),
                  };
                case "cleric-spellcasting":
                  return {
                    id: documentId,
                    name: "Cleric Spellcasting",
                    toObject: () => ({
                      name: "Cleric Spellcasting",
                      type: "feat",
                      system: {
                        category: "classfeature",
                      },
                    }),
                  };
                default:
                  return null;
              }
            },
          },
        ],
        [
          "pf2e.deities",
          {
            metadata: { id: "pf2e.deities" },
            async getDocument(documentId: string) {
              if (documentId !== "gorum") {
                return null;
              }

              return {
                id: documentId,
                name: "Gorum",
                toObject: () => ({
                  name: "Gorum",
                  type: "deity",
                  system: {
                    sanctification: {
                      modal: "can",
                      what: ["holy", "unholy"],
                    },
                    font: ["heal", "harm"],
                  },
                }),
              };
            },
          },
        ],
      ]),
    } as any;

    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = {
      slotId: "class-level-1",
      packId: "pf2e.classes",
      documentId: "cleric",
      uuid: "Compendium.pf2e.classes.Item.cleric",
      itemType: "class",
      featType: null,
      name: "Cleric",
      level: 1,
    };
    draft.selections["deity-level-1"] = {
      slotId: "deity-level-1",
      packId: "pf2e.deities",
      documentId: "gorum",
      uuid: "Compendium.pf2e.deities.Item.gorum",
      itemType: "deity",
      featType: null,
      name: "Gorum",
      level: 1,
    };
    draft.classChoices["class-choice-deity-sanctification-level-1"] = "holy";
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    await applyDraftToActor(actor as any, draft, [
      {
        id: "class-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "class",
        title: "Choose a class",
        description: "",
        required: true,
        slotId: "class-level-1",
        filters: { itemType: "class" },
      },
      {
        id: "deity-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "deity",
        title: "Choose a deity",
        description: "",
        required: true,
        slotId: "deity-level-1",
        filters: { itemType: "deity" },
        grantSelection: {
          slotId: "deity-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "deity-cleric",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
          selectorName: "Deity",
          selectorRuleIndex: 0,
          grantRuleIndex: 1,
          flag: "deity",
          itemType: "deity",
          classSlug: "cleric",
        },
      },
      {
        id: "class-choice-deity-sanctification-level-1",
        level: 1,
        kind: "class-choice",
        slotKind: "class-choice",
        title: "Sanctification",
        description: "",
        required: true,
        slotId: "class-choice-deity-sanctification-level-1",
        classChoice: {
          slotId: "class-choice-deity-sanctification-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "deity-cleric",
          sourceUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
          sourceName: "Deity",
          sourceRuleIndex: 2,
          flag: "sanctification",
          classSlug: "cleric",
          dependsOn: "deity",
          options: [
            { value: "holy", label: "Holy", img: null, detail: null },
            { value: "unholy", label: "Unholy", img: null, detail: null },
          ],
        },
      },
      {
        id: "class-choice-divine-font-divineFont-level-1",
        level: 1,
        kind: "class-choice",
        slotKind: "class-choice",
        title: "Divine Font",
        description: "",
        required: true,
        slotId: "class-choice-divine-font-divineFont-level-1",
        classChoice: {
          slotId: "class-choice-divine-font-divineFont-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "divine-font",
          sourceUuid: "Compendium.pf2e.classfeatures.Item.divine-font",
          sourceName: "Divine Font",
          sourceRuleIndex: 0,
          flag: "divineFont",
          classSlug: "cleric",
          dependsOn: "deity",
          options: [
            { value: "heal", label: "Heal", img: null, detail: null },
            { value: "harm", label: "Harm", img: null, detail: null },
          ],
        },
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        name: "Cleric",
        type: "class",
        _stats: {
          compendiumSource: "Compendium.pf2e.classes.Item.cleric",
        },
        system: {
          items: {
            spellcasting: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
              name: "Cleric Spellcasting",
            },
          },
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classes.Item.cleric",
          },
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            slotId: "class-level-1",
          },
        },
      },
    ]);

    const createdSources = createEmbeddedDocuments.mock.calls.flatMap((call) => call[1] as any[]);
    const deityFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.deity-cleric"
    );
    const divineFontFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.divine-font"
    );
    const deityGrant = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.deities.Item.gorum"
    );

    expect(deityFeature).toBeTruthy();
    expect(deityFeature.system.location).toBe("created-1");
    expect(deityFeature.system.rules).toHaveLength(2);
    expect(deityFeature.flags.pf2e.rulesSelections).toEqual({
      deity: "Compendium.pf2e.deities.Item.gorum",
      sanctification: "holy",
    });

    expect(divineFontFeature).toBeTruthy();
    expect(divineFontFeature.system.location).toBe("created-1");
    expect(divineFontFeature.flags.pf2e.rulesSelections).toEqual({
      divineFont: "harm",
    });

    expect(deityGrant).toBeTruthy();
    expect(createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.deities.Item.gorum")).toHaveLength(1);
  });

  it("creates cleric prepared and divine font spellcasting entries from chosen font state", async () => {
    let idCounter = 0;
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) => {
      const created = sources.map((source) => {
        const item = {
          id: `created-${++idCounter}`,
          type: source.type,
          name: source.name,
          sourceId: source.flags?.core?.sourceId ?? null,
          flags: source.flags ?? {},
          system: source.system ?? {},
          _stats: source._stats ?? {},
        };
        actor.items.contents.push(item);
        return item;
      });
      return created;
    });
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Cleric",
            system: {
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
        ] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              if (documentId === "rfZpqmj0AIIdkVIs") {
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
              }

              if (documentId === "wdA52JJnsuQWeyqz") {
                return {
                  id: documentId,
                  name: "Harm",
                  toObject: () => ({
                    name: "Harm",
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
              }

              return null;
            },
          },
        ],
      ]),
    } as any;

    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    await applyDraftToActor(actor as any, draft, []);

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Divine Prepared Spells",
        type: "spellcastingEntry",
        flags: {
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
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
    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      expect.objectContaining({
        name: "Divine Font (Harmful)",
        type: "spellcastingEntry",
        flags: {
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            destinationKey: "cleric-divine-font-harm",
          },
        },
      }),
    ]);
    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(3, "Item", [
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
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
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
    const actor = {
      system: {
        details: {
          level: {
            value: 5,
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
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Cleric",
            system: {
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
              "pf2e-wayfinder": {
                importedBy: "pf2e-wayfinder",
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
            sourceId: "Compendium.pf2e.spells-srd.Item.rfZpqmj0AIIdkVIs",
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
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    const draft = createEmptyDraft(5);
    draft.targetLevel = 5;
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "heal";

    await applyDraftToActor(actor as any, draft, []);

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

  it("assigns cleric spell choices into divine prepared slots", async () => {
    const createdItems: any[] = [];
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) => {
      const created = sources.map((source, index) => {
        const item = {
          id: `created-${createdItems.length + index + 1}`,
          type: source.type,
          name: source.name,
          sourceId: source.flags?.core?.sourceId ?? null,
          flags: source.flags ?? {},
          system: source.system ?? {},
          _stats: source._stats ?? {},
        };
        createdItems.push(item);
        actor.items.contents.push(item);
        return item;
      });
      return created;
    });
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Cleric",
            system: {
              keyAbility: {
                value: ["wis"],
                selected: "wis",
              },
            },
          },
        ] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              const spellDefinitions: Record<string, { name: string; cantrip: boolean }> = {
                daze: { name: "Daze", cantrip: true },
                guidance: { name: "Guidance", cantrip: true },
                light: { name: "Light", cantrip: true },
                "read-aura": { name: "Read Aura", cantrip: true },
                "divine-lance": { name: "Divine Lance", cantrip: true },
                bless: { name: "Bless", cantrip: false },
                bane: { name: "Bane", cantrip: false },
              };
              const spell = spellDefinitions[documentId];
              if (!spell) {
                return null;
              }

              return {
                id: documentId,
                name: spell.name,
                toObject: () => ({
                  name: spell.name,
                  type: "spell",
                  system: {
                    level: { value: 1 },
                    traits: {
                      traditions: ["divine"],
                      value: spell.cantrip ? ["cantrip"] : [],
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
    draft.spellChoices["spell-choice-cleric-cantrips-level-1"] = [
      spellSelection("spell-choice-cleric-cantrips-level-1", "daze", "Daze"),
      spellSelection("spell-choice-cleric-cantrips-level-1", "guidance", "Guidance"),
      spellSelection("spell-choice-cleric-cantrips-level-1", "light", "Light"),
      spellSelection("spell-choice-cleric-cantrips-level-1", "read-aura", "Read Aura"),
      spellSelection("spell-choice-cleric-cantrips-level-1", "divine-lance", "Divine Lance"),
    ];
    draft.spellChoices["spell-choice-cleric-rank-1-level-1"] = [
      spellSelection("spell-choice-cleric-rank-1-level-1", "bless", "Bless"),
      spellSelection("spell-choice-cleric-rank-1-level-1", "bane", "Bane"),
    ];

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-cleric-cantrips-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Cleric prepared cantrips",
        description: "",
        required: true,
        slotId: "spell-choice-cleric-cantrips-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: clericSpellChoice("spell-choice-cleric-cantrips-level-1", 5, 0, 0, true),
      },
      {
        id: "spell-choice-cleric-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Cleric prepared spells",
        description: "",
        required: true,
        slotId: "spell-choice-cleric-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: clericSpellChoice("spell-choice-cleric-rank-1-level-1", 2, 1, 1, false),
      },
    ]);

    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
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
    const createdItems: any[] = [];
    let idCounter = 0;
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) => {
      const created = sources.map((source) => {
        const item = {
          id: `created-${++idCounter}`,
          type: source.type,
          name: source.name,
          sourceId: source.flags?.core?.sourceId ?? null,
          flags: source.flags ?? {},
          system: source.system ?? {},
          _stats: source._stats ?? {},
        };
        createdItems.push(item);
        actor.items.contents.push(item);
        return item;
      });
      return created;
    });
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
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
        ] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              if (documentId !== "magic-missile" && documentId !== "shield") {
                return null;
              }

              return {
                id: documentId,
                name: documentId === "magic-missile" ? "Magic Missile" : "Shield",
                toObject: () => ({
                  name: documentId === "magic-missile" ? "Magic Missile" : "Shield",
                  type: "spell",
                  system: {
                    level: { value: documentId === "shield" ? 1 : 1 },
                    traits: {
                      traditions: ["arcane"],
                      value: documentId === "shield" ? ["cantrip"] : [],
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
    draft.spellChoices["spell-choice-wizard-spellbook-cantrips-level-1"] = [
      {
        slotId: "spell-choice-wizard-spellbook-cantrips-level-1",
        packId: "pf2e.spells-srd",
        documentId: "shield",
        uuid: "Compendium.pf2e.spells-srd.Item.shield",
        itemType: "spell",
        featType: null,
        name: "Shield",
        level: 1,
      },
    ];
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      {
        slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
        packId: "pf2e.spells-srd",
        documentId: "magic-missile",
        uuid: "Compendium.pf2e.spells-srd.Item.magic-missile",
        itemType: "spell",
        featType: null,
        name: "Magic Missile",
        level: 1,
      },
    ];

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-wizard-spellbook-cantrips-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Wizard spellbook cantrips",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-spellbook-cantrips-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-spellbook-cantrips-level-1", 10, 0, 0, true),
      },
      {
        id: "spell-choice-wizard-spellbook-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Wizard spellbook spells",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-spellbook-rank-1-level-1", 5, 1, 1, false),
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Arcane Prepared Spells",
        type: "spellcastingEntry",
        system: expect.objectContaining({
          showSlotlessLevels: {
            value: true,
          },
          slots: expect.objectContaining({
            slot0: expect.objectContaining({
              max: 6,
              prepared: Array.from({ length: 6 }, () => ({ id: null, expended: false })),
              value: 6,
            }),
            slot1: expect.objectContaining({
              max: 3,
              prepared: Array.from({ length: 3 }, () => ({ id: null, expended: false })),
              value: 3,
            }),
          }),
        }),
        flags: {
          "pf2e-wayfinder": {
            importedBy: "pf2e-wayfinder",
            destinationKey: "wizard-arcane-prepared",
          },
        },
      }),
    ]);

    const createdSpellSources = createEmbeddedDocuments.mock.calls
      .slice(1)
      .flatMap((call) => call[1] as any[])
      .filter((source) => source.type === "spell");
    expect(createdSpellSources).toHaveLength(2);
    expect(createdSpellSources.map((source) => source.system.location.value)).toEqual(["created-1", "created-1"]);

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-wizard-spellbook-cantrips-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Wizard spellbook cantrips",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-spellbook-cantrips-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-spellbook-cantrips-level-1", 10, 0, 0, true),
      },
      {
        id: "spell-choice-wizard-spellbook-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Wizard spellbook spells",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-spellbook-rank-1-level-1", 5, 1, 1, false),
      },
    ]);

    expect(
      createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.spells-srd.Item.magic-missile")
    ).toHaveLength(1);
    expect(createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.spells-srd.Item.shield")).toHaveLength(1);
  });

  it("preserves existing prepared spells when repairing a wizard spellcasting entry", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
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
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      {
        slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
        packId: "pf2e.spells-srd",
        documentId: "magic-missile",
        uuid: "Compendium.pf2e.spells-srd.Item.magic-missile",
        itemType: "spell",
        featType: null,
        name: "Magic Missile",
        level: 1,
      },
    ];

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-wizard-spellbook-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Wizard spellbook spells",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-spellbook-rank-1-level-1", 5, 1, 1, false),
      },
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
  });

  it("replaces obsolete spellbook imports for the same wayfinder slot on reapply", async () => {
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) =>
      sources.map((source, index) => ({
        id: `created-${index + 10}`,
        type: source.type,
        sourceId: source.flags?.core?.sourceId ?? null,
        flags: source.flags ?? {},
        system: source.system ?? {},
      }))
    );
    const deleteEmbeddedDocuments = vi.fn(async (_type: string, ids: string[]) => {
      actor.items.contents = actor.items.contents.filter((item: any) => !ids.includes(item.id));
      return [];
    });
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
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
        ] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              if (documentId !== "new-curriculum-spell") {
                return null;
              }

              return {
                id: documentId,
                name: "New Curriculum Spell",
                toObject: () => ({
                  name: "New Curriculum Spell",
                  type: "spell",
                  system: {
                    level: { value: 1 },
                    traits: {
                      traditions: ["arcane"],
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
    draft.spellChoices["spell-choice-wizard-curriculum-rank-1-level-1"] = [
      {
        slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
        packId: "pf2e.spells-srd",
        documentId: "new-curriculum-spell",
        uuid: "Compendium.pf2e.spells-srd.Item.new-curriculum-spell",
        itemType: "spell",
        featType: null,
        name: "New Curriculum Spell",
        level: 1,
      },
    ];

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-wizard-curriculum-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Arcane school curriculum spells",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: {
          ...wizardSpellChoice("spell-choice-wizard-curriculum-rank-1-level-1", 2, 1, 1, false),
          dependsOn: "class-branch",
          curriculumSpellNames: ["New Curriculum Spell"],
        },
      },
    ]);

    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["old-spell-1"]);
    expect(createEmbeddedDocuments).toHaveBeenLastCalledWith("Item", [
      expect.objectContaining({
        name: "New Curriculum Spell",
        type: "spell",
      }),
    ]);
  });

  it("creates unified-theory wizard spellcasting entries without curriculum slot bonuses", async () => {
    const createdItems: any[] = [];
    let idCounter = 0;
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: any[]) => {
      const created = sources.map((source) => {
        const item = {
          id: `created-${++idCounter}`,
          type: source.type,
          name: source.name,
          sourceId: source.flags?.core?.sourceId ?? null,
          flags: source.flags ?? {},
          system: source.system ?? {},
          _stats: source._stats ?? {},
        };
        createdItems.push(item);
        actor.items.contents.push(item);
        return item;
      });
      return created;
    });
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
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
        ] as any[],
      },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    };

    testGlobals.game = {
      packs: new Map([
        [
          "pf2e.spells-srd",
          {
            metadata: { id: "pf2e.spells-srd" },
            async getDocument(documentId: string) {
              if (documentId !== "magic-missile") {
                return null;
              }

              return {
                id: documentId,
                name: "Magic Missile",
                toObject: () => ({
                  name: "Magic Missile",
                  type: "spell",
                  system: {
                    level: { value: 1 },
                    traits: {
                      traditions: ["arcane"],
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
    draft.branchSelections["class-branch-arcane-school-level-1"] = {
      slotId: "class-branch-arcane-school-level-1",
      packId: "pf2e.classfeatures",
      documentId: "xYYhJtGhFSWNifcO",
      uuid: "Compendium.pf2e.classfeatures.Item.xYYhJtGhFSWNifcO",
      itemType: "feat",
      featType: "classfeature",
      name: "School of Unified Magical Theory",
      level: 1,
    };
    draft.spellChoices["spell-choice-wizard-unified-rank-1-level-1"] = [
      {
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        packId: "pf2e.spells-srd",
        documentId: "magic-missile",
        uuid: "Compendium.pf2e.spells-srd.Item.magic-missile",
        itemType: "spell",
        featType: null,
        name: "Magic Missile",
        level: 1,
      },
    ];

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-wizard-unified-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Unified theory bonus spell",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-unified-rank-1-level-1", 1, 1, 1, false),
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Arcane Prepared Spells",
        type: "spellcastingEntry",
        system: expect.objectContaining({
          slots: expect.objectContaining({
            slot0: expect.objectContaining({
              max: 5,
              prepared: Array.from({ length: 5 }, () => ({ id: null, expended: false })),
              value: 5,
            }),
            slot1: expect.objectContaining({
              max: 2,
              prepared: Array.from({ length: 2 }, () => ({ id: null, expended: false })),
              value: 2,
            }),
          }),
        }),
      }),
    ]);
  });

  it("clamps existing spell slot values when wizard entry capacity shrinks", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
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
        contents: [
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
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({})),
    };

    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-arcane-school-level-1"] = {
      slotId: "class-branch-arcane-school-level-1",
      packId: "pf2e.classfeatures",
      documentId: "xYYhJtGhFSWNifcO",
      uuid: "Compendium.pf2e.classfeatures.Item.xYYhJtGhFSWNifcO",
      itemType: "feat",
      featType: "classfeature",
      name: "School of Unified Magical Theory",
      level: 1,
    };
    draft.spellChoices["spell-choice-wizard-unified-rank-1-level-1"] = [
      {
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        packId: "pf2e.spells-srd",
        documentId: "magic-missile",
        uuid: "Compendium.pf2e.spells-srd.Item.magic-missile",
        itemType: "spell",
        featType: null,
        name: "Magic Missile",
        level: 1,
      },
    ];

    await applyDraftToActor(actor as any, draft, [
      {
        id: "spell-choice-wizard-unified-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Unified theory bonus spell",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: wizardSpellChoice("spell-choice-wizard-unified-rank-1-level-1", 1, 1, 1, false),
      },
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

function ancestryItem(): any {
  return {
    id: "ancestry-1",
    type: "ancestry",
    name: "Human",
    system: {
      boosts: {
        fixed: {
          value: ["con"],
          selected: "con",
        },
        free: {
          value: ["str", "dex", "con", "int", "wis", "cha"],
          selected: null,
        },
      },
      voluntary: {
        flaws: [],
      },
    },
  };
}

function backgroundItem(): any {
  return {
    id: "background-1",
    type: "background",
    name: "Acrobat",
    system: {
      boosts: {
        restricted: {
          value: ["str", "dex"],
          selected: null,
        },
        free: {
          value: ["str", "dex", "con", "int", "wis", "cha"],
          selected: null,
        },
      },
    },
  };
}

function classItem(): any {
  return {
    id: "class-1",
    type: "class",
    name: "Wizard",
    system: {
      keyAbility: {
        value: ["int", "wis"],
        selected: null,
      },
    },
  };
}

function wizardSpellChoice(slotId: string, count: number, minRank: number, maxRank: number, cantrip: boolean): any {
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

function clericSpellChoice(slotId: string, count: number, minRank: number, maxRank: number, cantrip: boolean): any {
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

function spellSelection(slotId: string, documentId: string, name: string): any {
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
