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
