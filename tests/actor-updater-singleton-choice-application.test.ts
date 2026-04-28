import { describe, expect, it, vi } from "vitest";
import { applySingletonChoiceDraft } from "../src/actor-updater/singleton-choice-application";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";

describe("actor-updater singleton-choice application", () => {
  it("writes rulesSelections back to the owning singleton item", async () => {
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-background-sponsored-by-family-academySkill-level-1"] = "society";

    const actor = {
      items: {
        contents: [
          {
            id: "background-1",
            type: "background",
            name: "Sponsored by Family",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
              },
              pf2e: {
                rulesSelections: {},
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "academySkill",
                  choices: [
                    { value: "diplomacy", label: "Diplomacy" },
                    { value: "society", label: "Society" },
                  ],
                },
              ],
            },
          },
        ],
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await applySingletonChoiceDraft(actor as any, draft, [backgroundChoiceStep()]);

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "background-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "academySkill",
            choices: [
              { value: "diplomacy", label: "Diplomacy" },
              { value: "society", label: "Society" },
            ],
            selection: "society",
          },
        ],
        "flags.pf2e.rulesSelections.academySkill": "society",
      },
    ]);
  });
});

function backgroundChoiceStep(): PendingStep {
  return {
    id: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
    level: 1,
    kind: "singleton-choice",
    slotKind: "singleton-choice",
    title: "Academy Skill",
    description: "Choose your trained skill",
    required: true,
    slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
    singletonChoice: {
      slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
      sourceItemType: "background",
      sourcePackId: "pf2e.backgrounds",
      sourceDocumentId: "sponsored-by-family",
      sourceUuid: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
      sourceName: "Sponsored by Family",
      sourceRuleIndex: 0,
      flag: "academySkill",
      prompt: "Choose your trained skill",
      predicate: [],
      rollOption: null,
      options: [
        { value: "diplomacy", label: "Diplomacy", img: null, detail: null },
        { value: "society", label: "Society", img: null, detail: null },
      ],
    },
  };
}
