#!/usr/bin/env node
/* global document */

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
import {
  restoreFoundryClientLanguages,
  snapshotFoundryClientLanguages,
  switchFoundryClientLanguages,
} from "./wf43-experience-language.mjs";
import {
  loadWayfinderBrowserSuite,
  reloadWayfinderBrowserSuite,
} from "./shared-browser-suite-lifecycle.mjs";
import {
  cleanupWf43ExperienceWithRecovery,
  createWf43RecoveryPage,
  recoverWf43FailedSetupWithRecovery,
  restoreWf43WorldSettingsWithRecovery,
} from "./wf43-experience-browser-lifecycle.mjs";

const MODULE_ID = "wayfinder-pf2e";
const POLICY_SETTING = "equipmentPolicy";
const PACKS_SETTING = "compendiumBrowserPacks";
const FIXTURE_PREFIX = "WF Smoke Harness - WF-080-43 experience";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
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
  const evidenceId = randomUUID();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const outDir = await createWf43ExperienceArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  let stage = { id: "artifact-preparation" };
  let failedStage = null;
  let runError = null;
  let setupAttempted = false;
  let browser = null;
  let gmContext = null;
  let playerContext = null;
  let gmPage = null;
  let playerPage = null;
  let options = null;
  let setup = null;
  let setupSnapshots = null;
  let cleanup = emptyCleanup();
  let playerReady = false;
  let recoveryPage = null;
  let clientLanguageSnapshots = [];
  let exactClientLanguageRestored = false;
  const languageSwitches = [];
  const localeEvidence = [];
  const samples = [];
  const keyboardEntries = [];
  const failureFocusEntries = [];
  const tabTraversalFailures = [];

  try {
    await mkdir(path.join(outDir, "screenshots"), { recursive: true });
    stage = { id: "definition-validation" };
    for (const definition of wf43ExperienceCases) {
      const failures = validateWf43ExperienceCaseDefinition(definition);
      if (failures.length > 0) throw new Error(failures.join(" "));
    }
    const smokeCase = smokeCases.find((entry) => entry.id === wf43ExperienceCases[0].fixture.smokeCaseId);
    if (!smokeCase) throw new Error("WF-080-43 could not resolve its exact shared Wizard fixture.");
    stage = { id: "option-validation" };
    options = validateOptions({
      allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
      expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
      gmUser: process.env.FOUNDRY_USER ?? "",
      playerUser: process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "",
    });
    const chromePath = resolveFoundryChromePath();
    if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");
    stage = { id: "browser-launch" };
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
    });
    gmContext = await browser.newContext({ viewport: WF43_VIEWPORT });
    playerContext = await browser.newContext({ viewport: WF43_VIEWPORT });
    gmPage = await gmContext.newPage();
    playerPage = await playerContext.newPage();
    stage = { id: "gm-login" };
    await loginToFoundryWorld(gmPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.gmUser,
      password: process.env.FOUNDRY_PASSWORD ?? "",
    });
    await installSuites(gmPage);
    setupSnapshots = await snapshotWf43SetupBoundary(gmPage);
    stage = { id: "fixture-setup" };
    setupAttempted = true;
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

    stage = { id: "player-login" };
    await loginToFoundryWorld(playerPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.playerUser,
      password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
    });
    await installSuites(playerPage);
    playerReady = true;
    stage = { id: "language-snapshot" };
    clientLanguageSnapshots = await snapshotFoundryClientLanguages(languageTargets(gmPage, playerPage), MODULE_ID);
    const gmLanguageSnapshot = clientLanguageSnapshots.find((entry) => entry.role === "gm");
    if (gmLanguageSnapshot?.setting !== String(setup.snapshots.language)) {
      throw new Error(
        `WF-080-43 GM client language snapshot expected ${setup.snapshots.language}, got ${gmLanguageSnapshot?.setting ?? "missing"}.`,
      );
    }

    for (const definition of wf43ExperienceCases) {
      stage = { id: "locale-switch", locale: definition.id };
      try {
        languageSwitches.push(...(await setFoundryLanguage(gmPage, playerPage, definition.id)));
      } catch (error) {
        if (Array.isArray(error?.languageEvidence)) languageSwitches.push(...error.languageEvidence);
        throw error;
      }
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
          keyboardEntries,
          failureFocusEntries,
          samples,
          tabTraversalFailures,
          setStage(nextStage) {
            stage = nextStage;
          },
        }),
      );
      console.log(`WF-080-43: ${definition.id} keyboard/state/width matrix finished.`);
    }
  } catch (error) {
    runError = error;
    failedStage = { ...stage };
  } finally {
    try {
      const recoverGmPage = async () => {
        if (recoveryPage) return recoveryPage;
        const recovery = await createWf43RecoveryPage({
          browser,
          failedContext: gmContext,
          login: (page) =>
            loginToFoundryWorld(page, {
              foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
              user: options.gmUser,
              password: process.env.FOUNDRY_PASSWORD ?? "",
            }),
          load: installSuites,
        });
        gmContext = recovery.context;
        gmPage = recovery.page;
        recoveryPage = recovery.page;
        return recoveryPage;
      };
      if (setup) {
        const restorationFailures = [];
        cleanup = { ...emptyCleanup(), attempted: true, setupCompleted: true };
        let cleanupReloadError = null;
        try {
          stage = { id: "cleanup-actors-policy-packs" };
          try {
            await reloadSuites(gmPage);
          } catch (error) {
            cleanupReloadError = error;
          }
          const guardedCleanup = await cleanupWf43ExperienceWithRecovery(
            [gmPage],
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
            recoverGmPage,
          );
          cleanup = { ...cleanup, ...guardedCleanup };
          restorationFailures.push(...(cleanup.restorationFailures ?? []));
        } catch (error) {
          const combined = cleanupReloadError
            ? new AggregateError(
                [cleanupReloadError, error],
                "WF-080-43 cleanup reload and guarded cleanup both failed.",
                { cause: error },
              )
            : error;
          restorationFailures.push(`guarded actor/policy/pack cleanup failed: ${errorMessage(combined)}`);
        }
        try {
          stage = { id: "cleanup-settings-recovery" };
          const settings = await restoreWf43WorldSettingsWithRecovery(
            [gmPage],
            {
              expectedWorldId: options.expectedWorldId,
              moduleId: MODULE_ID,
              packsSetting: PACKS_SETTING,
              policySetting: POLICY_SETTING,
              snapshots: setup.snapshots,
            },
            recoverGmPage,
          );
          cleanup.policyRestored = settings.policyRestored;
          cleanup.packsRestored = settings.packsRestored;
          if (settings.policyRestored && settings.packsRestored) {
            removeResolvedSettingsFailures(restorationFailures);
          }
          restorationFailures.push(...settings.failures);
        } catch (error) {
          restorationFailures.push(`policy/pack recovery failed: ${errorMessage(error)}`);
        }
        try {
          stage = { id: "cleanup-language" };
          const targets = languageTargets(gmPage, playerReady ? playerPage : null);
          const snapshots =
            clientLanguageSnapshots.length > 0
              ? clientLanguageSnapshots
              : [{ role: "gm", setting: String(setup.snapshots.language), locale: String(setup.snapshots.language) }];
          const languageRestoration = await restoreFoundryClientLanguages(targets, snapshots, {
            moduleId: MODULE_ID,
            reload: reloadSuites,
          });
          exactClientLanguageRestored = languageRestoration.restored;
          restorationFailures.push(...languageRestoration.failures);
        } catch (error) {
          restorationFailures.push(`language restoration orchestration failed: ${errorMessage(error)}`);
        }
        try {
          stage = { id: "cleanup-verification" };
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
          cleanup.languageRestored = exactClientLanguageRestored && restored.languageRestored === true;
        } catch (error) {
          restorationFailures.push(`restoration verification failed: ${errorMessage(error)}`);
        }
        cleanup.restorationFailures = restorationFailures;
        console.log(
          restorationFailures.length === 0
            ? "WF-080-43: exact actors, policy, PF2E packs, and language restored."
            : `WF-080-43: cleanup completed with ${restorationFailures.length} restoration failure(s).`,
        );
      } else if (setupAttempted && setupSnapshots) {
        try {
          stage = { id: "failed-setup-recovery" };
          cleanup = await recoverWf43FailedSetupWithRecovery(
            [gmPage],
            {
              allowDestructive: options.allowDestructive,
              expectedFixtures: expectedWf43FixtureIdentities(runId),
              expectedWorldId: options.expectedWorldId,
              moduleId: MODULE_ID,
              packsSetting: PACKS_SETTING,
              policySetting: POLICY_SETTING,
              runId,
              snapshots: setupSnapshots,
            },
            recoverGmPage,
          );
        } catch (error) {
          cleanup = {
            ...emptyCleanup(),
            attempted: true,
            setupCompleted: false,
            restorationFailures: [`failed fixture setup recovery failed: ${errorMessage(error)}`],
          };
        }
      }
    } finally {
      try {
        await playerContext?.close();
      } catch (error) {
        cleanup.restorationFailures.push(`player context close failed: ${errorMessage(error)}`);
      }
      try {
        if (gmContext && browser) await closeFoundryBrowser(gmContext, browser);
        else await browser?.close();
      } catch (error) {
        cleanup.restorationFailures.push(`browser close failed: ${errorMessage(error)}`);
      }
    }
  }

  const cleanupFailures = setup ? cleanupEvidenceFailures(cleanup, wf43ExperienceCases.length) : [];
  if (!runError && cleanupFailures.length > 0) {
    runError = new Error(cleanupFailures.join(" "));
    failedStage = { id: "cleanup-restoration" };
  }
  if (!runError && (!setup || localeEvidence.length !== wf43ExperienceCases.length)) {
    runError = new Error("WF-080-43 produced incomplete locale evidence.");
    failedStage = { id: "evidence-assembly" };
  }
  const result = {
    schemaVersion: 1,
    evidenceId,
    status: runError ? "fail" : "complete",
    startedAt,
    finishedAt: new Date().toISOString(),
    stage: failedStage ?? { id: "complete" },
    error: runError ? serializeError(runError) : null,
    runtime: setup?.runtime ?? null,
    users: setup?.users ?? null,
    viewport: WF43_VIEWPORT,
    appWidths: WF43_APP_WIDTHS,
    languageSwitches,
    locales: localeEvidence,
    keyboardEntries,
    failureFocusEntries,
    tabTraversalFailures,
    samples,
    cleanup,
  };
  const qualification = runError
    ? {
        ok: false,
        failures: [`WF-080-43 runner failed during ${formatStage(failedStage)}: ${errorMessage(runError)}`],
      }
    : qualifyWf43ExperienceResult(result);
  result.status = qualification.ok ? "pass" : "fail";
  await writeWf43ExperienceArtifacts(outDir, result, qualification);
  console.log(`WF-080-43 artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of localeEvidence) console.log(`${entry.status.toUpperCase()} ${entry.id}`);
  if (runError) throw runError;
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
  keyboardEntries,
  failureFocusEntries,
  samples,
  tabTraversalFailures,
  setStage,
}) {
  const payload = { expectedPlayerId, expectedWorldId, fixture: enrichedFixture, moduleId: MODULE_ID, runId };
  const interactionStage = (state, action) => setStage({ id: "interaction", locale: definition.id, state, action });
  interactionStage("policy", "open");
  const opened = await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  const rootSelector = `[data-wayfinder-equipment-profile-actor-id="${opened.actorId}"]`;
  await waitFor(playerPage, `${rootSelector} .starting-equipment-pane`);
  const appTabTo = (selector, options = {}) =>
    tabTo(playerPage, selector, {
      ...options,
      failureEvidence: tabTraversalFailures,
      scopeSelector: rootSelector,
    });
  const states = [];
  const keyboard = {
    inputMode: "keyboard-events-only",
    pointerActionCount: 0,
    entry: null,
    actions: [],
    focus: [],
  };
  const liveRegionChanges = {};
  let reviewedSnapshotProvenance;
  let reviewedSnapshotToken;
  const enterScopedKeyboardBoundary = async ({ action, anchorSelector, mode, state, targetSelector }) => {
    setStage({ id: "keyboard-entry", locale: definition.id, state, action });
    const entry = await playerPage.evaluate(
      (value) => globalThis.__enterWayfinderWf43KeyboardScope(value),
      { actorId: opened.actorId, action, anchorSelector, mode, state, targetSelector },
    );
    entry.observedTraversal = [];
    const persistedEntry = { locale: definition.id, ...entry };
    keyboardEntries.push(persistedEntry);
    assertKeyboardEntry(entry, { action, mode, state });
    await appTabTo(`${rootSelector} ${targetSelector}`, { observedTraversal: entry.observedTraversal });
    return persistedEntry;
  };

  states.push(await captureState(playerPage, opened.actorId, "policy", definition, outDir, samples, setStage));

  keyboard.entry = await enterScopedKeyboardBoundary({
    action: "initialize",
    mode: "scoped-app-entry",
    state: "policy",
    targetSelector: '[data-wayfinder-action="initialize-starting-equipment"]',
  });
  interactionStage("policy", "initialize");
  await pressAndRecord(playerPage, keyboard, "initialize", "Enter");
  await waitForEither(playerPage, [
    `${rootSelector} [data-wayfinder-action="activate-equipment-policy"]`,
    `${rootSelector} [data-wayfinder-equipment-search]`,
  ]);
  if ((await playerPage.locator(`${rootSelector} [data-wayfinder-action="activate-equipment-policy"]`).count()) > 0) {
    interactionStage("policy", "activate-policy");
    await appTabTo(
      `${rootSelector} [data-wayfinder-action="activate-equipment-policy"][data-start-kind="replacement-character"]`,
    );
    await pressAndRecord(playerPage, keyboard, "activate-policy", "Enter");
  }
  await waitFor(playerPage, `${rootSelector} [data-wayfinder-equipment-search]`);
  const beforeSearch = await liveRegions(playerPage, opened.actorId);
  interactionStage("browse-cart", "search");
  await appTabTo(`${rootSelector} [data-wayfinder-equipment-search]`);
  await playerPage.keyboard.type(definition.fixture.item.name);
  keyboard.actions.push({ action: "search", key: definition.fixture.item.name });
  keyboard.focus.push(await focusEvidence(playerPage));
  const itemSelector = `${rootSelector} [data-equipment-item][data-wayfinder-action="preview-equipment-item"][data-source-uuid="${definition.fixture.item.sourceUuid}"]`;
  await waitFor(playerPage, itemSelector);
  const afterSearch = await liveRegions(playerPage, opened.actorId);
  liveRegionChanges.catalogue = { before: beforeSearch.catalogue, after: afterSearch.catalogue };
  const beforeItem = await itemEvidence(playerPage, opened.actorId, definition.fixture.item.sourceUuid);
  const beforeCart = afterSearch.cart;

  interactionStage("browse-cart", "select-item");
  await appTabTo(itemSelector);
  await pressAndRecord(playerPage, keyboard, "select-item", "Enter");
  const currencyActionSelector = `${rootSelector} [data-application-part="equipment-detail"] [data-wayfinder-action="add-equipment-item"][data-source-uuid="${definition.fixture.item.sourceUuid}"][data-funding="currency"]`;
  await waitFor(playerPage, currencyActionSelector);

  interactionStage("browse-cart", "add-item");
  await appTabTo(currencyActionSelector);
  await pressAndRecord(playerPage, keyboard, "add-item", "Enter");
  await waitFor(playerPage, `${rootSelector} .equipment-cart-line`);
  const afterCart = await liveRegions(playerPage, opened.actorId);
  liveRegionChanges.cart = { before: beforeCart, after: afterCart.cart };
  const cartFocus = await focusEvidence(playerPage);
  keyboard.focus.push(cartFocus);

  const decreaseQuantitySelector = `${rootSelector} [data-wayfinder-action="change-equipment-quantity"][data-delta="-1"]`;
  const increaseQuantitySelector = `${rootSelector} [data-wayfinder-action="change-equipment-quantity"][data-delta="1"]`;
  interactionStage("browse-cart", "quantity-entry");
  await appTabTo(decreaseQuantitySelector);
  interactionStage("browse-cart", "increase-quantity");
  await appTabTo(increaseQuantitySelector);
  await pressAndRecord(playerPage, keyboard, "increase-quantity", "Enter");
  await waitForInputValue(playerPage, `${rootSelector} .equipment-quantity input`, "2");
  keyboard.focus.push(await focusEvidence(playerPage));
  interactionStage("browse-cart", "decrease-quantity");
  await appTabTo(decreaseQuantitySelector, { key: "Shift+Tab" });
  await pressAndRecord(playerPage, keyboard, "decrease-quantity", "Enter");
  await waitForInputValue(playerPage, `${rootSelector} .equipment-quantity input`, "1");
  keyboard.focus.push(await focusEvidence(playerPage));
  const afterItem = await itemEvidence(playerPage, opened.actorId, definition.fixture.item.sourceUuid);
  const item = {
    name: afterItem.name || beforeItem.name,
    accessibleNames: { ...beforeItem.accessibleNames, ...nonEmptyValues(afterItem.accessibleNames) },
  };
  states.push(await captureState(playerPage, opened.actorId, "browse-cart", definition, outDir, samples, setStage));

  const beforeReview = (await liveRegions(playerPage, opened.actorId)).review;
  interactionStage("review", "review-purchases");
  await appTabTo(`${rootSelector} [data-wayfinder-action="review-equipment-purchases"]`);
  await pressAndRecord(playerPage, keyboard, "review-purchases", "Enter");
  await playerPage.waitForFunction(
    (selector) => document.querySelector(selector)?.disabled === false,
    `${rootSelector} [data-wayfinder-action="apply-draft"]`,
    { timeout: 30_000 },
  );
  const afterReview = (await liveRegions(playerPage, opened.actorId)).review;
  liveRegionChanges.review = { before: beforeReview, after: afterReview };
  keyboard.focus.push(await focusEvidence(playerPage));
  states.push(await captureState(playerPage, opened.actorId, "review", definition, outDir, samples, setStage));

  interactionStage("handoff", "prepare");
  const handoffPreparation = await playerPage.evaluate((value) => globalThis.__prepareWayfinderWf43Handoff(value), {
    expectedWorldId,
    fixture: enrichedFixture,
    moduleId: MODULE_ID,
    runId,
  });
  reviewedSnapshotToken = handoffPreparation.reviewedSnapshot;
  reviewedSnapshotProvenance = handoffPreparation.provenance;
  await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  await waitFor(playerPage, `${rootSelector} [data-wayfinder-focus-id="starting-equipment-handoff"]`);
  states.push(await captureState(playerPage, opened.actorId, "handoff", definition, outDir, samples, setStage));
  await enterScopedKeyboardBoundary({
    action: "acknowledge",
    mode: "scoped-app-reentry",
    state: "handoff",
    targetSelector: '[data-wayfinder-action="acknowledge-equipment-handoff"]',
  });
  interactionStage("handoff", "acknowledge");
  await pressAndRecord(playerPage, keyboard, "acknowledge-handoff", "Enter");
  await waitFor(playerPage, `${rootSelector} .equipment-reviewed`);
  keyboard.focus.push(await focusEvidence(playerPage));

  interactionStage("forced-failure", "restore-reviewed-draft");
  const restoredReviewedDraft = await playerPage.evaluate((value) => globalThis.__restoreWayfinderWf43ReviewedDraft(value), {
    expectedWorldId,
    fixture: enrichedFixture,
    moduleId: MODULE_ID,
    reviewedSnapshot: reviewedSnapshotToken,
    runId,
  });
  if (JSON.stringify(restoredReviewedDraft.provenance) !== JSON.stringify(reviewedSnapshotProvenance)) {
    throw new Error("WF-080-43 reviewed snapshot provenance changed across the handoff boundary.");
  }
  interactionStage("forced-failure", "disable-core-pack");
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
  const applyBoundary = await enterScopedKeyboardBoundary({
    action: "apply",
    mode: "scoped-app-reentry",
    state: "forced-failure",
    targetSelector: '[data-wayfinder-action="apply-draft"]',
  });
  const beforeFailure = (await liveRegions(playerPage, opened.actorId)).failure || afterReview;
  interactionStage("forced-failure", "apply");
  applyBoundary.confirmation = await applyWithKeyboard(
    playerPage,
    rootSelector,
    keyboard,
    "forced-apply",
    tabTraversalFailures,
  );
  const failureAlertSelector = `${rootSelector} [data-wayfinder-focus-id="starting-equipment-status"][role="alert"]`;
  await waitFor(playerPage, failureAlertSelector, 120_000);
  interactionStage("forced-failure", "error-focus");
  await playerPage.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    failureAlertSelector,
    { timeout: 30_000 },
  );
  const failure = await playerPage.evaluate(
    (actorId) => globalThis.__inspectWayfinderWf43Failure({ actorId }),
    opened.actorId,
  );
  failureFocusEntries.push({ locale: definition.id, state: "forced-failure", action: "error-focus", ...failure });
  const afterFailure = (await liveRegions(playerPage, opened.actorId)).failure;
  liveRegionChanges.failure = { before: beforeFailure, after: afterFailure };
  keyboard.focus.push(await focusEvidence(playerPage));
  states.push(await captureState(playerPage, opened.actorId, "forced-failure", definition, outDir, samples, setStage));

  interactionStage("receipt", "restore-core-pack");
  await gmPage.evaluate((value) => globalThis.__restoreWayfinderWf43CorePack(value), {
    expectedWorldId,
    packsSetting: PACKS_SETTING,
    snapshot: packsSnapshot,
  });
  const retryBoundary = await enterScopedKeyboardBoundary({
    action: "retry-apply",
    anchorSelector: '[data-wayfinder-focus-id="starting-equipment-status"][role="alert"]',
    mode: "scoped-alert-reentry",
    state: "forced-failure",
    targetSelector: '[data-wayfinder-action="apply-draft"]',
  });
  interactionStage("receipt", "retry-apply");
  retryBoundary.confirmation = await applyWithKeyboard(
    playerPage,
    rootSelector,
    keyboard,
    "retry-apply",
    tabTraversalFailures,
  );
  await playerPage.waitForFunction(
    (selector) => !document.querySelector(selector),
    rootSelector,
    { timeout: 180_000 },
  );
  interactionStage("receipt", "reopen");
  await playerPage.evaluate((value) => globalThis.__openWayfinderWf43Experience(value), payload);
  await waitFor(playerPage, `${rootSelector} .wayfinder-acquisition-receipt`, 60_000);
  const receipt = await playerPage.evaluate(
    (actorId) => globalThis.__inspectWayfinderWf43Receipt({ actorId }),
    opened.actorId,
  );
  states.push(await captureState(playerPage, opened.actorId, "receipt", definition, outDir, samples, setStage));

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
    reviewedSnapshotProvenance,
    states,
    rawLocalizationKeys: [...new Set(stateRawKeys)].sort(),
  };
}

async function captureState(page, actorId, stateId, definition, outDir, samples, setStage) {
  const widths = [];
  for (const width of WF43_APP_WIDTHS) {
    setStage({ id: "state-capture", locale: definition.id, state: stateId, width });
    const sample = await page.evaluate(
      (payload) => globalThis.__measureWayfinderWf43State(payload),
      { actorId, stateId, width },
    );
    const screenshot = path.join("screenshots", `${definition.id}-${stateId}-${width}.png`);
    await page
      .locator(`[data-wayfinder-equipment-profile-actor-id="${actorId}"]`)
      .screenshot({ path: path.join(outDir, screenshot) });
    const completed = { ...sample, screenshot: screenshot.replaceAll(path.sep, "/") };
    widths.push(completed);
    samples.push({ locale: definition.id, state: stateId, width, ...completed });
  }
  const inspected = await page.evaluate((value) => globalThis.__inspectWayfinderWf43State(value), { actorId });
  return { id: stateId, ...inspected, widths };
}

async function applyWithKeyboard(page, rootSelector, keyboard, action, tabTraversalFailures) {
  await tabTo(page, `${rootSelector} [data-wayfinder-action="apply-draft"]`, {
    failureEvidence: tabTraversalFailures,
    scopeSelector: rootSelector,
  });
  await pressAndRecord(page, keyboard, action, "Enter");
  await waitFor(page, 'button[data-action="yes"]', 30_000);
  const transition = await pressAndRecordFocusTransition(page, keyboard, `${action}-confirm-focus`, "Shift+Tab", {
    from: 'button[data-action="no"][data-keyboard-focus="true"]',
    to: 'button[data-action="yes"][data-keyboard-focus="true"]',
  });
  const activationTarget = await focusEvidence(page);
  await pressAndRecord(page, keyboard, `${action}-confirm`, "Enter");
  return {
    before: transition.before,
    traversalKey: transition.key,
    after: transition.after,
    activationKey: "Enter",
    activationTarget,
  };
}

async function pressAndRecordFocusTransition(page, keyboard, action, key, { from, to }) {
  await page.waitForFunction((selector) => document.activeElement?.matches(selector), from, { timeout: 30_000 });
  const transition = { action, key, before: await focusEvidence(page), after: null };
  keyboard.actions.push(transition);
  await page.keyboard.press(key);
  await page.waitForTimeout(50);
  transition.after = await focusEvidence(page);
  if (!(await page.evaluate((selector) => document.activeElement?.matches(selector), to))) {
    throw new Error(`Keyboard focus transition ${action} did not reach ${to}.`);
  }
  return transition;
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

async function tabTo(
  page,
  selector,
  { failureEvidence, key = "Tab", limit = 180, observedTraversal = null, scopeSelector = null },
) {
  const boundedTraversal = [];
  let observedTraversalCount = 0;
  try {
    for (let index = 0; index < limit; index += 1) {
      const matched = await page.evaluate((candidate) => document.activeElement?.matches(candidate) === true, selector);
      if (matched) return;
      await page.keyboard.press(key);
      const focus = await focusEvidence(page);
      observedTraversalCount += 1;
      boundedTraversal.push(focus);
      if (boundedTraversal.length > 24) boundedTraversal.shift();
      if (observedTraversal) {
        observedTraversal.push(focus);
        if (observedTraversal.length > 24) observedTraversal.shift();
      }
    }
    throw new Error(`Keyboard traversal could not reach ${selector}.`);
  } catch (error) {
    const payload = {
      key,
      limit,
      observedTraversal: boundedTraversal,
      observedTraversalCount,
      scopeSelector,
      targetSelector: selector,
    };
    let diagnostic;
    try {
      diagnostic = await page.evaluate(
        (value) => globalThis.__inspectWayfinderWf43TabTraversal(value),
        payload,
      );
    } catch (diagnosticError) {
      diagnostic = {
        ...payload,
        active: null,
        target: null,
        localOrderIndex: -1,
        localTabOrder: [],
        localTabOrderCount: 0,
        localTabOrderTruncated: false,
        observedTraversalTruncated: observedTraversalCount > boundedTraversal.length,
        diagnosticError: errorMessage(diagnosticError),
      };
    }
    failureEvidence.push({
      ...diagnostic,
      error: { name: error instanceof Error ? error.name : "Error", message: errorMessage(error) },
    });
    throw error;
  }
}

async function waitFor(page, selector, timeout = 30_000) {
  await page.waitForFunction((candidate) => Boolean(document.querySelector(candidate)), selector, { timeout });
}

async function waitForEither(page, selectors) {
  await page.waitForFunction((candidates) => candidates.some((candidate) => document.querySelector(candidate)), selectors, {
    timeout: 30_000,
  });
}

async function waitForInputValue(page, selector, value) {
  await page.waitForFunction(
    ({ candidate, expected }) => document.querySelector(candidate)?.value === expected,
    { candidate: selector, expected: value },
    { timeout: 30_000 },
  );
}

async function setFoundryLanguage(gmPage, playerPage, language) {
  return switchFoundryClientLanguages(languageTargets(gmPage, playerPage), language, {
    moduleId: MODULE_ID,
    reload: reloadSuites,
  });
}

function languageTargets(gmPage, playerPage) {
  return [
    { role: "gm", page: gmPage },
    ...(playerPage ? [{ role: "player", page: playerPage }] : []),
  ];
}

async function installSuites(page) {
  await loadWayfinderBrowserSuite(page, { afterSuitePaths: [suitePath] });
}

async function snapshotWf43SetupBoundary(page) {
  return page.evaluate(({ moduleId, packsSetting, policySetting }) => ({
    actorCount: globalThis.game.actors.size,
    language: structuredClone(globalThis.game.settings.get("core", "language")),
    packs: structuredClone(globalThis.game.settings.get("pf2e", packsSetting)),
    policy: structuredClone(globalThis.game.settings.get(moduleId, policySetting)),
  }), {
    moduleId: MODULE_ID,
    packsSetting: PACKS_SETTING,
    policySetting: POLICY_SETTING,
  });
}

function expectedWf43FixtureIdentities(runId) {
  return wf43ExperienceCases.map((definition) => ({
    definitionFingerprint: definition.definitionFingerprint,
    fixtureName: `${FIXTURE_PREFIX} - ${definition.id} - wf43-experience-${definition.id}-${runId} - ${runId}`,
    locale: definition.id,
    profileId: `wf43-experience-${definition.id}-${runId}`,
  }));
}

async function reloadSuites(page) {
  await reloadWayfinderBrowserSuite(page, { afterSuitePaths: [suitePath] });
}

function nonEmptyValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string" && entry.trim()));
}

function emptyCleanup() {
  return {
    attempted: false,
    setupCompleted: false,
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

function removeResolvedSettingsFailures(failures) {
  const unresolved = failures.filter(
    (failure) =>
      !failure.startsWith("equipment policy restoration failed:") &&
      !failure.startsWith("PF2E pack restoration failed:"),
  );
  failures.splice(0, failures.length, ...unresolved);
}

function assertKeyboardEntry(entry, expected) {
  if (
    entry?.mode !== expected.mode ||
    entry?.state !== expected.state ||
    entry?.action !== expected.action ||
    entry?.focusMethod !== "programmatic-harness-anchor-before-keyboard-actions" ||
    entry?.anchor?.focused !== true ||
    entry?.anchor?.keyboardFocus !== "true" ||
    entry?.target?.present !== true ||
    entry?.target?.visible !== true ||
    entry?.target?.disabled !== false ||
    entry?.target?.keyboardFocus !== "true" ||
    !Number.isInteger(entry?.target?.tabIndex) ||
    entry.target.tabIndex < 0 ||
    entry?.target?.localOrderIndex < 0
  ) {
    throw new Error(`WF-080-43 keyboard entry target is not a visible enabled local tab stop: ${JSON.stringify(entry)}.`);
  }
}

function cleanupEvidenceFailures(cleanup, expectedActorCount) {
  const failures = [...(cleanup.restorationFailures ?? [])];
  if (cleanup.attempted !== true) failures.push("Cleanup was not attempted.");
  if (cleanup.setupCompleted !== true) failures.push("Setup completion was not retained in cleanup evidence.");
  if (cleanup.actorsDeleted !== expectedActorCount) failures.push("Cleanup did not delete the exact fixture actor count.");
  if (cleanup.actorsMissingAfterCleanup !== true) failures.push("Fixture actors remain after cleanup.");
  if (cleanup.actorCountRestored !== true) failures.push("Actor count was not restored.");
  if (cleanup.exactFixturesMatched !== true) failures.push("Cleanup identity did not match every exact fixture.");
  if (cleanup.policyRestored !== true) failures.push("Equipment policy was not restored.");
  if (cleanup.packsRestored !== true) failures.push("PF2E pack settings were not restored.");
  if (cleanup.languageRestored !== true) failures.push("Foundry language was not restored.");
  return failures;
}

function serializeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: errorMessage(error),
    stack: error instanceof Error && typeof error.stack === "string" ? error.stack : null,
  };
}

function formatStage(stage) {
  if (!stage) return "unknown";
  return [stage.id, stage.locale, stage.state, stage.width, stage.action].filter((value) => value !== undefined).join("/");
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
