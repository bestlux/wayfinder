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
      },
    };
  });

  it("registers the spell rarity ceiling as a GM-controlled world dropdown", () => {
    registerSettings();

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
          common: "Common",
          uncommon: "Uncommon",
          rare: "Rare",
          unique: "Unique",
        },
        default: "common",
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
