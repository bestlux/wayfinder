import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import { discoverSingletonChoiceMeta } from "../src/wayfinder/singleton-choice/rule-discovery";

const extractSlug = (document: { system?: { slug?: string } } | null | undefined) => document?.system?.slug ?? null;

const sourceSelection: SelectionRef = {
  slotId: "background-level-1",
  packId: "pf2e.backgrounds",
  documentId: "sponsored-by-family",
  uuid: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
  itemType: "background",
  featType: null,
  name: "Sponsored by Family",
  level: 1,
};

describe("wayfinder singleton rule discovery", () => {
  it("discovers generic singleton choice metadata from direct-document ChoiceSet rules", () => {
    const choices = discoverSingletonChoiceMeta({
      sourceItemType: "background",
      sourceDocument: {
        name: "Sponsored by Family",
        system: {
          slug: "sponsored-by-family",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "familyKeepsake",
              prompt: "Choose your family keepsake",
              choices: [
                { value: "ring", label: "Ancestor's Ring" },
                { value: "crest", label: "Family Crest" },
              ],
            },
          ],
        },
      },
      sourceSelection,
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(choices).toMatchObject([
      {
        slotId: "singleton-choice-background-sponsored-by-family-familyKeepsake-level-1",
        sourceItemType: "background",
        flag: "familyKeepsake",
        prompt: "Choose your family keepsake",
        options: [
          { value: "ring", label: "Ancestor's Ring" },
          { value: "crest", label: "Family Crest" },
        ],
      },
    ]);
  });

  it("skips background skill and lore ChoiceSet rules so skill training owns them", () => {
    const choices = discoverSingletonChoiceMeta({
      sourceItemType: "background",
      sourceDocument: {
        name: "Sponsored by Family",
        system: {
          slug: "sponsored-by-family",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "academySkill",
              prompt: "Choose your trained skill",
              choices: [
                { value: "diplomacy", label: "PF2E.Skill.Diplomacy" },
                { value: "society", label: "PF2E.Skill.Society" },
              ],
            },
            {
              key: "ChoiceSet",
              slug: "familyLore",
              choices: [
                {
                  value: "Compendium.pf2e.classfeatures.Item.GenealogyLore",
                  label: "Genealogy Lore",
                },
                {
                  value: "Compendium.pf2e.classfeatures.Item.MagaambyaLore",
                  label: "Magaambya Lore",
                },
              ],
            },
          ],
        },
      },
      sourceSelection,
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(choices).toEqual([]);
  });

  it("skips ChoiceSet rules that are grant selectors", () => {
    const choices = discoverSingletonChoiceMeta({
      sourceItemType: "background",
      sourceDocument: {
        name: "Wanderlust",
        system: {
          slug: "wanderlust",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "feat",
              prompt: "PF2E.SpecificRule.Prompt.SkillFeat",
              choices: [
                { value: "Compendium.pf2e.feats-srd.Item.Overclock Senses" },
                { value: "Compendium.pf2e.feats-srd.Item.Titan Swing" },
              ],
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.feat}",
            },
          ],
        },
      },
      sourceSelection: {
        ...sourceSelection,
        documentId: "wanderlust",
        uuid: "Compendium.pf2e.backgrounds.Item.wanderlust",
        name: "Wanderlust",
      },
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(choices).toEqual([]);
  });

  it("skips configured skill choices from singleton ChoiceSet config rules", () => {
    const globals = globalThis as typeof globalThis & {
      CONFIG?: {
        PF2E?: {
          skills?: Record<string, { label: string }>;
        };
      };
    };
    const originalConfig = globals.CONFIG;
    globals.CONFIG = {
      ...(originalConfig ?? {}),
      PF2E: {
        ...(originalConfig?.PF2E ?? {}),
        skills: {
          arcana: { label: "PF2E.Skill.Arcana" },
          athletics: { label: "PF2E.Skill.Athletics" },
        },
      },
    };

    try {
      const choices = discoverSingletonChoiceMeta({
        sourceItemType: "heritage",
        sourceDocument: {
          name: "Skilled Human",
          system: {
            slug: "skilled-human",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "trainedSkill",
                prompt: "PF2E.SpecificRule.Prompt.Skill",
                choices: {
                  config: "skills",
                },
              },
            ],
          },
        },
        sourceSelection: {
          ...sourceSelection,
          slotId: "heritage-level-1",
          packId: "pf2e.heritages",
          documentId: "skilled-human",
          uuid: "Compendium.pf2e.heritages.Item.skilled-human",
          itemType: "heritage",
          name: "Skilled Human",
        },
        extractSlug,
        localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      });

      expect(choices).toEqual([]);
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("preserves explicit custom labels for generic array-backed choices", () => {
    const choices = discoverSingletonChoiceMeta({
      sourceItemType: "background",
      sourceDocument: {
        name: "Court Sponsor",
        system: {
          slug: "court-sponsor",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "courtFavor",
              choices: [{ value: "letter-of-introduction", label: "Letter of Introduction" }],
            },
          ],
        },
      },
      sourceSelection: {
        ...sourceSelection,
        documentId: "court-sponsor",
        uuid: "Compendium.pf2e.backgrounds.Item.court-sponsor",
        name: "Court Sponsor",
      },
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(choices).toMatchObject([
      {
        slotId: "singleton-choice-background-court-sponsor-courtFavor-level-1",
        options: [{ value: "letter-of-introduction", label: "Letter of Introduction" }],
      },
    ]);
  });

  it("skips class-owned skill ChoiceSet rules so class training owns them", () => {
    const choices = discoverSingletonChoiceMeta({
      sourceItemType: "class",
      sourceDocument: {
        name: "Fighter",
        system: {
          slug: "fighter",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "fighterSkill",
              prompt: "Choose a skill",
              choices: [
                { value: "athletics", label: "PF2E.Skill.Athletics" },
                { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
              ],
            },
          ],
        },
      },
      sourceSelection: {
        ...sourceSelection,
        slotId: "class-level-1",
        packId: "pf2e.classes",
        documentId: "fighter",
        uuid: "Compendium.pf2e.classes.Item.fighter",
        itemType: "class",
        name: "Fighter",
      },
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(choices).toEqual([]);
  });
});
