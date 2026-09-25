import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import type { ActorItemLike, ActorLike, EmbeddedItemSource } from "../shared/actor-model.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, SelectionRef } from "../types.js";
import { hasVindicatorProfile } from "../wayfinder/class-archetype/vindicator.js";
import { spellLocationId, syncSpellcastingEntry } from "./spellcasting-entry-support.js";

const VINDICATOR_MARK_UUID = "Compendium.pf2e.spells-srd.Item.LegaamqrflbArbWN";
const DESTINATION_KEY = "vindicator-divine-focus";

type SpellSourceFactory = (selection: SelectionRef, draft?: DraftState) => Promise<EmbeddedItemSource | null>;

export function vindicatorSpellcastingSourceSelections(actor: ActorLike, draft: DraftState): SelectionRef[] {
  const items = listActorItems(actor) as ActorItemLike[];
  if (!hasVindicatorProfile(draft, items)) return [];
  assertUnambiguousVindicatorSpellcasting(items);

  return [
    {
      slotId: "vindicator-focus-spell-mark",
      packId: "pf2e.spells-srd",
      documentId: "LegaamqrflbArbWN",
      uuid: VINDICATOR_MARK_UUID,
      itemType: "spell",
      featType: null,
      name: "Vindicator's Mark",
      level: 1,
      slug: "vindicators-mark",
    },
  ];
}

export async function syncVindicatorSpellcasting(
  actor: ActorLike,
  draft: DraftState,
  sourceFactory: SpellSourceFactory
): Promise<void> {
  const [selection] = vindicatorSpellcastingSourceSelections(actor, draft);
  if (!selection) return;

  const spells = (listActorItems(actor) as ActorItemLike[]).filter((item) => item.type === "spell");
  const existingMark = spells.find((spell) => itemMatchesSourceId(spell, VINDICATOR_MARK_UUID));
  // Resolve the prepared source before creating an entry. Never fall back to a live pack read here.
  const source = existingMark ? null : await sourceFactory(selection, draft);
  if (!existingMark && !source) {
    throw new Error("Cannot prepare Vindicator spellcasting: Vindicator's Mark source is unavailable.");
  }

  const entry = await ensureVindicatorEntry(actor, existingMark);
  if (!entry?.id) throw new Error("Cannot prepare Vindicator spellcasting: its focus entry was not created.");

  if (source) {
    source.system ??= {};
    source.system.location = { value: entry.id };
    source.flags ??= {};
    source.flags[MODULE_ID] = {
      ...source.flags[MODULE_ID],
      importedBy: MODULE_ID,
      destinationKey: DESTINATION_KEY,
    };
    const created = (await actor.createEmbeddedDocuments?.("Item", [source])) ?? [];
    if (created.length !== 1 || !created[0]?.id || !itemMatchesSourceId(created[0], VINDICATOR_MARK_UUID)) {
      throw new Error("Cannot prepare Vindicator spellcasting: Vindicator's Mark was not created.");
    }
  }

  const entries = (listActorItems(actor) as ActorItemLike[]).filter((item) => item.type === "spellcastingEntry");
  const updates = spells.flatMap((spell) => {
    if (!isVindicatorWardenSpell(spell)) return [];
    const currentEntry = entries.find((candidate) => candidate.id === spellLocationId(spell));
    // Keep compatible actor/user entries and their spell organization intact.
    if (currentEntry && isDivineWisdomFocusEntry(currentEntry)) return [];
    const location = typeof spell.system?.location === "object" ? spell.system.location : {};
    return spell.id ? [{ _id: spell.id, "system.location": { ...location, value: entry.id } }] : [];
  });
  if (updates.length > 0) await actor.updateEmbeddedDocuments?.("Item", updates);

  // PF2E derives focus.max from non-cantrip focus spells. Do not duplicate that rule or refill spent points.
}

function assertUnambiguousVindicatorSpellcasting(items: ActorItemLike[]): void {
  if (items.filter((item) => item.type === "spell" && itemMatchesSourceId(item, VINDICATOR_MARK_UUID)).length > 1) {
    throw new Error("Cannot prepare Vindicator spellcasting: duplicate Vindicator's Mark spells exist.");
  }
  if (
    items.filter(
      (item) => item.type === "spellcastingEntry" && item.flags?.[MODULE_ID]?.destinationKey === DESTINATION_KEY
    ).length > 1
  ) {
    throw new Error("Cannot prepare Vindicator spellcasting: duplicate managed focus entries exist.");
  }
}

async function ensureVindicatorEntry(actor: ActorLike, mark: ActorItemLike | undefined): Promise<ActorItemLike | null> {
  const entries = (listActorItems(actor) as ActorItemLike[]).filter((item) => item.type === "spellcastingEntry");
  const managed = entries.find((item) => item.flags?.[MODULE_ID]?.destinationKey === DESTINATION_KEY);
  const desiredSource = createVindicatorEntrySource();
  if (managed?.id) {
    await syncSpellcastingEntry(actor, managed, { ...desiredSource, name: managed.name ?? desiredSource.name });
    return managed;
  }

  const existing = entries.find((item) => item.id === (mark ? spellLocationId(mark) : null));
  if (existing && isDivineWisdomFocusEntry(existing)) return existing;

  const [created] = (await actor.createEmbeddedDocuments?.("Item", [desiredSource])) ?? [];
  return created ?? null;
}

function isDivineWisdomFocusEntry(item: ActorItemLike): boolean {
  return (
    item.type === "spellcastingEntry" &&
    item.system?.prepared?.value === "focus" &&
    item.system?.tradition?.value === "divine" &&
    item.system?.ability?.value === "wis"
  );
}

function isVindicatorWardenSpell(item: ActorItemLike): boolean {
  const traits = item.system?.traits?.value;
  return (
    itemMatchesSourceId(item, VINDICATOR_MARK_UUID) ||
    (Array.isArray(traits) && traits.includes("focus") && traits.includes("ranger"))
  );
}

function createVindicatorEntrySource(): EmbeddedItemSource {
  return {
    name: "Vindicator Warden Spells",
    type: "spellcastingEntry",
    img: "modules/wayfinder-pf2e/assets/wayfinder-entry.svg",
    system: {
      ability: { value: "wis" },
      autoHeightenLevel: { value: null },
      description: { value: "" },
      prepared: { value: "focus", flexible: false },
      proficiency: { slug: "", value: 1 },
      publication: { title: "Pathfinder War of Immortals", authors: "", license: "ORC", remaster: true },
      rules: [],
      showSlotlessLevels: { value: true },
      slots: {},
      slug: null,
      spelldc: { dc: 0, value: 0 },
      tradition: { value: "divine" },
      traits: {},
    },
    flags: {
      [MODULE_ID]: { importedBy: MODULE_ID, destinationKey: DESTINATION_KEY, generatedSpellcastingEntry: 1 },
    },
  };
}
