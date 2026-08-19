import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const template = readFileSync(resolve("templates/compendium-source-config.hbs"), "utf8");
const styles = readFileSync(resolve("styles/wayfinder/compendium-source-config.css"), "utf8");
const entryStyles = readFileSync(resolve("styles/wayfinder.css"), "utf8");
const english = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8"));
const chinese = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"));

describe("compendium source config surface", () => {
  it("provides searchable, filterable, bulk-selectable exact pack controls", () => {
    expect(template).toContain("data-source-search");
    expect(template).toContain("data-source-content-filter");
    expect(template).toContain("data-source-sort");
    expect(template).toContain("data-source-pack-id");
    expect(template).toContain('data-action="select-visible"');
    expect(template).toContain('data-action="clear-visible"');
    expect(template).toContain('type="submit"');
  });

  it("shows content counts and legacy wildcard review guidance", () => {
    expect(template).toContain("wayfinder-pf2e.CompendiumSources.LegacyPatternBody");
    expect(template).toContain("wayfinder-pf2e.CompendiumSources.GlobalWildcardTitle");
    expect(template).toContain("wayfinder-pf2e.CompendiumSources.UnmatchedLegacyPatterns");
    expect(template).toContain("{{count}}");
    expect(template).toContain("{{label}}");
  });

  it("ships scoped responsive styles and localization in both supported languages", () => {
    expect(entryStyles).toContain("compendium-source-config.css");
    expect(styles).toContain(".wayfinder-source-config .source-config-row");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (max-width: 720px)");
    for (const localization of [english, chinese]) {
      expect(localization["wayfinder-pf2e"].Settings.CompendiumSources.Hint).toBeTruthy();
      expect(localization["wayfinder-pf2e"].CompendiumSources.LegacyPatternBody).toBeTruthy();
      expect(localization["wayfinder-pf2e"].CompendiumSources.Counts.Feats).toBeTruthy();
    }
    expect(english["wayfinder-pf2e"].CompendiumSources.Filters.Relevant).toBe("Recognized builder item types");
    expect(english["wayfinder-pf2e"].CompendiumSources.Guidance).toContain("raw PF2E item document types");
    expect(english["wayfinder-pf2e"].CompendiumSources.Guidance).not.toContain("every third-party");
  });
});
