import { MODULE_ID, SETTINGS } from "./constants.js";
import { DEFAULT_EQUIPMENT_WORLD_POLICY, EMPTY_EQUIPMENT_POLICY_JUDGMENT_STORE, normalizeEquipmentPolicyJudgmentStore, normalizeEquipmentWorldPolicy, } from "./wayfinder/domain/equipment-policy.js";
import { normalizeSpellRarityCeiling } from "./wayfinder/spell-choice/rarity-access.js";
export function registerSettings(args = {}) {
    if (args.feedbackMenuType) {
        game.settings.registerMenu(MODULE_ID, "feedback", {
            name: "wayfinder-pf2e.Settings.Feedback.Name",
            label: "wayfinder-pf2e.Settings.Feedback.Label",
            hint: "wayfinder-pf2e.Settings.Feedback.Hint",
            icon: "fa-solid fa-comment-dots",
            type: args.feedbackMenuType,
            restricted: false,
        });
    }
    if (args.compendiumSourcesMenuType) {
        game.settings.registerMenu(MODULE_ID, "compendiumSources", {
            name: "wayfinder-pf2e.Settings.CompendiumSources.Name",
            label: "wayfinder-pf2e.Settings.CompendiumSources.Label",
            hint: "wayfinder-pf2e.Settings.CompendiumSources.Hint",
            icon: "fa-solid fa-books",
            type: args.compendiumSourcesMenuType,
            restricted: true,
        });
    }
    if (args.equipmentPolicyMenuType) {
        game.settings.registerMenu(MODULE_ID, "equipmentPolicy", {
            name: "wayfinder-pf2e.Settings.EquipmentPolicy.Name",
            label: "wayfinder-pf2e.Settings.EquipmentPolicy.Label",
            hint: "wayfinder-pf2e.Settings.EquipmentPolicy.Hint",
            icon: "fa-solid fa-coins",
            type: args.equipmentPolicyMenuType,
            restricted: true,
        });
    }
    game.settings.register(MODULE_ID, SETTINGS.extraPacks, {
        name: "wayfinder-pf2e.Settings.ExtraPacks.Name",
        hint: "wayfinder-pf2e.Settings.ExtraPacks.Hint",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: args.onExtraPacksChange,
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
    game.settings.register(MODULE_ID, SETTINGS.equipmentPolicy, {
        name: "wayfinder-pf2e.Settings.EquipmentPolicy.Name",
        hint: "wayfinder-pf2e.Settings.EquipmentPolicy.Hint",
        scope: "world",
        config: false,
        restricted: true,
        type: Object,
        default: DEFAULT_EQUIPMENT_WORLD_POLICY,
    });
    game.settings.register(MODULE_ID, SETTINGS.equipmentPolicyJudgments, {
        name: "wayfinder-pf2e.Settings.EquipmentPolicy.JudgmentsName",
        scope: "world",
        config: false,
        restricted: true,
        type: Object,
        default: EMPTY_EQUIPMENT_POLICY_JUDGMENT_STORE,
    });
}
export function getExtraPackSetting() {
    return String(game.settings.get(MODULE_ID, SETTINGS.extraPacks) ?? "");
}
export function getSpellRarityCeilingSetting() {
    return normalizeSpellRarityCeiling(game.settings.get(MODULE_ID, SETTINGS.spellRarityCeiling));
}
export function getEquipmentWorldPolicySetting() {
    return normalizeEquipmentWorldPolicy(game.settings.get(MODULE_ID, SETTINGS.equipmentPolicy));
}
export function getEquipmentPolicyJudgmentStoreSetting() {
    return normalizeEquipmentPolicyJudgmentStore(game.settings.get(MODULE_ID, SETTINGS.equipmentPolicyJudgments));
}
//# sourceMappingURL=settings.js.map