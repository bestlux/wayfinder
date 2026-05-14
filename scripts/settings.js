import { MODULE_ID, SETTINGS } from "./constants.js";
export function registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.extraPacks, {
        name: "wayfinder-pf2e.Settings.ExtraPacks.Name",
        hint: "wayfinder-pf2e.Settings.ExtraPacks.Hint",
        scope: "world",
        config: true,
        type: String,
        default: "",
    });
}
export function getExtraPackSetting() {
    return String(game.settings.get(MODULE_ID, SETTINGS.extraPacks) ?? "");
}
//# sourceMappingURL=settings.js.map