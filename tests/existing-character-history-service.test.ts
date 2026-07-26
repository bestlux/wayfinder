import { describe, expect, it } from "vitest";
import { createEmptyState } from "../src/draft-service";
import {
  buildExistingCharacterHistory,
  withExistingCharacterHistory,
} from "../src/wayfinder/application/existing-character-history-service";

describe("existing character history service", () => {
  it("maps source-backed foundations and PF2E native feat slots without inferring ambiguous history", () => {
    const actor = {
      system: {
        details: { level: { value: 5 } },
        build: {
          attributes: {
            boosts: {
              1: ["str", "dex", "con", "int"],
              5: ["dex", "con", "int", "wis"],
            },
          },
        },
      },
      items: {
        contents: [
          actorItem("ancestry-1", "ancestry", "Human", "Compendium.pf2e.ancestries.Item.human"),
          actorItem("heritage-1", "heritage", "Versatile Heritage", "Compendium.pf2e.heritages.Item.versatile"),
          actorItem("background-1", "background", "Scholar", "Compendium.pf2e.backgrounds.Item.scholar"),
          actorItem("class-1", "class", "Wizard", "Compendium.pf2e.classes.Item.wizard"),
          actorItem(
            "ancestry-feat-1",
            "feat",
            "Natural Ambition",
            "Compendium.pf2e.feats-srd.Item.natural-ambition",
            "ancestry-1"
          ),
          actorItem("skill-feat-2", "feat", "Assurance", "Compendium.pf2e.feats-srd.Item.assurance", "skill-2"),
          actorItem("general-feat-3", "feat", "Toughness", "Compendium.pf2e.feats-srd.Item.toughness", "general-3"),
          actorItem("class-feat-2", "feat", "Reach Spell", "Compendium.pf2e.feats-srd.Item.reach-spell", "class-2"),
        ],
      },
      feats: {
        ancestry: { slots: { level1: { level: 1, feat: "ancestry-feat-1" }, level5: { level: 5, feat: null } } },
        skill: { slots: { level2: { level: 2, feat: "skill-feat-2" }, level4: { level: 4, feat: null } } },
        general: { slots: { level3: { level: 3, feat: "general-feat-3" } } },
        class: { slots: { level2: { level: 2, feat: "class-feat-2" }, level4: { level: 4, feat: null } } },
      },
    };

    const history = buildExistingCharacterHistory(actor, () => "2026-07-26T18:00:00.000Z");

    expect(history).toMatchObject({
      version: 1,
      importedAt: "2026-07-26T18:00:00.000Z",
      actorLevel: 5,
    });
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "ancestry-level-1",
        value: "Human",
        status: "mapped",
        sourceUuid: "Compendium.pf2e.ancestries.Item.human",
      })
    );
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "class-feat-level-2",
        value: "Reach Spell",
        status: "mapped",
      })
    );
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "class-feat-level-4",
        value: "No feat is assigned to this PF2E slot",
        status: "review",
      })
    );
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "ability-boosts-level-5",
        value: "DEX, CON, INT, WIS",
        status: "mapped",
      })
    );
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "creation-source-boosts-level-1",
        status: "review",
      })
    );
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "skill-increase-level-3",
        status: "review",
      })
    );
  });

  it("preserves existing application state when attaching an imported history", () => {
    const state = {
      ...createEmptyState(),
      completedStepIds: ["class-feat-level-2"],
    };
    const history = buildExistingCharacterHistory(
      { system: { details: { level: { value: 1 } } }, items: [] },
      () => "2026-07-26T18:00:00.000Z"
    );

    expect(withExistingCharacterHistory(state, history)).toEqual({
      ...state,
      existingCharacterHistory: history,
    });
  });

  it("uses PF2E native feat-group levels for nonstandard class cadences", () => {
    const actor = {
      system: { details: { level: { value: 3 } } },
      items: {
        contents: [
          actorItem(
            "skill-feat-3",
            "feat",
            "Known Weaknesses",
            "Compendium.pf2e.feats-srd.Item.known-weaknesses",
            "skill-3"
          ),
        ],
      },
      feats: {
        skill: {
          slots: {
            investigatorLevel3: {
              level: 3,
              feat: "skill-feat-3",
            },
          },
        },
      },
    };

    const history = buildExistingCharacterHistory(actor);
    const skillFeatEntries = history.entries.filter(
      (entry) => entry.category === "feat" && entry.slotId.startsWith("skill-feat-")
    );

    expect(skillFeatEntries).toEqual([
      expect.objectContaining({
        slotId: "skill-feat-level-3",
        value: "Known Weaknesses",
        status: "mapped",
      }),
    ]);
  });
});

function actorItem(
  id: string,
  type: string,
  name: string,
  sourceId: string,
  location?: string
): Record<string, unknown> {
  return {
    id,
    type,
    name,
    flags: { core: { sourceId } },
    system: location ? { location } : {},
  };
}
