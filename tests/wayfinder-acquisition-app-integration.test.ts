import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
const shellTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const receiptTemplate = readFileSync(resolve("templates/wayfinder/acquisition-receipt.hbs"), "utf8");

describe("Wayfinder acquisition app integration", () => {
  it("creates one execution session per attempt and reuses it across normal Apply and recovery", () => {
    const apply = sourceBetween(
      "async #applyDraft()",
      "#createAcquisitionExecutionSession(characterDraft: DraftState)"
    );

    expect(apply.match(/const acquisitionSession = draft\.acquisition/g)).toHaveLength(1);
    expect(apply).toContain("acquisitionExecutionAvailable: acquisitionSession !== null");
    expect(apply).toContain("executeAcquisitionItems: acquisitionSession?.executeAcquisitionItems");
    expect(apply).toContain("executeAcquisitionCurrency: acquisitionSession?.executeAcquisitionCurrency");
    expect(apply).toContain("verifyAcquisitionOutcome: acquisitionSession?.verifyAcquisitionOutcome");
    expect(apply).toContain("readCurrentAcquisitionHistory: acquisitionSession?.readCurrentAcquisitionHistory");
    expect(apply).toContain("acquisitionSession!.prepareRecoveredAcquisitionOutcome({");
    expect(apply).not.toContain("recovery is unavailable until the prepared acquisition executor is active");
  });

  it("renders the durable receipt independently of the active planning pane", () => {
    const receiptInclude = shellTemplate.indexOf("{{#if acquisitionReceipt}}");
    const pendingBranchEnd = shellTemplate.indexOf("{{#if lastAppliedSpellRarityAttestations.length}}");

    expect(receiptInclude).toBeGreaterThan(shellTemplate.indexOf("wayfinder-empty-planner"));
    expect(receiptInclude).toBeLessThan(pendingBranchEnd);
    expect(receiptTemplate).toContain('data-wayfinder-action="open-inventory"');
    expect(receiptTemplate).toContain("wayfinder-pf2e.AcquisitionReceipt.ClassGrant.Summary");
    expect(receiptTemplate).toContain("acquisitionReceipt.authority.higherLevelStartLabel");
    expect(receiptTemplate).toContain("acquisitionReceipt.authority.judgmentIds.length");
  });

  it("projects physical-grant coverage into rendered readiness and Apply's pre-confirm blockers", () => {
    const render = sourceBetween("async _prepareContext(", "_replaceHTML(");
    const apply = sourceBetween(
      "async #applyDraft()",
      "#createAcquisitionExecutionSession(characterDraft: DraftState)"
    );

    expect(render).toContain("const readiness = withPhysicalGrantCoverageReadiness(");
    expect(apply).toContain("const physicalGrantBlockers = physicalGrantCoverageIssues(draft, steps);");
    expect(apply).toContain("additionalBlockers: [...spellRarityBlockers, ...physicalGrantBlockers]");
  });
});

function sourceBetween(start: string, end: string): string {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return appSource.slice(startIndex, endIndex);
}
