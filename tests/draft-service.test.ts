import { describe, expect, it } from "vitest";
import {
  buildDraftPatch,
  createEmptyDraft,
  createEmptyState,
  normalizeDraft,
  normalizeState,
} from "../src/draft-service";

describe("draft-service", () => {
  it("creates an empty draft", () => {
    expect(createEmptyDraft(4)).toEqual({
      version: 5,
      targetLevel: 4,
      selections: {},
      boosts: {
        ancestry: {
          modeTouched: false,
          mode: "standard",
          selectedBoosts: {},
          alternateBoosts: [],
          voluntary: {
            touched: false,
            enabled: false,
            legacy: false,
            boost: null,
            flaws: [],
          },
        },
        background: {
          selectedBoosts: {},
        },
        class: {
          keyAbility: null,
        },
        levels: {},
      },
      manual: {},
      skillIncreases: {},
      skillTrainings: {},
      branchSelections: {},
      singletonChoices: {},
      classChoices: {},
      spellChoices: {},
      updatedAt: null,
    });
  });

  it("creates an empty module state", () => {
    expect(createEmptyState()).toEqual({
      version: 1,
      lastAppliedAt: null,
      lastTargetLevel: null,
      completedStepIds: [],
    });
  });

  it("sanitizes malformed draft values", () => {
    const draft = normalizeDraft(
      {
        targetLevel: 99,
        selections: {
          keep: {
            packId: "pf2e.feats-srd",
            documentId: "abc",
            uuid: "Compendium.pf2e.feats-srd.abc",
            itemType: "feat",
            name: "Test Feat",
            featType: "general",
            level: 3,
          },
          drop: {
            packId: "pf2e.feats-srd",
          },
        },
        manual: {
          one: true,
          two: false,
        },
        skillIncreases: {
          keep: "Acrobatics",
          drop: "",
          bad: 2,
        },
        skillTrainings: {
          fighter: {
            ruleChoices: {
              fighterSkill: "Athletics",
              bad: 2,
            },
            additional: ["Society", "", 3, "Medicine", "Society"],
          },
        },
        spellChoices: {
          wizard: [
            {
              packId: "pf2e.spells-srd",
              documentId: "magic-missile",
              uuid: "Compendium.pf2e.spells-srd.magic-missile",
              itemType: "spell",
              name: "Magic Missile",
              level: 1,
            },
            {
              packId: "pf2e.spells-srd",
              documentId: "magic-missile",
              uuid: "Compendium.pf2e.spells-srd.magic-missile",
              itemType: "spell",
              name: "Magic Missile",
              level: 1,
            },
            {
              packId: "pf2e.spells-srd",
            },
          ],
        },
        boosts: {
          ancestry: {
            modeTouched: false,
            mode: "alternate",
            alternateBoosts: ["str", "dex", "dex", "bad"],
            selectedBoosts: {
              one: "int",
              two: "bad",
            },
            voluntary: {
              touched: false,
              enabled: true,
              legacy: true,
              boost: "wis",
              flaws: ["str", "str", "bad"],
            },
          },
          class: {
            keyAbility: "con",
          },
          levels: {
            1: ["str", "dex", "con", "wis", "cha"],
            2: ["bad"],
          },
        },
      },
      1
    );

    expect(draft.targetLevel).toBe(20);
    expect(Object.keys(draft.selections)).toEqual(["keep"]);
    expect(draft.selections.keep.uuid).toBe("Compendium.pf2e.feats-srd.Item.abc");
    expect(draft.manual).toEqual({
      one: true,
      two: false,
    });
    expect(draft.skillIncreases).toEqual({
      keep: "acrobatics",
    });
    expect(draft.skillTrainings).toEqual({
      fighter: {
        ruleChoices: {
          fighterSkill: "athletics",
        },
        additional: ["society", "medicine"],
      },
    });
    expect(draft.singletonChoices).toEqual({});
    expect(draft.classChoices).toEqual({});
    expect(draft.spellChoices).toEqual({
      wizard: [
        {
          slotId: "wizard",
          packId: "pf2e.spells-srd",
          documentId: "magic-missile",
          uuid: "Compendium.pf2e.spells-srd.Item.magic-missile",
          itemType: "spell",
          featType: null,
          name: "Magic Missile",
          level: 1,
        },
      ],
    });
    expect(draft.boosts).toEqual({
      ancestry: {
        modeTouched: false,
        mode: "alternate",
        selectedBoosts: {
          one: "int",
        },
        alternateBoosts: ["str", "dex"],
        voluntary: {
          touched: false,
          enabled: true,
          legacy: true,
          boost: "wis",
          flaws: ["str", "str"],
        },
      },
      background: {
        selectedBoosts: {},
      },
      class: {
        keyAbility: "con",
      },
      levels: {
        1: ["str", "dex", "con", "wis"],
      },
    });
  });

  it("adds an updated timestamp when patching a draft", () => {
    const patched = buildDraftPatch(createEmptyDraft(2));
    expect(patched.version).toBe(5);
    expect(patched.updatedAt).not.toBeNull();
  });

  it("sanitizes module state", () => {
    expect(
      normalizeState({
        lastAppliedAt: "2026-04-08T00:00:00.000Z",
        lastTargetLevel: 24,
        completedStepIds: ["a", 1, "b"],
      })
    ).toEqual({
      version: 1,
      lastAppliedAt: "2026-04-08T00:00:00.000Z",
      lastTargetLevel: 20,
      completedStepIds: ["a", "b"],
    });
  });
});
