import { describe, expect, it, vi } from "vitest";
import { applyDraftToActor } from "../src/actor-updater";
import { createEmptyDraft } from "../src/draft-service";

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
    const insertFeat = vi.fn(async () => [{ id: "created-feat-1" }]);
    globalThis.game = {
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

    globalThis.game = {
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

    globalThis.game = {
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

    globalThis.game = {
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

    globalThis.game = {
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
