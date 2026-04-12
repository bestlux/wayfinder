import type { AbilityKey, BoostDraftState, DraftState, ModuleState } from "./types.js";

const DRAFT_VERSION = 3;
const STATE_VERSION = 1;

export function createEmptyDraft(targetLevel = 1): DraftState {
  return {
    version: DRAFT_VERSION,
    targetLevel: clampLevel(targetLevel),
    selections: {},
    boosts: createEmptyBoostDraft(),
    manual: {},
    skillIncreases: {},
    skillTrainings: {},
    branchSelections: {},
    updatedAt: null,
  };
}

export function createEmptyState(): ModuleState {
  return {
    version: STATE_VERSION,
    lastAppliedAt: null,
    lastTargetLevel: null,
    completedStepIds: [],
  };
}

export function normalizeDraft(raw: unknown, fallbackTargetLevel: number): DraftState {
  const draft = isRecord(raw) ? (raw as Partial<DraftState>) : {};

  return {
    version: DRAFT_VERSION,
    targetLevel: clampLevel(typeof draft.targetLevel === "number" ? draft.targetLevel : fallbackTargetLevel),
    selections: sanitizeSelections(draft.selections),
    boosts: sanitizeBoosts(draft.boosts),
    manual: sanitizeManual(draft.manual),
    skillIncreases: sanitizeSkillIncreases(draft.skillIncreases),
    skillTrainings: sanitizeSkillTrainings(draft.skillTrainings),
    branchSelections: sanitizeSelections(draft.branchSelections),
    updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : null,
  };
}

export function normalizeState(raw: unknown): ModuleState {
  const state = isRecord(raw) ? (raw as Partial<ModuleState>) : {};

  return {
    version: STATE_VERSION,
    lastAppliedAt: typeof state.lastAppliedAt === "string" ? state.lastAppliedAt : null,
    lastTargetLevel: typeof state.lastTargetLevel === "number" ? clampLevel(state.lastTargetLevel) : null,
    completedStepIds: Array.isArray(state.completedStepIds)
      ? state.completedStepIds.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export function buildDraftPatch(draft: DraftState): DraftState {
  return {
    ...draft,
    version: DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyBoostDraft(): BoostDraftState {
  return {
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
  };
}

function sanitizeSelections(raw: unknown): DraftState["selections"] {
  if (!isRecord(raw)) {
    return {};
  }

  const result: DraftState["selections"] = {};
  for (const slotId of Object.keys(raw)) {
    const value = raw[slotId];
    if (!isRecord(value)) {
      continue;
    }

    const selection = value as Record<string, unknown>;
    const packId = selection.packId;
    const documentId = selection.documentId;
    const uuid = selection.uuid;
    const name = selection.name;

    if (
      typeof packId !== "string" ||
      typeof documentId !== "string" ||
      typeof uuid !== "string" ||
      typeof name !== "string"
    ) {
      continue;
    }

    result[slotId] = {
      slotId,
      packId,
      documentId,
      uuid: normalizeCompendiumItemUuid(packId, documentId, uuid),
      itemType: typeof selection.itemType === "string" ? selection.itemType : "",
      featType: typeof selection.featType === "string" ? selection.featType : null,
      name,
      level: typeof selection.level === "number" ? clampLevel(selection.level) : null,
    };
  }

  return result;
}

function sanitizeSkillIncreases(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [slotId, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) {
      result[slotId] = value.trim().toLowerCase();
    }
  }
  return result;
}

function normalizeCompendiumItemUuid(packId: string, documentId: string, uuid: string): string {
  const canonicalUuid = `Compendium.${packId}.Item.${documentId}`;
  const legacyUuid = `Compendium.${packId}.${documentId}`;
  return uuid === legacyUuid ? canonicalUuid : uuid;
}

function sanitizeSkillTrainings(raw: unknown): DraftState["skillTrainings"] {
  if (!isRecord(raw)) {
    return {};
  }

  const result: DraftState["skillTrainings"] = {};
  for (const [slotId, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }

    const ruleChoices = isRecord(value.ruleChoices)
      ? Object.fromEntries(
          Object.entries(value.ruleChoices)
            .filter(([, selection]) => typeof selection === "string" && selection.trim())
            .map(([flag, selection]) => [flag, String(selection).trim().toLowerCase()])
        )
      : {};
    const additional = Array.isArray(value.additional)
      ? value.additional
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim().toLowerCase())
      : [];

    result[slotId] = {
      ruleChoices,
      additional: Array.from(new Set(additional)),
    };
  }

  return result;
}

function sanitizeManual(raw: unknown): DraftState["manual"] {
  if (!isRecord(raw)) {
    return {};
  }

  const result: DraftState["manual"] = {};
  for (const stepId of Object.keys(raw)) {
    const value = raw[stepId];
    result[stepId] = value === true;
  }
  return result;
}

function sanitizeBoosts(raw: unknown): DraftState["boosts"] {
  const defaults = createEmptyBoostDraft();
  if (!isRecord(raw)) {
    return defaults;
  }

  const ancestry = isRecord(raw.ancestry) ? raw.ancestry : {};
  const background = isRecord(raw.background) ? raw.background : {};
  const classBoosts = isRecord(raw.class) ? raw.class : {};
  const levels = isRecord(raw.levels) ? raw.levels : {};
  const voluntary = isRecord(ancestry.voluntary) ? ancestry.voluntary : {};

  return {
    ancestry: {
      modeTouched: ancestry.modeTouched === true,
      mode: ancestry.mode === "alternate" ? "alternate" : "standard",
      selectedBoosts: sanitizeSelectedBoosts(ancestry.selectedBoosts),
      alternateBoosts: sanitizeAbilitySet(ancestry.alternateBoosts, 2),
      voluntary: {
        touched: voluntary.touched === true,
        enabled: voluntary.enabled === true,
        legacy: voluntary.legacy === true,
        boost: sanitizeAbility(voluntary.boost),
        flaws: sanitizeAbilitySequence(voluntary.flaws, voluntary.legacy === true ? 2 : 6),
      },
    },
    background: {
      selectedBoosts: sanitizeSelectedBoosts(background.selectedBoosts),
    },
    class: {
      keyAbility: sanitizeAbility(classBoosts.keyAbility),
    },
    levels: sanitizeLevelBoosts(levels),
  };
}

function sanitizeSelectedBoosts(raw: unknown): Record<string, AbilityKey | null> {
  if (!isRecord(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => {
      const ability = sanitizeAbility(value);
      return ability || value === null ? [[key, ability]] : [];
    })
  );
}

function sanitizeLevelBoosts(raw: Record<string, unknown>): Record<string, AbilityKey[]> {
  return Object.fromEntries(
    Object.entries(raw).flatMap(([level, value]) => {
      if (!/^(1|5|10|15|20)$/.test(level)) {
        return [];
      }

      return [[level, sanitizeAbilitySet(value, 4)]];
    })
  );
}

function sanitizeAbility(value: unknown): AbilityKey | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isAbilityKey(normalized) ? normalized : null;
}

function sanitizeAbilitySet(raw: unknown, maxLength = 6): AbilityKey[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return Array.from(
    new Set(raw.map((value) => sanitizeAbility(value)).filter((value): value is AbilityKey => value !== null))
  ).slice(0, maxLength);
}

function sanitizeAbilitySequence(raw: unknown, maxLength = 6): AbilityKey[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((value) => sanitizeAbility(value))
    .filter((value): value is AbilityKey => value !== null)
    .slice(0, maxLength);
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }

  return Math.min(20, Math.max(1, Math.floor(level)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbilityKey(value: string): value is AbilityKey {
  return ["str", "dex", "con", "int", "wis", "cha"].includes(value);
}
