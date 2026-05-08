import { describe, expect, it, vi } from "vitest";
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
    const actor = {};
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
        skill: 0,
        general: 0,
      },
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
    const readExistingLanguageSelections = vi.fn((_actor: unknown) => []);
    const readExistingClassChoiceSelection = vi.fn((_actor: unknown, _choice: ClassChoiceMeta) => "holy");
    const readExistingSingletonChoiceSelection = vi.fn((_actor: unknown, _choice: SingletonChoiceMeta) => "society");
    const readExistingSpellChoiceSelections = vi.fn((_actor: unknown, _choice: SpellChoiceMeta) => [
      selection("spell-choice-wizard-level-1", "spell", "magic-missile", "Magic Missile"),
    ]);

    const buildClassFeatSteps = vi.fn(async () => [step("class-feat-level-2")]);
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
      expect(params.sources).toMatchObject([
        {
          sourceItemType: "class",
          sourceSelection: draft.selections.class,
          sourceDocument: classDocument,
        },
        {
          sourceItemType: "feat",
          sourceSelection: draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"],
          sourceDocument: { fetched: "fighter-dedication" },
        },
      ]);
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
            sourceItemType: "classfeature",
            sourceSelection: draft.branchSelections["class-branch-arcane-school-level-1"],
            sourceDocument: { fetched: "school-of-unified-magical-theory" },
          }),
        ])
      );
      return [];
    });
    const buildLanguageChoiceSteps = vi.fn(async () => []);
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
      expect(params.effectiveClassFeatureDocuments).toEqual([{ fetched: "cascade-bearers" }]);
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
        ...(await deps.buildClassTrainingSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildGrantChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildSingletonChoiceSteps(receivedSnapshot, receivedDraft, 4)),
        ...(await deps.buildLanguageChoiceSteps(receivedSnapshot, receivedDraft, 4)),
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
        buildClassTrainingSteps,
        buildGrantChoiceSteps,
        buildSingletonChoiceSteps,
        buildLanguageChoiceSteps,
        buildClassBranchSteps,
        buildClassGrantedItemSteps,
        buildClassChoiceSteps,
        buildSpellChoiceSteps,
        findDraftSelectionByType: (_draft, itemType) => (itemType === "class" ? draft.selections.class : null),
        readExistingSingletonSourceSelection: () => null,
        readExistingBranchSelection,
        readExistingGrantedSelection,
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
      "skill-training-wizard-level-1",
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
      fulfilledCount: 5,
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
        buildClassTrainingSteps: async () => [],
        buildGrantChoiceSteps: async () => [],
        buildSingletonChoiceSteps: async () => [],
        buildLanguageChoiceSteps: async () => [],
        buildClassBranchSteps: async () => [],
        buildClassGrantedItemSteps: async () => [],
        buildClassChoiceSteps: async () => [],
        buildSpellChoiceSteps: async () => [],
        findDraftSelectionByType: () => null,
        readExistingSingletonSourceSelection: () => null,
        readExistingBranchSelection: () => null,
        readExistingGrantedSelection: () => null,
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
