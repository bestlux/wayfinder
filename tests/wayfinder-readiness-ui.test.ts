import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const footerStyles = readFileSync(resolve("styles/wayfinder/footer-responsive.css"), "utf8");

describe("wayfinder readiness UI", () => {
  it("renders the first Apply blocker as a step-addressable correction action", () => {
    expect(appTemplate).toContain("{{#if applyBlocker}}");
    expect(appTemplate).toContain('data-wayfinder-action="select-step"');
    expect(appTemplate).toContain('data-step-id="{{applyBlocker.stepId}}"');
    expect(appTemplate).toContain('tabindex="-1" data-wayfinder-step-heading="{{activePane.stepId}}"');
    expect(appTemplate).toContain("{{applyBlocker.message}}");
    expect(appTemplate).toContain('aria-label="Apply Changes unavailable. {{applyBlocker.message}}"');
    expect(footerStyles).toMatch(/\.footer-readiness\s*\{/);
  });
});
