import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const rootStyles = readFileSync(resolve("styles/wayfinder/tokens-base.css"), "utf8");
const shellStyles = readFileSync(resolve("styles/wayfinder/shell-layout.css"), "utf8");
const responsiveStyles = readFileSync(resolve("styles/wayfinder/footer-responsive.css"), "utf8");
const equipmentStyles = readFileSync(resolve("styles/wayfinder/starting-equipment.css"), "utf8");

describe("starting equipment responsive layout", () => {
  it("names independent root and stage sizing contexts", () => {
    expect(appTemplate).toContain('<section class="wayfinder-shell">');
    expect(rootStyles).toMatch(/\.window-content\s*\{[^}]*container-type:\s*size/s);
    expect(rootStyles).toMatch(/\.wayfinder-shell\s*\{[^}]*container:\s*wayfinder-root\s*\/\s*inline-size/s);
    expect(shellStyles).toMatch(/\.wizard-stage\s*\{[^}]*container:\s*wayfinder-stage\s*\/\s*inline-size/s);
  });

  it("keys shell and footer breakpoints to the resizable app rather than the browser viewport", () => {
    expect(responsiveStyles).toContain("@container wayfinder-root (max-width: 980px)");
    expect(responsiveStyles).toContain("@container wayfinder-root (max-width: 760px)");
    expect(shellStyles).toMatch(/\.wizard-stage\s*\{[^}]*overflow:\s*auto/s);
    expect(responsiveStyles).not.toContain("@media (max-width: 980px)");
    expect(responsiveStyles).not.toContain("@media (max-width: 760px)");
    expect(responsiveStyles).not.toMatch(/\b(?:d?v[wh])\b/);
  });

  it("adapts the equipment workspace to stage width and the detached receipt to root width", () => {
    expect(equipmentStyles).toContain("@container wayfinder-stage (max-width: 980px)");
    expect(equipmentStyles).toContain("@container wayfinder-stage (max-width: 760px)");
    expect(equipmentStyles).toContain("@container wayfinder-root (max-width: 760px)");
    expect(equipmentStyles).not.toMatch(/@container\s*\(max-width:/);
  });

  it("wraps critical policy, browse, cart, review, handoff, failure, and receipt copy", () => {
    for (const selector of [
      ".equipment-policy-primary,",
      ".equipment-policy-context",
      ".equipment-callout p",
      ".equipment-catalogue-state p",
      ".equipment-source-diagnostics li",
      ".equipment-result {",
      ".equipment-cart-line strong",
      ".equipment-cart footer",
      ".acquisition-receipt-items strong",
      ".wayfinder-acquisition-receipt > footer small",
    ]) {
      expect(equipmentStyles).toContain(selector);
    }
    expect(equipmentStyles).not.toMatch(/\.equipment-(?:result|cart-line)[^{]*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(equipmentStyles).not.toMatch(/\.equipment-(?:result|cart-line)[^{]*\{[^}]*white-space:\s*nowrap/s);
    expect(equipmentStyles).toContain("overflow-wrap: anywhere");
  });
});
