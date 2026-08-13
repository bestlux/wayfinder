import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";
import { getSpellRarityCeilingSetting, registerSettings } from "../src/settings";

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
