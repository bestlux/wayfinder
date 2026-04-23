import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import { buildSingletonChoiceStepsFromRules } from "../src/wayfinder/singleton-choice/step-builders";

describe("wayfinder singleton-choice step-builders", () => {
  it("builds singleton-choice steps from generic ChoiceSet rules", () => {
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
      sourceSelection: selection("background-level-1", "background", "sponsored-by-family", "Sponsored by Family"),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(steps).toMatchObject([
      {
        kind: "singleton-choice",
        slotId: "singleton-choice-background-sponsored-by-family-familyKeepsake-level-1",
        title: "Family Keepsake",
        description: "Choose your family keepsake",
        singletonChoice: {
          sourceName: "Sponsored by Family",
          sourceItemType: "background",
          flag: "familyKeepsake",
          options: [
            { value: "ring", label: "Ancestor's Ring" },
            { value: "crest", label: "Family Crest" },
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
              flag: "familyKeepsake",
              choices: [
                { value: "Compendium.pf2e.equipment-srd.Item.ancestors-ring", label: "Ancestor's Ring" },
                { value: "Compendium.pf2e.equipment-srd.Item.family-crest", label: "Family Crest" },
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
        slotId: "singleton-choice-background-sponsored-by-family-familyKeepsake-level-1",
        singletonChoice: {
          flag: "familyKeepsake",
          options: [
            { value: "Compendium.pf2e.equipment-srd.Item.ancestors-ring", label: "Ancestor's Ring" },
            { value: "Compendium.pf2e.equipment-srd.Item.family-crest", label: "Family Crest" },
          ],
        },
      },
    ]);
  });

  it("preserves explicit custom labels for generic array-backed choices", () => {
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
              flag: "courtFavor",
              choices: [{ value: "letter-of-introduction", label: "Letter of Introduction" }],
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
        slotId: "singleton-choice-background-court-sponsor-courtFavor-level-1",
        singletonChoice: {
          flag: "courtFavor",
          options: [{ value: "letter-of-introduction", label: "Letter of Introduction" }],
        },
      },
    ]);
  });

  it("skips heritage and background skill-or-lore choices so skill training owns them", () => {
    const backgroundSteps = buildSingletonChoiceStepsFromRules({
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
            {
              key: "ChoiceSet",
              flag: "familyLore",
              choices: [{ value: "Compendium.pf2e.classfeatures.Item.GenealogyLore", label: "Genealogy Lore" }],
            },
          ],
        },
      },
      sourceSelection: selection("background-level-1", "background", "sponsored-by-family", "Sponsored by Family"),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

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
      const heritageSteps = buildSingletonChoiceStepsFromRules({
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

      expect(backgroundSteps).toEqual([]);
      expect(heritageSteps).toEqual([]);
    } finally {
      globals.CONFIG = originalConfig;
    }
  });

  it("skips class-owned skill choices so they do not duplicate class training", () => {
    const steps = buildSingletonChoiceStepsFromRules({
      sourceItemType: "class",
      effectiveSourceDocument: {
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
      sourceSelection: selection("class-level-1", "class", "fighter", "Fighter"),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(steps).toEqual([]);
  });

  it("builds feat-owned generic choices while leaving feat skill choices to skill training", () => {
    const steps = buildSingletonChoiceStepsFromRules({
      sourceItemType: "feat",
      effectiveSourceDocument: {
        name: "Fighter Dedication",
        system: {
          slug: "fighter-dedication",
          level: { value: 2 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "attribute",
              prompt: "PF2E.SpecificRule.Prompt.ClassDCAbilityScore",
              choices: [
                { value: "str", label: "PF2E.AbilityStr" },
                { value: "dex", label: "PF2E.AbilityDex" },
              ],
            },
            {
              key: "ChoiceSet",
              flag: "skill",
              prompt: "PF2E.SpecificRule.Prompt.Skill",
              choices: [
                { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                { value: "athletics", label: "PF2E.Skill.Athletics" },
              ],
            },
          ],
        },
      },
      sourceSelection: selection(
        "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
        "feat",
        "fighter-dedication",
        "Fighter Dedication"
      ),
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) =>
        value
          .replace("PF2E.SpecificRule.Prompt.ClassDCAbilityScore", "Select the class DC's key attribute.")
          .replace("PF2E.AbilityStr", "Strength")
          .replace("PF2E.AbilityDex", "Dexterity")
          .replace(/^PF2E\.Skill\./, ""),
    });

    expect(steps).toMatchObject([
      {
        kind: "singleton-choice",
        level: 1,
        slotId: "singleton-choice-feat-fighter-dedication-attribute-level-1",
        title: "Attribute",
        description: "Select the class DC's key attribute.",
        singletonChoice: {
          sourceName: "Fighter Dedication",
          sourceItemType: "feat",
          flag: "attribute",
          options: [
            { value: "str", label: "Strength" },
            { value: "dex", label: "Dexterity" },
          ],
        },
      },
    ]);
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
