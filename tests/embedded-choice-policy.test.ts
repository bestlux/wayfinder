import { beforeEach, describe, expect, it } from "vitest";
import { classifyEmbeddedChoices } from "../src/pack/embedded-choice-policy";
import { pf2e841AngelEidolonEntry, pf2e841DragonEidolonEntry } from "./fixtures/pf2e-841-eidolons";

const testGlobals = globalThis as typeof globalThis & { CONFIG?: any };

describe("embedded choice policy", () => {
  beforeEach(() => {
    testGlobals.CONFIG = {
      PF2E: {
        skills: {
          arcana: { label: "Arcana" },
          crafting: { label: "Crafting" },
        },
        weaponGroups: {
          sword: "Sword",
        },
      },
    };
  });

  it("marks a fully covered direct feat as covered", () => {
    const result = classifyEmbeddedChoices(
      featEntry("elemental-wrath", "Elemental Wrath", "ancestry", [
        {
          key: "ChoiceSet",
          flag: "element",
          choices: [
            { value: "fire", label: "Fire" },
            { value: "cold", label: "Cold" },
          ],
        },
      ]),
      "pf2e.feats-srd"
    );

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([{ ruleIndex: 0, coveredBy: ["singleton-choice"] }]);
  });

  it("marks a direct feat with one covered and one uncovered ChoiceSet as partial", () => {
    const result = classifyEmbeddedChoices(
      featEntry("partial-ambition", "Partial Ambition", "ancestry", [
        {
          key: "ChoiceSet",
          flag: "naturalAmbition",
          choices: {
            itemType: "feat",
            filter: ["item:level:1", "item:category:class", "item:trait:{actor|system.details.class.trait}"],
          },
        },
        {
          key: "GrantItem",
          uuid: "{item|flags.system.rulesSelections.naturalAmbition}",
        },
        {
          key: "ChoiceSet",
          flag: "unsupported",
        },
      ]),
      "pf2e.feats-srd"
    );

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([2]);
    expect(result.rules[0]?.coveredBy).toEqual(["grant-choice"]);
  });

  it("marks singleton-only direct feat choices as covered", () => {
    const result = classifyEmbeddedChoices(
      featEntry("resistant-skin", "Resistant Skin", "general", [
        {
          key: "ChoiceSet",
          flag: "resistance",
          choices: [{ value: "acid", label: "Acid" }],
        },
      ]),
      "pf2e.feats-srd"
    );

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
  });

  it("marks enabled config-string direct feat choices as covered", () => {
    const result = classifyEmbeddedChoices(
      featEntry("advanced-weapon-training", "Advanced Weapon Training", "class", [
        {
          key: "ChoiceSet",
          flag: "weaponGroup",
          choices: "weaponGroups",
        },
      ]),
      "pf2e.feats-srd"
    );

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([{ ruleIndex: 0, coveredBy: ["singleton-choice"] }]);
  });

  it("marks registered Exemplar ikon choices as covered when compatible selected ikons are projected", () => {
    const entry = featEntry("leap-the-falls", "Leap the Falls", "class", [
      {
        key: "ChoiceSet",
        flag: "ikon",
        choices: "flags.system.exemplar.ikons",
      },
    ]);
    entry.system.traits = { otherTags: ["body-ikon-feat"] };

    const result = classifyEmbeddedChoices(entry, "pf2e.feats-srd", {
      optionContext: {
        ancestrySlug: null,
        classSlug: "exemplar",
        deitySelected: false,
        rollOptions: [],
        registeredDynamicChoices: {
          "flags.system.exemplar.ikons": [
            {
              value: "eye-catching-spot",
              label: "Eye-Catching Spot",
              predicate: ["parent:tag:body-ikon-feat"],
            },
          ],
        },
      },
    });

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([{ ruleIndex: 0, coveredBy: ["singleton-choice"] }]);
  });

  it("marks skill-training-only direct feat choices as covered", () => {
    const result = classifyEmbeddedChoices(
      featEntry("skill-training", "Skill Training", "skill", [
        {
          key: "ChoiceSet",
          flag: "trainedSkill",
          choices: [
            { value: "arcana", label: "Arcana" },
            { value: "crafting", label: "Crafting" },
          ],
        },
      ]),
      "pf2e.feats-srd"
    );

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([{ ruleIndex: 0, coveredBy: ["skill-training"] }]);
  });

  it("marks class-feature class-choice rules as covered for branch options", () => {
    const result = classifyEmbeddedChoices(
      classFeatureEntry("fighter-weapon-mastery", "Fighter Weapon Mastery", [
        {
          key: "ChoiceSet",
          flag: "weaponGroup",
          choices: [{ value: "sword", label: "Sword" }],
        },
      ]),
      "pf2e.classfeatures",
      { sourceItemType: "classfeature" }
    );

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([{ ruleIndex: 0, coveredBy: ["class-choice"] }]);
  });

  it("covers Dragon Eidolon's PF2E 8.4.1 tradition prompt while Angel needs no prompt", () => {
    expect(
      classifyEmbeddedChoices(pf2e841DragonEidolonEntry() as any, "pf2e.classfeatures", {
        sourceItemType: "classfeature",
      })
    ).toMatchObject({
      covered: [0],
      uncovered: [],
      rules: [{ ruleIndex: 0, coveredBy: ["class-choice"] }],
    });
    expect(
      classifyEmbeddedChoices(pf2e841AngelEidolonEntry() as any, "pf2e.classfeatures", {
        sourceItemType: "classfeature",
      })
    ).toMatchObject({ covered: [], uncovered: [], rules: [] });
  });

  it("returns empty coverage for documents without ChoiceSet rules", () => {
    const result = classifyEmbeddedChoices(featEntry("cat-fall", "Cat Fall", "skill", []), "pf2e.feats-srd");

    expect(result.covered).toEqual([]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([]);
    expect(result.staticGrants).toEqual([]);
  });
});

function featEntry(slug: string, name: string, featType: string, rules: unknown[]): any {
  return {
    _id: slug,
    name,
    type: "feat",
    system: {
      slug,
      category: featType,
      featType: { value: featType },
      level: { value: 1 },
      rules,
    },
  };
}

function classFeatureEntry(slug: string, name: string, rules: unknown[]): any {
  return {
    _id: slug,
    name,
    type: "feat",
    system: {
      slug,
      category: "classfeature",
      level: { value: 1 },
      rules,
    },
  };
}
