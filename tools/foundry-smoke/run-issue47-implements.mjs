#!/usr/bin/env node
/* global document */

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
const probePath = path.join(repoRoot, "tools/foundry-smoke/issue47-implements-browser.js");
const implementsByName = ["Amulet", "Bell", "Chalice", "Lantern", "Mirror", "Regalia", "Tome", "Wand"];
const cases = [
  ...implementsByName.map((first) => ({ id: `l1-${first.toLowerCase()}`, targetLevel: 1, first })),
  ...implementsByName.map((second, index) => ({ id: `l5-second-${second.toLowerCase()}`, targetLevel: 5, first: implementsByName[(index + 1) % implementsByName.length], second })),
  ...["native-before", "native-after", "final-before", "final-after"].map((fault) => ({ id: `retry-${fault}`, targetLevel: 5, first: "Amulet", second: "Wand", fault })),
  { id: "reviewed-first-change", targetLevel: 1, first: "Bell", initialReviewedFirst: "Amulet" },
];

function usage() {
  return "Usage: node tools/foundry-smoke/run-issue47-implements.mjs --out <fresh-directory> [--module-root <candidate>] [--installed] [--case <id>] [--headed] [--list]\nRequires distinct existing FOUNDRY_USER (GM), FOUNDRY_SMOKE_PLAYER_USER (non-GM owner), exact FOUNDRY_SMOKE_WORLD_ID, and FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1. FOUNDRY_URL defaults to http://127.0.0.1:30047. Password variables are optional and are never written to artifacts. This runner always tests installed assets without routing, compares every served module asset with --module-root, and uses a fresh cache-disabled browser context for every cold reopen. Run in a dedicated disposable world; it temporarily configures the equipment policy and restores it.";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (options.list) return console.log(cases.map((definition) => definition.id).join("\n"));
  const selected = options.caseIds.length ? cases.filter((definition) => options.caseIds.includes(definition.id)) : cases;
  if (!selected.length || options.caseIds.some((id) => !cases.some((definition) => definition.id === id))) throw new Error("Unknown issue 47 case id.");
  const gmUser = process.env.FOUNDRY_USER?.trim() ?? "";
  const playerUser = process.env.FOUNDRY_SMOKE_PLAYER_USER?.trim() ?? "";
  const expectedWorldId = process.env.FOUNDRY_SMOKE_WORLD_ID?.trim() ?? "";
  if (!gmUser || !playerUser || gmUser === playerUser || !expectedWorldId || !["1", "true"].includes(process.env.FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE ?? "")) throw new Error("Configure distinct existing GM/player users, an exact world id, and guarded fixture cleanup opt-in.");
  const base = smokeCases.find((definition) => definition.className === "Thaumaturge");
  if (!base) throw new Error("The maintained Thaumaturge fixture is unavailable.");
  const runId = randomUUID();
  const outDir = path.resolve(options.outDir || path.join(repoRoot, ".wayfinder-smoke", `issue47-implements-${runId}`));
  await mkdir(path.dirname(outDir), { recursive: true });
  await mkdir(outDir, { recursive: false });
  const result = {
    schemaVersion: 1, runId, startedAt: new Date().toISOString(),
    candidate: {
      moduleRoot: options.moduleRoot,
      gitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: options.moduleRoot, encoding: "utf8" }).trim(),
      dirtyPaths: execFileSync("git", ["status", "--short"], { cwd: options.moduleRoot, encoding: "utf8" }).trim().split(/\r?\n/u).filter(Boolean),
      installed: true, browserRouted: false,
    }, cases: [], cleanupFailures: [], assetFailures: [], browserErrors: [], failure: null,
  };
  const files = new Map();
  const reads = [];
  const browser = await chromium.launch({ executablePath: resolveFoundryChromePath(), headless: !options.headed });
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const gmPage = await gmContext.newPage();
  gmPage.on("pageerror", (error) => result.browserErrors.push({ role: "gm", message: error.message }));
  await observeAssets(gmPage, options.moduleRoot, files, result.assetFailures, reads);
  let playerContext = null;
  let playerPage = null;
  let boundary = null;
  let setup = null;
  let activeDefinition = null;
  const payload = { allowDestructive: true, expectedWorldId, moduleId, runId };
  const suiteOptions = { afterSuitePaths: [probePath] };
  const foundryUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:30047";
  const login = async (page, gm) => loginToFoundryWorld(page, { foundryUrl, user: gm ? gmUser : playerUser, password: gm ? process.env.FOUNDRY_PASSWORD ?? "" : process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "" });
  async function coldOwner() {
    await Promise.allSettled([...reads]);
    if (playerContext) await playerContext.close();
    playerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    playerPage = await playerContext.newPage();
    playerPage.on("pageerror", (error) => result.browserErrors.push({ role: "player", caseId: activeDefinition.id, message: error.message }));
    playerPage.on("console", (message) => {
      if (message.type() === "error") {
        result.browserErrors.push({ role: "player", caseId: activeDefinition.id, console: true, message: message.text() });
        console.error(`[issue47-browser:${activeDefinition.id}] ${message.text()}`);
      }
    });
    await observeAssets(playerPage, options.moduleRoot, files, result.assetFailures, reads);
    await login(playerPage, false);
    await loadWayfinderBrowserSuite(playerPage, suiteOptions);
    await playerPage.exposeFunction("__issue47Click", async (selector, confirmation = false) => {
      if (confirmation) {
        if (selector !== 'button[data-action="yes"]') throw new Error("Unexpected confirmation control.");
        await playerPage.locator(".application").filter({ has: playerPage.locator("[data-wayfinder-apply-confirmation]") }).locator(selector).click();
      } else {
        if (!selector.startsWith('[data-wayfinder-action="')) throw new Error("Unexpected Wayfinder control.");
        const app = playerPage.locator(".wayfinder-app").last();
        const isStep = selector.startsWith('[data-wayfinder-action="select-step"]');
        const target = isStep ? `${selector}.step-link` : selector.startsWith('[data-wayfinder-action="select-option"]') ? `${selector}.option-select` : selector;
        const control = app.locator(target);
        if (isStep && !await control.isVisible()) await app.locator(".rail-level-group").filter({ has: playerPage.locator(target) }).locator("summary.rail-level-summary").click();
        await control.click();
      }
    });
    await playerPage.exposeFunction("__issue47Screenshot", async (suffix) => {
      if (!/^[a-z0-9-]+$/u.test(suffix)) throw new Error("Invalid screenshot suffix.");
      const filename = `${activeDefinition.id}-${suffix}.png`;
      const app = playerPage.locator(".wayfinder-app").last();
      if (suffix.startsWith("unavailable-")) {
        const details = app.locator(".picker-unavailable-choices");
        if (!await details.evaluate((element) => element.open)) await details.locator("summary").click();
      }
      if (await app.count()) await app.screenshot({ path: path.join(outDir, filename) });
      else await playerPage.screenshot({ path: path.join(outDir, filename) });
      return filename;
    });
    await playerPage.exposeFunction("__issue47ExerciseUnavailable", async ({ stepId, names }) => {
      if (!["class-branch-first-implement-and-esoterica-level-1", "class-branch-second-implement-level-5"].includes(stepId) || names.some((name) => !["Weapon", "Shield", "Censer"].includes(name))) throw new Error("Invalid unavailable-choice probe.");
      const app = playerPage.locator(".wayfinder-app").last();
      const details = app.locator(".picker-unavailable-choices");
      const summary = details.locator("summary");
      const originalOpen = await details.evaluate((element) => element.open);
      await summary.focus();
      await summary.press("Enter");
      await playerPage.waitForFunction((expected) => document.querySelector(".wayfinder-app .picker-unavailable-choices")?.open === expected, !originalOpen);
      await summary.press("Space");
      await playerPage.waitForFunction((expected) => document.querySelector(".wayfinder-app .picker-unavailable-choices")?.open === expected, originalOpen);
      const search = app.locator(`[data-wayfinder-search][data-step-id="${stepId}"]`);
      const searches = [];
      for (const name of names) {
        await search.fill(name);
        await playerPage.waitForFunction(({ slot, query }) => {
          const results = [...document.querySelectorAll(".wayfinder-app [data-application-part='picker-results']")].find((element) => element.dataset.stepId === slot);
          return results?.dataset.wayfinderRenderedQuery === query && results.dataset.wayfinderResultCount === "0" && document.querySelector(".wayfinder-app .picker-unavailable-choices")?.open === true;
        }, { slot: stepId, query: name });
        const text = await details.innerText();
        if (!text.includes(name)) throw new Error(`Searching ${name} hid its explanation.`);
        searches.push({ name, matchingSelectableChoices: 0, explanationExpanded: true });
      }
      await search.fill("");
      await playerPage.waitForFunction((slot) => [...document.querySelectorAll(".wayfinder-app [data-application-part='picker-results']")].some((element) => element.dataset.stepId === slot && element.dataset.wayfinderRenderedQuery === ""), stepId);
      return { keyboardEnterToggled: true, keyboardSpaceToggled: true, searches };
    });
  }
  async function cleanup() {
    if (!setup) return null;
    await Promise.allSettled([...reads]);
    if (playerContext) { await playerContext.close(); playerContext = null; playerPage = null; }
    await reloadWayfinderBrowserSuite(gmPage, suiteOptions);
    const value = await gmPage.evaluate((data) => globalThis.__cleanupWayfinderEquipmentProfile(data), { ...payload, ...setup, profileId: activeDefinition.id });
    setup = null;
    return value;
  }
  try {
    await login(gmPage, true);
    await loadWayfinderBrowserSuite(gmPage, suiteOptions);
    boundary = await gmPage.evaluate((data) => globalThis.__issue47Implements.captureBoundary(data), payload);
    result.runtime = boundary.runtime;
    for (const definition of selected) {
      activeDefinition = definition;
      const smokeCase = {
        ...base, id: `issue47-${definition.id}`, caseKind: "class", expectedOutcome: undefined,
        targetLevel: definition.targetLevel, expectedStepIds: undefined,
        preferredSelections: {
          ...base.preferredSelections,
          "class-branch-first-implement-and-esoterica-level-1": [definition.initialReviewedFirst ?? definition.first],
          "class-branch-second-implement-level-5": definition.second ? [definition.second] : [],
        },
      };
      const evidence = { id: definition.id, definition, status: "fail" };
      result.cases.push(evidence);
      console.log(`Issue 47 ${definition.id}: prepare guarded Thaumaturge.`);
      try {
        setup = await gmPage.evaluate((data) => globalThis.__prepareWayfinderEquipmentProfile(data), { ...payload, fixturePrefix: "WF Smoke Harness - Issue 47 implements", playerName: playerUser, profile: { id: definition.id, stepId: `starting-equipment-level-${definition.targetLevel}` }, smokeCase });
        const casePayload = { ...payload, definition, setup, smokeCase };
        await coldOwner();
        evidence.initial = await playerPage.evaluate((data) => globalThis.__issue47Implements.initial(data), casePayload);
        let applyInitial = evidence.initial;
        if (definition.initialReviewedFirst) {
          await coldOwner();
          evidence.reReviewed = await playerPage.evaluate((data) => globalThis.__issue47Implements.reopenAndReview(data), { ...casePayload, initial: evidence.initial });
          applyInitial = { ...evidence.initial, savedDraftHash: evidence.reReviewed.savedDraftHash, reviewed: evidence.reReviewed.reviewed, acquisitionIdentity: evidence.reReviewed.acquisitionIdentity };
        }
        await coldOwner();
        evidence.reopened = await playerPage.evaluate((data) => globalThis.__issue47Implements.reopenAndApply(data), { ...casePayload, initial: applyInitial });
        await coldOwner();
        evidence.final = await playerPage.evaluate((data) => globalThis.__issue47Implements.retryAndVerify(data), { ...casePayload, initial: applyInitial, attempted: evidence.reopened });
        evidence.status = evidence.initial.passed && (!evidence.reReviewed || evidence.reReviewed.passed) && evidence.reopened.passed && evidence.final.passed ? "pass" : "fail";
      } catch (error) {
        evidence.error = error instanceof Error ? error.message : String(error);
        console.error(`Issue 47 ${definition.id}: ${evidence.error}`);
        if (playerPage) await playerPage.screenshot({ path: path.join(outDir, `${definition.id}-failure.png`) }).catch(() => undefined);
      } finally {
        try { evidence.cleanup = await cleanup(); }
        catch (error) { result.cleanupFailures.push(`${definition.id}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      console.log(`Issue 47 ${definition.id}: ${evidence.status.toUpperCase()}.`);
      // Stop if cleanup failed: do not compound a lost fixture or policy baseline.
      if (setup) break;
    }
  } catch (error) { result.failure = error instanceof Error ? error.message : String(error); }
  finally {
    if (setup) {
      try { result.recoveryCleanup = await cleanup(); }
      catch (error) { result.cleanupFailures.push(error instanceof Error ? error.message : String(error)); }
    }
    if (boundary) {
      try {
        await reloadWayfinderBrowserSuite(gmPage, suiteOptions);
        result.boundary = await gmPage.evaluate((data) => globalThis.__issue47Implements.verifyBoundary(data), { ...payload, boundary });
      } catch (error) { result.cleanupFailures.push(error instanceof Error ? error.message : String(error)); }
    }
    await Promise.allSettled([...reads]);
    if (playerContext) await playerContext.close().catch(() => undefined);
    await closeFoundryBrowser(gmContext, browser);
    result.finishedAt = new Date().toISOString();
    result.servedModuleFiles = [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
    if (!files.has("scripts/wayfinder.js") || !files.has("scripts/wayfinder-app.js")) result.assetFailures.push("The actual entry and application modules were not observed.");
    result.passed = !result.failure && !result.assetFailures.length && !result.cleanupFailures.length && result.boundary?.unchanged === true && result.cases.length === selected.length && result.cases.every((entry) => entry.status === "pass" && entry.cleanup?.actorMissingAfterCleanup && entry.cleanup?.policyRestored);
    await writeFile(path.join(outDir, "issue47-implements-results.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Issue 47 artifact: ${outDir}`);
    if (!result.passed) process.exitCode = 1;
  }
}

async function observeAssets(page, moduleRoot, files, failures, reads) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  const marker = `/modules/${moduleId}/`;
  const root = path.resolve(moduleRoot);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.includes(marker) || response.request().method() === "HEAD") return;
    reads.push((async () => {
      const relative = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
      const localPath = path.resolve(root, relative);
      if (!localPath.startsWith(`${root}${path.sep}`)) throw new Error("Served module path escaped candidate root.");
      if (!response.ok()) throw new Error(`Module HTTP ${response.status()}: ${relative}`);
      const body = await response.body();
      const local = await readFile(localPath);
      const sha256 = createHash("sha256").update(body).digest("hex");
      if (sha256 !== createHash("sha256").update(local).digest("hex")) throw new Error(`Installed asset differs from candidate: ${relative}`);
      const key = path.relative(root, localPath).replaceAll(path.sep, "/");
      if (files.has(key) && files.get(key).sha256 !== sha256) throw new Error(`Candidate bytes drifted during run: ${key}`);
      files.set(key, { path: key, sha256, bytes: body.length });
    })().catch((error) => failures.push(error instanceof Error ? error.message : String(error))));
  });
}

function parseArgs(argv) {
  const options = { caseIds: [], headed: false, help: false, list: false, moduleRoot: repoRoot, outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--installed") { /* Installed-only by design; accepts the established runner flag. */ }
    else if (["--case", "--out", "--module-root"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--case") options.caseIds.push(value);
      else if (arg === "--out") options.outDir = value;
      else options.moduleRoot = path.resolve(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
