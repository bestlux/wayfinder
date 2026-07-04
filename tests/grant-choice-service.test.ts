import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { buildGrantChoiceSteps } from "../src/wayfinder/grant-choice-service";

describe("grant-choice-service", () => {
  it("holds class-dependent grant choices until the class anchor exists", async () => {
    const draft = createEmptyDraft(1);
    const sourceSelection = {
      slotId: "heritage-level-1",
      packId: "pf2e.heritages",
      documentId: "ancient-elf",
      uuid: "Compendium.pf2e.heritages.Item.ancient-elf",
      itemType: "heritage",
      featType: null,
      name: "Ancient Elf",
      level: 1,
    };
    const sourceDocument = {
      name: "Ancient Elf",
      system: {
        slug: "ancient-elf",
        level: { value: 1 },
        rules: [
          {
            key: "ChoiceSet",
            flag: "ancientElf",
            choices: {
              itemType: "feat",
              filter: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
            },
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.ancientElf}",
          },
        ],
      },
    };

    const hidden = await buildGrantChoiceSteps({
      draft,
      targetLevel: 1,
      hasClassSelection: false,
      hasDeitySelection: false,
      sources: [
        {
          sourceItemType: "heritage",
          sourceSelection,
          sourceDocument,
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingGrantedSelection: () => null,
    });

    const visible = await buildGrantChoiceSteps({
      draft,
      targetLevel: 1,
      hasClassSelection: true,
      hasDeitySelection: false,
      sources: [
        {
          sourceItemType: "heritage",
          sourceSelection,
          sourceDocument,
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingGrantedSelection: () => null,
    });

    expect(hidden).toEqual([]);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.slotId).toBe("grant-choice-class-heritage-ancient-elf-ancientElf-level-1");
  });

  it("skips an already resolved grant step unless the draft overrides it", async () => {
    const draft = createEmptyDraft(1);
    const steps = await buildGrantChoiceSteps({
      draft,
      targetLevel: 1,
      hasClassSelection: true,
      hasDeitySelection: false,
      sources: [
        {
          sourceItemType: "heritage",
          sourceSelection: {
            slotId: "heritage-level-1",
            packId: "pf2e.heritages",
            documentId: "ancient-elf",
            uuid: "Compendium.pf2e.heritages.Item.ancient-elf",
            itemType: "heritage",
            featType: null,
            name: "Ancient Elf",
            level: 1,
          },
          sourceDocument: {
            name: "Ancient Elf",
            system: {
              slug: "ancient-elf",
              level: { value: 1 },
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "ancientElf",
                  choices: {
                    itemType: "feat",
                    filter: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
                  },
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.ancientElf}",
                },
              ],
            },
          },
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingGrantedSelection: () => "Compendium.pf2e.feats-srd.Item.wizard-dedication",
    });

    expect(steps).toEqual([]);
  });

  it("holds predicate-gated static grants until the source roll-option choice is drafted", async () => {
    const draft = createEmptyDraft(1);
    const sourceSelection = {
      slotId: "ancestry-feat-level-1",
      packId: "pf2e.feats-srd",
      documentId: "molten-wit",
      uuid: "Compendium.pf2e.feats-srd.Item.molten-wit",
      itemType: "feat",
      featType: "ancestry",
      name: "Molten Wit",
      level: 1,
    };
    const sourceDocument = {
      name: "Molten Wit",
      system: {
        slug: "molten-wit",
        level: { value: 1 },
        rules: [
          {
            key: "ChoiceSet",
            flag: "skill",
            rollOption: "molten-wit",
            choices: [
              { value: "deception", predicate: ["skill:deception:rank:0"] },
              { value: "diplomacy", predicate: ["skill:diplomacy:rank:0"] },
            ],
          },
          {
            key: "ActiveEffectLike",
            path: "system.skills.{item|flags.system.rulesSelections.skill}.rank",
            predicate: [{ or: ["molten-wit:deception", "molten-wit:diplomacy"] }],
            value: 1,
          },
          {
            key: "ChoiceSet",
            flag: "feat",
            choices: [
              {
                predicate: ["molten-wit:deception"],
                value: "Compendium.pf2e.feats-srd.Item.Charming Liar",
              },
              {
                predicate: ["molten-wit:diplomacy"],
                value: "Compendium.pf2e.feats-srd.Item.Group Impression",
              },
            ],
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.feat}",
          },
        ],
      },
    };
    const buildSteps = () =>
      buildGrantChoiceSteps({
        draft,
        targetLevel: 1,
        hasClassSelection: true,
        hasDeitySelection: false,
        sources: [
          {
            sourceItemType: "feat",
            sourceSelection,
            sourceDocument,
          },
        ],
        extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
        readExistingGrantedSelection: () => null,
      });

    await expect(buildSteps()).resolves.toEqual([]);

    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: {
        "feat:molten-wit:skill": "deception",
      },
      additional: [],
      loreChoices: {},
    };

    const visible = await buildSteps();

    expect(visible).toHaveLength(1);
    expect(visible[0]?.slotId).toBe("grant-choice-none-feat-molten-wit-feat-level-1");
    expect(visible[0]?.filters).toMatchObject({
      uuids: ["Compendium.pf2e.feats-srd.Item.Charming Liar", "Compendium.pf2e.feats-srd.Item.Group Impression"],
      uuidPredicates: {
        "Compendium.pf2e.feats-srd.Item.Charming Liar": ["molten-wit:deception"],
        "Compendium.pf2e.feats-srd.Item.Group Impression": ["molten-wit:diplomacy"],
      },
    });
  });

  it("recognizes source singleton roll-option choices when timing predicate-gated static grants", async () => {
    const draft = createEmptyDraft(1);
    const sourceSelection = {
      slotId: "heritage-level-1",
      packId: "pf2e.heritages",
      documentId: "emberkin",
      uuid: "Compendium.pf2e.heritages.Item.emberkin",
      itemType: "heritage",
      featType: null,
      name: "Emberkin",
      level: 1,
    };
    const sourceDocument = {
      name: "Emberkin",
      system: {
        slug: "emberkin",
        level: { value: 1 },
        rules: [
          {
            key: "ChoiceSet",
            flag: "path",
            rollOption: "emberkin",
            choices: [{ value: "fire", label: "Fire" }],
          },
          {
            key: "ChoiceSet",
            flag: "feat",
            choices: [
              {
                predicate: ["emberkin:fire"],
                value: "Compendium.pf2e.feats-srd.Item.Bonfire Soul",
              },
            ],
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.feat}",
          },
        ],
      },
    };
    const buildSteps = () =>
      buildGrantChoiceSteps({
        draft,
        targetLevel: 1,
        hasClassSelection: true,
        hasDeitySelection: false,
        sources: [
          {
            sourceItemType: "heritage",
            sourceSelection,
            sourceDocument,
          },
        ],
        extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
        readExistingGrantedSelection: () => null,
      });

    await expect(buildSteps()).resolves.toEqual([]);

    draft.singletonChoices["singleton-choice-heritage-emberkin-path-level-1"] = "fire";

    await expect(buildSteps()).resolves.toHaveLength(1);
  });

  it("supports static UUID grants from newly allowed official packs", async () => {
    const draft = createEmptyDraft(1);
    const steps = await buildGrantChoiceSteps({
      draft,
      targetLevel: 1,
      hasClassSelection: true,
      hasDeitySelection: false,
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: {
            slotId: "class-feat-level-1",
            packId: "pf2e.feats-srd",
            documentId: "spell-grant",
            uuid: "Compendium.pf2e.feats-srd.Item.spell-grant",
            itemType: "feat",
            featType: "class",
            name: "Spell Grant",
            level: 1,
          },
          sourceDocument: staticGrantDocument("spell-grant", [
            "Compendium.pf2e.spells-srd.Item.Shield",
            "Compendium.pf2e.spells-srd.Item.Guidance",
          ]),
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingGrantedSelection: () => null,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]?.filters).toMatchObject({
      itemType: "spell",
      packIds: ["pf2e.spells-srd"],
      uuids: ["Compendium.pf2e.spells-srd.Item.Shield", "Compendium.pf2e.spells-srd.Item.Guidance"],
    });
  });

  it("rejects static UUID grants with mixed item types", async () => {
    const draft = createEmptyDraft(1);
    const steps = await buildGrantChoiceSteps({
      draft,
      targetLevel: 1,
      hasClassSelection: true,
      hasDeitySelection: false,
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: {
            slotId: "class-feat-level-1",
            packId: "pf2e.feats-srd",
            documentId: "mixed-grant",
            uuid: "Compendium.pf2e.feats-srd.Item.mixed-grant",
            itemType: "feat",
            featType: "class",
            name: "Mixed Grant",
            level: 1,
          },
          sourceDocument: staticGrantDocument("mixed-grant", [
            "Compendium.pf2e.spells-srd.Item.Shield",
            "Compendium.pf2e.feats-srd.Item.Reactive Strike",
          ]),
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingGrantedSelection: () => null,
    });

    expect(steps).toEqual([]);
  });
});

function staticGrantDocument(slug: string, uuids: string[]): unknown {
  return {
    name: slug,
    system: {
      slug,
      level: { value: 1 },
      rules: [
        {
          key: "ChoiceSet",
          flag: "grant",
          choices: uuids.map((value) => ({ value })),
        },
        {
          key: "GrantItem",
          uuid: "{item|flags.system.rulesSelections.grant}",
        },
      ],
    },
  };
}
