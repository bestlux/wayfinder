import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG, MODULE_ID, STATE_FLAG } from "../src/constants";
import { createEmptyDraft, createEmptyState, normalizeDraft, normalizeState } from "../src/draft-service";
import type { ExistingCharacterHistory } from "../src/types";
import { applyDraftLifecycle } from "../src/wayfinder/application/draft-lifecycle-service";
import { PersistedDraftWriteGuard } from "../src/wayfinder/application/draft-write-guard";
import {
  buildExistingCharacterHistory,
  withExistingCharacterHistory,
} from "../src/wayfinder/application/existing-character-history-service";
import {
  hasExecutableAcquisition,
  persistExistingCharacterImport,
} from "../src/wayfinder/application/existing-character-import-service";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import { createEquipmentPolicyRequest } from "../src/wayfinder/domain/equipment-policy";

describe("existing character history service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps source-backed foundations and PF2E native feat slots without inferring ambiguous history", async () => {
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

    const history = await buildExistingCharacterHistory(actor, {
      now: () => "2026-07-26T18:00:00.000Z",
      gradualBoostsEnabled: false,
    });

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

  it("preserves existing application state when attaching an imported history", async () => {
    const state = {
      ...createEmptyState(),
      completedStepIds: ["class-feat-level-2"],
    };
    const history = await buildExistingCharacterHistory(
      { system: { details: { level: { value: 1 } } }, items: [] },
      { now: () => "2026-07-26T18:00:00.000Z", gradualBoostsEnabled: false }
    );

    expect(withExistingCharacterHistory(state, history)).toEqual({
      ...state,
      existingCharacterHistory: history,
    });
  });

  it("uses PF2E native feat-group levels for nonstandard class cadences", async () => {
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

    const history = await buildExistingCharacterHistory(actor);
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

  it("maps a fulfilled native campaign feat slot with the section label", async () => {
    vi.stubGlobal("game", {
      settings: {
        get: (_scope: string, key: string) =>
          key === "campaignFeatSections"
            ? [
                {
                  id: "xdy_ancestryparagon",
                  label: "Ancestry Paragon",
                  supported: ["ancestry"],
                  slots: [{ id: "ancestry-paragon-first-slot", level: 1 }, 3, 7, 11, 15, 19],
                },
              ]
            : false,
      },
    });
    const actor = {
      system: { details: { level: { value: 3 } } },
      items: {
        contents: [
          actorItem(
            "campaign-feat-1",
            "feat",
            "Cooperative Nature",
            "Compendium.pf2e.feats-srd.Item.cooperative-nature",
            "ancestry-paragon-first-slot"
          ),
        ],
      },
      feats: {
        xdy_ancestryparagon: {
          id: "xdy_ancestryparagon",
          label: "Ancestry Paragon",
          supported: ["ancestry"],
          slots: {
            "ancestry-paragon-first-slot": {
              id: "ancestry-paragon-first-slot",
              level: 1,
              feat: "campaign-feat-1",
            },
            "xdy_ancestryparagon-3": {
              id: "xdy_ancestryparagon-3",
              level: 3,
              feat: null,
            },
          },
        },
      },
    };

    const history = await buildExistingCharacterHistory(actor, { gradualBoostsEnabled: false });

    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "campaign-feat-xdy_ancestryparagon-level-1",
        label: "Ancestry Paragon",
        value: "Cooperative Nature",
        status: "mapped",
      })
    );
    expect(history.entries).toContainEqual(
      expect.objectContaining({
        slotId: "campaign-feat-xdy_ancestryparagon-level-3",
        label: "Ancestry Paragon",
        status: "review",
      })
    );
  });

  it("maps each gradual boost from its native batch position to the actual acquisition level", async () => {
    const history = await buildExistingCharacterHistory(
      {
        system: {
          details: { level: { value: 8 } },
          build: {
            attributes: {
              boosts: {
                1: ["str", "dex", "con", "int"],
                5: ["wis", "cha", "str", "dex"],
                10: ["con", "int"],
              },
            },
          },
        },
        items: [],
      },
      { gradualBoostsEnabled: true }
    );

    expect(
      history.entries
        .filter((entry) => entry.category === "ability-boost" && entry.slotId !== "creation-source-boosts-level-1")
        .map((entry) => [entry.slotId, entry.value, entry.status])
    ).toEqual([
      ["ability-boosts-level-1", "STR, DEX, CON, INT", "mapped"],
      ["ability-boosts-level-2", "WIS", "mapped"],
      ["ability-boosts-level-3", "CHA", "mapped"],
      ["ability-boosts-level-4", "STR", "mapped"],
      ["ability-boosts-level-5", "DEX", "mapped"],
      ["ability-boosts-level-7", "CON", "mapped"],
      ["ability-boosts-level-8", "INT", "mapped"],
    ]);
  });

  it("audits a complete level-3 witch familiar spellbook as matched", async () => {
    const history = await buildExistingCharacterHistory(witchActor(20));

    expect(spellAuditEntries(history.entries)).toEqual([
      expect.objectContaining({
        slotId: "spell-audit-witch-through-level-3",
        label: "Witch spell audit",
        value:
          "20 spells, which is what a level 3 character should have. The sheet does not record which level each spell was learned at.",
        status: "mapped",
      }),
    ]);
  });

  it("reports the exact deficit for a level-3 witch missing two familiar spells", async () => {
    const history = await buildExistingCharacterHistory(witchActor(18));
    const [audit] = spellAuditEntries(history.entries);

    expect(audit).toMatchObject({ status: "review" });
    expect(audit?.value).toContain("2 spells short. Found 18, expected 20 by level 3.");
    expect(audit?.value).toContain("Add them on the sheet, or rebuild through Wayfinder");
  });

  it("marks a feat-granted surplus spell for review without recommending deletion", async () => {
    const history = await buildExistingCharacterHistory(witchActor(21));
    const [audit] = spellAuditEntries(history.entries);

    expect(audit).toMatchObject({ status: "review" });
    expect(audit?.value).toContain("1 spell more than expected. Found 21, expected 20 by level 3.");
    expect(audit?.value).toContain("A feat or item probably granted it");
    expect(audit?.value).toContain("Do not delete anything on the strength of this count alone");
  });

  it("does not let an extra cantrip cancel a missing ranked spell", async () => {
    const actor = witchActor(20);
    const rankedSpell = actor.items.contents.find((item) => item.id === "witch-spell-16") as
      | { system?: { traits?: { value?: string[] } } }
      | undefined;
    if (rankedSpell?.system?.traits) {
      rankedSpell.system.traits.value = ["cantrip"];
    }

    const history = await buildExistingCharacterHistory(actor);
    const [audit] = spellAuditEntries(history.entries);

    expect(audit).toMatchObject({ status: "review" });
    expect(audit?.value).toContain("1 expected spell is missing, and 1 other spell does not fill those gaps");
  });

  it("refuses to guess between multiple plausible spellcasting destinations", async () => {
    const actor = witchActor(20);
    const entry = actor.items.contents.find((item) => item.id === "witch-entry");
    if (entry?.flags) {
      delete entry.flags["wayfinder-pf2e"];
    }
    (actor.items.contents as Array<Record<string, unknown>>).push({
      ...structuredClone(entry),
      id: "witch-entry-duplicate",
    });

    const history = await buildExistingCharacterHistory(actor);

    expect(spellAuditEntries(history.entries)).toEqual([
      expect.objectContaining({
        value: expect.stringContaining("multiple plausible destinations"),
        status: "review",
      }),
    ]);
  });

  it("marks Magus Studious Spells as an explicit audit boundary", async () => {
    const history = await buildExistingCharacterHistory({
      system: { details: { level: { value: 7 } } },
      items: {
        contents: [
          {
            ...actorItem("class-1", "class", "Magus", "Compendium.pf2e.classes.Item.magus"),
            system: { slug: "magus" },
          },
        ],
      },
    });

    expect(spellAuditEntries(history.entries)).toEqual([
      expect.objectContaining({
        value: expect.stringContaining("Magus Studious Spells"),
        status: "review",
      }),
    ]);
  });

  it("audits Sorcerer choices together with exact bloodline gifts", async () => {
    const actor = sorcererActor();
    const completeHistory = await buildExistingCharacterHistory(actor);
    expect(spellAuditEntries(completeHistory.entries)).toEqual([
      expect.objectContaining({
        value: expect.stringContaining("12 spells, which is what a level 3 character should have"),
        status: "mapped",
      }),
    ]);

    const gift = actor.items.contents.find((item) => item.id === "sorcerer-gift-rank-2");
    if (gift) {
      gift.name = "Entangling Flora";
      gift.flags = { core: { sourceId: "Compendium.pf2e.spells-srd.Item.entangling-flora" } };
    }
    const incorrectHistory = await buildExistingCharacterHistory(actor);
    expect(spellAuditEntries(incorrectHistory.entries)[0]?.value).toContain(
      "1 expected spell is missing, and 1 other spell does not fill those gaps"
    );
  });

  it("adds no spell audit entry for a non-caster", async () => {
    const history = await buildExistingCharacterHistory({
      system: { details: { level: { value: 3 } } },
      items: {
        contents: [actorItem("class-1", "class", "Fighter", "Compendium.pf2e.classes.Item.fighter")],
      },
    });

    expect(spellAuditEntries(history.entries)).toEqual([]);
  });

  it("marks a witch with no selected patron as unresolvable instead of assuming a total", async () => {
    const actor = witchActor(15);
    actor.items.contents = actor.items.contents.filter((item) => item.id !== "witch-patron");

    const history = await buildExistingCharacterHistory(actor);

    expect(spellAuditEntries(history.entries)).toEqual([
      expect.objectContaining({
        slotId: "spell-audit-witch-through-level-3",
        value:
          "Review required: Wayfinder cannot resolve the witch spell total because no patron is selected on the actor.",
        status: "review",
      }),
    ]);
  });

  it("marks an apparition-dependent animist profile as a single honest boundary", async () => {
    const history = await buildExistingCharacterHistory({
      system: { details: { level: { value: 3 } } },
      items: {
        contents: [
          {
            ...actorItem("class-1", "class", "Animist", "Compendium.pf2e.classes.Item.animist"),
            system: { slug: "animist", spellcasting: 2 },
          },
        ],
      },
    });

    expect(spellAuditEntries(history.entries)).toEqual([
      expect.objectContaining({
        value: expect.stringContaining("apparition spells are not fully represented"),
        status: "review",
      }),
    ]);
  });

  it("atomically clears acquisition state while preserving every non-equipment choice", async () => {
    const initialDraft = createEmptyDraft(7);
    initialDraft.acquisition = createAcquisitionDraft({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 7,
      recipe: { kind: "permanent-items" },
    });
    initialDraft.selections["class-feat-level-6"] = {
      slotId: "class-feat-level-6",
      packId: "pf2e.feats-srd",
      documentId: "representative-feat",
      uuid: "Compendium.pf2e.feats-srd.Item.representative-feat",
      itemType: "feat",
      featType: "class",
      name: "Representative Feat",
      level: 6,
    };
    initialDraft.manual["review-choice-level-7"] = true;
    initialDraft.equipmentPolicyRequests = [
      createEquipmentPolicyRequest({
        requestId: "request-1",
        facts: {
          kind: "higher-level-start",
          actorId: "actor-1",
          draftId: initialDraft.acquisition.draftId,
          targetLevel: 7,
          startKind: "replacement-character",
        },
        requesterUserId: "owner-1",
        requesterName: "Owner",
        requestedAt: "2026-08-21T12:00:00.000Z",
        reason: "Replacement character",
      }),
    ];
    const initialState = createEmptyState();
    const history = importedHistory();
    const actorSource = {
      flags: {
        [MODULE_ID]: {
          draft: structuredClone(initialDraft) as unknown,
          state: structuredClone(initialState) as unknown,
          sameModuleSibling: { retained: true, updateCount: 0 },
        },
        "other-module": { retained: true, updateCount: 0 },
      },
    };
    const actor = {
      getFlag: (scope: string, key: string) =>
        (actorSource.flags as Record<string, Record<string, unknown>>)[scope]?.[key],
      update: vi.fn(async (update: Record<string, unknown>, _operation?: Record<string, unknown>) => {
        actorSource.flags[MODULE_ID].sameModuleSibling = { retained: true, updateCount: 1 };
        actorSource.flags["other-module"] = { retained: true, updateCount: 1 };
        actorSource.flags[MODULE_ID].draft = structuredClone(readFoundryReplacement(update[DRAFT_FLAG]));
        actorSource.flags[MODULE_ID].state = structuredClone(readFoundryReplacement(update[STATE_FLAG]));
        return actor;
      }),
    };

    const result = await persistExistingCharacterImport({
      actor,
      currentLevel: 7,
      guard: new PersistedDraftWriteGuard(initialDraft),
      draft: initialDraft,
      state: initialState,
      history,
    });

    expect(actor.update).toHaveBeenCalledOnce();
    expect(actor.update.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ [DRAFT_FLAG]: expect.any(Object), [STATE_FLAG]: expect.any(Object) })
    );
    expect(actor.update.mock.calls[0]?.[1]).toMatchObject({ render: false });
    expect(actor.update.mock.calls[0]?.[1]).not.toHaveProperty("recursive");
    expect(isFoundryReplacement(actor.update.mock.calls[0]?.[0][DRAFT_FLAG])).toBe(true);
    expect(isFoundryReplacement(actor.update.mock.calls[0]?.[0][STATE_FLAG])).toBe(true);
    expect(result).toMatchObject({
      acquisition: null,
      acquisitionCorrupt: false,
      equipmentPolicyRequests: [],
      selections: initialDraft.selections,
      manual: initialDraft.manual,
    });
    expect(normalizeDraft(actor.getFlag(MODULE_ID, "draft"), 7)).toMatchObject({
      acquisition: null,
      acquisitionCorrupt: false,
      equipmentPolicyRequests: [],
      selections: initialDraft.selections,
      manual: initialDraft.manual,
    });
    expect(normalizeState(actor.getFlag(MODULE_ID, "state")).existingCharacterHistory).toEqual(history);
    expect(actorSource.flags[MODULE_ID].sameModuleSibling).toEqual({ retained: true, updateCount: 1 });
    expect(actorSource.flags["other-module"]).toEqual({ retained: true, updateCount: 1 });
  });

  it("blocks Apply without writes if a legacy mixed history and acquisition draft is reopened", async () => {
    const draft = createEmptyDraft(7);
    draft.acquisition = createAcquisitionDraft({
      draftId: "draft-legacy",
      batchId: "batch-legacy",
      manifestId: "manifest-legacy",
      targetLevel: 7,
      recipe: { kind: "lump-sum" },
    });
    const state = { ...createEmptyState(), existingCharacterHistory: importedHistory() };
    const beforeApply = vi.fn();
    const applyDraftToActor = vi.fn();

    expect(hasExecutableAcquisition(draft, state)).toBe(false);
    const result = await applyDraftLifecycle({
      actorName: "Imported Actor",
      currentLevel: 7,
      draft,
      steps: [],
      acquisitionExecutionAvailable: hasExecutableAcquisition(draft, state),
      evaluateStep: async () => ({ state: "complete", complete: true, status: "Complete", issue: null }),
      beforeApply,
      applyDraftToActor,
    });

    expect(result).toMatchObject({ kind: "warning", warning: "draft-not-ready" });
    expect(beforeApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });
});

function isFoundryReplacement(value: unknown): boolean {
  return readFoundryReplacement(value) !== value;
}

function readFoundryReplacement(value: unknown): unknown {
  return foundry.data.operators.ForcedReplacement.get(value);
}

function importedHistory(): ExistingCharacterHistory {
  return {
    version: 1,
    importedAt: "2026-08-21T12:30:00.000Z",
    actorLevel: 7,
    entries: [],
  };
}

function spellAuditEntries<T extends { slotId: string }>(entries: T[]): T[] {
  return entries.filter((entry) => entry.slotId.startsWith("spell-audit-"));
}

function witchActor(spellCount: number) {
  const entryId = "witch-entry";
  return {
    system: { details: { level: { value: 3 } } },
    items: {
      contents: [
        {
          ...actorItem("class-1", "class", "Witch", "Compendium.pf2e.classes.Item.witch"),
          system: { slug: "witch" },
        },
        {
          id: "witch-patron",
          type: "feat",
          name: "Spinner of Threads",
          flags: { core: { sourceId: "Compendium.pf2e.classfeatures.Item.spinner-of-threads" } },
          system: {
            category: "classfeature",
            traits: { otherTags: ["witch-patron"] },
            description: {
              value:
                "<p><strong>Spell List</strong> occult</p><p><strong>Initial Lesson</strong> Your familiar learns @UUID[Compendium.pf2e.spells-srd.Item.sure-strike]{Sure Strike}.</p>",
            },
          },
        },
        {
          id: entryId,
          type: "spellcastingEntry",
          name: "Occult Prepared Spells",
          flags: { "wayfinder-pf2e": { destinationKey: "witch-occult-prepared" } },
          system: {
            ability: { value: "int" },
            prepared: { value: "prepared" },
            tradition: { value: "occult" },
            slots: {
              slot0: {
                max: 5,
                value: 5,
                prepared: Array.from({ length: 5 }, () => ({ id: null, expended: false })),
              },
            },
          },
        },
        ...Array.from({ length: spellCount }, (_, index) => ({
          id: `witch-spell-${index + 1}`,
          type: "spell",
          name: index === 10 ? "Sure Strike" : `Witch Spell ${index + 1}`,
          ...(index === 10 ? { flags: { core: { sourceId: "Compendium.pf2e.spells-srd.Item.sure-strike" } } } : {}),
          ...(index >= 20 ? { flags: { pf2e: { grantedBy: { id: "bonus-feat" } } } } : {}),
          system: {
            level: { value: index < 18 ? 1 : 2 },
            location: { value: entryId },
            traits: { value: index < 10 ? ["cantrip"] : [] },
          },
        })),
      ],
    },
  };
}

function sorcererActor() {
  const entryId = "sorcerer-entry";
  const spell = (id: string, name: string, rank: number, cantrip = false, sourceId?: string) => ({
    id,
    type: "spell",
    name,
    flags: { core: { sourceId: sourceId ?? `Compendium.pf2e.spells-srd.Item.${id}` } },
    system: {
      level: { value: rank },
      location: { value: entryId },
      traits: { value: cantrip ? ["cantrip"] : [] },
    },
  });
  return {
    system: { details: { level: { value: 3 } } },
    items: {
      contents: [
        {
          ...actorItem("class-1", "class", "Sorcerer", "Compendium.pf2e.classes.Item.sorcerer"),
          system: { slug: "sorcerer" },
        },
        {
          id: "imperial-bloodline",
          type: "feat",
          name: "Bloodline: Imperial",
          flags: { core: { sourceId: "Compendium.pf2e.classfeatures.Item.imperial-bloodline" } },
          system: {
            category: "classfeature",
            traits: { otherTags: ["sorcerer-bloodline"] },
            description: {
              value:
                "<p><strong>Tradition</strong> arcane</p><p><strong>Sorcerous Gifts</strong> cantrip @UUID[Compendium.pf2e.spells-srd.Item.detect-magic]{Detect Magic}; 1st: @UUID[Compendium.pf2e.spells-srd.Item.force-barrage]{Force Barrage}; 2nd: @UUID[Compendium.pf2e.spells-srd.Item.dispel-magic]{Dispel Magic}</p>",
            },
          },
        },
        {
          id: entryId,
          type: "spellcastingEntry",
          name: "Arcane Spontaneous Spells",
          flags: { "wayfinder-pf2e": { destinationKey: "sorcerer-arcane-spontaneous" } },
          system: {
            ability: { value: "cha" },
            prepared: { value: "spontaneous" },
            tradition: { value: "arcane" },
          },
        },
        spell("sorcerer-gift-cantrip", "Detect Magic", 0, true, "Compendium.pf2e.spells-srd.Item.detect-magic"),
        ...Array.from({ length: 4 }, (_, index) => spell(`sorcerer-cantrip-${index}`, `Cantrip ${index}`, 0, true)),
        spell("sorcerer-gift-rank-1", "Force Barrage", 1, false, "Compendium.pf2e.spells-srd.Item.force-barrage"),
        ...Array.from({ length: 3 }, (_, index) => spell(`sorcerer-rank-1-${index}`, `Rank 1 Spell ${index}`, 1)),
        spell("sorcerer-gift-rank-2", "Dispel Magic", 2, false, "Compendium.pf2e.spells-srd.Item.dispel-magic"),
        ...Array.from({ length: 2 }, (_, index) => spell(`sorcerer-rank-2-${index}`, `Rank 2 Spell ${index}`, 2)),
      ],
    },
  };
}

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
