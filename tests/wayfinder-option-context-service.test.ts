import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import {
  buildContextNote,
  buildOptionContext,
  hasDedicationFeatInContext,
  resolveSelectionSlug,
  resolveSelectionTraits,
} from "../src/wayfinder/application/option-context-service";

describe("wayfinder option context service", () => {
  it("builds option context from resolved documents, draft choices, and actor items", async () => {
    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-champion-sanctification-level-1"] = "holy";

    const context = await buildOptionContext({
      draft,
      resolveDocument: async (itemType) => {
        switch (itemType) {
          case "ancestry":
            return { name: "Human", system: { slug: "human", traits: { value: ["humanoid"] } } };
          case "heritage":
            return { name: "Aiuvarin", system: { traits: { value: ["elf"] } } };
          case "class":
            return { name: "Champion", system: { slug: "champion" } };
          case "deity":
            return { name: "Iomedae", system: { sanctification: { modal: "must", what: ["holy"] } } };
          default:
            return null;
        }
      },
      listActorItems: () => [
        {
          type: "feat",
          system: {
            traits: {
              value: ["dedication"],
            },
          },
        },
      ],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: (document) => {
        const typedDocument = document as { system?: { slug?: unknown } } | null;
        return typeof typedDocument?.system?.slug === "string" ? typedDocument.system.slug.trim().toLowerCase() : null;
      },
    });

    expect(context).toEqual({
      ancestrySlug: "human",
      ancestryTraits: ["humanoid", "human"],
      heritageTraits: ["elf"],
      classSlug: "champion",
      classHasSpellcasting: false,
      deitySelected: true,
      sanctification: "holy",
      hasDedicationFeat: true,
    });
  });

  it("marks class context as spellcasting when the resolved class has spellcasting progression", async () => {
    const context = await buildOptionContext({
      draft: createEmptyDraft(1),
      resolveDocument: async (itemType) =>
        itemType === "class" ? { name: "Wizard", system: { slug: "wizard", spellcasting: 1 } } : null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: (document) => {
        const typedDocument = document as { system?: { slug?: unknown } } | null;
        return typeof typedDocument?.system?.slug === "string" ? typedDocument.system.slug.trim().toLowerCase() : null;
      },
    });

    expect(context).toMatchObject({
      classSlug: "wizard",
      classHasSpellcasting: true,
    });
  });

  it("projects every drafted spell UUID by its spell-choice slot", async () => {
    const draft = createEmptyDraft(1);
    const slotId = "spell-choice-wizard-curriculum-rank-1-level-1";
    draft.spellChoices[slotId] = [
      selection("curriculum", "spell", "curriculum-a"),
      selection("curriculum", "spell", "curriculum-b"),
    ];

    const context = await buildOptionContext({
      draft,
      steps: [spellChoiceStep(slotId, "wizard-arcane-prepared")],
      resolveDocument: async () => null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });

    expect(context.selectedSpellChoicesBySlotId).toEqual({
      [slotId]: {
        destinationKey: "wizard-arcane-prepared",
        uuids: ["Compendium.test.pack.Item.curriculum-a", "Compendium.test.pack.Item.curriculum-b"],
      },
    });
  });

  it("indexes spells from an unflagged native entry using the shared destination matcher", async () => {
    const slotId = "spell-choice-wizard-spellbook-rank-1-level-1";
    const context = await buildOptionContext({
      draft: createEmptyDraft(1),
      steps: [spellChoiceStep(slotId, "wizard-arcane-prepared")],
      resolveDocument: async () => null,
      listActorItems: () => [
        {
          id: "wizard-entry",
          type: "spellcastingEntry",
          name: "Arcane Prepared Spells",
          system: {
            ability: { value: "int" },
            prepared: { value: "prepared" },
            tradition: { value: "arcane" },
          },
        },
        {
          id: "magic-missile",
          type: "spell",
          name: "Force Barrage",
          flags: { core: { sourceId: "Compendium.pf2e.spells-srd.Item.force-barrage" } },
          system: { location: { value: "wizard-entry" } },
        },
      ],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });

    expect(context.actorSpellUuidsByDestinationKey).toEqual({
      "wizard-arcane-prepared": ["Compendium.pf2e.spells-srd.Item.force-barrage"],
    });
  });

  it("builds roll-option context from drafted skill-training choices", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-wizard-level-1"] = {
      ruleChoices: {
        "feat:molten-wit:skill": "deception",
      },
      additional: [],
      loreChoices: {},
    };

    const context = await buildOptionContext({
      draft,
      steps: [
        {
          id: "skill-training-wizard-level-1",
          level: 1,
          kind: "skill-training",
          slotKind: "skill-training",
          title: "Wizard skill training",
          description: "",
          required: true,
          slotId: "skill-training-wizard-level-1",
          training: {
            classSlug: "wizard",
            className: "Wizard",
            fixedSkills: [],
            fixedLores: [],
            additionalCount: 0,
            loreChoices: [],
            choiceRules: [
              {
                key: "feat:molten-wit:skill",
                flag: "skill",
                rollOption: "molten-wit",
                prompt: "Choose Deception or Diplomacy",
                sourceLabel: "Molten Wit",
                options: [
                  { slug: "deception", label: "Deception" },
                  { slug: "diplomacy", label: "Diplomacy" },
                ],
                persistence: {
                  sourceItemType: "feat",
                  sourcePackId: "pf2e.feats-srd",
                  sourceDocumentId: "molten-wit",
                  sourceUuid: "Compendium.pf2e.feats-srd.Item.molten-wit",
                  sourceRuleIndex: 0,
                },
              },
            ],
          },
        } as any,
      ],
      resolveDocument: async () => null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });

    expect(context.rollOptions).toEqual(["molten-wit:deception"]);
  });

  it("uses PF2E class-choice rollOption keys when evaluating drafted choices", async () => {
    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-kinetic-gate-kineticGate-level-1"] = "dual-gate";

    const context = await buildOptionContext({
      draft,
      steps: [
        {
          id: "class-choice-kinetic-gate-kineticGate-level-1",
          level: 1,
          kind: "class-choice",
          slotKind: "class-choice",
          title: "Kinetic Gate",
          description: "",
          required: true,
          slotId: "class-choice-kinetic-gate-kineticGate-level-1",
          classChoice: {
            slotId: "class-choice-kinetic-gate-kineticGate-level-1",
            sourcePackId: "pf2e.classfeatures",
            sourceDocumentId: "kinetic-gate",
            sourceUuid: "Compendium.pf2e.classfeatures.Item.kinetic-gate",
            sourceName: "Kinetic Gate",
            sourceRuleIndex: 0,
            flag: "kineticGate",
            rollOption: "kinetic-gate:initial",
            classSlug: "kineticist",
            dependsOn: "class",
            options: [{ value: "dual-gate", label: "Dual Gate", img: null, detail: null }],
          },
        } as any,
      ],
      resolveDocument: async () => null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });

    expect(context.rollOptions).toEqual(["kinetic-gate:initial:dual-gate"]);
  });

  it("projects drafted skill training into option-context skill ranks", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-rogue-level-1"] = {
      ruleChoices: {
        "class:racketSkill": "deception",
      },
      additional: ["acrobatics"],
      loreChoices: {
        "background:lore": "Warfare Lore",
      },
    };

    const context = await buildOptionContext({
      draft,
      steps: [
        {
          id: "skill-training-rogue-level-1",
          level: 1,
          kind: "skill-training",
          slotKind: "skill-training",
          title: "Rogue skill training",
          description: "",
          required: true,
          slotId: "skill-training-rogue-level-1",
          training: {
            classSlug: "rogue",
            className: "Rogue",
            fixedSkills: ["stealth"],
            fixedLores: ["Scribing Lore"],
            additionalCount: 1,
            choiceRules: [
              {
                key: "class:racketSkill",
                flag: "racketSkill",
                prompt: "Choose a racket skill",
                sourceLabel: "Rogue",
                options: [{ slug: "deception", label: "Deception" }],
                persistence: null,
              },
            ],
            loreChoices: [
              {
                key: "background:lore",
                flag: "lore",
                prompt: "Lore",
                sourceLabel: "Background",
                placeholder: "Custom Lore",
                suggestions: [],
                allowCustom: true,
                persistence: null,
              },
            ],
          },
        } as any,
      ],
      skillRanks: {
        medicine: 1,
      },
      resolveDocument: async () => null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });

    expect(context.skillRanks).toMatchObject({
      acrobatics: 1,
      deception: 1,
      medicine: 1,
      "scribing-lore": 1,
      stealth: 1,
      "warfare-lore": 1,
    });
  });

  it("counts dedication feats from drafted feat selections when the actor does not already have one", async () => {
    const draft = createEmptyDraft(2);
    draft.selections["class-feat-level-2"] = selection("class-feat-level-2", "feat", "wizard-dedication");

    await expect(
      hasDedicationFeatInContext({
        draft,
        listActorItems: () => [],
        fetchSelectionDocument: async (selectionRef) =>
          selectionRef.documentId === "wizard-dedication"
            ? {
                type: "feat",
                system: {
                  traits: {
                    value: ["dedication"],
                  },
                },
              }
            : null,
        extractDocumentSlug: () => null,
      })
    ).resolves.toBe(true);
  });

  it("does not let a future-level dedication unlock an earlier feat picker", async () => {
    const draft = createEmptyDraft(4);
    draft.selections["archetype-feat-level-4"] = selection("archetype-feat-level-4", "feat", "wizard-dedication");
    const dependencies = {
      draft,
      listActorItems: () => [],
      fetchSelectionDocument: async () => ({
        type: "feat",
        system: { traits: { value: ["dedication"] } },
      }),
      extractDocumentSlug: () => null,
    };

    await expect(hasDedicationFeatInContext({ ...dependencies, maximumFeatLevel: 2 })).resolves.toBe(false);
    await expect(hasDedicationFeatInContext({ ...dependencies, maximumFeatLevel: 4 })).resolves.toBe(true);
    await expect(
      hasDedicationFeatInContext({
        ...dependencies,
        excludedFeatSlotId: "archetype-feat-level-4",
        maximumFeatLevel: 4,
      })
    ).resolves.toBe(false);
  });

  it("resolves selection traits and slugs from fetched documents", async () => {
    const selectedHeritage = selection("heritage-level-1", "heritage", "wintertouched");

    await expect(
      resolveSelectionTraits(selectedHeritage, {
        fetchSelectionDocument: async () => ({
          system: {
            slug: "wintertouched",
            traits: {
              value: ["cold", "Versatile"],
            },
          },
        }),
        extractDocumentSlug: (document) => {
          const typedDocument = document as { system?: { slug?: unknown } } | null;
          return typeof typedDocument?.system?.slug === "string"
            ? typedDocument.system.slug.trim().toLowerCase()
            : null;
        },
      })
    ).resolves.toEqual(["cold", "versatile", "wintertouched"]);

    await expect(
      resolveSelectionSlug(selectedHeritage, {
        fetchSelectionDocument: async () => ({
          system: {
            slug: "Wintertouched",
          },
        }),
        extractDocumentSlug: (document) => {
          const typedDocument = document as { system?: { slug?: unknown } } | null;
          return typeof typedDocument?.system?.slug === "string"
            ? typedDocument.system.slug.trim().toLowerCase()
            : null;
        },
      })
    ).resolves.toBe("wintertouched");
  });

  it("builds dependency-aware context notes outside the shell", async () => {
    const step: PendingStep = {
      id: "class-branch-cause-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Cause",
      description: "",
      required: true,
      slotId: "class-branch-cause-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
        maxLevel: 1,
      },
      branch: {
        slotId: "class-branch-cause-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "cause",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.cause",
        selectorName: "Cause",
        selectorRuleIndex: 0,
        flag: "cause",
        optionTag: "champion-cause",
        classSlug: "champion",
        dependsOn: "deity",
      },
    };

    await expect(
      buildContextNote(
        step,
        {
          ancestrySlug: null,
          ancestryTraits: [],
          heritageTraits: [],
          classSlug: "champion",
          classHasSpellcasting: false,
          deitySelected: false,
          sanctification: null,
          hasDedicationFeat: false,
        },
        {
          resolveDocument: async () => ({ name: "Champion" }),
        }
      )
    ).resolves.toBe(
      "Resolve the deity step first so Wayfinder can narrow champion causes to the legal sanctification path."
    );
  });

  it("states the eligibility boundary for Free Archetype choices", async () => {
    const step: PendingStep = {
      id: "archetype-feat-level-4",
      level: 4,
      kind: "pick-item",
      slotKind: "archetype-feat",
      title: "Level 4 Free Archetype feat",
      description: "",
      required: true,
      slotId: "archetype-feat-level-4",
      filters: { itemType: "feat", featTypes: ["class"], maxLevel: 4 },
    };

    await expect(
      buildContextNote(
        step,
        {
          ancestrySlug: null,
          ancestryTraits: [],
          heritageTraits: [],
          classSlug: "fighter",
          classHasSpellcasting: false,
          hasDedicationFeat: true,
        },
        { resolveDocument: async () => null }
      )
    ).resolves.toContain("archetype-family membership");
  });

  it("describes unified-theory wizard bonus spells as available arcane choices", async () => {
    const step: PendingStep = {
      id: "spell-choice-wizard-unified-rank-1-level-1",
      level: 1,
      kind: "spell-choice",
      slotKind: "spell-choice",
      title: "Unified theory bonus spell",
      description: "",
      required: true,
      slotId: "spell-choice-wizard-unified-rank-1-level-1",
      filters: {
        itemType: "spell",
      },
      spellChoice: {
        slotId: "spell-choice-wizard-unified-rank-1-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "school-of-unified-magical-theory",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.school-of-unified-magical-theory",
        sourceName: "School of Unified Magical Theory",
        classSlug: "wizard",
        dependsOn: "class-branch",
        destination: {
          type: "spellbook",
          key: "wizard-arcane-prepared",
          label: "Wizard spellbook",
          entryName: "Arcane Prepared Spells",
          tradition: "arcane",
          ability: "int",
          prepared: "prepared",
        },
        count: 1,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        requiresCurriculum: false,
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
      },
    };

    await expect(
      buildContextNote(
        step,
        {
          ancestrySlug: null,
          ancestryTraits: [],
          heritageTraits: [],
          classSlug: "wizard",
          classHasSpellcasting: true,
          deitySelected: false,
          sanctification: null,
          hasDedicationFeat: false,
        },
        {
          resolveDocument: async () => ({ name: "Wizard" }),
        }
      )
    ).resolves.toBe(
      "Showing rank 1 arcane spells that will be added to the Wizard spellbook. Source: School of Unified Magical Theory. Daily prepared loadouts remain on PF2E's character sheet."
    );
  });
});

function selection(slotId: string, itemType: string, documentId: string): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "class" : null,
    name: documentId,
    level: 2,
  };
}

function spellChoiceStep(slotId: string, destinationKey: string): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: { itemType: "spell" },
    spellChoice: {
      slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "wizard-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
      sourceName: "Wizard Spellcasting",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "spellbook",
        key: destinationKey,
        label: "Wizard spellbook",
        entryName: "Arcane Prepared Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}
