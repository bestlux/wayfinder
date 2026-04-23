import { describe, expect, it } from "vitest";
import { buildGrantChoiceStepsFromRules } from "../src/wayfinder/grant-choice/step-builders";

describe("wayfinder grant choice step builders", () => {
  it("builds a class-dependent grant-choice step for Ancient Elf", () => {
    const steps = buildGrantChoiceStepsFromRules({
      sourceItemType: "heritage",
      effectiveSourceDocument: {
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
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
    });

    expect(steps).toMatchObject([
      {
        kind: "pick-item",
        slotKind: "grant-choice",
        slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
        filters: {
          itemType: "feat",
          predicate: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
        },
        grantSelection: {
          sourceItemType: "heritage",
          dependsOn: "class",
          flag: "ancientElf",
          itemType: "feat",
        },
      },
    ]);
  });

  it("builds a generic feat grant step for Versatile Human", () => {
    const steps = buildGrantChoiceStepsFromRules({
      sourceItemType: "heritage",
      effectiveSourceDocument: {
        name: "Versatile Human",
        system: {
          slug: "versatile-human",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "versatileHeritage",
              choices: {
                itemType: "feat",
                filter: ["item:level:1", "item:trait:general"],
              },
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.versatileHeritage}",
            },
          ],
        },
      },
      sourceSelection: {
        slotId: "heritage-level-1",
        packId: "pf2e.heritages",
        documentId: "versatile-human",
        uuid: "Compendium.pf2e.heritages.Item.versatile-human",
        itemType: "heritage",
        featType: null,
        name: "Versatile Human",
        level: 1,
      },
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
    });

    expect(steps).toMatchObject([
      {
        slotId: "grant-choice-none-heritage-versatile-human-versatileHeritage-level-1",
        grantSelection: {
          sourceItemType: "heritage",
          dependsOn: null,
          flag: "versatileHeritage",
        },
      },
    ]);
  });
});
