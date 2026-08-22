import { beforeEach, describe, expect, it } from "vitest";
import { getEffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("build-state", () => {
  beforeEach(() => {
    testGlobals.game = {
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
    expect(buildState.projectedAbilities.str.flawCount).toBe(3);
    expect(buildState.projectedAbilities.int.modifier).toBe(3);
    expect(buildState.projectedAbilities.cha.modifier).toBe(3);
    expect(buildState.languages).toEqual({
      sourceLanguages: [],
      grantedLanguages: ["common"],
      selectableLanguages: ["draconic", "dwarven"],
      maxSelections: 3,
    });
  });

  it("mirrors PF2E's gradual batch allowance in effective boosts and projections", async () => {
    const actor = {
      system: {
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "int"],
              5: ["wis", "cha", "str", "dex"],
            },
          },
        },
      },
      items: [],
    };
    testGlobals.game.settings = {
      get: (_scope: string, key: string) => key === "gradualBoostsVariant",
    };

    const gradualState = await getEffectiveBuildState(actor, createEmptyDraft(3));
    expect(gradualState.allowedBoosts[5]).toBe(2);
    expect(gradualState.levelBoosts[5]).toEqual(["wis", "cha"]);
    expect(gradualState.projectedAbilities.wis.boostCount).toBe(1);

    testGlobals.game.settings.get = () => false;
    const standardState = await getEffectiveBuildState(actor, createEmptyDraft(3));
    expect(standardState.allowedBoosts[5]).toBe(0);
    expect(standardState.levelBoosts[5]).toEqual([]);
    expect(standardState.projectedAbilities.wis.boostCount).toBe(0);
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

  it.each([
    ["Lizardfolk", "int"],
    ["Elf", "con"],
  ] as const)("projects %s's prepared %s flaw", async (name, flaw) => {
    const actor = actorWithAncestry({
      name,
      type: "ancestry",
      system: {
        boosts: {
          fixed: { value: ["str"], selected: "str" },
        },
        flaws: {
          fixed: { value: [flaw], selected: flaw },
        },
      },
    });

    const buildState = await getEffectiveBuildState(actor, createEmptyDraft(1));

    expect(buildState.ancestry?.buildBoosts).toEqual(["str"]);
    expect(buildState.ancestry?.buildFlaws).toEqual([flaw]);
    expect(buildState.projectedAbilities[flaw].flawCount).toBe(1);
    expect(buildState.projectedAbilities[flaw].modifier).toBe(-1);
  });

  it("falls back to a sole source value for unprepared printed boost and flaw slots", async () => {
    const actor = actorWithAncestry({
      name: "Lizardfolk",
      type: "ancestry",
      system: {
        boosts: {
          fixed: { value: ["wis"], selected: "cha" },
        },
        flaws: {
          fixed: { value: ["int"], selected: "" },
        },
      },
    });

    const buildState = await getEffectiveBuildState(actor, createEmptyDraft(1));

    expect(buildState.ancestry?.selectedBoosts).toEqual({ fixed: "wis" });
    expect(buildState.ancestry?.lockedBoosts).toEqual(["wis"]);
    expect(buildState.ancestry?.buildBoosts).toEqual(["wis"]);
    expect(buildState.ancestry?.buildFlaws).toEqual(["int"]);
  });

  it("does not infer a sole background boost without an explicit selection", async () => {
    const actor = {
      system: {},
      items: {
        contents: [
          {
            id: "background-1",
            name: "Custom Background",
            type: "background",
            system: {
              boosts: {
                fixed: { value: ["int"], selected: null },
              },
            },
          },
        ],
      },
    };

    const buildState = await getEffectiveBuildState(actor, createEmptyDraft(1));

    expect(buildState.background?.selectedBoosts).toEqual({ fixed: null });
    expect(buildState.background?.buildBoosts).toEqual([]);
    expect(buildState.projectedAbilities.int.boostCount).toBe(0);
  });

  it("ignores printed flaws in alternate mode while retaining voluntary flaws", async () => {
    const actor = actorWithAncestry({
      name: "Elf",
      type: "ancestry",
      system: {
        alternateAncestryBoosts: ["dex", "int"],
        boosts: {
          fixed: { value: ["dex"], selected: "dex" },
        },
        flaws: {
          fixed: { value: ["con"], selected: "con" },
        },
      },
    });
    const draft = createEmptyDraft(1);
    draft.boosts.ancestry.voluntary = {
      touched: true,
      enabled: true,
      legacy: false,
      boost: null,
      flaws: ["str"],
    };

    const buildState = await getEffectiveBuildState(actor, draft);

    expect(buildState.ancestry?.mode).toBe("alternate");
    expect(buildState.ancestry?.buildBoosts).toEqual(["dex", "int"]);
    expect(buildState.ancestry?.buildFlaws).toEqual(["str"]);
    expect(buildState.projectedAbilities.con.flawCount).toBe(0);
    expect(buildState.projectedAbilities.str.flawCount).toBe(1);
  });

  it("fail-closes malformed and unresolved multi-option printed slots", async () => {
    const actor = actorWithAncestry({
      name: "Malformed Ancestry",
      type: "ancestry",
      system: {
        boosts: {},
        flaws: {
          prepared: { value: ["con"], selected: "con" },
          unresolved: { value: ["int", "wis"], selected: null },
          invalidOption: { value: ["str", "invalid"], selected: null },
          mismatchedSelection: { value: ["dex", "wis"], selected: "cha" },
          duplicate: { value: ["int", "int"], selected: "int" },
        },
      },
    });

    const buildState = await getEffectiveBuildState(actor, createEmptyDraft(1));

    expect(buildState.ancestry?.buildFlaws).toEqual(["con"]);
    expect(
      Object.fromEntries(
        Object.entries(buildState.projectedAbilities).map(([key, ability]) => [key, ability.flawCount])
      )
    ).toEqual({ str: 0, dex: 0, con: 1, int: 0, wis: 0, cha: 0 });
  });
});

function setPack(id: string, documents: Record<string, any>): void {
  testGlobals.game.packs.set(id, {
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
      languages: {
        value: ["common"],
      },
      additionalLanguages: {
        count: 0,
        value: ["draconic", "dwarven"],
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

function actorWithAncestry(ancestry: any): any {
  return {
    system: {},
    items: {
      contents: [
        {
          id: "ancestry-1",
          ...ancestry,
        },
      ],
    },
  };
}
