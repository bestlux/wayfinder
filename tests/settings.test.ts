import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";
import { getEquipmentWorldPolicySetting, getSpellRarityCeilingSetting, registerSettings } from "../src/settings";

const testGlobals = globalThis as typeof globalThis & { game: any };

describe("Wayfinder settings", () => {
  beforeEach(() => {
    testGlobals.game = {
      settings: {
        get: vi.fn(),
        register: vi.fn(),
        registerMenu: vi.fn(),
      },
    };
  });

  it("registers the spell rarity ceiling as a GM-controlled world dropdown", () => {
    const onSpellRarityCeilingChange = vi.fn();
    registerSettings({ onSpellRarityCeilingChange });

    expect(testGlobals.game.settings.register).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.spellRarityCeiling,
      expect.objectContaining({
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
        onChange: onSpellRarityCeilingChange,
      })
    );
  });

  it("rerenders open Wayfinder apps when the picker pack policy changes", () => {
    const onExtraPacksChange = vi.fn();
    registerSettings({ onExtraPacksChange });

    expect(testGlobals.game.settings.register).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.extraPacks,
      expect.objectContaining({
        config: false,
        restricted: true,
        onChange: onExtraPacksChange,
      })
    );
  });

  it("registers the compendium source chooser as a GM-only settings menu", () => {
    class CompendiumSourcesMenu {}

    registerSettings({ compendiumSourcesMenuType: CompendiumSourcesMenu });

    expect(testGlobals.game.settings.registerMenu).toHaveBeenCalledWith(
      MODULE_ID,
      "compendiumSources",
      expect.objectContaining({
        name: "wayfinder-pf2e.Settings.CompendiumSources.Name",
        label: "wayfinder-pf2e.Settings.CompendiumSources.Label",
        hint: "wayfinder-pf2e.Settings.CompendiumSources.Hint",
        icon: "fa-solid fa-books",
        type: CompendiumSourcesMenu,
        restricted: true,
      })
    );
  });

  it("registers a restricted equipment-policy menu and atomic hidden world setting", () => {
    class EquipmentPolicyMenu {}
    registerSettings({ equipmentPolicyMenuType: EquipmentPolicyMenu });
    expect(testGlobals.game.settings.registerMenu).toHaveBeenCalledWith(
      MODULE_ID,
      "equipmentPolicy",
      expect.objectContaining({ type: EquipmentPolicyMenu, restricted: true })
    );
    expect(testGlobals.game.settings.register).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.equipmentPolicy,
      expect.objectContaining({ scope: "world", config: false, restricted: true, type: Object })
    );
    expect(testGlobals.game.settings.register).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.equipmentPolicyJudgments,
      expect.objectContaining({ scope: "world", config: false, restricted: true, type: Object })
    );
  });

  it("normalizes the stored equipment policy", () => {
    testGlobals.game.settings.get.mockReturnValue({
      version: 1,
      enabledRecipes: ["lump-sum"],
      defaultRecipe: "permanent-items",
      allowedEquipmentPackFamilies: ["BattleZoo"],
    });
    expect(getEquipmentWorldPolicySetting()).toMatchObject({
      enabledRecipes: ["lump-sum"],
      defaultRecipe: "lump-sum",
      allowedEquipmentPackFamilies: ["battlezoo"],
    });
  });

  it("registers feedback support for both players and GMs", () => {
    class FeedbackMenu {}

    registerSettings({ feedbackMenuType: FeedbackMenu });

    expect(testGlobals.game.settings.registerMenu).toHaveBeenCalledWith(
      MODULE_ID,
      "feedback",
      expect.objectContaining({
        name: "wayfinder-pf2e.Settings.Feedback.Name",
        label: "wayfinder-pf2e.Settings.Feedback.Label",
        hint: "wayfinder-pf2e.Settings.Feedback.Hint",
        icon: "fa-solid fa-comment-dots",
        type: FeedbackMenu,
        restricted: false,
      })
    );
  });

  it.each([
    ["common", "common"],
    ["UNCOMMON", "uncommon"],
    ["rare", "rare"],
    ["unique", "unique"],
    ["invalid", "common"],
    [null, "common"],
  ])("normalizes the stored ceiling %j to %s", (stored, expected) => {
    testGlobals.game.settings.get.mockReturnValue(stored);

    expect(getSpellRarityCeilingSetting()).toBe(expected);
    expect(testGlobals.game.settings.get).toHaveBeenCalledWith(MODULE_ID, SETTINGS.spellRarityCeiling);
  });
});
