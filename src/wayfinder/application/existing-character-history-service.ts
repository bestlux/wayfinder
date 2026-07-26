import type { BuildStateActorItem } from "../../build-state/document-types.js";
import { listActorItems } from "../../build-state.js";
import { sourceIdOf } from "../../shared/source-id.js";
import type { ExistingCharacterHistory, ExistingCharacterHistoryEntry, ModuleState } from "../../types.js";

const ANCESTRY_FEAT_LEVELS = [1, 5, 9, 13, 17];
const FREE_ARCHETYPE_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const SKILL_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const GENERAL_FEAT_LEVELS = [3, 7, 11, 15, 19];
const SKILL_INCREASE_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19];
const ABILITY_BOOST_LEVELS = [1, 5, 10, 15, 20];

const SINGLETONS = [
  ["ancestry", "Ancestry"],
  ["heritage", "Heritage"],
  ["background", "Background"],
  ["class", "Class"],
] as const;

const FEAT_LANES = [
  ["ancestry", "ancestry-feat", "Ancestry feat", ANCESTRY_FEAT_LEVELS],
  ["skill", "skill-feat", "Skill feat", SKILL_FEAT_LEVELS],
  ["general", "general-feat", "General feat", GENERAL_FEAT_LEVELS],
] as const;

type ActorItemLike = BuildStateActorItem & {
  system?: BuildStateActorItem["system"] & {
    location?: unknown;
  };
};

interface FeatSlotLike {
  level?: unknown;
  feat?: unknown;
}

interface FeatGroupLike {
  slots?: Record<string, FeatSlotLike>;
}

export function buildExistingCharacterHistory(
  actor: unknown,
  now: () => string = () => new Date().toISOString()
): ExistingCharacterHistory {
  const actorLevel = actorLevelOf(actor);
  const items = listActorItems(actor) as ActorItemLike[];
  const entries: ExistingCharacterHistoryEntry[] = [];

  for (const [itemType, label] of SINGLETONS) {
    const item = items.find((candidate) => candidate.type === itemType);
    entries.push(
      item
        ? mappedEntry(`${itemType}-level-1`, 1, "foundation", label, itemName(item), sourceIdOf(item))
        : reviewEntry(`${itemType}-level-1`, 1, "foundation", label, "No actor item found")
    );
  }

  const deity = items.find((candidate) => candidate.type === "deity");
  if (deity) {
    entries.push(mappedEntry("deity-level-1", 1, "foundation", "Deity", itemName(deity), sourceIdOf(deity)));
  }

  for (const [groupId, slotKind, label, levels] of FEAT_LANES) {
    entries.push(
      ...buildFeatLaneEntries(
        actor,
        items,
        groupId,
        slotKind,
        label,
        historyFeatLevels(actor, groupId, levels, actorLevel)
      )
    );
  }

  if (getFeatGroup(actor, "archetype")) {
    entries.push(
      ...buildFeatLaneEntries(
        actor,
        items,
        "archetype",
        "archetype-feat",
        "Free Archetype feat",
        historyFeatLevels(actor, "archetype", FREE_ARCHETYPE_FEAT_LEVELS, actorLevel)
      )
    );
  }

  const classLevels = featGroupLevels(actor, "class").filter((level) => level <= actorLevel);
  entries.push(...buildFeatLaneEntries(actor, items, "class", "class-feat", "Class feat", classLevels));

  for (const level of ABILITY_BOOST_LEVELS.filter((candidate) => candidate <= actorLevel)) {
    const levelBoosts = readActorLevelBoosts(actor, level);
    entries.push(
      levelBoosts.length === 4
        ? mappedEntry(
            `ability-boosts-level-${level}`,
            level,
            "ability-boost",
            level === 1 ? "Level 1 free ability boosts" : `Level ${level} ability boosts`,
            levelBoosts.map((ability) => ability.toUpperCase()).join(", "),
            null
          )
        : reviewEntry(
            `ability-boosts-level-${level}`,
            level,
            "ability-boost",
            level === 1 ? "Level 1 free ability boosts" : `Level ${level} ability boosts`,
            "Review required: no complete level-specific boost record is stored on the actor"
          )
    );
  }

  entries.push(
    reviewEntry(
      "creation-source-boosts-level-1",
      1,
      "ability-boost",
      "Ancestry, background, and class boosts",
      "Review required: Wayfinder does not infer the original creation choices from final ability scores"
    )
  );

  for (const level of SKILL_INCREASE_LEVELS.filter((candidate) => candidate <= actorLevel)) {
    entries.push(
      reviewEntry(
        `skill-increase-level-${level}`,
        level,
        "skill-increase",
        `Level ${level} skill increase`,
        "Review required: current skill ranks do not identify the level of each increase"
      )
    );
  }

  entries.push(
    reviewEntry(
      "embedded-choice-history-level-1",
      1,
      "other",
      "Class features and embedded choices",
      "Review required: Wayfinder will read source-backed rule selections when their owning steps are available"
    )
  );

  return {
    version: 1,
    importedAt: now(),
    actorLevel,
    entries: entries.sort(compareHistoryEntries),
  };
}

export function withExistingCharacterHistory(state: ModuleState, history: ExistingCharacterHistory): ModuleState {
  return {
    ...state,
    existingCharacterHistory: history,
  };
}

function buildFeatLaneEntries(
  actor: unknown,
  items: ActorItemLike[],
  groupId: string,
  slotKind: string,
  label: string,
  levels: number[]
): ExistingCharacterHistoryEntry[] {
  return levels.map((level) => {
    const slotId = `${slotKind}-level-${level}`;
    const item = featItemForSlot(actor, items, groupId, level);
    return item
      ? mappedEntry(slotId, level, "feat", `${label}`, itemName(item), sourceIdOf(item))
      : reviewEntry(slotId, level, "feat", label, "No feat is assigned to this PF2E slot");
  });
}

function featItemForSlot(actor: unknown, items: ActorItemLike[], groupId: string, level: number): ActorItemLike | null {
  const slots = Object.values(getFeatGroup(actor, groupId)?.slots ?? {}) as FeatSlotLike[];
  const slot = slots.find((candidate) => Number(candidate.level) === level);
  const slotFeat = resolveActorItem(slot?.feat, items);
  if (slotFeat) {
    return slotFeat;
  }

  const expectedLocation = `${groupId}-${level}`;
  return items.find((item) => item.type === "feat" && readLocation(item) === expectedLocation) ?? null;
}

function resolveActorItem(value: unknown, items: ActorItemLike[]): ActorItemLike | null {
  if (value && typeof value === "object") {
    return value as ActorItemLike;
  }

  return typeof value === "string" ? (items.find((item) => item.id === value) ?? null) : null;
}

function featGroupLevels(actor: unknown, groupId: string): number[] {
  const slots = Object.values(getFeatGroup(actor, groupId)?.slots ?? {}) as FeatSlotLike[];
  return Array.from(
    new Set(
      slots
        .map((slot) => Number(slot.level))
        .filter((level) => Number.isFinite(level) && level >= 1 && level <= 20)
        .map(Math.floor)
    )
  ).sort((left, right) => left - right);
}

/**
 * PF2E's prepared feat groups are authoritative for an actor's actual cadence.
 * Static rules are only a fallback for actor shapes that expose no usable slots.
 */
function historyFeatLevels(
  actor: unknown,
  groupId: string,
  fallbackLevels: readonly number[],
  actorLevel: number
): number[] {
  const nativeLevels = featGroupLevels(actor, groupId);
  return (nativeLevels.length > 0 ? nativeLevels : fallbackLevels).filter((level) => level <= actorLevel);
}

function getFeatGroup(actor: unknown, groupId: string): FeatGroupLike | null {
  const feats = (actor as { feats?: unknown } | null)?.feats as
    | { get?: (key: string) => unknown; [key: string]: unknown }
    | undefined;
  const group = typeof feats?.get === "function" ? feats.get(groupId) : feats?.[groupId];
  return group && typeof group === "object" ? (group as FeatGroupLike) : null;
}

function mappedEntry(
  slotId: string,
  level: number,
  category: ExistingCharacterHistoryEntry["category"],
  label: string,
  value: string,
  sourceUuid: string | null
): ExistingCharacterHistoryEntry {
  return {
    slotId,
    level,
    category,
    label,
    value,
    status: "mapped",
    sourceUuid,
  };
}

function reviewEntry(
  slotId: string,
  level: number,
  category: ExistingCharacterHistoryEntry["category"],
  label: string,
  value: string
): ExistingCharacterHistoryEntry {
  return {
    slotId,
    level,
    category,
    label,
    value,
    status: "review",
    sourceUuid: null,
  };
}

function readLocation(item: ActorItemLike): string {
  const location = item.system?.location;
  if (typeof location === "string") {
    return location;
  }

  return location && typeof location === "object" && "value" in location
    ? String((location as { value?: unknown }).value ?? "")
    : "";
}

function itemName(item: ActorItemLike): string {
  return typeof item.name === "string" && item.name.trim().length > 0 ? item.name : "Unnamed actor item";
}

function actorLevelOf(actor: unknown): number {
  const value = Number(
    (actor as { system?: { details?: { level?: { value?: unknown } } } } | null)?.system?.details?.level?.value ?? 1
  );
  return Number.isFinite(value) ? Math.max(1, Math.min(20, Math.floor(value))) : 1;
}

function readActorLevelBoosts(actor: unknown, level: number): string[] {
  const raw = (
    actor as {
      system?: {
        build?: {
          attributes?: {
            boosts?: Record<number, unknown>;
          };
        };
      };
    } | null
  )?.system?.build?.attributes?.boosts?.[level];
  if (!Array.isArray(raw)) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => ["str", "dex", "con", "int", "wis", "cha"].includes(value))
    )
  ).slice(0, 4);
}

function compareHistoryEntries(left: ExistingCharacterHistoryEntry, right: ExistingCharacterHistoryEntry): number {
  return left.level - right.level || left.slotId.localeCompare(right.slotId);
}
