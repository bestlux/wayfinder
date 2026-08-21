#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { smokeCases } from "../foundry-smoke/class-cases.mjs";
import { loginToFoundryWorld, resolveFoundryChromePath } from "../foundry-smoke/browser-session.mjs";
import {
  summarizeEquipmentProfile,
  validateEquipmentBudgets,
  validateEquipmentFixture,
  validateEquipmentProfile,
  validateEquipmentSample,
} from "./equipment-profile-results.mjs";

const MODULE_ID = "wayfinder-pf2e";
const FIXTURE_PREFIX = "WF Equipment Profile";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultProfilePath = path.join(repoRoot, "tools", "foundry-interaction", "equipment-catalogue-profile.json");
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");
const browserSessionPath = path.join(repoRoot, "tools", "foundry-smoke", "browser-session.mjs");
const classCasesPath = path.join(repoRoot, "tools", "foundry-smoke", "class-cases.mjs");
const browserProfilePath = path.join(repoRoot, "tools", "foundry-interaction", "browser-equipment-profile.js");
const profileResultsPath = path.join(repoRoot, "tools", "foundry-interaction", "equipment-profile-results.mjs");
const evidenceBuilderPath = path.join(repoRoot, "tools", "foundry-interaction", "build-equipment-profile-evidence.mjs");

function usage() {
  return `Usage: npm run profile:equipment -- [options]

Options:
  --module-root <path>  Candidate module root. Defaults to this checkout.
  --module-ref <value>  Human-readable candidate ref.
  --out <path>          Fresh artifact directory.
  --samples <count>     Development-only measured sample override.
  --warmups <count>     Development-only warmup override.
  --headed              Use a visible browser.
  --help                Show help.

Environment:
  FOUNDRY_URL                              Defaults to http://localhost:30000.
  FOUNDRY_USER                             Existing GM setup/cleanup user.
  FOUNDRY_PASSWORD                         Optional GM password.
  FOUNDRY_SMOKE_PLAYER_USER                Existing distinct non-GM owner.
  FOUNDRY_SMOKE_PLAYER_PASSWORD            Optional player password.
  FOUNDRY_INTERACTION_WORLD_ID             Exact guarded world id.
  FOUNDRY_INTERACTION_ALLOW_DESTRUCTIVE    true is required.
  FOUNDRY_CHROME_PATH                      Chrome/Edge override.
  FOUNDRY_INTERACTION_HEADLESS             true/false; defaults true.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const committedProfile = JSON.parse(await readFile(defaultProfilePath, "utf8"));
  const profileFailures = validateEquipmentProfile(committedProfile);
  if (profileFailures.length > 0) throw new Error(profileFailures.join(" "));
  const profile = structuredClone(committedProfile);
  if (options.samples !== null) profile.measuredSamplesPerActionWidth = options.samples;
  if (options.warmups !== null) profile.warmupSamplesPerActionWidth = options.warmups;
  const smokeCase = smokeCases.find((entry) => entry.id === profile.smokeCaseId);
  if (!smokeCase) throw new Error(`Unknown smoke fixture ${profile.smokeCaseId}.`);
  validateGuards(options);
  if (!existsSync(path.join(options.moduleRoot, "module.json"))) {
    throw new Error(`Candidate module root has no module.json: ${options.moduleRoot}`);
  }
  const chromePath = resolveFoundryChromePath();
  if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");

  const runId = randomUUID();
  const outDir = resolveOutDir(options.outDir, runId);
  await mkdir(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const servedFiles = new Map();
  const routeFailures = [];
  let browser = null;
  let candidate = null;
  let driver = null;
  let gmContext = null;
  let playerContext = null;
  let gmPage = null;
  let playerPage;
  let setup = null;
  let preflight = null;
  let cleanup = null;
  let liveFixture;
  let browserVersion = null;
  let failureStage = "candidate-provenance";
  let orchestrationFailure = null;
  let observedRuntime = null;
  const cleanupFailures = [];
  const samples = [];
  try {
    candidate = inspectCandidate(options.moduleRoot, options.moduleRef);
    failureStage = "driver-provenance";
    driver = await inspectDriver();
    failureStage = "browser-launch";
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: options.headed ? false : envFlag("FOUNDRY_INTERACTION_HEADLESS", true),
    });
    browserVersion = browser.version();
    failureStage = "browser-contexts";
    gmContext = await browser.newContext({ viewport: profile.viewport });
    playerContext = await browser.newContext({ viewport: profile.viewport });
    gmPage = await gmContext.newPage();
    playerPage = await playerContext.newPage();
    failureStage = "candidate-routing";
    await installCandidateRoute(gmPage, options.moduleRoot, servedFiles, routeFailures);
    await installCandidateRoute(playerPage, options.moduleRoot, servedFiles, routeFailures);
    failureStage = "gm-login";
    await loginToFoundryWorld(gmPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: process.env.FOUNDRY_USER ?? "",
      password: process.env.FOUNDRY_PASSWORD ?? "",
    });
    failureStage = "runtime-snapshot";
    observedRuntime = await gmPage.evaluate((moduleId) => {
      const foundry = globalThis.game;
      const moduleRecord = foundry.modules.get(moduleId);
      return {
        worldId: foundry.world?.id ?? null,
        locale: foundry.i18n?.lang ?? null,
        foundryVersion: foundry.version ?? null,
        pf2eVersion: foundry.system?.version ?? null,
        moduleVersion: moduleRecord?.version ?? moduleRecord?.manifest?.version ?? null,
      };
    }, MODULE_ID);
    failureStage = "gm-driver-injection";
    await gmPage.addScriptTag({ path: browserSuitePath });
    failureStage = "preflight";
    preflight = await gmPage.evaluate(
      (payload) => globalThis.__preflightWayfinderEquipmentProfile(payload),
      {
        allowDestructive: options.allowDestructive,
        expectedWorldId: options.expectedWorldId,
        moduleId: MODULE_ID,
      },
    );
    failureStage = "fixture-setup";
    setup = await gmPage.evaluate(
      (payload) => globalThis.__prepareWayfinderEquipmentProfile(payload),
      {
        allowDestructive: options.allowDestructive,
        expectedWorldId: options.expectedWorldId,
        fixturePrefix: FIXTURE_PREFIX,
        moduleId: MODULE_ID,
        playerName: options.playerUser,
        profile,
        runId,
        smokeCase,
      },
    );

    failureStage = "player-login";
    await loginToFoundryWorld(playerPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.playerUser,
      password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
    });
    failureStage = "player-driver-injection";
    await playerPage.addScriptTag({ path: browserSuitePath });
    failureStage = "player-open";
    const playerOpen = await playerPage.evaluate(
      (payload) => globalThis.__openWayfinderEquipmentProfile(payload),
      {
        actorId: setup.actorId,
        expectedPlayerId: setup.users.player.id,
        expectedWorldId: options.expectedWorldId,
        moduleId: MODULE_ID,
        profileId: profile.id,
        runId,
      },
    );
    failureStage = "profile-driver-injection";
    await playerPage.addScriptTag({ path: browserProfilePath });
    failureStage = "profile-configure";
    await playerPage.evaluate((actorId) => globalThis.__wayfinderEquipmentProfile.configure({ actorId }), setup.actorId);
    failureStage = "workspace-initialize";
    await playerPage.evaluate(
      (settleTimeoutMs) => globalThis.__wayfinderEquipmentProfile.initializeWorkspace({ settleTimeoutMs }),
      profile.settleTimeoutMs,
    );
    failureStage = "workspace-inspection";
    const inspected = await playerPage.evaluate(() => globalThis.__wayfinderEquipmentProfile.inspect());
    failureStage = "catalogue-counts";
    const catalogueCounts = await playerPage.evaluate(
      (payload) => globalThis.__wayfinderEquipmentProfile.discoverCatalogueCounts(payload),
      {
        finalResultValues: profile.expectedFinalResultValues,
        querySequence: profile.querySequence,
        settleTimeoutMs: profile.settleTimeoutMs,
      },
    );
    liveFixture = {
      ...setup,
      executor: playerOpen.executor,
      catalogueCounts,
      expectedFinalResultValues: [...profile.expectedFinalResultValues],
      finalResultCount: profile.expectedFinalResultValues.length,
      observedInitialVisibleCount: inspected.visibleResultCount,
    };
    failureStage = "fixture-validation";
    const fixtureFailures = validateEquipmentFixture(profile, liveFixture, options.expectedWorldId);
    if (fixtureFailures.length > 0) throw new Error(fixtureFailures.join(" "));

    failureStage = "sampling";
    for (const requestedAppWidth of profile.appWidths) {
      await playerPage.evaluate((width) => globalThis.__wayfinderEquipmentProfile.resize({ width }), requestedAppWidth);
      for (const action of profile.actions) {
        const total = profile.warmupSamplesPerActionWidth + profile.measuredSamplesPerActionWidth;
        for (let index = 0; index < total; index += 1) {
          const sampleKind = index < profile.warmupSamplesPerActionWidth ? "warmup" : "measured";
          const sampleIndex = sampleKind === "warmup" ? index + 1 : index - profile.warmupSamplesPerActionWidth + 1;
          const observed = await playerPage.evaluate(
            (payload) => globalThis.__wayfinderEquipmentProfile.runSample(payload),
            {
              actionId: action.id,
              finalResultValues: profile.expectedFinalResultValues,
              keyDelayMs: profile.keyDelayMs,
              postSettleMs: profile.postSettleMs,
              querySequence: profile.querySequence,
              settleTimeoutMs: profile.settleTimeoutMs,
            },
          );
          const sample = { ...observed, actionId: action.id, requestedAppWidth, sampleIndex, sampleKind };
          sample.failures = validateEquipmentSample(sample, profile);
          samples.push(sample);
          if (sampleIndex === 1 || sampleIndex % 10 === 0 || sampleIndex === profile.measuredSamplesPerActionWidth) {
            console.log(`Equipment profile ${action.id} ${requestedAppWidth}px ${sampleKind} ${sampleIndex}/${sampleKind === "warmup" ? profile.warmupSamplesPerActionWidth : profile.measuredSamplesPerActionWidth}`);
          }
        }
      }
    }
  } catch (error) {
    orchestrationFailure = failureEvidence(failureStage, error);
  } finally {
    try {
      await playerContext?.close();
    } catch (error) {
      cleanupFailures.push(failureEvidence("player-context-close", error));
    }
    try {
      if (preflight && gmPage) {
        cleanup = await gmPage.evaluate(
          (payload) => globalThis.__cleanupWayfinderEquipmentProfile(payload),
          {
            actorId: setup?.actorId ?? null,
            actorName: setup?.actorName ?? `${FIXTURE_PREFIX} - ${profile.id} - ${runId}`,
            allowDestructive: options.allowDestructive,
            expectedWorldId: options.expectedWorldId,
            languageSnapshot: preflight.languageSnapshot,
            moduleId: MODULE_ID,
            policySnapshot: preflight.policySnapshot,
            profileId: profile.id,
            runId,
          },
        );
      }
    } catch (error) {
      cleanupFailures.push(failureEvidence("fixture-cleanup", error));
    }
    try {
      await gmContext?.close();
    } catch (error) {
      cleanupFailures.push(failureEvidence("gm-context-close", error));
    }
    try {
      await browser?.close();
    } catch (error) {
      cleanupFailures.push(failureEvidence("browser-close", error));
    }
  }

  if (preflight) {
    const cleanupProblems = [];
    if (!cleanup) cleanupProblems.push("cleanup evidence is missing");
    if (cleanup?.actorCountAfter !== preflight.actorCountBefore) cleanupProblems.push("actor count was not restored");
    if (cleanup?.actorMissingAfterCleanup !== true) cleanupProblems.push("the exact run marker remains");
    if (cleanup?.policyRestored !== true) cleanupProblems.push("policy was not restored");
    if (cleanup?.languageUnchanged !== true) cleanupProblems.push("language changed");
    if (setup && cleanup?.actorDeleted !== true) cleanupProblems.push("the created actor was not deleted");
    if (cleanupProblems.length > 0) {
      cleanupFailures.push(failureEvidence("cleanup-verification", new Error(cleanupProblems.join("; "))));
    }
  }
  if ((!setup || !liveFixture) && !orchestrationFailure) {
    orchestrationFailure = failureEvidence("fixture-finalization", new Error("Equipment profile did not produce its guarded fixture."));
  }
  const result = buildEquipmentProfileResult({
    browserVersion,
    candidate,
    cleanup,
    cleanupFailures,
    driver,
    liveFixture,
    orchestrationFailure,
    options,
    observedRuntime,
    preflight,
    profile,
    routeFailures,
    runId,
    samples,
    servedFiles: [...servedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
    setup,
    startedAt,
  });
  await writeFile(path.join(outDir, "equipment-profile-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Equipment profile artifacts: ${path.relative(repoRoot, outDir)}`);
  if (result.status === "failed") {
    console.error(`Equipment profile failed at ${result.failure.stage}: ${result.failure.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Measured ${result.summary.measuredSampleCount}; failures ${result.summary.failedSampleCount}; p95 ${result.summary.p95Ms}ms.`);
  if (!result.qualification.passed || result.summary.failedSampleCount > 0) process.exitCode = 1;
}

export function buildEquipmentProfileResult({
  browserVersion,
  candidate,
  cleanup,
  cleanupFailures,
  driver,
  liveFixture,
  orchestrationFailure,
  options,
  observedRuntime,
  preflight,
  profile,
  routeFailures,
  runId,
  samples,
  servedFiles,
  setup,
  startedAt,
}) {
  const summary = summarizeEquipmentProfile(profile, samples);
  const developmentOverride = options.samples !== null || options.warmups !== null;
  const derivedQualification = validateEquipmentBudgets(profile, summary, {
    requireQualificationSamples: !developmentOverride,
  });
  const failed = Boolean(orchestrationFailure) || cleanupFailures.length > 0 || routeFailures.length > 0;
  const failure =
    orchestrationFailure ??
    cleanupFailures[0] ??
    (routeFailures.length > 0 ? failureEvidence("candidate-routing", new Error(routeFailures.join(" "))) : null);
  const qualification = failed
    ? {
        passed: false,
        failures: [
          ...(orchestrationFailure
            ? [`Orchestration failed at ${orchestrationFailure.stage}: ${orchestrationFailure.message}`]
            : []),
          ...cleanupFailures.map((failure) => `Cleanup failed at ${failure.stage}: ${failure.message}`),
          ...routeFailures.map((failure) => `Candidate route failed: ${failure}`),
        ],
      }
    : derivedQualification;
  return {
    schemaVersion: 1,
    status: failed ? "failed" : "completed",
    failure,
    runId,
    runMode:
      profile.expectedCatalogueCounts === null
        ? "measurement"
        : developmentOverride
          ? "development-override"
          : "qualification",
    startedAt,
    finishedAt: new Date().toISOString(),
    profile,
    candidate,
    driver,
    environment: {
      browserVersion,
      nodeVersion: process.version,
      os: { platform: process.platform, release: release(), arch: arch() },
      cpu: { model: cpus()[0]?.model.trim() || "unknown", logicalProcessorCount: cpus().length },
    },
    runtime: setup?.runtime ?? preflight?.runtime ?? observedRuntime ?? null,
    preflight: preflight
      ? {
          actorCountBefore: preflight.actorCountBefore,
          languageSnapshot: preflight.languageSnapshot,
          policySnapshotCaptured: Object.hasOwn(preflight, "policySnapshot"),
        }
      : null,
    fixture: liveFixture || setup ? sanitizeFixture(liveFixture ?? setup) : null,
    cleanup,
    cleanupFailures,
    servedRouteFailures: [...routeFailures],
    servedModuleFiles: servedFiles,
    samples,
    summary,
    qualification,
  };
}

function failureEvidence(stage, error) {
  return {
    stage,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function parseArgs(argv) {
  const options = {
    allowDestructive: envFlag("FOUNDRY_INTERACTION_ALLOW_DESTRUCTIVE", false),
    expectedWorldId: String(process.env.FOUNDRY_INTERACTION_WORLD_ID ?? "").trim(),
    headed: false,
    help: false,
    moduleRef: "",
    moduleRoot: repoRoot,
    outDir: "",
    playerUser: String(process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "").trim(),
    samples: null,
    warmups: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--headed") options.headed = true;
    else if (["--module-root", "--module-ref", "--out", "--samples", "--warmups"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--module-root") options.moduleRoot = path.resolve(value);
      if (arg === "--module-ref") options.moduleRef = value;
      if (arg === "--out") options.outDir = value;
      if (arg === "--samples") options.samples = positiveInteger(value, arg);
      if (arg === "--warmups") options.warmups = nonnegativeInteger(value, arg);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function validateGuards(options) {
  if (!options.allowDestructive || !options.expectedWorldId) {
    throw new Error("Set FOUNDRY_INTERACTION_ALLOW_DESTRUCTIVE=true and FOUNDRY_INTERACTION_WORLD_ID.");
  }
  if (!options.playerUser || !String(process.env.FOUNDRY_USER ?? "").trim()) {
    throw new Error("Configure both FOUNDRY_USER and FOUNDRY_SMOKE_PLAYER_USER.");
  }
  if (options.playerUser === String(process.env.FOUNDRY_USER).trim()) {
    throw new Error("Equipment profile requires distinct GM and non-GM user names.");
  }
}

async function installCandidateRoute(page, moduleRoot, servedFiles, failures) {
  const marker = `/modules/${MODULE_ID}/`;
  const root = path.resolve(moduleRoot);
  await page.route(`**${marker}**`, async (route) => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length)).replaceAll("/", path.sep);
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`)) return route.abort("blockedbyclient");
    try {
      const body = await readFile(filePath);
      const key = path.relative(root, filePath).replaceAll(path.sep, "/");
      const prior = servedFiles.get(key);
      servedFiles.set(key, { path: key, bytes: body.length, requests: (prior?.requests ?? 0) + 1, sha256: sha256(body) });
      await route.fulfill({
        status: 200,
        body: route.request().method() === "HEAD" ? undefined : body,
        contentType: contentType(filePath),
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      failures.push(`Candidate route failed for ${relative}: ${error instanceof Error ? error.message : String(error)}`);
      await route.abort("failed");
    }
  });
}

function inspectCandidate(root, requestedRef) {
  return {
    gitSha: git(root, ["rev-parse", "HEAD"]),
    gitDescribe: git(root, ["describe", "--always", "--dirty", "--tags"]),
    requestedRef: requestedRef || null,
    dirtyPaths: git(root, ["status", "--short"]).split(/\r?\n/).filter(Boolean),
  };
}

async function inspectDriver() {
  const paths = [
    defaultProfilePath,
    browserSuitePath,
    browserSessionPath,
    classCasesPath,
    browserProfilePath,
    profileResultsPath,
    evidenceBuilderPath,
    fileURLToPath(import.meta.url),
  ];
  const files = await Promise.all(paths.map(async (filePath) => ({ path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"), sha256: sha256(await readFile(filePath)) })));
  return { files, sha256: sha256(JSON.stringify(files)) };
}

function sanitizeFixture(fixture) {
  const safe = { ...fixture };
  delete safe.policySnapshot;
  return safe;
}

function resolveOutDir(requested, runId) {
  if (requested) return path.resolve(requested);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(repoRoot, ".wayfinder-interaction", `equipment-${timestamp}-${runId}`);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".js", ".mjs"].includes(extension)) return "text/javascript";
  if (extension === ".json") return "application/json";
  if (extension === ".css") return "text/css";
  if ([".hbs", ".html"].includes(extension)) return "text/html";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function nonnegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a nonnegative integer.`);
  return parsed;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
