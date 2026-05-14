export const MODULE_ID = "wayfinder-pf2e";
export const MODULE_TITLE = "Wayfinder";
export const DRAFT_FLAG = `flags.${MODULE_ID}.draft`;
export const STATE_FLAG = `flags.${MODULE_ID}.state`;
export const FLAG_KEYS = {
    draft: "draft",
    state: "state",
};
export const SETTINGS = {
    extraPacks: "additionalSourcePacks",
};
export const SETTINGS_KEYS = {
    includeOfficialSources: "includeOfficialSources",
    additionalSourcePacks: SETTINGS.extraPacks,
};
export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
export const OFFICIAL_PACKS = {
    ancestry: ["pf2e.ancestries"],
    heritage: ["pf2e.heritages"],
    background: ["pf2e.backgrounds"],
    class: ["pf2e.classes"],
    deity: ["pf2e.deities"],
    feat: ["pf2e.feats-srd"],
    classFeature: ["pf2e.classfeatures"],
    spell: ["pf2e.spells-srd"],
};
export const SKILL_LABELS = {
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
};
export const SKILL_ABILITIES = {
    acrobatics: "dex",
    arcana: "int",
    athletics: "str",
    crafting: "int",
    deception: "cha",
    diplomacy: "cha",
    intimidation: "cha",
    medicine: "wis",
    nature: "wis",
    occultism: "int",
    performance: "cha",
    religion: "wis",
    society: "int",
    stealth: "dex",
    survival: "wis",
    thievery: "dex",
};
export const PROFICIENCY_LABELS = {
    0: "Untrained",
    1: "Trained",
    2: "Expert",
    3: "Master",
    4: "Legendary",
};
export const PROFICIENCY_CODES = {
    0: "U",
    1: "T",
    2: "E",
    3: "M",
    4: "L",
};
//# sourceMappingURL=constants.js.map