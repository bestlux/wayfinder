import { describe, expect, it } from "vitest";
import { applyDraftToActor } from "../src/actor-updater";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  buildActorHarness,
  classBranchStep,
  classChoiceStep,
  classSelectionStep,
  deitySelectionStep,
  selection,
  setGamePacks,
} from "./support/actor-updater-fixtures";

describe("actor-updater integration", () => {
  it("imports a selected wizard class and preseeds drafted branch selectors plus granted items", async () => {
    const { actor, createdItems } = buildActorHarness();

    setGamePacks({
      "pf2e.classes": {
        wizard: {
          name: "Wizard",
          type: "class",
          system: {
            items: {
              school: {
                level: 1,
                uuid: "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
                name: "Arcane School",
              },
              thesis: {
                level: 1,
                uuid: "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
                name: "Arcane Thesis",
              },
              bond: {
                level: 1,
                uuid: "Compendium.pf2e.classfeatures.Item.arcane-bond",
                name: "Arcane Bond",
              },
            },
          },
        },
      },
      "pf2e.classfeatures": {
        "arcane-school-selector": {
          name: "Arcane School",
          type: "feat",
          system: {
            category: "classfeature",
            rules: [
              {
                key: "ChoiceSet",
                flag: "arcaneSchool",
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.arcaneSchool}",
              },
            ],
          },
        },
        "arcane-thesis-selector": {
          name: "Arcane Thesis",
          type: "feat",
          system: {
            category: "classfeature",
            rules: [
              {
                key: "ChoiceSet",
                flag: "arcaneThesis",
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.arcaneThesis}",
              },
            ],
          },
        },
        "school-battle-magic": {
          name: "School of Battle Magic",
          type: "feat",
          system: {
            category: "classfeature",
            level: { value: 1 },
          },
        },
        "spell-blending": {
          name: "Spell Blending",
          type: "feat",
          system: {
            category: "classfeature",
            level: { value: 1 },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "pf2e.classfeatures",
      "school-battle-magic",
      "feat",
      "School of Battle Magic",
      "classfeature"
    );
    draft.branchSelections["class-branch-arcane-thesis-level-1"] = selection(
      "class-branch-arcane-thesis-level-1",
      "pf2e.classfeatures",
      "spell-blending",
      "feat",
      "Spell Blending",
      "classfeature"
    );

    await applyDraftToActor(actor as any, draft, [
      classSelectionStep(),
      classBranchStep({
        slotId: "class-branch-arcane-school-level-1",
        title: "Arcane School",
        selectorDocumentId: "arcane-school-selector",
        selectorName: "Arcane School",
        flag: "arcaneSchool",
        optionTag: "wizard-arcane-school",
        classSlug: "wizard",
      }),
      classBranchStep({
        slotId: "class-branch-arcane-thesis-level-1",
        title: "Arcane Thesis",
        selectorDocumentId: "arcane-thesis-selector",
        selectorName: "Arcane Thesis",
        flag: "arcaneThesis",
        optionTag: "wizard-arcane-thesis",
        classSlug: "wizard",
      }),
    ]);

    const schoolSelector = createdItems.find(
      (item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.arcane-school-selector"
    );
    const thesisSelector = createdItems.find(
      (item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector"
    );

    expect(schoolSelector?.flags?.pf2e?.rulesSelections?.arcaneSchool).toBe(
      "Compendium.pf2e.classfeatures.Item.school-battle-magic"
    );
    expect(thesisSelector?.flags?.pf2e?.rulesSelections?.arcaneThesis).toBe(
      "Compendium.pf2e.classfeatures.Item.spell-blending"
    );
    expect(
      createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.school-battle-magic")
    ).toHaveLength(1);
    expect(
      createdItems.filter((item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.spell-blending")
    ).toHaveLength(1);
  });

  it("imports a selected cleric class and preseeds deity-driven class features from the draft", async () => {
    const { actor, createdItems } = buildActorHarness();

    setGamePacks({
      "pf2e.classes": {
        cleric: {
          name: "Cleric",
          type: "class",
          system: {
            items: {
              deity: {
                level: 1,
                uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
                name: "Deity",
              },
              font: {
                level: 1,
                uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
                name: "Divine Font",
              },
              spellcasting: {
                level: 1,
                uuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
                name: "Cleric Spellcasting",
              },
            },
          },
        },
      },
      "pf2e.classfeatures": {
        "deity-cleric": {
          name: "Deity",
          type: "feat",
          system: {
            category: "classfeature",
            rules: [
              {
                key: "ChoiceSet",
                flag: "deity",
                choices: {
                  itemType: "deity",
                },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.deity}",
              },
              {
                key: "ChoiceSet",
                flag: "sanctification",
                choices: [
                  { value: "holy", label: "Holy" },
                  { value: "unholy", label: "Unholy" },
                ],
              },
            ],
          },
        },
        "divine-font": {
          name: "Divine Font",
          type: "feat",
          system: {
            category: "classfeature",
            rules: [
              {
                key: "ChoiceSet",
                flag: "divineFont",
                choices: [
                  { value: "heal", label: "Heal" },
                  { value: "harm", label: "Harm" },
                ],
              },
            ],
          },
        },
        "cleric-spellcasting": {
          name: "Cleric Spellcasting",
          type: "feat",
          system: {
            category: "classfeature",
          },
        },
      },
      "pf2e.deities": {
        gorum: {
          name: "Gorum",
          type: "deity",
          system: {
            sanctification: {
              modal: "can",
              what: ["holy", "unholy"],
            },
            font: ["heal", "harm"],
          },
        },
      },
      "pf2e.spells-srd": {
        rfZpqmj0AIIdkVIs: {
          name: "Heal",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
        wdA52JJnsuQWeyqz: {
          name: "Harm",
          type: "spell",
          system: {
            level: { value: 1 },
            traits: {
              traditions: ["divine"],
              value: [],
            },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "cleric", "class", "Cleric");
    draft.selections["deity-level-1"] = selection("deity-level-1", "pf2e.deities", "gorum", "deity", "Gorum");
    draft.classChoices["class-choice-deity-sanctification-level-1"] = "holy";
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    await applyDraftToActor(actor as any, draft, [
      classSelectionStep(),
      deitySelectionStep(),
      classChoiceStep({
        slotId: "class-choice-deity-sanctification-level-1",
        title: "Sanctification",
        sourceDocumentId: "deity-cleric",
        sourceName: "Deity",
        sourceRuleIndex: 2,
        flag: "sanctification",
        classSlug: "cleric",
        dependsOn: "deity",
        options: [
          { value: "holy", label: "Holy", img: null, detail: null },
          { value: "unholy", label: "Unholy", img: null, detail: null },
        ],
      }),
      classChoiceStep({
        slotId: "class-choice-divine-font-divineFont-level-1",
        title: "Divine Font",
        sourceDocumentId: "divine-font",
        sourceName: "Divine Font",
        sourceRuleIndex: 0,
        flag: "divineFont",
        classSlug: "cleric",
        dependsOn: "deity",
        options: [
          { value: "heal", label: "Heal", img: null, detail: null },
          { value: "harm", label: "Harm", img: null, detail: null },
        ],
      }),
    ]);

    const deityFeature = createdItems.find(
      (item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.deity-cleric"
    );
    const divineFontFeature = createdItems.find(
      (item) => item?.sourceId === "Compendium.pf2e.classfeatures.Item.divine-font"
    );
    const deityGrant = createdItems.find((item) => item?.sourceId === "Compendium.pf2e.deities.Item.gorum");
    const preparedEntry = createdItems.find(
      (item) => item?.type === "spellcastingEntry" && item?.name === "Divine Prepared Spells"
    );
    const fontEntry = createdItems.find(
      (item) => item?.type === "spellcastingEntry" && item?.name === "Divine Font (Harmful)"
    );
    const fontSpell = createdItems.find(
      (item) => item?.type === "spell" && item?.sourceId === "Compendium.pf2e.spells-srd.Item.wdA52JJnsuQWeyqz"
    );

    expect(deityFeature?.flags?.pf2e?.rulesSelections).toEqual({
      deity: "Compendium.pf2e.deities.Item.gorum",
      sanctification: "holy",
    });
    expect(divineFontFeature?.flags?.pf2e?.rulesSelections).toEqual({
      divineFont: "harm",
    });
    expect(deityGrant).toBeTruthy();
    expect(preparedEntry).toBeTruthy();
    expect(fontEntry).toBeTruthy();
    const fontSpellLocation =
      typeof fontSpell?.system?.location === "object" &&
      fontSpell.system.location !== null &&
      "value" in fontSpell.system.location
        ? fontSpell.system.location.value
        : fontSpell?.system?.location;
    expect(fontSpellLocation).toBe(fontEntry?.id);
  });

  it("raises actor level after apply when the draft target exceeds the current actor level", async () => {
    const { actor } = buildActorHarness({ level: 1 });
    const draft = createEmptyDraft(3);

    await applyDraftToActor(actor as any, draft, []);

    expect(actor.update).toHaveBeenCalledWith({
      "system.details.level.value": 3,
    });
  });

  it("preseeds singleton grant selections before creating an Ancient Elf heritage item", async () => {
    const { actor, createdItems } = buildActorHarness();

    setGamePacks({
      "pf2e.classes": {
        wizard: {
          name: "Wizard",
          type: "class",
          system: {
            items: {},
          },
        },
      },
      "pf2e.heritages": {
        "ancient-elf": {
          name: "Ancient Elf",
          type: "heritage",
          system: {
            slug: "ancient-elf",
            rules: [
              {
                key: "ChoiceSet",
                flag: "ancientElf",
                choices: {
                  itemType: "feat",
                  filter: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
                },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.system.rulesSelections.ancientElf}",
              },
            ],
          },
        },
      },
      "pf2e.feats-srd": {
        "fighter-dedication": {
          name: "Fighter Dedication",
          type: "feat",
          system: {
            category: "class",
            featType: { value: "class" },
            level: { value: 2 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "attribute",
                choices: [
                  { value: "str", label: "Strength" },
                  { value: "dex", label: "Dexterity" },
                ],
              },
            ],
            traits: { value: ["archetype", "dedication", "multiclass"] },
          },
        },
      },
    });

    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    draft.selections["heritage-level-1"] = selection(
      "heritage-level-1",
      "pf2e.heritages",
      "ancient-elf",
      "heritage",
      "Ancient Elf"
    );
    draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"] = selection(
      "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      "pf2e.feats-srd",
      "fighter-dedication",
      "feat",
      "Fighter Dedication",
      "class"
    );
    draft.singletonChoices["singleton-choice-feat-fighter-dedication-attribute-level-1"] = "str";

    await applyDraftToActor(actor as any, draft, [
      classSelectionStep(),
      heritageSelectionStep(),
      ancientElfDedicationStep(),
      fighterDedicationAttributeStep(),
    ]);

    const heritage = createdItems.find((item) => item?.sourceId === "Compendium.pf2e.heritages.Item.ancient-elf");
    const dedication = createdItems.find(
      (item) => item?.sourceId === "Compendium.pf2e.feats-srd.Item.fighter-dedication"
    );

    expect(heritage?.flags?.pf2e?.rulesSelections?.ancientElf).toBe(
      "Compendium.pf2e.feats-srd.Item.fighter-dedication"
    );
    expect((heritage?.system?.rules as Array<Record<string, unknown>> | undefined)?.[0]?.selection).toBe(
      "Compendium.pf2e.feats-srd.Item.fighter-dedication"
    );
    expect(dedication).toBeTruthy();
    expect(dedication?.flags?.pf2e?.rulesSelections?.attribute).toBe("str");
  });

  it("stacks later skill increases on top of singleton skill choices during apply", async () => {
    const { actor } = buildActorHarness({
      level: 1,
      items: [
        {
          id: "heritage-1",
          type: "heritage",
          sourceId: "Compendium.pf2e.heritages.Item.skilled-human",
          flags: {
            core: {
              sourceId: "Compendium.pf2e.heritages.Item.skilled-human",
            },
            pf2e: {
              rulesSelections: {},
            },
          },
          system: {
            rules: [
              {
                key: "ChoiceSet",
                flag: "trainedSkill",
                choices: {
                  config: "skills",
                },
              },
              {
                key: "ActiveEffectLike",
                path: "system.skills.{item|flags.pf2e.rulesSelections.trainedSkill}.rank",
                value: 1,
              },
            ],
          },
        },
      ],
    });
    actor.system = {
      ...actor.system,
      skills: {
        arcana: { rank: 0 },
      },
    };

    const draft = createEmptyDraft(3);
    draft.singletonChoices["singleton-choice-heritage-skilled-human-trainedSkill-level-1"] = "arcana";
    draft.skillIncreases["skill-increase-level-3"] = "arcana";

    await applyDraftToActor(actor as any, draft, [heritageSingletonSkillChoiceStep()]);

    const updateCalls = actor.update.mock.calls.map(([updates]) => updates as Record<string, unknown>);
    expect(updateCalls).toContainEqual({
      "system.skills.arcana.rank": 1,
    });
    expect(updateCalls).toContainEqual({
      "system.skills.arcana.rank": 2,
    });
  });

  it("preseeds heritage skill-training choices before creating the heritage item", async () => {
    const { actor, createdItems } = buildActorHarness();
    setGamePacks({
      "pf2e.heritages": {
        "skilled-human": {
          name: "Skilled Human",
          type: "heritage",
          system: {
            slug: "skilled-human",
            rules: [
              {
                key: "ChoiceSet",
                flag: "trainedSkill",
                choices: {
                  config: "skills",
                },
              },
              {
                key: "ActiveEffectLike",
                path: "system.skills.{item|flags.pf2e.rulesSelections.trainedSkill}.rank",
                value: 1,
              },
            ],
          },
        },
      },
    });
    actor.system = {
      ...actor.system,
      skills: {
        society: { rank: 0 },
      },
    };

    const draft = createEmptyDraft(1);
    draft.selections["heritage-level-1"] = selection(
      "heritage-level-1",
      "pf2e.heritages",
      "skilled-human",
      "heritage",
      "Skilled Human"
    );
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: {
        "heritage:skilled-human:trainedSkill": "society",
      },
      additional: [],
      loreChoices: {},
    };

    await applyDraftToActor(actor as any, draft, [
      heritageSelectionStep(),
      skilledHumanTrainingStep("skill-training-wizard-level-1"),
    ]);

    const heritage = createdItems.find((item) => item?.sourceId === "Compendium.pf2e.heritages.Item.skilled-human");
    expect(heritage?.flags?.pf2e?.rulesSelections?.trainedSkill).toBe("society");
    expect((heritage?.system?.rules as Array<Record<string, unknown>> | undefined)?.[0]?.selection).toBe("society");
  });
});

function heritageSingletonSkillChoiceStep(): PendingStep {
  return {
    id: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
    level: 1,
    kind: "singleton-choice",
    slotKind: "singleton-choice",
    title: "Trained Skill",
    description: "",
    required: true,
    slotId: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
    singletonChoice: {
      slotId: "singleton-choice-heritage-skilled-human-trainedSkill-level-1",
      sourceItemType: "heritage",
      sourcePackId: "pf2e.heritages",
      sourceDocumentId: "skilled-human",
      sourceUuid: "Compendium.pf2e.heritages.Item.skilled-human",
      sourceName: "Skilled Human",
      sourceRuleIndex: 0,
      flag: "trainedSkill",
      prompt: "Choose a skill",
      predicate: [],
      rollOption: null,
      options: [
        { value: "arcana", label: "Arcana", img: null, detail: null },
        { value: "society", label: "Society", img: null, detail: null },
      ],
    },
  };
}

function heritageSelectionStep(): PendingStep {
  return {
    id: "heritage-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "heritage",
    title: "Choose a heritage",
    description: "",
    required: true,
    slotId: "heritage-level-1",
    filters: {
      itemType: "heritage",
    },
  };
}

function skilledHumanTrainingStep(slotId: string): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: "Wizard training",
    description: "",
    required: true,
    slotId,
    training: {
      classSlug: "wizard",
      className: "Wizard",
      fixedSkills: [],
      fixedLores: [],
      choiceRules: [
        {
          key: "heritage:skilled-human:trainedSkill",
          flag: "trainedSkill",
          prompt: "Choose a skill",
          sourceLabel: "Skilled Human",
          options: [
            { slug: "arcana", label: "Arcana" },
            { slug: "society", label: "Society" },
          ],
          persistence: {
            sourceItemType: "heritage",
            sourcePackId: "pf2e.heritages",
            sourceDocumentId: "skilled-human",
            sourceUuid: "Compendium.pf2e.heritages.Item.skilled-human",
            sourceRuleIndex: 0,
          },
        },
      ],
      loreChoices: [],
      additionalCount: 0,
    },
  };
}

function ancientElfDedicationStep(): PendingStep {
  return {
    id: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "grant-choice",
    title: "Ancient Elf feat grant",
    description: "",
    required: true,
    slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
    filters: {
      itemType: "feat",
    },
    grantSelection: {
      slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      sourceItemType: "heritage",
      selectorPackId: "pf2e.heritages",
      selectorDocumentId: "ancient-elf",
      selectorUuid: "Compendium.pf2e.heritages.Item.ancient-elf",
      selectorName: "Ancient Elf",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "ancientElf",
      itemType: "feat",
      classSlug: null,
      dependsOn: "class",
      filters: {
        itemType: "feat",
      },
    },
  };
}

function fighterDedicationAttributeStep(): PendingStep {
  return {
    id: "singleton-choice-feat-fighter-dedication-attribute-level-1",
    level: 1,
    kind: "singleton-choice",
    slotKind: "singleton-choice",
    title: "Attribute",
    description: "Select the class DC's key attribute.",
    required: true,
    slotId: "singleton-choice-feat-fighter-dedication-attribute-level-1",
    singletonChoice: {
      slotId: "singleton-choice-feat-fighter-dedication-attribute-level-1",
      sourceItemType: "feat",
      sourcePackId: "pf2e.feats-srd",
      sourceDocumentId: "fighter-dedication",
      sourceUuid: "Compendium.pf2e.feats-srd.Item.fighter-dedication",
      sourceName: "Fighter Dedication",
      sourceRuleIndex: 0,
      flag: "attribute",
      prompt: "Select the class DC's key attribute.",
      predicate: [],
      rollOption: null,
      options: [
        { value: "str", label: "Strength", img: null, detail: null },
        { value: "dex", label: "Dexterity", img: null, detail: null },
      ],
    },
  };
}
