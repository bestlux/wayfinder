import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import { buildSingletonChoiceSteps } from "../src/wayfinder/singleton-choice-service";

describe("singleton-choice-service", () => {
  it("skips singleton-choice steps already resolved on the actor unless the draft overrides them", async () => {
    const draft = createEmptyDraft(1);
    const sources = [
      {
        sourceItemType: "background" as const,
        sourceSelection: selection("background-level-1", "background", "sponsored-by-family", "Sponsored by Family"),
        sourceDocument: {
          name: "Sponsored by Family",
          system: {
            slug: "sponsored-by-family",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "familyKeepsake",
                choices: [
                  { value: "ring", label: "Ancestor's Ring" },
                  { value: "crest", label: "Family Crest" },
                ],
              },
            ],
          },
        },
      },
    ];

    const skipped = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources,
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: () => "crest",
    });

    expect(skipped).toEqual([]);

    draft.singletonChoices["singleton-choice-background-sponsored-by-family-familyKeepsake-level-1"] = "ring";

    const retained = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources,
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: () => "crest",
    });

    expect(retained).toHaveLength(1);
    expect(retained[0]?.kind).toBe("singleton-choice");
  });

  it("does not build singleton-choice steps for class-owned skill choices", async () => {
    const draft = createEmptyDraft(1);

    const steps = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources: [
        {
          sourceItemType: "class" as const,
          sourceSelection: selection("class-level-1", "class", "fighter", "Fighter"),
          sourceDocument: {
            name: "Fighter",
            system: {
              slug: "fighter",
              level: { value: 1 },
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "fighterSkill",
                  choices: [
                    { value: "athletics", label: "Athletics" },
                    { value: "acrobatics", label: "Acrobatics" },
                  ],
                },
              ],
            },
          },
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: () => null,
    });

    expect(steps).toEqual([]);
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
