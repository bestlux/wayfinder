import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import {
  applySelectorApplication,
  createManualStaticGrantedItems,
  type SelectorApplicationPlan,
} from "../src/selector-application";
import type { ActorItemLike, EmbeddedItemSource, LooseRecord } from "../src/shared/actor-model";
import type { SelectionRef } from "../src/types";
import {
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
} from "../src/wayfinder/domain/physical-grant-route-registry";
import { nativePhysicalGrantSmokeFixture } from "./fixtures/native-physical-grant-smoke-fixture";

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

describe("proof-approved native selector restoration", () => {
  const cases = THAUMATURGE_IMPLEMENT_ORIGINS.flatMap((origin) =>
    THAUMATURGE_FIXED_IMPLEMENTS.map((implement) => ({ origin, implement }))
  );

  it.each(
    cases
  )("restores the $origin.key $implement.name parent without replacing its native feature or equipment", async ({
    origin,
    implement,
  }) => {
    const fixture = nativeSelectorRecoveryFixture(origin.key, implement.slug);
    const retainedFeature = structuredClone(fixture.feature);
    const retainedEquipment = structuredClone(fixture.equipment);

    await applySelectorApplication(fixture.actor, fixture.plan, fixture.deps);

    const selector = fixture.items.find((item) => item.id === fixture.plan.recoverySelectorItemId)!;
    expect(selector).toMatchObject({
      id: fixture.missingSelectorItemId,
      system: { location: fixture.classItem.id },
      flags: {
        pf2e: {
          rulesSelections: { implement: fixture.feature.sourceId },
          itemGrants: { implement: { id: retainedFeature.id } },
        },
      },
    });
    expect(fixture.actor.createEmbeddedDocuments).toHaveBeenNthCalledWith(
      1,
      "Item",
      [expect.objectContaining({ _id: fixture.missingSelectorItemId })],
      { keepId: true }
    );
    expect(fixture.items.filter((item) => item.sourceId === retainedFeature.sourceId)).toHaveLength(1);
    expect(fixture.feature.id).toBe(retainedFeature.id);
    expect(fixture.feature.flags?.pf2e?.grantedBy).toEqual(retainedFeature.flags?.pf2e?.grantedBy);
    expect(fixture.equipment).toEqual(retainedEquipment);
    expect(fixture.actor.createEmbeddedDocuments.mock.calls.flatMap(([, sources]) => sources)).not.toContainEqual(
      expect.objectContaining({ type: "equipment" })
    );
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();

    if (implement.slug === "wand") {
      const benefit = fixture.items.find((item) => item.flags?.core?.sourceId === WAND_BENEFIT_UUID)!;
      expect(benefit).toMatchObject({
        flags: {
          pf2e: {
            grantedBy: { id: retainedFeature.id },
            rulesSelections: { initiateBenefitWand: "fire" },
          },
        },
        system: { rules: [{ key: "ChoiceSet", flag: "initiateBenefitWand", selection: "fire" }] },
      });
      expect(fixture.feature.flags?.pf2e?.itemGrants?.initiateBenefitWand).toMatchObject({ id: benefit.id });
      expect(fixture.deps.createEmbeddedSource).toHaveBeenCalledWith(fixture.plan.grantPlan!.selection);
    }

    const firstAppliedIds = fixture.items.map((item) => item.id);
    const createCount = fixture.actor.createEmbeddedDocuments.mock.calls.length;
    const { recoverySelectorItemId: _recoveredIdentity, ...retryPlan } = fixture.plan;
    await applySelectorApplication(fixture.actor, retryPlan, fixture.deps);

    expect(fixture.items.map((item) => item.id)).toEqual(firstAppliedIds);
    expect(fixture.actor.createEmbeddedDocuments).toHaveBeenCalledTimes(createCount);
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it.each(["occupied", "invalid"])("rejects an %s recovery identity before creating any document", async (kind) => {
    const fixture = nativeSelectorRecoveryFixture();
    if (kind === "occupied") {
      fixture.items.push({ id: fixture.missingSelectorItemId, name: "Unrelated item", type: "feat" });
    } else {
      fixture.plan.recoverySelectorItemId = "invalid-id";
    }

    await expect(applySelectorApplication(fixture.actor, fixture.plan, fixture.deps)).rejects.toThrow(
      /recovery selector identity is invalid or already occupied/i
    );

    expect(fixture.deps.createEmbeddedSource).not.toHaveBeenCalled();
    expect(fixture.actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(fixture.actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects Foundry returning a different parent identity without deleting the prior native pair", async () => {
    const fixture = nativeSelectorRecoveryFixture();
    fixture.actor.createEmbeddedDocuments.mockImplementationOnce(async (_type, sources) => {
      const item = { ...structuredClone(sources[0]), id: "differentParent1" };
      fixture.items.push(item);
      return [item];
    });

    await expect(applySelectorApplication(fixture.actor, fixture.plan, fixture.deps)).rejects.toThrow(
      /did not restore the exact recovery selector identity/i
    );

    expect(fixture.items).toContain(fixture.feature);
    expect(fixture.items).toContain(fixture.equipment);
    expect(fixture.actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it.each([
    "before persistence",
    "after persistence",
  ])("retains the restored parent and prior native pair when a later update fails %s", async (failureTiming) => {
    const fixture = nativeSelectorRecoveryFixture();
    const persistUpdates = fixture.actor.updateEmbeddedDocuments.getMockImplementation()!;
    fixture.actor.updateEmbeddedDocuments.mockImplementationOnce(async (...args) => {
      if (failureTiming === "after persistence") await persistUpdates(...args);
      throw new Error("selector update failed");
    });

    await expect(applySelectorApplication(fixture.actor, fixture.plan, fixture.deps)).rejects.toThrow(
      "selector update failed"
    );

    expect(fixture.items.find((item) => item.id === fixture.missingSelectorItemId)).toBeDefined();
    expect(fixture.items).toContain(fixture.feature);
    expect(fixture.items).toContain(fixture.equipment);
    const retainedBenefit = fixture.items.find((item) => item.flags?.core?.sourceId === WAND_BENEFIT_UUID)!;
    expect(retainedBenefit).toMatchObject({
      id: "generated-2",
      flags: { pf2e: { grantedBy: { id: fixture.feature.id } } },
    });
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();

    await applySelectorApplication(fixture.actor, fixture.plan, fixture.deps);

    const selector = fixture.items.find((item) => item.id === fixture.missingSelectorItemId)!;
    const benefit = fixture.items.find((item) => item.flags?.core?.sourceId === WAND_BENEFIT_UUID)!;
    expect(selector.system?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "ChoiceSet", flag: "implement", selection: fixture.feature.sourceId }),
        expect.objectContaining({ key: "GrantItem", uuid: "{item|flags.system.rulesSelections.implement}" }),
      ])
    );
    expect(benefit.id).toBe(retainedBenefit.id);
    expect(benefit.flags?.pf2e?.rulesSelections).toEqual({ initiateBenefitWand: "fire" });
    expect(fixture.feature.flags?.pf2e?.itemGrants?.initiateBenefitWand).toMatchObject({ id: retainedBenefit.id });
    expect(fixture.items).toContain(fixture.feature);
    expect(fixture.items).toContain(fixture.equipment);
    expect(fixture.actor.createEmbeddedDocuments).toHaveBeenCalledTimes(2);
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("still rolls back an ordinary newly created selector after a later grant failure", async () => {
    const fixture = nativeSelectorRecoveryFixture();
    fixture.items.splice(fixture.items.indexOf(fixture.feature), 1);
    fixture.items.splice(fixture.items.indexOf(fixture.equipment), 1);
    delete fixture.plan.recoverySelectorItemId;
    fixture.deps.createEmbeddedSource.mockImplementation(async (selection) =>
      selection.uuid === fixture.plan.selectorSelection.uuid ? structuredClone(fixture.selectorSource) : null
    );

    await expect(applySelectorApplication(fixture.actor, fixture.plan, fixture.deps)).rejects.toThrow(
      /source document is unavailable/i
    );

    expect(fixture.actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["generated-1"]);
    expect(fixture.items).toEqual([fixture.classItem]);
  });

  it("does not complete manual grants for an ordinary existing selector without adoption authority", async () => {
    const fixture = nativeSelectorRecoveryFixture();
    fixture.items.push({
      ...structuredClone(fixture.selectorSource),
      id: fixture.missingSelectorItemId,
      system: { ...fixture.selectorSource.system, location: fixture.classItem.id },
    });
    delete fixture.plan.recoverySelectorItemId;

    await applySelectorApplication(fixture.actor, fixture.plan, fixture.deps);

    expect(fixture.deps.createEmbeddedSource).not.toHaveBeenCalled();
    expect(fixture.actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(fixture.items.some((item) => item.flags?.core?.sourceId === WAND_BENEFIT_UUID)).toBe(false);
  });
});

const WAND_BENEFIT_UUID = "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)";
const implementSourceDocuments = JSON.parse(
  readFileSync(resolve("tests/fixtures/pf2e-thaumaturge-implements-8.5.1.json"), "utf8")
).documents as Record<string, EmbeddedItemSource>;

function nativeSelectorRecoveryFixture(
  originKey: "first" | "second" = "first",
  implementSlug: (typeof THAUMATURGE_FIXED_IMPLEMENTS)[number]["slug"] = "wand"
) {
  const origin = THAUMATURGE_IMPLEMENT_ORIGINS.find((entry) => entry.key === originKey)!;
  const native = nativePhysicalGrantSmokeFixture([`thaumaturge-${implementSlug}-implement-${originKey}`]);
  const selectorEvidence = native.items.find((item) => item.sourceId === origin.selectorUuid)!;
  const featureEvidence = native.items.find((item) => item.sourceId === native.classGrants[0].grant.granterSourceUuid)!;
  const equipmentEvidence = native.items.find((item) => item.isPhysical)!;
  const items: ActorItemLike[] = native.items
    .filter((item) => item !== selectorEvidence)
    .map((item) => ({
      ...structuredClone(implementSourceDocuments[item.sourceId]),
      id: item.id,
      sourceId: item.sourceId,
      flags: {
        core: { sourceId: item.sourceId },
        ...(item.grantedById ? { pf2e: { grantedBy: { id: item.grantedById, onDelete: "cascade" } } } : {}),
      },
    }));
  const feature = items.find((item) => item.id === featureEvidence.id)!;
  const equipment = items.find((item) => item.id === equipmentEvidence.id)!;
  const classItem = items.find((item) => item.type === "class")!;
  feature.flags!.pf2e!.itemGrants = { nativeEquipment: { id: equipment.id, onDelete: "detach" } };
  const selectorSource: EmbeddedItemSource = {
    ...structuredClone(implementSourceDocuments[origin.selectorUuid]),
    flags: { core: { sourceId: origin.selectorUuid } },
  };
  const selection: SelectionRef = {
    slotId: origin.slotId,
    packId: "pf2e.classfeatures",
    documentId: featureEvidence.sourceId.split(".").at(-1)!,
    uuid: featureEvidence.sourceId,
    itemType: "feat",
    featType: "classfeature",
    name: feature.name!,
    level: 1,
  };
  const plan: SelectorApplicationPlan = {
    recoverySelectorItemId: selectorEvidence.id,
    selectorSelection: {
      ...selection,
      documentId: origin.selectorUuid.split(".").at(-1)!,
      uuid: origin.selectorUuid,
      name: origin.selectorName,
    },
    slotId: origin.slotId,
    ruleSelections: [],
    grantPlan: {
      flag: "implement",
      slotId: origin.slotId,
      selection,
      selectorRuleIndex: originKey === "first" ? 1 : 0,
      createRulePolicy: "remove-all-grant-items",
    },
    omitSelectedRulesOnCreate: true,
  };
  let nextCreatedId = 0;
  const actor = {
    items: { contents: items },
    createEmbeddedDocuments: vi.fn(
      async (_type: string, sources: EmbeddedItemSource[], options?: { keepId?: boolean }) =>
        sources.map((source) => {
          nextCreatedId += 1;
          const item = {
            ...structuredClone(source),
            id: options?.keepId ? (source._id as string) : `generated-${nextCreatedId}`,
          };
          items.push(item);
          return item;
        })
    ),
    updateEmbeddedDocuments: vi.fn(async (_type: string, updates: LooseRecord[]) => {
      for (const update of updates) {
        const item = items.find((entry) => entry.id === update._id)!;
        for (const [key, value] of Object.entries(update)) {
          if (key === "_id") continue;
          const path = key.split(".");
          let target = item as LooseRecord;
          for (const part of path.slice(0, -1)) {
            target[part] ??= {};
            target = target[part] as LooseRecord;
          }
          const leaf = path.at(-1)!;
          if (leaf.startsWith("-=")) delete target[leaf.slice(2)];
          else target[leaf] = structuredClone(value);
        }
      }
      return [];
    }),
    deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
      const cascadeIds = new Set(ids);
      for (let changed = true; changed; ) {
        changed = false;
        for (const item of items) {
          const parentId = item.flags?.pf2e?.grantedBy?.id;
          if (typeof parentId === "string" && cascadeIds.has(parentId) && !cascadeIds.has(item.id!)) {
            cascadeIds.add(item.id!);
            changed = true;
          }
        }
      }
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (cascadeIds.has(items[index].id!)) items.splice(index, 1);
      }
      return [];
    }),
  };
  const deps = {
    fetchSelectionDocument: vi.fn(async () => structuredClone(selectorSource)),
    createEmbeddedSource: vi.fn(async (picked: SelectionRef): Promise<EmbeddedItemSource | null> => {
      if (picked.uuid === origin.selectorUuid) return structuredClone(selectorSource);
      if (picked.uuid === feature.sourceId) {
        const source = structuredClone(implementSourceDocuments[picked.uuid]);
        if (implementSlug === "wand") {
          source.system!.rules = source.system!.rules!.filter((rule) => rule.uuid !== WAND_BENEFIT_UUID);
          source.flags = {
            [MODULE_ID]: {
              manualStaticItemGrants: [
                { key: "initiateBenefitWand", uuid: WAND_BENEFIT_UUID, choices: { initiateBenefitWand: "fire" } },
              ],
            },
          };
        }
        return source;
      }
      if (picked.uuid === WAND_BENEFIT_UUID) {
        return {
          name: "Initiate Benefit (Wand)",
          type: "feat",
          system: {
            rules: [{ key: "ChoiceSet", flag: "initiateBenefitWand", choices: [{ value: "fire", label: "Fire" }] }],
          },
        };
      }
      return null;
    }),
  };
  return {
    actor,
    plan,
    deps,
    items,
    feature,
    equipment,
    classItem,
    selectorSource,
    missingSelectorItemId: selectorEvidence.id,
  };
}
