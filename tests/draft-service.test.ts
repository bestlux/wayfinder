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
      version: 8,
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
      classArchetypeChoices: {},
      singletonChoices: {},
      languageChoices: {},
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
        languageChoices: {
          keep: ["Draconic", "", "draconic", 2, "Goblin"],
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
        loreChoices: {},
      },
    });
    expect(draft.singletonChoices).toEqual({});
    expect(draft.languageChoices).toEqual({
      keep: ["draconic", "goblin"],
    });
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
    expect(patched.version).toBe(8);
    expect(patched.updatedAt).not.toBeNull();
  });

  it("clears incompatible class state when migrating a legacy Battle Creed branch", () => {
    const draft = normalizeDraft(
      {
        version: 7,
        targetLevel: 5,
        branchSelections: {
          "class-branch-doctrine-level-1": rawSelection(
            "class-branch-doctrine-level-1",
            "pf2e.classfeatures",
            "49CkgA3kj7Im6gZ5",
            "Battle Creed",
            "classfeature"
          ),
          "class-branch-other-level-1": rawSelection(
            "class-branch-other-level-1",
            "pf2e.classfeatures",
            "other",
            "Other Branch",
            "classfeature"
          ),
        },
        selections: {
          "class-feat-level-2": rawSelection(
            "class-feat-level-2",
            "pf2e.feats-srd",
            "class-feat",
            "Class Feat",
            "class"
          ),
          "general-feat-level-3": rawSelection(
            "general-feat-level-3",
            "pf2e.feats-srd",
            "AmP0qu7c5dlBSath",
            "Toughness",
            "general"
          ),
          "ancestry-feat-level-1": rawSelection(
            "ancestry-feat-level-1",
            "pf2e.feats-srd",
            "ancestry-feat",
            "Ancestry Feat",
            "ancestry"
          ),
        },
        classChoices: {
          "class-choice-divine-font-divineFont-level-1": "heal",
        },
        skillTrainings: {
          "skill-training-cleric-level-1": {
            ruleChoices: { skill: "religion" },
            additional: [],
            loreChoices: {},
          },
        },
        spellChoices: {
          "spell-choice-cleric-rank-1-level-1": [
            rawSelection("spell-choice-cleric-rank-1-level-1", "pf2e.spells-srd", "heal", "Heal", null),
            rawSelection("spell-choice-cleric-rank-1-level-1", "pf2e.spells-srd", "harm", "Harm", null),
          ],
        },
        languageChoices: {
          "language-choice-level-1": ["Draconic"],
        },
      },
      1
    );

    expect(draft.classArchetypeChoices).toEqual({
      "class-archetype-doctrine-level-1": "battle-creed",
    });
    expect(draft.branchSelections).toEqual({});
    expect(draft.classChoices).toEqual({});
    expect(draft.skillTrainings).toEqual({});
    expect(draft.spellChoices).toEqual({});
    expect(draft.selections).toEqual({
      "ancestry-feat-level-1": expect.objectContaining({ name: "Ancestry Feat" }),
    });
    expect(draft.languageChoices).toEqual({ "language-choice-level-1": ["draconic"] });
  });

  it("keeps an explicit lane decision when removing a stale legacy Battle Creed branch", () => {
    const draft = normalizeDraft(
      {
        version: 8,
        targetLevel: 1,
        classArchetypeChoices: {
          "class-archetype-doctrine-level-1": "standard",
        },
        branchSelections: {
          "class-branch-doctrine-level-1": rawSelection(
            "class-branch-doctrine-level-1",
            "pf2e.classfeatures",
            "49CkgA3kj7Im6gZ5",
            "Battle Creed",
            "classfeature"
          ),
        },
      },
      1
    );

    expect(draft.classArchetypeChoices).toEqual({
      "class-archetype-doctrine-level-1": "standard",
    });
    expect(draft.branchSelections).toEqual({});
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

function rawSelection(slotId: string, packId: string, documentId: string, name: string, featType: string | null) {
  return {
    slotId,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType: packId === "pf2e.spells-srd" ? "spell" : "feat",
    featType,
    name,
    level: 1,
  };
}
