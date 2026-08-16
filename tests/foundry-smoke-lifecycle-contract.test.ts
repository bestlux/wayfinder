import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");
const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");

describe("Foundry smoke lifecycle contract", () => {
  it("passes typed step evaluation through every draft lifecycle path", () => {
    expect(browserSuite.match(/modules\.applyDraftLifecycle\(\{/g)).toHaveLength(3);
    expect(
      browserSuite.match(/evaluateStep: \(step\) => evaluateStep\(actor, draft(?:ForApply)?, step, modules\)/g)
    ).toHaveLength(3);
    expect(browserSuite).not.toMatch(/modules\.applyDraftLifecycle\(\{[\s\S]*?isStepComplete:/);
    expect(browserSuite).toContain("evaluateWayfinderStep: planService.evaluateWayfinderStep");
  });

  it("injects Apply failures through structured execution checkpoints", () => {
    expect(browserSuite).toContain("onCheckpoint: (checkpoint) =>");
    expect(browserSuite).toContain("checkpoint.checkpointId !== checkpointId");
    expect(browserSuite).toContain("observedCheckpoint?.checkpointId !== checkpointId");
    expect(browserSuite).toContain("completedReceipts: Array.isArray(caught?.completedReceipts)");
    expect(browserSuite).not.toContain("beforePhase:");
  });

  it("rebuilds the retry plan from the recovered persisted draft", () => {
    expect(browserSuite).toContain("const retryPlan = await buildPlan(actor, draftForApply, modules)");
    expect(browserSuite).toContain('strategy: "rebuild-from-recovered-draft"');
    expect(browserSuite).toContain("steps: stepsForApply");
    expect(browserSuite).toContain("modules.applyDraftToActor(actor, draftForApply, stepsForApply");
    expect(browserSuite).toContain("persistedDraft.targetLevel === draft.targetLevel");
    expect(browserSuite).toContain("modules.normalizeDraft(persistedDraft, preApplyLevel)");
    expect(browserSuite).not.toContain("draftForApply.applyAttemptStepIds = []");
  });

  it("locks recovered Apply drafts against divergent semantic edits", () => {
    expect(appShell).toContain("hasApplyRecoveryState(this.#requireDraft())");
    expect(appShell).toContain("isDraftMutationAction(action)");
    expect(appShell).toContain('action.type === "clear-draft"');
    expect(appShell).toContain('action.type === "import-existing-history"');
    expect(appShell.match(/if \(!this\.#allowDraftMutation\(\)\)/g)).toHaveLength(2);
    expect(appShell).toContain("&&\n      !this.#allowDraftMutation()\n");
    expect(appShell).not.toContain("recoverableDraft.applyAttemptStepIds = []");
  });

  it("guards every actor-bound draft write and retains deferred recovery paths", () => {
    expect(appShell).toContain("saveDraftWithWriteGuard(this.actor, draft, currentLevel, this.#draftWriteGuard)");
    expect(appShell).toContain("clearDraftWithWriteGuard(this.actor, snapshot.level, this.#draftWriteGuard)");
    expect(appShell).toContain("assertDraftSideEffectAllowed(this.actor");
    expect(appShell.match(/this\.#assertPersistedApplyCandidateCurrent\(\)/g)).toHaveLength(2);
    expect(appShell).toContain("if (error instanceof WayfinderDraftWriteConflictError)");
    expect(appShell).toContain("recoverableDraft.applyRecoveryActorUpdate = cloneData(error.recoveryActorUpdate)");
    expect(appShell).toContain("finalizeRecoveredDraft: (recoveryActorUpdate, buildFinalActorUpdate)");
  });

  it("preserves malformed Apply receipts as non-qualifying evidence", () => {
    expect(browserSuite).toContain("identityFields.some(");
    expect(browserSuite).toContain("!Array.isArray(entries)");
    expect(browserSuite).not.toContain("function stringArray(value)");
  });
});
