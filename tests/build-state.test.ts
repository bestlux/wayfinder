import { beforeEach, describe, expect, it } from "vitest";
import { getEffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";

describe("build-state", () => {
  beforeEach(() => {
    globalThis.game = {
      packs: new Map(),
    } as any;
  });

  it("prefers drafted singleton documents and carries draft boosts forward into projected state", async () => {
    setPack("pf2e.ancestries", documentEntry("human", ancestryDocument("Human")));
    setPack("pf2e.backgrounds", documentEntry("acrobat", backgroundDocument("Acrobat")));
    setPack("pf2e.classes", documentEntry("wizard", classDocument("Wizard")));

    const actor = {
      system: {
        details: {
          level: {
            value: 5,
          },
        },
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "wis"],
              5: ["wis", "cha"],
              10: [],
              15: [],
              20: [],
            },
          },
        },
      },
      items: {
        contents: [],
      },
    };

    const draft = createEmptyDraft(5);
    draft.selections["ancestry-level-1"] = selection("pf2e.ancestries", "human", "Human", "ancestry");
    draft.selections["background-level-1"] = selection("pf2e.backgrounds", "acrobat", "Acrobat", "background");
    draft.selections["class-level-1"] = selection("pf2e.classes", "wizard", "Wizard", "class");
    draft.boosts.ancestry.selectedBoosts = {
      fixed: "con",
      free: "wis",
    };
    draft.boosts.ancestry.voluntary = {
      touched: true,
      enabled: true,
      legacy: true,
      boost: "cha",
      flaws: ["str", "str"],
    };
    draft.boosts.background.selectedBoosts = {
      restricted: "dex",
      free: "int",
    };
    draft.boosts.class.keyAbility = "int";
    draft.boosts.levels["1"] = ["cha", "con", "dex", "int"];

    const buildState = await getEffectiveBuildState(actor, draft);

    expect(buildState.ancestry?.document.name).toBe("Human");
    expect(buildState.background?.document.name).toBe("Acrobat");
    expect(buildState.class?.document.name).toBe("Wizard");
    expect(buildState.ancestry?.voluntary).toEqual({
      enabled: true,
      legacy: true,
      boost: "cha",
      flaws: ["str", "str"],
    });
    expect(buildState.levelBoosts[1]).toEqual(["cha", "con", "dex", "int"]);
    expect(buildState.levelBoosts[5]).toEqual(["wis", "cha"]);
    expect(buildState.class?.selectedKeyAbility).toBe("int");
    expect(buildState.projectedAbilities.str.flawCount).toBe(2);
    expect(buildState.projectedAbilities.int.modifier).toBe(3);
    expect(buildState.projectedAbilities.cha.modifier).toBe(3);
  });

  it("falls back to committed ancestry boost mode and voluntary state until the draft touches them", async () => {
    const actor = {
      system: {
        details: {
          level: {
            value: 1,
          },
        },
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "wis"],
              5: [],
              10: [],
              15: [],
              20: [],
            },
          },
        },
      },
      items: {
        contents: [
          {
            id: "ancestry-1",
            type: "ancestry",
            name: "Human",
            system: {
              alternateAncestryBoosts: ["dex", "int"],
              boosts: {
                fixed: {
                  value: ["con"],
                  selected: "con",
                },
                free: {
                  value: ["str", "dex", "con", "int", "wis", "cha"],
                  selected: null,
                },
              },
              voluntary: {
                boost: "cha",
                flaws: ["str", "str"],
              },
            },
          },
        ],
      },
    };

    const buildState = await getEffectiveBuildState(actor, createEmptyDraft(1));

    expect(buildState.ancestry?.mode).toBe("alternate");
    expect(buildState.ancestry?.alternateBoosts).toEqual(["dex", "int"]);
    expect(buildState.ancestry?.voluntary).toEqual({
      enabled: true,
      legacy: true,
      boost: "cha",
      flaws: ["str", "str"],
    });
  });
});

function setPack(id: string, documents: Record<string, any>): void {
  globalThis.game.packs.set(id, {
    metadata: { id },
    async getDocument(documentId: string) {
      return documents[documentId] ?? null;
    },
  });
}

function documentEntry(id: string, data: any): Record<string, any> {
  return {
    [id]: {
      ...data,
      toObject: () => structuredClone(data),
    },
  };
}

function selection(packId: string, documentId: string, name: string, itemType: string) {
  return {
    slotId: `${itemType}-level-1`,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType: null,
    name,
    level: 1,
  };
}

function ancestryDocument(name: string): any {
  return {
    name,
    type: "ancestry",
    system: {
      boosts: {
        fixed: {
          value: ["con"],
          selected: null,
        },
        free: {
          value: ["str", "dex", "con", "int", "wis", "cha"],
          selected: null,
        },
      },
      flaws: {
        fixed: {
          value: ["str"],
        },
      },
    },
  };
}

function backgroundDocument(name: string): any {
  return {
    name,
    type: "background",
    system: {
      boosts: {
        restricted: {
          value: ["str", "dex"],
          selected: null,
        },
        free: {
          value: ["str", "dex", "con", "int", "wis", "cha"],
          selected: null,
        },
      },
    },
  };
}

function classDocument(name: string): any {
  return {
    name,
    type: "class",
    system: {
      keyAbility: {
        value: ["int", "wis"],
        selected: null,
      },
    },
  };
}
