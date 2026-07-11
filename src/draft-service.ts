import type { AbilityKey, BoostDraftState, DraftState, ModuleState } from "./types.js";
import {
  classArchetypeProfile,
  migrateLegacyClassArchetypeBranches,
  STANDARD_CLASS_PATH,
} from "./wayfinder/class-archetype/registry.js";
import { SLOT_PREFIXES } from "./wayfinder/slot-ids.js";

const DRAFT_VERSION = 8;
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
    classArchetypeChoices: {},
    singletonChoices: {},
    languageChoices: {},
    classChoices: {},
    spellChoices: {},
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
  const branchSelections = sanitizeSelections(draft.branchSelections);
  const classArchetypeChoices = Object.fromEntries(
    Object.entries(sanitizeChoiceValues(draft.classArchetypeChoices)).filter(
      ([, value]) => value === STANDARD_CLASS_PATH || !!classArchetypeProfile(value)
    )
  );
  const migratedClassArchetypeProfiles = migrateLegacyClassArchetypeBranches(branchSelections, classArchetypeChoices);
  const selections = sanitizeSelections(draft.selections);
  const manual = sanitizeManual(draft.manual);
  const skillTrainings = sanitizeSkillTrainings(draft.skillTrainings);
  const classChoices = sanitizeClassChoices(draft.classChoices);
  const spellChoices = sanitizeSpellChoices(draft.spellChoices);
  if (migratedClassArchetypeProfiles.length > 0) {
    clearLegacyClassArchetypeDependentState({
      branchSelections,
      classChoices,
      manual,
      selections,
      skillTrainings,
      spellChoices,
      projectedStaticGrantUuids: new Set(
        migratedClassArchetypeProfiles.flatMap((profile) =>
          profile.projectedFeatGrants.flatMap((grant) => grant.staticFeatGrants.map((selection) => selection.uuid))
        )
      ),
    });
  }

  return {
    version: DRAFT_VERSION,
    targetLevel: clampLevel(typeof draft.targetLevel === "number" ? draft.targetLevel : fallbackTargetLevel),
    selections,
    boosts: sanitizeBoosts(draft.boosts),
    manual,
    skillIncreases: sanitizeSkillIncreases(draft.skillIncreases),
    skillTrainings,
    branchSelections,
    classArchetypeChoices,
    singletonChoices: sanitizeChoiceValues(draft.singletonChoices),
    languageChoices: sanitizeChoiceListValues(draft.languageChoices),
    classChoices,
    spellChoices,
    updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : null,
  };
}

function clearLegacyClassArchetypeDependentState(state: {
  branchSelections: DraftState["branchSelections"];
  classChoices: DraftState["classChoices"];
  manual: DraftState["manual"];
  selections: DraftState["selections"];
  skillTrainings: DraftState["skillTrainings"];
  spellChoices: DraftState["spellChoices"];
  projectedStaticGrantUuids: ReadonlySet<string>;
}): void {
  clearMatchingKeys(state.branchSelections, () => true);
  clearMatchingKeys(state.classChoices, (slotId) => slotId.startsWith(SLOT_PREFIXES.classChoice));
  clearMatchingKeys(state.skillTrainings, (slotId) => slotId.startsWith(SLOT_PREFIXES.skillTraining));
  clearMatchingKeys(state.spellChoices, (slotId) => slotId.startsWith(SLOT_PREFIXES.spellChoice));
  clearMatchingKeys(state.manual, (slotId) =>
    [
      SLOT_PREFIXES.classBranch,
      SLOT_PREFIXES.classChoice,
      SLOT_PREFIXES.classFeat,
      SLOT_PREFIXES.skillTraining,
      SLOT_PREFIXES.spellChoice,
    ].some((prefix) => slotId.startsWith(prefix))
  );
  clearMatchingKeys(state.selections, (slotId) => {
    const selection = state.selections[slotId];
    return (
      slotId.startsWith(SLOT_PREFIXES.classFeat) ||
      /^grant-choice-(?:class|deity|none)-classfeature-/.test(slotId) ||
      /^flag-choice-(?:ancestry|class|none)-classfeature-/.test(slotId) ||
      (!!selection && state.projectedStaticGrantUuids.has(selection.uuid))
    );
  });
}

function clearMatchingKeys<T>(record: Record<string, T>, matches: (key: string) => boolean): void {
  for (const key of Object.keys(record)) {
    if (matches(key)) {
      delete record[key];
    }
  }
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
      ...(typeof selection.slug === "string" && selection.slug.trim() ? { slug: selection.slug.trim() } : {}),
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

function sanitizeClassChoices(raw: unknown): Record<string, string> {
  return sanitizeChoiceValues(raw);
}

function sanitizeChoiceValues(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([slotId, value]) => [slotId, String(value).trim()])
  );
}

function sanitizeChoiceListValues(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Record<string, string[]> = {};
  for (const [slotId, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      continue;
    }

    const selections = Array.from(
      new Set(
        value
          .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
          .filter((entry) => entry.length > 0)
      )
    );
    if (selections.length > 0) {
      result[slotId] = selections;
    }
  }

  return result;
}

function sanitizeSpellChoices(raw: unknown): DraftState["spellChoices"] {
  if (!isRecord(raw)) {
    return {};
  }

  const result: DraftState["spellChoices"] = {};
  for (const [slotId, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      continue;
    }

    const selections = value
      .map((entry) => sanitizeSpellSelection(slotId, entry))
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
    if (selections.length > 0) {
      result[slotId] = dedupeSelections(selections);
    }
  }

  return result;
}

function sanitizeSpellSelection(slotId: string, value: unknown): DraftState["selections"][string] | null {
  if (!isRecord(value)) {
    return null;
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
    return null;
  }

  return {
    slotId,
    packId,
    documentId,
    uuid: normalizeCompendiumItemUuid(packId, documentId, uuid),
    itemType: typeof selection.itemType === "string" ? selection.itemType : "spell",
    featType: typeof selection.featType === "string" ? selection.featType : null,
    name,
    level: typeof selection.level === "number" ? clampLevel(selection.level) : null,
  };
}

function dedupeSelections<T extends DraftState["selections"][string]>(selections: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const selection of selections) {
    if (seen.has(selection.uuid)) {
      continue;
    }

    seen.add(selection.uuid);
    result.push(selection);
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
    const loreChoices = isRecord(value.loreChoices)
      ? Object.fromEntries(
          Object.entries(value.loreChoices)
            .filter(([, selection]) => typeof selection === "string" && selection.trim())
            .map(([key, selection]) => [key, String(selection).trim()])
        )
      : {};

    result[slotId] = {
      ruleChoices,
      additional: Array.from(new Set(additional)),
      loreChoices,
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
