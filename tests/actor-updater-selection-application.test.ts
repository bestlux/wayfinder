import { describe, expect, it, vi } from "vitest";
import {
  createEmbeddedSource,
  hasSourceId,
  insertFeatSelection,
  orderSelections,
  replaceSingletonItem,
} from "../src/actor-updater/selection-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";

describe("actor-updater selection application", () => {
  it("replaces singleton items with embedded sources stamped for wayfinder", async () => {
    const actor = {
      items: [
        { id: "ancestry-1", type: "ancestry" },
        { id: "ancestry-2", type: "ancestry" },
      ],
      deleteEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => []),
    };
    const selection = selectionRef("ancestry-level-1", "ancestry", "human", "Human");

    await replaceSingletonItem(actor, selection, createEmptyDraft(1), [], {
      fetchSelectionDocument: async () => ({
        toObject: () => ({
          _id: "compendium-ancestry",
          name: "Human",
          type: "ancestry",
        }),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["ancestry-1", "ancestry-2"]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Human",
        type: "ancestry",
        _stats: {
          compendiumSource: selection.uuid,
        },
        flags: {
          core: {
            sourceId: selection.uuid,
          },
          [MODULE_ID]: {
            importedBy: MODULE_ID,
            slotId: selection.slotId,
          },
        },
      },
    ]);
  });

  it("strips class preselected data when building a class embedded source", async () => {
    const draft = createEmptyDraft(1);
    const steps: PendingStep[] = [];
    const stripPreselectedClassFeatureEntries = vi.fn();
    const stripPreselectedClassBranchEntries = vi.fn();

    const source = await createEmbeddedSource(
      selectionRef("class-level-1", "class", "wizard", "Wizard"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "class-compendium",
            name: "Wizard",
            type: "class",
            system: {},
          }),
        }),
        stripPreselectedClassFeatureEntries,
        stripPreselectedClassBranchEntries,
      }
    );

    expect(source?.name).toBe("Wizard");
    expect(stripPreselectedClassFeatureEntries).toHaveBeenCalledWith(source, draft, steps);
    expect(stripPreselectedClassBranchEntries).toHaveBeenCalledWith(source, draft, steps);
  });

  it("preselects drafted class skill-training choices before creating the class item", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: {
        "class:fighterskill": "athletics",
      },
      additional: ["crafting", "medicine", "society"],
      loreChoices: {},
    };
    const steps: PendingStep[] = [
      {
        id: "skill-training-fighter-level-1",
        level: 1,
        kind: "skill-training",
        slotKind: "skill-training",
        title: "Training",
        description: "",
        required: true,
        slotId: "skill-training-fighter-level-1",
        training: {
          classSlug: "fighter",
          className: "Fighter",
          fixedSkills: [],
          fixedLores: [],
          choiceRules: [
            {
              key: "class:fighterskill",
              flag: "fighterSkill",
              prompt: "Choose a skill",
              sourceLabel: "Fighter",
              options: [
                { slug: "acrobatics", label: "Acrobatics" },
                { slug: "athletics", label: "Athletics" },
              ],
              persistence: {
                sourceItemType: "class",
                sourcePackId: "test.pack",
                sourceDocumentId: "fighter",
                sourceUuid: "Compendium.test.pack.Item.fighter",
                sourceRuleIndex: 0,
              },
            },
          ],
          loreChoices: [],
          additionalCount: 3,
        },
      },
    ];

    const source = await createEmbeddedSource(
      selectionRef("class-level-1", "class", "fighter", "Fighter"),
      draft,
      steps,
      {
        fetchSelectionDocument: async () => ({
          toObject: () => ({
            _id: "class-compendium",
            name: "Fighter",
            type: "class",
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "fighterSkill",
                  choices: [
                    { value: "acrobatics", label: "Acrobatics" },
                    { value: "athletics", label: "Athletics" },
                  ],
                },
              ],
            },
          }),
        }),
        stripPreselectedClassFeatureEntries: vi.fn(),
        stripPreselectedClassBranchEntries: vi.fn(),
      }
    );

    expect(source?.system?.rules?.[0]).toMatchObject({
      key: "ChoiceSet",
      flag: "fighterSkill",
      selection: "athletics",
    });
    expect(source?.flags?.pf2e?.rulesSelections).toEqual({
      fighterSkill: "athletics",
    });
  });

  it("inserts feats through PF2E slots and stamps source flags on the created items", async () => {
    const insertFeat = vi.fn(async () => [{ id: "created-feat-1" }]);
    const actor = {
      feats: {
        get(groupId: string) {
          if (groupId !== "ancestry") {
            return null;
          }

          return {
            slots: {
              "ancestry-1": {
                id: "ancestry-1",
                level: 1,
                feat: null,
              },
            },
          };
        },
        insertFeat,
      },
      updateEmbeddedDocuments: vi.fn(async () => []),
      createEmbeddedDocuments: vi.fn(async () => []),
    };
    const selection = selectionRef("ancestry-feat-level-1", "feat", "adapted-cantrip", "Adapted Cantrip", "ancestry");
    const step = featStep("ancestry-feat-level-1", "ancestry-feat", 1, ["ancestry"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument: async () => ({
        id: "adapted-cantrip",
        name: "Adapted Cantrip",
        toObject: () => ({ name: "Adapted Cantrip", type: "feat", system: {} }),
      }),
      createEmbeddedSource: async () => null,
    });

    expect(insertFeat).toHaveBeenCalledWith(
      expect.objectContaining({ id: "adapted-cantrip", name: "Adapted Cantrip" }),
      { groupId: "ancestry", slotId: "ancestry-1" }
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "created-feat-1",
        "flags.core.sourceId": selection.uuid,
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: selection.slotId,
      },
    ]);
  });

  it("falls back to raw feat creation when PF2E slot insertion is unavailable", async () => {
    const actor = {
      feats: undefined,
      createEmbeddedDocuments: vi.fn(async () => []),
    };
    const selection = selectionRef("general-feat-level-3", "feat", "toughness", "Toughness", "general");
    const step = featStep("general-feat-level-3", "general-feat", 3, ["general"]);

    await insertFeatSelection(actor, selection, step, {
      fetchSelectionDocument: async () => ({
        id: "toughness",
        name: "Toughness",
        toObject: () => ({ name: "Toughness", type: "feat", system: { location: null } }),
      }),
      createEmbeddedSource: async () => ({
        name: "Toughness",
        type: "feat",
        system: {},
        flags: {},
      }),
    });

    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        name: "Toughness",
        type: "feat",
        system: {
          location: "general",
          level: {
            taken: 3,
          },
        },
        flags: {},
      },
    ]);
  });

  it("orders selections by step order and detects existing source ids", () => {
    const draft = createEmptyDraft(1);
    draft.selections["class-feat-level-1"] = selectionRef(
      "class-feat-level-1",
      "feat",
      "power-attack",
      "Power Attack",
      "class"
    );
    draft.selections["class-level-1"] = selectionRef("class-level-1", "class", "fighter", "Fighter");
    draft.selections["background-level-1"] = selectionRef("background-level-1", "background", "scholar", "Scholar");
    const ordered = orderSelections(draft, [featStep("class-feat-level-1", "class-feat", 1, ["class"])]);

    expect(ordered.map((entry) => entry.slotId)).toEqual(["class-feat-level-1", "class-level-1", "background-level-1"]);
    expect(
      hasSourceId(
        {
          items: [
            {
              flags: {
                core: {
                  sourceId: "Compendium.test.pack.Item.power-attack",
                },
              },
            },
          ],
        },
        "Compendium.test.pack.Item.power-attack"
      )
    ).toBe(true);
  });
});

function selectionRef(
  slotId: string,
  itemType: string,
  documentId: string,
  name: string,
  featType: string | null = null
): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType,
    name,
    level: 1,
  };
}

function featStep(
  slotId: string,
  slotKind: Extract<PendingStep, { kind: "pick-item" }>["slotKind"],
  level: number,
  featTypes: string[]
): PendingStep {
  return {
    id: slotId,
    level,
    kind: "pick-item",
    slotKind,
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: {
      itemType: "feat",
      featTypes,
      maxLevel: level,
    },
  };
}
