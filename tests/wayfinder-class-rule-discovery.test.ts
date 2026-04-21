import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import {
  discoverClassBranchMeta,
  discoverClassChoiceMeta,
  discoverGrantedItemMeta,
  discoverSkillTrainingMeta,
} from "../src/wayfinder/class-choice/rule-discovery";

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
    });

    expect(
      discoverGrantedItemMeta({
        selectorDocument: {
          type: "feat",
          name: "Deity",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [{ key: "ChoiceSet", flag: "deity", choices: { itemType: "deity" } }],
          },
        },
        selectorSelection,
        classSlug: "cleric",
      })
    ).toBeNull();
  });

  it("filters class-choice options by roll options", () => {
    const choiceMeta = discoverClassChoiceMeta({
      sourceDocument: {
        type: "feat",
        name: "Sanctification",
        system: {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "sanctification",
              choices: [
                { value: "holy", label: "Holy", predicate: "deity:primary:sanctification:can:holy" },
                { value: "unholy", label: "Unholy", predicate: "deity:primary:sanctification:can:unholy" },
              ],
            },
          ],
        },
      },
      sourceSelection: selectorSelection,
      classSlug: "cleric",
      extractSlug,
      localize: (value) => value,
      rollOptions: new Set(["deity:primary:sanctification:can:holy"]),
    });

    expect(choiceMeta).toMatchObject([
      {
        flag: "sanctification",
        dependsOn: "deity",
        options: [{ value: "holy", label: "Holy" }],
      },
    ]);
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
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
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
