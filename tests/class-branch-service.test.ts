import { describe, expect, it, vi } from "vitest";
import {
  applyClassBranchDraft,
  createBranchSelectorSelection,
  stripPreselectedClassBranchEntries,
} from "../src/class-branch-service";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";

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
      {
        id: "class-branch-wizard-school-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane School",
        description: "",
        required: true,
        slotId: "class-branch-wizard-school-level-1",
        branch: {
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
      },
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
      {
        id: "class-branch-arcane-school-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane School",
        description: "",
        required: true,
        slotId: "class-branch-arcane-school-level-1",
        branch: {
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
      },
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
            rules: [
              {
                key: "ChoiceSet",
                flag: "arcaneSchool",
                selection: "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
              },
            ],
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
          rules: [
            {
              key: "ChoiceSet",
              flag: "arcaneSchool",
              selection: "Compendium.pf2e.classfeatures.Item.ZpFCZnVzIfZLfNii",
            },
          ],
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
