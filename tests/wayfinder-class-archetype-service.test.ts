import { describe, expect, it } from "vitest";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import {
  projectedClassArchetypeFeatSelections,
  projectedClassArchetypeStaticFeatSelections,
  reservedClassFeatSlotIds,
  withExistingClassArchetypeChoice,
} from "../src/wayfinder/class-archetype/registry";
import {
  buildClassArchetypeFallbackFeatSteps,
  buildClassArchetypeSteps,
} from "../src/wayfinder/class-archetype/service";
import { buildClassBranchSteps } from "../src/wayfinder/class-choice-service";

const DOCTRINE_UUID = "Compendium.pf2e.classfeatures.Item.doctrine-selector";

describe("wayfinder class archetype service", () => {
  it("builds a dedicated Standard vs Battle Creed decision from the Cleric Doctrine selector", async () => {
    const draft = createEmptyDraft(1);

    const steps = await buildClassArchetypeSteps({
      ...builderArgs(draft),
      readExistingBranchSelection: () => null,
    });

    expect(steps).toMatchObject([
      {
        kind: "class-archetype",
        slotId: "class-archetype-doctrine-level-1",
        classArchetype: {
          standardValue: "standard",
          sourceName: "Doctrine",
          selector: {
            flag: "doctrine",
            optionTag: "cleric-doctrine",
            classSlug: "cleric",
          },
          options: [
            { value: "standard", label: "Standard class path" },
            { value: "battle-creed", label: "Battle Creed" },
          ],
        },
      },
    ]);
  });

  it("withholds ordinary Doctrine until Standard is explicit and keeps it hidden for Battle Creed", async () => {
    const unanswered = createEmptyDraft(1);
    const standard = createEmptyDraft(1);
    standard.classArchetypeChoices["class-archetype-doctrine-level-1"] = "standard";
    const battleCreed = createEmptyDraft(1);
    battleCreed.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";

    const [unansweredSteps, standardSteps, battleSteps] = await Promise.all(
      [unanswered, standard, battleCreed].map((draft) => buildClassBranchSteps(builderArgs(draft)))
    );

    expect(unansweredSteps).toEqual([]);
    expect(standardSteps).toMatchObject([{ kind: "class-branch", branch: { selectorName: "Doctrine" } }]);
    expect(battleSteps).toEqual([]);
  });

  it("keeps an explicit class-archetype decision editable after the Standard branch is drafted", async () => {
    const draft = createEmptyDraft(1);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "standard";
    draft.branchSelections["class-branch-doctrine-level-1"] = {
      slotId: "class-branch-doctrine-level-1",
      packId: "pf2e.classfeatures",
      documentId: "warpriest",
      uuid: "Compendium.pf2e.classfeatures.Item.warpriest",
      itemType: "feat",
      featType: "classfeature",
      name: "Warpriest",
      level: 1,
    };

    expect(await buildClassArchetypeSteps(builderArgs(draft))).toHaveLength(1);
  });

  it("projects Battle Harbinger Dedication and reserves the level-2 class feat", () => {
    const draft = createEmptyDraft(5);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";

    expect(projectedClassArchetypeFeatSelections(draft, 1)).toEqual([]);
    expect(projectedClassArchetypeFeatSelections(draft, 2)).toMatchObject([
      {
        uuid: "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8",
        name: "Battle Harbinger Dedication",
        level: 2,
      },
    ]);
    expect(reservedClassFeatSlotIds(draft)).toEqual(["class-feat-level-2"]);
    expect(projectedClassArchetypeStaticFeatSelections(draft, 1)).toEqual([]);
    expect(projectedClassArchetypeStaticFeatSelections(draft, 2)).toMatchObject([
      {
        uuid: "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath",
        name: "Toughness",
      },
    ]);
  });

  it("recovers the active profile from an actor-owned Battle Creed on later level-ups", () => {
    const draft = createEmptyDraft(5);
    const effective = withExistingClassArchetypeChoice(draft, [
      {
        name: "Battle Creed",
        type: "feat",
        system: { slug: "battle-creed" },
        flags: { core: { sourceId: "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5" } },
      },
    ]);

    expect(effective).not.toBe(draft);
    expect(effective.classArchetypeChoices).toEqual({
      "class-archetype-doctrine-level-1": "battle-creed",
    });
    expect(reservedClassFeatSlotIds(effective)).toEqual(["class-feat-level-2"]);
  });

  it("ignores legacy actor items without usable source ids or slugs", () => {
    const draft = createEmptyDraft(5);

    expect(
      withExistingClassArchetypeChoice(draft, [
        { name: null, type: "feat", flags: { core: { sourceId: null } } },
        { type: "feat" },
      ])
    ).toBe(draft);
  });

  it("offers a native alternate grant when Toughness predates the dedication", () => {
    const draft = createEmptyDraft(5);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";
    const toughness = {
      id: "toughness-1",
      name: "Toughness",
      type: "feat",
      flags: { core: { sourceId: "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath" } },
    };

    expect(buildClassArchetypeFallbackFeatSteps({ draft, actorItems: [toughness], targetLevel: 5 })).toMatchObject([
      {
        kind: "pick-item",
        slotKind: "grant-choice",
        slotId: "class-archetype-battle-harbinger-toughness-replacement-level-2",
        staticGrantReplacement: {
          sourceUuid: "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8",
          flag: "toughnessFallback",
        },
      },
    ]);

    expect(
      buildClassArchetypeFallbackFeatSteps({
        draft,
        actorItems: [
          toughness,
          {
            id: "dedication-1",
            name: "Battle Harbinger Dedication",
            type: "feat",
            flags: { core: { sourceId: "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8" } },
          },
        ],
        targetLevel: 5,
      })
    ).toEqual([]);
  });

  it("offers the alternate when a drafted singleton will grant Toughness before the dedication", () => {
    const draft = createEmptyDraft(5);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";

    expect(
      buildClassArchetypeFallbackFeatSteps({
        draft,
        actorItems: [],
        targetLevel: 5,
        projectedSingletonSources: [
          {
            sourceItemType: "background",
            sourceDocument: {
              name: "Shielded Fortune",
              system: {
                rules: [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Toughness" }],
              },
            },
          },
        ],
      })
    ).toMatchObject([
      {
        slotId: "class-archetype-battle-harbinger-toughness-replacement-level-2",
      },
    ]);
  });

  it("ignores Toughness from a singleton that the draft replaces with a non-granting source", () => {
    const draft = createEmptyDraft(5);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";
    const oldBackground = { id: "old-background", type: "background", name: "Shielded Fortune" };
    const oldToughness = {
      id: "old-toughness",
      name: "Toughness",
      type: "feat",
      flags: {
        core: { sourceId: "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath" },
        pf2e: { grantedBy: { id: "old-background" } },
      },
    };

    expect(
      buildClassArchetypeFallbackFeatSteps({
        draft,
        actorItems: [oldBackground, oldToughness],
        targetLevel: 5,
        projectedSingletonSources: [{ sourceItemType: "background", sourceDocument: { name: "Acolyte" } }],
      })
    ).toEqual([]);
  });

  it("migrates a legacy Battle Creed Doctrine branch decision into the dedicated lane", () => {
    const legacySelection = battleCreedSelection("class-branch-doctrine-level-1");
    const draft = normalizeDraft(
      {
        version: 7,
        targetLevel: 1,
        branchSelections: {
          [legacySelection.slotId]: legacySelection,
        },
      },
      1
    );

    expect(draft.version).toBe(8);
    expect(draft.branchSelections).toEqual({});
    expect(draft.classArchetypeChoices).toEqual({
      "class-archetype-doctrine-level-1": "battle-creed",
    });
  });
});

function builderArgs(draft: ReturnType<typeof createEmptyDraft>) {
  return {
    draft,
    effectiveClassDocument: {
      name: "Cleric",
      system: {
        slug: "cleric",
        items: {
          doctrine: {
            level: 1,
            name: "Doctrine",
            uuid: DOCTRINE_UUID,
          },
        },
      },
    },
    targetLevel: 1,
    fetchSelectionDocument: async (selection: SelectionRef) =>
      selection.uuid === DOCTRINE_UUID
        ? {
            name: "Doctrine",
            type: "feat",
            system: {
              slug: "doctrine",
              category: "classfeature",
              level: { value: 1 },
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "doctrine",
                  choices: { filter: ["item:tag:cleric-doctrine"] },
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.pf2e.rulesSelections.doctrine}",
                },
              ],
            },
          }
        : null,
    extractSlug: (document: unknown) => {
      const typed = document as { system?: { slug?: unknown } } | null;
      return typeof typed?.system?.slug === "string" ? typed.system.slug : null;
    },
    readExistingBranchSelection: () => null,
  };
}

function battleCreedSelection(slotId: string): SelectionRef {
  return {
    slotId,
    packId: "pf2e.classfeatures",
    documentId: "49CkgA3kj7Im6gZ5",
    uuid: "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5",
    itemType: "feat",
    featType: "classfeature",
    name: "Battle Creed",
    level: 1,
    slug: "battle-creed",
  };
}
