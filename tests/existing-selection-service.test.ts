import { describe, expect, it } from "vitest";
import type { ClassGrantMeta } from "../src/types";
import { readExistingGrantedSelection } from "../src/wayfinder/existing-selection-service";

describe("existing-selection-service", () => {
  it("does not treat a loose deity item as proof that the granting feature is resolved", () => {
    const actor = {
      items: {
        contents: [
          {
            id: "deity-1",
            type: "deity",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.deities.Item.gorum",
              },
            },
          },
        ],
      },
    };

    expect(readExistingGrantedSelection(actor as any, clericDeityGrant())).toBeNull();
  });

  it("reads a granted selection from the owning selector feature before falling back to linked grants", () => {
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.deity-cleric",
              },
              pf2e: {
                rulesSelections: {
                  deity: "Compendium.pf2e.deities.Item.gorum",
                },
              },
            },
          },
          {
            id: "deity-1",
            type: "deity",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.deities.Item.iomedae",
              },
              pf2e: {
                grantedBy: {
                  id: "selector-1",
                },
              },
            },
          },
        ],
      },
    };

    expect(readExistingGrantedSelection(actor as any, clericDeityGrant())).toBe("Compendium.pf2e.deities.Item.gorum");
  });

  it("falls back to the selector-linked granted item when rulesSelections are missing", () => {
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.deity-cleric",
              },
              pf2e: {
                rulesSelections: {},
                itemGrants: {
                  deity: {
                    id: "deity-1",
                  },
                },
              },
            },
          },
          {
            id: "deity-1",
            type: "deity",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.deities.Item.gorum",
              },
              pf2e: {
                grantedBy: {
                  id: "selector-1",
                },
              },
            },
          },
        ],
      },
    };

    expect(readExistingGrantedSelection(actor as any, clericDeityGrant())).toBe("Compendium.pf2e.deities.Item.gorum");
  });
});

function clericDeityGrant(): ClassGrantMeta {
  return {
    slotId: "deity-level-1",
    selectorPackId: "pf2e.classfeatures",
    selectorDocumentId: "deity-cleric",
    selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
    selectorName: "Deity",
    selectorRuleIndex: 0,
    grantRuleIndex: 1,
    flag: "deity",
    itemType: "deity",
    classSlug: "cleric",
  };
}
