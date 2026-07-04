import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import type {
  ActorItemLike,
  ActorLike,
  EmbeddedItemSource,
  PreparedSlotLike,
  SpellSlotGroupLike,
} from "../shared/actor-model.js";
import { slugifyName } from "../shared/slug.js";
import { findSpellcastingEntryForChoice, wizardMaxSpellRank } from "../shared/spellcasting.js";
import type { DraftState, PendingStep } from "../types.js";
import { SLOT_IDS } from "../wayfinder/slot-ids.js";

export async function ensureSpellcastingEntry(
  actor: ActorLike,
  step: PendingStep,
  draft: DraftState
): Promise<ActorItemLike | null> {
  const spellChoice = step.spellChoice;
  if (!spellChoice) {
    return null;
  }

  const desiredSource = createSpellcastingEntrySource(spellChoice, actor, draft);
  const existing = findSpellcastingEntryForChoice(actor, spellChoice) as ActorItemLike | null;
  if (existing?.id) {
    await syncSpellcastingEntry(actor, existing, desiredSource);
    return existing;
  }

  const [created] =
    typeof actor.createEmbeddedDocuments === "function"
      ? await actor.createEmbeddedDocuments("Item", [desiredSource])
      : [];
  return created ?? null;
}

export async function ensureSpellcastingEntryFromSource(
  actor: ActorLike,
  desiredSource: EmbeddedItemSource,
  options: {
    destinationKey: string;
    matches: (item: ActorItemLike) => boolean;
  }
): Promise<ActorItemLike | null> {
  const existing =
    (listActorItems(actor) as ActorItemLike[]).find(
      (item) =>
        item?.type === "spellcastingEntry" && item?.flags?.[MODULE_ID]?.destinationKey === options.destinationKey
    ) ?? (listActorItems(actor) as ActorItemLike[]).find(options.matches);
  if (existing?.id) {
    await syncSpellcastingEntry(actor, existing, desiredSource);
    return existing;
  }

  const [created] =
    typeof actor.createEmbeddedDocuments === "function"
      ? await actor.createEmbeddedDocuments("Item", [desiredSource])
      : [];
  return created ?? null;
}

export function createSpellcastingEntrySource(
  spellChoice: NonNullable<PendingStep["spellChoice"]>,
  actor: ActorLike,
  draft: DraftState
): EmbeddedItemSource {
  return {
    name: spellChoice.destination.entryName,
    type: "spellcastingEntry",
    img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
    system: {
      ability: {
        value: spellChoice.destination.ability,
      },
      autoHeightenLevel: {
        value: null,
      },
      description: {
        value: "",
      },
      prepared: {
        flexible: false,
        value: spellChoice.destination.prepared,
      },
      proficiency: {
        slug: "",
        value: 1,
      },
      publication: {
        license: "ORC",
        remaster: true,
        title: "",
      },
      rules: [],
      showSlotlessLevels: {
        value: true,
      },
      slots: buildSpellcastingEntrySlots(spellChoice, actor, draft),
      slug: null,
      spelldc: {
        dc: 0,
        value: 0,
      },
      tradition: {
        value: spellChoice.destination.tradition,
      },
      traits: {},
    },
    flags: {
      [MODULE_ID]: {
        importedBy: MODULE_ID,
        destinationKey: spellChoice.destination.key,
      },
    },
  };
}

export function createClericPreparedEntrySource(actor: ActorLike, draft: DraftState): EmbeddedItemSource {
  return {
    name: "Divine Prepared Spells",
    type: "spellcastingEntry",
    img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
    system: {
      ability: {
        value: "wis",
      },
      autoHeightenLevel: {
        value: null,
      },
      description: {
        value: "",
      },
      prepared: {
        flexible: false,
        value: "prepared",
      },
      proficiency: {
        slug: "",
        value: 1,
      },
      publication: {
        license: "ORC",
        remaster: true,
        title: "",
      },
      rules: [],
      showSlotlessLevels: {
        value: true,
      },
      slots: buildClericPreparedSlots(actor, draft),
      slug: null,
      spelldc: {
        dc: 0,
        value: 0,
      },
      tradition: {
        value: "divine",
      },
      traits: {},
    },
    flags: {
      [MODULE_ID]: {
        importedBy: MODULE_ID,
        destinationKey: "cleric-divine-prepared",
      },
    },
  };
}

export function createClericFontEntrySource(
  actor: ActorLike,
  draft: DraftState,
  divineFont: "heal" | "harm",
  spellId: string | null = null
): EmbeddedItemSource {
  const entryName = divineFont === "heal" ? "Divine Font (Healing)" : "Divine Font (Harmful)";
  const destinationKey = `cleric-divine-font-${divineFont}`;
  return {
    name: entryName,
    type: "spellcastingEntry",
    img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
    system: {
      ability: {
        value: "wis",
      },
      autoHeightenLevel: {
        value: null,
      },
      description: {
        value: "",
      },
      prepared: {
        flexible: false,
        value: "prepared",
      },
      proficiency: {
        slug: "",
        value: 1,
      },
      publication: {
        license: "ORC",
        remaster: true,
        title: "",
      },
      rules: [],
      showSlotlessLevels: {
        value: false,
      },
      slots: buildClericFontSlots(actor, draft, spellId),
      slug: null,
      spelldc: {
        dc: 0,
        value: 0,
      },
      tradition: {
        value: "divine",
      },
      traits: {},
    },
    flags: {
      [MODULE_ID]: {
        importedBy: MODULE_ID,
        destinationKey,
      },
    },
  };
}

export async function syncSpellcastingEntry(
  actor: ActorLike,
  entry: ActorItemLike,
  desiredSource: EmbeddedItemSource
): Promise<void> {
  if (!entry?.id || typeof actor?.updateEmbeddedDocuments !== "function") {
    return;
  }

  const desiredSystem = desiredSource.system ?? {};
  const desiredFlags = desiredSource.flags ?? {};
  const mergedSlots = mergeSpellcastingEntrySlots(entry?.system?.slots, desiredSystem.slots ?? {});
  await actor.updateEmbeddedDocuments("Item", [
    {
      _id: entry.id,
      "system.ability.value": desiredSystem.ability?.value ?? "",
      "system.prepared.flexible": desiredSystem.prepared?.flexible ?? false,
      "system.prepared.value": desiredSystem.prepared?.value ?? "",
      "system.showSlotlessLevels.value": desiredSystem.showSlotlessLevels?.value ?? true,
      "system.slots": mergedSlots,
      "system.tradition.value": desiredSystem.tradition?.value ?? "",
      [`flags.${MODULE_ID}.destinationKey`]: desiredFlags?.[MODULE_ID]?.destinationKey ?? null,
      [`flags.${MODULE_ID}.importedBy`]: desiredFlags?.[MODULE_ID]?.importedBy ?? MODULE_ID,
    },
  ]);
  entry.system ??= {};
  entry.system.slots = mergedSlots;
}

export function spellLocationId(item: ActorItemLike): string | null {
  const locationSource = item?.system?.location;
  const location =
    typeof locationSource === "object" && locationSource !== null && typeof locationSource.value === "string"
      ? locationSource.value
      : typeof locationSource === "string"
        ? locationSource
        : null;
  return location && location.length > 0 ? location : null;
}

function buildSpellcastingEntrySlots(
  spellChoice: NonNullable<PendingStep["spellChoice"]>,
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  if (spellChoice.destination.key === "wizard-arcane-prepared") {
    return buildWizardSpellcastingSlots(actor, draft);
  }

  if (spellChoice.destination.key === "cleric-divine-prepared") {
    return buildClericPreparedSlots(actor, draft);
  }

  if (spellChoice.destination.key === "magus-arcane-prepared") {
    return buildMagusPreparedSlots(actor, draft);
  }

  if (spellChoice.destination.key === "animist-divine-prepared") {
    return buildAnimistPreparedSlots(actor, draft);
  }

  if (spellChoice.destination.type === "spontaneous") {
    return buildSpontaneousSpellcastingSlots(actor, draft);
  }

  if (spellChoice.destination.type === "prepared") {
    return buildFullPreparedSpellcastingSlots(actor, draft);
  }

  return {};
}

function buildSpontaneousSpellcastingSlots(
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
  const maxRank = wizardMaxSpellRank(currentLevel);
  const slots: Record<
    string,
    {
      max: number;
      value: number;
      prepared: Array<{ id: string | null; expended: boolean }>;
    }
  > = {
    slot0: makePreparedSlotGroup(5),
  };

  for (let rank = 1; rank <= maxRank; rank += 1) {
    slots[`slot${rank}`] = makePreparedSlotGroup(3);
  }

  return slots;
}

function buildClericPreparedSlots(
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  return buildFullPreparedSpellcastingSlots(actor, draft);
}

function buildFullPreparedSpellcastingSlots(
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
  const maxRank = wizardMaxSpellRank(currentLevel);
  const fullRanks = Math.floor(currentLevel / 2);
  const slots: Record<
    string,
    {
      max: number;
      value: number;
      prepared: Array<{ id: string | null; expended: boolean }>;
    }
  > = {
    slot0: makePreparedSlotGroup(5),
  };

  for (let rank = 1; rank <= maxRank; rank += 1) {
    slots[`slot${rank}`] = makePreparedSlotGroup(rank <= fullRanks ? 3 : 2);
  }

  return slots;
}

function buildAnimistPreparedSlots(
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
  const maxRank = wizardMaxSpellRank(currentLevel);
  const slots: Record<
    string,
    {
      max: number;
      value: number;
      prepared: Array<{ id: string | null; expended: boolean }>;
    }
  > = {
    slot0: makePreparedSlotGroup(2),
  };

  for (let rank = 1; rank <= maxRank; rank += 1) {
    slots[`slot${rank}`] = makePreparedSlotGroup(currentLevel >= rank * 2 ? 2 : 1);
  }

  return slots;
}

function buildMagusPreparedSlots(
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
  const maxRank = wizardMaxSpellRank(currentLevel);
  const slots: Record<
    string,
    {
      max: number;
      value: number;
      prepared: Array<{ id: string | null; expended: boolean }>;
    }
  > = {
    slot0: makePreparedSlotGroup(5),
  };

  if (maxRank <= 1) {
    slots.slot1 = makePreparedSlotGroup(currentLevel >= 2 ? 2 : 1);
    return slots;
  }

  slots[`slot${maxRank - 1}`] = makePreparedSlotGroup(2);
  slots[`slot${maxRank}`] = makePreparedSlotGroup(2);
  return slots;
}

function buildClericFontSlots(
  actor: ActorLike,
  draft: DraftState,
  spellId: string | null
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
  const maxRank = wizardMaxSpellRank(currentLevel);
  const slotCount = currentLevel >= 15 ? 6 : currentLevel >= 5 ? 5 : 4;

  return {
    [`slot${maxRank}`]: makePreparedSlotGroup(slotCount, spellId),
  };
}

function buildWizardSpellcastingSlots(
  actor: ActorLike,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
  const maxRank = wizardMaxSpellRank(currentLevel);
  const schoolName = getEffectiveWizardSchoolName(actor, draft);
  const hasCurriculum = !isUnifiedMagicalTheorySchool(schoolName);
  const cantripSlots = hasCurriculum ? 6 : 5;
  const rankSlots = hasCurriculum ? 3 : 2;
  const slots: Record<
    string,
    {
      max: number;
      value: number;
      prepared: Array<{ id: string | null; expended: boolean }>;
    }
  > = {};

  slots.slot0 = makePreparedSlotGroup(cantripSlots);
  for (let rank = 1; rank <= maxRank; rank += 1) {
    slots[`slot${rank}`] = makePreparedSlotGroup(rankSlots);
  }

  return slots;
}

function makePreparedSlotGroup(
  count: number,
  spellId: string | null = null
): {
  max: number;
  value: number;
  prepared: Array<{ id: string | null; expended: boolean }>;
} {
  return {
    max: count,
    value: count,
    prepared: Array.from({ length: count }, () => ({ id: spellId, expended: false })),
  };
}

function mergeSpellcastingEntrySlots(
  existingSlots: Record<string, SpellSlotGroupLike> | null | undefined,
  desiredSlots: Record<string, SpellSlotGroupLike>
) {
  const merged: Record<string, SpellSlotGroupLike> = {};

  for (const [slotKey, desiredGroup] of Object.entries(desiredSlots ?? {})) {
    const desiredMax = Number(desiredGroup?.max ?? 0);
    const existingGroup = existingSlots?.[slotKey];
    const existingMax = Number(existingGroup?.max ?? 0);
    const existingPrepared = Array.isArray(existingGroup?.prepared) ? existingGroup.prepared : [];
    const desiredPreparedSlots = Array.isArray(desiredGroup?.prepared) ? desiredGroup.prepared : [];
    const mergedPrepared = Array.from({ length: desiredMax }, (_, index): PreparedSlotLike => {
      const slot = existingPrepared[index];
      const desiredSlot = desiredPreparedSlots[index];
      const desiredId = typeof desiredSlot?.id === "string" ? desiredSlot.id : undefined;
      const existingId = typeof slot?.id === "string" || slot?.id === null ? slot.id : null;
      return {
        id: desiredId === undefined ? existingId : desiredId,
        expended:
          desiredId === undefined
            ? Boolean(slot?.expended)
            : desiredId === existingId
              ? Boolean(slot?.expended)
              : false,
      };
    });

    merged[slotKey] = {
      max: desiredMax,
      value: Math.min(
        desiredMax,
        Math.max(
          0,
          existingMax < desiredMax ? desiredMax : Number(existingGroup?.value ?? desiredGroup?.value ?? desiredMax) || 0
        )
      ),
      prepared: mergedPrepared,
    };
  }

  return merged;
}

function getEffectiveWizardSchoolName(actor: ActorLike, draft: DraftState): string | null {
  const createdSchool = (listActorItems(actor) as ActorItemLike[]).find(
    (item) => item?.flags?.[MODULE_ID]?.slotId === SLOT_IDS.wizardArcaneSchool
  );
  if (typeof createdSchool?.name === "string" && createdSchool.name.trim()) {
    return createdSchool.name;
  }

  const draftedSchool = draft.branchSelections[SLOT_IDS.wizardArcaneSchool];
  return typeof draftedSchool?.name === "string" && draftedSchool.name.trim() ? draftedSchool.name : null;
}

function isUnifiedMagicalTheorySchool(name: string | null): boolean {
  return slugifyName(name) === "school-of-unified-magical-theory";
}
