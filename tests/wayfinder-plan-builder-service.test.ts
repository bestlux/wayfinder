import { describe, expect, it, vi } from "vitest";
import type { BuildStateActor } from "../src/build-state/document-types";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type {
  ActorSnapshot,
  ClassBranchMeta,
  ClassChoiceMeta,
  ClassGrantMeta,
  PendingStep,
  SelectionRef,
  SingletonChoiceMeta,
  SpellChoiceMeta,
} from "../src/types";
import {
  buildWayfinderAppPlan,
  findPlanStepBySlotId,
} from "../src/wayfinder/application/wayfinder-plan-builder-service";

describe("wayfinder plan builder service", () => {
  it("assembles the actor-facing plan builders with resolved documents and actor readers", async () => {
    const actor = {
      items: {
        contents: [
          {
            type: "feat",
            name: "Student of the Canon",
            system: { featType: { value: "skill" } },
          },
          {
            type: "feat",
            name: "Cat Fall",
            flags: { [MODULE_ID]: { slotId: "skill-feat-level-1" } },
          },
          {
            type: "feat",
            name: "Cat Fall Duplicate",
            flags: { [MODULE_ID]: { slotId: "skill-feat-level-1" } },
          },
        ],
      },
    } as unknown as BuildStateActor;
    const draft = createEmptyDraft(1);
    draft.selections.class = selection("class-level-1", "class", "wizard", "Wizard");
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "feat",
      "elven-lore",
      "Elven Lore",
      "ancestry"
    );
    draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"] = selection(
      "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      "feat",
      "fighter-dedication",
      "Fighter Dedication",
      "class"
    );
    draft.selections["class-feat-level-2"] = selection(
      "class-feat-level-2",
      "feat",
      "order-explorer",
      "Order Explorer",
      "class"
    );
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "feat",
      "school-of-unified-magical-theory",
      "School of Unified Magical Theory",
      "classfeature"
    );
    draft.selections["grant-choice-class-classfeature-school-of-rooted-wisdom-branch-level-1"] = {
      slotId: "grant-choice-class-classfeature-school-of-rooted-wisdom-branch-level-1",
      packId: "pf2e.classfeatures",
      documentId: "cascade-bearers",
      uuid: "Compendium.pf2e.classfeatures.Item.cascade-bearers",
      itemType: "feat",
      featType: "classfeature",
      name: "Cascade Bearers",
      level: 1,
    };
    const snapshot: ActorSnapshot = {
      actorId: "actor-1",
      level: 2,
      isBlank: false,
      singletonSlots: {
        ancestry: false,
        heritage: false,
        background: false,
        class: true,
        deity: false,
      },
      featCounts: {
        ancestry: 1,
        class: 2,
        archetype: 3,
        skill: 3,
        general: 0,
      },
      fulfilledStepIds: ["class-feat-level-2", "skill-feat-level-1"],
      sourceIds: [],
      namesByType: {},
      skillRanks: {},
    };
    const classDocument = { name: "Wizard", slug: "wizard" };
    const deityDocument = { name: "Nethys" };
    const schoolDocument = { name: "Battle Magic" };
    const resolveDocument = vi.fn(async (itemType: string) => {
      if (itemType === "class") {
        return classDocument;
      }
      if (itemType === "deity") {
        return deityDocument;
      }
      return null;
    });
    const resolveArcaneSchoolDocument = vi.fn(async () => schoolDocument);

    const readExistingBranchSelection = vi.fn((_actor: unknown, _branch: ClassBranchMeta) => "existing-branch");
    const readExistingGrantedSelection = vi.fn((_actor: unknown, _grant: ClassGrantMeta) => "existing-grant");
    const readExistingFlagChoiceSelection = vi.fn(() => "existing-flag-choice");
    const readExistingLanguageSelections = vi.fn((_actor: unknown) => []);
    const readExistingClassChoiceSelection = vi.fn((_actor: unknown, _choice: ClassChoiceMeta) => "holy");
    const readExistingSingletonChoiceSelection = vi.fn((_actor: unknown, _choice: SingletonChoiceMeta) => "society");
    const readExistingSpellChoiceSelections = vi.fn((_actor: unknown, _choice: SpellChoiceMeta) => [
      selection("spell-choice-wizard-level-1", "spell", "magic-missile", "Magic Missile"),
    ]);

    const buildClassFeatSteps = vi.fn(async () => [step("class-feat-level-2")]);
    const buildClassSkillFeatSteps = vi.fn(async () => [step("skill-feat-level-1")]);
    const buildClassTrainingSteps = vi.fn(async (params) => {
      expect(params.draftClassSelection).toEqual(draft.selections.class);
      expect(params.targetLevel).toBe(4);
      expect(params.localize("PF2E.Test")).toBe("loc:PF2E.Test");
      expect(params.sourceSelections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["ancestry-feat-level-1"],
            sourceDocument: { fetched: "elven-lore" },
          }),
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"],
            sourceDocument: { fetched: "fighter-dedication" },
          }),
        ])
      );
      return [step("skill-training-wizard-level-1")];
    });
    const buildSingletonChoiceSteps = vi.fn(async (params) => {
      expect(params.draft).toBe(draft);
      expect(params.targetLevel).toBe(4);
      expect(params.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceItemType: "class",
            sourceSelection: draft.selections.class,
            sourceDocument: classDocument,
          }),
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["ancestry-feat-level-1"],
            sourceDocument: { fetched: "elven-lore" },
          }),
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["class-feat-level-2"],
            sourceDocument: { fetched: "order-explorer" },
          }),
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"],
            sourceDocument: { fetched: "fighter-dedication" },
          }),
        ])
      );
      return [];
    });
    const buildGrantChoiceSteps = vi.fn(async (params) => {
      expect(params.targetLevel).toBe(4);
      expect(params.hasClassSelection).toBe(true);
      expect(params.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["ancestry-feat-level-1"],
            sourceDocument: { fetched: "elven-lore" },
          }),
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["class-feat-level-2"],
            sourceDocument: { fetched: "order-explorer" },
          }),
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"],
            sourceDocument: { fetched: "fighter-dedication" },
          }),
          expect.objectContaining({
            sourceItemType: "classfeature",
            sourceSelection: draft.branchSelections["class-branch-arcane-school-level-1"],
            sourceDocument: { fetched: "school-of-unified-magical-theory" },
          }),
        ])
      );
      return [];
    });
    const buildFlagChoiceSteps = vi.fn(async (params) => {
      expect(params.targetLevel).toBe(4);
      expect(params.actorContext).toEqual({ ancestrySlug: null, classSlug: "wizard" });
      expect(params.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceItemType: "feat",
            sourceSelection: draft.selections["class-feat-level-2"],
            sourceDocument: { fetched: "order-explorer" },
          }),
          expect.objectContaining({
            sourceItemType: "classfeature",
            sourceSelection: draft.branchSelections["class-branch-arcane-school-level-1"],
            sourceDocument: { fetched: "school-of-unified-magical-theory" },
          }),
        ])
      );
      expect(
        params.readExistingFlagChoiceSelection({
          slotId: "flag-choice-none-feat-source-muse-level-2",
          sourceItemType: "feat",
          sourcePackId: "test.pack",
          sourceDocumentId: "source",
          sourceUuid: "Compendium.test.pack.Item.source",
          sourceName: "Source",
          sourceRuleIndex: 0,
          flag: "muse",
          prompt: null,
          itemType: "feat",
          selectionValue: "uuid",
          dependsOn: null,
          filters: {
            itemType: "feat",
          },
        })
      ).toBe("existing-flag-choice");
      return [step("flag-choice-none-feat-source-muse-level-2")];
    });
    const buildLanguageChoiceSteps = vi.fn(async () => []);
    const buildClassArchetypeSteps = vi.fn(async () => []);
    const buildClassBranchSteps = vi.fn(async (params) => {
      expect(params.draft).toBe(draft);
      expect(params.effectiveClassDocument).toBe(classDocument);
      expect(params.targetLevel).toBe(4);
      expect(await params.fetchSelectionDocument(selection("slot", "feat", "battle-magic", "Battle Magic"))).toEqual({
        fetched: "battle-magic",
      });
      expect(params.extractSlug({ slug: "battle-magic" })).toBe("battle-magic");
      expect(
        params.readExistingBranchSelection({
          slotId: "class-branch-arcane-school-level-1",
          sourcePackId: "test.pack",
          sourceDocumentId: "battle-magic",
          sourceUuid: "Compendium.test.pack.Item.battle-magic",
          sourceName: "Battle Magic",
          selectorName: "Arcane School",
          classSlug: "wizard",
          dependsOn: "class",
        })
      ).toBe("existing-branch");
      return [step("class-branch-arcane-school-level-1")];
    });
    const buildClassGrantedItemSteps = vi.fn(async (params) => {
      expect(
        params.readExistingGrantedSelection({
          slotId: "deity-level-1",
          sourceItemType: "classfeature",
          itemType: "deity",
          selectorPackId: "test.pack",
          selectorDocumentId: "grant",
          selectorUuid: "Compendium.test.pack.Item.grant",
          selectorName: "Deity",
          selectorRuleIndex: 0,
          grantRuleIndex: 1,
          flag: "deity",
          classSlug: "wizard",
          dependsOn: "class",
          filters: {
            itemType: "deity",
          },
        })
      ).toBe("existing-grant");
      return [step("deity-level-1")];
    });
    const buildClassChoiceSteps = vi.fn(async (params) => {
      expect(params.effectiveClassDocument).toBe(classDocument);
      expect(params.effectiveDeityDocument).toBe(deityDocument);
      expect(
        params.readExistingClassChoiceSelection({
          slotId: "class-choice-wizard-thesis-level-1",
          sourcePackId: "test.pack",
          sourceDocumentId: "thesis",
          sourceUuid: "Compendium.test.pack.Item.thesis",
          sourceName: "Thesis",
          sourceRuleIndex: 0,
          flag: "thesis",
          classSlug: "wizard",
          dependsOn: "class",
          options: [],
        })
      ).toBe("holy");
      return [step("class-choice-wizard-thesis-level-1")];
    });
    const buildSpellChoiceSteps = vi.fn(async (params) => {
      expect(params.draft).toBe(draft);
      expect(params.currentLevel).toBe(snapshot.level);
      expect(params.effectiveClassDocument).toBe(classDocument);
      expect(params.effectiveDeityDocument).toBe(deityDocument);
      expect(params.effectiveSchoolDocument).toBe(schoolDocument);
      expect(params.effectiveClassFeatureDocuments).toEqual([
        { fetched: "school-of-unified-magical-theory" },
        { fetched: "cascade-bearers" },
      ]);
      expect(
        params.readExistingSpellChoiceSelections({
          slotId: "spell-choice-wizard-level-1",
          sourcePackId: "test.pack",
          sourceDocumentId: "spellbook",
          sourceUuid: "Compendium.test.pack.Item.spellbook",
          sourceName: "Spellbook",
          classSlug: "wizard",
          dependsOn: "class",
          destination: {
            type: "spellbook",
            key: "wizard-arcane-prepared",
            label: "Wizard spellbook",
            entryName: "Wizard spellbook",
            tradition: "arcane",
            ability: "int",
            prepared: "prepared",
          },
          count: 1,
          minRank: 1,
          maxRank: 1,
          cantrip: false,
          curriculumSpellNames: [],
          additionalAllowedSpellNames: [],
          restrictToCommon: false,
        })
      ).toHaveLength(1);
      return [step("spell-choice-wizard-level-1")];
    });

    const buildWayfinderPlan = vi.fn(async (receivedSnapshot, receivedDraft, deps) => {
      expect(receivedSnapshot).toBe(snapshot);
      expect(receivedDraft).toBe(draft);
      const steps = [
        ...(await deps.buildClassFeatSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildClassSkillFeatSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildClassTrainingSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildGrantChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildFlagChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildSingletonChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildLanguageChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildClassArchetypeSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildClassBranchSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildClassGrantedItemSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildClassChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildSpellChoiceSteps(receivedSnapshot, receivedDraft, 4)),
      ];
      return {
        recommendedTargetLevel: 4,
        targetLevel: 4,
        steps,
      };
    });

    const plan = await buildWayfinderAppPlan(
      {
        actor,
        snapshot,
        draft,
        resolveDocument,
        resolveArcaneSchoolDocument,
        localize: (value) => `loc:${value}`,
      },
      {
        buildWayfinderPlan,
        buildClassFeatSteps,
        buildClassSkillFeatSteps,
        buildClassTrainingSteps,
        buildGrantChoiceSteps,
        buildFlagChoiceSteps,
        buildSingletonChoiceSteps,
        buildLanguageChoiceSteps,
        buildClassArchetypeSteps,
        buildClassBranchSteps,
        buildClassGrantedItemSteps,
        buildClassChoiceSteps,
        buildSpellChoiceSteps,
        findDraftSelectionByType: (_draft, itemType) => (itemType === "class" ? draft.selections.class : null),
        readExistingSingletonSourceSelection: () => null,
        readExistingBranchSelection,
        readExistingGrantedSelection,
        readExistingFlagChoiceSelection,
        readExistingLanguageSelections,
        readExistingClassChoiceSelection,
        readExistingSingletonChoiceSelection,
        readExistingSpellChoiceSelections,
        fetchSelectionDocument: async (selectionRef) => ({ fetched: selectionRef.documentId }),
        extractDocumentSlug: (document) => {
          if (!document || typeof document !== "object" || !("slug" in document)) {
            return null;
          }
          return typeof document.slug === "string" ? document.slug : null;
        },
      }
    );

    expect(plan.steps.map((entry) => entry.slotId)).toEqual([
      "class-feat-level-2",
      "skill-feat-level-1",
      "skill-training-wizard-level-1",
      "flag-choice-none-feat-source-muse-level-2",
      "class-branch-arcane-school-level-1",
      "deity-level-1",
      "class-choice-wizard-thesis-level-1",
      "spell-choice-wizard-level-1",
    ]);
    expect(resolveDocument).toHaveBeenCalledWith("class");
    expect(resolveDocument).toHaveBeenCalledWith("deity");
    expect(resolveArcaneSchoolDocument).toHaveBeenCalledTimes(1);
    expect(buildSpellChoiceSteps).toHaveBeenCalledTimes(1);
    expect(buildClassFeatSteps).toHaveBeenCalledWith({
      effectiveClassDocument: classDocument,
      targetLevel: 4,
      fulfilledCount: 2,
      fulfilledStepIds: ["class-feat-level-2", "skill-feat-level-1"],
      reservedStepIds: [],
    });
    expect(buildClassSkillFeatSteps).toHaveBeenCalledWith({
      effectiveClassDocument: classDocument,
      targetLevel: 4,
      fulfilledCount: 1,
      fulfilledStepIds: ["class-feat-level-2", "skill-feat-level-1"],
    });
  });

  it("finds a step by slot id from the built plan", async () => {
    const stepToFind = step("class-choice-cleric-doctrine-level-1");

    const found = await findPlanStepBySlotId(
      {
        actor: {},
        snapshot: {
          actorId: "actor-2",
          level: 1,
          isBlank: false,
          singletonSlots: {
            ancestry: false,
            heritage: false,
            background: false,
            class: false,
            deity: false,
          },
          featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
          fulfilledStepIds: [],
          sourceIds: [],
          namesByType: {},
          skillRanks: {},
        },
        draft: createEmptyDraft(1),
        resolveDocument: async () => null,
        resolveArcaneSchoolDocument: async () => null,
        localize: (value) => value,
      },
      stepToFind.slotId,
      {
        buildWayfinderPlan: async () => ({
          recommendedTargetLevel: 1,
          targetLevel: 1,
          steps: [step("ancestry-level-1"), stepToFind],
        }),
        buildClassFeatSteps: async () => [],
        buildClassSkillFeatSteps: async () => [],
        buildClassTrainingSteps: async () => [],
        buildGrantChoiceSteps: async () => [],
        buildFlagChoiceSteps: async () => [],
        buildSingletonChoiceSteps: async () => [],
        buildLanguageChoiceSteps: async () => [],
        buildClassArchetypeSteps: async () => [],
        buildClassBranchSteps: async () => [],
        buildClassGrantedItemSteps: async () => [],
        buildClassChoiceSteps: async () => [],
        buildSpellChoiceSteps: async () => [],
        findDraftSelectionByType: () => null,
        readExistingSingletonSourceSelection: () => null,
        readExistingBranchSelection: () => null,
        readExistingGrantedSelection: () => null,
        readExistingFlagChoiceSelection: () => null,
        readExistingLanguageSelections: () => [],
        readExistingClassChoiceSelection: () => null,
        readExistingSingletonChoiceSelection: () => null,
        readExistingSpellChoiceSelections: () => [],
        fetchSelectionDocument: async () => null,
        extractDocumentSlug: () => null,
      }
    );

    expect(found).toEqual(stepToFind);
  });

  it("replays actor-owned class-feature choices into class and spell planning", async () => {
    const actor = {
      items: {
        contents: [
          {
            type: "feat",
            name: "Demonic Bloodline",
            sourceId: "Compendium.pf2e.classfeatures.Item.demonic-bloodline",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.demonic-bloodline",
              },
              [MODULE_ID]: {
                slotId: "class-branch-bloodline-level-1",
              },
            },
            system: {
              category: "classfeature",
              level: { value: 1 },
            },
          },
        ],
      },
    } as unknown as BuildStateActor;
    const draft = createEmptyDraft(1);
    draft.selections.class = selection("class-level-1", "class", "sorcerer", "Sorcerer", null);
    const snapshot: ActorSnapshot = {
      actorId: "actor-branch-caster",
      level: 1,
      isBlank: false,
      singletonSlots: {
        ancestry: false,
        heritage: false,
        background: false,
        class: true,
        deity: false,
      },
      featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
      fulfilledStepIds: [],
      sourceIds: [],
      namesByType: {},
      skillRanks: {},
    };
    const bloodlineDocument = {
      name: "Demonic Bloodline",
      system: {
        level: { value: 1 },
        traits: { otherTags: ["sorcerer-bloodline"] },
      },
    };
    const buildClassChoiceSteps = vi.fn(async () => []);
    const buildSpellChoiceSteps = vi.fn(async () => []);

    await buildWayfinderAppPlan(
      {
        actor,
        snapshot,
        draft,
        resolveDocument: async (itemType) => (itemType === "class" ? { name: "Sorcerer", slug: "sorcerer" } : null),
        resolveArcaneSchoolDocument: async () => null,
        localize: (value) => value,
      },
      {
        buildWayfinderPlan: async (receivedSnapshot, receivedDraft, deps) => {
          await deps.buildClassChoiceSteps(receivedSnapshot, receivedDraft, 5);
          await deps.buildSpellChoiceSteps(receivedSnapshot, receivedDraft, 5);
          return { recommendedTargetLevel: 5, targetLevel: 5, steps: [] };
        },
        buildClassFeatSteps: async () => [],
        buildClassSkillFeatSteps: async () => [],
        buildClassTrainingSteps: async () => [],
        buildGrantChoiceSteps: async () => [],
        buildFlagChoiceSteps: async () => [],
        buildSingletonChoiceSteps: async () => [],
        buildLanguageChoiceSteps: async () => [],
        buildClassArchetypeSteps: async () => [],
        buildClassBranchSteps: async () => [],
        buildClassGrantedItemSteps: async () => [],
        buildClassChoiceSteps,
        buildSpellChoiceSteps,
        findDraftSelectionByType: (_draft, itemType) => (itemType === "class" ? draft.selections.class : null),
        readExistingSingletonSourceSelection: () => null,
        readExistingBranchSelection: () => null,
        readExistingGrantedSelection: () => null,
        readExistingFlagChoiceSelection: () => null,
        readExistingLanguageSelections: () => [],
        readExistingClassChoiceSelection: () => null,
        readExistingSingletonChoiceSelection: () => null,
        readExistingSpellChoiceSelections: () => [],
        fetchSelectionDocument: async (selectionRef) =>
          selectionRef.uuid === "Compendium.pf2e.classfeatures.Item.demonic-bloodline"
            ? bloodlineDocument
            : { fetched: selectionRef.documentId },
        extractDocumentSlug: (document) =>
          document && typeof document === "object" && "slug" in document && typeof document.slug === "string"
            ? document.slug
            : null,
      }
    );

    expect(buildClassChoiceSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalClassFeatures: [
          expect.objectContaining({
            level: 1,
            selection: expect.objectContaining({
              slotId: "class-branch-bloodline-level-1",
              uuid: "Compendium.pf2e.classfeatures.Item.demonic-bloodline",
              featType: "classfeature",
            }),
            document: bloodlineDocument,
            existingRulesSelections: {},
          }),
        ],
      })
    );
    expect(buildSpellChoiceSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveClassFeatureDocuments: [bloodlineDocument],
      })
    );
  });

  it("honors predicates on static class-feature grants from existing actor features", async () => {
    const run = async (thresholdSelection: "fork" | "expand") => {
      const actor = {
        items: {
          contents: [
            {
              type: "feat",
              name: "Gate's Threshold",
              sourceId: "Compendium.pf2e.classfeatures.Item.gates-threshold",
              flags: {
                core: {
                  sourceId: "Compendium.pf2e.classfeatures.Item.gates-threshold",
                },
                pf2e: {
                  rulesSelections: {
                    gatesThreshold: thresholdSelection,
                  },
                },
                [MODULE_ID]: {
                  slotId: "class-choice-gates-threshold-gatesThreshold-level-5",
                },
              },
              system: {
                category: "classfeature",
                level: { value: 5 },
              },
            },
          ],
        },
      } as unknown as BuildStateActor;
      const draft = createEmptyDraft(5);
      draft.selections.class = selection("class-level-1", "class", "kineticist", "Kineticist", null);
      const snapshot: ActorSnapshot = {
        actorId: `actor-kineticist-${thresholdSelection}`,
        level: 5,
        isBlank: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
        fulfilledStepIds: [],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      };
      const thresholdDocument = {
        name: "Gate's Threshold",
        slug: "gates-threshold",
        system: {
          level: { value: 5 },
          rules: [
            {
              key: "ChoiceSet",
              rollOption: "kinetic-gate:first-threshold",
              choices: [
                { value: "expand", label: "Expand the Portal" },
                { value: "fork", label: "Fork the Path" },
              ],
            },
            {
              key: "GrantItem",
              predicate: ["kinetic-gate:first-threshold:expand"],
              uuid: "Compendium.pf2e.classfeatures.Item.gate-junction",
            },
          ],
        },
      };
      const gateJunctionDocument = {
        name: "Gate Junction",
        slug: "gate-junction",
        system: {
          level: { value: 5 },
          rules: [{ key: "ChoiceSet", flag: "junction", choices: [{ value: "aura", label: "Aura" }] }],
        },
      };
      let additionalClassFeatureUuids: string[] = [];
      const buildClassChoiceSteps = vi.fn(
        async (params: { additionalClassFeatures?: Array<{ selection: SelectionRef }> }) => {
          additionalClassFeatureUuids = (params.additionalClassFeatures ?? []).map((source) => source.selection.uuid);
          return [] as PendingStep[];
        }
      );

      await buildWayfinderAppPlan(
        {
          actor,
          snapshot,
          draft,
          resolveDocument: async (itemType) =>
            itemType === "class" ? { name: "Kineticist", slug: "kineticist" } : null,
          resolveArcaneSchoolDocument: async () => null,
          localize: (value) => value,
        },
        {
          buildWayfinderPlan: async (receivedSnapshot, receivedDraft, deps) => {
            await deps.buildClassChoiceSteps(receivedSnapshot, receivedDraft, 5);
            return { recommendedTargetLevel: 5, targetLevel: 5, steps: [] };
          },
          buildClassFeatSteps: async () => [],
          buildClassSkillFeatSteps: async () => [],
          buildClassTrainingSteps: async () => [],
          buildGrantChoiceSteps: async () => [],
          buildFlagChoiceSteps: async () => [],
          buildSingletonChoiceSteps: async () => [],
          buildLanguageChoiceSteps: async () => [],
          buildClassArchetypeSteps: async () => [],
          buildClassBranchSteps: async () => [],
          buildClassGrantedItemSteps: async () => [],
          buildClassChoiceSteps,
          buildSpellChoiceSteps: async () => [],
          findDraftSelectionByType: (_draft, itemType) => (itemType === "class" ? draft.selections.class : null),
          readExistingSingletonSourceSelection: () => null,
          readExistingBranchSelection: () => null,
          readExistingGrantedSelection: () => null,
          readExistingFlagChoiceSelection: () => null,
          readExistingLanguageSelections: () => [],
          readExistingClassChoiceSelection: () => null,
          readExistingSingletonChoiceSelection: () => null,
          readExistingSpellChoiceSelections: () => [],
          fetchSelectionDocument: async (selectionRef) => {
            if (selectionRef.uuid === "Compendium.pf2e.classfeatures.Item.gates-threshold") {
              return thresholdDocument;
            }
            if (selectionRef.uuid === "Compendium.pf2e.classfeatures.Item.gate-junction") {
              return gateJunctionDocument;
            }
            return { fetched: selectionRef.documentId };
          },
          extractDocumentSlug: (document) =>
            document && typeof document === "object" && "slug" in document && typeof document.slug === "string"
              ? document.slug
              : null,
        }
      );

      return additionalClassFeatureUuids;
    };

    await expect(run("fork")).resolves.toEqual(["Compendium.pf2e.classfeatures.Item.gates-threshold"]);
    await expect(run("expand")).resolves.toEqual([
      "Compendium.pf2e.classfeatures.Item.gates-threshold",
      "Compendium.pf2e.classfeatures.Item.gate-junction",
    ]);
  });

  it("includes class-gated static class-feature grants for selected branches", async () => {
    const run = async (classSlug: "fighter" | "thaumaturge") => {
      const actor = { items: { contents: [] } } as unknown as BuildStateActor;
      const draft = createEmptyDraft(5);
      draft.selections.class = selection("class-level-1", "class", classSlug, classSlug, null);
      draft.branchSelections["class-branch-second-implement-level-5"] = {
        slotId: "class-branch-second-implement-level-5",
        packId: "pf2e.classfeatures",
        documentId: "wand",
        uuid: "Compendium.pf2e.classfeatures.Item.Wand",
        itemType: "feat",
        featType: "classfeature",
        name: "Wand",
        level: 5,
      };
      const snapshot: ActorSnapshot = {
        actorId: `actor-${classSlug}-wand`,
        level: 5,
        isBlank: false,
        singletonSlots: {
          ancestry: true,
          heritage: true,
          background: true,
          class: true,
          deity: false,
        },
        featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
        fulfilledStepIds: [],
        sourceIds: [],
        namesByType: {},
        skillRanks: {},
      };
      const wandDocument = {
        name: "Wand",
        slug: "wand",
        system: {
          level: { value: 5 },
          rules: [
            {
              key: "GrantItem",
              predicate: ["class:thaumaturge"],
              uuid: "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
            },
          ],
        },
      };
      const initiateBenefitDocument = {
        name: "Initiate Benefit (Wand)",
        slug: "initiate-benefit-wand",
        system: {
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              rollOption: "wand-initiate-damage-type",
              choices: [{ value: "cold", label: "Cold" }],
            },
          ],
        },
      };
      let additionalClassFeatureUuids: string[] = [];
      const buildClassChoiceSteps = vi.fn(
        async (params: { additionalClassFeatures?: Array<{ selection: SelectionRef }> }) => {
          additionalClassFeatureUuids = (params.additionalClassFeatures ?? []).map((source) => source.selection.uuid);
          return [] as PendingStep[];
        }
      );

      await buildWayfinderAppPlan(
        {
          actor,
          snapshot,
          draft,
          resolveDocument: async (itemType) => (itemType === "class" ? { name: classSlug, slug: classSlug } : null),
          resolveArcaneSchoolDocument: async () => null,
          localize: (value) => value,
        },
        {
          buildWayfinderPlan: async (receivedSnapshot, receivedDraft, deps) => {
            await deps.buildClassChoiceSteps(receivedSnapshot, receivedDraft, 5);
            return { recommendedTargetLevel: 5, targetLevel: 5, steps: [] };
          },
          buildClassFeatSteps: async () => [],
          buildClassSkillFeatSteps: async () => [],
          buildClassTrainingSteps: async () => [],
          buildGrantChoiceSteps: async () => [],
          buildFlagChoiceSteps: async () => [],
          buildSingletonChoiceSteps: async () => [],
          buildLanguageChoiceSteps: async () => [],
          buildClassArchetypeSteps: async () => [],
          buildClassBranchSteps: async () => [],
          buildClassGrantedItemSteps: async () => [],
          buildClassChoiceSteps,
          buildSpellChoiceSteps: async () => [],
          findDraftSelectionByType: (_draft, itemType) => (itemType === "class" ? draft.selections.class : null),
          readExistingSingletonSourceSelection: () => null,
          readExistingBranchSelection: () => null,
          readExistingGrantedSelection: () => null,
          readExistingFlagChoiceSelection: () => null,
          readExistingLanguageSelections: () => [],
          readExistingClassChoiceSelection: () => null,
          readExistingSingletonChoiceSelection: () => null,
          readExistingSpellChoiceSelections: () => [],
          fetchSelectionDocument: async (selectionRef) => {
            if (selectionRef.uuid === "Compendium.pf2e.classfeatures.Item.Wand") {
              return wandDocument;
            }
            if (selectionRef.uuid === "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)") {
              return initiateBenefitDocument;
            }
            return { fetched: selectionRef.documentId };
          },
          extractDocumentSlug: (document) =>
            document && typeof document === "object" && "slug" in document && typeof document.slug === "string"
              ? document.slug
              : null,
        }
      );

      return additionalClassFeatureUuids;
    };

    await expect(run("fighter")).resolves.toEqual(["Compendium.pf2e.classfeatures.Item.Wand"]);
    await expect(run("thaumaturge")).resolves.toEqual([
      "Compendium.pf2e.classfeatures.Item.Wand",
      "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)",
    ]);
  });

  it("projects a newly selected archetype class feature into training for an existing class actor", async () => {
    const actor = { items: { contents: [] } } as unknown as BuildStateActor;
    const draft = createEmptyDraft(5);
    draft.classArchetypeChoices["class-archetype-methodology-level-1"] = "palatine-detective";
    const classSelection = selection("class-level-1", "class", "investigator", "Investigator", null);
    const snapshot: ActorSnapshot = {
      actorId: "existing-investigator",
      level: 1,
      isBlank: false,
      singletonSlots: {
        ancestry: true,
        heritage: true,
        background: true,
        class: true,
        deity: false,
      },
      featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
      fulfilledStepIds: [],
      sourceIds: [],
      namesByType: {},
      skillRanks: {},
    };
    let trainingSources: Array<{ sourceItemType: string; sourceSelection: SelectionRef | null }> = [];

    await buildWayfinderAppPlan(
      {
        actor,
        snapshot,
        draft,
        resolveDocument: async (itemType) =>
          itemType === "class" ? { name: "Investigator", system: { slug: "investigator" } } : null,
        resolveArcaneSchoolDocument: async () => null,
        localize: (value) => value,
      },
      {
        buildWayfinderPlan: async (receivedSnapshot, receivedDraft, deps) => {
          await deps.buildClassTrainingSteps(receivedSnapshot, receivedDraft, 5);
          return { recommendedTargetLevel: 5, targetLevel: 5, steps: [] };
        },
        buildClassFeatSteps: async () => [],
        buildClassSkillFeatSteps: async () => [],
        buildClassTrainingSteps: async (params) => {
          trainingSources = params.sourceSelections ?? [];
          return [];
        },
        buildGrantChoiceSteps: async () => [],
        buildFlagChoiceSteps: async () => [],
        buildSingletonChoiceSteps: async () => [],
        buildLanguageChoiceSteps: async () => [],
        buildClassArchetypeSteps: async () => [],
        buildClassBranchSteps: async () => [],
        buildClassGrantedItemSteps: async () => [],
        buildClassChoiceSteps: async () => [],
        buildSpellChoiceSteps: async () => [],
        findDraftSelectionByType: () => null,
        readExistingSingletonSourceSelection: (_actor, itemType) => (itemType === "class" ? classSelection : null),
        readExistingBranchSelection: () => null,
        readExistingGrantedSelection: () => null,
        readExistingFlagChoiceSelection: () => null,
        readExistingLanguageSelections: () => [],
        readExistingClassChoiceSelection: () => null,
        readExistingSingletonChoiceSelection: () => null,
        readExistingSpellChoiceSelections: () => [],
        fetchSelectionDocument: async (sourceSelection) => ({
          name: sourceSelection.name,
          system: { slug: sourceSelection.slug ?? sourceSelection.documentId, rules: [] },
        }),
        extractDocumentSlug: (document) => {
          const typed = document as { system?: { slug?: unknown } } | null;
          return typeof typed?.system?.slug === "string" ? typed.system.slug : null;
        },
      }
    );

    expect(trainingSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemType: "classfeature",
          sourceSelection: expect.objectContaining({
            uuid: "Compendium.pf2e.classfeatures.Item.ppGGpc3Iv2NpAhys",
          }),
        }),
        expect.objectContaining({
          sourceItemType: "feat",
          sourceSelection: expect.objectContaining({ uuid: "Compendium.pf2e.feats-srd.Item.LlTIbv1py77nACkI" }),
        }),
      ])
    );
  });
});

function selection(
  slotId: string,
  itemType: string,
  documentId: string,
  name = documentId,
  featType: string | null = itemType === "feat" ? "classfeature" : null
): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType,
    name,
    level: 1,
  };
}

function step(slotId: string): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "manual",
    slotKind: "class",
    title: slotId,
    description: "",
    required: true,
    slotId,
  };
}
