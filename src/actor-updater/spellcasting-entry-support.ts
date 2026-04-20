import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { slugifyName } from "../shared/slug.js";
import { findSpellcastingEntryForChoice, wizardMaxSpellRank } from "../shared/spellcasting.js";
import type { DraftState, PendingStep } from "../types.js";
import { SLOT_IDS } from "../wayfinder/slot-ids.js";

export async function ensureSpellcastingEntry(actor: any, step: PendingStep, draft: DraftState): Promise<any | null> {
  const spellChoice = step.spellChoice;
  if (!spellChoice) {
    return null;
  }

  const desiredSource = createSpellcastingEntrySource(spellChoice, actor, draft);
  const existing = findSpellcastingEntryForChoice(actor, spellChoice);
  if (existing?.id) {
    if (spellChoice.destination.type !== "prepared") {
      await syncSpellcastingEntry(actor, existing, desiredSource);
    }
    return existing;
  }

  const [created] = await actor.createEmbeddedDocuments("Item", [desiredSource]);
  return created ?? null;
}

export async function ensureSpellcastingEntryFromSource(
  actor: any,
  desiredSource: Record<string, unknown>,
  options: {
    destinationKey: string;
    matches: (item: any) => boolean;
  }
): Promise<any | null> {
  const existing =
    listActorItems(actor).find(
      (item: any) =>
        item?.type === "spellcastingEntry" && item?.flags?.[MODULE_ID]?.destinationKey === options.destinationKey
    ) ?? listActorItems(actor).find(options.matches);
  if (existing?.id) {
    await syncSpellcastingEntry(actor, existing, desiredSource);
    return existing;
  }

  const [created] = await actor.createEmbeddedDocuments("Item", [desiredSource]);
  return created ?? null;
}

export function createSpellcastingEntrySource(
  spellChoice: NonNullable<PendingStep["spellChoice"]>,
  actor: any,
  draft: DraftState
): Record<string, unknown> {
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

export function createClericPreparedEntrySource(actor: any, draft: DraftState): Record<string, unknown> {
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
  actor: any,
  draft: DraftState,
  divineFont: "heal" | "harm",
  spellId: string | null = null
): Record<string, unknown> {
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
  actor: any,
  entry: any,
  desiredSource: Record<string, unknown>
): Promise<void> {
  if (!entry?.id || typeof actor?.updateEmbeddedDocuments !== "function") {
    return;
  }

  const desiredSystem = desiredSource.system as Record<string, any>;
  const desiredFlags = desiredSource.flags as Record<string, any>;
  const mergedSlots = mergeSpellcastingEntrySlots(entry?.system?.slots, desiredSystem.slots);
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

export function spellLocationId(item: any): string | null {
  const location =
    typeof item?.system?.location?.value === "string"
      ? item.system.location.value
      : typeof item?.system?.location === "string"
        ? item.system.location
        : null;
  return location && location.length > 0 ? location : null;
}

function buildSpellcastingEntrySlots(
  spellChoice: NonNullable<PendingStep["spellChoice"]>,
  actor: any,
  draft: DraftState
): Record<string, { max: number; value: number; prepared: Array<{ id: string | null; expended: boolean }> }> {
  if (spellChoice.destination.key === "wizard-arcane-prepared") {
    return buildWizardSpellcastingSlots(actor, draft);
  }

  if (spellChoice.destination.key === "cleric-divine-prepared") {
    return buildClericPreparedSlots(actor, draft);
  }

  return {};
}

function buildClericPreparedSlots(
  actor: any,
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

function buildClericFontSlots(
  actor: any,
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
  actor: any,
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
  existingSlots: Record<string, any> | null | undefined,
  desiredSlots: Record<string, any>
) {
  const merged: Record<string, any> = {};

  for (const [slotKey, desiredGroup] of Object.entries(desiredSlots ?? {})) {
    const desiredMax = Number(desiredGroup?.max ?? 0);
    const existingGroup = existingSlots?.[slotKey];
    const existingMax = Number(existingGroup?.max ?? 0);
    const existingPrepared = Array.isArray(existingGroup?.prepared) ? existingGroup.prepared : [];
    const desiredPreparedSlots = Array.isArray(desiredGroup?.prepared) ? desiredGroup.prepared : [];
    const mergedPrepared = Array.from({ length: desiredMax }, (_, index) => {
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

function getEffectiveWizardSchoolName(actor: any, draft: DraftState): string | null {
  const createdSchool = listActorItems(actor).find(
    (item: any) => item?.flags?.[MODULE_ID]?.slotId === SLOT_IDS.wizardArcaneSchool
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
