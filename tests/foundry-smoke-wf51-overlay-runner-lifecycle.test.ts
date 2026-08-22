import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertCompleteWf51Recovery,
  createWf51OverlayProgressTracker,
  DEFAULT_WF51_PHASE_TIMEOUT_MS,
  positiveIntegerFromEnvironment,
  runWithHardDeadline,
  validateWf51RecoveryBoundary,
  Wf51PhaseDeadlineError,
} from "../tools/foundry-smoke/wf51-release-overlay-runner-lifecycle.mjs";

const runner = readFileSync(resolve("tools/foundry-smoke/run-wf51-release-overlay.mjs"), "utf8");

describe("WF-080-51 overlay runner lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("closes the failed browser context and rejects at the hard phase deadline", async () => {
    vi.useFakeTimers();
    const closeContext = vi.fn(async () => undefined);
    const execution = runWithHardDeadline({
      closeContext,
      operation: () => new Promise(() => undefined),
      phaseId: "player-initial",
      timeoutMs: 1_000,
    });
    const rejection = expect(execution).rejects.toEqual(
      expect.objectContaining({
        name: "Wf51PhaseDeadlineError",
        phaseId: "player-initial",
        timeoutMs: 1_000,
      })
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it("preserves an operation error without closing a healthy context", async () => {
    const closeContext = vi.fn(async () => undefined);
    const original = new Error("fixture setup failed");
    await expect(
      runWithHardDeadline({
        closeContext,
        operation: async () => {
          throw original;
        },
        phaseId: "fixture-setup",
        timeoutMs: 1_000,
      })
    ).rejects.toBe(original);
    expect(closeContext).not.toHaveBeenCalled();
  });

  it("does not return from a deadline until the failed context is quiescent", async () => {
    vi.useFakeTimers();
    let finishClose: () => void = () => undefined;
    const closeContext = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        })
    );
    const execution = runWithHardDeadline({
      closeContext,
      operation: () => new Promise(() => undefined),
      phaseId: "gm-review",
      timeoutMs: 1_000,
    });
    let rejected = false;
    void execution.catch(() => {
      rejected = true;
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(closeContext).toHaveBeenCalledOnce();
    expect(rejected).toBe(false);
    finishClose();
    await expect(execution).rejects.toMatchObject({ contextCloseConfirmed: true });
  });

  it("fails closed after a bounded wait when context closure cannot be confirmed", async () => {
    vi.useFakeTimers();
    const execution = runWithHardDeadline({
      closeContext: () => new Promise(() => undefined),
      contextCloseTimeoutMs: 2_000,
      operation: () => new Promise(() => undefined),
      phaseId: "player-verification",
      timeoutMs: 1_000,
    });
    const rejection = expect(execution).rejects.toMatchObject({
      contextCloseConfirmed: false,
      contextCloseError: "context close exceeded 2000 ms",
    });

    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
  });

  it("writes atomic phase, failure, recovery, and terminal checkpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wf51-runner-progress-"));
    let now = Date.parse("2026-08-21T20:00:00.000Z");
    const messages: string[] = [];
    const tracker = createWf51OverlayProgressTracker({
      directory,
      evidenceId: "evidence-1",
      runId: "run-1",
      startedAt: new Date(now).toISOString(),
      clock: () => now,
      log: (message: string) => messages.push(message),
    });
    try {
      await tracker.initialize();
      await tracker.startPhase("player-initial", { timeoutMs: 600_000 });
      now += 1_250;
      const phaseError = new Wf51PhaseDeadlineError("player-initial", 600_000);
      await tracker.failPhase("player-initial", phaseError);
      await tracker.recordRecovery({
        attempted: true,
        failures: [new Error("settings restore failed")],
        status: "failed",
      });
      now += 250;
      await tracker.finish({ error: phaseError, stage: "player-initial", status: "failed" });

      const progress = JSON.parse(await readFile(tracker.path, "utf8"));
      expect(progress).toMatchObject({
        schemaVersion: 1,
        evidenceId: "evidence-1",
        runId: "run-1",
        status: "failed",
        stage: "player-initial",
        recovery: {
          attempted: true,
          status: "failed",
          failures: [{ name: "Error", message: "settings restore failed" }],
        },
        error: { name: "Wf51PhaseDeadlineError" },
      });
      expect(progress.phases).toEqual([
        expect.objectContaining({
          id: "player-initial",
          status: "failed",
          elapsedMs: 1_250,
          timeoutMs: 600_000,
          error: expect.objectContaining({
            name: "Wf51PhaseDeadlineError",
            message: expect.stringContaining("hard deadline"),
          }),
        }),
      ]);
      expect(messages).toEqual([
        "WF-080-51 player-initial: start (deadline 600000 ms)",
        expect.stringMatching(/^WF-080-51 player-initial: failed \(1250 ms\):/u),
      ]);
      expect((await readdir(directory)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates configurable positive deadlines", () => {
    expect(positiveIntegerFromEnvironment("TIMEOUT", DEFAULT_WF51_PHASE_TIMEOUT_MS, {})).toBe(
      DEFAULT_WF51_PHASE_TIMEOUT_MS
    );
    expect(positiveIntegerFromEnvironment("TIMEOUT", 1, { TIMEOUT: "2500" })).toBe(2_500);
    expect(() => positiveIntegerFromEnvironment("TIMEOUT", 1, { TIMEOUT: "0" })).toThrow(/positive integer/u);
    expect(() => positiveIntegerFromEnvironment("TIMEOUT", 1, { TIMEOUT: "2.5" })).toThrow(/positive integer/u);
  });

  it("validates exact recovery boundaries before fixture setup", () => {
    const snapshots = { abp: "noABP", actorCount: 5, judgments: {}, policy: {} };
    expect(
      validateWf51RecoveryBoundary(
        { runId: "run-1", snapshots, worldId: "testing-world" },
        { expectedWorldId: "testing-world", runId: "run-1" }
      )
    ).toEqual({ snapshots });
    expect(() =>
      validateWf51RecoveryBoundary(
        { snapshots: { actorCount: 5, policy: {} } },
        { expectedWorldId: "testing-world", runId: "run-1" }
      )
    ).toThrow(/all exact pre-setup snapshots/u);
    expect(() =>
      validateWf51RecoveryBoundary(
        { runId: "foreign-run", snapshots },
        { expectedWorldId: "testing-world", runId: "run-1" }
      )
    ).toThrow(/different run identity/u);
    expect(() =>
      validateWf51RecoveryBoundary({ snapshots }, { expectedWorldId: "testing-world", runId: "run-1" })
    ).toThrow(/different run identity/u);
  });

  it("marks incomplete restoration evidence as failed recovery", () => {
    const cleanup = {
      attempted: true,
      actorsDeleted: 3,
      actorsMissingAfterCleanup: true,
      actorCountRestored: true,
      policyRestored: true,
      judgmentsRestored: true,
      abpRestored: true,
      restorationFailures: [],
    };
    expect(() => assertCompleteWf51Recovery(cleanup)).not.toThrow();
    cleanup.policyRestored = false;
    expect(() => assertCompleteWf51Recovery(cleanup)).toThrow(/incomplete actor or setting restoration/u);
  });

  it("captures the pre-setup boundary and carries exact recovery identity", () => {
    expect(runner.indexOf("__captureWf51ReleaseOverlayBoundary")).toBeLessThan(
      runner.indexOf("__prepareWf51ReleaseOverlay")
    );
    expect(runner).toContain("__recoverWf51ReleaseOverlay");
    expect(runner).toContain("markerPurpose: MARKER_PURPOSE");
    expect(runner).toContain("fixturePrefix: FIXTURE_PREFIX");
    expect(runner).toContain("runId,");
    expect(runner).toContain("recoveryPayload(boundary, options, runId)");
    expect(runner).toContain('status: runError ? "failed" : "complete"');
  });
});
