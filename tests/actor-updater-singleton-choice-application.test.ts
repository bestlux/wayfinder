import { describe, expect, it, vi } from "vitest";
import { applySingletonChoiceDraft } from "../src/actor-updater/singleton-choice-application";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";

describe("actor-updater singleton-choice application", () => {
  it("maps Awakened Animal's stable size draft back to the installed structured value", async () => {
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-ancestry-awakened-animal-choice-level-1"] = "tiny";
    const rules = awakenedAnimalRules();
    const actor = {
      items: {
        contents: [
          {
            id: "ancestry-1",
            type: "ancestry",
            flags: {
              core: { sourceId: "Compendium.pf2e.ancestries.Item.GFOgV3MzWkYwJoJW" },
              pf2e: { rulesSelections: {} },
            },
            system: { rules },
          },
        ],
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await applySingletonChoiceDraft(actor, draft, [awakenedAnimalChoiceStep()]);

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "ancestry-1",
        "system.rules": [{ ...rules[0], selection: { hitPoints: 6, size: "tiny" } }, rules[1], rules[2]],
        "flags.pf2e.rulesSelections.choice": { hitPoints: 6, size: "tiny" },
      },
    ]);
  });

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

  it("writes flag-choice selections back to the owning source item", async () => {
    const draft = createEmptyDraft(2);
    draft.selections["flag-choice-none-feat-multifarious-muse-muse-level-2"] = {
      slotId: "flag-choice-none-feat-multifarious-muse-muse-level-2",
      packId: "pf2e.classfeatures",
      documentId: "maestro",
      uuid: "Compendium.pf2e.classfeatures.Item.maestro",
      itemType: "feat",
      featType: "classfeature",
      name: "Maestro",
      level: 1,
      slug: "maestro",
    };

    const actor = {
      items: {
        contents: [
          {
            id: "feat-1",
            type: "feat",
            name: "Multifarious Muse",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.feats-srd.Item.multifarious-muse",
              },
              pf2e: {
                rulesSelections: {},
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "muse",
                  choices: {
                    filter: ["item:tag:bard-muse"],
                    slugsAsValues: true,
                  },
                },
              ],
            },
          },
        ],
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await applySingletonChoiceDraft(actor as any, draft, [flagChoiceStep()]);

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "feat-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "muse",
            choices: {
              filter: ["item:tag:bard-muse"],
              slugsAsValues: true,
            },
            selection: "maestro",
          },
        ],
        "flags.pf2e.rulesSelections.muse": "maestro",
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

function flagChoiceStep(): PendingStep {
  return {
    id: "flag-choice-none-feat-multifarious-muse-muse-level-2",
    level: 2,
    kind: "pick-item",
    slotKind: "flag-choice",
    title: "Muse",
    description: "",
    required: true,
    slotId: "flag-choice-none-feat-multifarious-muse-muse-level-2",
    filters: {
      itemType: "feat",
      packIds: ["pf2e.classfeatures"],
      predicate: ["item:tag:bard-muse"],
    },
    flagChoice: {
      slotId: "flag-choice-none-feat-multifarious-muse-muse-level-2",
      sourceItemType: "feat",
      sourcePackId: "pf2e.feats-srd",
      sourceDocumentId: "multifarious-muse",
      sourceUuid: "Compendium.pf2e.feats-srd.Item.multifarious-muse",
      sourceName: "Multifarious Muse",
      sourceRuleIndex: 0,
      flag: "muse",
      prompt: null,
      itemType: "feat",
      selectionValue: "slug",
      dependsOn: null,
      filters: {
        itemType: "feat",
        packIds: ["pf2e.classfeatures"],
        predicate: ["item:tag:bard-muse"],
      },
    },
  };
}

function awakenedAnimalChoiceStep(): PendingStep {
  return {
    id: "singleton-choice-ancestry-awakened-animal-choice-level-1",
    level: 1,
    kind: "singleton-choice",
    slotKind: "singleton-choice",
    title: "Creature Size",
    description: "Choose your size",
    required: true,
    slotId: "singleton-choice-ancestry-awakened-animal-choice-level-1",
    singletonChoice: {
      slotId: "singleton-choice-ancestry-awakened-animal-choice-level-1",
      sourceItemType: "ancestry",
      sourcePackId: "pf2e.ancestries",
      sourceDocumentId: "GFOgV3MzWkYwJoJW",
      sourceUuid: "Compendium.pf2e.ancestries.Item.GFOgV3MzWkYwJoJW",
      sourceName: "Awakened Animal",
      sourceRuleIndex: 0,
      flag: "choice",
      prompt: "Creature Size",
      predicate: [],
      rollOption: null,
      options: [
        { value: "large", label: "Large", img: null, detail: null },
        { value: "medium", label: "Medium", img: null, detail: null },
        { value: "small", label: "Small", img: null, detail: null },
        { value: "tiny", label: "Tiny", img: null, detail: null },
      ],
    },
  };
}

function awakenedAnimalRules(): Array<Record<string, unknown>> {
  return [
    {
      key: "ChoiceSet",
      flag: "choice",
      adjustName: false,
      prompt: "PF2E.SpecificRule.Prompt.CreatureSize",
      choices: [
        { label: "PF2E.ActorSizeLarge", value: { hitPoints: 10, size: "large" } },
        { label: "PF2E.ActorSizeMedium", value: { hitPoints: 8, size: "medium" } },
        { label: "PF2E.ActorSizeSmall", value: { hitPoints: 6, size: "small" } },
        { label: "PF2E.ActorSizeTiny", value: { hitPoints: 6, size: "tiny" } },
      ],
    },
    { key: "CreatureSize", value: "{item|flags.system.rulesSelections.choice.size}" },
    {
      key: "ActiveEffectLike",
      mode: "upgrade",
      path: "system.attributes.ancestryhp",
      priority: 51,
      value: "{item|flags.system.rulesSelections.choice.hitPoints}",
    },
  ];
}
