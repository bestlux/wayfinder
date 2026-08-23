import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const template = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const styles = readFileSync(resolve("styles/wayfinder/shell-layout.css"), "utf8");
const english = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8"))["wayfinder-pf2e"].Rail;
const chinese = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"))["wayfinder-pf2e"].Rail;

describe("Wayfinder rail level disclosures", () => {
  it("renders native accessible disclosures with progress and invalidation summaries", () => {
    expect(template).toContain("{{#each levelGroups}}");
    expect(template).toContain('<details class="rail-level-group');
    expect(template).toContain('<summary class="rail-level-summary"');
    expect(template).toContain('data-wayfinder-action="toggle-rail-level"');
    expect(template).toContain('localize "wayfinder-pf2e.Rail.Level"');
    expect(template).toContain('localize "wayfinder-pf2e.Rail.Progress"');
    expect(template).toContain('localize "wayfinder-pf2e.Rail.InvalidatedChoices"');
    expect(template).not.toContain("{{completedCount}}/{{stepCount}} complete");
    expect(template).not.toContain('aria-label="Contains invalidated choices"');
    expect(template).toContain("{{#each steps}}");
    expect(template).not.toContain('class="step-level-divider"');
  });

  it("keeps rail disclosure copy localized with matching placeholders", () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    expect(chinese.Level).toContain("{level}");
    expect(chinese.Progress).toContain("{completed}");
    expect(chinese.Progress).toContain("{total}");
    expect(chinese.InvalidatedChoices).not.toBe(english.InvalidatedChoices);
  });

  it("styles disclosures without changing the rail or responsive frame sizing", () => {
    expect(styles).toMatch(/\.wizard-step-list\s*\{[^}]*overflow:\s*auto/s);
    expect(styles).toMatch(/\.rail-level-group\s*\{[^}]*flex-shrink:\s*0/s);
    expect(styles).toMatch(/\.rail-level-summary:focus-visible\s*\{[^}]*outline:/s);
    expect(styles).toContain(".rail-level-group[open] > .rail-level-summary .rail-level-chevron");
    expect(styles).toMatch(/\.rail-level-steps\s*\{[^}]*flex-direction:\s*column/s);
  });
});
