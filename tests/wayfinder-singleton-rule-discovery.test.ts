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
                { value: "genealogy", label: "Genealogy Lore" },
                { value: "magaambya", label: "Magaambya Lore" },
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
          { value: "genealogy", label: "Genealogy Lore" },
          { value: "magaambya", label: "Magaambya Lore" },
        ],
      },
    ]);
  });
});
