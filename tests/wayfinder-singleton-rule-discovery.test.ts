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
  it("discovers singleton choice metadata from direct-document ChoiceSet rules", () => {
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

    expect(choices).toMatchObject([
      {
        slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
        sourceItemType: "background",
        flag: "academySkill",
        prompt: "Choose your trained skill",
        options: [
          { value: "diplomacy", label: "Diplomacy" },
          { value: "society", label: "Society" },
        ],
      },
      {
        slotId: "singleton-choice-background-sponsored-by-family-familyLore-level-1",
        sourceItemType: "background",
        flag: "familyLore",
        options: [
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
    ]);
  });

  it("discovers configured skill choices from singleton ChoiceSet config rules", () => {
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

      expect(choices).toMatchObject([
        {
          slotId: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
          flag: "trainedSkill",
          prompt: "PF2E.SpecificRule.Prompt.Skill",
          options: [
            { value: "arcana", label: "Arcana" },
            { value: "athletics", label: "Athletics" },
          ],
        },
      ]);
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("preserves explicit custom labels for array-backed skill choices", () => {
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
              flag: "courtSkill",
              choices: [{ value: "diplomacy", label: "Courtly Etiquette" }],
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
        slotId: "singleton-choice-background-court-sponsor-courtSkill-level-1",
        options: [{ value: "diplomacy", label: "Courtly Etiquette" }],
      },
    ]);
  });
});
