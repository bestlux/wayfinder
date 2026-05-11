import { describe, expect, it, vi } from "vitest";
import {
  applyClassBranchDraft,
  createBranchSelectorSelection,
  stripPreselectedClassBranchEntries,
} from "../src/class-branch-service";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import { createClassBranchStep, createClassChoiceStep } from "../src/wayfinder/domain/step-types";

describe("class-branch-service", () => {
  it("strips preselected selector entries from a class source by UUID, document id, and name", () => {
    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-wizard-school-level-1"] = selection(
      "class-branch-wizard-school-level-1",
      "pf2e.classfeatures",
      "7nbKDBGvwSx9T27G",
      "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
      "Arcane School"
    );

    const steps: PendingStep[] = [
      createClassBranchStep(
        1,
        {
          slotId: "class-branch-wizard-school-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "7nbKDBGvwSx9T27G",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
        {
          title: "Arcane School",
          description: "",
        }
      ),
    ];

    const classSource = {
      system: {
        items: {
          schoolByUuid: {
            uuid: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
            name: "Something Else",
          },
          schoolByName: {
            uuid: "Compendium.pf2e.classfeatures.Item.other",
            name: "Arcane School",
          },
          schoolByDocumentId: {
            uuid: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
            name: "Arcane School Selector",
          },
          keep: {
            uuid: "Compendium.pf2e.classfeatures.Item.au0lwQ1nAcNQwcGh",
            name: "Arcane Bond",
          },
        },
      },
    };

    stripPreselectedClassBranchEntries(classSource, draft, steps);

    expect(classSource.system.items).toEqual({
      keep: {
        uuid: "Compendium.pf2e.classfeatures.Item.au0lwQ1nAcNQwcGh",
        name: "Arcane Bond",
      },
    });
  });

  it("strips a selected branch selector referenced by name-based UUID without an entry name", () => {
    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-wizard-school-level-1"] = selection(
      "class-branch-wizard-school-level-1",
      "pf2e.classfeatures",
      "xYYhJtGhFSWNifcO",
      "Compendium.pf2e.classfeatures.Item.xYYhJtGhFSWNifcO",
      "School of Unified Magical Theory"
    );

    const steps: PendingStep[] = [
      createClassBranchStep(
        1,
        {
          slotId: "class-branch-wizard-school-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "7nbKDBGvwSx9T27G",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
        {
          title: "Arcane School",
          description: "",
        }
      ),
    ];

    const classSource = {
      system: {
        items: {
          school: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.Arcane School",
          },
          bond: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.Arcane Bond",
          },
        },
      },
    };

    stripPreselectedClassBranchEntries(classSource, draft, steps);

    expect(classSource.system.items).toEqual({
      bond: {
        level: 1,
        uuid: "Compendium.pf2e.classfeatures.Item.Arcane Bond",
      },
    });
  });

  it("creates canonical selector selections from branch metadata", () => {
    expect(
      createBranchSelectorSelection(
        {
          slotId: "class-branch-arcane-thesis-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "M89l9FOnjHe63wD7",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.M89l9FOnjHe63wD7",
          selectorName: "Arcane Thesis",
          selectorRuleIndex: 0,
          flag: "arcaneThesis",
          optionTag: "wizard-arcane-thesis",
          classSlug: "wizard",
          dependsOn: "class",
        },
        "class-branch-arcane-thesis-level-1"
      )
    ).toEqual({
      slotId: "class-branch-arcane-thesis-level-1",
      packId: "pf2e.classfeatures",
      documentId: "M89l9FOnjHe63wD7",
      uuid: "Compendium.pf2e.classfeatures.Item.M89l9FOnjHe63wD7",
      itemType: "feat",
      featType: "classfeature",
      name: "Arcane Thesis",
      level: null,
    });
  });

  it("creates selectors without grant rules, then restores full selector rules after linking one child", async () => {
    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "pf2e.classfeatures",
      "ZpFCZnVzIfZLfNii",
      "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
      "School of the Boundary"
    );

    const steps: PendingStep[] = [
      createClassBranchStep(
        1,
        {
          slotId: "class-branch-arcane-school-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "7nbKDBGvwSx9T27G",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
        {
          title: "Arcane School",
          description: "",
        }
      ),
    ];

    const createEmbeddedSource = vi.fn(async (selection: SelectionRef) => {
      if (selection.uuid === "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G") {
        return {
          name: "Arcane School",
          type: "feat",
          system: {
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
          flags: {
            core: {
              sourceId: selection.uuid,
            },
          },
        };
      }

      return {
        name: selection.name,
        type: "feat",
        system: {
          category: "classfeature",
          level: { value: 1 },
        },
        flags: {
          core: {
            sourceId: selection.uuid,
          },
        },
      };
    });

    const fetchSelectionDocument = vi.fn(async (selection: SelectionRef) => {
      if (selection.uuid !== "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G") {
        return null;
      }

      return {
        system: {
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
      };
    });

    const createEmbeddedDocuments = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "selector-1",
          type: "feat",
          sourceId: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
          flags: {
            pf2e: {
              rulesSelections: {},
              itemGrants: {},
            },
          },
          system: {
            rules: [],
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "school-1",
          type: "feat",
          sourceId: "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
          flags: {
            core: {
              sourceId: "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
            },
            pf2e: {
              grantedBy: {
                id: "selector-1",
                onDelete: "cascade",
              },
            },
          },
          system: {
            category: "classfeature",
            level: { value: 1 },
          },
        },
      ]);
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
          },
        ],
      },
      createEmbeddedDocuments,
      updateEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassBranchDraft(actor as any, draft, steps, {
      createEmbeddedSource,
      fetchSelectionDocument,
    });

    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Arcane School",
        system: {
          location: "class-1",
          rules: [],
        },
      }),
    ]);
    expect(createEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      expect.objectContaining({
        name: "School of the Boundary",
        flags: expect.objectContaining({
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
          },
          pf2e: {
            grantedBy: {
              id: "selector-1",
              onDelete: "cascade",
            },
          },
        }),
      }),
    ]);
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "selector-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "arcaneSchool",
            selection: "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.arcaneSchool}",
          },
        ],
        "flags.pf2e.rulesSelections.arcaneSchool": "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
        "flags.pf2e.itemGrants.arcaneSchool": {
          id: "school-1",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e-wayfinder.slotId": "class-branch-arcane-school-level-1",
      },
      {
        _id: "school-1",
        "flags.core.sourceId": "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
        "flags.pf2e.grantedBy": {
          id: "selector-1",
          onDelete: "cascade",
        },
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "class-branch-arcane-school-level-1",
      },
    ]);
  });

  it("passes draft context when creating selected branch features with nested choices", async () => {
    const draft = createEmptyDraft(1);
    const branchSlotId = "class-branch-arcane-school-level-1";
    const grantSlotId = "grant-choice-none-classfeature-school-of-unified-magical-theory-feat-level-1";
    const unifiedTheorySelection = selection(
      branchSlotId,
      "pf2e.classfeatures",
      "xYYhJtGhFSWNifcO",
      "Compendium.pf2e.classfeatures.Item.xYYhJtGhFSWNifcO",
      "School of Unified Magical Theory"
    );
    draft.branchSelections[branchSlotId] = unifiedTheorySelection;
    draft.selections[grantSlotId] = selection(
      grantSlotId,
      "pf2e.feats-srd",
      "EpBG4CFMNSZQx7vI",
      "Compendium.pf2e.feats-srd.Item.EpBG4CFMNSZQx7vI",
      "Counterspell (Prepared)"
    );

    const steps: PendingStep[] = [
      createClassBranchStep(
        1,
        {
          slotId: branchSlotId,
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "7nbKDBGvwSx9T27G",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
        {
          title: "Arcane School",
          description: "",
        }
      ),
      {
        id: grantSlotId,
        level: 1,
        kind: "pick-item",
        slotKind: "grant-choice",
        title: "School of Unified Magical Theory feat grant",
        description: "",
        required: true,
        slotId: grantSlotId,
        filters: {
          itemType: "feat",
        },
        grantSelection: {
          slotId: grantSlotId,
          sourceItemType: "classfeature",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "xYYhJtGhFSWNifcO",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.xYYhJtGhFSWNifcO",
          selectorName: "School of Unified Magical Theory",
          selectorRuleIndex: 0,
          grantRuleIndex: 1,
          flag: "feat",
          itemType: "feat",
          classSlug: "wizard",
          dependsOn: "class",
          filters: {
            itemType: "feat",
          },
        },
      },
    ];

    const createEmbeddedSource = vi.fn(async (selection: SelectionRef) => ({
      name: selection.name,
      type: "feat",
      system: {
        category: "classfeature",
        rules: selection.uuid === "Compendium.pf2e.classfeatures.Item.7nbKDBGvwSx9T27G" ? [] : [],
      },
      flags: {
        core: {
          sourceId: selection.uuid,
        },
      },
    }));
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
          },
        ],
      },
      createEmbeddedDocuments: vi
        .fn()
        .mockResolvedValueOnce([{ id: "selector-1", type: "feat", flags: {}, system: {} }])
        .mockResolvedValueOnce([{ id: "unified-theory-1", type: "feat", flags: {}, system: {} }]),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassBranchDraft(actor as any, draft, steps, {
      createEmbeddedSource,
      fetchSelectionDocument: vi.fn(async () => null),
    });

    expect(createEmbeddedSource).toHaveBeenCalledWith(unifiedTheorySelection, draft, steps);
  });

  it("preseeds inline class choices that share a branch selector before PF2E can prompt natively", async () => {
    const draft = createEmptyDraft(1);
    const gateSlotId = "class-choice-kinetic-gate-kinetic-gate:initial-level-1";
    const elementOneSlotId = "class-branch-kinetic-gate-elementOne-level-1";
    const elementTwoSlotId = "class-branch-kinetic-gate-elementTwo-level-1";

    draft.classChoices[gateSlotId] = "dual-gate";
    draft.branchSelections[elementOneSlotId] = selection(
      elementOneSlotId,
      "pf2e.classfeatures",
      "fire-gate",
      "Compendium.pf2e.classfeatures.Item.fire-gate",
      "Fire Gate"
    );
    draft.branchSelections[elementTwoSlotId] = selection(
      elementTwoSlotId,
      "pf2e.classfeatures",
      "air-gate",
      "Compendium.pf2e.classfeatures.Item.air-gate",
      "Air Gate"
    );

    const selectorRules = [
      {
        key: "ChoiceSet",
        flag: "kinetic-gate:initial",
      },
      {
        key: "ChoiceSet",
        flag: "elementOne",
      },
      {
        key: "GrantItem",
        uuid: "{item|flags.system.rulesSelections.elementOne}",
      },
      {
        key: "ChoiceSet",
        flag: "elementTwo",
      },
      {
        key: "GrantItem",
        uuid: "{item|flags.system.rulesSelections.elementTwo}",
      },
    ];

    const steps: PendingStep[] = [
      createClassChoiceStep(1, {
        slotId: gateSlotId,
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "kinetic-gate",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.kinetic-gate",
        sourceName: "Kinetic Gate",
        sourceRuleIndex: 0,
        flag: "kinetic-gate:initial",
        classSlug: "kineticist",
        dependsOn: "class",
        options: [{ value: "dual-gate", label: "Dual Gate", img: null, detail: null }],
      }),
      createClassBranchStep(1, {
        slotId: elementOneSlotId,
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "kinetic-gate",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.kinetic-gate",
        selectorName: "Kinetic Gate",
        selectorRuleIndex: 1,
        grantRuleIndex: 2,
        flag: "elementOne",
        optionTag: "kineticist-element",
        classSlug: "kineticist",
        dependsOn: "class",
      }),
      createClassBranchStep(1, {
        slotId: elementTwoSlotId,
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "kinetic-gate",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.kinetic-gate",
        selectorName: "Kinetic Gate",
        selectorRuleIndex: 3,
        grantRuleIndex: 4,
        flag: "elementTwo",
        optionTag: "kineticist-element",
        classSlug: "kineticist",
        dependsOn: "class",
      }),
    ];

    const createEmbeddedSource = vi.fn(async (pickedSelection: SelectionRef) => ({
      name: pickedSelection.name,
      type: "feat",
      system: {
        category: "classfeature",
        rules:
          pickedSelection.uuid === "Compendium.pf2e.classfeatures.Item.kinetic-gate"
            ? structuredClone(selectorRules)
            : [],
      },
      flags: {
        core: {
          sourceId: pickedSelection.uuid,
        },
      },
    }));
    const actorItems: any[] = [
      {
        id: "class-1",
        type: "class",
      },
    ];
    const createdIds = ["selector-1", "fire-gate-1", "air-gate-1"];
    const deleteEmbeddedDocuments = vi.fn(async (_type: string, ids: string[]) => {
      for (const id of ids) {
        const index = actorItems.findIndex((item) => item.id === id);
        if (index >= 0) {
          actorItems.splice(index, 1);
        }
      }
      return [];
    });
    const actor = {
      items: {
        contents: actorItems,
      },
      createEmbeddedDocuments: vi.fn().mockImplementation(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = {
            ...structuredClone(source),
            id: createdIds.shift(),
          };
          actorItems.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments,
    };

    await applyClassBranchDraft(actor as any, draft, steps, {
      createEmbeddedSource,
      fetchSelectionDocument: vi.fn(async () => ({
        system: {
          rules: structuredClone(selectorRules),
        },
      })),
    });

    expect(actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      expect.objectContaining({
        name: "Kinetic Gate",
        system: expect.objectContaining({
          rules: [],
        }),
        flags: expect.objectContaining({
          pf2e: {
            rulesSelections: {
              "kinetic-gate:initial": "dual-gate",
              elementOne: "Compendium.pf2e.classfeatures.Item.fire-gate",
              elementTwo: "Compendium.pf2e.classfeatures.Item.air-gate",
            },
          },
        }),
      }),
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenLastCalledWith("Item", [
      expect.objectContaining({
        _id: "selector-1",
        "flags.pf2e.rulesSelections.kinetic-gate:initial": "dual-gate",
        "flags.pf2e.rulesSelections.elementOne": "Compendium.pf2e.classfeatures.Item.fire-gate",
        "flags.pf2e.rulesSelections.elementTwo": "Compendium.pf2e.classfeatures.Item.air-gate",
        "flags.pf2e.itemGrants.elementOne": {
          id: "fire-gate-1",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e.itemGrants.elementTwo": {
          id: "air-gate-1",
          onDelete: "detach",
          nested: null,
        },
      }),
    ]);
    expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actorItems.map((item) => item.id)).toEqual(["class-1", "selector-1", "fire-gate-1", "air-gate-1"]);
  });
});

function selection(slotId: string, packId: string, documentId: string, uuid: string, name: string): SelectionRef {
  return {
    slotId,
    packId,
    documentId,
    uuid,
    itemType: "feat",
    featType: "classfeature",
    name,
    level: 1,
  };
}
