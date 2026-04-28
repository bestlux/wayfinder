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

  it("only renders predicate-gated singleton follow-up choices after their upstream choice is selected", async () => {
    const draft = createEmptyDraft(1);
    const sources = [
      {
        sourceItemType: "background" as const,
        sourceSelection: selection("background-level-1", "background", "magical-experiment", "Magical Experiment"),
        sourceDocument: magicalExperimentDocument(),
      },
    ];

    const initialSteps = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources,
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: () => null,
    });

    expect(initialSteps.map((step) => step.slotId)).toEqual([
      "singleton-choice-background-magical-experiment-magicalExperiment-level-1",
    ]);

    draft.singletonChoices["singleton-choice-background-magical-experiment-magicalExperiment-level-1"] =
      "resistant-skin";

    const resistantSkinSteps = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources,
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: () => null,
    });

    expect(resistantSkinSteps.map((step) => step.slotId)).toEqual([
      "singleton-choice-background-magical-experiment-magicalExperiment-level-1",
      "singleton-choice-background-magical-experiment-energy1-level-1",
      "singleton-choice-background-magical-experiment-energy2-level-1",
    ]);
  });

  it("uses actor-existing singleton selections when evaluating follow-up predicates", async () => {
    const draft = createEmptyDraft(1);
    const sources = [
      {
        sourceItemType: "background" as const,
        sourceSelection: selection("background-level-1", "background", "magical-experiment", "Magical Experiment"),
        sourceDocument: magicalExperimentDocument(),
      },
    ];

    const steps = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources,
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: (choice) =>
        choice.slotId === "singleton-choice-background-magical-experiment-magicalExperiment-level-1"
          ? "resistant-skin"
          : null,
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "singleton-choice-background-magical-experiment-energy1-level-1",
      "singleton-choice-background-magical-experiment-energy2-level-1",
    ]);
  });

  it("does not let stale hidden follow-up selections activate deeper singleton choices", async () => {
    const draft = createEmptyDraft(1);
    draft.singletonChoices["singleton-choice-background-magical-experiment-magicalExperiment-level-1"] =
      "resistant-skin";
    draft.singletonChoices[
      "singleton-choice-background-magical-experiment-background:magical-experiment:enhanced-senses-level-1"
    ] = "scent";
    const sources = [
      {
        sourceItemType: "background" as const,
        sourceSelection: selection("background-level-1", "background", "magical-experiment", "Magical Experiment"),
        sourceDocument: magicalExperimentDocument(),
      },
    ];

    const steps = await buildSingletonChoiceSteps({
      draft,
      targetLevel: 1,
      sources,
      extractSlug: (document) => (document as { system?: { slug?: string } })?.system?.slug ?? null,
      localize: (value) => value,
      readExistingSingletonChoiceSelection: () => null,
    });

    expect(steps.map((step) => step.slotId)).toEqual([
      "singleton-choice-background-magical-experiment-magicalExperiment-level-1",
      "singleton-choice-background-magical-experiment-energy1-level-1",
      "singleton-choice-background-magical-experiment-energy2-level-1",
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

function magicalExperimentDocument(): unknown {
  return {
    name: "Magical Experiment",
    system: {
      slug: "magical-experiment",
      level: { value: 1 },
      rules: [
        {
          key: "ChoiceSet",
          flag: "magicalExperiment",
          rollOption: "background:magical-experiment",
          choices: [
            { value: "enhanced-senses", label: "Enhanced Senses" },
            { value: "resistant-skin", label: "Resistant Skin" },
            { value: "touch-telepathy", label: "Touch Telepathy" },
          ],
        },
        {
          key: "ChoiceSet",
          flag: "energy1",
          predicate: ["background:magical-experiment:resistant-skin"],
          choices: [
            { value: "acid", label: "Acid" },
            { value: "cold", label: "Cold" },
          ],
        },
        {
          key: "ChoiceSet",
          flag: "energy2",
          predicate: ["background:magical-experiment:resistant-skin"],
          choices: [
            { value: "fire", label: "Fire" },
            { value: "sonic", label: "Sonic" },
          ],
        },
        {
          key: "ChoiceSet",
          rollOption: "background:magical-experiment:enhanced-senses",
          predicate: ["background:magical-experiment:enhanced-senses"],
          choices: [
            { value: "scent", label: "Scent" },
            { value: "tremorsense", label: "Tremorsense" },
          ],
        },
        {
          key: "ChoiceSet",
          flag: "scent-detail",
          predicate: ["background:magical-experiment:enhanced-senses:scent"],
          choices: [{ value: "precise", label: "Precise" }],
        },
      ],
    },
  };
}
