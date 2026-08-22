import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTrainingDraft } from "../src/actor-updater/training-application";
import { getEffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import { buildClassTrainingSteps } from "../src/wayfinder/class-choice-service";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("ancestry flaw projection", () => {
  beforeEach(() => {
    testGlobals.game = {
      packs: new Map(),
      settings: { get: () => false },
    };
  });

  it("carries Lizardfolk's prepared Intelligence flaw through exact class skill count and applied ranks", async () => {
    const ancestry = {
      name: "Lizardfolk",
      type: "ancestry",
      system: {
        boosts: {
          strength: { value: ["str"], selected: "str" },
          wisdom: { value: ["wis"], selected: "wis" },
          free: { value: ["str", "dex", "con", "int", "wis", "cha"], selected: null },
        },
        flaws: {
          intelligence: { value: ["int"], selected: "int" },
        },
      },
    };
    const background = {
      name: "Warrior",
      type: "background",
      system: {
        boosts: {
          restricted: { value: ["str", "con"], selected: "con" },
          free: { value: ["str", "dex", "con", "int", "wis", "cha"], selected: null },
        },
      },
    };
    const fighter = {
      name: "Fighter",
      type: "class",
      system: {
        slug: "fighter",
        keyAbility: { value: ["str", "dex"], selected: "str" },
        trainedSkills: { additional: 3, value: ["athletics"] },
        rules: [],
      },
    };
    setPack("pf2e.ancestries", "lizardfolk", ancestry);
    setPack("pf2e.backgrounds", "warrior", background);
    setPack("pf2e.classes", "fighter", fighter);

    const draft = createEmptyDraft(1);
    draft.selections["ancestry-level-1"] = selection("pf2e.ancestries", "lizardfolk", "Lizardfolk", "ancestry");
    draft.selections["background-level-1"] = selection("pf2e.backgrounds", "warrior", "Warrior", "background");
    draft.selections["class-level-1"] = selection("pf2e.classes", "fighter", "Fighter", "class");
    draft.boosts.ancestry.selectedBoosts.free = "dex";
    draft.boosts.background.selectedBoosts.free = "cha";
    draft.boosts.levels["1"] = ["str", "dex", "con", "wis"];

    const actor = {
      system: {
        build: { attributes: { boosts: {} } },
        skills: {
          acrobatics: { rank: 0 },
          athletics: { rank: 0 },
          crafting: { rank: 0 },
        },
      },
      items: { contents: [] },
      update: vi.fn(async () => ({})),
    };
    const buildState = await getEffectiveBuildState(actor, draft);
    expect(buildState.projectedAbilities.int).toMatchObject({ modifier: -1, flawCount: 1 });

    const steps = await buildClassTrainingSteps({
      draftClassSelection: draft.selections["class-level-1"] ?? null,
      targetLevel: 1,
      effectiveBuildState: buildState,
      fetchSelectionDocument: async () => fighter,
      extractSlug: () => "fighter",
      localize: (value) => value,
    });
    expect(steps).toMatchObject([
      {
        kind: "skill-training",
        slotId: "skill-training-fighter-level-1",
        training: {
          fixedSkills: ["athletics"],
          additionalCount: 2,
        },
      },
    ]);

    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: {},
      additional: ["acrobatics", "crafting"],
      loreChoices: {},
    };
    const ranks = await applyTrainingDraft(actor, draft, steps);

    expect(actor.update).toHaveBeenCalledWith({
      "system.skills.acrobatics.rank": 1,
      "system.skills.athletics.rank": 1,
      "system.skills.crafting.rank": 1,
    });
    expect(ranks).toMatchObject({ acrobatics: 1, athletics: 1, crafting: 1 });
  });
});

function setPack(packId: string, documentId: string, data: any): void {
  testGlobals.game.packs.set(packId, {
    metadata: { id: packId },
    async getDocument(id: string) {
      return id === documentId
        ? {
            ...data,
            toObject: () => structuredClone(data),
          }
        : null;
    },
  });
}

function selection(packId: string, documentId: string, name: string, itemType: string): SelectionRef {
  return {
    slotId: `${itemType}-level-1`,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType: null,
    name,
    level: 1,
  };
}
