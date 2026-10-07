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

describe("projected drafted ChoiceSet precedence", () => {
  it("matches training discovery's document-id key on raw sources without a slug", () => {
    const documentId = "lX5KDS2hU5LihZRs";
    const selection = {
      ...sourceSelection,
      itemType: "background",
      documentId,
      name: "Martial Disciple",
      uuid: `Compendium.pf2e.backgrounds.Item.${documentId}`,
    };
    const sourceDocument = {
      name: "Martial Disciple",
      system: {
        rules: [
          {
            key: "ChoiceSet",
            flag: "skill",
            rollOption: "martial-disciple",
            choices: [
              { value: "acrobatics", label: "Acrobatics" },
              { value: "athletics", label: "Athletics" },
            ],
          },
          {
            key: "ActiveEffectLike",
            mode: "upgrade",
            path: "system.skills.{item|flags.pf2e.rulesSelections.skill}.rank",
            value: 1,
          },
        ],
      },
    };
    const sources = [{ sourceItemType: "background" as const, sourceSelection: selection, sourceDocument }];
    const meta = discoverSourceSkillTrainingMeta({ sources, localize: (value) => value });
    const key = meta.choiceRules[0]?.key;
    expect(key).toBe(`background:${documentId}:skill`);
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-level-1"] = {
      ruleChoices: { [key!]: "acrobatics" },
      additional: [],
      loreChoices: {},
    };
    expect(buildProjectedChoiceRuleRollOptions({ draft, sources, actorItems: [] })).toContain(
      "martial-disciple:acrobatics"
    );
  });

  it("uses active singleton metadata on a raw source without a slug and replaces its actor choice", () => {
    const { draft, step, sources } = holdMarkProjection();

    const options = buildProjectedChoiceRuleRollOptions({
      draft,
      steps: [step],
      sources,
      actorItems: [actorHoldMark()],
    });

    expect(options).toContain("hold-mark:deaths-head");
    expect(options).not.toContain("hold-mark:burning-sun");
  });

  it("preserves an actor choice from a different source with the same flag and roll option", () => {
    const { draft, step, sources } = holdMarkProjection();

    const options = buildProjectedChoiceRuleRollOptions({
      draft,
      steps: [step],
      sources,
      actorItems: [actorHoldMark(), actorHoldMark("Compendium.pf2e.feats-srd.Item.other-mark")],
    });

    expect(options).toContain("hold-mark:deaths-head");
    expect(options).toContain("hold-mark:burning-sun");
  });

  it("preserves a different ChoiceSet flag on the overridden source", () => {
    const { draft, step, sources } = holdMarkProjection();
    const actorItem = actorHoldMark();
    actorItem.system.rules.push({
      key: "ChoiceSet",
      flag: "otherMark",
      rollOption: "other-mark",
      choices: [{ value: "burning-sun", label: "Burning Sun" }],
    });
    actorItem.flags.system.rulesSelections.otherMark = "burning-sun";

    const options = buildProjectedChoiceRuleRollOptions({
      draft,
      steps: [step],
      sources,
      actorItems: [actorItem],
    });

    expect(options).toContain("hold-mark:deaths-head");
    expect(options).not.toContain("hold-mark:burning-sun");
    expect(options).toContain("other-mark:burning-sun");
  });

  it("uses the source name for drafted source-context choices when the raw source has no slug", () => {
    const { draft, sources } = holdMarkProjection();
    draft.singletonChoices = {};
    draft.classChoices["class-choice-hold-mark-holdMark-level-1"] = "deaths-head";

    const options = buildProjectedChoiceRuleRollOptions({
      draft,
      sources,
      actorItems: [actorHoldMark()],
    });

    expect(options).toContain("hold-mark:deaths-head");
    expect(options).not.toContain("hold-mark:burning-sun");
  });

  it.each([
    "invalid",
    "inactive",
    "wrong-source",
    "wrong-rule",
  ] as const)("does not accept an %s singleton draft or suppress the retained actor choice", (scenario) => {
    const { draft, step, sources } = holdMarkProjection();
    if (scenario === "invalid") draft.singletonChoices[step.slotId] = "unsupported-mark";
    if (scenario === "wrong-source") step.singletonChoice.sourceUuid = "Compendium.pf2e.feats-srd.Item.other-mark";
    if (scenario === "wrong-rule") step.singletonChoice.sourceRuleIndex = 1;
    // A matching legacy slot must not revive a choice absent from the active plan.
    draft.singletonChoices["singleton-choice-feat-hold-mark-holdMark-level-1"] = "deaths-head";

    const options = buildProjectedChoiceRuleRollOptions({
      draft,
      steps: scenario === "inactive" ? [] : [step],
      sources,
      actorItems: [actorHoldMark()],
    });

    expect(options).toContain("hold-mark:burning-sun");
    expect(options).not.toContain("hold-mark:deaths-head");
    expect(options).not.toContain("hold-mark:unsupported-mark");
  });
});

const holdMarkSelection = {
  ...sourceSelection,
  slotId: "ancestry-feat-level-1",
  documentId: "aQNsD2t0Tb4vToA4",
  uuid: "Compendium.pf2e.feats-srd.Item.aQNsD2t0Tb4vToA4",
  name: "Hold Mark",
  level: 1,
} as const;

function holdMarkDocument() {
  return {
    name: "Hold Mark",
    type: "feat",
    system: {
      level: { value: 1 },
      rules: [
        {
          key: "ChoiceSet",
          flag: "holdMark",
          rollOption: "hold-mark",
          choices: [
            { value: "burning-sun", label: "Burning Sun" },
            { value: "deaths-head", label: "Death's Head" },
          ],
        },
      ],
    },
  };
}

function holdMarkProjection() {
  const document = holdMarkDocument();
  const [discoveredStep] = buildSingletonChoiceStepsFromRules({
    sourceItemType: "feat",
    effectiveSourceDocument: document,
    sourceSelection: holdMarkSelection,
    extractSlug: () => "hold-mark",
    localize: (value) => value,
  });
  if (!discoveredStep) throw new Error("Expected the Hold Mark singleton choice.");
  const step = { ...discoveredStep, slotId: "active-hold-mark-choice" };
  const draft = createEmptyDraft(1);
  draft.singletonChoices[step.slotId] = "deaths-head";
  return {
    draft,
    step,
    sources: [{ sourceItemType: "feat", sourceSelection: holdMarkSelection, sourceDocument: document }],
  };
}

function actorHoldMark(sourceUuid: string = holdMarkSelection.uuid) {
  return {
    ...holdMarkDocument(),
    _stats: { compendiumSource: sourceUuid },
    flags: { system: { rulesSelections: { holdMark: "burning-sun" } as Record<string, string> } },
  };
}

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
