import { describe, expect, it, vi } from "vitest";
import { applyClassFeatureChoiceDraft, stripPreselectedClassFeatureEntries } from "../src/class-feature-choice-service";
import { MODULE_ID } from "../src/constants";
import { buildDraftPatch, createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { ActorItemLike, EmbeddedItemSource } from "../src/shared/actor-model";
import {
  assertVindicatorTracklessChoice,
  buildVindicatorTracklessJourneySteps,
  materializeVindicatorTracklessTerrain,
  TRACKLESS_JOURNEY_UUID,
  VINDICATOR_TRACKLESS_SLOT,
  VINDICATOR_UUID,
  vindicatorTracklessSelection,
} from "../src/wayfinder/class-archetype/vindicator";
import { buildClassGrantedItemSteps } from "../src/wayfinder/class-choice-service";

function vindicatorDraft(level = 5) {
  const draft = createEmptyDraft(level);
  draft.classArchetypeChoices["class-archetype-hunters-edge-level-1"] = "vindicator";
  return draft;
}

function tracklessSource(): EmbeddedItemSource {
  return {
    type: "feat",
    name: "Trackless Journey",
    flags: { core: { sourceId: TRACKLESS_JOURNEY_UUID } },
    system: {
      category: "classfeature",
      level: { value: 5 },
      rules: [],
      description: { value: "<p>When you move through natural terrains, you are hard to track.</p>" },
    },
  };
}

describe("Vindicator profile choices", () => {
  it("projects the selected profile's deity grant with its exact native rule indices", async () => {
    const draft = vindicatorDraft();
    const steps = await buildClassGrantedItemSteps({
      draft,
      effectiveClassDocument: { type: "class", system: { slug: "ranger", items: {} } },
      targetLevel: 5,
      extractSlug: () => "ranger",
      fetchSelectionDocument: async () => null,
      readExistingGrantedSelection: () => null,
      additionalClassFeatures: [
        {
          level: 1,
          selection: {
            ...vindicatorTracklessSelection(),
            documentId: "QOOwC3S41CKGkxlN",
            uuid: VINDICATOR_UUID,
            name: "Vindicator",
            level: 1,
          },
          document: {
            type: "feat",
            name: "Vindicator",
            system: {
              category: "classfeature",
              level: { value: 1 },
              rules: [
                { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.religion.rank", value: 1 },
                { key: "ChoiceSet", flag: "deity", choices: { itemType: "deity" }, predicate: [{ not: "deity" }] },
                { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.deity}" },
              ],
            },
          },
        },
      ],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      slotId: "deity-level-1",
      grantSelection: { selectorUuid: VINDICATOR_UUID, selectorRuleIndex: 1, grantRuleIndex: 2, flag: "deity" },
    });
  });

  it("requires the terrain choice only at level 5 for Vindicator", () => {
    expect(buildVindicatorTracklessJourneySteps({ draft: vindicatorDraft(4), actorItems: [], targetLevel: 4 })).toEqual(
      []
    );
    expect(
      buildVindicatorTracklessJourneySteps({ draft: createEmptyDraft(5), actorItems: [], targetLevel: 5 })
    ).toEqual([]);
    const steps = buildVindicatorTracklessJourneySteps({ draft: vindicatorDraft(), actorItems: [], targetLevel: 5 });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      required: true,
      slotId: VINDICATOR_TRACKLESS_SLOT,
      classChoice: {
        profileChoice: "vindicator-trackless-journey",
        options: [{ value: "natural" }, { value: "urban" }],
      },
    });
  });

  it("retains the terrain decision across draft serialization", () => {
    const draft = vindicatorDraft();
    draft.classChoices[VINDICATOR_TRACKLESS_SLOT] = "urban";
    expect(
      normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(draft))), 5).classChoices[VINDICATOR_TRACKLESS_SLOT]
    ).toBe("urban");
  });

  it("suppresses the automatic Trackless Journey feature when preparing the explicit terrain choice", () => {
    const draft = vindicatorDraft();
    draft.classChoices[VINDICATOR_TRACKLESS_SLOT] = "urban";
    const source = {
      system: { items: { trackless: { uuid: TRACKLESS_JOURNEY_UUID }, expertise: { uuid: "other-feature" } } },
    };
    stripPreselectedClassFeatureEntries(
      source,
      draft,
      buildVindicatorTracklessJourneySteps({ draft, actorItems: [], targetLevel: 5 })
    );
    expect(source.system.items).toEqual({ expertise: { uuid: "other-feature" } });
  });

  it("rejects a different source, inactive profile, wrong level, or invalid terrain", () => {
    const [step] = buildVindicatorTracklessJourneySteps({ draft: vindicatorDraft(), actorItems: [], targetLevel: 5 });
    expect(() => assertVindicatorTracklessChoice(step, "urban", tracklessSource(), "vindicator", 5)).not.toThrow();
    expect(() => assertVindicatorTracklessChoice(step, "both", tracklessSource(), "vindicator", 5)).toThrow(
      /authority/
    );
    expect(() => assertVindicatorTracklessChoice(step, "urban", tracklessSource(), "standard", 5)).toThrow(/authority/);
    expect(() => assertVindicatorTracklessChoice(step, "urban", tracklessSource(), "vindicator", 4)).toThrow(
      /authority/
    );
    const wrongStep = structuredClone(step);
    if (wrongStep.classChoice)
      wrongStep.classChoice.sourceUuid = "Compendium.pf2e.classfeatures.Item.some-other-feature";
    expect(() => assertVindicatorTracklessChoice(wrongStep, "urban", tracklessSource(), "vindicator", 5)).toThrow(
      /authority/
    );
  });

  it("creates and persists the terrain without inventing a native ChoiceSet and has no pending rerun", async () => {
    const draft = vindicatorDraft();
    draft.classChoices[VINDICATOR_TRACKLESS_SLOT] = "urban";
    const items: ActorItemLike[] = [];
    const actor = {
      items,
      createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: EmbeddedItemSource[]) => {
        const created = sources.map((source, index) => ({ ...source, id: `created-${index}` }));
        items.push(...created);
        return created;
      }),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };
    const steps = buildVindicatorTracklessJourneySteps({ draft, actorItems: items, targetLevel: 5 });
    await applyClassFeatureChoiceDraft(actor, draft, steps, {
      createEmbeddedSource: async () => tracklessSource(),
      fetchSelectionDocument: async () => null,
    });
    expect(items).toHaveLength(1);
    expect(items[0].flags?.[MODULE_ID]?.tracklessJourneyTerrain).toBe("urban");
    expect(items[0].system?.rules).toEqual([]);
    expect(items[0].system?.description).toEqual({
      value: expect.stringContaining("urban terrain instead of natural terrain"),
    });
    expect(
      buildVindicatorTracklessJourneySteps({ draft: vindicatorDraft(), actorItems: items, targetLevel: 5 })
    ).toEqual([]);
  });

  it("updates an existing feature without replacing its source, ownership, custom description, or rules", async () => {
    const draft = vindicatorDraft();
    draft.classChoices[VINDICATOR_TRACKLESS_SLOT] = "natural";
    const feature: ActorItemLike = { ...tracklessSource(), id: "existing-trackless" };
    feature.system!.description = { value: "<p>Custom player note.</p>" };
    feature.flags!.pf2e = { grantedBy: { id: "ranger-class" } };
    const persistedSource = structuredClone(feature);
    feature.toObject = vi.fn(() => structuredClone(persistedSource));
    const actor = {
      items: [feature],
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };
    await applyClassFeatureChoiceDraft(
      actor,
      draft,
      buildVindicatorTracklessJourneySteps({ draft, actorItems: actor.items, targetLevel: 5 }),
      {
        createEmbeddedSource: async () => tracklessSource(),
        fetchSelectionDocument: async () => null,
      }
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(feature.toObject).toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "existing-trackless",
        [`flags.${MODULE_ID}.tracklessJourneyTerrain`]: "natural",
        "system.description": { value: expect.stringContaining("<p>Custom player note.</p>") },
      },
    ]);
  });

  it("replaces its own terrain note rather than accumulating notes", () => {
    const source = tracklessSource();
    materializeVindicatorTracklessTerrain(source, "urban");
    materializeVindicatorTracklessTerrain(source, "natural");
    const description = source.system?.description as { value: string };
    expect(description.value.match(/Vindicator terrain:/gu)).toHaveLength(1);
    expect(description.value).not.toContain("urban terrain");
  });

  it("fails before persisting when native feature rules drift or actor feature provenance is duplicated", () => {
    const [step] = buildVindicatorTracklessJourneySteps({ draft: vindicatorDraft(), actorItems: [], targetLevel: 5 });
    const drifted = tracklessSource();
    drifted.system!.rules = [{ key: "ChoiceSet", flag: "terrain" }];
    expect(() => assertVindicatorTracklessChoice(step, "urban", drifted, "vindicator", 5)).toThrow(/authority/);
    expect(() =>
      assertVindicatorTracklessChoice(step, "urban", tracklessSource(), "vindicator", 5, [
        { ...tracklessSource(), id: "one" },
        { ...tracklessSource(), id: "two" },
      ])
    ).toThrow(/authority/);
  });

  it("respects an explicit Standard path even when the actor retains a Vindicator feature", () => {
    const draft = createEmptyDraft(5);
    draft.classArchetypeChoices["class-archetype-hunters-edge-level-1"] = "standard";
    expect(
      buildVindicatorTracklessJourneySteps({
        draft,
        actorItems: [{ type: "feat", flags: { core: { sourceId: VINDICATOR_UUID } } }],
        targetLevel: 5,
      })
    ).toEqual([]);
  });
});
