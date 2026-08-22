#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import {
  createWf51ReleaseOverlayArtifactDirectory,
  writeWf51ReleaseOverlayArtifacts,
} from "./wf51-release-overlay-artifacts.mjs";
import {
  validateWf51FocusedCaseDefinition,
  validateWf51OverlayRowDefinition,
  wf51FocusedCases,
  wf51ReleaseOverlayRows,
} from "./wf51-release-overlay-cases.mjs";
import { qualifyWf51FocusedOverlay } from "./wf51-release-overlay-evidence.mjs";
import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import {
  assertCompleteWf51Recovery,
  createWf51OverlayProgressTracker,
  DEFAULT_WF51_PHASE_TIMEOUT_MS,
  DEFAULT_WF51_RECOVERY_TIMEOUT_MS,
  positiveIntegerFromEnvironment,
  runWithHardDeadline,
  validateWf51RecoveryBoundary,
  Wf51PhaseDeadlineError,
} from "./wf51-release-overlay-runner-lifecycle.mjs";

const execFileAsync = promisify(execFile);
const MODULE_ID = "wayfinder-pf2e";
const POLICY_SETTING = "equipmentPolicy";
const JUDGMENT_SETTING = "equipmentPolicyJudgments";
const ABP_SETTING = "automaticBonusVariant";
const FIXTURE_PREFIX = "WF Smoke Harness - WF-080-51 overlay";
const MARKER_PURPOSE = "wf51-release-overlay";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const suitePath = path.join(repoRoot, "tools", "foundry-smoke", "wf51-release-overlay-browser-suite.js");

function usage() {
  return `Usage: node tools/foundry-smoke/run-wf51-release-overlay.mjs [options]

Options:
  --coordinator-manifest <path>
                         Fresh child-run manifest created by the owning WF-080-51 coordinator.
  --out <path>           Fresh artifact directory override.
  --headed               Run with a visible browser.
  --list                 List focused cases and aggregate rows.
  --help                 Show this help text.

Environment:
  FOUNDRY_URL                         Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER                        Existing GM setup/review/cleanup user.
  FOUNDRY_PASSWORD                    GM password. Optional.
  FOUNDRY_SMOKE_PLAYER_USER           Existing, distinct non-GM actor owner.
  FOUNDRY_SMOKE_PLAYER_PASSWORD       Player password. Optional.
  FOUNDRY_SMOKE_WORLD_ID              Exact guarded world id.
  FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE     true/false. Required for guarded fixture cleanup.
  FOUNDRY_CHROME_PATH                 Chrome/Edge executable path override.
  FOUNDRY_SMOKE_HEADLESS              true/false. Defaults to true.
  FOUNDRY_SMOKE_WF51_PHASE_TIMEOUT_MS Hard deadline for each browser evaluate. Defaults to 300000.
  FOUNDRY_SMOKE_WF51_RECOVERY_TIMEOUT_MS
                                      Hard deadline for recovery operations. Defaults to 120000.
`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) return console.log(usage());
  if (cli.list) {
    for (const entry of wf51FocusedCases) console.log(`focused:${entry.id} - ${entry.label}`);
    for (const entry of wf51ReleaseOverlayRows) console.log(`row:${entry.number} - ${entry.id}`);
    return;
  }
  for (const definition of wf51FocusedCases) assertDefinitions(validateWf51FocusedCaseDefinition(definition));
  for (const definition of wf51ReleaseOverlayRows) assertDefinitions(validateWf51OverlayRowDefinition(definition));
  const options = validateOptions({
    gmUser: process.env.FOUNDRY_USER ?? "",
    playerUser: process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "",
    expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
    allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
  });
  const chromePath = resolveFoundryChromePath();
  if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");

  const evidenceId = randomUUID();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const outDir = await createWf51ReleaseOverlayArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  const phaseTimeoutMs = positiveIntegerFromEnvironment(
    "FOUNDRY_SMOKE_WF51_PHASE_TIMEOUT_MS",
    DEFAULT_WF51_PHASE_TIMEOUT_MS,
  );
  const recoveryTimeoutMs = positiveIntegerFromEnvironment(
    "FOUNDRY_SMOKE_WF51_RECOVERY_TIMEOUT_MS",
    DEFAULT_WF51_RECOVERY_TIMEOUT_MS,
  );
  const progress = createWf51OverlayProgressTracker({ directory: outDir, evidenceId, runId, startedAt });
  await progress.initialize();
  let candidate = emptyCandidate();
  let coordinatorManifest = null;
  let browser = null;
  let gmContext = null;
  let playerContext = null;
  let gmPage;
  let playerPage;
  let boundary = null;
  let setup = null;
  let initial = null;
  let gm = null;
  let verification = null;
  let cleanup = emptyCleanup();
  const recovery = { attempted: false, status: "not-attempted", failures: [] };
  const observabilityFailures = [];
  let runError = null;
  let primaryError = null;
  let stage = "candidate-capture";

  const runPhase = async (
    id,
    operation,
    { closeContext = null, context = null, progressTimeoutMs = null, timeoutMs = null } = {},
  ) => {
    stage = id;
    const reportedTimeoutMs = progressTimeoutMs ?? timeoutMs;
    await progress.startPhase(id, reportedTimeoutMs ? { timeoutMs: reportedTimeoutMs } : {});
    let value;
    try {
      value = timeoutMs
        ? await runWithHardDeadline({
            closeContext: closeContext ?? (() => context?.close()),
            operation,
            phaseId: id,
            timeoutMs,
          })
        : await operation();
    } catch (error) {
      try {
        await progress.failPhase(id, error);
      } catch (progressError) {
        recordObservabilityFailure(observabilityFailures, `${id} failure checkpoint`, progressError);
      }
      throw error;
    }
    try {
      await progress.finishPhase(id);
    } catch (error) {
      recordObservabilityFailure(observabilityFailures, `${id} completion checkpoint`, error);
      throw error;
    }
    return value;
  };

  try {
    candidate = await runPhase("candidate-capture", () =>
      captureCandidate(path.dirname(path.resolve(cli.coordinatorManifest))),
    );
    coordinatorManifest = await runPhase("coordinator-manifest", () =>
      loadCoordinatorManifest(cli.coordinatorManifest, candidate),
    );
    await runPhase("browser-launch", async () => {
      browser = await chromium.launch({
        executablePath: chromePath,
        headless: cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
      });
      gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      playerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      gmPage = await gmContext.newPage();
      playerPage = await playerContext.newPage();
    });
    await runPhase("gm-login", async () => {
      await loginToFoundryWorld(gmPage, {
        foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
        user: options.gmUser,
        password: process.env.FOUNDRY_PASSWORD ?? "",
      });
      await installSuite(gmPage);
    });
    const servedModuleFiles = await runPhase(
      "served-byte-capture",
      () =>
        gmPage.evaluate((payload) => globalThis.__collectWf51ServedModuleFiles(payload), {
          moduleId: MODULE_ID,
          paths: candidate.localModuleFiles.map((entry) => entry.path),
        }),
      { context: gmContext, timeoutMs: phaseTimeoutMs },
    );
    candidate = bindServedFiles(candidate, servedModuleFiles);
    boundary = await runPhase(
      "boundary-capture",
      async () =>
        validateWf51RecoveryBoundary(
          await gmPage.evaluate(
            (payload) => globalThis.__captureWf51ReleaseOverlayBoundary(payload),
            boundaryPayload(options, runId, coordinatorManifest.actorIds),
          ),
          { expectedWorldId: options.expectedWorldId, runId },
        ),
      { context: gmContext, timeoutMs: phaseTimeoutMs },
    );
    setup = await runPhase(
      "fixture-setup",
      () =>
        gmPage.evaluate(
          (payload) => globalThis.__prepareWf51ReleaseOverlay(payload),
          {
            ...sharedPayload({ options, runId, priorActorIds: coordinatorManifest.actorIds }),
            snapshots: boundary.snapshots,
          },
        ),
      { context: gmContext, timeoutMs: phaseTimeoutMs },
    );

    await runPhase("player-login", async () => {
      await loginToFoundryWorld(playerPage, {
        foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
        user: options.playerUser,
        password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
      });
      await installSuite(playerPage);
    });
    initial = await runPhase(
      "player-initial",
      () =>
        playerPage.evaluate(
          (payload) => globalThis.__runWf51PlayerInitial(payload),
          phasePayload(setup, options, runId, setup.playerId),
        ),
      { context: playerContext, timeoutMs: phaseTimeoutMs },
    );

    await runPhase("gm-review-reload", () => reloadSuite(gmPage));
    gm = await runPhase(
      "gm-review",
      () =>
        gmPage.evaluate(
          (payload) => globalThis.__runWf51GmPhase(payload),
          { ...phasePayload(setup, options, runId, setup.gm.id), abpSetting: ABP_SETTING, cases: wf51FocusedCases },
        ),
      { context: gmContext, timeoutMs: phaseTimeoutMs },
    );

    await runPhase("player-verification-reload", () => reloadSuite(playerPage));
    verification = await runPhase(
      "player-verification",
      () =>
        playerPage.evaluate(
          (payload) => globalThis.__runWf51PlayerVerification(payload),
          phasePayload(setup, options, runId, setup.playerId),
        ),
      { context: playerContext, timeoutMs: phaseTimeoutMs },
    );
    stage = "complete";
  } catch (error) {
    primaryError = error;
    runError = serializeError(error);
  } finally {
    const failedStage = runError ? stage : null;
    if (boundary && browser) {
      recovery.attempted = true;
      try {
        const recoveryDeadlineAt = Date.now() + recoveryTimeoutMs;
        const recovered = await runPhase("recovery", async () => {
          if (primaryError instanceof Wf51PhaseDeadlineError && primaryError.contextCloseConfirmed === false) {
            browser = await restartBrowserForRecovery({
              browser,
              chromePath,
              cli,
              deadlineAt: recoveryDeadlineAt,
              timeoutMs: recoveryTimeoutMs,
            });
            gmContext = null;
            gmPage = null;
            playerContext = null;
            playerPage = null;
          }
          const recoverySession = await createRecoveryGmSession({
            browser,
            context: gmContext,
            deadlineAt: recoveryDeadlineAt,
            page: gmPage,
            options,
            recoveryTimeoutMs,
          });
          gmContext = recoverySession.context;
          gmPage = recoverySession.page;
          return runWithHardDeadline({
            closeContext: () => gmContext?.close(),
            operation: () =>
              gmPage.evaluate(
                (payload) => {
                  if (typeof globalThis.__recoverWf51ReleaseOverlay !== "function") {
                    throw new Error(
                      "WF-080-51 requires boundary recovery; __cleanupWf51ReleaseOverlay cannot recover interrupted setup.",
                    );
                  }
                  return globalThis.__recoverWf51ReleaseOverlay(payload);
                },
                recoveryPayload(boundary, options, runId),
              ),
            phaseId: "recovery-evaluate",
            timeoutMs: remainingRecoveryMs(recoveryDeadlineAt, recoveryTimeoutMs),
          });
        }, { progressTimeoutMs: recoveryTimeoutMs });
        cleanup = normalizeCleanupEvidence(recovered);
        assertCompleteWf51Recovery(cleanup);
        recovery.status = "complete";
      } catch (error) {
        recovery.status = "failed";
        recovery.failures.push(serializeError(error));
        cleanup.restorationFailures.push(`recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!runError) {
          primaryError = error;
          runError = serializeError(error);
        }
      }
      try {
        await progress.recordRecovery({
          attempted: recovery.attempted,
          failures: recovery.failures,
          status: recovery.status,
        });
      } catch (error) {
        recordObservabilityFailure(observabilityFailures, "recovery checkpoint", error);
        if (!runError) {
          primaryError = error;
          runError = serializeError(error);
        }
      }
    }
    stage = runError ? (failedStage ?? stage) : "cleanup";
    try {
      if (playerContext) await closeContextWithDeadline(playerContext, "player-context-close");
    } catch (error) {
      cleanup.restorationFailures.push(`player browser close: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (browser) {
      try {
        if (gmContext) await closeFoundryBrowser(gmContext, browser);
        else await browser.close();
      } catch (error) {
        cleanup.restorationFailures.push(`GM browser close: ${error instanceof Error ? error.message : String(error)}`);
        if (!runError) {
          primaryError = error;
          runError = serializeError(error);
        }
      }
    }
    try {
      await progress.finish({
        error: primaryError,
        stage,
        status: runError ? "failed" : "complete",
      });
    } catch (error) {
      recordObservabilityFailure(observabilityFailures, "terminal checkpoint", error);
      if (!runError) {
        runError = serializeError(error);
      }
    }
  }

  const cases = buildFocusedCases({ initial, gm, verification });
  const result = {
    schemaVersion: 1,
    evidenceId,
    runId,
    status: runError ? "failed" : "complete",
    stage,
    startedAt,
    finishedAt: new Date().toISOString(),
    runtime: setup?.runtime ?? null,
    users: { gm: gm?.gm ?? setup?.gm ?? null, player: verification?.player ?? initial?.player ?? null },
    candidate,
    coordinator: {
      runId: coordinatorManifest?.runId ?? null,
      manifestSha256: coordinatorManifest?.sha256 ?? null,
      priorChildCount: coordinatorManifest?.children?.length ?? 0,
      priorActorCleanup: setup?.priorActorCleanup ?? null,
    },
    cases,
    cleanup,
    recovery,
    observability: {
      progressArtifact: path.basename(progress.path),
      failures: observabilityFailures,
    },
    error: runError,
  };
  const qualification = qualifyWf51FocusedOverlay(result);
  await writeWf51ReleaseOverlayArtifacts(outDir, result, qualification);
  console.log(`WF-080-51 artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of cases) console.log(`${entry.status.toUpperCase()} ${entry.id}`);
  if (!qualification.ok) {
    for (const failure of qualification.failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
}

function buildFocusedCases({ initial, gm, verification }) {
  const roles = { gm: gm?.gm ?? null, player: verification?.player ?? initial?.player ?? null };
  const evidenceById = {
    "higher-level-start-boundary": {
      roles,
      request: initial?.start?.request ?? null,
      unauthorizedApproval: initial?.start?.unauthorizedApproval ?? null,
      approval: gm?.approval ?? null,
      approvedAdmission: verification?.start?.approvedAdmission ?? null,
      progressionAdmission: verification?.start?.progressionAdmission ?? null,
      existingImport: initial?.start?.existingImport
        ? {
            ...initial.start.existingImport,
            reload: verification?.start?.existingImportReload ?? null,
          }
        : null,
    },
    "level-5-permanent-recipe": verification?.start?.recipe
      ? {
          roles,
          recipe: verification.start.recipe,
          subject: verification.start.subject,
          recipeSelection: verification.start.recipeSelection,
          higherLevelStartEvidence: verification.start.higherLevelStartEvidence,
          approval: gm?.approval ?? null,
        }
      : null,
    "foreign-economic-handoffs": initial?.handoffs ? { roles, ...initial.handoffs } : null,
    "material-drift-zero-write": gm?.drift ? { roles, ...gm.drift } : null,
    "abp-and-spell-trust": {
      roles,
      abp: gm?.abp ?? null,
      spellAttestation: gm?.spellReview?.attestation ?? null,
      reviewLine: gm?.spellReview?.reviewLine ?? null,
      reviewedByUserId: gm?.spellReview?.reviewedByUserId ?? null,
      reviewedByIsGm: gm?.spellReview?.reviewedByIsGm ?? false,
      gmReceiptDom: gm?.spellReview?.receiptDom ?? null,
      playerReceiptDom: verification?.trust?.receiptDom ?? null,
      apply: initial?.trustApply ?? null,
      playerReload: verification?.trust
        ? {
            draftCleared: verification.trust.draftCleared,
            persistedAttestationCount: verification.trust.persistedAttestationCount,
          }
        : null,
      equipmentApproval: gm?.approval ?? null,
    },
    "planned-grant-routes":
      gm?.grants && initial?.investigatorMaterialization && verification?.grantsDurability
        ? {
            roles,
            ...gm.grants,
            investigatorMaterialization: initial.investigatorMaterialization,
            titanReload: verification.grantsDurability,
          }
        : null,
    "draft-replacement-semantics": initial?.draftReplacement
      ? {
          roles,
          ...initial.draftReplacement,
          reload: verification?.draftReplacementReload ?? null,
        }
      : null,
  };
  return wf51FocusedCases.map((definition) => ({
    id: definition.id,
    status: evidenceById[definition.id] ? "pass" : "fail",
    definitionFingerprint: definition.definitionFingerprint,
    evidence: evidenceById[definition.id],
  }));
}

async function captureCandidate(ignoredArtifactRoot) {
  const [{ stdout: sha }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot }),
  ]);
  const ignoredPrefix = repoRelativePath(ignoredArtifactRoot);
  const dirtyPaths = status
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(
      (entry) =>
        !entry.startsWith(".wayfinder-smoke/") &&
        (!ignoredPrefix || (entry !== ignoredPrefix && !entry.startsWith(`${ignoredPrefix}/`))),
    );
  if (dirtyPaths.length > 0) throw new Error(`WF-080-51 requires a clean candidate: ${dirtyPaths.join(", ")}`);
  const paths = ["module.json", ...(await listJavaScriptFiles(path.join(repoRoot, "scripts"), "scripts"))]
    .map(normalizeModulePath)
    .sort();
  const localModuleFiles = [];
  for (const filePath of paths) {
    const bytes = await readFile(path.join(repoRoot, filePath));
    localModuleFiles.push({ path: filePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return {
    gitSha: sha.trim(),
    dirtyPaths,
    localModuleFiles,
    servedModuleFiles: [],
    servedScriptManifestSha256: null,
  };
}

function repoRelativePath(value) {
  const relative = path.relative(repoRoot, value).replaceAll("\\", "/");
  return relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative) ? relative : null;
}

async function listJavaScriptFiles(directory, relativeRoot) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) paths.push(...(await listJavaScriptFiles(path.join(directory, entry.name), relativePath)));
    else if (entry.isFile() && entry.name.endsWith(".js")) paths.push(relativePath);
  }
  return paths;
}

function bindServedFiles(candidate, servedModuleFiles) {
  const normalized = servedModuleFiles
    .map((entry) => ({ ...entry, path: normalizeModulePath(entry.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const scriptFiles = normalized.filter((entry) => entry.path.endsWith(".js"));
  return {
    ...candidate,
    servedModuleFiles: normalized,
    servedScriptManifestSha256: sha256(canonicalJson(scriptFiles)),
  };
}

async function loadCoordinatorManifest(filePath, candidate) {
  if (!filePath) throw new Error("WF-080-51 focused execution requires --coordinator-manifest from a fresh owning run.");
  const absolutePath = path.resolve(filePath);
  const bytes = await readFile(absolutePath);
  const result = JSON.parse(bytes.toString("utf8"));
  if (
    result?.schemaVersion !== 1 ||
    !result?.runId ||
    result?.candidateSha !== candidate.gitSha ||
    !Array.isArray(result?.children) ||
    result.children.length === 0 ||
    !Array.isArray(result?.actorIds) ||
    result.actorIds.some((entry) => typeof entry !== "string" || !entry)
  ) {
    throw new Error("WF-080-51 coordinator manifest is malformed or belongs to another candidate.");
  }
  return { ...result, sha256: sha256(bytes) };
}

function sharedPayload({ options, runId, priorActorIds }) {
  return {
    abpSetting: ABP_SETTING,
    allowDestructive: options.allowDestructive,
    cases: wf51FocusedCases,
    expectedWorldId: options.expectedWorldId,
    fixturePrefix: FIXTURE_PREFIX,
    judgmentSetting: JUDGMENT_SETTING,
    moduleId: MODULE_ID,
    playerName: options.playerUser,
    policySetting: POLICY_SETTING,
    runId,
    priorActorIds,
  };
}

function boundaryPayload(options, runId, priorActorIds) {
  return {
    abpSetting: ABP_SETTING,
    expectedWorldId: options.expectedWorldId,
    judgmentSetting: JUDGMENT_SETTING,
    moduleId: MODULE_ID,
    playerName: options.playerUser,
    policySetting: POLICY_SETTING,
    priorActorIds,
    runId,
  };
}

function recoveryPayload(boundary, options, runId) {
  return {
    abpSetting: ABP_SETTING,
    allowDestructive: options.allowDestructive,
    expectedWorldId: options.expectedWorldId,
    fixturePrefix: FIXTURE_PREFIX,
    judgmentSetting: JUDGMENT_SETTING,
    markerPurpose: MARKER_PURPOSE,
    moduleId: MODULE_ID,
    policySetting: POLICY_SETTING,
    runId,
    snapshots: boundary.snapshots,
  };
}

function phasePayload(setup, options, runId, expectedUserId) {
  return {
    expectedUserId,
    expectedWorldId: options.expectedWorldId,
    fixtures: setup.fixtures,
    judgmentSetting: JUDGMENT_SETTING,
    moduleId: MODULE_ID,
    runId,
  };
}

async function installSuite(page) {
  await page.addScriptTag({ path: suitePath });
}

async function reloadSuite(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
  await installSuite(page);
}

async function createRecoveryGmSession({ browser, context, deadlineAt, page, options, recoveryTimeoutMs }) {
  let reuseFailure = null;
  if (context && page && !page.isClosed()) {
    try {
      await runWithHardDeadline({
        closeContext: () => context.close(),
        operation: () => reloadSuite(page),
        phaseId: "recovery-page-reload",
        timeoutMs: remainingRecoveryMs(deadlineAt, recoveryTimeoutMs),
      });
      return { context, page, reused: true };
    } catch (error) {
      reuseFailure = error;
      console.warn(`WF-080-51 recovery: existing GM page unavailable: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Wf51PhaseDeadlineError && error.contextCloseConfirmed === false) {
        throw new Error("WF-080-51 refused fresh-session recovery while the prior GM context remained active.", {
          cause: error,
        });
      }
    }
  }
  if (context) {
    const closeTimeoutMs = Math.min(5_000, remainingRecoveryMs(deadlineAt, recoveryTimeoutMs));
    try {
      await closeContextWithDeadline(context, "failed-gm-context-close", closeTimeoutMs);
    } catch (error) {
      if (!page?.isClosed()) {
        throw new Error("WF-080-51 could not quiesce the prior GM context before fresh-session recovery.", {
          cause: error,
        });
      }
    }
  }
  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const freshPage = await freshContext.newPage();
  try {
    await runWithHardDeadline({
      closeContext: () => freshContext.close(),
      operation: async () => {
        await loginToFoundryWorld(freshPage, {
          foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
          user: options.gmUser,
          password: process.env.FOUNDRY_PASSWORD ?? "",
        });
        await installSuite(freshPage);
      },
      phaseId: "recovery-fresh-gm-login",
      timeoutMs: remainingRecoveryMs(deadlineAt, recoveryTimeoutMs),
    });
    return { context: freshContext, page: freshPage, reused: false };
  } catch (error) {
    if (!reuseFailure) throw error;
    throw new AggregateError(
      [reuseFailure, error],
      "WF-080-51 could not recover through the existing or a fresh GM session.",
      { cause: error },
    );
  }
}

async function restartBrowserForRecovery({ browser, chromePath, cli, deadlineAt, timeoutMs }) {
  const closeTimeoutMs = Math.min(10_000, remainingRecoveryMs(deadlineAt, timeoutMs));
  try {
    await runWithHardDeadline({
      closeContext: () => browser.close(),
      contextCloseTimeoutMs: Math.min(5_000, closeTimeoutMs),
      operation: () => browser.close(),
      phaseId: "recovery-browser-quiescence",
      timeoutMs: closeTimeoutMs,
    });
  } catch (error) {
    if (!(error instanceof Wf51PhaseDeadlineError) || error.contextCloseConfirmed !== true) throw error;
  }
  return runWithHardDeadline({
    closeContext: () => undefined,
    operation: () =>
      chromium.launch({
        executablePath: chromePath,
        headless: cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
      }),
    phaseId: "recovery-browser-relaunch",
    timeoutMs: remainingRecoveryMs(deadlineAt, timeoutMs),
  });
}

function remainingRecoveryMs(deadlineAt, timeoutMs) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Wf51PhaseDeadlineError("recovery", timeoutMs);
  return remaining;
}

async function closeContextWithDeadline(context, phaseId, timeoutMs = 5_000) {
  await runWithHardDeadline({
    closeContext: () => context.close(),
    operation: () => context.close(),
    phaseId,
    timeoutMs,
  });
}

function normalizeCleanupEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.restorationFailures)) {
    throw new Error("WF-080-51 recovery did not return cleanup evidence.");
  }
  return { ...emptyCleanup(), ...value, restorationFailures: [...value.restorationFailures] };
}

function recordObservabilityFailure(failures, operation, error) {
  const failure = `${operation}: ${error instanceof Error ? error.message : String(error)}`;
  failures.push(failure);
  console.error(`WF-080-51 observability failure: ${failure}`);
}

function validateOptions(options) {
  const failures = [];
  if (!options.gmUser.trim()) failures.push("An existing GM user is required.");
  if (!options.playerUser.trim()) failures.push("An existing non-GM player is required.");
  if (options.gmUser.trim().toLowerCase() === options.playerUser.trim().toLowerCase()) failures.push("GM and player users must be distinct.");
  if (!options.expectedWorldId.trim()) failures.push("An exact guarded world id is required.");
  if (!options.allowDestructive) failures.push("Guarded fixture cleanup requires destructive opt-in.");
  if (failures.length > 0) throw new Error(failures.join(" "));
  return options;
}

function parseArgs(argv) {
  const options = { coordinatorManifest: "", headed: false, help: false, list: false, outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--out" || arg === "--coordinator-manifest") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--out") options.outDir = value;
      else options.coordinatorManifest = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function emptyCandidate() {
  return { gitSha: null, dirtyPaths: [], localModuleFiles: [], servedModuleFiles: [], servedScriptManifestSha256: null };
}

function emptyCleanup() {
  return {
    attempted: false,
    actorsDeleted: 0,
    actorsMissingAfterCleanup: false,
    actorCountRestored: false,
    policyRestored: false,
    judgmentsRestored: false,
    abpRestored: false,
    restorationFailures: [],
  };
}

function assertDefinitions(failures) {
  if (failures.length > 0) throw new Error(failures.join(" "));
}

function normalizeModulePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\/+|^modules\/[^/]+\//gu, "");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function serializeError(error) {
  const serialized = {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error && typeof error.stack === "string" ? error.stack : null,
  };
  if (error instanceof Wf51PhaseDeadlineError) {
    serialized.phaseId = error.phaseId;
    serialized.timeoutMs = error.timeoutMs;
    serialized.contextCloseConfirmed = error.contextCloseConfirmed;
    serialized.contextCloseError = error.contextCloseError;
  }
  return serialized;
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

await main().catch((error) => {
  console.error(`WF-080-51 release overlay failed before artifact setup: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
