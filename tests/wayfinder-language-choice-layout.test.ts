import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const template = readFileSync(resolve("templates/wayfinder/language-choice-pane.hbs"), "utf8");
const styles = readFileSync(resolve("styles/wayfinder/manual-boost-skills.css"), "utf8");

describe("Wayfinder language choice layout", () => {
  it("groups approval options under one disclosure instead of repeating the warning on every card", () => {
    expect(template).toContain('class="language-approval-options"');
    expect(template).toContain("Other languages ({{activePane.approvalOptionCount}})");
    expect(template.match(/Needs GM approval/g)).toHaveLength(1);
    expect(template).toContain("{{#each activePane.sourceOptions}}");
    expect(template).toContain("{{#each activePane.approvalOptions}}");
  });

  it("uses equal-height focusable grid options with accessible selection and approval context", () => {
    expect(template.match(/skill-training-choice-grid/g)).toHaveLength(2);
    expect(template.match(/skill-training-choice-option/g)).toHaveLength(2);
    expect(template.match(/aria-pressed=/g)).toHaveLength(2);
    expect(template).toContain('aria-describedby="{{@root.activePane.stepId}}-gm-approval-note"');
    expect(styles).toMatch(/\.skill-training-choice-grid\s*\{[\s\S]*?grid-auto-rows:\s*3\.5rem/);
    expect(styles).toMatch(/\.language-approval-options summary:focus-visible/);
  });
});
