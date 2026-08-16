import { describe, expect, it, vi } from "vitest";
import { createEmbeddedSource } from "../src/actor-updater/selection-source-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import { clearPackServiceCache, type PackIndexEntry } from "../src/pack/access";
import {
  buildStaticGrantChoiceDisclosure,
  classifyEmbeddedChoices,
  hasUnsupportedEmbeddedChoiceSet,
} from "../src/pack/embedded-choice-policy";
import { getOptionsForStep } from "../src/pack/options";
import type { PendingStep, SelectionRef } from "../src/types";
import { buildClassChoiceStepsFromFeatureSources } from "../src/wayfinder/class-choice/step-builders";
import { choiceRuleIdentity, dedupeChoiceRuleSteps } from "../src/wayfinder/domain/choice-rule-ownership";
import { buildGrantChoiceSteps } from "../src/wayfinder/grant-choice-service";
import { buildSingletonChoiceSteps } from "../src/wayfinder/singleton-choice-service";
import {
  resolveStaticGrantChoiceSources,
  type StaticGrantChoiceSource,
  staticGrantSelections,
} from "../src/wayfinder/static-grant-choice-sources";
import {
  CATHARSIS_EMOTION,
  CATHARTIC_MAGE_DEDICATION,
  CLERIC_DEDICATION,
  COMMANDER_DEDICATION,
  DEITY_CLERIC,
  EIDOLON,
  SUMMONER_DEDICATION,
  TACTICS,
} from "./fixtures/grant-borne-dedications";

describe("grant-borne embedded choice policy", () => {
  it("keeps all four dedications selectable and annotates only unsupported grant-borne choices", async () => {
    clearPackServiceCache();
    const documentsById: Record<string, unknown> = {
      "Deity (Cleric)": DEITY_CLERIC,
      Eidolon: EIDOLON,
      Tactics: TACTICS,
      "Catharsis Emotion": CATHARSIS_EMOTION,
    };
    const globals = globalThis as typeof globalThis & { game?: unknown };
    globals.game = {
      settings: { get: () => "" },
      packs: new Map([
        [
          "pf2e.feats-srd",
          {
            metadata: { id: "pf2e.feats-srd" },
            getIndex: async () => [
              CLERIC_DEDICATION,
              SUMMONER_DEDICATION,
              COMMANDER_DEDICATION,
              CATHARTIC_MAGE_DEDICATION,
              ownUnsupportedFeat(),
            ],
            getDocument: async () => null,
          },
        ],
        [
          "pf2e.classfeatures",
          {
            metadata: { id: "pf2e.classfeatures" },
            getIndex: async () => [],
            getDocument: async (documentId: string) => documentsById[documentId] ?? null,
          },
        ],
      ]),
    };

    const options = await getOptionsForStep(archetypeFeatStep(), {
      ancestrySlug: null,
      ancestryTraits: [],
      heritageTraits: [],
      classSlug: "fighter",
      classHasSpellcasting: false,
      deitySelected: false,
      hasDedicationFeat: false,
      projectedArchetypeFeats: [],
    });

    expect(options.map(({ name, disclosure }) => ({ name, disclosure }))).toEqual([
      {
        name: "Cathartic Mage Dedication",
        disclosure: "PF2E will ask you to choose an emotion when this is applied.",
      },
      { name: "Cleric Dedication", disclosure: null },
      { name: "Commander Dedication", disclosure: null },
      { name: "Summoner Dedication", disclosure: null },
    ]);
  });

  it("guides Cleric Dedication's granted deity and sanctification choices", async () => {
    const sources = await resolveFixtureSources(CLERIC_DEDICATION, {
      "Compendium.pf2e.classfeatures.Item.Deity (Cleric)": DEITY_CLERIC,
    });
    const classification = classifyWithStaticGrants(CLERIC_DEDICATION, sources);

    expect(classification.staticGrants).toHaveLength(1);
    expect(classification.staticGrants[0]).toMatchObject({
      sourceName: "Deity (Cleric)",
      covered: [0, 2],
      uncovered: [],
      rules: [
        { ruleIndex: 0, coveredBy: ["grant-choice"] },
        { ruleIndex: 2, coveredBy: ["class-choice"] },
      ],
    });
    expect(buildStaticGrantChoiceDisclosure(classification)).toBeNull();

    const grantSteps = await buildGrantSteps(sources);
    expect(grantSteps).toHaveLength(1);
    expect(grantSteps[0]).toMatchObject({
      level: 2,
      kind: "pick-item",
      slotKind: "grant-choice",
      filters: { itemType: "deity" },
      grantSelection: {
        selectorUuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
        flag: "deity",
      },
    });

    const classChoiceSteps = buildClassChoiceStepsFromFeatureSources({
      classFeatures: sources.map((source) => ({
        level: source.sourceLevel,
        selection: source.sourceSelection,
        document: source.sourceDocument,
        existingRulesSelections: {},
      })),
      classSlug: "fighter",
      effectiveDeityDocument: null,
      extractSlug,
      localize: (value) => value,
    });
    expect(classChoiceSteps).toEqual([
      expect.objectContaining({
        level: 2,
        slotId: "class-choice-deity-cleric-sanctification-level-2",
        classChoice: expect.objectContaining({
          sourceUuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
          flag: "sanctification",
        }),
      }),
    ]);

    const singletonChoiceSteps = await buildSingletonSteps(sources);
    expect(singletonChoiceSteps).toEqual([
      expect.objectContaining({
        level: 2,
        slotId: "singleton-choice-classfeature-deity-cleric-sanctification-level-2",
        singletonChoice: expect.objectContaining({
          sourceUuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
          sourceRuleIndex: 2,
          flag: "sanctification",
        }),
      }),
    ]);

    const registeredSteps = dedupeChoiceRuleSteps([...grantSteps, ...singletonChoiceSteps, ...classChoiceSteps]);
    const sanctificationIdentity = choiceRuleIdentity(classChoiceSteps[0]);
    expect(sanctificationIdentity).toEqual({
      key: "compendium.pf2e.classfeatures.item.deity (cleric)#2",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
      ruleIndex: 2,
      flag: "sanctification",
    });
    expect(registeredSteps.filter((step) => choiceRuleIdentity(step)?.key === sanctificationIdentity?.key)).toEqual([
      expect.objectContaining({
        kind: "class-choice",
        slotId: "class-choice-deity-cleric-sanctification-level-2",
      }),
    ]);

    const draft = createEmptyDraft(2);
    draft.classChoices["class-choice-deity-cleric-sanctification-level-2"] = "holy";
    const source = await createEmbeddedSource(selectionFor(CLERIC_DEDICATION), draft, registeredSteps, {
      fetchSelectionDocument: async () => ({
        toObject: () => structuredClone(CLERIC_DEDICATION),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });
    expect(source?.flags?.[MODULE_ID]?.manualStaticItemGrants).toEqual([
      {
        key: "deityCleric",
        uuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
        choices: {
          sanctification: "holy",
        },
      },
    ]);
  });

  it("guides Summoner Dedication's granted eidolon choice", async () => {
    const sources = await resolveFixtureSources(SUMMONER_DEDICATION, {
      "Compendium.pf2e.classfeatures.Item.Eidolon": EIDOLON,
    });
    const classification = classifyWithStaticGrants(SUMMONER_DEDICATION, sources);

    expect(classification.staticGrants[0]).toMatchObject({
      sourceName: "Eidolon",
      covered: [0],
      uncovered: [],
      rules: [{ ruleIndex: 0, coveredBy: ["grant-choice"] }],
    });
    expect(buildStaticGrantChoiceDisclosure(classification)).toBeNull();

    const grantSteps = await buildGrantSteps(sources);
    expect(grantSteps).toEqual([
      expect.objectContaining({
        level: 2,
        kind: "pick-item",
        slotKind: "grant-choice",
        filters: expect.objectContaining({ itemType: "feat" }),
        grantSelection: expect.objectContaining({
          selectorUuid: "Compendium.pf2e.classfeatures.Item.Eidolon",
          flag: "eidolon",
        }),
      }),
    ]);

    const singletonChoiceSteps = await buildSingletonSteps(sources);
    const classChoiceSteps = buildClassChoiceStepsFromFeatureSources({
      classFeatures: sources.map((source) => ({
        level: source.sourceLevel,
        selection: source.sourceSelection,
        document: source.sourceDocument,
        existingRulesSelections: {},
      })),
      classSlug: "fighter",
      effectiveDeityDocument: null,
      extractSlug,
      localize: (value) => value,
    });
    expect(singletonChoiceSteps).toEqual([]);
    expect(classChoiceSteps).toEqual([]);

    const registeredSteps = dedupeChoiceRuleSteps([...grantSteps, ...singletonChoiceSteps, ...classChoiceSteps]);
    const eidolonIdentity = choiceRuleIdentity(grantSteps[0]);
    expect(eidolonIdentity).toMatchObject({
      sourceUuid: "Compendium.pf2e.classfeatures.Item.Eidolon",
      ruleIndex: 0,
      flag: "eidolon",
    });
    expect(registeredSteps.filter((step) => choiceRuleIdentity(step)?.key === eidolonIdentity?.key)).toEqual([
      grantSteps[0],
    ]);
  });

  it.each([
    {
      label: "Cleric deity",
      dedication: CLERIC_DEDICATION,
      grantedDocument: DEITY_CLERIC,
      staticUuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
      selected: {
        packId: "pf2e.deities",
        documentId: "sarenrae",
        uuid: "Compendium.pf2e.deities.Item.sarenrae",
        itemType: "deity",
        featType: null,
        name: "Sarenrae",
      },
      flag: "deity",
      manualGrantKey: "deityCleric",
    },
    {
      label: "Summoner eidolon",
      dedication: SUMMONER_DEDICATION,
      grantedDocument: EIDOLON,
      staticUuid: "Compendium.pf2e.classfeatures.Item.Eidolon",
      selected: {
        packId: "pf2e.feats-srd",
        documentId: "dragon-eidolon",
        uuid: "Compendium.pf2e.feats-srd.Item.dragon-eidolon",
        itemType: "feat",
        featType: "class",
        name: "Dragon Eidolon",
      },
      flag: "eidolon",
      manualGrantKey: "eidolon",
    },
  ])("preseeds the $label choice on its static child", async ({
    dedication,
    grantedDocument,
    staticUuid,
    selected,
    flag,
    manualGrantKey,
  }) => {
    const sources = await resolveFixtureSources(dedication, { [staticUuid]: grantedDocument });
    const [step] = await buildGrantSteps(sources);
    expect(step?.kind).toBe("pick-item");

    const draft = createEmptyDraft(2);
    draft.selections[step.slotId] = {
      slotId: step.slotId,
      level: 1,
      slug: selected.documentId,
      ...selected,
    };
    const parentSelection = selectionFor(dedication);
    const source = await createEmbeddedSource(parentSelection, draft, [step], {
      fetchSelectionDocument: async () => ({
        toObject: () => structuredClone(dedication),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(source?.flags?.[MODULE_ID]?.manualStaticItemGrants).toEqual([
      {
        key: manualGrantKey,
        uuid: staticUuid,
        choices: {
          [flag]: selected.uuid,
        },
      },
    ]);
  });

  it("guides only the two unconditional Commander Dedication tactics without disclosure", async () => {
    const sources = await resolveFixtureSources(COMMANDER_DEDICATION, {
      "Compendium.pf2e.classfeatures.Item.Tactics": TACTICS,
    });
    const classification = classifyWithStaticGrants(COMMANDER_DEDICATION, sources);

    expect(classification.uncovered).toEqual([]);
    expect(classification.staticGrants[0]).toMatchObject({
      sourceName: "Tactics",
      covered: [0, 2],
      uncovered: [],
      rules: [
        { ruleIndex: 0, coveredBy: ["grant-choice"] },
        { ruleIndex: 2, coveredBy: ["grant-choice"] },
      ],
    });
    expect(buildStaticGrantChoiceDisclosure(classification)).toBeNull();

    const grantSteps = await buildGrantSteps(sources);
    expect(grantSteps).toHaveLength(2);
    expect(grantSteps.map((step) => step.slotId)).toEqual([
      "grant-choice-class-classfeature-tactics-firstTactic-level-2",
      "grant-choice-class-classfeature-tactics-secondTactic-level-2",
    ]);
    expect(grantSteps.map((step) => step.filters)).toEqual(
      Array.from({ length: 2 }, () => ({
        itemType: "action",
        packIds: ["pf2e.actionspf2e"],
        predicate: [
          "item:trait:tactic",
          {
            or: ["item:tag:commander-mobility-tactic", "item:tag:commander-offensive-tactic"],
          },
        ],
      }))
    );

    const identities = grantSteps.map(choiceRuleIdentity);
    expect(new Set(identities.map((identity) => identity?.key))).toHaveLength(2);
    expect(dedupeChoiceRuleSteps([...grantSteps, ...structuredClone(grantSteps)])).toEqual(grantSteps);

    clearPackServiceCache();
    const globals = globalThis as typeof globalThis & { game?: unknown };
    globals.game = {
      settings: { get: () => "homebrew.commander-actions" },
      packs: new Map([
        [
          "pf2e.actionspf2e",
          actionPack([
            actionEntry(
              "coordinating-maneuvers",
              "Coordinating Maneuvers",
              ["brandish", "commander", "tactic"],
              ["commander-mobility-tactic"]
            ),
            actionEntry(
              "defensive-retreat",
              "Defensive Retreat",
              ["brandish", "commander", "tactic"],
              ["commander-offensive-tactic"]
            ),
            actionEntry(
              "take-the-high-ground",
              "Take the High Ground",
              ["brandish", "commander", "tactic"],
              ["commander-expert-tactic"]
            ),
            actionEntry("avoid-notice", "Avoid Notice", ["exploration"], []),
            {
              ...actionEntry("tactic-feat", "Tactic Feat", ["tactic"], ["commander-offensive-tactic"]),
              type: "feat",
            },
          ]),
        ],
        [
          "homebrew.commander-actions",
          actionPack([actionEntry("custom-maneuver", "Custom Maneuver", ["tactic"], ["commander-mobility-tactic"])]),
        ],
      ]),
    };

    const firstOptions = await getOptionsForStep(grantSteps[0], {
      ancestrySlug: null,
      ancestryTraits: [],
      heritageTraits: [],
      classSlug: "fighter",
      classHasSpellcasting: false,
      deitySelected: false,
      hasDedicationFeat: false,
    });
    expect(firstOptions.map((option) => option.name)).toEqual([
      "Coordinating Maneuvers",
      "Custom Maneuver",
      "Defensive Retreat",
    ]);

    const secondOptions = await getOptionsForStep(grantSteps[1], {
      ancestrySlug: null,
      ancestryTraits: [],
      heritageTraits: [],
      classSlug: "fighter",
      classHasSpellcasting: false,
      deitySelected: false,
      hasDedicationFeat: false,
      selectedUuidsBySlotId: {
        [grantSteps[0].slotId]: "Compendium.pf2e.actionspf2e.Item.coordinating-maneuvers",
      },
    });
    expect(secondOptions.map((option) => option.name)).toEqual(["Custom Maneuver", "Defensive Retreat"]);
  });

  it("still guides all five tactics for a Commander-class character", async () => {
    const sources = await resolveFixtureSources(COMMANDER_DEDICATION, {
      "Compendium.pf2e.classfeatures.Item.Tactics": TACTICS,
    });
    const classification = classifyWithStaticGrants(COMMANDER_DEDICATION, sources, "commander");
    const grantSteps = await buildGrantSteps(sources, new Set(["class:commander"]));

    expect(classification.staticGrants[0]).toMatchObject({
      covered: [0, 2, 4, 6, 8],
      uncovered: [],
    });
    expect(grantSteps.map((step) => step.grantSelection?.flag)).toEqual([
      "firstTactic",
      "secondTactic",
      "thirdTactic",
      "fourthTactic",
      "fifthTactic",
    ]);
  });

  it("preseeds only the two active Commander Dedication tactics on the statically granted feature", async () => {
    const sources = await resolveFixtureSources(COMMANDER_DEDICATION, {
      "Compendium.pf2e.classfeatures.Item.Tactics": TACTICS,
    });
    const grantSteps = await buildGrantSteps(sources);
    const selectedTactics = [
      ["coordinating-maneuvers", "Coordinating Maneuvers"],
      ["defensive-retreat", "Defensive Retreat"],
    ] as const;
    const draft = createEmptyDraft(2);
    for (const [index, step] of grantSteps.entries()) {
      const [documentId, name] = selectedTactics[index]!;
      draft.selections[step.slotId] = {
        slotId: step.slotId,
        packId: "pf2e.actionspf2e",
        documentId,
        uuid: `Compendium.pf2e.actionspf2e.Item.${documentId}`,
        itemType: "action",
        featType: null,
        name,
        level: null,
        slug: documentId,
      };
    }

    const source = await createEmbeddedSource(selectionFor(COMMANDER_DEDICATION), draft, grantSteps, {
      fetchSelectionDocument: async () => ({
        toObject: () => structuredClone(COMMANDER_DEDICATION),
      }),
      stripPreselectedClassFeatureEntries: vi.fn(),
      stripPreselectedClassBranchEntries: vi.fn(),
    });

    expect(source?.flags?.[MODULE_ID]?.manualStaticItemGrants).toEqual([
      {
        key: "tactics",
        uuid: "Compendium.pf2e.classfeatures.Item.Tactics",
        choices: {
          firstTactic: "Compendium.pf2e.actionspf2e.Item.coordinating-maneuvers",
          secondTactic: "Compendium.pf2e.actionspf2e.Item.defensive-retreat",
        },
      },
    ]);
  });

  it("discloses Cathartic Mage's structured emotional-state choice", async () => {
    const sources = await resolveFixtureSources(CATHARTIC_MAGE_DEDICATION, {
      "Compendium.pf2e.classfeatures.Item.Catharsis Emotion": CATHARSIS_EMOTION,
    });
    const classification = classifyWithStaticGrants(CATHARTIC_MAGE_DEDICATION, sources);

    expect(classification.staticGrants).toHaveLength(1);
    expect(classification.staticGrants[0]).toMatchObject({
      sourceName: "Catharsis Emotion",
      covered: [],
      uncovered: [1],
    });
    expect(buildStaticGrantChoiceDisclosure(classification)).toBe(
      "PF2E will ask you to choose an emotion when this is applied."
    );

    expect(
      buildClassChoiceStepsFromFeatureSources({
        classFeatures: sources.map((source) => ({
          level: source.sourceLevel,
          selection: source.sourceSelection,
          document: source.sourceDocument,
          existingRulesSelections: {},
        })),
        classSlug: "sorcerer",
        effectiveDeityDocument: null,
        extractSlug,
        localize: (value) => value,
      })
    ).toEqual([]);
  });

  it("continues hiding unsupported ChoiceSets owned by the selected feat", () => {
    const ownUnsupported = ownUnsupportedFeat();

    expect(hasUnsupportedEmbeddedChoiceSet(ownUnsupported, "pf2e.feats-srd", archetypeFeatStep())).toBe(true);
  });

  it("does not follow dynamic GrantItem UUIDs as static grants", () => {
    const selection = selectionFor(COMMANDER_DEDICATION);
    expect(staticGrantSelections(selection, TACTICS)).toEqual([]);
  });

  it("only follows static GrantItem UUIDs whose parent predicate is active", () => {
    const selection = selectionFor(COMMANDER_DEDICATION);
    const sourceDocument = {
      system: {
        slug: "stonemasons-eye",
        level: { value: 1 },
        rules: [
          {
            key: "GrantItem",
            uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting",
            predicate: [{ gte: ["skill:crafting:rank", 1] }],
          },
        ],
      },
    };

    expect(staticGrantSelections(selection, sourceDocument, new Set(["skill:crafting:rank:0"]))).toEqual([]);
    expect(staticGrantSelections(selection, sourceDocument, new Set(["skill:crafting:rank:1"]))).toMatchObject([
      {
        grantRuleIndex: 0,
        selection: { uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting" },
      },
    ]);
  });

  it("uses the parent's acquisition slot level for a static granted child choice", async () => {
    const selection = {
      ...selectionFor(COMMANDER_DEDICATION),
      slotId: "general-feat-level-3",
      level: 1,
    };
    const sourceDocument = {
      system: {
        rules: [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting" }],
      },
    };
    const childDocument = {
      name: "Specialty Crafting",
      system: { level: { value: 1 }, rules: [{ key: "ChoiceSet", flag: "specialtyCrafting", choices: [] }] },
    };

    expect(
      await resolveStaticGrantChoiceSources({
        sources: [{ sourceSelection: selection, sourceDocument }],
        fetchSelectionDocument: async () => childDocument,
      })
    ).toMatchObject([
      {
        sourceLevel: 3,
        sourceSelection: { level: 3, slotId: "static-grant-choice-general-feat-level-3-0" },
      },
    ]);
  });

  it("preserves distinct same-UUID grants and skips already-preselected child choices", async () => {
    const selection = selectionFor(COMMANDER_DEDICATION);
    const sourceDocument = {
      system: {
        rules: [
          {
            key: "GrantItem",
            uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting",
            preselectChoices: { specialtyCrafting: "st-crafting" },
          },
          {
            key: "GrantItem",
            uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting",
            preselectChoices: { specialtyCrafting: "blacksmithing" },
          },
        ],
      },
    };
    const childDocument = {
      name: "Specialty Crafting",
      system: { rules: [{ key: "ChoiceSet", flag: "specialtyCrafting", choices: [] }] },
    };

    expect(staticGrantSelections(selection, sourceDocument)).toMatchObject([
      { grantRuleIndex: 0, preselectChoices: { specialtyCrafting: "st-crafting" } },
      { grantRuleIndex: 1, preselectChoices: { specialtyCrafting: "blacksmithing" } },
    ]);
    expect(
      await resolveStaticGrantChoiceSources({
        sources: [{ sourceSelection: selection, sourceDocument }],
        fetchSelectionDocument: async () => childDocument,
      })
    ).toEqual([]);
  });

  it("defers duplicate same-UUID child choices to PF2E with an explicit disclosure", async () => {
    const selection = selectionFor(COMMANDER_DEDICATION);
    const sourceDocument = {
      system: {
        rules: [
          { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting" },
          { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting" },
        ],
      },
    };
    const childDocument = {
      name: "Specialty Crafting",
      system: { rules: [{ key: "ChoiceSet", flag: "specialtyCrafting", choices: [] }] },
    };
    const sources = await resolveStaticGrantChoiceSources({
      sources: [{ sourceSelection: selection, sourceDocument }],
      fetchSelectionDocument: async () => childDocument,
    });

    expect(sources).toMatchObject([
      { grantRuleIndex: 0, supportsGuidedChoices: false },
      { grantRuleIndex: 1, supportsGuidedChoices: false },
    ]);
    const classification = classifyWithStaticGrants(sourceDocument, sources);
    expect(classification.staticGrants).toMatchObject([
      { grantRuleIndex: 0, covered: [], uncovered: [0] },
      { grantRuleIndex: 1, covered: [], uncovered: [0] },
    ]);
    expect(buildStaticGrantChoiceDisclosure(classification)).toContain("PF2E will ask");
  });

  it("does not guide a partial duplicate when the other occurrence is already preselected", async () => {
    const selection = selectionFor(COMMANDER_DEDICATION);
    const sourceDocument = {
      system: {
        rules: [
          {
            key: "GrantItem",
            uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting",
            preselectChoices: { specialtyCrafting: "st-crafting" },
          },
          { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting" },
        ],
      },
    };
    const childDocument = {
      name: "Specialty Crafting",
      system: { rules: [{ key: "ChoiceSet", flag: "specialtyCrafting", choices: [] }] },
    };

    expect(
      await resolveStaticGrantChoiceSources({
        sources: [{ sourceSelection: selection, sourceDocument }],
        fetchSelectionDocument: async () => childDocument,
      })
    ).toMatchObject([{ grantRuleIndex: 1, supportsGuidedChoices: false }]);
  });

  it("keeps a single unresolved static child choice guided", async () => {
    const selection = selectionFor(COMMANDER_DEDICATION);
    const sourceDocument = {
      system: {
        rules: [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting" }],
      },
    };
    const childDocument = {
      name: "Specialty Crafting",
      system: { rules: [{ key: "ChoiceSet", flag: "specialtyCrafting", choices: [] }] },
    };

    expect(
      await resolveStaticGrantChoiceSources({
        sources: [{ sourceSelection: selection, sourceDocument }],
        fetchSelectionDocument: async () => childDocument,
      })
    ).toMatchObject([{ grantRuleIndex: 0, supportsGuidedChoices: true }]);
  });
});

function classifyWithStaticGrants(
  entry: unknown,
  staticGrantSources: StaticGrantChoiceSource[],
  classSlug = "fighter"
) {
  return classifyEmbeddedChoices(entry as PackIndexEntry, "pf2e.feats-srd", {
    sourceItemType: "feat",
    classSlug,
    staticGrantSources,
  });
}

function ownUnsupportedFeat(): PackIndexEntry {
  return {
    _id: "unsupported-own-choice",
    name: "Unsupported Own Choice",
    type: "feat",
    system: {
      slug: "unsupported-own-choice",
      category: "class",
      featType: { value: "class" },
      level: { value: 2 },
      rules: [{ key: "ChoiceSet", flag: "unsupported" }],
      traits: {
        rarity: "common",
        value: ["archetype", "dedication", "multiclass"],
      },
    },
  };
}

async function resolveFixtureSources(
  dedication: unknown,
  documentsByUuid: Record<string, unknown>
): Promise<StaticGrantChoiceSource[]> {
  return resolveStaticGrantChoiceSources({
    sources: [{ sourceSelection: selectionFor(dedication), sourceDocument: dedication }],
    fetchSelectionDocument: async (selection) => documentsByUuid[selection.uuid] ?? null,
  });
}

async function buildGrantSteps(
  sources: StaticGrantChoiceSource[],
  activeRollOptions: ReadonlySet<string> = new Set()
): Promise<PendingStep[]> {
  return buildGrantChoiceSteps({
    draft: {
      version: 1,
      targetLevel: 2,
      applyAttemptStepIds: [],
      applyCompletedStepIds: [],
      applyRecoveryActorUpdate: {},
      applySpellRarityAttestations: [],
      selections: {},
      boosts: {
        ancestry: {
          modeTouched: false,
          mode: "standard",
          selectedBoosts: {},
          alternateBoosts: [],
          voluntary: { touched: false, enabled: false, legacy: false, boost: null, flaws: [] },
        },
        background: { selectedBoosts: {} },
        class: { keyAbility: null },
        levels: {},
      },
      manual: {},
      skillIncreases: {},
      skillTrainings: {},
      branchSelections: {},
      classArchetypeChoices: {},
      singletonChoices: {},
      languageChoices: {},
      classChoices: {},
      spellChoices: {},
      spellRarityAttestations: {},
      updatedAt: null,
    },
    targetLevel: 2,
    hasClassSelection: true,
    hasDeitySelection: false,
    sources,
    activeRollOptions,
    extractSlug,
    readExistingGrantedSelection: () => null,
  });
}

async function buildSingletonSteps(sources: StaticGrantChoiceSource[]): Promise<PendingStep[]> {
  return buildSingletonChoiceSteps({
    draft: createEmptyDraft(2),
    targetLevel: 2,
    sources,
    extractSlug,
    localize: (value) => value,
    readExistingSingletonChoiceSelection: () => null,
  });
}

function selectionFor(document: unknown): SelectionRef {
  const source = document as {
    _id: string;
    name: string;
    system: { level: { value: number }; featType: { value: string }; slug: string };
  };
  return {
    slotId: "archetype-feat-level-2",
    packId: "pf2e.feats-srd",
    documentId: source._id,
    uuid: `Compendium.pf2e.feats-srd.Item.${source._id}`,
    itemType: "feat",
    featType: source.system.featType.value,
    name: source.name,
    level: source.system.level.value,
    slug: source.system.slug,
  };
}

function extractSlug(document: unknown): string | null {
  const slug = (document as { system?: { slug?: unknown } } | null)?.system?.slug;
  return typeof slug === "string" ? slug : null;
}

function archetypeFeatStep(): PendingStep {
  return {
    id: "archetype-feat-level-2",
    level: 2,
    kind: "pick-item",
    slotKind: "archetype-feat",
    title: "Archetype Feat",
    description: "",
    required: true,
    slotId: "archetype-feat-level-2",
    filters: {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 2,
    },
  };
}

function actionPack(index: PackIndexEntry[]) {
  return {
    documentName: "Item",
    metadata: { id: "test.actions", type: "Item" },
    getIndex: async () => index,
    getDocument: async () => null,
  };
}

function actionEntry(id: string, name: string, traits: string[], otherTags: string[]): PackIndexEntry {
  return {
    _id: id,
    name,
    type: "action",
    system: {
      slug: id,
      rules: [],
      traits: {
        rarity: "common",
        value: traits,
        otherTags,
      },
    },
  };
}
