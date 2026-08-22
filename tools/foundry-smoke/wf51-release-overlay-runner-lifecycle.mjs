import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_WF51_PHASE_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_WF51_RECOVERY_TIMEOUT_MS = 2 * 60_000;
const DEFAULT_CONTEXT_CLOSE_TIMEOUT_MS = 10_000;

export class Wf51PhaseDeadlineError extends Error {
  constructor(phaseId, timeoutMs) {
    super(`WF-080-51 ${phaseId} exceeded its ${timeoutMs} ms hard deadline.`);
    this.name = "Wf51PhaseDeadlineError";
    this.phaseId = phaseId;
    this.timeoutMs = timeoutMs;
    this.contextCloseConfirmed = null;
    this.contextCloseError = null;
  }
}

export function positiveIntegerFromEnvironment(name, fallback, environment = process.env) {
  const raw = environment[name];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds.`);
  }
  return value;
}

export function validateWf51RecoveryBoundary(value, { expectedWorldId, runId }) {
  const snapshots = value?.snapshots;
  const requiredKeys = ["policy", "judgments", "abp", "actorCount"];
  if (
    !snapshots ||
    typeof snapshots !== "object" ||
    Array.isArray(snapshots) ||
    requiredKeys.some((key) => !Object.hasOwn(snapshots, key)) ||
    !Number.isInteger(snapshots.actorCount) ||
    snapshots.actorCount < 0
  ) {
    throw new Error("WF-080-51 boundary capture did not return all exact pre-setup snapshots.");
  }
  if (value?.runId !== runId) {
    throw new Error("WF-080-51 boundary capture returned a different run identity.");
  }
  if (value?.worldId !== expectedWorldId) {
    throw new Error("WF-080-51 boundary capture returned a different world identity.");
  }
  return { snapshots };
}

export function assertCompleteWf51Recovery(cleanup) {
  if (
    cleanup?.attempted !== true ||
    !Number.isInteger(cleanup?.actorsDeleted) ||
    cleanup.actorsDeleted < 0 ||
    cleanup.actorsMissingAfterCleanup !== true ||
    cleanup.actorCountRestored !== true ||
    cleanup.policyRestored !== true ||
    cleanup.judgmentsRestored !== true ||
    cleanup.abpRestored !== true ||
    !Array.isArray(cleanup.restorationFailures) ||
    cleanup.restorationFailures.length !== 0
  ) {
    throw new Error("WF-080-51 recovery returned incomplete actor or setting restoration evidence.");
  }
}

export async function runWithHardDeadline({
  closeContext,
  operation,
  phaseId,
  timeoutMs,
  contextCloseTimeoutMs = DEFAULT_CONTEXT_CLOSE_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void closeForDeadline(closeContext, contextCloseTimeoutMs).then((closeResult) => {
        const error = new Wf51PhaseDeadlineError(phaseId, timeoutMs);
        error.contextCloseConfirmed = closeResult.confirmed;
        error.contextCloseError = closeResult.error;
        reject(error);
      });
    }, timeoutMs);
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (timedOut) return;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (timedOut) return;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export function createWf51OverlayProgressTracker({
  directory,
  evidenceId,
  runId,
  startedAt = new Date().toISOString(),
  clock = () => Date.now(),
  log = console.log,
}) {
  const progressPath = path.join(directory, "wf51-release-overlay-progress.json");
  const phaseStarts = new Map();
  const state = {
    schemaVersion: 1,
    evidenceId,
    runId,
    status: "running",
    stage: "initializing",
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    phases: [],
    recovery: { attempted: false, status: "not-attempted", failures: [] },
    error: null,
  };

  const persist = async () => {
    state.updatedAt = new Date(clock()).toISOString();
    await writeAtomicJson(progressPath, state);
  };

  return {
    path: progressPath,
    state,
    async initialize() {
      await persist();
    },
    async startPhase(id, details = {}) {
      if (phaseStarts.has(id)) throw new Error(`WF-080-51 phase ${id} is already running.`);
      const startedMs = clock();
      const phase = {
        id,
        status: "running",
        startedAt: new Date(startedMs).toISOString(),
        finishedAt: null,
        elapsedMs: null,
        ...details,
      };
      phaseStarts.set(id, { phase, startedMs });
      state.stage = id;
      state.phases.push(phase);
      await persist();
      log(`WF-080-51 ${id}: start${phase.timeoutMs ? ` (deadline ${phase.timeoutMs} ms)` : ""}`);
    },
    async finishPhase(id) {
      const active = requireActivePhase(phaseStarts, id);
      active.phase.status = "complete";
      active.phase.finishedAt = new Date(clock()).toISOString();
      active.phase.elapsedMs = Math.max(0, clock() - active.startedMs);
      phaseStarts.delete(id);
      await persist();
      log(`WF-080-51 ${id}: complete (${active.phase.elapsedMs} ms)`);
    },
    async failPhase(id, error) {
      const active = requireActivePhase(phaseStarts, id);
      active.phase.status = "failed";
      active.phase.finishedAt = new Date(clock()).toISOString();
      active.phase.elapsedMs = Math.max(0, clock() - active.startedMs);
      active.phase.error = serializeError(error);
      phaseStarts.delete(id);
      await persist();
      log(`WF-080-51 ${id}: failed (${active.phase.elapsedMs} ms): ${active.phase.error.message}`);
    },
    async recordRecovery({ attempted, failures, status }) {
      state.recovery = {
        attempted,
        status,
        failures: failures.map(serializeError),
      };
      await persist();
    },
    async finish({ error, stage, status }) {
      state.status = status;
      state.stage = stage;
      state.finishedAt = new Date(clock()).toISOString();
      state.error = error ? serializeError(error) : null;
      await persist();
    },
  };
}

async function writeAtomicJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function closeForDeadline(closeContext, timeoutMs) {
  if (typeof closeContext !== "function") return { confirmed: true, error: null };
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(closeContext)
        .then(
          () => ({ confirmed: true, error: null }),
          (error) => ({ confirmed: false, error: error instanceof Error ? error.message : String(error) }),
        ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ confirmed: false, error: `context close exceeded ${timeoutMs} ms` }),
          timeoutMs,
        );
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function requireActivePhase(phaseStarts, id) {
  const active = phaseStarts.get(id);
  if (!active) throw new Error(`WF-080-51 phase ${id} is not running.`);
  return active;
}

function serializeError(error) {
  if (error && typeof error === "object" && typeof error.message === "string") {
    const serialized = {
      name: typeof error.name === "string" ? error.name : "Error",
      message: error.message,
      stack: typeof error.stack === "string" ? error.stack : null,
    };
    if (
      error instanceof Wf51PhaseDeadlineError ||
      (typeof error.phaseId === "string" && Number.isSafeInteger(error.timeoutMs))
    ) {
      serialized.phaseId = error.phaseId;
      serialized.timeoutMs = error.timeoutMs;
      serialized.contextCloseConfirmed = error.contextCloseConfirmed;
      serialized.contextCloseError = error.contextCloseError;
    }
    return serialized;
  }
  return {
    name: "Error",
    message: String(error),
    stack: null,
  };
}
