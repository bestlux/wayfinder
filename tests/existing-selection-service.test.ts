import { describe, expect, it } from "vitest";
import type { ClassBranchMeta, ClassChoiceMeta, ClassGrantMeta, SingletonChoiceMeta } from "../src/types";
import {
  readExistingBranchSelection,
  readExistingClassChoiceSelection,
  readExistingGrantedSelection,
  readExistingLanguageSelections,
  readExistingSingletonChoiceSelection,
  readExistingSingletonSourceSelection,
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

  it("reads a singleton choice selection from the owning singleton item rulesSelections", () => {
    const actor = {
      items: {
        contents: [
          {
            id: "background-1",
            type: "background",
            name: "Sponsored by Family",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
              },
              pf2e: {
                rulesSelections: {
                  academySkill: "society",
                },
              },
            },
          },
        ],
      },
    };

    expect(readExistingSingletonChoiceSelection(actor, academySkillChoice())).toBe("society");
    expect(readExistingSingletonSourceSelection(actor, "background")).toMatchObject({
      packId: "pf2e.backgrounds",
      documentId: "sponsored-by-family",
      uuid: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
      itemType: "background",
      name: "Sponsored by Family",
    });
  });

  it("prefers source language selections from actor _source data", () => {
    const actor = {
      _source: {
        system: {
          details: {
            languages: {
              value: ["Draconic", "Dwarven"],
            },
          },
        },
      },
      system: {
        details: {
          languages: {
            value: ["common", "draconic", "dwarven"],
          },
        },
      },
      items: {
        contents: [],
      },
    };

    expect(readExistingLanguageSelections(actor)).toEqual(["draconic", "dwarven"]);
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
    sourceItemType: "classfeature",
    selectorPackId: "pf2e.classfeatures",
    selectorDocumentId: "deity-cleric",
    selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
    selectorName: "Deity",
    selectorRuleIndex: 0,
    grantRuleIndex: 1,
    flag: "deity",
    itemType: "deity",
    classSlug: "cleric",
    dependsOn: "class",
    filters: {
      itemType: "deity",
    },
  };
}

function academySkillChoice(): SingletonChoiceMeta {
  return {
    slotId: "singleton-choice-background-sponsored-by-family-academySkill-level-1",
    sourceItemType: "background",
    sourcePackId: "pf2e.backgrounds",
    sourceDocumentId: "sponsored-by-family",
    sourceUuid: "Compendium.pf2e.backgrounds.Item.sponsored-by-family",
    sourceName: "Sponsored by Family",
    sourceRuleIndex: 0,
    flag: "academySkill",
    prompt: "Choose your trained skill",
    predicate: [],
    rollOption: null,
    options: [{ value: "society", label: "Society", img: null, detail: null }],
  };
}
