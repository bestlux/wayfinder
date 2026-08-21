#!/usr/bin/env node
/* global document, game */

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { smokeCases } from "./class-cases.mjs";
import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import { createWf43ExperienceArtifactDirectory, writeWf43ExperienceArtifacts } from "./wf43-experience-artifacts.mjs";
import {
  WF43_APP_WIDTHS,
  WF43_VIEWPORT,
  validateWf43ExperienceCaseDefinition,
  wf43ExperienceCases,
} from "./wf43-experience-cases.mjs";
import { qualifyWf43ExperienceResult } from "./wf43-experience-evidence.mjs";

const MODULE_ID = "wayfinder-pf2e";
const POLICY_SETTING = "equipmentPolicy";
const PACKS_SETTING = "compendiumBrowserPacks";
const FIXTURE_PREFIX = "WF Smoke Harness - WF-080-43 experience";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sharedSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");
const suitePath = path.join(repoRoot, "tools", "foundry-smoke", "wf43-experience-browser-suite.js");

function usage() {
  return `Usage: node tools/foundry-smoke/run-wf43-experience-smoke.mjs [options]

Options:
  --out <path> Fresh artifact directory override.
  --headed     Run with a visible browser.
  --help       Show this help text.

Environment:
  FOUNDRY_URL                         Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER                        Existing GM setup/cleanup user.
  FOUNDRY_PASSWORD                    GM password. Optional.
  FOUNDRY_SMOKE_PLAYER_USER           Existing, distinct non-GM actor owner.
  FOUNDRY_SMOKE_PLAYER_PASSWORD       Player password. Optional.
  FOUNDRY_SMOKE_WORLD_ID              Exact guarded world id.
  FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE     true/false. Required for exact fixture cleanup.
  FOUNDRY_CHROME_PATH                 Chrome/Edge executable path override.
  FOUNDRY_SMOKE_HEADLESS              true/false. Defaults to true.
`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) return console.log(usage());
  for (const definition of wf43ExperienceCases) {
    const failures = validateWf43ExperienceCaseDefinition(definition);
    if (failures.length > 0) throw new Error(failures.join(" "));
  }
  const smokeCase = smokeCases.find((entry) => entry.id === wf43ExperienceCases[0].fixture.smokeCaseId);
  if (!smokeCase) throw new Error("WF-080-43 could not resolve its exact shared Wizard fixture.");
  const options = validateOptions({
    allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
    expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
    gmUser: process.env.FOUNDRY_USER ?? "",
    playerUser: process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "",
  });
  const chromePath = resolveFoundryChromePath();
  if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");

  const evidenceId = randomUUID();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const outDir = await createWf43ExperienceArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  await mkdir(path.join(outDir, "screenshots"), { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
  });
  const gmContext = await browser.newContext({ viewport: WF43_VIEWPORT });
  const playerContext = await browser.newContext({ viewport: WF43_VIEWPORT });
  const gmPage = await gmContext.newPage();
  const playerPage = await playerContext.newPage();
  let setup = null;
  let cleanup = null;
  let playerReady = false;
  const localeEvidence = [];

  try {
    await loginToFoundryWorld(gmPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.gmUser,
      password: process.env.FOUNDRY_PASSWORD ?? "",
    });
    await installSuites(gmPage);
    setup = await gmPage.evaluate(
      (payload) => globalThis.__prepareWayfinderWf43Experience(payload),
      {
        allowDestructive: options.allowDestructive,
        definitions: wf43ExperienceCases,
        expectedWorldId: options.expectedWorldId,
        fixturePrefix: FIXTURE_PREFIX,
        moduleId: MODULE_ID,
        packsSetting: PACKS_SETTING,
        playerName: options.playerUser,
        policySetting: POLICY_SETTING,
        runId,
        smokeCase,
      },
    );
    console.log(`WF-080-43: prepared ${setup.fixtures.length} exact guarded actors.`);

    await loginToFoundryWorld(playerPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.playerUser,
      password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
    });
    await installSuites(playerPage);
    playerReady = true;

    for (const definition of wf43ExperienceCases) {
      await setFoundryLanguage(gmPage, playerPage, definition.id);
      const fixture = setup.fixtures.find((entry) => entry.locale === definition.id);
      if (!fixture) throw new Error(`WF-080-43 is missing its ${definition.id} fixture.`);
      const enrichedFixture = {
        ...fixture,
        itemName: definition.fixture.item.name,
        itemSourceUuid: definition.fixture.item.sourceUuid,
      };
      localeEvidence.push(
        await runLocale({
          definition,
          enrichedFixture,
          expectedPlayerId: setup.users.player.id,
          expectedWorldId: options.expectedWorldId,
          gmPage,
          outDir,
          packsSnapshot: setup.snapshots.packs,
          playerPage,
          runId,
        }),
      );
      console.log(`WF-080-43: ${definition.id} keyboard/state/width matrix finished.`);
    }
  } finally {
    try {
      if (setup) {
        const restorationFailures = [];
        cleanup = emptyCleanup();
        try {
          await reloadSuites(gmPage);
          cleanup = await gmPage.evaluate(
            (payload) => globalThis.__cleanupWayfinderWf43Experience(payload),
            {
              allowDestructive: options.allowDestructive,
              expectedWorldId: options.expectedWorldId,
              fixtures: setup.fixtures,
              moduleId: MODULE_ID,
              packsSetting: PACKS_SETTING,
              policySetting: POLICY_SETTING,
              runId,
              snapshots: setup.snapshots,
            },
          );
          restorationFailures.push(...(cleanup.restorationFailures ?? []));
        } catch (error) {
          restorationFailures.push(`guarded actor/policy/pack cleanup failed: ${errorMessage(error)}`);
        }
        try {
          await setFoundryLanguage(gmPage, playerReady ? playerPage : null, setup.snapshots.language);
        } catch (error) {
          restorationFailures.push(`language restoration failed: ${errorMessage(error)}`);
        }
        try {
          const restored = await gmPage.evaluate(
            (payload) => globalThis.__verifyWayfinderWf43Restoration(payload),
            {
              expectedWorldId: options.expectedWorldId,
              languageSnapshot: setup.snapshots.language,
              moduleId: MODULE_ID,
              packsSetting: PACKS_SETTING,
              policySetting: POLICY_SETTING,
              snapshots: setup.snapshots,
            },
          );
          cleanup = { ...cleanup, ...restored };
        } catch (error) {
          restorationFailures.push(`restoration verification failed: ${errorMessage(error)}`);
        }
        cleanup.restorationFailures = restorationFailures;
        console.log(
          restorationFailures.length === 0
            ? "WF-080-43: exact actors, policy, PF2E packs, and language restored."
            : `WF-080-43: cleanup completed with ${restorationFailures.length} restoration failure(s).`,
        );
      }
    } finally {
      await playerContext.close();
      await closeFoundryBrowser(gmContext, browser);
    }
  }

  if (!setup || localeEvidence.length !== wf43ExperienceCases.length) {
    throw new Error("WF-080-43 produced incomplete locale evidence.");
  }
  const result = {
    schemaVersion: 1,
    evidenceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    runtime: setup.runtime,
    users: setup.users,
    viewport: WF43_VIEWPORT,
    appWidths: WF43_APP_WIDTHS,
    locales: localeEvidence,
    cleanup,
  };
  const qualification = qualifyWf43ExperienceResult(result);
  await writeWf43ExperienceArtifacts(outDir, result, qualification);
  console.log(`WF-080-43 artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of localeEvidence) console.log(`${entry.status.toUpperCase()} ${entry.id}`);
  if (!qualification.ok) {
    for (const failure of qualification.failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
}

async function runLocale({
  definition,
  enrichedFixture,
  expectedPlayerId,
  expectedWorldId,
  gmPage,
  outDir,
  packsSnapshot,
  playerPage,
  runId,
}) {
  const payload = { expectedPlayerId, expectedWorldId, fixture: enrichedFixture, moduleId: MODULE_ID, runId };
  const opened = await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  const rootSelector = `[data-wayfinder-equipment-profile-actor-id="${opened.actorId}"]`;
  await waitFor(playerPage, `${rootSelector} .starting-equipment-pane`);
  const states = [];
  const keyboard = { inputMode: "keyboard-events-only", pointerActionCount: 0, actions: [], focus: [] };
  const liveRegionChanges = {};

  states.push(await captureState(playerPage, opened.actorId, "policy", definition, outDir));

  await tabTo(playerPage, `${rootSelector} [data-wayfinder-action="initialize-starting-equipment"]`);
  await pressAndRecord(playerPage, keyboard, "initialize", "Enter");
  await waitForEither(playerPage, [
    `${rootSelector} [data-wayfinder-action="activate-equipment-policy"]`,
    `${rootSelector} [data-wayfinder-equipment-search]`,
  ]);
  if ((await playerPage.locator(`${rootSelector} [data-wayfinder-action="activate-equipment-policy"]`).count()) > 0) {
    await tabTo(
      playerPage,
      `${rootSelector} [data-wayfinder-action="activate-equipment-policy"][data-start-kind="replacement-character"]`,
    );
    await pressAndRecord(playerPage, keyboard, "activate-policy", "Enter");
  }
  await waitFor(playerPage, `${rootSelector} [data-wayfinder-equipment-search]`);
  const beforeSearch = await liveRegions(playerPage, opened.actorId);
  await tabTo(playerPage, `${rootSelector} [data-wayfinder-equipment-search]`);
  await playerPage.keyboard.type(definition.fixture.item.name);
  keyboard.actions.push({ action: "search", key: definition.fixture.item.name });
  keyboard.focus.push(await focusEvidence(playerPage));
  const itemSelector = `${rootSelector} [data-equipment-item][data-source-uuid="${definition.fixture.item.sourceUuid}"]`;
  await waitFor(playerPage, itemSelector);
  const afterSearch = await liveRegions(playerPage, opened.actorId);
  liveRegionChanges.catalogue = { before: beforeSearch.catalogue, after: afterSearch.catalogue };
  const beforeItem = await itemEvidence(playerPage, opened.actorId, definition.fixture.item.sourceUuid);
  const beforeCart = afterSearch.cart;

  await tabTo(
    playerPage,
    `${itemSelector} [data-wayfinder-action="add-equipment-item"][data-source-uuid="${definition.fixture.item.sourceUuid}"]`,
  );
  await pressAndRecord(playerPage, keyboard, "add-item", "Enter");
  await waitFor(playerPage, `${rootSelector} .equipment-cart-line`);
  const afterCart = await liveRegions(playerPage, opened.actorId);
  liveRegionChanges.cart = { before: beforeCart, after: afterCart.cart };
  const cartFocus = await focusEvidence(playerPage);
  keyboard.focus.push(cartFocus);

  await tabTo(playerPage, `${rootSelector} [data-wayfinder-action="change-equipment-quantity"][data-delta="1"]`);
  await pressAndRecord(playerPage, keyboard, "increase-quantity", "Enter");
  await waitForText(playerPage, `${rootSelector} .equipment-quantity strong`, "2");
  keyboard.focus.push(await focusEvidence(playerPage));
  await tabTo(playerPage, `${rootSelector} [data-wayfinder-action="change-equipment-quantity"][data-delta="-1"]`);
  await pressAndRecord(playerPage, keyboard, "decrease-quantity", "Enter");
  await waitForText(playerPage, `${rootSelector} .equipment-quantity strong`, "1");
  keyboard.focus.push(await focusEvidence(playerPage));
  const afterItem = await itemEvidence(playerPage, opened.actorId, definition.fixture.item.sourceUuid);
  const item = {
    name: afterItem.name || beforeItem.name,
    accessibleNames: { ...beforeItem.accessibleNames, ...nonEmptyValues(afterItem.accessibleNames) },
  };
  states.push(await captureState(playerPage, opened.actorId, "browse-cart", definition, outDir));

  const beforeReview = (await liveRegions(playerPage, opened.actorId)).review;
  await tabTo(playerPage, `${rootSelector} [data-wayfinder-action="review-equipment-purchases"]`);
  await pressAndRecord(playerPage, keyboard, "review-purchases", "Enter");
  await playerPage.waitForFunction(
    (selector) => document.querySelector(selector)?.disabled === false,
    `${rootSelector} [data-wayfinder-action="apply-draft"]`,
    { timeout: 30_000 },
  );
  const afterReview = (await liveRegions(playerPage, opened.actorId)).review;
  liveRegionChanges.review = { before: beforeReview, after: afterReview };
  keyboard.focus.push(await focusEvidence(playerPage));
  states.push(await captureState(playerPage, opened.actorId, "review", definition, outDir));

  await playerPage.evaluate((value) => globalThis.__prepareWayfinderWf43Handoff(value), {
    expectedWorldId,
    fixture: enrichedFixture,
    moduleId: MODULE_ID,
    runId,
  });
  await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  await waitFor(playerPage, `${rootSelector} [data-wayfinder-focus-id="starting-equipment-handoff"]`);
  states.push(await captureState(playerPage, opened.actorId, "handoff", definition, outDir));
  await tabTo(playerPage, `${rootSelector} [data-wayfinder-action="acknowledge-equipment-handoff"]`);
  await pressAndRecord(playerPage, keyboard, "acknowledge-handoff", "Enter");
  await waitFor(playerPage, `${rootSelector} .equipment-reviewed`);
  keyboard.focus.push(await focusEvidence(playerPage));

  await playerPage.evaluate((value) => globalThis.__restoreWayfinderWf43ReviewedDraft(value), {
    expectedWorldId,
    fixture: enrichedFixture,
    moduleId: MODULE_ID,
    runId,
  });
  await gmPage.evaluate((value) => globalThis.__setWayfinderWf43CorePack(value), {
    enabled: false,
    expectedWorldId,
    fixture: enrichedFixture,
    moduleId: MODULE_ID,
    packsSetting: PACKS_SETTING,
    runId,
  });
  await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  await waitFor(playerPage, `${rootSelector} [data-wayfinder-action="apply-draft"]`);
  const beforeFailure = (await liveRegions(playerPage, opened.actorId)).failure || afterReview;
  await applyWithKeyboard(playerPage, rootSelector, keyboard, "forced-apply");
  await waitFor(playerPage, `${rootSelector} [data-wayfinder-focus-id="starting-equipment-status"][role="alert"]`, 120_000);
  const failure = await playerPage.evaluate(
    (actorId) => globalThis.__inspectWayfinderWf43Failure({ actorId }),
    opened.actorId,
  );
  const afterFailure = (await liveRegions(playerPage, opened.actorId)).failure;
  liveRegionChanges.failure = { before: beforeFailure, after: afterFailure };
  keyboard.focus.push(await focusEvidence(playerPage));
  states.push(await captureState(playerPage, opened.actorId, "forced-failure", definition, outDir));

  await gmPage.evaluate((value) => globalThis.__restoreWayfinderWf43CorePack(value), {
    expectedWorldId,
    packsSetting: PACKS_SETTING,
    snapshot: packsSnapshot,
  });
  await applyWithKeyboard(playerPage, rootSelector, keyboard, "retry-apply");
  await playerPage.waitForFunction(
    (selector) => !document.querySelector(selector),
    rootSelector,
    { timeout: 180_000 },
  );
  await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  await waitFor(playerPage, `${rootSelector} .wayfinder-acquisition-receipt`, 60_000);
  const receipt = await playerPage.evaluate(
    (actorId) => globalThis.__inspectWayfinderWf43Receipt({ actorId }),
    opened.actorId,
  );
  states.push(await captureState(playerPage, opened.actorId, "receipt", definition, outDir));

  const stateRawKeys = states.flatMap((state) => state.rawLocalizationKeys);
  return {
    id: definition.id,
    status: "pass",
    definitionFingerprint: definition.definitionFingerprint,
    observedLocale: states[0].observedLocale,
    item,
    keyboard,
    liveRegionChanges,
    failure,
    receipt,
    states,
    rawLocalizationKeys: [...new Set(stateRawKeys)].sort(),
  };
}

async function captureState(page, actorId, stateId, definition, outDir) {
  const widths = [];
  for (const width of WF43_APP_WIDTHS) {
    const sample = await page.evaluate(
      (payload) => globalThis.__measureWayfinderWf43State(payload),
      { actorId, stateId, width },
    );
    const screenshot = path.join("screenshots", `${definition.id}-${stateId}-${width}.png`);
    await page
      .locator(`[data-wayfinder-equipment-profile-actor-id="${actorId}"]`)
      .screenshot({ path: path.join(outDir, screenshot) });
    widths.push({ ...sample, screenshot: screenshot.replaceAll(path.sep, "/") });
  }
  const inspected = await page.evaluate((value) => globalThis.__inspectWayfinderWf43State(value), { actorId });
  return { id: stateId, ...inspected, widths };
}

async function applyWithKeyboard(page, rootSelector, keyboard, action) {
  await tabTo(page, `${rootSelector} [data-wayfinder-action="apply-draft"]`);
  await pressAndRecord(page, keyboard, action, "Enter");
  await waitFor(page, 'button[data-action="yes"]', 30_000);
  await tabTo(page, 'button[data-action="yes"]', 60);
  await pressAndRecord(page, keyboard, `${action}-confirm`, "Enter");
}

async function pressAndRecord(page, keyboard, action, key) {
  await page.keyboard.press(key);
  keyboard.actions.push({ action, key });
  await page.waitForTimeout(50);
}

async function focusEvidence(page) {
  return page.evaluate(() => globalThis.__inspectWayfinderWf43Focus());
}

async function itemEvidence(page, actorId, sourceUuid) {
  return page.evaluate(
    (payload) => globalThis.__inspectWayfinderWf43Item(payload),
    { actorId, sourceUuid },
  );
}

async function liveRegions(page, actorId) {
  return page.evaluate((value) => globalThis.__inspectWayfinderWf43LiveRegions({ actorId: value }), actorId);
}

async function tabTo(page, selector, limit = 180) {
  for (let index = 0; index < limit; index += 1) {
    const matched = await page.evaluate((candidate) => document.activeElement?.matches(candidate) === true, selector);
    if (matched) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard traversal could not reach ${selector}.`);
}

async function waitFor(page, selector, timeout = 30_000) {
  await page.waitForFunction((candidate) => Boolean(document.querySelector(candidate)), selector, { timeout });
}

async function waitForEither(page, selectors) {
  await page.waitForFunction((candidates) => candidates.some((candidate) => document.querySelector(candidate)), selectors, {
    timeout: 30_000,
  });
}

async function waitForText(page, selector, text) {
  await page.waitForFunction(
    ({ candidate, expected }) => document.querySelector(candidate)?.textContent?.trim() === expected,
    { candidate: selector, expected: text },
    { timeout: 30_000 },
  );
}

async function setFoundryLanguage(gmPage, playerPage, language) {
  const current = await gmPage.evaluate(() => game.settings.get("core", "language"));
  if (String(current) !== String(language)) {
    try {
      await gmPage.evaluate((value) => game.settings.set("core", "language", value), language);
    } catch (error) {
      if (!String(error).includes("Execution context was destroyed")) throw error;
    }
  }
  await reloadSuites(gmPage);
  if (playerPage) await reloadSuites(playerPage);
  for (const page of [gmPage, playerPage].filter(Boolean)) {
    const observed = await page.evaluate(() => ({ setting: game.settings.get("core", "language"), locale: game.i18n?.lang }));
    if (String(observed.setting) !== String(language) || String(observed.locale) !== String(language)) {
      throw new Error(`WF-080-43 locale switch expected ${language}, got ${observed.setting}/${observed.locale}.`);
    }
  }
}

async function installSuites(page) {
  await page.addScriptTag({ path: sharedSuitePath });
  await page.addScriptTag({ path: suitePath });
}

async function reloadSuites(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
  await installSuites(page);
}

function nonEmptyValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string" && entry.trim()));
}

function emptyCleanup() {
  return {
    actorsDeleted: 0,
    actorsMissingAfterCleanup: false,
    actorCountRestored: false,
    exactFixturesMatched: false,
    policyRestored: false,
    packsRestored: false,
    languageRestored: false,
    restorationFailures: [],
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function validateOptions(options) {
  const failures = [];
  if (!options.gmUser.trim()) failures.push("An existing GM user is required.");
  if (!options.playerUser.trim()) failures.push("An existing non-GM player is required.");
  if (options.gmUser.trim().toLowerCase() === options.playerUser.trim().toLowerCase()) {
    failures.push("GM and player users must be distinct.");
  }
  if (!options.expectedWorldId.trim()) failures.push("An exact guarded world id is required.");
  if (!options.allowDestructive) failures.push("Guarded fixture cleanup requires destructive opt-in.");
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
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --out.");
      options.outDir = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

await main().catch((error) => {
  console.error(`WF-080-43 experience smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
