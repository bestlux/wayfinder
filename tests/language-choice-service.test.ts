import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { buildLanguageChoiceSteps } from "../src/wayfinder/language-choice-service";

describe("language-choice service", () => {
  it("builds a language-choice step after creation boosts are complete", async () => {
    const draft = createEmptyDraft(1);
    const steps = await buildLanguageChoiceSteps({
      snapshot: {
        actorId: "actor-1",
        level: 1,
        isBlank: true,
        freeArchetypeEnabled: false,
        singletonSlots: {
          ancestry: true,
          heritage: false,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 0,
          class: 0,
          archetype: 0,
          skill: 0,
          general: 0,
        },
        fulfilledStepIds: [],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      },
      targetLevel: 1,
      draft,
      effectiveBuildState: buildState({
        languages: {
          sourceLanguages: [],
          grantedLanguages: ["common"],
          selectableLanguages: ["draconic", "dwarven"],
          maxSelections: 2,
        },
      }),
      readExistingLanguageSelections: () => [],
      localizeLanguage: (slug) => slug[0].toUpperCase() + slug.slice(1),
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "language-choice",
      slotId: "language-choice-level-1",
      languageChoice: {
        sourceName: "Human",
        grantedLanguages: ["common"],
        count: 2,
        options: [
          { value: "draconic", label: "Draconic" },
          { value: "dwarven", label: "Dwarven" },
        ],
      },
    });
  });

  it("uses the campaign language list when ancestry grants open language slots", async () => {
    const draft = createEmptyDraft(1);
    const steps = await buildLanguageChoiceSteps({
      snapshot: {
        actorId: "actor-1",
        level: 1,
        isBlank: true,
        freeArchetypeEnabled: false,
        singletonSlots: {
          ancestry: true,
          heritage: false,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 0,
          class: 0,
          archetype: 0,
          skill: 0,
          general: 0,
        },
        fulfilledStepIds: [],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      },
      targetLevel: 1,
      draft,
      effectiveBuildState: buildState({
        languages: {
          sourceLanguages: [],
          grantedLanguages: ["common"],
          selectableLanguages: [],
          maxSelections: 2,
        },
      }),
      availableLanguageSlugs: ["common", "draconic", "dwarven"],
      readExistingLanguageSelections: () => [],
      localizeLanguage: (slug) => slug[0].toUpperCase() + slug.slice(1),
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "language-choice",
      slotId: "language-choice-level-1",
      languageChoice: {
        count: 2,
        options: [
          { value: "draconic", label: "Draconic" },
          { value: "dwarven", label: "Dwarven" },
        ],
      },
    });
  });

  it("skips the step until creation boosts are finished", async () => {
    const steps = await buildLanguageChoiceSteps({
      snapshot: {
        actorId: "actor-1",
        level: 1,
        isBlank: true,
        freeArchetypeEnabled: false,
        singletonSlots: {
          ancestry: true,
          heritage: false,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: {
          ancestry: 0,
          class: 0,
          archetype: 0,
          skill: 0,
          general: 0,
        },
        fulfilledStepIds: [],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      },
      targetLevel: 1,
      draft: createEmptyDraft(1),
      effectiveBuildState: buildState(),
      readExistingLanguageSelections: () => [],
      localizeLanguage: (slug) => slug,
    });

    expect(steps).toEqual([]);
  });
});

function buildState(overrides: Partial<EffectiveBuildState> = {}): EffectiveBuildState {
  return {
    ancestry: {
      document: { name: "Human", system: { boosts: {} } },
      mode: "standard",
      selectedBoosts: {},
      alternateBoosts: [],
      lockedBoosts: [],
      voluntary: {
        enabled: false,
        legacy: false,
        boost: null,
        flaws: [],
      },
      buildBoosts: [],
      buildFlaws: [],
    },
    heritage: null,
    background: {
      document: { system: { boosts: {} } },
      selectedBoosts: {},
      buildBoosts: [],
    },
    class: {
      document: {},
      keyAbilityOptions: ["int"],
      selectedKeyAbility: "int",
    },
    deity: null,
    languages: {
      sourceLanguages: [],
      grantedLanguages: [],
      selectableLanguages: [],
      maxSelections: 0,
    },
    levelBoosts: {
      1: ["str", "dex", "con", "int"],
      5: [],
      10: [],
      15: [],
      20: [],
    },
    allowedBoosts: {
      1: 4,
      5: 0,
      10: 0,
      15: 0,
      20: 0,
    },
    projectedAbilities: {
      str: { key: "str", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      int: { key: "int", modifier: 1, partial: false, boostCount: 0, flawCount: 0 },
      wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
    },
    ...overrides,
  };
}
