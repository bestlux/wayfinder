import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");
const smokeRunner = readFileSync(resolve("tools/foundry-smoke/run-foundry-smoke.mjs"), "utf8");
const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
const sheetControls = readFileSync(resolve("src/sheet-controls.ts"), "utf8");
const bootstrap = readFileSync(resolve("src/wayfinder.ts"), "utf8");

describe("Foundry smoke lifecycle contract", () => {
  it("passes typed step evaluation through every draft lifecycle path", () => {
    expect(browserSuite.match(/modules\.applyDraftLifecycle\(\{/g)).toHaveLength(2);
    expect(
      browserSuite.match(/evaluateStep: \(step\) => evaluateStep\(actor, draft(?:ForApply)?, step, modules\)/g)
    ).toHaveLength(2);
    expect(browserSuite.match(/await applyCompletedDraft\(/g)).toHaveLength(3);
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
    expect(browserSuite).toContain("applyCompletedDraft(actor, draftForApply, stepsForApply, modules, moduleId");
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
    expect(appShell.match(/this\.#assertPersistedApplyCandidateCurrent\(\)/g)).toHaveLength(4);
    expect(appShell).toContain("error.intendedFinalActorUpdate[STATE_FLAG]");
    expect(appShell).toContain(
      "manifestsDescribeSameOutcome(completedAcquisitionManifest, intendedAcquisitionManifest)"
    );
    expect(appShell).toContain(
      "error instanceof DraftApplyPhaseError && error.cause instanceof WayfinderDraftWriteConflictError"
    );
    expect(appShell).toContain("assertFailedApplyRecoveryCandidateCurrent(");
    expect(appShell).toContain("recoverableDraft.applyRecoveryActorUpdate = cloneData(error.recoveryActorUpdate)");
    expect(appShell).toContain("finalizeRecoveredDraft: (recoveryActorUpdate, buildFinalActorUpdate)");
  });

  it("preserves malformed Apply receipts as non-qualifying evidence", () => {
    expect(browserSuite).toContain("identityFields.some(");
    expect(browserSuite).toContain("!Array.isArray(entries)");
    expect(browserSuite).not.toContain("function stringArray(value)");
  });

  it("uses the production actor-authority and rarity-policy checks for every smoke Apply", () => {
    expect(browserSuite.match(/modules\.applyDraftToActor\(/g)).toHaveLength(2);
    expect(browserSuite.match(/validateActorAuthority: modules\.canUseWayfinder/g)).toHaveLength(3);
    expect(browserSuite.match(/spellRarityCeiling: modules\.getSpellRarityCeilingSetting\(\)/g)).toHaveLength(2);
    expect(browserSuite.match(/validateSelectionEligibility: \(selection, step\) =>/g)).toHaveLength(2);
    expect(browserSuite).toContain("finalizeRecoveredDraftOnActor(actor");
    expect(browserSuite).toContain("buildSpellRarityApplyContext(actor, draft, steps, modules)");
    expect(browserSuite).toContain("additionalBlockers: applyContext.additionalBlockers");
    expect(browserSuite).toContain("appliedSpellRarityAttestations: applyContext.appliedSpellRarityAttestations");
    expect(browserSuite).toContain("reviewLines: applyContext.reviewLines");
    expect(browserSuite).toContain("confirmApply: applyContext.confirmApply");
    expect(smokeRunner).toContain("attestation.stepLevel > 1");
  });

  it("routes external draft flag updates into the actor-bound refresh policy", () => {
    expect(bootstrap).toContain("registerWayfinderActorRefresh();");
    expect(bootstrap).toContain("registerPersistedDraftWriteGuardHook();");
    expect(sheetControls).toContain('Hooks.on("updateActor"');
    expect(sheetControls).toContain("actorUpdateTouchesWayfinderDraft(changes, MODULE_ID)");
    expect(sheetControls).toContain("WayfinderApp.refreshDraftFromActorUpdate(actor)");
    expect(appShell).toContain("decideExternalDraftRefresh({");
    expect(appShell).toContain("invalidateOrphanedSpellChoicesForSteps(");
    expect(appShell.match(/persistFinalActorUpdate: \(actorUpdate\) =>/g)).toHaveLength(2);
    expect(appShell).toMatch(/#reconcileLiveRecoveryDraft[\s\S]*?lifecycleBusy: this\.#semanticCommands\.busy/);
    expect(appShell).toMatch(
      /async #refreshPersistedDraft[\s\S]*?lifecycleBusy: this\.#semanticCommands\.barrierActive/
    );
    expect(
      appShell.match(/lifecycleBusy: this\.#semanticCommands\.barrierActive/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
  });
});
