import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const spellTemplate = readFileSync(resolve("templates/wayfinder/spell-choice-pane.hbs"), "utf8");
const spellResultsTemplate = readFileSync(resolve("templates/wayfinder/spell-choice-results.hbs"), "utf8");
const pickerStyles = readFileSync(resolve("styles/wayfinder/picker-preview.css"), "utf8");

describe("wayfinder spell picker layout", () => {
  it("keeps only the browser header and selected summary sticky while notes and filters scroll", () => {
    const headerStart = spellTemplate.indexOf('<header class="browser-header">');
    const headerEnd = spellTemplate.indexOf("</header>", headerStart);
    const selectedSummary = spellTemplate.indexOf('class="spell-selected-summary', headerStart);
    const browserNotes = spellTemplate.indexOf('class="spell-browser-notes"', headerStart);
    const resultsPartial = spellTemplate.indexOf("spell-choice-results.hbs", headerStart);

    expect(headerStart).toBeGreaterThan(-1);
    expect(selectedSummary).toBeGreaterThan(headerStart);
    expect(selectedSummary).toBeLessThan(headerEnd);
    expect(browserNotes).toBeGreaterThan(headerEnd);
    expect(resultsPartial).toBeGreaterThan(headerEnd);
    expect(spellResultsTemplate).toContain('class="picker-filter-bar"');
    expect(pickerStyles).toMatch(/\.option-browser-scroll\s*\{[^}]*overflow:\s*auto;/s);
    expect(pickerStyles).toMatch(/\.browser-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  });

  it("caps the pinned selection list with its own scroll area", () => {
    expect(pickerStyles).toMatch(
      /\.spell-selected-list\s*\{[^}]*max-height:\s*4\.2rem;[^}]*overflow:\s*auto;[^}]*overscroll-behavior:\s*contain;/s
    );
    expect(spellTemplate).toContain('data-wayfinder-action="toggle-spell-choice"');
    expect(spellTemplate).toContain('aria-label="Remove {{name}}"');
  });

  it("identifies an excess selection and exposes a direct correction action", () => {
    expect(spellTemplate).toContain('aria-invalid="{{#if activePane.excessCount}}true{{else}}false{{/if}}"');
    expect(spellTemplate).toContain('class="spell-selection-error"');
    expect(spellTemplate).not.toContain('class="spell-selection-error" role="alert"');
    expect(spellTemplate).toContain("Drop {{activePane.excessCount}} spell");
    expect(pickerStyles).toMatch(/\.spell-selected-summary\.is-invalid,[^}]*\.spell-selected-summary\.is-excess\s*\{/s);
  });

  it("presents restricted access as a reviewable access note", () => {
    expect(spellTemplate).toContain('aria-label="Access note for restricted spells"');
    expect(spellTemplate).toContain("Access note");
    expect(spellTemplate).toContain("This is your word for the record. Wayfinder does not check it.");
    expect(spellTemplate).toContain("your GM's say-so");
    expect(spellTemplate).toContain("<dl");
    expect(spellTemplate).toContain('<time datetime="{{activePane.rarityAccess.attestedAt}}">');
    expect(spellTemplate).not.toContain("aria-pressed");
    expect(spellTemplate).not.toContain("Restricted rarities included");
    expect(pickerStyles).toMatch(/\.spell-rarity-access button\s*\{[^}]*min-height:\s*2rem;/s);
  });
});
