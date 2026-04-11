export const MODULE_ID = "pf2e-wayfinder";
export const MODULE_TITLE = "Wayfinder";
export const DRAFT_FLAG = `flags.${MODULE_ID}.draft`;
export const STATE_FLAG = `flags.${MODULE_ID}.state`;
export const FLAG_KEYS = {
  draft: "draft",
  state: "state",
} as const;
export const SETTINGS = {
  extraPacks: "additionalSourcePacks",
} as const;
export const SETTINGS_KEYS = {
  includeOfficialSources: "includeOfficialSources",
  additionalSourcePacks: SETTINGS.extraPacks,
} as const;
export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const OFFICIAL_PACKS = {
  ancestry: ["pf2e.ancestries"],
  heritage: ["pf2e.heritages"],
  background: ["pf2e.backgrounds"],
  class: ["pf2e.classes"],
  feat: ["pf2e.feats-srd"],
  classFeature: ["pf2e.classfeatures"],
} as const;

export const SKILL_LABELS: Record<string, string> = {
  acrobatics: "Acrobatics",
  arcana: "Arcana",
  athletics: "Athletics",
  crafting: "Crafting",
  deception: "Deception",
  diplomacy: "Diplomacy",
  intimidation: "Intimidation",
  medicine: "Medicine",
  nature: "Nature",
  occultism: "Occultism",
  performance: "Performance",
  religion: "Religion",
  society: "Society",
  stealth: "Stealth",
  survival: "Survival",
  thievery: "Thievery",
} as const;

export const PROFICIENCY_LABELS: Record<number, string> = {
  0: "Untrained",
  1: "Trained",
  2: "Expert",
  3: "Master",
  4: "Legendary",
} as const;

export const PROFICIENCY_CODES: Record<number, string> = {
  0: "U",
  1: "T",
  2: "E",
  3: "M",
  4: "L",
} as const;
