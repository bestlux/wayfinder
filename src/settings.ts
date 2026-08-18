import { MODULE_ID, SETTINGS } from "./constants.js";
import { normalizeSpellRarityCeiling, type SpellRarityCeiling } from "./wayfinder/spell-choice/rarity-access.js";

export function registerSettings(
  args: {
    compendiumSourcesMenuType?: unknown;
    feedbackMenuType?: unknown;
    onExtraPacksChange?: () => void;
    onSpellRarityCeilingChange?: () => void;
  } = {}
): void {
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
}

export function getExtraPackSetting(): string {
  return String(game.settings.get(MODULE_ID, SETTINGS.extraPacks) ?? "");
}

export function getSpellRarityCeilingSetting(): SpellRarityCeiling {
  return normalizeSpellRarityCeiling(game.settings.get(MODULE_ID, SETTINGS.spellRarityCeiling));
}
