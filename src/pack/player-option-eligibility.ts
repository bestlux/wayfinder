import type { LooseRecord } from "../shared/actor-model.js";

const ROOT_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class", "deity"]);
const PLAYER_ROOT_SCHEMA_TYPES = new Set(["ancestry", "heritage", "class"]);
const PF2E_ATTRIBUTES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const ABILITY_MODIFIER_PATH = /^system\.abilities\.([^.]+)\.mod$/;
const CLASS_PROGRESSION_FIELDS = [
  "ancestryFeatLevels",
  "classFeatLevels",
  "generalFeatLevels",
  "skillFeatLevels",
  "skillIncreaseLevels",
] as const;

export type PlayerRootEligibilityReason =
  | "eligible"
  | "minion-root"
  | "eidolon-root"
  | "companion-automation"
  | "direct-ability-statblock"
  | "incomplete-ancestry-build-shape"
  | "incomplete-class-progression";

export interface PlayerRootEligibility {
  eligible: boolean;
  reason: PlayerRootEligibilityReason;
  evidence: string[];
}

export interface PlayerOptionEligibilityEntry {
  name?: unknown;
  type?: unknown;
  system?: {
    additionalLanguages?: unknown;
    ancestryFeatLevels?: unknown;
    boosts?: unknown;
    classFeatLevels?: unknown;
    generalFeatLevels?: unknown;
    languages?: unknown;
    rules?: LooseRecord[];
    skillFeatLevels?: unknown;
    skillIncreaseLevels?: unknown;
    traits?: { value?: unknown };
  };
}

/**
 * Keeps PF2E support documents that reuse player-facing item types out of the builder.
 * Pack selection is an availability boundary; this is the player-choice boundary.
 */
export function evaluatePlayerRootEligibility(
  entry: PlayerOptionEligibilityEntry,
  expectedItemType: string
): PlayerRootEligibility {
  const itemType = normalizedIdentifier(entry.type);
  const expectedType = normalizedIdentifier(expectedItemType);
  if (!itemType || itemType !== expectedType || !ROOT_ITEM_TYPES.has(itemType)) return eligible();

  const traits = normalizedStringSet(entry.system?.traits?.value);
  if (traits.has("minion")) return rejected("minion-root", ["trait:minion"]);
  if (traits.has("eidolon")) return rejected("eidolon-root", ["trait:eidolon"]);

  const rules = Array.isArray(entry.system?.rules) ? entry.system.rules : [];
  const companionPaths = rules.map((rule) => normalizedIdentifier(rule.path)).filter(isCompanionAutomationPath);
  if (companionPaths.length > 0) return rejected("companion-automation", companionPaths);

  if (PLAYER_ROOT_SCHEMA_TYPES.has(itemType)) {
    const directAbilityAttributes = new Set(
      rules
        .filter((rule) => normalizedIdentifier(rule.key) === "activeeffectlike")
        .map((rule) => normalizedIdentifier(rule.path)?.match(ABILITY_MODIFIER_PATH)?.[1] ?? null)
        .filter((attribute): attribute is string => !!attribute && PF2E_ATTRIBUTES.has(attribute))
    );
    if (directAbilityAttributes.size >= 3) {
      return rejected(
        "direct-ability-statblock",
        Array.from(directAbilityAttributes, (attribute) => `system.abilities.${attribute}.mod`)
      );
    }
  }

  if (itemType === "ancestry" && !hasPlayerAncestryBuildShape(entry)) {
    return rejected("incomplete-ancestry-build-shape", ["system.boosts", "system.languages"]);
  }

  if (itemType === "class") {
    const system = entry.system as Record<string, unknown> | undefined;
    const missingProgression = CLASS_PROGRESSION_FIELDS.filter(
      (field) => normalizedNumberArray(system?.[field]).length === 0
    );
    if (missingProgression.length > 0) {
      return rejected(
        "incomplete-class-progression",
        missingProgression.map((field) => `system.${field}.value`)
      );
    }
  }

  return eligible();
}

export function isPlayerSelectableRoot(entry: PlayerOptionEligibilityEntry, expectedItemType: string): boolean {
  return evaluatePlayerRootEligibility(entry, expectedItemType).eligible;
}

function hasPlayerAncestryBuildShape(entry: PlayerOptionEligibilityEntry): boolean {
  const hasAbilityBoost = ancestryBoostValues(entry.system?.boosts).some((values) =>
    values.some((value) => PF2E_ATTRIBUTES.has(value))
  );
  const languages = valueArray(entry.system?.languages);
  const customLanguage = nestedString(entry.system?.languages, "custom");
  return hasAbilityBoost && (languages.length > 0 || !!customLanguage);
}

function isCompanionAutomationPath(path: string | null): path is string {
  if (!path?.startsWith("flags.")) return false;
  return path
    .split(".")
    .slice(2)
    .some((segment) => segment.includes("companion") || segment.includes("eidolon"));
}

function ancestryBoostValues(value: unknown): string[][] {
  if (!isRecord(value)) return [];
  return Object.values(value).map((slot) => valueArray(slot));
}

function valueArray(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Array.from(normalizedStringSet(value.value));
}

function normalizedNumberArray(value: unknown): number[] {
  if (!isRecord(value) || !Array.isArray(value.value)) return [];
  return value.value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry > 0
  );
}

function nestedString(value: unknown, key: string): string | null {
  return isRecord(value) ? normalizedIdentifier(value[key]) : null;
}

function normalizedStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizedIdentifier(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function eligible(): PlayerRootEligibility {
  return { eligible: true, reason: "eligible", evidence: [] };
}

function rejected(reason: Exclude<PlayerRootEligibilityReason, "eligible">, evidence: string[]): PlayerRootEligibility {
  return { eligible: false, reason, evidence };
}
