#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import { loadWayfinderBrowserSuite } from "./shared-browser-suite-lifecycle.mjs";

const MODULE_ID = "wayfinder-pf2e";
const fixturePrefix = "WF Smoke Harness";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function usage() {
  return `Usage: node tools/foundry-smoke/run-draft-persistence-tracer.mjs [options]

Options:
  --out <path>  Fresh artifact directory. Defaults to .wayfinder-smoke/draft-persistence-<timestamp>-<id>.
  --headed      Run with a visible browser.
  --help        Show this help text.

Environment:
  FOUNDRY_URL                         Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER                        Existing GM setup/cleanup user.
  FOUNDRY_PASSWORD                    GM password. Optional.
  FOUNDRY_SMOKE_PLAYER_USER           Existing, distinct non-GM actor owner.
  FOUNDRY_SMOKE_PLAYER_PASSWORD       Player password. Optional.
  FOUNDRY_SMOKE_WORLD_ID              Exact guarded world id.
  FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE     true/false. Required for exact actor cleanup.
  FOUNDRY_CHROME_PATH                 Chrome/Edge executable path override.
  FOUNDRY_SMOKE_HEADLESS              true/false. Defaults to true.
`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }
  const options = validateOptions({
    setupUser: process.env.FOUNDRY_USER ?? "",
    playerUser: process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "",
    allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
    expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
  });
  const chromePath = resolveFoundryChromePath();
  if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");

  const evidenceId = randomUUID();
  const runId = randomUUID();
  const outDir = await createArtifactDirectory(cli.outDir, evidenceId);
  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const headless = cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true);
  const browser = await chromium.launch({ executablePath: chromePath, headless });
  const setupContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
  const setupPage = await setupContext.newPage();
  let playerContext = null;
  let setup = null;
  let gm = null;
  let owner = null;
  let cleanup = null;
  let runFailure = null;

  try {
    await loginToFoundryWorld(setupPage, {
      foundryUrl,
      password: process.env.FOUNDRY_PASSWORD ?? "",
      user: options.setupUser,
    });
    await loadWayfinderBrowserSuite(setupPage);
    setup = await setupPage.evaluate(
      (payload) => globalThis.__prepareWayfinderDraftPersistenceTracer(payload),
      {
        allowDestructive: options.allowDestructive,
        expectedWorldId: options.expectedWorldId,
        fixturePrefix,
        moduleId: MODULE_ID,
        playerName: options.playerUser,
        runId,
      },
    );
    console.log("Draft persistence tracer: guarded actor prepared.");
    gm = await setupPage.evaluate(
      (payload) => globalThis.__runWayfinderDraftPersistenceTracer(payload),
      {
        actorId: setup.actorId,
        expectedRole: "gm",
        expectedUserId: setup.setupUserId,
        expectedWorldId: options.expectedWorldId,
        moduleId: MODULE_ID,
        runId,
      },
    );
    console.log("Draft persistence tracer: GM repeated-save lane finished.");

    playerContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
    const playerPage = await playerContext.newPage();
    await loginToFoundryWorld(playerPage, {
      foundryUrl,
      password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
      user: options.playerUser,
    });
    await loadWayfinderBrowserSuite(playerPage);
    owner = await playerPage.evaluate(
      (payload) => globalThis.__runWayfinderDraftPersistenceTracer(payload),
      {
        actorId: setup.actorId,
        expectedRole: "owner",
        expectedUserId: setup.playerId,
        expectedWorldId: options.expectedWorldId,
        moduleId: MODULE_ID,
        runId,
      },
    );
    console.log("Draft persistence tracer: owner repeated-save and forced-failure lanes finished.");
  } catch (error) {
    runFailure = error;
  } finally {
    if (playerContext) await playerContext.close().catch(() => undefined);
    if (setup) {
      cleanup = await setupPage
        .evaluate(
          (payload) => globalThis.__cleanupWayfinderDraftPersistenceTracer(payload),
          {
            actorId: setup.actorId,
            allowDestructive: options.allowDestructive,
            expectedWorldId: options.expectedWorldId,
            fixtureName: setup.fixtureName,
            moduleId: MODULE_ID,
            runId,
          },
        )
        .catch((error) => ({ actorDeleted: false, error: errorMessage(error) }));
    }
    await closeFoundryBrowser(setupContext, browser);
  }

  const result = qualifyResult({
    evidenceId,
    runId,
    startedAt: new Date().toISOString(),
    setup,
    gm,
    owner,
    cleanup,
    runFailure: runFailure ? errorMessage(runFailure) : null,
  });
  await writeArtifacts(outDir, result);
  console.log(`Draft persistence tracer artifacts: ${path.relative(repoRoot, outDir)}`);
  console.log(result.passed ? "PASS draft-persistence" : `FAIL draft-persistence: ${result.failures.join("; ")}`);
  if (!result.passed) process.exitCode = 1;
}

function qualifyResult(result) {
  const failures = [];
  if (result.runFailure) failures.push(result.runFailure);
  if (result.gm?.repeated?.exactPersistence !== true) failures.push("GM repeated save/close/reopen was not exact.");
  if (result.owner?.repeated?.exactPersistence !== true) failures.push("Owner repeated save/close/reopen was not exact.");
  const transient = result.owner?.faultCases?.transient;
  if (
    transient?.durableUnchangedAfterFailure !== true ||
    transient?.retryVisible !== true ||
    transient?.newestTargetPersisted !== true ||
    !String(transient?.failureMessage ?? "").includes("Network timeout")
  ) {
    failures.push("Transient failure did not preserve the durable draft and retry the newest snapshot.");
  }
  const permanent = result.owner?.faultCases?.permanent;
  if (
    permanent?.durableUnchangedAfterFailure !== true ||
    permanent?.retryHidden !== true ||
    permanent?.noRetryLoop !== true ||
    permanent?.windowStayedOpen !== true ||
    !String(permanent?.failureMessage ?? "").includes("validation rejected")
  ) {
    failures.push("Permanent rejection did not preserve the durable draft with an actionable terminal error.");
  }
  const malformed = result.owner?.faultCases?.malformed;
  if (
    malformed?.durableRestoredExactly !== true ||
    malformed?.retryHidden !== true ||
    !String(malformed?.failureMessage ?? "").includes("restored the last durable draft")
  ) {
    failures.push("Malformed round trip was not rejected with the exact durable draft restored.");
  }
  if (result.cleanup?.actorDeleted !== true) failures.push("Guarded fixture cleanup did not complete.");
  return { ...result, passed: failures.length === 0, failures, finishedAt: new Date().toISOString() };
}

function validateOptions(options) {
  const failures = [];
  if (!options.setupUser.trim()) failures.push("An existing GM setup user is required.");
  if (!options.playerUser.trim()) failures.push("An existing non-GM player is required.");
  if (options.setupUser.trim().toLowerCase() === options.playerUser.trim().toLowerCase()) {
    failures.push("GM setup and non-GM owner users must be distinct.");
  }
  if (!options.expectedWorldId.trim()) failures.push("An exact guarded world id is required.");
  if (!options.allowDestructive) failures.push("Destructive cleanup opt-in is required.");
  if (failures.length > 0) throw new Error(failures.join(" "));
  return options;
}

function parseArgs(argv) {
  const options = { headed: false, help: false, outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --out.");
      options.outDir = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function createArtifactDirectory(configured, evidenceId) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/u, "Z");
  const outDir = configured
    ? path.resolve(repoRoot, configured)
    : path.join(repoRoot, ".wayfinder-smoke", `draft-persistence-${timestamp}-${evidenceId}`);
  await mkdir(outDir, { recursive: false });
  return outDir;
}

async function writeArtifacts(outDir, result) {
  await writeFile(path.join(outDir, "draft-persistence-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const markdown = `# Foundry Draft Persistence Tracer

- Evidence: ${result.evidenceId}
- Foundry: ${result.setup?.runtime?.foundryVersion ?? "unknown"}
- PF2E: ${result.setup?.runtime?.pf2eVersion ?? "unknown"}
- Wayfinder: ${result.setup?.runtime?.moduleVersion ?? "unknown"}
- GM repeated persistence: ${result.gm?.repeated?.exactPersistence === true}
- Owner repeated persistence: ${result.owner?.repeated?.exactPersistence === true}
- Transient retry newest snapshot: ${result.owner?.faultCases?.transient?.newestTargetPersisted === true}
- Permanent rejection terminal: ${result.owner?.faultCases?.permanent?.noRetryLoop === true}
- Malformed round trip restored: ${result.owner?.faultCases?.malformed?.durableRestoredExactly === true}
- Cleanup complete: ${result.cleanup?.actorDeleted === true}
- Qualified: ${result.passed}
- Failures: ${result.failures.join("; ") || "none"}
`;
  await writeFile(path.join(outDir, "draft-persistence-summary.md"), markdown, "utf8");
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

await main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
