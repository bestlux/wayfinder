#!/usr/bin/env node
/* global document, game */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import { smokeCases } from "./class-cases.mjs";
import { loadWayfinderBrowserSuite, reloadWayfinderBrowserSuite } from "./shared-browser-suite-lifecycle.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const moduleId = "wayfinder-pf2e";
const cases = ["gm", "player"].flatMap((executor) =>
  ["full", "level-one"].map((fill) => ({ id: `${executor}-${fill}-level3`, executor, fill }))
);
const options = {
  out: "",
  cases: [],
  retarget: false,
  delta: 1,
  toLevelOne: false,
  keepItem: false,
  legacyRoot: "",
  resumeRoot: "",
  upgradeRoot: "",
  coowner: false,
  moduleRoot: "",
  apply: false,
  authorityEdge: "",
  installed: false,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  const value = process.argv[++index];
  if (!value) throw new Error(`Missing value for ${arg}`);
  if (arg === "--out") options.out = path.resolve(value);
  else if (arg === "--case") options.cases.push(value);
  else if (arg === "--retarget") options.retarget = value === "1" || value === "true";
  else if (arg === "--to-level-one") options.toLevelOne = value === "1" || value === "true";
  else if (arg === "--cart") {
    if (!["coin", "item"].includes(value)) throw new Error("Cart must be coin or item");
    options.keepItem = value === "item";
  } else if (arg === "--legacy-root") options.legacyRoot = path.resolve(value);
  else if (arg === "--resume-root") options.resumeRoot = path.resolve(value);
  else if (arg === "--upgrade-root") options.upgradeRoot = path.resolve(value);
  else if (arg === "--coowner") options.coowner = value === "1" || value === "true";
  else if (arg === "--module-root") options.moduleRoot = path.resolve(value);
  else if (arg === "--apply") options.apply = value === "1" || value === "true";
  else if (arg === "--installed") options.installed = value === "1" || value === "true";
  else if (arg === "--authority-edge") {
    if (!["policy-gm", "lost-owner"].includes(value)) throw new Error("Unknown authority edge");
    options.authorityEdge = value;
  } else if (arg === "--delta") {
    options.delta = Number(value);
    if (![1, -1].includes(options.delta)) throw new Error("Delta must be 1 or -1");
  } else throw new Error(`Unknown argument ${arg}`);
}
const selected = options.cases.length ? cases.filter((entry) => options.cases.includes(entry.id)) : cases;
if (!selected.length || options.cases.some((id) => !cases.some((entry) => entry.id === id)))
  throw new Error("Unknown outfitter case");
if (
  options.authorityEdge &&
  (selected.some((entry) => entry.executor !== "player") ||
    options.coowner ||
    options.legacyRoot ||
    options.apply ||
    options.retarget)
)
  throw new Error("Authority edges require a player fixture without other scenario modes");
if (
  options.upgradeRoot &&
  (!options.legacyRoot || !options.resumeRoot || !options.coowner || selected.some((entry) => entry.executor !== "gm"))
)
  throw new Error("Upgrade chain requires legacy/resume roots and GM coowner fixture");
if (
  options.apply &&
  (!options.coowner ||
    options.legacyRoot ||
    options.retarget ||
    selected.some((entry) => entry.executor !== "gm" || entry.fill !== "full"))
)
  throw new Error("Apply/retry requires a fully filled fresh GM coowner fixture");
if (options.installed && (options.moduleRoot || options.legacyRoot || options.resumeRoot || options.upgradeRoot))
  throw new Error("Installed qualification requires actual server assets without browser routing");
const expectedWorldId = process.env.FOUNDRY_SMOKE_WORLD_ID;
if (
  !expectedWorldId ||
  !["1", "true"].includes(process.env.FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE) ||
  !process.env.FOUNDRY_USER ||
  !process.env.FOUNDRY_SMOKE_PLAYER_USER
)
  throw new Error("Configure exact world, GM/player users, and guarded cleanup opt-in");
const runId = randomUUID();
const out = options.out || path.join(root, ".wayfinder-smoke", `issue44-outfitter-${runId}`);
await mkdir(path.dirname(out), { recursive: true });
await mkdir(out, { recursive: false });
const dirtyPaths = () =>
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }));
const result = {
  schemaVersion: 1,
  runId,
  startedAt: new Date().toISOString(),
  candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirtyPaths: dirtyPaths(),
  cases: [],
  failure: null,
  cleanupFailures: [],
  browserErrors: [],
  screenshots: [],
  candidateVersion: JSON.parse(await readFile(path.join(root, "module.json"), "utf8")).version,
};
if (options.installed && result.dirtyPaths.length)
  throw new Error("Installed qualification requires a clean committed candidate");
const browser = await chromium.launch({ executablePath: resolveFoundryChromePath(), headless: true });
const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const playerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const gm = await gmContext.newPage();
const player = await playerContext.newPage();
const routeRoots = new Map([
  [gm, options.legacyRoot || options.moduleRoot],
  [player, options.legacyRoot || options.moduleRoot],
]);
result.packageRoutes = {};
result.servedPackageFiles = [];
result.routeFailures = [];
const servedDigests = new Map();
const expectedFaults = new Map();
const responseChecks = new Set();
for (const [label, moduleRoot] of [
  ["legacy", options.legacyRoot],
  ["resume", options.resumeRoot],
  ["candidate", options.moduleRoot],
  ["upgrade", options.upgradeRoot],
])
  if (moduleRoot)
    result.packageRoutes[label] = {
      root: moduleRoot,
      version: JSON.parse(await readFile(path.join(moduleRoot, "module.json"), "utf8")).version,
    };
const installOptions = {
  afterSuitePaths: [
    path.join(root, "tools/foundry-smoke/issue44-equipment-retarget-browser.js"),
    path.join(root, "tools/foundry-smoke/issue44-outfitter-interaction-browser.js"),
  ],
};
const payload = { allowDestructive: true, expectedWorldId, moduleId, runId };
let setup = null;
let definition = null;
let boundary = null;
for (const page of [gm, player]) {
  if (options.installed) {
    const network = await page.context().newCDPSession(page);
    await network.send("Network.enable");
    await network.send("Network.setCacheDisabled", { cacheDisabled: true });
    page.on("response", (response) => {
      const url = new URL(response.url());
      const marker = `/modules/${moduleId}/`;
      if (!url.pathname.startsWith(marker)) return;
      const check = (async () => {
        const relative = decodeURIComponent(url.pathname.slice(marker.length));
        const file = path.resolve(root, relative);
        if (!file.startsWith(`${root}${path.sep}`))
          throw new Error(`Installed response path escaped candidate: ${relative}`);
        if (response.status() !== 200) throw new Error(`Installed asset returned ${response.status()}: ${relative}`);
        const actual = createHash("sha256")
          .update(await response.body())
          .digest("hex");
        const expected = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
        if (actual !== expected)
          throw new Error(`Installed asset body differs from the committed candidate: ${relative}`);
        const key = `${root}|${relative}`;
        if (servedDigests.has(key) && servedDigests.get(key) !== actual)
          throw new Error(`Installed bytes changed during the run: ${relative}`);
        if (!servedDigests.has(key))
          result.servedPackageFiles.push({ root, path: relative, sha256: actual, actualResponseVerified: true });
        servedDigests.set(key, actual);
      })().catch((error) => result.routeFailures.push(error instanceof Error ? error.message : String(error)));
      responseChecks.add(check);
      check.finally(() => responseChecks.delete(check));
    });
  }
  const recordBrowserError = (kind, text) => {
    if (result.browserErrors.length >= 40) return;
    const message = text
      .replace(
        /(?:password|token|secret|authorization|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)/giu,
        "[redacted]"
      )
      .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/giu, "$1?[redacted]")
      .slice(0, 2048);
    const actorId = setup?.actorId ?? null;
    const expectedFault = expectedFaults.get(actorId);
    let expectedInjectedFault = false;
    if (
      options.apply &&
      actorId &&
      expectedFault?.page === page &&
      kind === "console-error" &&
      expectedFault.stage === "armed" &&
      message.startsWith("PF2E Wayfinder failed to apply draft DraftApplyPhaseError:") &&
      message.split("\n")[0].endsWith(`Intentional outfitter fixture final update failure ${actorId}`)
    ) {
      expectedInjectedFault = true;
      expectedFault.stage = "notification";
    } else if (
      options.apply &&
      actorId &&
      expectedFault?.page === page &&
      kind === "console-error" &&
      expectedFault.stage === "notification" &&
      message.trim() === "Couldn't apply the changes. Your draft is intact. Take a look and try again."
    ) {
      expectedInjectedFault = true;
      expectedFault.stage = "complete";
    } else if (expectedFault) {
      expectedFaults.delete(actorId);
    }
    result.browserErrors.push({
      kind,
      executor: page === gm ? "gm" : "player",
      actorId,
      message,
      expectedInjectedFault,
    });
  };
  page.on("pageerror", (error) => recordBrowserError("pageerror", error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") recordBrowserError("console-error", entry.text());
  });
  await page.exposeFunction("__issue44OutfitterFault", async ({ actorId, phase }) => {
    if (!options.apply || !setup || actorId !== setup.actorId)
      throw new Error("Fault target is not the guarded Apply fixture");
    if (phase === "armed") {
      if (expectedFaults.has(actorId)) throw new Error("Fixture fault was already armed");
      expectedFaults.set(actorId, { page, stage: "armed" });
      return { armed: true };
    }
    const complete = expectedFaults.get(actorId)?.page === page && expectedFaults.get(actorId)?.stage === "complete";
    expectedFaults.delete(actorId);
    if (!complete)
      throw new Error(
        "The exact intentional fixture error and immediate companion notification were not both observed"
      );
    return { errorPairObserved: true };
  });
  await page.exposeFunction("__issue44OutfitterApprove", async ({ actorId, requestId }) => {
    if (!setup || actorId !== setup.actorId || options.authorityEdge !== "policy-gm" || page !== player)
      throw new Error("GM approval is outside the guarded policy edge");
    await reloadWayfinderBrowserSuite(gm, installOptions);
    await gm.evaluate(() => globalThis.__issue44Outfitter.instrument());
    return gm.evaluate((value) => globalThis.__issue44Outfitter.approveAuthorityRequest(value), {
      ...payload,
      setup,
      definition: { ...definition, executor: "gm" },
      requestId,
    });
  });
  await page.exposeFunction("__issue44OutfitterCapture", async ({ actorId, phase }) => {
    if (!setup || actorId !== setup.actorId || !["authority-gateway", "recovered-workspace"].includes(phase))
      throw new Error("Screenshot target is not the active guarded fixture");
    const filename = `${definition.id}-${page === gm ? "gm" : "player"}-${phase}-${result.screenshots.length + 1}.png`;
    await page.locator(`[data-issue44-outfitter-actor-id="${actorId}"]`).screenshot({ path: path.join(out, filename) });
    result.screenshots.push({ actorId, phase, executor: page === gm ? "gm" : "player", filename });
  });
  if (options.legacyRoot || options.moduleRoot)
    await page.route(`**/modules/${moduleId}/**`, async (route) => {
      const moduleRoot = routeRoots.get(page);
      if (!moduleRoot) return route.continue();
      const marker = `/modules/${moduleId}/`;
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
      const file = path.resolve(moduleRoot, relative);
      if (!file.startsWith(`${moduleRoot}${path.sep}`)) return route.abort("blockedbyclient");
      try {
        const body = await readFile(file);
        const extension = path.extname(file);
        const contentType =
          {
            ".js": "text/javascript",
            ".json": "application/json",
            ".css": "text/css",
            ".hbs": "text/html",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".webp": "image/webp",
          }[extension] ?? "application/octet-stream";
        const sha256 = createHash("sha256").update(body).digest("hex");
        const key = `${moduleRoot}|${relative}`;
        if (servedDigests.has(key) && servedDigests.get(key) !== sha256)
          throw new Error(`Module bytes changed during the run: ${relative}`);
        if (!servedDigests.has(key)) result.servedPackageFiles.push({ root: moduleRoot, path: relative, sha256 });
        servedDigests.set(key, sha256);
        await route.fulfill({ status: 200, body, contentType, headers: { "cache-control": "no-store" } });
      } catch (error) {
        result.routeFailures.push(error instanceof Error ? error.message : String(error));
        await route.abort("failed");
      }
    });
  await page.exposeFunction("__issue44OutfitterInput", async ({ actorId, selector, kind, text }) => {
    if (!setup || actorId !== setup.actorId) throw new Error("Input target is not the active guarded fixture");
    if (kind === "tab") {
      await page.keyboard.press("Tab");
      return { tabbed: true };
    }
    if (kind === "confirm") {
      const confirmation = page
        .locator(".application")
        .filter({ has: page.locator("[data-wayfinder-apply-confirmation]") })
        .locator('button[data-action="yes"]');
      await confirmation.click({ timeout: 5000 });
      return { confirmed: true };
    }
    const locator = page.locator(`[data-issue44-outfitter-actor-id="${actorId}"]`).locator(selector);
    await locator.click({ timeout: 5000 });
    if (kind === "type") {
      if (!(await locator.isEditable()) || !(await locator.evaluate((element) => element === document.activeElement)))
        throw new Error("Actual search click did not focus an editable input");
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(text, { delay: 40 });
      await locator.waitFor({ state: "visible", timeout: 5000 });
      if ((await locator.inputValue()) !== text) throw new Error("Actual keyboard text did not reach the search input");
    }
    return { clicked: true, typed: kind === "type" };
  });
}
try {
  await loginToFoundryWorld(gm, {
    foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
    user: process.env.FOUNDRY_USER,
    password: process.env.FOUNDRY_PASSWORD ?? "",
  });
  await loginToFoundryWorld(player, {
    foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
    user: process.env.FOUNDRY_SMOKE_PLAYER_USER,
    password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
  });
  await loadWayfinderBrowserSuite(gm, installOptions);
  boundary = await gm.evaluate((value) => globalThis.__issue44Equipment.captureBoundary(value), payload);
  result.preflight = await gm.evaluate(
    (id) => ({
      runtime: { foundry: game.version, pf2e: game.system.version, module: game.modules.get(id).version },
      policy: game.settings.get(id, "equipmentPolicy"),
      judgments: game.settings.get(id, "equipmentPolicyJudgments"),
      packs: game.settings.get("pf2e", "compendiumBrowserPacks"),
      sources: game.settings.get("pf2e", "compendiumBrowserSources"),
      language: game.i18n.lang,
      users: game.users.map((user) => ({ id: user.id, name: user.name, role: user.role })),
    }),
    moduleId
  );
  if (options.installed && result.preflight.runtime.module !== result.candidateVersion)
    throw new Error("Runtime module metadata differs from the committed candidate version");
  const guardian = smokeCases.find((entry) => entry.className === "Guardian");
  for (const entry of selected) {
    definition = entry;
    if (options.legacyRoot) {
      for (const page of [gm, player]) {
        routeRoots.set(page, options.legacyRoot);
        await reloadWayfinderBrowserSuite(page, installOptions);
      }
    }
    console.log(`Outfitter ${entry.id}: prepare guarded fixture, preserve current world policy.`);
    const target = entry.fill === "level-one" ? 1 : 3;
    setup = await gm.evaluate((value) => globalThis.__prepareWayfinderEquipmentProfile(value), {
      ...payload,
      fixturePrefix: "WF Smoke Harness - Issue 44 real outfitter",
      playerName: process.env.FOUNDRY_SMOKE_PLAYER_USER,
      profile: { id: entry.id, stepId: `starting-equipment-level-${target}` },
      smokeCase: { ...guardian, targetLevel: target },
    });
    const casePayload = {
      ...payload,
      setup,
      definition,
      keepItem: options.keepItem,
      coowner: options.coowner,
      requireGateway: Boolean(options.moduleRoot || options.installed),
    };
    try {
      const prepared = await gm.evaluate((value) => globalThis.__issue44Outfitter.prepareFixture(value), casePayload);
      const executor = entry.executor === "gm" ? gm : player;
      await reloadWayfinderBrowserSuite(executor, installOptions);
      await executor.evaluate(() => globalThis.__issue44Outfitter.instrument());
      const probe = await executor.evaluate((value) => globalThis.__issue44Outfitter.probe(value), casePayload);
      await executor
        .locator(".wayfinder-app")
        .last()
        .screenshot({ path: path.join(out, `${entry.id}.png`) })
        .catch(() => {});
      const record = { id: entry.id, prepared, ...probe };
      record.freshTrace = await executor.evaluate((value) => globalThis.__issue44Outfitter.trace(value), casePayload);
      if (options.authorityEdge && probe.status === "pass") {
        record.edgeSaved = await executor.evaluate(
          (value) => globalThis.__issue44Outfitter.saveForOtherOwner(value),
          casePayload
        );
        record.edgeChange = await gm.evaluate((value) => globalThis.__issue44Outfitter.changeAuthority(value), {
          ...casePayload,
          authorityEdge: options.authorityEdge,
        });
        const edgeExecutor = options.authorityEdge === "lost-owner" ? gm : player;
        const edgePayload = {
          ...casePayload,
          definition: { ...definition, executor: options.authorityEdge === "lost-owner" ? "gm" : "player" },
          authorityEdge: options.authorityEdge,
          reopen: true,
          expectedCarry: record.edgeSaved.draft,
        };
        await reloadWayfinderBrowserSuite(edgeExecutor, installOptions);
        await edgeExecutor.evaluate(() => globalThis.__issue44Outfitter.instrument());
        record.authorityEdge = await edgeExecutor.evaluate(
          (value) => globalThis.__issue44Outfitter.probe(value),
          edgePayload
        );
        record.authorityEdge.trace = await edgeExecutor.evaluate(
          (value) => globalThis.__issue44Outfitter.trace(value),
          edgePayload
        );
        await edgeExecutor
          .locator(".wayfinder-app")
          .last()
          .screenshot({ path: path.join(out, `${entry.id}-${options.authorityEdge}.png`) })
          .catch(() => {});
        if (record.authorityEdge.status !== "pass") {
          record.status = "fail";
          record.error = record.authorityEdge.error;
        }
      }
      if (options.coowner && !options.legacyRoot && entry.executor === "gm" && probe.status === "pass") {
        record.sharedSaved = await executor.evaluate(
          (value) => globalThis.__issue44Outfitter.saveForOtherOwner(value),
          casePayload
        );
        await reloadWayfinderBrowserSuite(player, installOptions);
        await player.evaluate(() => globalThis.__issue44Outfitter.instrument());
        const playerPayload = {
          ...casePayload,
          definition: { ...definition, executor: "player" },
          reopen: true,
          expectedCarry: record.sharedSaved.draft,
        };
        record.sharedPlayer = await player.evaluate(
          (value) => globalThis.__issue44Outfitter.probe(value),
          playerPayload
        );
        record.sharedPlayer.trace = await player.evaluate(
          (value) => globalThis.__issue44Outfitter.trace(value),
          playerPayload
        );
        await player
          .locator(".wayfinder-app")
          .last()
          .screenshot({ path: path.join(out, `${entry.id}-coowner-player.png`) })
          .catch(() => {});
        if (record.sharedPlayer.status === "pass") {
          record.sharedPlayerSaved = await player.evaluate(
            (value) => globalThis.__issue44Outfitter.saveForOtherOwner(value),
            playerPayload
          );
          await reloadWayfinderBrowserSuite(player, installOptions);
          await player.evaluate(() => globalThis.__issue44Outfitter.instrument());
          record.sharedPlayerReopened = await player.evaluate((value) => globalThis.__issue44Outfitter.probe(value), {
            ...playerPayload,
            expectedCarry: record.sharedPlayerSaved.draft,
          });
          record.sharedPlayerReopened.trace = await player.evaluate(
            (value) => globalThis.__issue44Outfitter.trace(value),
            playerPayload
          );
          if (options.apply && record.sharedPlayerReopened.status === "pass")
            record.apply = await player.evaluate(
              (value) => globalThis.__issue44Outfitter.applyWithRetry(value),
              playerPayload
            );
          if (record.sharedPlayerReopened.status !== "pass" || (options.apply && record.apply?.passed !== true)) {
            record.status = "fail";
            record.error = record.sharedPlayerReopened.error ?? "Apply/retry verification failed";
          }
        }
        if (record.sharedPlayer.status !== "pass") {
          record.status = "fail";
          record.error = record.sharedPlayer.error;
        }
      }
      if (options.legacyRoot && probe.status === "pass") {
        record.legacy = await executor.evaluate((value) => globalThis.__issue44Outfitter.retarget(value), {
          ...casePayload,
          delta: options.delta,
          leaveStranded: true,
        });
        record.legacy.trace = await executor.evaluate(
          (value) => globalThis.__issue44Outfitter.trace(value),
          casePayload
        );
        if (record.legacy.status === "prepared-stranded") {
          routeRoots.set(executor, options.resumeRoot);
          await reloadWayfinderBrowserSuite(executor, installOptions);
          await executor.evaluate(() => globalThis.__issue44Outfitter.instrument());
          record.carried = await executor.evaluate((value) => globalThis.__issue44Outfitter.probe(value), {
            ...casePayload,
            reopen: true,
            expectedCarry: record.legacy.savedDraft,
          });
          record.carried.trace = await executor.evaluate(
            (value) => globalThis.__issue44Outfitter.trace(value),
            casePayload
          );
          await executor
            .locator(".wayfinder-app")
            .last()
            .screenshot({ path: path.join(out, `${entry.id}-carried.png`) })
            .catch(() => {});
          if (options.coowner && entry.executor === "gm" && record.carried.status === "pass") {
            record.sharedSaved = await executor.evaluate(
              (value) => globalThis.__issue44Outfitter.saveForOtherOwner(value),
              casePayload
            );
            routeRoots.set(player, options.resumeRoot);
            await reloadWayfinderBrowserSuite(player, installOptions);
            await player.evaluate(() => globalThis.__issue44Outfitter.instrument());
            const playerPayload = {
              ...casePayload,
              definition: { ...definition, executor: "player" },
              reopen: true,
              expectedCarry: record.sharedSaved.draft,
            };
            record.sharedPlayer = await player.evaluate(
              (value) => globalThis.__issue44Outfitter.probe(value),
              playerPayload
            );
            record.sharedPlayer.trace = await player.evaluate(
              (value) => globalThis.__issue44Outfitter.trace(value),
              playerPayload
            );
            await player
              .locator(".wayfinder-app")
              .last()
              .screenshot({ path: path.join(out, `${entry.id}-coowner-player.png`) })
              .catch(() => {});
            if (options.upgradeRoot) {
              const beforeUpgrade = record.sharedPlayer.observations.at(-1);
              record.oldPlayerBlocked =
                record.sharedPlayer.status === "fail" &&
                [
                  "[data-wayfinder-equipment-search]",
                  "[data-wayfinder-action='retain-all-equipment']",
                  "[data-wayfinder-action='review-equipment-purchases']",
                ].every(
                  (selector) => beforeUpgrade.controls[selector]?.present && beforeUpgrade.controls[selector]?.disabled
                ) &&
                beforeUpgrade.latestProjection?.state === "error" &&
                beforeUpgrade.latestProjection.message ===
                  "A current actor-owner attestation is required for this higher-level start.";
              if (!record.oldPlayerBlocked) {
                record.status = "fail";
                record.error = "Published 0.10.3 did not reproduce the expected native disabled coowner controls";
              } else {
                routeRoots.set(player, options.upgradeRoot);
                await reloadWayfinderBrowserSuite(player, installOptions);
                await player.evaluate(() => globalThis.__issue44Outfitter.instrument());
                record.upgradedPlayer = await player.evaluate((value) => globalThis.__issue44Outfitter.probe(value), {
                  ...playerPayload,
                  requireGateway: true,
                });
                record.upgradedPlayer.trace = await player.evaluate(
                  (value) => globalThis.__issue44Outfitter.trace(value),
                  playerPayload
                );
                if (record.upgradedPlayer.status !== "pass") {
                  record.status = "fail";
                  record.error = record.upgradedPlayer.error;
                }
              }
            } else if (record.sharedPlayer.status !== "pass") {
              record.status = "fail";
              record.error = record.sharedPlayer.error;
            }
          }
        }
        if (record.carried?.status !== "pass") {
          record.status = "fail";
          record.error = record.legacy.error ?? record.carried?.error;
        }
      }
      if (options.retarget && probe.status === "pass") {
        record.retarget = await executor.evaluate((value) => globalThis.__issue44Outfitter.retarget(value), {
          ...casePayload,
          delta: options.delta,
        });
        record.retarget.trace = await executor.evaluate(
          (value) => globalThis.__issue44Outfitter.trace(value),
          casePayload
        );
        await executor
          .locator(".wayfinder-app")
          .last()
          .screenshot({ path: path.join(out, `${entry.id}-retarget.png`) })
          .catch(() => {});
        if (record.retarget.status === "pass") {
          await reloadWayfinderBrowserSuite(executor, installOptions);
          await executor.evaluate(() => globalThis.__issue44Outfitter.instrument());
          record.reopened = await executor.evaluate((value) => globalThis.__issue44Outfitter.probe(value), {
            ...casePayload,
            reopen: true,
          });
          record.reopened.trace = await executor.evaluate(
            (value) => globalThis.__issue44Outfitter.trace(value),
            casePayload
          );
          await executor
            .locator(".wayfinder-app")
            .last()
            .screenshot({ path: path.join(out, `${entry.id}-reopened.png`) })
            .catch(() => {});
          if (options.toLevelOne && options.delta === -1 && record.reopened.status === "pass") {
            record.levelOne = await executor.evaluate((value) => globalThis.__issue44Outfitter.retarget(value), {
              ...casePayload,
              delta: -1,
            });
            record.levelOne.trace = await executor.evaluate(
              (value) => globalThis.__issue44Outfitter.trace(value),
              casePayload
            );
            await executor
              .locator(".wayfinder-app")
              .last()
              .screenshot({ path: path.join(out, `${entry.id}-level1.png`) })
              .catch(() => {});
            if (record.levelOne.status !== "pass") {
              record.status = "fail";
              record.error = record.levelOne.error;
            }
          }
        }
        if (record.retarget.status !== "pass" || record.reopened?.status !== "pass") {
          record.status = "fail";
          record.error = record.retarget.error ?? record.reopened?.error;
        }
      }
      result.cases.push(record);
      console.log(`Outfitter ${entry.id}: ${record.status.toUpperCase()}${record.error ? `: ${record.error}` : ""}`);
    } finally {
      await player.reload({ waitUntil: "domcontentloaded" }).catch(() => player.close());
      await reloadWayfinderBrowserSuite(gm, installOptions);
      try {
        await gm.evaluate((value) => globalThis.__issue44Outfitter.cleanupAuthority(value), {
          ...casePayload,
          originalJudgments: result.preflight.judgments,
        });
      } finally {
        const cleanup = await gm.evaluate((value) => globalThis.__cleanupWayfinderEquipmentProfile(value), {
          ...payload,
          ...setup,
          profileId: entry.id,
        });
        if (result.cases.at(-1)?.id === entry.id) result.cases.at(-1).cleanup = cleanup;
        setup = null;
      }
    }
  }
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
} finally {
  if (setup) {
    try {
      await reloadWayfinderBrowserSuite(gm, installOptions);
      try {
        await gm.evaluate((value) => globalThis.__issue44Outfitter.cleanupAuthority(value), {
          ...payload,
          setup,
          definition,
          originalJudgments: result.preflight.judgments,
        });
      } finally {
        await gm.evaluate((value) => globalThis.__cleanupWayfinderEquipmentProfile(value), {
          ...payload,
          ...setup,
          profileId: definition.id,
        });
      }
    } catch (error) {
      result.cleanupFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (boundary) {
    try {
      await reloadWayfinderBrowserSuite(gm, installOptions);
      result.boundary = await gm.evaluate((value) => globalThis.__issue44Equipment.verifyBoundary(value), {
        ...payload,
        boundary,
      });
    } catch (error) {
      result.cleanupFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  await Promise.all([...responseChecks]);
  await playerContext.close();
  await closeFoundryBrowser(gmContext, browser);
  result.finishedAt = new Date().toISOString();
  result.finishedDirtyPaths = dirtyPaths();
  result.finishedCandidate = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (
    options.installed &&
    (result.finishedDirtyPaths.length ||
      result.finishedCandidate !== result.candidate ||
      !result.servedPackageFiles.length)
  )
    result.failure ??= "Installed qualification lost its clean exact candidate or served-byte evidence";
  await writeFile(path.join(out, "issue44-outfitter-interaction-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Outfitter artifact: ${out}`);
  if (
    result.failure ||
    result.browserErrors.some((entry) => !entry.expectedInjectedFault) ||
    result.routeFailures.length ||
    result.cleanupFailures.length ||
    !result.boundary?.unchanged ||
    result.cases.some((entry) => entry.status !== "pass")
  )
    process.exitCode = 1;
}
