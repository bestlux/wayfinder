import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { discoverGrantedItemMeta } from "../src/wayfinder/class-choice/rule-discovery";
import { buildClassChoiceStepsFromFeatureSources } from "../src/wayfinder/class-choice/step-builders";
import { buildFlagChoiceStepsFromRules } from "../src/wayfinder/flag-choice/step-builders";
import { buildGrantChoiceStepsFromRules } from "../src/wayfinder/grant-choice/step-builders";
import { buildProjectedChoiceRuleRollOptions } from "../src/wayfinder/projected-rule-options";
import { buildSingletonChoiceStepsFromRules } from "../src/wayfinder/singleton-choice/step-builders";
import { discoverSourceSkillTrainingMeta } from "../src/wayfinder/skill-training/source-discovery";

const sourceSelection = {
  slotId: "archetype-feat-level-2",
  packId: "pf2e.feats-srd",
  documentId: "predicate-probe",
  uuid: "Compendium.pf2e.feats-srd.Item.predicate-probe",
  itemType: "feat",
  featType: "class",
  name: "Predicate Probe",
  level: 2,
} as const;
const active = new Set(["class:commander"]);
const extractSlug = (document: unknown) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null;

describe("ChoiceSet rule-level predicate gating", () => {
  it("suppresses grant-choice discovery when the rule predicate is unsatisfied", () => {
    const document = choiceDocument([
      itemFilterChoiceRule("grant", ["class:commander"]),
      { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.grant}" },
    ]);

    expect(buildGrantChoiceStepsFromRules(grantArgs(document))).toEqual([]);
    expect(buildGrantChoiceStepsFromRules({ ...grantArgs(document), activeRollOptions: active })).toHaveLength(1);
  });

  it("suppresses flag-choice discovery when the rule predicate is unsatisfied", () => {
    const document = choiceDocument([itemFilterChoiceRule("flag", ["class:commander"])]);
    const args = {
      sourceItemType: "feat" as const,
      effectiveSourceDocument: document,
      sourceSelection,
      extractSlug,
    };

    expect(buildFlagChoiceStepsFromRules(args)).toEqual([]);
    expect(buildFlagChoiceStepsFromRules({ ...args, activeRollOptions: active })).toHaveLength(1);
  });

  it("suppresses singleton-choice discovery when the rule predicate is unsatisfied", () => {
    const document = choiceDocument([
      {
        choices: [{ label: "First", value: "first" }],
        flag: "singleton",
        key: "ChoiceSet",
        predicate: ["class:commander"],
      },
    ]);
    const args = {
      sourceItemType: "feat" as const,
      effectiveSourceDocument: document,
      sourceSelection,
      extractSlug,
      localize: (value: string) => value,
    };

    expect(buildSingletonChoiceStepsFromRules(args)).toEqual([]);
    expect(buildSingletonChoiceStepsFromRules({ ...args, activeRollOptions: active })).toHaveLength(1);
  });

  it("suppresses class-choice discovery when the rule predicate is unsatisfied", () => {
    const document = {
      ...choiceDocument([
        {
          choices: [{ label: "First", value: "first" }],
          flag: "classChoice",
          key: "ChoiceSet",
          predicate: ["class:commander"],
        },
      ]),
      system: {
        ...choiceDocument([]).system,
        category: "classfeature",
        rules: [
          {
            choices: [{ label: "First", value: "first" }],
            flag: "classChoice",
            key: "ChoiceSet",
            predicate: ["class:commander"],
          },
        ],
      },
    };
    const classFeature = {
      level: 2,
      selection: sourceSelection,
      document,
    };
    const args = {
      classFeatures: [classFeature],
      effectiveDeityDocument: null,
      extractSlug,
      localize: (value: string) => value,
    };

    expect(buildClassChoiceStepsFromFeatureSources({ ...args, classSlug: "fighter" })).toEqual([]);
    expect(buildClassChoiceStepsFromFeatureSources({ ...args, classSlug: "commander" })).toHaveLength(1);
  });

  it("counts a class selected in the draft when projecting rule predicates", () => {
    const draft = createEmptyDraft(2);
    draft.selections["class-level-1"] = {
      ...sourceSelection,
      slotId: "class-level-1",
      packId: "pf2e.classes",
      documentId: "commander",
      uuid: "Compendium.pf2e.classes.Item.commander",
      itemType: "class",
      featType: null,
      name: "Commander",
      level: 1,
      slug: "commander",
    };

    expect(
      buildProjectedChoiceRuleRollOptions({
        draft,
        actorItems: [],
        sources: [],
      })
    ).toContain("class:commander");
  });

  it("suppresses skill-training discovery when the ChoiceSet rule predicate is unsatisfied", () => {
    const document = choiceDocument([
      {
        choices: [{ label: "Society", value: "society" }],
        flag: "trainedSkill",
        key: "ChoiceSet",
        predicate: ["class:commander"],
      },
    ]);
    const build = (activeRollOptions?: ReadonlySet<string>) =>
      discoverSourceSkillTrainingMeta({
        sources: [
          {
            sourceItemType: "feat",
            sourceSelection,
            sourceDocument: document,
          },
        ],
        localize: (value) => value,
        activeRollOptions,
      });

    expect(build().choiceRules).toEqual([]);
    expect(build(active).choiceRules).toHaveLength(1);
  });

  it("suppresses the specialized granted-item lane when its ChoiceSet predicate is unsatisfied", () => {
    const document = {
      ...choiceDocument([
        {
          choices: { itemType: "deity" },
          flag: "deity",
          key: "ChoiceSet",
          predicate: ["class:commander"],
        },
        { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.deity}" },
      ]),
      system: {
        ...choiceDocument([]).system,
        category: "classfeature",
        rules: [
          {
            choices: { itemType: "deity" },
            flag: "deity",
            key: "ChoiceSet",
            predicate: ["class:commander"],
          },
          { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.deity}" },
        ],
      },
    };
    const args = {
      selectorDocument: document,
      selectorSelection: sourceSelection,
      classSlug: "fighter",
    };

    expect(discoverGrantedItemMeta(args)).toBeNull();
    expect(discoverGrantedItemMeta({ ...args, activeRollOptions: active })).not.toBeNull();
  });
});

function choiceDocument(rules: Array<Record<string, unknown>>) {
  return {
    name: "Predicate Probe",
    type: "feat",
    system: {
      slug: "predicate-probe",
      level: { value: 2 },
      rules,
    },
  };
}

function itemFilterChoiceRule(flag: string, predicate: unknown[]) {
  return {
    choices: {
      filter: ["item:trait:tactic"],
      itemType: "action",
    },
    flag,
    key: "ChoiceSet",
    predicate,
  };
}

function grantArgs(document: unknown) {
  return {
    sourceItemType: "feat" as const,
    effectiveSourceDocument: document,
    sourceSelection,
    extractSlug,
  };
}
