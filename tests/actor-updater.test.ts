import { describe, expect, it, vi } from "vitest";
import { applyDraftToActor } from "../src/actor-updater";
import { createEmptyDraft } from "../src/draft-service";

describe("actor-updater", () => {
  it("writes drafted boost state back to PF2E item and actor fields on apply", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const update = vi.fn(async () => ({}));
    const actor = {
      system: {
        details: {
          level: {
            value: 5
          }
        },
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "wis"],
              5: [],
              10: [],
              15: [],
              20: []
            }
          }
        }
      },
      items: {
        contents: [
          ancestryItem(),
          backgroundItem(),
          classItem()
        ]
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update
    };

    const draft = createEmptyDraft(5);
    draft.boosts.ancestry.modeTouched = true;
    draft.boosts.ancestry.mode = "alternate";
    draft.boosts.ancestry.alternateBoosts = ["dex", "int"];
    draft.boosts.ancestry.voluntary = {
      touched: true,
      enabled: true,
      legacy: true,
      boost: "cha",
      flaws: ["str", "str"]
    };
    draft.boosts.background.selectedBoosts = {
      restricted: "dex",
      free: "wis"
    };
    draft.boosts.class.keyAbility = "wis";
    draft.boosts.levels["5"] = ["str", "dex", "int", "cha"];

    await applyDraftToActor(actor as any, draft, []);

    expect(updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "ancestry-1",
        "system.alternateAncestryBoosts": ["dex", "int"],
        "system.boosts.fixed.selected": "con",
        "system.boosts.free.selected": null,
        "system.voluntary.flaws": ["str", "str"],
        "system.voluntary.boost": "cha"
      },
      {
        _id: "background-1",
        "system.boosts.restricted.selected": "dex",
        "system.boosts.free.selected": "wis"
      },
      {
        _id: "class-1",
        "system.keyAbility.selected": "wis"
      }
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      "system.build.attributes.boosts.1": ["str", "dex", "con", "wis"],
      "system.build.attributes.boosts.5": ["str", "dex", "int", "cha"],
      "system.build.attributes.boosts.10": [],
      "system.build.attributes.boosts.15": [],
      "system.build.attributes.boosts.20": []
    });
  });

  it("inserts drafted feats into PF2E feat slots instead of creating raw bonus feats", async () => {
    const updateEmbeddedDocuments = vi.fn(async () => []);
    const insertFeat = vi.fn(async () => [{ id: "created-feat-1" }]);
    globalThis.game = {
      packs: new Map([
        ["pf2e.feats-srd", {
          metadata: { id: "pf2e.feats-srd" },
          async getDocument(documentId: string) {
            if (documentId !== "adapted-cantrip") {
              return null;
            }

            return {
              id: documentId,
              name: "Adapted Cantrip",
              toObject: () => ({
                name: "Adapted Cantrip",
                type: "feat",
                system: {
                  category: "ancestry",
                  level: { value: 1 },
                  location: null
                }
              })
            };
          }
        }]
      ])
    } as any;

    const actor = {
      system: {
        details: {
          level: {
            value: 1
          }
        },
        build: {
          attributes: {
            boosts: {
              1: [],
              5: [],
              10: [],
              15: [],
              20: []
            }
          }
        }
      },
      items: {
        contents: []
      },
      feats: {
        get(groupId: string) {
          if (groupId !== "ancestry") {
            return null;
          }

          return {
            slots: {
              "ancestry-1": {
                id: "ancestry-1",
                level: 1,
                feat: null
              }
            }
          };
        },
        insertFeat
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments,
      update: vi.fn(async () => ({}))
    };

    const draft = createEmptyDraft(1);
    draft.selections["ancestry-feat-level-1"] = {
      slotId: "ancestry-feat-level-1",
      packId: "pf2e.feats-srd",
      documentId: "adapted-cantrip",
      uuid: "Compendium.pf2e.feats-srd.Item.adapted-cantrip",
      itemType: "feat",
      featType: "ancestry",
      name: "Adapted Cantrip",
      level: 1
    };

    await applyDraftToActor(actor as any, draft, [{
      id: "ancestry-feat-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "ancestry-feat",
      title: "Level 1 ancestry feat",
      description: "",
      required: true,
      slotId: "ancestry-feat-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["ancestry"],
        maxLevel: 1
      }
    }]);

    expect(insertFeat).toHaveBeenCalledTimes(1);
    expect(insertFeat.mock.calls[0]?.[1]).toEqual({
      groupId: "ancestry",
      slotId: "ancestry-1"
    });
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "created-feat-1",
        "flags.core.sourceId": "Compendium.pf2e.feats-srd.Item.adapted-cantrip",
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "ancestry-feat-level-1"
      }
    ]);
  });
});

function ancestryItem(): any {
  return {
    id: "ancestry-1",
    type: "ancestry",
    name: "Human",
    system: {
      boosts: {
        fixed: {
          value: ["con"],
          selected: "con"
        },
        free: {
          value: ["str", "dex", "con", "int", "wis", "cha"],
          selected: null
        }
      },
      voluntary: {
        flaws: []
      }
    }
  };
}

function backgroundItem(): any {
  return {
    id: "background-1",
    type: "background",
    name: "Acrobat",
    system: {
      boosts: {
        restricted: {
          value: ["str", "dex"],
          selected: null
        },
        free: {
          value: ["str", "dex", "con", "int", "wis", "cha"],
          selected: null
        }
      }
    }
  };
}

function classItem(): any {
  return {
    id: "class-1",
    type: "class",
    name: "Wizard",
    system: {
      keyAbility: {
        value: ["int", "wis"],
        selected: null
      }
    }
  };
}
