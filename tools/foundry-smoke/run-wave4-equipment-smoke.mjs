#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import { createWave4EquipmentArtifactDirectory, writeWave4EquipmentArtifacts } from "./wave4-equipment-artifacts.mjs";
import { validateWave4EquipmentCaseDefinition, wave4EquipmentCases } from "./wave4-equipment-cases.mjs";
import { qualifyWave4EquipmentResult } from "./wave4-equipment-evidence.mjs";

const MODULE_ID = "wayfinder-pf2e";
const POLICY_SETTING = "equipmentPolicy";
const PF2E_PACKS_SETTING = "compendiumBrowserPacks";
const PF2E_SOURCES_SETTING = "compendiumBrowserSources";
const FIXTURE_PREFIX = "WF Smoke Harness - Wave 4 equipment";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const suitePath = path.join(repoRoot, "tools", "foundry-smoke", "wave4-equipment-browser-suite.js");

function usage() {
  return `Usage: node tools/foundry-smoke/run-wave4-equipment-smoke.mjs [options]

Options:
  --case <id>  Run one case. Can be passed more than once.
  --list       List case ids.
  --out <path> Fresh artifact directory override.
  --headed     Run with a visible browser.
  --help       Show this help text.

Environment:
  FOUNDRY_URL                         Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER                        Existing GM setup/probe/cleanup user.
  FOUNDRY_PASSWORD                    GM password. Optional.
  FOUNDRY_SMOKE_PLAYER_USER           Existing, distinct non-GM actor owner.
  FOUNDRY_SMOKE_PLAYER_PASSWORD       Player password. Optional.
  FOUNDRY_SMOKE_WORLD_ID              Exact guarded world id.
  FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE     true/false. Required for guarded fixture cleanup.
  FOUNDRY_CHROME_PATH                 Chrome/Edge executable path override.
  FOUNDRY_SMOKE_HEADLESS              true/false. Defaults to true.
`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) return console.log(usage());
  if (cli.list) {
    for (const smokeCase of wave4EquipmentCases) console.log(`${smokeCase.id} - ${smokeCase.label}`);
    return;
  }
  const cases = selectCases(cli.caseIds);
  for (const smokeCase of cases) {
    const failures = validateWave4EquipmentCaseDefinition(smokeCase);
    if (failures.length > 0) throw new Error(failures.join(" "));
  }
  if (cases.length !== wave4EquipmentCases.length) {
    throw new Error("The Wave 4 equipment gate is an atomic three-case/two-actor proof; partial live runs are not qualified.");
  }
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
  const outDir = await createWave4EquipmentArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
  });
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const playerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const gmPage = await gmContext.newPage();
  const playerPage = await playerContext.newPage();
  let setup = null;
  let initial;
  let retry;
  let gmProbe;
  let verification;
  let cleanup = null;

  try {
    await loginToFoundryWorld(gmPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.gmUser,
      password: process.env.FOUNDRY_PASSWORD ?? "",
    });
    await installSuite(gmPage);
    setup = await gmPage.evaluate(
      (payload) => globalThis.__prepareWayfinderWave4EquipmentSmoke(payload),
      sharedPayload({ cases, options, runId }),
    );
    console.log(`Wave 4 equipment: prepared ${setup.fixtures.length} guarded actors.`);

    await loginToFoundryWorld(playerPage, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      user: options.playerUser,
      password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
    });
    await installSuite(playerPage);
    initial = await playerPage.evaluate(
      (payload) => globalThis.__runWayfinderWave4PlayerInitial(payload),
      phasePayload(setup, cases, options, runId, setup.playerId),
    );
    console.log("Wave 4 equipment: physical boundaries, source denial, and forced kit failure finished.");

    await reloadSuite(playerPage);
    retry = await playerPage.evaluate(
      (payload) => globalThis.__runWayfinderWave4PlayerRetry(payload),
      phasePayload(setup, cases, options, runId, setup.playerId),
    );
    console.log("Wave 4 equipment: fresh-reload kit retry converged.");

    await reloadSuite(gmPage);
    gmProbe = await gmPage.evaluate(
      (payload) => globalThis.__runWayfinderWave4GmProbe(payload),
      phasePayload(setup, cases, options, runId, setup.gm.id),
    );
    console.log("Wave 4 equipment: GM source projection recorded.");

    await reloadSuite(playerPage);
    verification = await playerPage.evaluate(
      (payload) => globalThis.__runWayfinderWave4PlayerVerification(payload),
      phasePayload(setup, cases, options, runId, setup.playerId),
    );
    console.log("Wave 4 equipment: durable manifest and no-op rerun verified.");
  } finally {
    try {
      if (setup) {
        await reloadSuite(gmPage);
        cleanup = await gmPage.evaluate(
          (payload) => globalThis.__cleanupWayfinderWave4EquipmentSmoke(payload),
          {
            allowDestructive: options.allowDestructive,
            expectedWorldId: options.expectedWorldId,
            fixtures: setup.fixtures,
            moduleId: MODULE_ID,
            packsSetting: PF2E_PACKS_SETTING,
            policySetting: POLICY_SETTING,
            runId,
            snapshots: setup.snapshots,
            sourcesSetting: PF2E_SOURCES_SETTING,
          },
        );
        console.log("Wave 4 equipment: guarded actors and exact settings restored.");
      }
    } finally {
      await playerContext.close();
      await closeFoundryBrowser(gmContext, browser);
    }
  }

  if (!setup || !initial || !retry || !gmProbe || !verification) {
    throw new Error("Wave 4 equipment smoke produced incomplete role evidence.");
  }
  const result = {
    schemaVersion: 1,
    evidenceId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    runtime: setup.runtime,
    users: { gm: gmProbe.gm, player: verification.player },
    zeroWrite: initial.zeroWrite,
    cases: verification.cases,
    cleanup,
  };
  const qualification = qualifyWave4EquipmentResult(result, cases);
  await writeWave4EquipmentArtifacts(outDir, result, qualification);
  console.log(`Wave 4 equipment artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of result.cases) console.log(`${entry.status.toUpperCase()} ${entry.id}`);
  if (!qualification.ok) {
    for (const failure of qualification.failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
}

function sharedPayload({ cases, options, runId }) {
  return {
    allowDestructive: options.allowDestructive,
    cases,
    expectedWorldId: options.expectedWorldId,
    fixturePrefix: FIXTURE_PREFIX,
    moduleId: MODULE_ID,
    packsSetting: PF2E_PACKS_SETTING,
    playerName: options.playerUser,
    policySetting: POLICY_SETTING,
    runId,
    sourcesSetting: PF2E_SOURCES_SETTING,
  };
}

function phasePayload(setup, cases, options, runId, expectedUserId) {
  return {
    cases,
    expectedUserId,
    expectedWorldId: options.expectedWorldId,
    fixtures: setup.fixtures,
    moduleId: MODULE_ID,
    packsSetting: PF2E_PACKS_SETTING,
    policySetting: POLICY_SETTING,
    runId,
    sourcesSetting: PF2E_SOURCES_SETTING,
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

function selectCases(caseIds) {
  if (caseIds.length === 0) return [...wave4EquipmentCases];
  const byId = new Map(wave4EquipmentCases.map((entry) => [entry.id, entry]));
  const missing = [...new Set(caseIds)].filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`Unknown Wave 4 equipment case id(s): ${missing.join(", ")}`);
  return [...new Set(caseIds)].map((id) => byId.get(id));
}

function parseArgs(argv) {
  const options = { caseIds: [], headed: false, help: false, list: false, outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--case" || arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--case") options.caseIds.push(value);
      else options.outDir = value;
      index += 1;
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
  console.error(`Wave 4 equipment smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
