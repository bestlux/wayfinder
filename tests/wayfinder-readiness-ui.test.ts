import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const appSource = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
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

  it("exposes truthful autosave state and a retry action without replacing readiness", () => {
    expect(appTemplate).toContain("data-wayfinder-save-status");
    expect(appTemplate).toContain('aria-live="{{draftSave.live}}"');
    expect(appTemplate).toContain("data-wayfinder-save-message");
    expect(appTemplate).toContain('data-wayfinder-action="retry-draft-save"');
    expect(appTemplate).toContain('data-wayfinder-readiness-ready="{{readinessReady}}"');
    expect(footerStyles).toMatch(/\.footer-save-status\s*\{/);
    expect(footerStyles).toMatch(/\.footer-save-status\.error\s*\{/);
    expect(footerStyles).toMatch(/\.footer-save-retry\s*\{/);
  });

  it("keeps draft-protected close handling in the Foundry window", () => {
    expect(appSource).toMatch(/_canDetach\(\): boolean \{\s*return false;\s*\}/);
    expect(appSource).toContain("this.#finalizeClosedState();");
  });

  it("keeps target-level planning available when no guided steps are pending", () => {
    const emptyBranch = appTemplate.slice(
      appTemplate.indexOf('{{else}}\n    <section class="wayfinder-empty wayfinder-empty-planner">')
    );

    expect(emptyBranch).toContain("{{currentLevel}}");
    expect(emptyBranch).toContain("{{targetLevel}}");
    expect(emptyBranch).toContain('data-wayfinder-action="target-down"');
    expect(emptyBranch).toContain('data-wayfinder-action="target-up"');
  });
});
