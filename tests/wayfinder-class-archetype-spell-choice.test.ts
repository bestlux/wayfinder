import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  buildPalatineDetectiveSpellChoiceSteps,
  buildSpellshotSpellChoiceSteps,
} from "../src/wayfinder/spell-choice/class-archetype-step-builder";

describe("class archetype spell choice steps", () => {
  it("builds Spellshot's four-cantrip spellbook at levels 2 through 5", () => {
    for (let targetLevel = 1; targetLevel <= 5; targetLevel += 1) {
      const steps = buildSpellshotSpellChoiceSteps({
        draft: createEmptyDraft(targetLevel),
        targetLevel,
        effectiveClassFeatureDocuments: [classFeature("Way of the Spellshot", "way-of-the-spellshot")],
        readExistingSpellChoiceSelections: () => [],
      });

      if (targetLevel === 1) {
        expect(steps).toEqual([]);
        continue;
      }

      expect(steps).toMatchObject([
        {
          slotId: "spell-choice-spellshot-spellbook-cantrips-level-2",
          level: 2,
          spellChoice: {
            count: 4,
            cantrip: true,
            requiresCurriculum: false,
            restrictToCommon: true,
            destination: {
              type: "spellbook",
              key: "spellshot-arcane-spellbook",
              entryReuse: "key-only",
              tradition: "arcane",
              ability: "int",
              prepared: "prepared",
            },
          },
        },
      ]);
    }
  });

  it("builds Palatine Detective's divine and occult innate cantrips at levels 1 through 5", () => {
    for (let targetLevel = 1; targetLevel <= 5; targetLevel += 1) {
      const steps = buildPalatineDetectiveSpellChoiceSteps({
        draft: createEmptyDraft(targetLevel),
        targetLevel,
        effectiveClassFeatureDocuments: [classFeature("Palatine Detective", "palatine-detective")],
        readExistingSpellChoiceSelections: () => [],
      });

      expect(steps).toHaveLength(2);
      expect(steps).toMatchObject([
        {
          slotId: "spell-choice-palatine-detective-divine-cantrip-level-1",
          spellChoice: {
            count: 1,
            cantrip: true,
            requiresCurriculum: false,
            destination: {
              type: "innate",
              key: "palatine-detective-divine-innate",
              entryReuse: "key-only",
              tradition: "divine",
              ability: "int",
            },
          },
        },
        {
          slotId: "spell-choice-palatine-detective-occult-cantrip-level-1",
          spellChoice: {
            count: 1,
            cantrip: true,
            requiresCurriculum: false,
            destination: {
              type: "innate",
              key: "palatine-detective-occult-innate",
              entryReuse: "key-only",
              tradition: "occult",
              ability: "int",
            },
          },
        },
      ]);
    }
  });

  it("suppresses resolved archetype spell choices on rerun", () => {
    const spellshot = buildSpellshotSpellChoiceSteps({
      draft: createEmptyDraft(5),
      targetLevel: 5,
      effectiveClassFeatureDocuments: [classFeature("Way of the Spellshot", "way-of-the-spellshot")],
      readExistingSpellChoiceSelections: () => [{} as never, {} as never, {} as never, {} as never],
    });
    const palatine = buildPalatineDetectiveSpellChoiceSteps({
      draft: createEmptyDraft(5),
      targetLevel: 5,
      effectiveClassFeatureDocuments: [classFeature("Palatine Detective", "palatine-detective")],
      readExistingSpellChoiceSelections: () => [{} as never],
    });

    expect(spellshot).toEqual([]);
    expect(palatine).toEqual([]);
  });
});

function classFeature(name: string, slug: string) {
  return {
    name,
    system: { slug },
  };
}
