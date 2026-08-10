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
});
