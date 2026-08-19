import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const template = readFileSync(resolve("templates/equipment-policy-config.hbs"), "utf8");
const styles = readFileSync(resolve("styles/wayfinder/equipment-policy-config.css"), "utf8");
const entryStyles = readFileSync(resolve("styles/wayfinder.css"), "utf8");
const english = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8"));
const chinese = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"));

describe("equipment policy config surface", () => {
  it("renders every configured authority and recipe control", () => {
    for (const name of [
      "enabledRecipes",
      "defaultRecipe",
      "recipeChoiceAuthority",
      "higherLevelStartAuthority",
      "blanketRarity",
      "allowedEquipmentPackFamilies",
      "applyAuthority",
    ])
      expect(template).toContain(`name="${name}"`);
    expect(template).toContain('type="submit"');
    expect(template).not.toMatch(/>Common<|>Uncommon<|>Rare<|>Unique<|Item compendia<\/small>/);
  });

  it("ships scoped styles and both supported localizations", () => {
    expect(entryStyles).toContain("equipment-policy-config.css");
    expect(styles).toContain(".wayfinder-equipment-policy-config");
    for (const localization of [english, chinese]) {
      expect(localization["wayfinder-pf2e"].Settings.EquipmentPolicy.Hint).toBeTruthy();
      expect(localization["wayfinder-pf2e"].EquipmentPolicy.RecipeRequired).toBeTruthy();
    }
  });
});
