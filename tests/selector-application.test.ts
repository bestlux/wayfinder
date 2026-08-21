import { describe, expect, it, vi } from "vitest";
import { applySelectorApplication, createManualStaticGrantedItems } from "../src/selector-application";

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

  it("rolls back a child that a Foundry hook aliases into a later grant route", async () => {
    const items = [
      {
        id: "selector-1",
        name: "Selector",
        type: "feat",
        flags: {
          core: { sourceId: "Compendium.pf2e.classfeatures.Item.selector" },
          pf2e: { itemGrants: {} },
        },
        system: { rules: [{ key: "ChoiceSet" }, { key: "ChoiceSet" }] },
      },
    ] as any[];
    const deleteEmbeddedDocuments = vi.fn(async (_type: string, ids: string[]) => {
      for (const id of ids) {
        const index = items.findIndex((item) => item.id === id);
        if (index >= 0) items.splice(index, 1);
      }
      return [];
    });
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) => {
        const child = {
          ...structuredClone(sources[0]),
          id: "hook-aliased-child",
          flags: {
            ...structuredClone(sources[0]?.flags ?? {}),
            "wayfinder-pf2e": { slotId: "grant-second" },
          },
        };
        items.push(child);
        return [child];
      }),
      deleteEmbeddedDocuments,
      updateEmbeddedDocuments: vi.fn(async () => []),
    };
    const grantPlan = (flag: string, documentId: string, selectorRuleIndex: number) => ({
      flag,
      slotId: `grant-${flag}`,
      selection: {
        slotId: `grant-${flag}`,
        packId: "pf2e.actionspf2e",
        documentId,
        uuid: `Compendium.pf2e.actionspf2e.Item.${documentId}`,
        itemType: "action",
        featType: null,
        name: documentId,
        level: null,
      },
      selectorRuleIndex,
      createRulePolicy: null,
    });

    await expect(
      applySelectorApplication(
        actor as never,
        {
          selectorSelection: {
            slotId: "selector",
            packId: "pf2e.classfeatures",
            documentId: "selector",
            uuid: "Compendium.pf2e.classfeatures.Item.selector",
            itemType: "feat",
            featType: "classfeature",
            name: "Selector",
            level: 1,
          },
          slotId: "selector",
          ruleSelections: [],
          grantPlans: [grantPlan("first", "first-source", 0), grantPlan("second", "second-source", 1)],
        },
        {
          fetchSelectionDocument: vi.fn(async () => null),
          createEmbeddedSource: vi.fn(async (selection) => ({
            name: selection.name,
            type: "action",
            system: { rules: [] },
            flags: {},
          })),
        }
      )
    ).rejects.toThrow(/grant routes first and second claim the same child/i);

    expect(items.map((item) => item.id)).toEqual(["selector-1"]);
    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["hook-aliased-child"]);
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalledWith(
      "Item",
      expect.arrayContaining([expect.objectContaining({ "flags.pf2e.itemGrants.second": expect.anything() })])
    );
  });

  it.each([
    {
      label: "source UUID",
      grants: [
        { key: "first", uuid: "Compendium.pf2e.classfeatures.Item.shared-child", choices: {} },
        { key: "second", uuid: "Compendium.pf2e.classfeatures.Item.shared-child", choices: {} },
      ],
    },
    {
      label: "parent-link key",
      grants: [
        { key: "shared", uuid: "Compendium.pf2e.classfeatures.Item.first-child", choices: {} },
        { key: "shared", uuid: "Compendium.pf2e.classfeatures.Item.second-child", choices: {} },
      ],
    },
  ])("rejects duplicate manual static grant $label values before creating a child", async ({ grants }) => {
    const createEmbeddedDocuments = vi.fn(async () => [{ id: "unexpected-child" }]);
    const createEmbeddedSource = vi.fn(async () => ({ name: "Child", type: "feat", system: {}, flags: {} }));
    const actor = {
      items: [],
      createEmbeddedDocuments,
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      createManualStaticGrantedItems(
        actor as never,
        { id: "parent-1" } as never,
        {
          name: "Parent",
          type: "feat",
          system: {},
          flags: { "wayfinder-pf2e": { manualStaticItemGrants: grants } },
        },
        {
          parentSlotId: "class-archetype-parent-level-2",
          parentName: "Parent",
          createEmbeddedSource,
          replaceDescendantsOwnedById: null,
        }
      )
    ).rejects.toThrow(/duplicate grant/i);

    expect(createEmbeddedSource).not.toHaveBeenCalled();
    expect(createEmbeddedDocuments).not.toHaveBeenCalled();
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
