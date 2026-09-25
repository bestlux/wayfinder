import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  BLOODRAGER_DEDICATION_UUID,
  BLOODRAGER_TRADITION_SLOT,
  projectBloodragerTrainingSource,
} from "../src/wayfinder/class-archetype/bloodrager";
import { discoverClassChoiceMeta } from "../src/wayfinder/class-choice/rule-discovery";
import { activeSkillTrainingChoiceOptions } from "../src/wayfinder/domain/skill-training-choice-availability";
import {
  discoverSourceSkillTrainingMeta,
  type SkillTrainingSourceContext,
} from "../src/wayfinder/skill-training/source-discovery";

function source(): SkillTrainingSourceContext {
  return {
    sourceItemType: "feat",
    sourceSelection: {
      slotId: "class-archetype-grant-bloodrager-dedication-level-2",
      packId: "pf2e.feats-srd",
      documentId: "EcyPTxSwtdqrOtxY",
      uuid: BLOODRAGER_DEDICATION_UUID,
      itemType: "feat",
      featType: "class",
      level: 2,
      name: "Bloodrager Dedication",
      slug: "bloodrager-dedication",
    },
    sourceDocument: {
      type: "feat",
      name: "Bloodrager Dedication",
      system: {
        slug: "bloodrager-dedication",
        category: "class",
        level: { value: 2 },
        rules: [
          {
            key: "ChoiceSet",
            flag: "skill",
            choices: [
              { label: "Arcane", value: "arcana" },
              { label: "Divine", value: "religion" },
            ],
          },
        ],
      },
    },
  };
}

describe("Bloodrager tradition and replacement training", () => {
  it("discovers tradition as a native class choice rather than letting a replacement skill overwrite it", () => {
    const input = source();
    const choices = discoverClassChoiceMeta({
      sourceDocument: input.sourceDocument,
      sourceSelection: input.sourceSelection!,
      classSlug: "barbarian",
      extractSlug: () => "bloodrager-dedication",
      localize: (value) => value,
      rollOptions: new Set(),
    });
    expect(choices).toMatchObject([
      {
        slotId: BLOODRAGER_TRADITION_SLOT,
        sourceRuleIndex: 0,
        flag: "skill",
        options: [{ value: "arcana" }, { value: "religion" }],
      },
    ]);
  });

  it.each(["arcana", "religion"])("retains %s while offering another skill if already trained", (skill) => {
    const draft = createEmptyDraft(5);
    draft.classChoices[BLOODRAGER_TRADITION_SLOT] = skill;
    const input = source();
    const original = structuredClone(input);
    const metadata = discoverSourceSkillTrainingMeta({
      sources: [projectBloodragerTrainingSource(input, draft)],
      localize: (value) => value,
    });
    const choice = metadata.choiceRules[0];
    const training = { ruleChoices: {}, additional: [], loreChoices: {} };
    expect(choice.persistence).toBeNull();
    expect(activeSkillTrainingChoiceOptions(metadata, training, choice, {})).toEqual([
      { slug: skill, label: skill === "arcana" ? "Arcana" : "Religion" },
    ]);
    expect(
      activeSkillTrainingChoiceOptions(metadata, training, choice, { [skill]: 1 }).some(
        (option) => option.slug === "society"
      )
    ).toBe(true);
    expect(draft.classChoices[BLOODRAGER_TRADITION_SLOT]).toBe(skill);
    expect(input).toEqual(original);
  });

  it("waits for tradition before showing a training choice", () => {
    const metadata = discoverSourceSkillTrainingMeta({
      sources: [projectBloodragerTrainingSource(source(), createEmptyDraft(5))],
      localize: (value) => value,
    });
    expect(metadata.choiceRules).toEqual([]);
  });
});
