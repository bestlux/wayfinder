import { MODULE_ID, SETTINGS } from "./constants.js";
import { normalizeSpellRarityCeiling } from "./wayfinder/spell-choice/rarity-access.js";
export function registerSettings(args = {}) {
    game.settings.register(MODULE_ID, SETTINGS.extraPacks, {
        name: "wayfinder-pf2e.Settings.ExtraPacks.Name",
        hint: "wayfinder-pf2e.Settings.ExtraPacks.Hint",
        scope: "world",
        config: true,
        type: String,
        default: "",
    });
    game.settings.register(MODULE_ID, SETTINGS.spellRarityCeiling, {
        name: "wayfinder-pf2e.Settings.SpellRarityCeiling.Name",
        hint: "wayfinder-pf2e.Settings.SpellRarityCeiling.Hint",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        choices: {
            common: "wayfinder-pf2e.Settings.SpellRarityCeiling.Choices.Common",
            uncommon: "wayfinder-pf2e.Settings.SpellRarityCeiling.Choices.Uncommon",
            rare: "wayfinder-pf2e.Settings.SpellRarityCeiling.Choices.Rare",
            unique: "wayfinder-pf2e.Settings.SpellRarityCeiling.Choices.Unique",
        },
        default: "common",
        onChange: args.onSpellRarityCeilingChange,
    });
}
export function getExtraPackSetting() {
    return String(game.settings.get(MODULE_ID, SETTINGS.extraPacks) ?? "");
}
export function getSpellRarityCeilingSetting() {
    return normalizeSpellRarityCeiling(game.settings.get(MODULE_ID, SETTINGS.spellRarityCeiling));
}
//# sourceMappingURL=settings.js.map