#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import { smokeCases } from "./class-cases.mjs";
import { loadWayfinderBrowserSuite, reloadWayfinderBrowserSuite } from "./shared-browser-suite-lifecycle.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const moduleId = "wayfinder-pf2e";
const browserProbePath = path.join(repoRoot, "tools/foundry-smoke/issue44-equipment-retarget-browser.js");
const cases = [
  { id: "coin-3-to-4", cart: "coin", initialLevel: 3, delta: 1 },
  { id: "coin-3-to-2", cart: "coin", initialLevel: 3, delta: -1 },
  { id: "coin-2-to-1", cart: "coin", initialLevel: 2, delta: -1 },
  { id: "item-3-to-4", cart: "item", initialLevel: 3, delta: 1 },
  { id: "item-3-to-2", cart: "item", initialLevel: 3, delta: -1 },
  { id: "item-2-to-1", cart: "item", initialLevel: 2, delta: -1 },
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node tools/foundry-smoke/run-issue44-equipment-retarget.mjs --out <fresh-path> [--module-root <candidate-path>] [--installed] [--baseline] [--case <id>] [--headed]\nRequires FOUNDRY_USER, FOUNDRY_SMOKE_PLAYER_USER, FOUNDRY_SMOKE_WORLD_ID, FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1. Password environment variables are optional. Module-root routes candidate assets only in the disposable browser contexts; it does not change the installed module. Installed mode disables routing and verifies actual served bytes against module-root.");
    return;
  }
  if (options.list) return console.log(cases.map((entry) => entry.id).join("\n"));
  const selected = options.caseIds.length ? cases.filter((entry) => options.caseIds.includes(entry.id)) : cases;
  if (!selected.length || options.caseIds.some((id) => !cases.some((entry) => entry.id === id))) throw new Error("Unknown case id.");
  const gmUser = process.env.FOUNDRY_USER?.trim() ?? "";
  const playerUser = process.env.FOUNDRY_SMOKE_PLAYER_USER?.trim() ?? "";
  const expectedWorldId = process.env.FOUNDRY_SMOKE_WORLD_ID?.trim() ?? "";
  if (!gmUser || !playerUser || gmUser === playerUser || !expectedWorldId || !envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false)) {
    throw new Error("Configure distinct existing GM/player users, an exact world id, and guarded fixture cleanup opt-in.");
  }
  const guardian = smokeCases.find((entry) => entry.className === "Guardian");
  if (!guardian) throw new Error("The maintained Guardian smoke fixture is unavailable.");
  const runId = randomUUID();
  const outDir = path.resolve(options.outDir || path.join(repoRoot, ".wayfinder-smoke", `issue44-equipment-retarget-${runId}`));
  await mkdir(path.dirname(outDir), { recursive: true });
  await mkdir(outDir, { recursive: false });
  const candidate = {
    moduleRoot: options.moduleRoot,
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: options.moduleRoot, encoding: "utf8" }).trim(),
    dirtyPaths: execFileSync("git", ["status", "--short"], { cwd: options.moduleRoot, encoding: "utf8" }).trim().split(/\r?\n/u).filter(Boolean),
    browserRouted: !options.installed,
  };
  const result = { schemaVersion: 1, runId, mode: options.baseline ? "baseline" : "fixed", startedAt: new Date().toISOString(), candidate, cases: [], cleanupFailures: [], browserLifecycleFailures: [], failure: null };
  const servedFiles = new Map();
  const routeFailures = [];
  const servedReads = [];
  const browser = await chromium.launch({ executablePath: resolveFoundryChromePath(), headless: !options.headed });
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const playerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const gmPage = await gmContext.newPage();
  const playerPage = await playerContext.newPage();
  await playerPage.exposeFunction("__issue44CaptureRecoveredPane", async (caseId) => {
    if (!selected.some((entry) => entry.id === caseId)) throw new Error("Unknown screenshot case id.");
    await playerPage.locator(".wayfinder-app").last().screenshot({ path: path.join(outDir, `${caseId}-recovered.png`) });
    return `${caseId}-recovered.png`;
  });
  let boundary = null;
  let activeSetup = null;
  let activeCase = null;
  const payload = { allowDestructive: true, expectedWorldId, moduleId, runId };
  const installOptions = { afterSuitePaths: [browserProbePath] };
  try {
    if (options.installed) {
      observeInstalledFiles(gmPage, options.moduleRoot, servedFiles, routeFailures, servedReads);
      observeInstalledFiles(playerPage, options.moduleRoot, servedFiles, routeFailures, servedReads);
    } else {
      await routeCandidate(gmPage, options.moduleRoot, servedFiles, routeFailures);
      await routeCandidate(playerPage, options.moduleRoot, servedFiles, routeFailures);
    }
    await loginToFoundryWorld(gmPage, { foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000", user: gmUser, password: process.env.FOUNDRY_PASSWORD ?? "" });
    await loadWayfinderBrowserSuite(gmPage, installOptions);
    boundary = await gmPage.evaluate((value) => globalThis.__issue44Equipment.captureBoundary(value), payload);
    result.runtime = boundary.runtime;
    await loginToFoundryWorld(playerPage, { foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000", user: playerUser, password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "" });
    await loadWayfinderBrowserSuite(playerPage, installOptions);
    for (const definition of selected) {
      activeCase = definition;
      console.log(`Issue 44 ${definition.id}: prepare Guardian draft.`);
      activeSetup = await gmPage.evaluate((value) => globalThis.__prepareWayfinderEquipmentProfile(value), {
        ...payload,
        fixturePrefix: "WF Smoke Harness - Issue 44 retarget",
        playerName: playerUser,
        profile: { id: definition.id, stepId: `starting-equipment-level-${definition.initialLevel}` },
        smokeCase: { ...guardian, targetLevel: definition.initialLevel },
      });
      const casePayload = { ...payload, definition, setup: activeSetup, baseline: options.baseline, smokeCase: { ...guardian, targetLevel: definition.initialLevel + definition.delta } };
      try {
        const initial = await playerPage.evaluate((value) => globalThis.__issue44Equipment.initial(value), casePayload);
        await reloadWayfinderBrowserSuite(playerPage, installOptions);
        const resumed = await playerPage.evaluate((value) => globalThis.__issue44Equipment.resume(value), { ...casePayload, initial });
        await playerPage.screenshot({ path: path.join(outDir, `${definition.id}.png`), fullPage: false });
        result.cases.push({ id: definition.id, initial, resumed, status: resumed.passed ? "pass" : "fail" });
        console.log(`Issue 44 ${definition.id}: ${resumed.passed ? "PASS" : "FAIL"}.`);
      } catch (error) {
        result.cases.push({ id: definition.id, status: "fail", error: error instanceof Error ? error.message : String(error) });
        console.error(`Issue 44 ${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await resetPlayerForCleanup();
        await reloadWayfinderBrowserSuite(gmPage, installOptions);
        const cleanup = await gmPage.evaluate((value) => globalThis.__cleanupWayfinderEquipmentProfile(value), { ...payload, ...activeSetup, profileId: definition.id });
        result.cases.at(-1).cleanup = cleanup;
        activeSetup = null;
      }
    }
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (activeSetup) {
      try {
        await resetPlayerForCleanup();
        await reloadWayfinderBrowserSuite(gmPage, installOptions);
        await gmPage.evaluate((value) => globalThis.__cleanupWayfinderEquipmentProfile(value), { ...payload, ...activeSetup, profileId: activeCase.id });
      } catch (error) { result.cleanupFailures.push(error instanceof Error ? error.message : String(error)); }
    }
    if (boundary) {
      try {
        await reloadWayfinderBrowserSuite(gmPage, installOptions);
        result.boundary = await gmPage.evaluate((value) => globalThis.__issue44Equipment.verifyBoundary(value), { ...payload, boundary });
      } catch (error) { result.cleanupFailures.push(error instanceof Error ? error.message : String(error)); }
    }
    await Promise.allSettled(servedReads);
    await playerContext.close();
    await closeFoundryBrowser(gmContext, browser);
    result.finishedAt = new Date().toISOString();
    result.servedModuleFiles = [...servedFiles.values()].sort((left, right) => left.path.localeCompare(right.path));
    result.routeFailures = routeFailures;
    result.passed = !result.failure && !routeFailures.length && !result.cleanupFailures.length && !result.browserLifecycleFailures.length && result.boundary?.unchanged === true && result.cases.length === selected.length && result.cases.every((entry) => entry.status === "pass" && entry.cleanup?.actorMissingAfterCleanup && entry.cleanup?.policyRestored);
    await writeFile(path.join(outDir, "issue44-equipment-retarget-results.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Issue 44 artifact: ${outDir}`);
    if (!result.passed) process.exitCode = 1;
  }
  async function resetPlayerForCleanup() {
    try { await reloadWayfinderBrowserSuite(playerPage, installOptions); }
    catch (error) {
      result.browserLifecycleFailures.push(error instanceof Error ? error.message : String(error));
      // A failed player renderer must never prevent independent guarded GM cleanup.
      await playerPage.close().catch(() => {});
    }
  }
}

function observeInstalledFiles(page, moduleRoot, files, failures, reads) {
  const marker = `/modules/${moduleId}/`;
  const root = path.resolve(moduleRoot);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.includes(marker) || response.request().method() === "HEAD") return;
    const read = (async () => {
      const relative = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
      const filePath = path.resolve(root, relative);
      if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error("Served path escaped the candidate root.");
      if (!response.ok()) throw new Error(`Installed asset returned HTTP ${response.status()}: ${relative}`);
      const body = await response.body();
      const local = await readFile(filePath);
      const sha256 = createHash("sha256").update(body).digest("hex");
      const expected = createHash("sha256").update(local).digest("hex");
      if (sha256 !== expected) throw new Error(`Installed bytes do not match candidate: ${relative}`);
      const key = path.relative(root, filePath).replaceAll(path.sep, "/");
      const prior = files.get(key);
      if (prior && prior.sha256 !== sha256) throw new Error(`Installed candidate drift: ${key}`);
      files.set(key, { path: key, sha256, bytes: body.length });
    })().catch((error) => failures.push(error instanceof Error ? error.message : String(error)));
    reads.push(read);
  });
}

async function routeCandidate(page, moduleRoot, files, failures) {
  const marker = `/modules/${moduleId}/`;
  const root = path.resolve(moduleRoot);
  await page.route(`**${marker}**`, async (route) => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`)) return route.abort("blockedbyclient");
    try {
      const body = await readFile(filePath);
      const key = path.relative(root, filePath).replaceAll(path.sep, "/");
      const sha256 = createHash("sha256").update(body).digest("hex");
      const prior = files.get(key);
      if (prior && prior.sha256 !== sha256) throw new Error(`Candidate bytes changed during the run: ${key}`);
      files.set(key, { path: key, sha256, bytes: body.length });
      const extension = path.extname(filePath);
      const contentType = ({ ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".hbs": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" })[extension] ?? "application/octet-stream";
      await route.fulfill({ status: 200, body, contentType, headers: { "cache-control": "no-store" } });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      await route.abort("failed");
    }
  });
}

function envFlag(name, fallback) {
  const value = process.env[name];
  return value === undefined ? fallback : ["1", "true"].includes(value);
}

function parseArgs(argv) {
  const options = { baseline: false, headed: false, help: false, installed: false, list: false, moduleRoot: repoRoot, outDir: "", caseIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline") options.baseline = true;
    else if (arg === "--installed") options.installed = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--list") options.list = true;
    else if (["--out", "--module-root", "--case"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--out") options.outDir = value;
      else if (arg === "--module-root") options.moduleRoot = path.resolve(value);
      else options.caseIds.push(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
