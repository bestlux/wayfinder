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
});
