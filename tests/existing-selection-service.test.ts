import { describe, expect, it } from "vitest";
import type { ClassBranchMeta, ClassChoiceMeta, ClassGrantMeta } from "../src/types";
import {
  readExistingBranchSelection,
  readExistingClassChoiceSelection,
  readExistingGrantedSelection,
} from "../src/wayfinder/existing-selection-service";

describe("existing-selection-service", () => {
  it("reads a branch selection from the selector feature rulesSelections", () => {
    const actor = {
      items: {
        contents: [
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.racket-selector",
              },
              pf2e: {
                rulesSelections: {
                  roguesRacket: "Compendium.pf2e.classfeatures.Item.scoundrel",
                },
              },
            },
          },
        ],
      },
    };

    expect(readExistingBranchSelection(actor, rogueRacketBranch())).toBe(
      "Compendium.pf2e.classfeatures.Item.scoundrel"
    );
  });

  it("reads a class choice selection from the source feature rulesSelections", () => {
    const actor = {
      items: {
        contents: [
          {
            id: "font-1",
            type: "feat",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.divine-font",
              },
              pf2e: {
                rulesSelections: {
                  divineFont: "heal",
                },
              },
            },
          },
        ],
      },
    };

    expect(readExistingClassChoiceSelection(actor, divineFontChoice())).toBe("heal");
  });

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

    expect(readExistingGrantedSelection(actor, clericDeityGrant())).toBeNull();
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

    expect(readExistingGrantedSelection(actor, clericDeityGrant())).toBe("Compendium.pf2e.deities.Item.gorum");
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

    expect(readExistingGrantedSelection(actor, clericDeityGrant())).toBe("Compendium.pf2e.deities.Item.gorum");
  });
});

function rogueRacketBranch(): ClassBranchMeta {
  return {
    slotId: "class-branch-rogue-s-racket-level-1",
    selectorPackId: "pf2e.classfeatures",
    selectorDocumentId: "racket-selector",
    selectorUuid: "Compendium.pf2e.classfeatures.Item.racket-selector",
    selectorName: "Rogue's Racket",
    selectorRuleIndex: 0,
    flag: "roguesRacket",
    optionTag: "rogue-racket",
    classSlug: "rogue",
    dependsOn: "class",
  };
}

function divineFontChoice(): ClassChoiceMeta {
  return {
    slotId: "class-choice-divine-font-divineFont-level-1",
    sourcePackId: "pf2e.classfeatures",
    sourceDocumentId: "divine-font",
    sourceUuid: "Compendium.pf2e.classfeatures.Item.divine-font",
    sourceName: "Divine Font",
    sourceRuleIndex: 0,
    flag: "divineFont",
    classSlug: "cleric",
    dependsOn: "deity",
    options: [{ value: "heal", label: "Heal", img: null, detail: null }],
  };
}

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
