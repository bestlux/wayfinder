import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const spellTemplate = readFileSync(resolve("templates/wayfinder/spell-choice-pane.hbs"), "utf8");
const pickerStyles = readFileSync(resolve("styles/wayfinder/picker-preview.css"), "utf8");

describe("wayfinder spell picker layout", () => {
  it("keeps only the browser header and selected summary sticky while notes and filters scroll", () => {
    const headerStart = spellTemplate.indexOf('<header class="browser-header">');
    const headerEnd = spellTemplate.indexOf("</header>", headerStart);
    const selectedSummary = spellTemplate.indexOf('class="spell-selected-summary', headerStart);
    const browserNotes = spellTemplate.indexOf('class="spell-browser-notes"', headerStart);
    const filterBar = spellTemplate.indexOf('class="picker-filter-bar"', headerStart);

    expect(headerStart).toBeGreaterThan(-1);
    expect(selectedSummary).toBeGreaterThan(headerStart);
    expect(selectedSummary).toBeLessThan(headerEnd);
    expect(browserNotes).toBeGreaterThan(headerEnd);
    expect(filterBar).toBeGreaterThan(headerEnd);
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
    expect(spellTemplate).toContain("Remove {{activePane.excessCount}} extra spell");
    expect(pickerStyles).toMatch(/\.spell-selected-summary\.is-invalid,[^}]*\.spell-selected-summary\.is-excess\s*\{/s);
  });
});
