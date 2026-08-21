import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pickTemplate = read("templates/wayfinder/pick-pane.hbs");
const spellTemplate = read("templates/wayfinder/spell-choice-pane.hbs");
const countTemplate = read("templates/wayfinder/picker-result-count.hbs");
const pickResultsTemplate = read("templates/wayfinder/pick-results.hbs");
const spellResultsTemplate = read("templates/wayfinder/spell-choice-results.hbs");
const filterBarTemplate = read("templates/wayfinder/picker-filter-bar.hbs");
const wayfinderSource = read("src/wayfinder.ts");

describe("wayfinder picker search parts", () => {
  it("keeps the live search input outside both replaceable parts", () => {
    for (const paneTemplate of [pickTemplate, spellTemplate]) {
      expect(paneTemplate).toContain("data-wayfinder-search");
      expect(paneTemplate).toContain("picker-result-count.hbs");
    }
    expect(pickTemplate).toContain("pick-results.hbs");
    expect(spellTemplate).toContain("spell-choice-results.hbs");

    for (const partTemplate of [countTemplate, pickResultsTemplate, spellResultsTemplate]) {
      expect(partTemplate).not.toContain("data-wayfinder-search");
    }
  });

  it("gives each partial template one marked root and query evidence on results", () => {
    expect(singleMarkedRoot(countTemplate, "picker-count")).toBe(true);
    expect(singleMarkedRoot(pickResultsTemplate, "picker-results")).toBe(true);
    expect(singleMarkedRoot(spellResultsTemplate, "picker-results")).toBe(true);

    for (const resultsTemplate of [pickResultsTemplate, spellResultsTemplate]) {
      expect(resultsTemplate).toContain("data-wayfinder-option-list");
      expect(resultsTemplate).toContain('data-wayfinder-rendered-query="{{activePane.search}}"');
      expect(resultsTemplate).toContain('data-wayfinder-result-count="{{activePane.resultCount}}"');
      expect(resultsTemplate).toContain('data-wayfinder-view-revision="{{pickerRequest.viewRevision}}"');
      expect(resultsTemplate).toContain('data-wayfinder-source-revision="{{pickerRequest.sourceRevision}}"');
    }
    expect(pickTemplate).not.toContain("data-wayfinder-option-list");
    expect(spellTemplate).not.toContain("data-wayfinder-option-list");
  });

  it("preserves picker-specific option actions and preloads every new partial", () => {
    expect(countTemplate).toContain("activePane.suppressionNotice");
    expect(countTemplate).toContain("picker-suppression-notice");
    expect(pickResultsTemplate).toContain('data-wayfinder-action="select-option"');
    expect(spellResultsTemplate).toContain('data-wayfinder-action="toggle-spell-choice"');
    expect(spellResultsTemplate).toContain("{{rankLabel}}");
    expect(pickResultsTemplate).toContain("{{level}}");
    expect(filterBarTemplate).toContain('data-wayfinder-action="set-picker-level-range"');

    for (const template of [
      "picker-result-count.hbs",
      "picker-filter-bar.hbs",
      "pick-results.hbs",
      "spell-choice-results.hbs",
    ]) {
      expect(wayfinderSource).toContain(`/templates/wayfinder/${template}`);
    }
  });
});

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

function singleMarkedRoot(template: string, partId: string): boolean {
  const trimmed = template.trim();
  return (
    trimmed.startsWith("<div") &&
    trimmed.endsWith("</div>") &&
    trimmed.match(new RegExp(`data-application-part="${partId}"`, "g"))?.length === 1
  );
}
