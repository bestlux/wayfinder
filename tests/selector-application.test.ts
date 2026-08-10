import { describe, expect, it, vi } from "vitest";
import { applySelectorApplication } from "../src/selector-application";

describe("selector application", () => {
  it.each([
    { label: "missing", predicate: undefined },
    { label: "empty", predicate: [] },
  ])("rejects unresolved unconditional child choices with a $label predicate before PF2E creation", async ({
    predicate,
  }) => {
    const createEmbeddedDocuments = vi.fn(async (_type: string, sources: Array<Record<string, unknown>>) => [
      {
        ...structuredClone(sources[0]),
        id: "selector-1",
      },
    ]);
    const actor = {
      items: { contents: [{ id: "class-1", type: "class" }] },
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applySelectorApplication(
        actor as never,
        {
          selectorSelection: {
            slotId: "class-branch-eidolon-level-1",
            packId: "pf2e.classfeatures",
            documentId: "eidolon",
            uuid: "Compendium.pf2e.classfeatures.Item.eidolon",
            itemType: "feat",
            featType: "classfeature",
            name: "Eidolon",
            level: 1,
          },
          slotId: "class-branch-eidolon-level-1",
          ruleSelections: [],
          grantPlan: {
            flag: "eidolon",
            slotId: "class-branch-eidolon-level-1",
            selection: {
              slotId: "class-branch-eidolon-level-1",
              packId: "pf2e.classfeatures",
              documentId: "dragon-eidolon",
              uuid: "Compendium.pf2e.classfeatures.Item.dragon-eidolon",
              itemType: "feat",
              featType: "classfeature",
              name: "Dragon Eidolon",
              level: 1,
            },
            selectorRuleIndex: 0,
            createRulePolicy: "remove-all-grant-items",
          },
        },
        {
          fetchSelectionDocument: vi.fn(async () => null),
          createEmbeddedSource: vi.fn(async (selection) =>
            selection.documentId === "eidolon"
              ? {
                  name: "Eidolon",
                  type: "feat",
                  system: {
                    rules: [
                      { key: "ChoiceSet", flag: "eidolon" },
                      { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.eidolon}" },
                    ],
                  },
                }
              : {
                  name: "Dragon Eidolon",
                  type: "feat",
                  system: {
                    rules: [
                      {
                        key: "ChoiceSet",
                        flag: "eidolonTradition",
                        choices: { config: "magicTraditions" },
                        ...(predicate === undefined ? {} : { predicate }),
                      },
                    ],
                  },
                }
          ),
        }
      )
    ).rejects.toThrow('Cannot create Dragon Eidolon: unresolved unconditional ChoiceSet "eidolonTradition".');

    expect(createEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing grant when replacement creation fails", async () => {
    const deleteEmbeddedDocuments = vi.fn(async () => []);
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.eidolon" },
              pf2e: { itemGrants: { eidolon: { id: "old-grant" } } },
            },
            system: { rules: [{ key: "ChoiceSet", flag: "eidolon" }] },
          },
          {
            id: "old-grant",
            type: "feat",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.old-eidolon" },
              pf2e: { grantedBy: { id: "selector-1" } },
              "wayfinder-pf2e": { slotId: "class-branch-eidolon-level-1" },
            },
          },
        ],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applySelectorApplication(
        actor as never,
        {
          selectorSelection: {
            slotId: "class-branch-eidolon-level-1",
            packId: "pf2e.classfeatures",
            documentId: "eidolon",
            uuid: "Compendium.pf2e.classfeatures.Item.eidolon",
            itemType: "feat",
            featType: "classfeature",
            name: "Eidolon",
            level: 1,
          },
          slotId: "class-branch-eidolon-level-1",
          ruleSelections: [],
          grantPlan: {
            flag: "eidolon",
            slotId: "class-branch-eidolon-level-1",
            selection: {
              slotId: "class-branch-eidolon-level-1",
              packId: "pf2e.classfeatures",
              documentId: "dragon-eidolon",
              uuid: "Compendium.pf2e.classfeatures.Item.dragon-eidolon",
              itemType: "feat",
              featType: "classfeature",
              name: "Dragon Eidolon",
              level: 1,
            },
            selectorRuleIndex: 0,
            createRulePolicy: null,
          },
        },
        {
          fetchSelectionDocument: vi.fn(async () => null),
          createEmbeddedSource: vi.fn(async () => ({ name: "Dragon Eidolon", type: "feat", system: { rules: [] } })),
        }
      )
    ).rejects.toThrow("Foundry returned no created item");

    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(2);
    expect(actor.updateEmbeddedDocuments).toHaveBeenLastCalledWith("Item", [
      expect.objectContaining({
        _id: "selector-1",
        "flags.pf2e.itemGrants.eidolon": { id: "old-grant" },
        "flags.pf2e.rulesSelections.-=eidolon": null,
        "system.rules": [{ key: "ChoiceSet", flag: "eidolon" }],
      }),
    ]);
  });

  it("rolls back a replacement when deleting the existing grant fails", async () => {
    const deleteEmbeddedDocuments = vi.fn(async (_type: string, ids: string[]) => {
      if (ids.includes("old-grant")) {
        throw new Error("old grant delete failed");
      }
      return [];
    });
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.eidolon" },
              pf2e: { itemGrants: { eidolon: { id: "old-grant" } } },
            },
            system: { rules: [{ key: "ChoiceSet", flag: "eidolon" }] },
          },
          {
            id: "old-grant",
            type: "feat",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.old-eidolon" },
              pf2e: { grantedBy: { id: "selector-1" } },
            },
          },
        ],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: Array<Record<string, unknown>>) => [
        { ...structuredClone(sources[0]), id: "new-grant" },
      ]),
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applySelectorApplication(
        actor as never,
        {
          selectorSelection: {
            slotId: "class-branch-eidolon-level-1",
            packId: "pf2e.classfeatures",
            documentId: "eidolon",
            uuid: "Compendium.pf2e.classfeatures.Item.eidolon",
            itemType: "feat",
            featType: "classfeature",
            name: "Eidolon",
            level: 1,
          },
          slotId: "class-branch-eidolon-level-1",
          ruleSelections: [],
          grantPlan: {
            flag: "eidolon",
            slotId: "class-branch-eidolon-level-1",
            selection: {
              slotId: "class-branch-eidolon-level-1",
              packId: "pf2e.classfeatures",
              documentId: "dragon-eidolon",
              uuid: "Compendium.pf2e.classfeatures.Item.dragon-eidolon",
              itemType: "feat",
              featType: "classfeature",
              name: "Dragon Eidolon",
              level: 1,
            },
            selectorRuleIndex: 0,
            createRulePolicy: null,
          },
        },
        {
          fetchSelectionDocument: vi.fn(async () => null),
          createEmbeddedSource: vi.fn(async () => ({ name: "Dragon Eidolon", type: "feat", system: { rules: [] } })),
        }
      )
    ).rejects.toThrow("old grant delete failed");

    expect(deleteEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", ["old-grant"]);
    expect(deleteEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", ["new-grant"]);
  });

  it("rolls back earlier prepared grants when a later selector grant fails", async () => {
    const deleteEmbeddedDocuments = vi.fn(async () => []);
    let createCount = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.selector" },
              pf2e: { itemGrants: { first: { id: "old-first" }, second: { id: "old-second" } } },
            },
            system: { rules: [{ key: "ChoiceSet" }, { key: "ChoiceSet" }] },
          },
          { id: "old-first", flags: { pf2e: { grantedBy: { id: "selector-1" } } } },
          { id: "old-second", flags: { pf2e: { grantedBy: { id: "selector-1" } } } },
        ],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: Array<Record<string, unknown>>) => {
        createCount += 1;
        return createCount === 1 ? [{ ...structuredClone(sources[0]), id: "new-first" }] : [];
      }),
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments: vi.fn(async () => []),
    };
    const grantPlan = (flag: string, documentId: string, selectorRuleIndex: number) => ({
      flag,
      slotId: `class-branch-${flag}-level-1`,
      selection: {
        slotId: `class-branch-${flag}-level-1`,
        packId: "pf2e.classfeatures",
        documentId,
        uuid: `Compendium.pf2e.classfeatures.Item.${documentId}`,
        itemType: "feat",
        featType: "classfeature",
        name: documentId,
        level: 1,
      },
      selectorRuleIndex,
      createRulePolicy: null,
    });

    await expect(
      applySelectorApplication(
        actor as never,
        {
          selectorSelection: {
            slotId: "class-branch-selector-level-1",
            packId: "pf2e.classfeatures",
            documentId: "selector",
            uuid: "Compendium.pf2e.classfeatures.Item.selector",
            itemType: "feat",
            featType: "classfeature",
            name: "Selector",
            level: 1,
          },
          slotId: "class-branch-selector-level-1",
          ruleSelections: [],
          grantPlans: [grantPlan("first", "new-first-source", 0), grantPlan("second", "new-second-source", 1)],
        },
        {
          fetchSelectionDocument: vi.fn(async () => null),
          createEmbeddedSource: vi.fn(async (selection) => ({
            name: selection.name,
            type: "feat",
            system: { rules: [] },
          })),
        }
      )
    ).rejects.toThrow("Foundry returned no created item");

    expect(deleteEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["new-first"]);
    expect(deleteEmbeddedDocuments).not.toHaveBeenCalledWith(
      "Item",
      expect.arrayContaining(["old-first", "old-second"])
    );
  });

  it("recreates old-owned static children and removes the prepared hierarchy on failure", async () => {
    const deleteEmbeddedDocuments = vi.fn(async () => []);
    let createCount = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.selector" },
              pf2e: { itemGrants: { choice: { id: "old-grant" } } },
            },
            system: { rules: [{ key: "ChoiceSet" }] },
          },
          { id: "old-grant", flags: { pf2e: { grantedBy: { id: "selector-1" } } } },
          {
            id: "old-child",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.shared-child" },
              pf2e: { grantedBy: { id: "old-grant" } },
            },
          },
        ],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: Array<Record<string, unknown>>) => {
        createCount += 1;
        if (createCount === 1) return [{ ...structuredClone(sources[0]), id: "new-grant" }];
        if (createCount === 2) return [{ ...structuredClone(sources[0]), id: "new-child" }];
        return [];
      }),
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applySelectorApplication(
        actor as never,
        {
          selectorSelection: {
            slotId: "class-branch-selector-level-1",
            packId: "pf2e.classfeatures",
            documentId: "selector",
            uuid: "Compendium.pf2e.classfeatures.Item.selector",
            itemType: "feat",
            featType: "classfeature",
            name: "Selector",
            level: 1,
          },
          slotId: "class-branch-selector-level-1",
          ruleSelections: [],
          grantPlan: {
            flag: "choice",
            slotId: "class-branch-choice-level-1",
            selection: {
              slotId: "class-branch-choice-level-1",
              packId: "pf2e.classfeatures",
              documentId: "new-source",
              uuid: "Compendium.pf2e.classfeatures.Item.new-source",
              itemType: "feat",
              featType: "classfeature",
              name: "New Source",
              level: 1,
            },
            selectorRuleIndex: 0,
            createRulePolicy: null,
          },
        },
        {
          fetchSelectionDocument: vi.fn(async () => null),
          createEmbeddedSource: vi.fn(async (selection) =>
            selection.documentId === "new-source"
              ? {
                  name: "New Source",
                  type: "feat",
                  flags: {
                    "wayfinder-pf2e": {
                      manualStaticItemGrants: [
                        {
                          key: "shared",
                          uuid: "Compendium.pf2e.classfeatures.Item.shared-child",
                          choices: {},
                        },
                        {
                          key: "missing",
                          uuid: "Compendium.pf2e.classfeatures.Item.missing-child",
                          choices: {},
                        },
                      ],
                    },
                  },
                  system: { rules: [] },
                }
              : { name: selection.name, type: "feat", system: { rules: [] } }
          ),
        }
      )
    ).rejects.toThrow("Foundry returned no item");

    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(3);
    expect(deleteEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", ["new-child"]);
    expect(deleteEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", ["new-grant"]);
    expect(deleteEmbeddedDocuments).not.toHaveBeenCalledWith(
      "Item",
      expect.arrayContaining(["old-grant", "old-child"])
    );
  });
});
