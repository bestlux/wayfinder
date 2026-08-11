import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shellTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const englishLocalization = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8"));
const chineseLocalization = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"));

describe("wayfinder feedback surface", () => {
  it("opens the public issue chooser without giving the new tab control of Foundry", () => {
    expect(shellTemplate).toContain('href="https://github.com/bestlux/wayfinder/issues/new/choose"');
    expect(shellTemplate).toContain('target="_blank"');
    expect(shellTemplate).toContain('rel="noopener noreferrer"');
    expect(shellTemplate).toContain('{{localize "wayfinder-pf2e.App.Feedback"}}');
    expect(shellTemplate).toContain('{{localize "wayfinder-pf2e.App.FeedbackAria"}}');
  });

  it("localizes the visible label and accessible description", () => {
    for (const localization of [englishLocalization, chineseLocalization]) {
      expect(localization["wayfinder-pf2e"].App.Feedback).toBeTruthy();
      expect(localization["wayfinder-pf2e"].App.FeedbackAria).toBeTruthy();
    }
  });
});
