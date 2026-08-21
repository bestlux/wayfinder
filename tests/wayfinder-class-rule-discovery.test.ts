import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import {
  discoverClassBranchMeta,
  discoverClassChoiceMeta,
  discoverGrantedItemMeta,
  discoverSkillTrainingMeta,
} from "../src/wayfinder/class-choice/rule-discovery";
import { pf2e841DragonEidolonEntry } from "./fixtures/pf2e-841-eidolons";

const extractSlug = (document: { system?: { slug?: string } } | null | undefined) => document?.system?.slug ?? null;

const selectorSelection: SelectionRef = {
  slotId: "class-feature-level-1",
  packId: "pf2e.classfeatures",
  documentId: "selector-document",
  uuid: "Compendium.pf2e.classfeatures.Item.selector-document",
  itemType: "feat",
  featType: null,
  name: "Selector",
  level: 1,
};

const classSelection: SelectionRef = {
  slotId: "class-level-1",
  packId: "pf2e.classes",
  documentId: "rogue",
  uuid: "Compendium.pf2e.classes.Item.rogue",
  itemType: "class",
  featType: null,
  name: "Rogue",
  level: 1,
};

describe("wayfinder class rule discovery", () => {
  it("discovers branch metadata from selector-style class features", () => {
    const branchMeta = discoverClassBranchMeta({
      selectorDocument: {
        type: "feat",
        name: "Rogue's Racket",
        system: {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            { key: "ChoiceSet", flag: "roguesRacket", choices: { filter: ["item:tag:rogue-racket"] } },
            { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.roguesRacket}" },
          ],
        },
      },
      selectorSelection,
      classSlug: "rogue",
      extractSlug,
    });

    expect(branchMeta).toMatchObject({
      flag: "roguesRacket",
      optionTag: "rogue-racket",
      classSlug: "rogue",
      dependsOn: "class",
      selectorName: "Rogue's Racket",
    });
  });

  it("discovers deity grants only when a matching grant rule exists", () => {
    const grantMeta = discoverGrantedItemMeta({
      selectorDocument: {
        type: "feat",
        name: "Deity",
        system: {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            { key: "ChoiceSet", flag: "deity", choices: { itemType: "deity" } },
            { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.domain}" },
            { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.deity}" },
          ],
        },
      },
      selectorSelection,
      classSlug: "cleric",
    });

    expect(grantMeta).toMatchObject({
      itemType: "deity",
      flag: "deity",
      classSlug: "cleric",
      slotId: "deity-level-1",
      grantRuleIndex: 2,
    });

    expect(
      discoverGrantedItemMeta({
        selectorDocument: {
          type: "feat",
          name: "Deity",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              { key: "ChoiceSet", flag: "deity", choices: { itemType: "deity" } },
              { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.domain}" },
            ],
          },
        },
        selectorSelection,
        classSlug: "cleric",
      })
    ).toBeNull();
  });

  it("filters class-choice options by roll options and falls back through slug and rollOption keys", () => {
    const choiceMeta = discoverClassChoiceMeta({
      sourceDocument: {
        type: "feat",
        name: "Champion's Deity",
        system: {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              slug: "sanctification",
              choices: [
                {
                  value: "holy",
                  label: "Holy",
                  predicate: [
                    { or: ["deity:primary:sanctification:can:holy", "deity:primary:sanctification:must:holy"] },
                  ],
                },
                {
                  value: "unholy",
                  label: "Unholy",
                  predicate: [
                    {
                      or: ["deity:primary:sanctification:can:unholy", "deity:primary:sanctification:must:unholy"],
                    },
                  ],
                },
                {
                  value: "none",
                  label: "None",
                  predicate: [
                    {
                      nor: ["deity:primary:sanctification:must:holy", "deity:primary:sanctification:must:unholy"],
                    },
                  ],
                },
              ],
            },
            {
              key: "ChoiceSet",
              rollOption: "divineFont",
              choices: [
                { value: "heal", label: "Heal", predicate: "deity:primary:font:heal" },
                { value: "mercy", label: "Mercy", predicate: { not: "deity:primary:font:harm" } },
                { value: "denied", label: "Denied", predicate: { not: "deity:primary:font:heal" } },
                { value: "harm", label: "Harm", predicate: "deity:primary:font:harm" },
              ],
            },
          ],
        },
      },
      sourceSelection: selectorSelection,
      classSlug: "cleric",
      extractSlug,
      localize: (value) => value,
      rollOptions: new Set(["deity:primary:sanctification:can:holy", "deity:primary:font:heal"]),
    });

    expect(choiceMeta).toMatchObject([
      {
        flag: "sanctification",
        dependsOn: "deity",
        options: [
          { value: "holy", label: "Holy" },
          { value: "none", label: "None" },
        ],
      },
      {
        flag: "selectorDocument",
        rollOption: "divineFont",
        dependsOn: "deity",
        options: [
          { value: "heal", label: "Heal" },
          { value: "mercy", label: "Mercy" },
        ],
      },
    ]);
  });

  it("projects PF2E 8.4.1 Dragon Eidolon's compound tradition choice", () => {
    const sourceSelection: SelectionRef = {
      slotId: "class-branch-eidolon-level-1",
      packId: "pf2e.classfeatures",
      documentId: "JttI3raKFGG4C8up",
      uuid: "Compendium.pf2e.classfeatures.Item.JttI3raKFGG4C8up",
      itemType: "feat",
      featType: "classfeature",
      name: "Dragon Eidolon",
      level: 1,
      slug: "dragon-eidolon",
    };

    expect(
      discoverClassChoiceMeta({
        sourceDocument: pf2e841DragonEidolonEntry(),
        sourceSelection,
        classSlug: "summoner",
        extractSlug,
        localize: (value) => value.replace("PF2E.Trait", ""),
        rollOptions: new Set(["class:summoner"]),
      })
    ).toMatchObject([
      {
        slotId: "class-choice-dragon-eidolon-eidolonTradition-level-1",
        flag: "eidolonTradition",
        options: [
          { value: "arcane", label: "Arcane", ruleValue: { skill: "arcana", tradition: "arcane" } },
          { value: "divine", label: "Divine", ruleValue: { skill: "religion", tradition: "divine" } },
          { value: "occult", label: "Occult", ruleValue: { skill: "occultism", tradition: "occult" } },
          { value: "primal", label: "Primal", ruleValue: { skill: "nature", tradition: "primal" } },
        ],
      },
    ]);
  });

  it("retains a drafted class choice after its own roll option closes the PF2E prompt predicate", () => {
    const sourceDocument = {
      type: "feat",
      name: "Deity (Champion)",
      system: {
        slug: "deity-champion",
        category: "classfeature",
        level: { value: 2 },
        rules: [
          {
            key: "ChoiceSet",
            slug: "sanctification",
            rollOption: "sanctification",
            predicate: [{ nor: ["sanctification:none", "sanctification:holy", "sanctification:unholy"] }],
            choices: [
              {
                value: "holy",
                label: "Holy",
                predicate: ["deity:primary:sanctification:can:holy"],
              },
            ],
          },
        ],
      },
    };
    const args = {
      sourceDocument,
      sourceSelection: { ...selectorSelection, documentId: "deity-champion", name: "Deity (Champion)", level: 2 },
      sourceLevel: 2,
      classSlug: "exemplar",
      extractSlug,
      localize: (value: string) => value,
      rollOptions: new Set(["deity:primary:sanctification:can:holy", "sanctification:holy"]),
    };

    expect(discoverClassChoiceMeta(args)).toEqual([]);
    expect(
      discoverClassChoiceMeta({
        ...args,
        selectedValuesBySlotId: { "class-choice-deity-champion-sanctification-level-2": "holy" },
      })
    ).toMatchObject([{ flag: "sanctification", options: [{ value: "holy" }] }]);

    const unrelatedGateSource = structuredClone(sourceDocument);
    (unrelatedGateSource.system.rules[0] as { predicate: unknown }).predicate = [{ not: "class:champion" }];
    expect(
      discoverClassChoiceMeta({
        ...args,
        sourceDocument: unrelatedGateSource,
        rollOptions: new Set([...args.rollOptions, "class:champion"]),
        selectedValuesBySlotId: { "class-choice-deity-champion-sanctification-level-2": "holy" },
      })
    ).toEqual([]);
  });

  it("extracts skill training metadata without actor reads", () => {
    const trainingMeta = discoverSkillTrainingMeta({
      classDocument: {
        name: "Rogue",
        system: {
          slug: "rogue",
          trainedSkills: {
            additional: 2,
            value: ["athletics"],
          },
          rules: [
            {
              key: "ChoiceSet",
              flag: "classSkill",
              prompt: "Choose a class skill",
              choices: [
                { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                { value: "stealth", label: "PF2E.Skill.Stealth" },
              ],
            },
          ],
        },
      },
      classSelection,
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
      intelligenceModifier: 0,
    });

    expect(trainingMeta).toMatchObject({
      classSlug: "rogue",
      className: "Rogue",
      fixedSkills: ["athletics"],
      additionalCount: 2,
      choiceRules: [
        {
          flag: "classSkill",
          options: [
            { slug: "acrobatics", label: "Acrobatics" },
            { slug: "stealth", label: "Stealth" },
          ],
        },
      ],
    });
  });
});
