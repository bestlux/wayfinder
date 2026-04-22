import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import { buildSingletonChoiceStepsFromRules } from "../src/wayfinder/singleton-choice/step-builders";

describe("wayfinder singleton-choice step-builders", () => {
  it("builds singleton-choice steps from singleton document rules", () => {
    const steps = buildSingletonChoiceStepsFromRules({
      sourceItemType: "background",
      effectiveSourceDocument: {
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
          ],
        },
      },
      sourceSelection: selection("background-level-1", "background", "sponsored-by-family", "Sponsored by Family"),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(steps).toMatchObject([
      {
        kind: "singleton-choice",
        slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
        title: "Academy Skill",
        description: "Choose your trained skill",
        singletonChoice: {
          sourceName: "Sponsored by Family",
          sourceItemType: "background",
          flag: "academySkill",
          options: [
            { value: "diplomacy", label: "Diplomacy" },
            { value: "society", label: "Society" },
          ],
        },
      },
    ]);
  });

  it("preserves generic ChoiceSet values verbatim when building singleton-choice steps", () => {
    const steps = buildSingletonChoiceStepsFromRules({
      sourceItemType: "background",
      effectiveSourceDocument: {
        name: "Sponsored by Family",
        system: {
          slug: "sponsored-by-family",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "familyLore",
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
      sourceSelection: selection("background-level-1", "background", "sponsored-by-family", "Sponsored by Family"),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
    });

    expect(steps).toMatchObject([
      {
        kind: "singleton-choice",
        slotId: "singleton-choice-background-sponsored-by-family-familyLore-level-1",
        singletonChoice: {
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
      },
    ]);
  });

  it("preserves explicit custom labels for array-backed skill choices", () => {
    const steps = buildSingletonChoiceStepsFromRules({
      sourceItemType: "background",
      effectiveSourceDocument: {
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
      sourceSelection: selection("background-level-1", "background", "court-sponsor", "Court Sponsor"),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(steps).toMatchObject([
      {
        kind: "singleton-choice",
        slotId: "singleton-choice-background-court-sponsor-courtSkill-level-1",
        singletonChoice: {
          flag: "courtSkill",
          options: [{ value: "diplomacy", label: "Courtly Etiquette" }],
        },
      },
    ]);
  });

  it("builds singleton-choice steps from configured skill ChoiceSet rules", () => {
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
      const steps = buildSingletonChoiceStepsFromRules({
        sourceItemType: "heritage",
        effectiveSourceDocument: {
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
        sourceSelection: selection("heritage-level-1", "heritage", "skilled-human", "Skilled Human"),
        extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
        localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      });

      expect(steps).toMatchObject([
        {
          kind: "singleton-choice",
          slotId: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
          title: "Trained Skill",
          singletonChoice: {
            sourceItemType: "heritage",
            flag: "trainedSkill",
            options: [
              { value: "arcana", label: "Arcana" },
              { value: "athletics", label: "Athletics" },
            ],
          },
        },
      ]);
    } finally {
      globals.CONFIG = originalConfig;
    }
  });
});

function selection(slotId: string, itemType: string, documentId: string, name = documentId): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: null,
    name,
    level: 1,
  };
}
