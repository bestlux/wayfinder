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
        },
      },
    ]);

    expect(createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Scoundrel",
        type: "feat",
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
