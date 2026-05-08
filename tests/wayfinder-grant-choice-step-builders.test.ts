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

  it.each([
    {
      sourceItemType: "heritage" as const,
      sourceName: "Nascent",
      sourceSlug: "nascent",
      sourceDocumentId: "nascent",
      sourcePackId: "pf2e.heritages",
      sourceSlotId: "heritage-level-1",
      sourceSelectionItemType: "heritage",
      flag: "nascent",
      filter: ["item:level:1", "item:category:ancestry", "item:trait:kashrishi"],
      expectedSlotId: "grant-choice-none-heritage-nascent-nascent-level-1",
      expectedDependsOn: null,
    },
    {
      sourceItemType: "feat" as const,
      sourceName: "General Training",
      sourceSlug: "general-training",
      sourceDocumentId: "general-training",
      sourcePackId: "pf2e.feats-srd",
      sourceSlotId: "ancestry-feat-level-1",
      sourceSelectionItemType: "feat",
      flag: "feat",
      filter: ["item:level:1", "item:trait:general"],
      expectedSlotId: "grant-choice-none-feat-general-training-feat-level-1",
      expectedDependsOn: null,
    },
    {
      sourceItemType: "feat" as const,
      sourceName: "Natural Ambition",
      sourceSlug: "natural-ambition",
      sourceDocumentId: "natural-ambition",
      sourcePackId: "pf2e.feats-srd",
      sourceSlotId: "ancestry-feat-level-1",
      sourceSelectionItemType: "feat",
      flag: "naturalAmbition",
      filter: [
        "item:level:1",
        "item:category:class",
        "item:trait:{actor|system.details.class.trait}",
        { or: ["feature:dragon-instinct", { not: "item:draconic-arrogance" }] },
        { nor: ["item:animal-companion", "item:bardic-lore"] },
      ],
      expectedSlotId: "grant-choice-class-feat-natural-ambition-naturalAmbition-level-1",
      expectedDependsOn: "class" as const,
    },
    {
      sourceItemType: "classfeature" as const,
      sourceName: "School of Unified Magical Theory",
      sourceSlug: "school-of-unified-magical-theory",
      sourceDocumentId: "school-of-unified-magical-theory",
      sourcePackId: "pf2e.classfeatures",
      sourceSlotId: "class-branch-arcane-school-level-1",
      sourceSelectionItemType: "feat",
      flag: "feat",
      filter: ["item:type:feat", "item:trait:wizard", "item:level:1"],
      expectedSlotId: "grant-choice-class-classfeature-school-of-unified-magical-theory-feat-level-1",
      expectedDependsOn: "class" as const,
    },
  ])("builds a grant-choice step from the real $sourceName rule shape", (testCase) => {
    const steps = buildGrantChoiceStepsFromRules({
      sourceItemType: testCase.sourceItemType,
      effectiveSourceDocument: {
        name: testCase.sourceName,
        system: {
          slug: testCase.sourceSlug,
          level: { value: 1 },
          rules: [
            {
              adjustName: false,
              choices: {
                filter: testCase.filter,
                itemType: "feat",
              },
              flag: testCase.flag,
              key: "ChoiceSet",
            },
            {
              key: "GrantItem",
              uuid: `{item|flags.system.rulesSelections.${testCase.flag}}`,
            },
          ],
        },
      },
      sourceSelection: {
        slotId: testCase.sourceSlotId,
        packId: testCase.sourcePackId,
        documentId: testCase.sourceDocumentId,
        uuid: `Compendium.${testCase.sourcePackId}.Item.${testCase.sourceDocumentId}`,
        itemType: testCase.sourceSelectionItemType,
        featType:
          testCase.sourceSelectionItemType === "feat"
            ? testCase.sourceItemType === "classfeature"
              ? "classfeature"
              : "ancestry"
            : null,
        name: testCase.sourceName,
        level: 1,
      },
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
    });

    expect(steps).toMatchObject([
      {
        slotId: testCase.expectedSlotId,
        filters: {
          itemType: "feat",
          predicate: testCase.filter,
        },
        grantSelection: {
          sourceItemType: testCase.sourceItemType,
          dependsOn: testCase.expectedDependsOn,
          flag: testCase.flag,
        },
      },
    ]);
  });
});
