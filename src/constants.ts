export const MODULE_ID = "pf2e-wayfinder";
export const MODULE_TITLE = "Wayfinder";
export const DRAFT_FLAG = `flags.${MODULE_ID}.draft`;
export const STATE_FLAG = `flags.${MODULE_ID}.state`;
export const FLAG_KEYS = {
  draft: "draft",
  state: "state"
} as const;
export const SETTINGS = {
  extraPacks: "additionalSourcePacks"
} as const;
export const SETTINGS_KEYS = {
  includeOfficialSources: "includeOfficialSources",
  additionalSourcePacks: SETTINGS.extraPacks
} as const;
export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const OFFICIAL_PACKS = {
  ancestry: ["pf2e.ancestries"],
  heritage: ["pf2e.heritages"],
  background: ["pf2e.backgrounds"],
  class: ["pf2e.classes"],
  feat: ["pf2e.feats-srd"]
} as const;
