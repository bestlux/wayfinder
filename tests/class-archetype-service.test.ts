import { describe, expect, it } from "vitest";
import { applyClassArchetypeDraft } from "../src/class-archetype-service";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { EmbeddedItemSource } from "../src/shared/actor-model";
import type { PendingStep, SelectionRef } from "../src/types";
import { createClassArchetypeStep } from "../src/wayfinder/domain/step-types";
import { buildActorHarness } from "./support/actor-updater-fixtures";

const DOCTRINE_UUID = "Compendium.pf2e.classfeatures.Item.doctrine-selector";
const CANONICAL_DOCTRINE_UUID = "Compendium.pf2e.classfeatures.Item.tyrBwBTzo5t9Zho7";
const BATTLE_CREED_UUID = "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5";
const DIVINE_FONT_UUID = "Compendium.pf2e.classfeatures.Item.gblTFUOgolqFS9v4";
const DEDICATION_UUID = "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8";

describe("class-archetype-service", () => {
  it("links Doctrine to the same-batch Battle Creed item and creates internal Divine Font state without duplicates", async () => {
    const { actor } = buildActorHarness({
      items: [
        { id: "class-1", type: "class", name: "Cleric", system: { slug: "cleric" } },
        {
          id: "battle-creed-1",
          type: "feat",
          name: "Battle Creed",
          sourceId: BATTLE_CREED_UUID,
          flags: {
            core: { sourceId: BATTLE_CREED_UUID },
            [MODULE_ID]: {
              importedBy: MODULE_ID,
              slotId: "class-archetype-doctrine-level-1",
              manualStaticItemGrants: [
                {
                  key: "battleHarbingerDedication",
                  uuid: DEDICATION_UUID,
                  choices: { skill: "acrobatics" },
                },
              ],
            },
          },
          system: { slug: "battle-creed", category: "classfeature", rules: [] },
        },
      ],
    });
    const draft = createEmptyDraft(1);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";
    const steps: PendingStep[] = [classArchetypeStep()];

    await applyClassArchetypeDraft(actor as any, draft, steps, {
      createEmbeddedSource: async (selection) => sourceFor(selection),
      fetchSelectionDocument: async (selection) => {
        const source = sourceFor(selection);
        return source ? { system: structuredClone(source.system) } : null;
      },
    });

    const battleCreeds = actor.items.contents.filter((item) => item.sourceId === BATTLE_CREED_UUID);
    const doctrine = actor.items.contents.find((item) => item.sourceId === DOCTRINE_UUID);
    const divineFont = actor.items.contents.find((item) => item.sourceId === DIVINE_FONT_UUID);
    const dedication = actor.items.contents.find((item) => item.sourceId === DEDICATION_UUID);
    expect(battleCreeds).toHaveLength(1);
    expect(doctrine).toMatchObject({
      flags: {
        pf2e: {
          rulesSelections: { doctrine: BATTLE_CREED_UUID },
          itemGrants: { doctrine: { id: "battle-creed-1", onDelete: "detach" } },
        },
      },
      system: {
        rules: [
          { key: "ChoiceSet", flag: "doctrine", selection: BATTLE_CREED_UUID },
          { key: "GrantItem", uuid: "{item|flags.pf2e.rulesSelections.doctrine}" },
        ],
      },
    });
    expect(actor.items.contents.find((item) => item.id === "battle-creed-1")).toMatchObject({
      flags: {
        pf2e: { grantedBy: { id: doctrine?.id, onDelete: "cascade" } },
        [MODULE_ID]: { slotId: "class-archetype-doctrine-level-1" },
      },
    });
    expect(divineFont).toMatchObject({
      flags: { pf2e: { rulesSelections: { divineFont: "heal" } } },
      system: { rules: [{ key: "ChoiceSet", flag: "divineFont", selection: "heal" }] },
    });
    expect(dedication).toMatchObject({
      system: {
        location: "class-2",
        rules: [
          { key: "ChoiceSet", flag: "skill", selection: "acrobatics" },
          { key: "ActiveEffectLike" },
          { key: "GrantItem" },
        ],
      },
      flags: {
        pf2e: {
          rulesSelections: { skill: "acrobatics" },
          grantedBy: { id: "battle-creed-1", onDelete: "cascade" },
        },
      },
    });
  });

  it("reconciles projected dedication grants from an actor-owned Battle Creed during incremental level-up", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "doctrine-1",
          type: "feat",
          name: "Doctrine",
          sourceId: CANONICAL_DOCTRINE_UUID,
          flags: { core: { sourceId: CANONICAL_DOCTRINE_UUID } },
          system: {
            slug: "doctrine",
            category: "classfeature",
            rules: [
              { key: "ChoiceSet", flag: "doctrine" },
              { key: "GrantItem", uuid: "{item|flags.pf2e.rulesSelections.doctrine}" },
            ],
          },
        },
        {
          id: "battle-creed-1",
          type: "feat",
          name: "Battle Creed",
          sourceId: BATTLE_CREED_UUID,
          flags: { core: { sourceId: BATTLE_CREED_UUID } },
          system: { slug: "battle-creed", category: "classfeature", rules: [] },
        },
      ],
    });
    const draft = createEmptyDraft(5);

    await applyClassArchetypeDraft(actor as any, draft, [], {
      createEmbeddedSource: async (selection) => {
        if (selection.uuid === BATTLE_CREED_UUID) {
          return {
            name: "Battle Creed",
            type: "feat",
            flags: {
              core: { sourceId: BATTLE_CREED_UUID },
              [MODULE_ID]: {
                manualStaticItemGrants: [
                  {
                    key: "battleHarbingerDedication",
                    uuid: DEDICATION_UUID,
                    choices: { skill: "athletics" },
                  },
                ],
              },
            },
            system: { slug: "battle-creed", category: "classfeature", rules: [] },
          };
        }
        return sourceFor(selection);
      },
      fetchSelectionDocument: async (selection) => {
        const source = sourceFor(selection);
        return source ? { system: structuredClone(source.system) } : null;
      },
    });

    expect(actor.items.contents.find((item) => item.sourceId === DEDICATION_UUID)).toMatchObject({
      system: {
        rules: [{ key: "ChoiceSet", selection: "athletics" }, { key: "ActiveEffectLike" }, { key: "GrantItem" }],
      },
      flags: {
        pf2e: {
          rulesSelections: { skill: "athletics" },
          grantedBy: { id: "battle-creed-1", onDelete: "cascade" },
        },
      },
    });
  });
});

function classArchetypeStep(): PendingStep {
  return createClassArchetypeStep(1, {
    slotId: "class-archetype-doctrine-level-1",
    standardValue: "standard",
    sourceName: "Doctrine",
    selector: {
      slotId: "class-branch-doctrine-level-1",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "doctrine-selector",
      selectorUuid: DOCTRINE_UUID,
      selectorName: "Doctrine",
      selectorRuleIndex: 0,
      flag: "doctrine",
      optionTag: "cleric-doctrine",
      classSlug: "cleric",
      dependsOn: "class",
    },
    options: [
      { value: "standard", label: "Standard", img: null, detail: null },
      { value: "battle-creed", label: "Battle Creed", img: null, detail: null },
    ],
  });
}

function sourceFor(selection: SelectionRef): EmbeddedItemSource | null {
  if (selection.uuid === DOCTRINE_UUID) {
    return {
      name: "Doctrine",
      type: "feat",
      flags: { core: { sourceId: DOCTRINE_UUID } },
      system: {
        category: "classfeature",
        rules: [
          { key: "ChoiceSet", flag: "doctrine" },
          { key: "GrantItem", uuid: "{item|flags.pf2e.rulesSelections.doctrine}" },
        ],
      },
    };
  }
  if (selection.uuid === DIVINE_FONT_UUID) {
    return {
      name: "Divine Font",
      type: "feat",
      flags: { core: { sourceId: DIVINE_FONT_UUID } },
      system: {
        category: "classfeature",
        rules: [{ key: "ChoiceSet", flag: "divineFont" }],
      },
    };
  }
  if (selection.uuid === DEDICATION_UUID) {
    return {
      name: "Battle Harbinger Dedication",
      type: "feat",
      flags: { core: { sourceId: DEDICATION_UUID } },
      system: {
        category: "class",
        location: "class-2",
        rules: [
          { key: "ChoiceSet", flag: "skill" },
          { key: "ActiveEffectLike" },
          { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Toughness" },
        ],
      },
    };
  }
  return null;
}
