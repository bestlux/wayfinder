import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBugReportUrl,
  buildLegalAttributionUrl,
  FEEDBACK_URLS,
  LEGAL_ATTRIBUTION_PATH,
} from "../src/feedback-links.js";

const shellTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const supportTemplate = readFileSync(resolve("templates/feedback-support.hbs"), "utf8");
const supportStyles = readFileSync(resolve("styles/wayfinder/feedback-support.css"), "utf8");
const supportAppSource = readFileSync(resolve("src/feedback-support-app.ts"), "utf8");
const feedbackLinkSource = readFileSync(resolve("src/feedback-links.ts"), "utf8");
const bugReportForm = readFileSync(resolve(".github/ISSUE_TEMPLATE/bug-report.yml"), "utf8");
const featureRequestForm = readFileSync(resolve(".github/ISSUE_TEMPLATE/feature-request.yml"), "utf8");
const issueTemplateConfig = readFileSync(resolve(".github/ISSUE_TEMPLATE/config.yml"), "utf8");
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
    expect(feedbackLinkSource).toContain("issues/new");
    expect(FEEDBACK_URLS.bug).toContain("template=bug-report.yml");
    expect(FEEDBACK_URLS.feature).toContain("template=feature-request.yml");
    expect(bugReportForm).toContain("name: Report a problem");
    expect(featureRequestForm).toContain("name: Suggest an idea");
    expect(supportTemplate).toContain('href="{{urls.bug}}"');
    expect(supportTemplate).toContain('href="{{urls.feature}}"');
    expect(supportTemplate.match(/target="_blank"/g)).toHaveLength(5);
    expect(supportTemplate.match(/rel="noopener noreferrer"/g)).toHaveLength(5);
  });

  it("prefills the versions the bug form would otherwise make the reporter hunt down", () => {
    const url = buildBugReportUrl({ wayfinder: "0.7.1", foundry: "14.364", pf2e: "8.4.0" });
    expect(url).toContain("template=bug-report.yml");
    expect(url).toContain("wayfinder-version=0.7.1");
    expect(url).toContain("foundry-version=14.364");
    expect(url).toContain("pf2e-version=8.4.0");

    for (const field of ["wayfinder-version", "foundry-version", "pf2e-version"]) {
      expect(bugReportForm).toContain(`id: ${field}`);
    }
    expect(buildBugReportUrl({})).toBe("https://github.com/bestlux/wayfinder/issues/new?template=bug-report.yml");
  });

  it("offers a route for reporters who have no GitHub account or no confirmed bug", () => {
    expect(supportTemplate).toContain('href="{{urls.coverage}}"');
    expect(supportTemplate).toContain("wayfinder-pf2e.Feedback.Discord");
    expect(FEEDBACK_URLS.coverage).toContain("/docs/coverage");
    expect(LEGAL_ATTRIBUTION_PATH).toBe("modules/wayfinder-pf2e/LEGAL.md");
    expect(buildLegalAttributionUrl((path) => `/vtt/${path}`)).toBe("/vtt/modules/wayfinder-pf2e/LEGAL.md");
    expect(issueTemplateConfig).toContain("contact_links:");
    expect(issueTemplateConfig).toContain("docs/coverage");
  });

  it("asks for problems in player language rather than defect-report language", () => {
    for (const form of [bugReportForm, featureRequestForm]) {
      expect(form).not.toMatch(/Expected behavior|Actual behavior|Steps to reproduce/);
    }
    expect(bugReportForm).toContain("What were you doing?");
    expect(bugReportForm).toContain("What happened, and what did you expect instead?");
    expect(featureRequestForm).toContain("What got in your way?");
  });

  it("localizes the support journey and gives its links visible keyboard focus", () => {
    for (const localization of [englishLocalization, chineseLocalization]) {
      expect(localization["wayfinder-pf2e"].App.Feedback).toBeTruthy();
      expect(localization["wayfinder-pf2e"].App.FeedbackAria).toBeTruthy();
      expect(localization["wayfinder-pf2e"].App.FeedbackTooltip).toBeTruthy();
      expect(localization["wayfinder-pf2e"].Feedback.ExternalBody).toBeTruthy();
      expect(localization["wayfinder-pf2e"].Settings.Feedback.Hint).toBeTruthy();
      for (const key of ["Prefill", "FallbacksTitle", "CoverageLink", "CoverageHint", "Discord", "Legal"]) {
        expect(localization["wayfinder-pf2e"].Feedback[key]).toBeTruthy();
      }
    }
    expect(supportStyles).toMatch(/\.feedback-destination:focus-visible/);
  });
});
