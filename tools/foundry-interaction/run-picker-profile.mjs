#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { smokeCases } from "../foundry-smoke/class-cases.mjs";
import {
  closeFoundryBrowser,
  loginToFoundryWorld,
  resolveFoundryChromePath,
} from "../foundry-smoke/browser-session.mjs";
import {
  buildPickerProfileMarkdown,
  summarizePickerProfile,
  validatePickerFixture,
  validatePickerSample,
} from "./profile-results.mjs";

const MODULE_ID = "wayfinder-pf2e";
const fixturePrefix = "WF Picker Profile";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultProfilePath = path.join(repoRoot, "tools", "foundry-interaction", "spell-picker-profile.json");
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");
const browserSessionPath = path.join(repoRoot, "tools", "foundry-smoke", "browser-session.mjs");
const classCasesPath = path.join(repoRoot, "tools", "foundry-smoke", "class-cases.mjs");
const browserProfilePath = path.join(repoRoot, "tools", "foundry-interaction", "browser-picker-profile.js");
const profileResultsPath = path.join(repoRoot, "tools", "foundry-interaction", "profile-results.mjs");
const defaultArtifactRoot = ".wayfinder-interaction";

function usage() {
  return `Usage: npm run profile:picker -- [options]

Options:
  --profile <path>      Profile JSON. Defaults to tools/foundry-interaction/spell-picker-profile.json.
  --module-root <path>  Candidate module root served to the browser. Defaults to this checkout.
  --module-ref <value>  Human-readable candidate ref recorded with the artifact.
  --out <path>          Artifact directory. Defaults to ${defaultArtifactRoot}/<timestamp>.
  --samples <count>     Development override for measured samples per width.
  --warmups <count>     Development override for warmup samples per width.
  --headed              Run with a visible browser.
  --help                Show this help.

Environment:
  FOUNDRY_URL                         Defaults to http://localhost:30000.
  FOUNDRY_USER                        Foundry user name or label. Required for a fresh login.
  FOUNDRY_PASSWORD                    Optional Foundry password.
  FOUNDRY_CHROME_PATH                 Chrome/Edge executable override.
  FOUNDRY_INTERACTION_WORLD_ID        Required exact world id.
  FOUNDRY_INTERACTION_ALLOW_DESTRUCTIVE=true
                                      Required for guarded fixture cleanup/deletion.
  FOUNDRY_INTERACTION_ARTIFACT_DIR    Artifact directory override.
  FOUNDRY_INTERACTION_HEADLESS        true/false. Defaults to true.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const profile = JSON.parse(await readFile(options.profilePath, "utf8"));
  applyDevelopmentOverrides(profile, options);
  validateProfile(profile, options);
  const smokeCase = smokeCases.find((entry) => entry.id === profile.smokeCaseId);
  if (!smokeCase) {
    throw new Error(`Unknown smoke fixture ${profile.smokeCaseId}.`);
  }

  const chromePath = resolveFoundryChromePath();
  if (!chromePath) {
    throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");
  }
  if (!existsSync(path.join(options.moduleRoot, "module.json"))) {
    throw new Error(`Candidate module root has no module.json: ${options.moduleRoot}`);
  }

  const outDir = resolveOutDir(options.outDir);
  await mkdir(outDir, { recursive: true });
  const candidate = inspectGitCandidate(options.moduleRoot, options.moduleRef);
  const driver = await inspectDriver(options.profilePath);
  const servedFiles = new Map();
  const candidateRouteFailures = [];
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: options.headed ? false : envFlag("FOUNDRY_INTERACTION_HEADLESS", true),
  });
  const browserVersion = browser.version();
  const context = await browser.newContext({ viewport: profile.viewport });
  const page = await context.newPage();
  let fixture = null;
  let cleanup = null;
  const samples = [];

  await installCandidateRoute(page, options.moduleRoot, servedFiles, candidateRouteFailures);
  page.on("console", (message) => {
    if (/error|warn/i.test(message.type())) {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    }
  });

  try {
    await loginToFoundryWorld(page, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      password: process.env.FOUNDRY_PASSWORD ?? "",
      user: process.env.FOUNDRY_USER ?? "",
    });
    assertNoCandidateRouteFailures(candidateRouteFailures);
    await page.addScriptTag({ path: browserSuitePath });

    fixture = await page.evaluate(
      (payload) => globalThis.__prepareWayfinderPickerProfile(payload),
      {
        allowDestructive: options.allowDestructive,
        expectedWorldId: options.expectedWorldId,
        fixturePrefix,
        moduleId: MODULE_ID,
        profile,
        smokeCase,
      },
    );
    assertNoCandidateRouteFailures(candidateRouteFailures);
    const fixtureFailures = validatePickerFixture(profile, fixture, options.expectedWorldId);
    if (fixtureFailures.length > 0) {
      throw new Error(fixtureFailures.join(" "));
    }

    const appRoot = page.locator(
      `[data-wayfinder-profile-actor-id="${cssAttribute(fixture.actorId)}"]`,
    );
    await appRoot.waitFor({ state: "visible", timeout: 30000 });
    const search = appRoot.locator(`[data-wayfinder-search][data-step-id="${cssAttribute(profile.stepId)}"]`);
    try {
      if ((await search.count()) === 0) {
        await appRoot
          .locator(`[data-wayfinder-action="select-step"][data-step-id="${cssAttribute(profile.stepId)}"]`)
          .click();
      }
      await search.waitFor({ state: "visible", timeout: 30000 });
    } catch (error) {
      const domDiagnostic = await appRoot.evaluate((root) => ({
        activeRailStepIds: Array.from(root.querySelectorAll('[data-wayfinder-action="select-step"].active'), (entry) =>
          entry.getAttribute("data-step-id"),
        ),
        railStepIds: Array.from(root.querySelectorAll('[data-wayfinder-action="select-step"]'), (entry) =>
          entry.getAttribute("data-step-id"),
        ),
        searchStepIds: Array.from(root.querySelectorAll("[data-wayfinder-search]"), (entry) =>
          entry.getAttribute("data-step-id"),
        ),
      }));
      const contextDiagnostic = await page.evaluate(async (actorId) => {
        const actor = globalThis.game?.actors?.get(actorId);
        const app = Object.values(actor?.apps ?? {})[0];
        const context = await app?._prepareContext?.();
        return {
          activePaneKeys: context?.activePane ? Object.keys(context.activePane).sort() : [],
          activePaneKind: context?.activePane?.kind ?? null,
          activePaneStepId: context?.activePane?.stepId ?? null,
          isSpellChoice: context?.activePane?.isSpellChoice ?? null,
          templateKind: context?.activePane?.templateKind ?? null,
        };
      }, fixture.actorId);
      await appRoot.screenshot({ path: path.join(outDir, "setup-failure.png") });
      throw new Error(
        `Picker search did not render: ${JSON.stringify({ dom: domDiagnostic, context: contextDiagnostic })}`,
        { cause: error },
      );
    }
    await page.addScriptTag({ path: browserProfilePath });
    await page.evaluate((actorId) => globalThis.__wayfinderPickerProfile.configure({ actorId }), fixture.actorId);

    for (const requestedAppWidth of profile.appWidths) {
      await page.evaluate(
        ({ actorId, width }) => globalThis.__wayfinderPickerProfile.resize({ actorId, width }),
        { actorId: fixture.actorId, width: requestedAppWidth },
      );
      const totalSamples = profile.warmupSamplesPerWidth + profile.measuredSamplesPerWidth;
      for (let index = 0; index < totalSamples; index += 1) {
        const sampleKind = index < profile.warmupSamplesPerWidth ? "warmup" : "measured";
        const sampleIndex =
          sampleKind === "warmup" ? index + 1 : index - profile.warmupSamplesPerWidth + 1;
        await page.evaluate(
          ({ expectedResultCount, stableMs, timeoutMs }) =>
            globalThis.__wayfinderPickerProfile.reset({ expectedResultCount, stableMs, timeoutMs }),
          {
            expectedResultCount: fixture.optionCount,
            stableMs: profile.postSettleMs,
            timeoutMs: profile.settleTimeoutMs,
          },
        );
        await page.evaluate(
          ({ expectedResultNames, expectedResultValues, finalQuery, postSettleMs, settleTimeoutMs }) =>
            globalThis.__wayfinderPickerProfile.beginSample({
              expectedResultNames,
              expectedResultValues,
              finalQuery,
              postSettleMs,
              settleTimeoutMs,
            }),
          {
            expectedResultNames: fixture.expectedResultNames,
            expectedResultValues: fixture.expectedResultValues,
            finalQuery: profile.querySequence.at(-1),
            postSettleMs: profile.postSettleMs,
            settleTimeoutMs: profile.settleTimeoutMs,
          },
        );

        await typeQuerySequence(page, search, profile.querySequence, profile.keyDelayMs);
        const observed = await page.evaluate(() => globalThis.__wayfinderPickerProfile.finishSample());
        const sample = {
          ...observed,
          requestedAppWidth,
          sampleIndex,
          sampleKind,
        };
        sample.failures = validatePickerSample(sample, profile);
        samples.push(sample);

        if (sample.failures.length > 0) {
          const screenshotPath = path.join(
            outDir,
            `failure-${requestedAppWidth}-${sampleKind}-${String(sampleIndex).padStart(2, "0")}.png`,
          );
          await appRoot.screenshot({ path: screenshotPath });
        }
        if (sampleIndex === 1 || sampleIndex % 10 === 0 || sampleIndex === profile.measuredSamplesPerWidth) {
          console.log(
            `Picker profile ${requestedAppWidth}px ${sampleKind} ${sampleIndex}/${sampleKind === "warmup" ? profile.warmupSamplesPerWidth : profile.measuredSamplesPerWidth}`,
          );
        }
      }
    }
  } finally {
    if (fixture?.actorId) {
      cleanup = await page.evaluate(
        (payload) => globalThis.__cleanupWayfinderPickerProfile(payload),
        {
          actorId: fixture.actorId,
          allowDestructive: options.allowDestructive,
          expectedWorldId: options.expectedWorldId,
        },
      );
    }
    await closeFoundryBrowser(context, browser);
  }

  if (cleanup?.actorCountAfter !== fixture.actorCountBefore) {
    throw new Error(
      `Picker fixture cleanup changed actor count: before ${fixture.actorCountBefore}, after ${cleanup?.actorCountAfter}.`,
    );
  }
  assertNoCandidateRouteFailures(candidateRouteFailures);
  const sanitizedFixture = {
    appElementId: fixture.appElementId,
    stepId: fixture.stepId,
    restrictedSpellRarityAccess: fixture.restrictedSpellRarityAccess,
    optionCount: fixture.optionCount,
    expectedResultCount: fixture.expectedResultCount,
    expectedResultNames: fixture.expectedResultNames,
    expectedResultValues: fixture.expectedResultValues,
    packPolicy: fixture.packPolicy,
    actorCountBefore: fixture.actorCountBefore,
    actorCountAfterCreate: fixture.actorCountAfterCreate,
    actorCountAfterCleanup: cleanup.actorCountAfter,
  };
  const result = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    profile,
    candidate,
    driver,
    browser: { version: browserVersion, viewport: profile.viewport },
    runtime: fixture.runtime,
    fixture: sanitizedFixture,
    servedModuleFiles: Array.from(servedFiles.values()).sort((left, right) => left.path.localeCompare(right.path)),
    samples,
    summary: summarizePickerProfile(profile, samples),
  };
  await writeFile(path.join(outDir, "picker-profile-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(outDir, "picker-profile-summary.md"), buildPickerProfileMarkdown(result));
  console.log(`Picker profile artifacts: ${path.relative(repoRoot, outDir)}`);
  console.log(
    `Measured ${result.summary.measuredSampleCount} samples; ${result.summary.failedSampleCount} semantic failures; p95 ${formatMetric(result.summary.p95Ms)}ms.`,
  );
  if (result.summary.failedSampleCount > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    allowDestructive: envFlag("FOUNDRY_INTERACTION_ALLOW_DESTRUCTIVE", false),
    expectedWorldId: String(process.env.FOUNDRY_INTERACTION_WORLD_ID ?? "").trim(),
    headed: false,
    help: false,
    moduleRef: "",
    moduleRoot: repoRoot,
    outDir: process.env.FOUNDRY_INTERACTION_ARTIFACT_DIR ?? "",
    profilePath: defaultProfilePath,
    samples: null,
    warmups: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--headed") {
      options.headed = true;
      continue;
    }
    if (["--profile", "--module-root", "--module-ref", "--out", "--samples", "--warmups"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      if (arg === "--profile") options.profilePath = path.resolve(value);
      if (arg === "--module-root") options.moduleRoot = path.resolve(value);
      if (arg === "--module-ref") options.moduleRef = value;
      if (arg === "--out") options.outDir = value;
      if (arg === "--samples") options.samples = positiveInteger(value, arg);
      if (arg === "--warmups") options.warmups = nonnegativeInteger(value, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function validateProfile(profile, options) {
  if (profile.schemaVersion !== 1 || !profile.id || !profile.smokeCaseId || !profile.stepId) {
    throw new Error("Picker profile must have schemaVersion 1, id, smokeCaseId, and stepId.");
  }
  if (!Array.isArray(profile.appWidths) || profile.appWidths.length === 0) {
    throw new Error("Picker profile must configure at least one app width.");
  }
  if (!Array.isArray(profile.querySequence) || profile.querySequence.length < 2) {
    throw new Error("Picker profile needs at least two query prefixes.");
  }
  for (let index = 1; index < profile.querySequence.length; index += 1) {
    if (
      !profile.querySequence[index].startsWith(profile.querySequence[index - 1]) ||
      profile.querySequence[index].length <= profile.querySequence[index - 1].length
    ) {
      throw new Error("Picker querySequence must contain strictly growing prefixes.");
    }
  }
  if (!options.samples && profile.measuredSamplesPerWidth < 30) {
    throw new Error("Committed picker profiles require at least 30 measured samples per width.");
  }
  if (!options.allowDestructive || !options.expectedWorldId) {
    throw new Error(
      "Set FOUNDRY_INTERACTION_ALLOW_DESTRUCTIVE=true and FOUNDRY_INTERACTION_WORLD_ID for guarded fixture cleanup.",
    );
  }
}

async function typeQuerySequence(page, search, querySequence, keyDelayMs) {
  await search.focus();
  let typed = "";
  for (const query of querySequence) {
    const suffix = query.slice(typed.length);
    await page.keyboard.type(suffix, { delay: keyDelayMs });
    typed = query;
  }
}

async function installCandidateRoute(page, moduleRoot, servedFiles, failures) {
  const marker = `/modules/${MODULE_ID}/`;
  const normalizedRoot = path.resolve(moduleRoot);
  await page.route(`**${marker}**`, async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const markerIndex = requestUrl.pathname.indexOf(marker);
    const relativePath = decodeURIComponent(requestUrl.pathname.slice(markerIndex + marker.length)).replaceAll("/", path.sep);
    const filePath = path.resolve(normalizedRoot, relativePath);
    if (!filePath.startsWith(`${normalizedRoot}${path.sep}`)) {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      const body = await readFile(filePath);
      const relative = path.relative(normalizedRoot, filePath).replaceAll(path.sep, "/");
      const existing = servedFiles.get(relative);
      servedFiles.set(relative, {
        path: relative,
        bytes: body.length,
        requests: (existing?.requests ?? 0) + 1,
        sha256: sha256(body),
      });
      await route.fulfill({
        status: 200,
        body: request.method() === "HEAD" ? undefined : body,
        contentType: contentType(filePath),
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      failures.push(`Candidate module request could not be served: ${relativePath}: ${errorMessage(error)}`);
      await route.abort("failed");
    }
  });
}

function assertNoCandidateRouteFailures(failures) {
  if (failures.length > 0) {
    throw new Error(failures.join(" "));
  }
}

function inspectGitCandidate(root, requestedRef) {
  return {
    root: path.resolve(root),
    requestedRef: requestedRef || null,
    gitSha: git(root, ["rev-parse", "HEAD"]),
    gitDescribe: git(root, ["describe", "--always", "--dirty", "--tags"]),
    dirtyPaths: gitStatusPaths(root),
  };
}

async function inspectDriver(profilePath) {
  const files = [
    browserSuitePath,
    browserSessionPath,
    classCasesPath,
    browserProfilePath,
    profileResultsPath,
    profilePath,
    fileURLToPath(import.meta.url),
  ];
  const dirtyPaths = gitStatusPaths(repoRoot);
  const inputPaths = files.map((filePath) => path.relative(repoRoot, filePath).replaceAll(path.sep, "/"));
  return {
    gitSha: git(repoRoot, ["rev-parse", "HEAD"]),
    dirtyPaths,
    dirtyInputPaths: dirtyPaths.filter((dirtyPath) => inputPaths.includes(dirtyPath.replaceAll(path.sep, "/"))),
    files: await Promise.all(
      files.map(async (filePath) => ({
        path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
        sha256: sha256(await readFile(filePath)),
      })),
    ),
  };
}

function gitStatusPaths(root) {
  return execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  })
    .trimEnd()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function applyDevelopmentOverrides(profile, options) {
  if (options.samples !== null) profile.measuredSamplesPerWidth = options.samples;
  if (options.warmups !== null) profile.warmupSamplesPerWidth = options.warmups;
}

function resolveOutDir(value) {
  if (value) return path.resolve(repoRoot, value);
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return path.join(repoRoot, defaultArtifactRoot, timestamp);
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".hbs": "text/x-handlebars-template; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    }[extension] ?? "application/octet-stream"
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cssAttribute(value) {
  return String(value).replaceAll('"', '\\"');
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function nonnegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a nonnegative integer.`);
  return parsed;
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "n/a";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
