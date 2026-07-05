import { describe, expect, it, vi } from "vitest";
import {
  createEmbeddedSource,
  createSingletonGrantItems,
  createSingletonSystemGrantItems,
  hasSourceId,
  insertFeatSelection,
  orderSelections,
  replaceSingletonItem,
  replaceSingletonItems,
  restoreSingletonSourceSlotFlags,
} from "../src/actor-updater/selection-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { ActorLike, EmbeddedItemSource } from "../src/shared/actor-model";
import type { PendingStep, SelectionRef } from "../src/types";

describe("actor-updater selection application", () => {
  it("replaces singleton items with embedded sources stamped for wayfinder", async () => {
    const actor = {
      items: [
        { id: "ancestry-1", type: "ancestry" },
        { id: "ancestry-2", type: "ancestry" },
      ],
      deleteEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => []),
    };
    const selection = selectionRef("ancestry-level-1", "ancestry", "human", "Human");

    await replaceSingletonItem(actor, selection, createEmptyDraft(1), [], {
      fetchSelectionDocument: async () => ({
        toObject: () => ({
          _id: "compendium-ancestry",
          name: "Human",
          type: "ancestry",
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["ancestry-1", "ancestry-2"]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Human",
        type: "ancestry",
        _stats: {
          compendiumSource: selection.uuid,
        },
        flags: {
          core: {
            sourceId: selection.uuid,
          },
          [MODULE_ID]: {
            importedBy: MODULE_ID,
            slotId: selection.slotId,
          },
        },
      },
    ]);
  });

  it("batches multiple singleton replacements into one embedded create operation", async () => {
    const actor = {
      items: [
        { id: "old-ancestry", type: "ancestry" },
        { id: "old-heritage", type: "heritage" },
        { id: "kept-feat", type: "feat" },
      ],
      deleteEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: EmbeddedItemSource[]) => sources),
    };
    const selections = [
      selectionRef("ancestry-level-1", "ancestry", "elf", "Elf"),
      selectionRef("heritage-level-1", "heritage", "ancient-elf", "Ancient Elf"),
      selectionRef("background-level-1", "background", "acolyte", "Acolyte"),
      selectionRef("class-level-1", "class", "rogue", "Rogue"),
    ];

    await replaceSingletonItems(actor, selections, createEmptyDraft(1), [], {
      fetchSelectionDocument: async (selection) => ({
        toObject: () => ({
          _id: `compendium-${selection.documentId}`,
          name: selection.name,
          type: selection.itemType,
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["old-ancestry", "old-heritage"]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    const createdSources = actor.createEmbeddedDocuments.mock.calls[0]?.[1];
    expect(createdSources?.map((source) => source.name)).toEqual(["Elf", "Ancient Elf", "Acolyte", "Rogue"]);
  });

  it("preselects singleton boost and key ability data before embedded item creation", async () => {
    const actor = {
      items: [],
      createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: EmbeddedItemSource[]) => sources),
    };
    const draft = createEmptyDraft(1);
    draft.boosts.ancestry.selectedBoosts = {
      "0": "con",
      "1": "wis",
      "2": "int",
    };
    draft.boosts.background.selectedBoosts = {
      "0": "int",
      "1": "wis",
    };
    draft.boosts.class.keyAbility = "int";
    const selections = [
      selectionRef("ancestry-level-1", "ancestry", "dwarf", "Dwarf"),
      selectionRef("background-level-1", "background", "acolyte", "Acolyte"),
      selectionRef("class-level-1", "class", "wizard", "Wizard"),
    ];

    await replaceSingletonItems(actor, selections, draft, [], {
      fetchSelectionDocument: async (selection) => ({
        toObject: () => ({
          _id: `compendium-${selection.documentId}`,
          name: selection.name,
          type: selection.itemType,
          system:
            selection.itemType === "class"
              ? { keyAbility: { value: ["int"], selected: null } }
              : {
                  boosts: {
                    "0": { value: ["con", "int", "wis"], selected: null },
                    "1": { value: ["str", "dex", "con", "int", "wis", "cha"], selected: null },
                    "2": { value: ["str", "dex", "con", "int", "wis", "cha"], selected: null },
                  },
                },
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    const createdSources = actor.createEmbeddedDocuments.mock.calls[0]?.[1];
    expect(createdSources?.find((source) => source.type === "ancestry")?.system?.boosts).toMatchObject({
      "0": { selected: "con" },
      "1": { selected: "wis" },
      "2": { selected: "int" },
    });
    expect(createdSources?.find((source) => source.type === "background")?.system?.boosts).toMatchObject({
      "0": { selected: "int" },
      "1": { selected: "wis" },
    });
    expect(createdSources?.find((source) => source.type === "class")?.system?.keyAbility?.selected).toBe("int");
  });

  it("preselects stripped singleton system item grants before PF2E can prompt for them", async () => {
    const draft = createEmptyDraft(1);
    const selection = selectionRef("ancestry-level-1", "ancestry", "dwarf", "Dwarf");

    const ancestrySource = await createEmbeddedSource(selection, draft, [], {
      fetchSelectionDocument: async () => ({
        toObject: () => ({
          name: "Dwarf",
          type: "ancestry",
          system: {
            items: {
              clan: {
                name: "Clan Dagger",
                uuid: "Compendium.pf2e.ancestryfeatures.Item.Clan Dagger",
              },
            },
          },
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(ancestrySource?.system?.items).toEqual({});
    expect(ancestrySource?.flags?.[MODULE_ID]?.manualSystemItemGrants).toEqual([
      {
        key: "clan",
        uuid: "Compendium.pf2e.ancestryfeatures.Item.Clan Dagger",
        name: "Clan Dagger",
        defaultChoices: {
          clanWeapon: "clan-dagger",
        },
      },
    ]);

    const actor = {
      items: [{ ...ancestrySource, id: "ancestry-id" }],
      createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: EmbeddedItemSource[]) =>
        sources.map((source) => ({ ...source, id: "clan-dagger-id" }))
      ),
      updateEmbeddedDocuments: vi.fn(async () => []),
    } satisfies ActorLike;
    await createSingletonSystemGrantItems(actor, draft, [], {
      fetchSelectionDocument: async () => null,
      createEmbeddedSource: async () => ({
        name: "Clan Dagger",
        type: "feat",
        system: {
          rules: [
            {
              key: "ChoiceSet",
              flag: "clanWeapon",
            },
          ],
        },
      }),
    });

    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Clan Dagger",
        type: "feat",
        system: {
          location: "ancestry-id",
          rules: [
            {
              key: "ChoiceSet",
              flag: "clanWeapon",
              selection: "clan-dagger",
            },
          ],
        },
        flags: {
          core: {
            sourceId: "Compendium.pf2e.ancestryfeatures.Item.Clan Dagger",
          },
          pf2e: {
            grantedBy: {
              id: "ancestry-id",
              onDelete: "cascade",
            },
            rulesSelections: {
              clanWeapon: "clan-dagger",
            },
          },
          [MODULE_ID]: {
            importedBy: MODULE_ID,
            slotId: "system-grant-clan-dagger",
          },
        },
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "ancestry-id",
        "flags.pf2e.itemGrants.clan": {
          id: "clan-dagger-id",
          onDelete: "detach",
        },
      },
    ]);
  });

  it("strips class preselected data when building a class embedded source", async () => {
    const draft = createEmptyDraft(1);
    const steps: PendingStep[] = [];
    const stripPreselectedClassFeatureEntries = vi.fn();
    const stripPreselectedClassBranchEntries = vi.fn();

    const source = await createEmbeddedSource(
      selectionRef("class-level-1", "class", "wizard", "Wizard"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "class-compendium",
            name: "Wizard",
            type: "class",
            system: {},
          }),
        }),
        stripPreselectedClassFeatureEntries,
        stripPreselectedClassBranchEntries,
      }
    );

    expect(source?.name).toBe("Wizard");
    expect(stripPreselectedClassFeatureEntries).toHaveBeenCalledWith(source, draft, steps);
    expect(stripPreselectedClassBranchEntries).toHaveBeenCalledWith(source, draft, steps);
  });

  it("preselects drafted class skill-training choices before creating the class item", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: {
        "class:fighterskill": "athletics",
      },
      additional: ["crafting", "medicine", "society"],
      loreChoices: {},
    };
    const steps: PendingStep[] = [
      {
        id: "skill-training-fighter-level-1",
        level: 1,
        kind: "skill-training",
        slotKind: "skill-training",
        title: "Training",
        description: "",
        required: true,
        slotId: "skill-training-fighter-level-1",
        training: {
          classSlug: "fighter",
          className: "Fighter",
          fixedSkills: [],
          fixedLores: [],
          choiceRules: [
            {
              key: "class:fighterskill",
              flag: "fighterSkill",
              prompt: "Choose a skill",
              sourceLabel: "Fighter",
              options: [
                { slug: "acrobatics", label: "Acrobatics" },
                { slug: "athletics", label: "Athletics" },
              ],
              persistence: {
                sourceItemType: "class",
                sourcePackId: "test.pack",
                sourceDocumentId: "fighter",
                sourceUuid: "Compendium.test.pack.Item.fighter",
                sourceRuleIndex: 0,
              },
            },
          ],
          loreChoices: [],
          additionalCount: 3,
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef("class-level-1", "class", "fighter", "Fighter"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "class-compendium",
            name: "Fighter",
            type: "class",
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
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "fighterSkill",
      selection: "athletics",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      fighterSkill: "athletics",
    });
  });

  it("resolves static GrantItem preselect templates from drafted background training", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-background-scholar"] = {
      ruleChoices: {
        "background:scholar:skill": "arcana",
      },
      additional: [],
      loreChoices: {},
    };
    const selection = selectionRef("background-level-1", "background", "scholar", "Scholar");
    const steps: PendingStep[] = [
      {
        id: "skill-training-background-scholar",
        level: 1,
        kind: "skill-training",
        slotKind: "skill-training",
        title: "Scholar training",
        description: "",
        required: true,
        slotId: "skill-training-background-scholar",
        training: {
          classSlug: null,
          className: null,
          fixedSkills: [],
          fixedLores: [],
          choiceRules: [
            {
              key: "background:scholar:skill",
              flag: "skill",
              prompt: "Choose a skill",
              sourceLabel: "Scholar",
              options: [
                { slug: "arcana", label: "Arcana" },
                { slug: "occultism", label: "Occultism" },
              ],
              persistence: {
                sourceItemType: "background",
                sourcePackId: "test.pack",
                sourceDocumentId: "scholar",
                sourceUuid: selection.uuid,
                sourceRuleIndex: 0,
              },
            },
          ],
          loreChoices: [],
          additionalCount: 0,
        },
      },
    ];

    const source = await createEmbeddedSource(selection, draft, steps, {
      fetchSelectionDocument: async () => ({
        toObject: () => ({
          _id: "background-compendium",
          name: "Scholar",
          type: "background",
          system: {
            rules: [
              {
                key: "ChoiceSet",
                flag: "skill",
                choices: [
                  { value: "arcana", label: "Arcana" },
                  { value: "occultism", label: "Occultism" },
                ],
              },
              {
                key: "ActiveEffectLike",
                path: "system.skills.{item|flags.pf2e.rulesSelections.skill}.rank",
                mode: "upgrade",
                value: 1,
              },
              {
                key: "GrantItem",
                uuid: "Compendium.pf2e.feats-srd.Item.Assurance",
                preselectChoices: {
                  assurance: "{item|flags.system.rulesSelections.skill}",
                },
              },
            ],
          },
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "skill",
      selection: "arcana",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      skill: "arcana",
    });
    expect(source?.system?.rules?.[2]).toMatchObject({
      key: "GrantItem",
      uuid: "Compendium.pf2e.feats-srd.Item.Assurance",
      preselectChoices: {
        assurance: "arcana",
      },
    });
    expect(source?.flags?.[MODULE_ID]?.manualStaticItemGrants).toBeUndefined();
  });

  it("preselects choices on static GrantItem children before PF2E creates them natively", async () => {
    const draft = createEmptyDraft(1);
    const step: PendingStep = {
      id: "class-choice-initiate-benefit-wand-initiateBenefitWand-level-1",
      level: 1,
      kind: "class-choice",
      slotKind: "class-choice",
      title: "Wand damage type",
      description: "",
      required: true,
      slotId: "class-choice-initiate-benefit-wand-initiateBenefitWand-level-1",
      classChoice: {
        slotId: "class-choice-initiate-benefit-wand-initiateBenefitWand-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "Initiate Benefit (Wand)",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
        sourceName: "Initiate Benefit (Wand)",
        sourceRuleIndex: 1,
        flag: "initiateBenefitWand",
        classSlug: "thaumaturge",
        dependsOn: "class",
        options: [{ value: "fire", label: "Fire", img: null, detail: null }],
      },
    };
    draft.classChoices[step.slotId] = "fire";

    const source = await createEmbeddedSource(
      {
        slotId: "class-branch-second-implement-level-5",
        packId: "pf2e.classfeatures",
        documentId: "wand",
        uuid: "Compendium.pf2e.classfeatures.Item.wand",
        itemType: "feat",
        featType: "classfeature",
        name: "Wand",
        level: 1,
      },
      draft,
      [step],
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            name: "Wand",
            type: "feat",
            system: {
              category: "classfeature",
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules).toEqual([]);
    expect(source?.flags?.[MODULE_ID]?.manualStaticItemGrants).toEqual([
      {
        key: "initiateBenefitWand",
        uuid: "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
        choices: {
          initiateBenefitWand: "fire",
        },
      },
    ]);
  });

  it("preselects drafted class choices before creating the owning class feature item", async () => {
    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-armor-innovation-armorInnovation-level-1"] =
      "Compendium.pf2e.equipment-srd.Item.Power Suit";
    const steps: PendingStep[] = [
      {
        id: "class-choice-armor-innovation-armorInnovation-level-1",
        level: 1,
        kind: "class-choice",
        slotKind: "class-choice",
        title: "Armor Innovation",
        description: "",
        required: true,
        slotId: "class-choice-armor-innovation-armorInnovation-level-1",
        classChoice: {
          slotId: "class-choice-armor-innovation-armorInnovation-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "armor-innovation",
          sourceUuid: "Compendium.pf2e.classfeatures.Item.armor-innovation",
          sourceName: "Armor Innovation",
          sourceRuleIndex: 0,
          flag: "armorInnovation",
          classSlug: "inventor",
          dependsOn: "class",
          options: [
            {
              value: "Compendium.pf2e.equipment-srd.Item.Power Suit",
              label: "Power Suit",
              img: null,
              detail: null,
            },
          ],
        },
      },
    ];

    const source = await createEmbeddedSource(
      {
        slotId: "class-branch-innovation-level-1",
        packId: "pf2e.classfeatures",
        documentId: "armor-innovation",
        uuid: "Compendium.pf2e.classfeatures.Item.armor-innovation",
        itemType: "feat",
        featType: "classfeature",
        name: "Armor Innovation",
        level: 1,
      },
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            name: "Armor Innovation",
            type: "feat",
            system: {
              category: "classfeature",
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "armorInnovation",
                  choices: [
                    {
                      value: "Compendium.pf2e.equipment-srd.Item.Power Suit",
                    },
                  ],
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.armorInnovation}",
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "armorInnovation",
      selection: "Compendium.pf2e.equipment-srd.Item.Power Suit",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      armorInnovation: "Compendium.pf2e.equipment-srd.Item.Power Suit",
    });
  });

  it("preselects drafted singleton choices before creating the owning item", async () => {
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-heritage-skilled-human-trainedSkill-level-1"] = "society";
    const steps: PendingStep[] = [
      {
        id: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
        level: 1,
        kind: "singleton-choice",
        slotKind: "singleton-choice",
        title: "Trained Skill",
        description: "",
        required: true,
        slotId: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
        singletonChoice: {
          slotId: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
          sourceItemType: "heritage",
          sourcePackId: "test.pack",
          sourceDocumentId: "skilled-human",
          sourceUuid: "Compendium.test.pack.Item.skilled-human",
          sourceName: "Skilled Human",
          sourceRuleIndex: 0,
          flag: "trainedSkill",
          prompt: "Choose a skill",
          predicate: [],
          rollOption: null,
          options: [
            { value: "arcana", label: "Arcana", img: null, detail: null },
            { value: "society", label: "Society", img: null, detail: null },
          ],
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef("heritage-level-1", "heritage", "skilled-human", "Skilled Human"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "heritage-compendium",
            name: "Skilled Human",
            type: "heritage",
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "trainedSkill",
                  choices: {
                    config: "skills",
                  },
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "trainedSkill",
      selection: "society",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      trainedSkill: "society",
    });
  });

  it("preselects drafted flag choices before creating the owning item", async () => {
    const draft = createEmptyDraft(2);
    const sourceSelection = selectionRef(
      "class-feat-level-2",
      "feat",
      "multifarious-muse",
      "Multifarious Muse",
      "class"
    );
    const flagSelection = {
      ...selectionRef(
        "flag-choice-none-feat-multifarious-muse-muse-level-2",
        "feat",
        "maestro",
        "Maestro",
        "classfeature"
      ),
      packId: "pf2e.classfeatures",
      uuid: "Compendium.pf2e.classfeatures.Item.maestro",
      slug: "maestro",
    };
    draft.selections[sourceSelection.slotId] = sourceSelection;
    draft.selections[flagSelection.slotId] = flagSelection;

    const source = await createEmbeddedSource(sourceSelection, draft, [flagChoiceStep()], {
      fetchSelectionDocument: async () => ({
        toObject: () => ({
          name: "Multifarious Muse",
          type: "feat",
          system: {
            rules: [
              {
                key: "ChoiceSet",
                flag: "muse",
                choices: {
                  filter: ["item:tag:bard-muse"],
                  slugsAsValues: true,
                },
              },
            ],
          },
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "muse",
      selection: "maestro",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      muse: "maestro",
    });
  });

  it("preselects drafted feat-owned spell choices before creating the feat item", async () => {
    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-feat-arcane-tattoos-cantrip-level-1"] = [
      selectionRef("spell-choice-feat-arcane-tattoos-cantrip-level-1", "spell", "shield", "Shield"),
    ];
    const steps: PendingStep[] = [
      {
        id: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Arcane Tattoos",
        description: "",
        required: true,
        slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: {
          slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
          sourcePackId: "test.pack",
          sourceDocumentId: "arcane-tattoos",
          sourceUuid: "Compendium.test.pack.Item.arcane-tattoos",
          sourceName: "Arcane Tattoos",
          classSlug: null,
          dependsOn: null,
          destination: {
            type: "innate",
            key: "feat-arcane-tattoos-innate-arcane",
            label: "Innate arcane spells",
            entryName: "Innate Arcane Spells",
            tradition: "arcane",
            ability: "cha",
            prepared: "innate",
          },
          count: 1,
          minRank: 0,
          maxRank: 0,
          cantrip: true,
          allowedSpellSlugs: ["daze", "shield"],
          curriculumSpellNames: [],
          additionalAllowedSpellNames: [],
          restrictToCommon: true,
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef("ancestry-feat-level-1", "feat", "arcane-tattoos", "Arcane Tattoos", "ancestry"),
      draft,
      steps,
      {
        fetchSelectionDocument: async (selection) => ({
          toObject: () =>
            selection.itemType === "spell"
              ? {
                  name: "Shield",
                  type: "spell",
                  system: {
                    slug: "shield",
                  },
                }
              : {
                  _id: "feat-compendium",
                  name: "Arcane Tattoos",
                  type: "feat",
                  system: {
                    rules: [
                      {
                        key: "ChoiceSet",
                        flag: "arcaneTattoos",
                        choices: {
                          itemType: "spell",
                          slugsAsValues: true,
                        },
                      },
                    ],
                  },
                },
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "arcaneTattoos",
      selection: "shield",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      arcaneTattoos: "shield",
    });
  });

  it("preselects drafted feat-owned grant choices before creating the feat item", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["grant-choice-general-feat-general-training-generalTraining-level-1"] = selectionRef(
      "grant-choice-general-feat-general-training-generalTraining-level-1",
      "feat",
      "additional-lore",
      "Additional Lore",
      "general"
    );
    const steps: PendingStep[] = [
      {
        id: "grant-choice-general-feat-general-training-generalTraining-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "grant-choice",
        title: "General Training feat grant",
        description: "",
        required: true,
        slotId: "grant-choice-general-feat-general-training-generalTraining-level-1",
        filters: {
          itemType: "feat",
        },
        grantSelection: {
          slotId: "grant-choice-general-feat-general-training-generalTraining-level-1",
          sourceItemType: "feat",
          selectorPackId: "test.pack",
          selectorDocumentId: "general-training",
          selectorUuid: "Compendium.test.pack.Item.general-training",
          selectorName: "General Training",
          selectorRuleIndex: 0,
          grantRuleIndex: 1,
          flag: "generalTraining",
          itemType: "feat",
          classSlug: null,
          dependsOn: null,
          filters: {
            itemType: "feat",
          },
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef("ancestry-feat-level-1", "feat", "general-training", "General Training", "ancestry"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "feat-compendium",
            name: "General Training",
            type: "feat",
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "generalTraining",
                  choices: {
                    itemType: "feat",
                  },
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.generalTraining}",
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "generalTraining",
      selection: "Compendium.test.pack.Item.additional-lore",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      generalTraining: "Compendium.test.pack.Item.additional-lore",
    });
  });

  it("preselects drafted class-feature grant choices before creating the class feature item", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["grant-choice-none-classfeature-school-of-unified-magical-theory-feat-level-1"] = selectionRef(
      "grant-choice-none-classfeature-school-of-unified-magical-theory-feat-level-1",
      "feat",
      "counterspell-prepared",
      "Counterspell (Prepared)",
      "class"
    );
    const steps: PendingStep[] = [
      {
        id: "grant-choice-none-classfeature-school-of-unified-magical-theory-feat-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "grant-choice",
        title: "School of Unified Magical Theory feat grant",
        description: "",
        required: true,
        slotId: "grant-choice-none-classfeature-school-of-unified-magical-theory-feat-level-1",
        filters: {
          itemType: "feat",
        },
        grantSelection: {
          slotId: "grant-choice-none-classfeature-school-of-unified-magical-theory-feat-level-1",
          sourceItemType: "classfeature",
          selectorPackId: "test.pack",
          selectorDocumentId: "school-of-unified-magical-theory",
          selectorUuid: "Compendium.test.pack.Item.school-of-unified-magical-theory",
          selectorName: "School of Unified Magical Theory",
          selectorRuleIndex: 0,
          grantRuleIndex: 1,
          flag: "feat",
          itemType: "feat",
          classSlug: "wizard",
          dependsOn: null,
          filters: {
            itemType: "feat",
          },
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef(
        "class-branch-arcane-school-level-1",
        "feat",
        "school-of-unified-magical-theory",
        "School of Unified Magical Theory",
        "classfeature"
      ),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "class-feature-compendium",
            name: "School of Unified Magical Theory",
            type: "feat",
            system: {
              category: "classfeature",
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "feat",
                  choices: {
                    filter: ["item:type:feat", "item:trait:wizard", "item:level:1"],
                  },
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.feat}",
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "feat",
      selection: "Compendium.test.pack.Item.counterspell-prepared",
    });
    expect(source?.system?.rules?.[1]).toMatchObject({
      key: "GrantItem",
      uuid: "{item|flags.system.rulesSelections.feat}",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      feat: "Compendium.test.pack.Item.counterspell-prepared",
    });
  });

  it("preselects predicate-gated static grant choices before creating the source item", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["grant-choice-none-feat-molten-wit-feat-level-1"] = selectionRef(
      "grant-choice-none-feat-molten-wit-feat-level-1",
      "feat",
      "charming-liar",
      "Charming Liar",
      "skill"
    );
    const steps: PendingStep[] = [
      {
        id: "grant-choice-none-feat-molten-wit-feat-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "grant-choice",
        title: "Molten Wit feat grant",
        description: "",
        required: true,
        slotId: "grant-choice-none-feat-molten-wit-feat-level-1",
        filters: {
          itemType: "feat",
          packIds: ["pf2e.feats-srd"],
          uuids: ["Compendium.test.pack.Item.charming-liar"],
          uuidPredicates: {
            "Compendium.test.pack.Item.charming-liar": ["molten-wit:deception"],
          },
        },
        grantSelection: {
          slotId: "grant-choice-none-feat-molten-wit-feat-level-1",
          sourceItemType: "feat",
          selectorPackId: "test.pack",
          selectorDocumentId: "molten-wit",
          selectorUuid: "Compendium.test.pack.Item.molten-wit",
          selectorName: "Molten Wit",
          selectorRuleIndex: 2,
          grantRuleIndex: 3,
          flag: "feat",
          itemType: "feat",
          classSlug: null,
          dependsOn: null,
          filters: {
            itemType: "feat",
          },
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef("ancestry-feat-level-1", "feat", "molten-wit", "Molten Wit", "ancestry"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "molten-wit",
            name: "Molten Wit",
            type: "feat",
            system: {
              rules: [
                { key: "ChoiceSet", flag: "skill", rollOption: "molten-wit" },
                { key: "ActiveEffectLike" },
                {
                  key: "ChoiceSet",
                  flag: "feat",
                  choices: [
                    {
                      predicate: ["molten-wit:deception"],
                      value: "Compendium.test.pack.Item.charming-liar",
                    },
                  ],
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.feat}",
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[2]).toMatchObject({
      key: "ChoiceSet",
      flag: "feat",
      selection: "Compendium.test.pack.Item.charming-liar",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      feat: "Compendium.test.pack.Item.charming-liar",
    });
  });

  it("creates slotted feat sources and stamps source flags on the created items", async () => {
    const insertFeat = vi.fn(async () => [{ id: "created-feat-1" }]);
    const actor = {
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
      updateEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => [{ id: "created-feat-1" }]),
    };
    const selection = selectionRef("ancestry-feat-level-1", "feat", "adapted-cantrip", "Adapted Cantrip", "ancestry");
    const step = featStep("ancestry-feat-level-1", "ancestry-feat", 1, ["ancestry"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument: async () => ({
        id: "adapted-cantrip",
        name: "Adapted Cantrip",
        toObject: () => ({ name: "Adapted Cantrip", type: "feat", system: {} }),
      }),
      createEmbeddedSource: async () => ({
        name: "Adapted Cantrip",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(insertFeat).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Adapted Cantrip",
        type: "feat",
        system: {
          location: "ancestry-1",
          level: {
            taken: 1,
          },
        },
        flags: {},
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "created-feat-1",
        "flags.core.sourceId": selection.uuid,
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: selection.slotId,
      },
    ]);
  });

  it("preserves preselected feat sources during slotted feat creation", async () => {
    const insertFeat = vi.fn(async () => [{ id: "created-feat-1" }]);
    const actor = {
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
      updateEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => [{ id: "created-feat-1" }]),
    };
    const draft = createEmptyDraft(1);
    draft.spellChoices["spell-choice-feat-arcane-tattoos-cantrip-level-1"] = [
      selectionRef("spell-choice-feat-arcane-tattoos-cantrip-level-1", "spell", "shield", "Shield"),
    ];
    const selection = selectionRef("ancestry-feat-level-1", "feat", "arcane-tattoos", "Arcane Tattoos", "ancestry");
    const step = featStep("ancestry-feat-level-1", "ancestry-feat", 1, ["ancestry"]);
    const steps = [step, arcaneTattoosSpellStep()];

    await insertFeatSelection(
      actor,
      selection,
      step,
      {
        fetchSelectionDocument,
        createEmbeddedSource: (selection, draft, steps) =>
          createEmbeddedSource(selection, draft, steps, {
            fetchSelectionDocument,
            stripPreselectedClassFeatureEntries: vi.fn(),
            stripPreselectedClassBranchEntries: vi.fn(),
          }),
      },
      draft,
      steps
    );

    expect(insertFeat).not.toHaveBeenCalled();
    const createdSource = (actor.createEmbeddedDocuments.mock.calls as unknown[][])[0]?.[1]?.[0] as {
      system?: { rules?: unknown[] };
    };
    expect(createdSource.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "arcaneTattoos",
      selection: "shield",
    });
  });

  it("does not stamp PF2E grant children as the selected parent feat", async () => {
    const actor = {
      feats: {
        get: () => ({
          slots: {
            "ancestry-1": {
              id: "ancestry-1",
              level: 1,
              feat: null,
            },
          },
        }),
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => [
        { id: "created-parent-feat" },
        {
          id: "native-granted-child",
          flags: {
            core: {
              sourceId: "Compendium.pf2e.feats-srd.Item.forager",
            },
            pf2e: {
              grantedBy: {
                id: "created-parent-feat",
                onDelete: "cascade",
              },
            },
          },
        },
      ]),
    };
    const selection = selectionRef("ancestry-feat-level-1", "feat", "general-training", "General Training", "ancestry");
    const step = featStep("ancestry-feat-level-1", "ancestry-feat", 1, ["ancestry"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument,
      createEmbeddedSource: async () => ({
        name: "General Training",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "created-parent-feat",
        "flags.core.sourceId": selection.uuid,
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: selection.slotId,
      },
    ]);
  });

  it("does not stamp returned items from unrelated sources", async () => {
    const actor = {
      feats: {
        get: () => ({
          slots: {
            "ancestry-1": {
              id: "ancestry-1",
              level: 1,
              feat: null,
            },
          },
        }),
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => [
        {
          id: "created-granted-feat",
          type: "feat",
          flags: {
            core: {
              sourceId: "Compendium.test.pack.Item.community-knowledge",
            },
          },
        },
        {
          id: "returned-granter",
          type: "heritage",
          flags: {
            core: {
              sourceId: "Compendium.test.pack.Item.nascent",
            },
            [MODULE_ID]: {
              slotId: "heritage-level-1",
            },
          },
        },
      ]),
    };
    const selection = selectionRef(
      "grant-choice-none-heritage-nascent-nascent-level-1",
      "feat",
      "community-knowledge",
      "Community Knowledge",
      "ancestry"
    );
    const step = featStep("grant-choice-none-heritage-nascent-nascent-level-1", "grant-choice", 1, ["ancestry"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument,
      createEmbeddedSource: async () => ({
        name: "Community Knowledge",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "created-granted-feat",
        "flags.core.sourceId": selection.uuid,
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: selection.slotId,
      },
    ]);
  });

  it("restores singleton source slot flags when linking explicit grant items", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["heritage-level-1"] = selectionRef("heritage-level-1", "heritage", "nascent", "Nascent");
    draft.selections["grant-choice-none-heritage-nascent-nascent-level-1"] = selectionRef(
      "grant-choice-none-heritage-nascent-nascent-level-1",
      "feat",
      "community-knowledge",
      "Community Knowledge",
      "ancestry"
    );
    const step: PendingStep = {
      id: "grant-choice-none-heritage-nascent-nascent-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "grant-choice",
      title: "Nascent feat grant",
      description: "",
      required: true,
      slotId: "grant-choice-none-heritage-nascent-nascent-level-1",
      filters: {
        itemType: "feat",
      },
      grantSelection: {
        slotId: "grant-choice-none-heritage-nascent-nascent-level-1",
        sourceItemType: "heritage",
        selectorPackId: "test.pack",
        selectorDocumentId: "nascent",
        selectorUuid: "Compendium.test.pack.Item.nascent",
        selectorName: "Nascent",
        selectorRuleIndex: 0,
        grantRuleIndex: 1,
        flag: "nascent",
        itemType: "feat",
        classSlug: null,
        dependsOn: null,
        filters: {
          itemType: "feat",
        },
      },
    };
    const actor = {
      items: [
        {
          id: "heritage-id",
          type: "heritage",
          name: "Nascent",
          flags: {
            core: {
              sourceId: "Compendium.test.pack.Item.nascent",
            },
            [MODULE_ID]: {
              importedBy: MODULE_ID,
              slotId: "grant-choice-none-heritage-nascent-nascent-level-1",
            },
          },
        },
      ],
      createEmbeddedDocuments: vi.fn(async () => [{ id: "created-community-knowledge" }]),
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await createSingletonGrantItems(actor, draft, [step], {
      fetchSelectionDocument: async () => null,
      createEmbeddedSource: async () => ({
        name: "Community Knowledge",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "heritage-id",
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: "heritage-level-1",
        "flags.pf2e.itemGrants.nascent": {
          id: "created-community-knowledge",
          onDelete: "detach",
          nested: null,
        },
      },
    ]);
  });

  it("reconciles singleton source slot flags after later item updates", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["heritage-level-1"] = selectionRef("heritage-level-1", "heritage", "nascent", "Nascent");
    draft.selections["grant-choice-none-heritage-nascent-nascent-level-1"] = selectionRef(
      "grant-choice-none-heritage-nascent-nascent-level-1",
      "feat",
      "community-knowledge",
      "Community Knowledge",
      "ancestry"
    );
    const actor = {
      items: [
        {
          id: "heritage-id",
          type: "heritage",
          flags: {
            core: {
              sourceId: "Compendium.test.pack.Item.nascent",
            },
            [MODULE_ID]: {
              importedBy: MODULE_ID,
              slotId: "grant-choice-none-heritage-nascent-nascent-level-1",
            },
          },
        },
        {
          id: "granted-feat-id",
          type: "feat",
          flags: {
            core: {
              sourceId: "Compendium.test.pack.Item.community-knowledge",
            },
            [MODULE_ID]: {
              importedBy: MODULE_ID,
              slotId: "grant-choice-none-heritage-nascent-nascent-level-1",
            },
          },
        },
      ],
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await restoreSingletonSourceSlotFlags(actor, draft);

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "heritage-id",
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: "heritage-level-1",
      },
    ]);
  });

  it("creates prebuilt feat sources without copying readonly document properties", async () => {
    const insertFeat = vi.fn(async () => [{ id: "created-feat-1" }]);
    const fetchSelectionDocument = vi.fn(async () => {
      throw new Error("direct feat source creation should not fetch or wrap the original document");
    });
    const actor = {
      feats: {
        get: () => ({
          slots: {
            "ancestry-1": {
              id: "ancestry-1",
              level: 1,
              feat: null,
            },
          },
        }),
        insertFeat,
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => [{ id: "created-feat-1" }]),
    };
    const selection = selectionRef("ancestry-feat-level-1", "feat", "general-training", "General Training", "ancestry");
    const step = featStep("ancestry-feat-level-1", "ancestry-feat", 1, ["ancestry"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument,
      createEmbeddedSource: async () => ({
        name: "General Training",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(insertFeat).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "General Training",
        type: "feat",
        system: {
          location: "ancestry-1",
          level: {
            taken: 1,
          },
        },
        flags: {},
      },
    ]);
  });

  it("falls back to raw feat creation when PF2E slot insertion is unavailable", async () => {
    const actor = {
      feats: undefined,
      createEmbeddedDocuments: vi.fn(async () => []),
    };
    const selection = selectionRef("general-feat-level-3", "feat", "toughness", "Toughness", "general");
    const step = featStep("general-feat-level-3", "general-feat", 3, ["general"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument: async () => ({
        id: "toughness",
        name: "Toughness",
        toObject: () => ({ name: "Toughness", type: "feat", system: { location: null } }),
      }),
      createEmbeddedSource: async () => ({
        name: "Toughness",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Toughness",
        type: "feat",
        system: {
          location: "general",
          level: {
            taken: 3,
          },
        },
        flags: {},
      },
    ]);
  });

  it("orders selections by step order and detects existing source ids", () => {
    const draft = createEmptyDraft(1);
    draft.selections["class-feat-level-1"] = selectionRef(
      "class-feat-level-1",
      "feat",
      "power-attack",
      "Power Attack",
      "class"
    );
    draft.selections["class-level-1"] = selectionRef("class-level-1", "class", "fighter", "Fighter");
    draft.selections["background-level-1"] = selectionRef("background-level-1", "background", "scholar", "Scholar");
    const ordered = orderSelections(draft, [featStep("class-feat-level-1", "class-feat", 1, ["class"])]);

    expect(ordered.map((entry) => entry.slotId)).toEqual(["class-feat-level-1", "class-level-1", "background-level-1"]);
    expect(
      hasSourceId(
        {
          items: [
            {
              flags: {
                core: {
                  sourceId: "Compendium.test.pack.Item.power-attack",
                },
              },
            },
          ],
        },
        "Compendium.test.pack.Item.power-attack"
      )
    ).toBe(true);
  });
});

function selectionRef(
  slotId: string,
  itemType: string,
  documentId: string,
  name: string,
  featType: string | null = null
): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType,
    name,
    level: 1,
  };
}

function featStep(
  slotId: string,
  slotKind: Extract<PendingStep, { kind: "pick-item" }>["slotKind"],
  level: number,
  featTypes: string[]
): PendingStep {
  return {
    id: slotId,
    level,
    kind: "pick-item",
    slotKind,
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "feat",
      featTypes,
      maxLevel: level,
    },
  };
}

function flagChoiceStep(): PendingStep {
  return {
    id: "flag-choice-none-feat-multifarious-muse-muse-level-2",
    level: 2,
    kind: "pick-item",
    slotKind: "flag-choice",
    title: "Muse",
    description: "",
    required: true,
    slotId: "flag-choice-none-feat-multifarious-muse-muse-level-2",
    filters: {
      itemType: "feat",
      packIds: ["pf2e.classfeatures"],
      predicate: ["item:tag:bard-muse"],
    },
    flagChoice: {
      slotId: "flag-choice-none-feat-multifarious-muse-muse-level-2",
      sourceItemType: "feat",
      sourcePackId: "test.pack",
      sourceDocumentId: "multifarious-muse",
      sourceUuid: "Compendium.test.pack.Item.multifarious-muse",
      sourceName: "Multifarious Muse",
      sourceRuleIndex: 0,
      flag: "muse",
      prompt: null,
      itemType: "feat",
      selectionValue: "slug",
      dependsOn: null,
      filters: {
        itemType: "feat",
        packIds: ["pf2e.classfeatures"],
        predicate: ["item:tag:bard-muse"],
      },
    },
  };
}

function arcaneTattoosSpellStep(): PendingStep {
  return {
    id: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Arcane Tattoos",
    description: "",
    required: true,
    slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
    filters: {
      itemType: "spell",
    },
    spellChoice: {
      slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
      sourcePackId: "test.pack",
      sourceDocumentId: "arcane-tattoos",
      sourceUuid: "Compendium.test.pack.Item.arcane-tattoos",
      sourceName: "Arcane Tattoos",
      classSlug: null,
      dependsOn: null,
      destination: {
        type: "innate",
        key: "feat-arcane-tattoos-innate-arcane",
        label: "Innate arcane spells",
        entryName: "Innate Arcane Spells",
        tradition: "arcane",
        ability: "cha",
        prepared: "innate",
      },
      count: 1,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      allowedSpellSlugs: ["daze", "shield"],
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

async function fetchSelectionDocument(selection: SelectionRef) {
  return {
    id: selection.documentId,
    name: selection.name,
    toObject: () =>
      selection.itemType === "spell"
        ? {
            name: "Shield",
            type: "spell",
            system: {
              slug: "shield",
            },
          }
        : {
            _id: "feat-compendium",
            name: "Arcane Tattoos",
            type: "feat",
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "arcaneTattoos",
                  choices: {
                    itemType: "spell",
                    slugsAsValues: true,
                  },
                },
              ],
            },
          },
  };
}
