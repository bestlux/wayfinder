import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Wayfinder UX accessibility", () => {
  it("gives each documented app scroll container a stable restoration identity", () => {
    const shell = read("templates/wayfinder-app.hbs");
    const receipt = read("templates/wayfinder/acquisition-receipt.hbs");
    const catalogue = read("templates/wayfinder/starting-equipment-catalogue.hbs");
    const detail = read("templates/wayfinder/starting-equipment-detail.hbs");
    const cart = read("templates/wayfinder/starting-equipment-cart.hbs");

    expect(shell).toContain('class="wizard-step-list" data-wayfinder-scroll-id="wizard-steps"');
    expect(shell).toContain(
      'class="wizard-stage" data-wayfinder-scroll-id="{{#if activePane}}{{activePane.stepId}}:stage{{else}}wizard-stage{{/if}}"'
    );
    expect(receipt).toContain('data-wayfinder-scroll-id="acquisition-receipt"');
    expect(detail).toContain('data-wayfinder-scroll-id="{{activePane.stepId}}:equipment-detail"');
    expect(cart).toContain('data-wayfinder-scroll-id="{{activePane.stepId}}:equipment-cart"');
    expect(catalogue).toContain('data-wayfinder-scroll-id="{{activePane.stepId}}:equipment-source-filters"');
  });

  it("announces picker result counts as polite atomic status text instead of headings", () => {
    const count = read("templates/wayfinder/picker-result-count.hbs");

    expect(
      count.match(/class="picker-result-count" role="status" aria-live="polite" aria-atomic="true"/gu)
    ).toHaveLength(2);
    expect(count).not.toContain("<h4>");
  });

  it("gives equipment level range bounds distinct programmatic group labels", () => {
    const catalogue = read("templates/wayfinder/starting-equipment-catalogue.hbs");

    expect(catalogue).toContain('role="group" aria-labelledby="{{activePane.stepId}}-equipment-level-from-label"');
    expect(catalogue).toContain('id="{{activePane.stepId}}-equipment-level-from-label"');
    expect(catalogue).toContain('role="group" aria-labelledby="{{activePane.stepId}}-equipment-level-through-label"');
    expect(catalogue).toContain('id="{{activePane.stepId}}-equipment-level-through-label"');
  });

  it("globally shortens module motion and disables smooth scrolling for reduced-motion users", () => {
    const styles = read("styles/wayfinder.css");
    const reducedMotion = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedMotion).toContain(".wayfinder-app *");
    expect(reducedMotion).toContain(".wayfinder-feedback *");
    expect(reducedMotion).toContain("animation-delay: -0.01ms !important");
    expect(reducedMotion).toContain("animation-duration: 0.01ms !important");
    expect(reducedMotion).toContain("animation-iteration-count: 1 !important");
    expect(reducedMotion).toContain("scroll-behavior: auto !important");
    expect(reducedMotion).toContain("transition-delay: 0ms !important");
    expect(reducedMotion).toContain("transition-duration: 0.01ms !important");
  });
});

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}
