import { describe, expect, it, vi } from "vitest";
import {
  nativeSpellcastingSourceSelections,
  syncNativeClassSpellcasting,
} from "../src/actor-updater/native-spellcasting-application";
import { spellLocationId } from "../src/actor-updater/spellcasting-entry-support";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { ActorItemLike, EmbeddedItemSource } from "../src/shared/actor-model";
import type { SelectionRef } from "../src/types";
import { SLOT_IDS } from "../src/wayfinder/slot-ids";
import { buildActorHarness } from "./support/actor-updater-fixtures";

const MARK_UUID = "Compendium.pf2e.spells-srd.Item.LegaamqrflbArbWN";
const VINDICATOR_UUID = "Compendium.pf2e.classfeatures.Item.QOOwC3S41CKGkxlN";
const DESTINATION_KEY = "vindicator-divine-focus";
const ranger = { id: "ranger", type: "class", name: "Ranger", system: { slug: "ranger" } };

function draftVindicator(level = 1) {
  const draft = createEmptyDraft(level);
  draft.classArchetypeChoices["class-archetype-hunters-edge-level-1"] = "vindicator";
  return draft;
}

function sourceFactory() {
  return vi.fn(
    async (selection: SelectionRef): Promise<EmbeddedItemSource> => ({
      name: selection.name,
      type: "spell",
      system: { level: { value: 1 }, traits: { value: ["attack", "focus", "sanctified"] } },
      flags: { core: { sourceId: selection.uuid }, [MODULE_ID]: { slotId: selection.slotId } },
    })
  );
}

function entry(id: string, tradition = "divine", ability = "wis"): ActorItemLike {
  return {
    id,
    type: "spellcastingEntry",
    name: "My own focus entry",
    system: {
      prepared: { value: "focus" },
      tradition: { value: tradition },
      ability: { value: ability },
      publication: { title: "User notes" },
    },
    flags: { notes: "preserve" },
  };
}

function mark(location: string): ActorItemLike {
  return {
    id: "mark",
    name: "Vindicator's Mark",
    type: "spell",
    sourceId: MARK_UUID,
    system: { location: { value: location }, traits: { value: ["focus", "attack"] } },
  };
}

describe("Vindicator native spellcasting", () => {
  it("preflights the automatic Mark for drafted and retained profiles without a picker selection", () => {
    const { actor } = buildActorHarness({ items: [ranger] });
    expect(nativeSpellcastingSourceSelections(actor, draftVindicator())).toEqual([
      expect.objectContaining({ uuid: MARK_UUID, itemType: "spell" }),
    ]);
    actor.items.contents.push({ id: "vindicator", type: "feat", sourceId: VINDICATOR_UUID });
    expect(nativeSpellcastingSourceSelections(actor, createEmptyDraft(5))).toEqual([
      expect.objectContaining({ uuid: MARK_UUID }),
    ]);
    actor.items.contents = [ranger];
    const blankDraft = draftVindicator();
    blankDraft.selections[SLOT_IDS.class] = { itemType: "class", slug: "ranger", name: "Ranger" } as SelectionRef;
    expect(nativeSpellcastingSourceSelections({ items: [] }, blankDraft)).toHaveLength(1);
  });

  it("leaves standard rangers and unrelated classes untouched", async () => {
    const factory = sourceFactory();
    const { actor } = buildActorHarness({ items: [ranger] });
    expect(nativeSpellcastingSourceSelections(actor, createEmptyDraft(1))).toEqual([]);
    await syncNativeClassSpellcasting(actor, createEmptyDraft(1), factory);
    actor.items.contents[0] = { id: "fighter", type: "class", system: { slug: "fighter" } };
    await syncNativeClassSpellcasting(actor, draftVindicator(), factory);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not use retained Vindicator sources when the draft explicitly chooses Standard", async () => {
    const { actor } = buildActorHarness({
      items: [ranger, { id: "vindicator", type: "feat", sourceId: VINDICATOR_UUID }],
    });
    const draft = draftVindicator();
    draft.classArchetypeChoices["class-archetype-hunters-edge-level-1"] = "standard";
    const factory = sourceFactory();
    expect(nativeSpellcastingSourceSelections(actor, draft)).toEqual([]);
    await syncNativeClassSpellcasting(actor, draft, factory);
    expect(factory).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it.each([1, 5])("creates one divine Wisdom focus entry and Mark for a level-%s draft", async (level) => {
    const { actor } = buildActorHarness({ items: [ranger] });
    const draft = draftVindicator(level);
    const factory = sourceFactory();
    await syncNativeClassSpellcasting(actor, draft, factory);
    const createdEntry = actor.items.contents.find((item) => item.type === "spellcastingEntry");
    const createdMark = actor.items.contents.find((item) => item.type === "spell");
    expect(createdEntry).toMatchObject({
      system: {
        ability: { value: "wis" },
        tradition: { value: "divine" },
        prepared: { value: "focus" },
        proficiency: { value: 1 },
        slots: {},
        publication: { title: "Pathfinder War of Immortals", license: "ORC", remaster: true },
      },
      flags: { [MODULE_ID]: { destinationKey: DESTINATION_KEY, generatedSpellcastingEntry: 1 } },
    });
    expect(createdMark).toMatchObject({
      sourceId: MARK_UUID,
      system: { traits: { value: ["attack", "focus", "sanctified"] } },
    });
    expect(spellLocationId(createdMark!)).toBe(createdEntry?.id);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ uuid: MARK_UUID }), draft);
  });

  it("preserves one Mark across both apply phases, advancement, and a clean rerun without refilling focus", async () => {
    const { actor } = buildActorHarness({ items: [ranger] });
    actor.system!.resources = { focus: { value: 0, max: 1, cap: 3 } };
    const factory = sourceFactory();
    await syncNativeClassSpellcasting(actor, draftVindicator(), factory);
    await syncNativeClassSpellcasting(actor, draftVindicator(), factory);
    await syncNativeClassSpellcasting(actor, draftVindicator(5), factory);
    await syncNativeClassSpellcasting(actor, draftVindicator(5), factory);
    expect(actor.items.contents.filter((item) => item.type === "spellcastingEntry")).toHaveLength(1);
    expect(actor.items.contents.filter((item) => item.type === "spell")).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(actor.system!.resources).toEqual({ focus: { value: 0, max: 1, cap: 3 } });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("reuses a compatible user entry and existing Mark without changing either", async () => {
    const userEntry = entry("user-entry");
    const existingMark = mark("user-entry");
    const { actor } = buildActorHarness({ items: [ranger, userEntry, existingMark] });
    const before = structuredClone(actor.items.contents);
    const factory = sourceFactory();
    await syncNativeClassSpellcasting(actor, draftVindicator(), factory);
    expect(actor.items.contents).toEqual(before);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("moves existing Mark and ranger focus spells out of incompatible entries without changing unrelated spells", async () => {
    const primalEntry = entry("primal", "primal");
    const warden: ActorItemLike = {
      id: "gravity-weapon",
      type: "spell",
      system: { location: { value: "primal", ...{ signature: true } }, traits: { value: ["focus", "ranger"] } },
    };
    const unrelated: ActorItemLike = {
      id: "druid-spell",
      type: "spell",
      system: { location: { value: "primal" }, traits: { value: ["focus", "druid"] } },
    };
    const { actor } = buildActorHarness({ items: [ranger, primalEntry, mark("primal"), warden, unrelated] });
    const factory = sourceFactory();
    await syncNativeClassSpellcasting(actor, draftVindicator(5), factory);
    const vindicatorEntry = actor.items.contents.find(
      (item) => item.flags?.[MODULE_ID]?.destinationKey === DESTINATION_KEY
    );
    expect(spellLocationId(actor.items.contents.find((item) => item.id === "mark")!)).toBe(vindicatorEntry?.id);
    expect(warden.system!.location).toEqual({ value: vindicatorEntry?.id, signature: true });
    expect(spellLocationId(unrelated)).toBe("primal");
    expect(primalEntry).toEqual(entry("primal", "primal"));
    expect(factory).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("keeps other warden spells in compatible custom entries", async () => {
    const custom = entry("custom");
    const warden: ActorItemLike = {
      id: "gravity-weapon",
      type: "spell",
      system: { location: { value: "custom" }, traits: { value: ["focus", "ranger"] } },
    };
    const { actor } = buildActorHarness({ items: [ranger, custom, warden] });
    await syncNativeClassSpellcasting(actor, draftVindicator(5), sourceFactory());
    expect(spellLocationId(warden)).toBe("custom");
    expect(custom).toEqual(entry("custom"));
  });

  it.each([
    "Mark",
    "managed entry",
  ])("rejects ambiguous %s sources during preflight and apply before mutation", async (kind) => {
    const duplicates: ActorItemLike[] =
      kind === "Mark"
        ? [mark("focus"), { ...mark("focus"), id: "duplicate-mark" }]
        : ["focus-one", "focus-two"].map((id) => ({
            ...entry(id),
            flags: { [MODULE_ID]: { destinationKey: DESTINATION_KEY } },
          }));
    const { actor } = buildActorHarness({ items: [ranger, ...duplicates] });
    const factory = sourceFactory();
    expect(() => nativeSpellcastingSourceSelections(actor, draftVindicator())).toThrow(/duplicate/);
    await expect(syncNativeClassSpellcasting(actor, draftVindicator(), factory)).rejects.toThrow(/duplicate/);
    expect(factory).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects a missing prepared Mark source without leaving an empty entry", async () => {
    const { actor } = buildActorHarness({ items: [ranger] });
    await expect(
      syncNativeClassSpellcasting(
        actor,
        draftVindicator(),
        vi.fn(async () => null)
      )
    ).rejects.toThrow(/Mark source is unavailable/);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("reports rejected Mark creation instead of silently claiming completion", async () => {
    const { actor } = buildActorHarness({ items: [ranger, entry("focus"), mark("focus")] });
    actor.items.contents = actor.items.contents.filter((item) => item.id !== "mark");
    actor.items.contents[1].flags = { [MODULE_ID]: { destinationKey: DESTINATION_KEY } };
    actor.createEmbeddedDocuments.mockResolvedValueOnce([]);
    await expect(syncNativeClassSpellcasting(actor, draftVindicator(), sourceFactory())).rejects.toThrow(
      /Mark was not created/
    );
  });
});
