import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shellTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const supportTemplate = readFileSync(resolve("templates/feedback-support.hbs"), "utf8");
const supportStyles = readFileSync(resolve("styles/wayfinder/feedback-support.css"), "utf8");
const supportAppSource = readFileSync(resolve("src/feedback-support-app.ts"), "utf8");
const bugReportForm = readFileSync(resolve(".github/ISSUE_TEMPLATE/bug-report.yml"), "utf8");
const featureRequestForm = readFileSync(resolve(".github/ISSUE_TEMPLATE/feature-request.yml"), "utf8");
const englishLocalization = JSON.parse(readFileSync(resolve("lang/en.json"), "utf8"));
const chineseLocalization = JSON.parse(readFileSync(resolve("lang/cn.json"), "utf8"));

describe("wayfinder feedback surface", () => {
  it("preserves the styled template root inside Foundry's window content", () => {
    expect(supportAppSource).not.toContain("root: true");
    expect(supportTemplate).toContain('class="feedback-support-sheet"');
    expect(supportStyles).toContain(".wayfinder-feedback .feedback-support-sheet");
  });

  it("explains the transition before opening a public GitHub form", () => {
    expect(shellTemplate).toContain('data-wayfinder-action="open-feedback"');
    expect(shellTemplate).toContain('data-tooltip="{{localize "wayfinder-pf2e.App.FeedbackTooltip"}}"');
    expect(shellTemplate).toContain('{{localize "wayfinder-pf2e.App.Feedback"}}');
    expect(shellTemplate).toContain('{{localize "wayfinder-pf2e.App.FeedbackAria"}}');
    expect(supportTemplate).toContain("wayfinder-pf2e.Feedback.ExternalTitle");
    expect(supportTemplate).toContain("wayfinder-pf2e.Feedback.ExternalBody");
  });

  it("links to preselected bug and suggestion forms without giving the new tab control of Foundry", () => {
    expect(supportAppSource).toContain("issues/new?template=bug-report.yml");
    expect(supportAppSource).toContain("issues/new?template=feature-request.yml");
    expect(bugReportForm).toContain("name: Bug report");
    expect(featureRequestForm).toContain("name: Feature request or suggestion");
    expect(supportTemplate).toContain('href="{{urls.bug}}"');
    expect(supportTemplate).toContain('href="{{urls.feature}}"');
    expect(supportTemplate.match(/target="_blank"/g)).toHaveLength(3);
    expect(supportTemplate.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
  });

  it("localizes the support journey and gives its links visible keyboard focus", () => {
    for (const localization of [englishLocalization, chineseLocalization]) {
      expect(localization["wayfinder-pf2e"].App.Feedback).toBeTruthy();
      expect(localization["wayfinder-pf2e"].App.FeedbackAria).toBeTruthy();
      expect(localization["wayfinder-pf2e"].App.FeedbackTooltip).toBeTruthy();
      expect(localization["wayfinder-pf2e"].Feedback.ExternalBody).toBeTruthy();
      expect(localization["wayfinder-pf2e"].Settings.Feedback.Hint).toBeTruthy();
    }
    expect(supportStyles).toMatch(/\.feedback-destination:focus-visible/);
  });
});
