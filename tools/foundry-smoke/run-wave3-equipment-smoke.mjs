#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";
import {
  createWave3EquipmentArtifactDirectory,
  writeWave3EquipmentArtifacts,
} from "./wave3-equipment-artifacts.mjs";
import {
  validateWave3EquipmentCaseDefinition,
  wave3EquipmentCases,
} from "./wave3-equipment-cases.mjs";
import { qualifyWave3EquipmentResult } from "./wave3-equipment-evidence.mjs";

const MODULE_ID = "wayfinder-pf2e";
const POLICY_SETTING = "equipmentPolicy";
const JUDGMENT_SETTING = "equipmentPolicyJudgments";
const FIXTURE_PREFIX = "WF Smoke Harness - Wave 3 equipment";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const suitePath = path.join(repoRoot, "tools", "foundry-smoke", "wave3-equipment-browser-suite.js");

function usage() {
  return `Usage: node tools/foundry-smoke/run-wave3-equipment-smoke.mjs [options]

Options:
  --case <id>  Run one case. Can be passed more than once.
  --list       List case ids.
  --out <path> Fresh artifact directory override.
  --headed     Run with a visible browser.
  --help       Show this help text.

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
`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }
  if (cli.list) {
    for (const smokeCase of wave3EquipmentCases) console.log(`${smokeCase.id} - ${smokeCase.label}`);
    return;
  }
  const cases = selectCases(cli.caseIds);
  for (const smokeCase of cases) {
    const failures = validateWave3EquipmentCaseDefinition(smokeCase);
    if (failures.length > 0) throw new Error(failures.join(" "));
  }
  const options = validateOptions({
    setupUser: process.env.FOUNDRY_USER ?? "",
    playerUser: process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "",
    expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
    allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
  });
  const chromePath = resolveFoundryChromePath();
  if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");

  const evidenceId = randomUUID();
  const runId = randomUUID();
  const outDir = await createWave3EquipmentArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
  });
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const playerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const gmPage = await gmContext.newPage();
  const playerPage = await playerContext.newPage();
  let setup = null;
  let cleanup = null;
  let playerStart;
  let finalVerification;

  try {
    await loginToFoundryWorld(gmPage, {
      foundryUrl,
      user: options.setupUser,
      password: process.env.FOUNDRY_PASSWORD ?? "",
    });
    await installSuite(gmPage);
    setup = await gmPage.evaluate(
      (payload) => globalThis.__prepareWayfinderWave3EquipmentSmoke(payload),
      sharedPayload({ cases, options, runId }),
    );
    console.log(`Wave 3 equipment: prepared ${setup.fixtures.length} guarded fixture(s).`);

    await loginToFoundryWorld(playerPage, {
      foundryUrl,
      user: options.playerUser,
      password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
    });
    await installSuite(playerPage);
    playerStart = await playerPage.evaluate(
      (payload) => globalThis.__runWayfinderWave3PlayerStart(payload),
      phasePayload(setup, cases, options, runId, setup.playerId),
    );
    console.log("Wave 3 equipment: player start requests and zero-write denial finished.");

    await reloadSuite(gmPage);
    await gmPage.evaluate(
      (payload) => globalThis.__runWayfinderWave3GmApproval(payload),
      phasePayload(setup, cases, options, runId, setup.gm.id),
    );
    console.log("Wave 3 equipment: GM start approvals and direct judgments finished.");

    if (cases.some((entry) => entry.configuredItem)) {
      await reloadSuite(playerPage);
      await playerPage.evaluate(
        (payload) => globalThis.__runWayfinderWave3PlayerExceptionRequests(payload),
        phasePayload(setup, cases, options, runId, setup.playerId),
      );
      console.log("Wave 3 equipment: player exact-item request finished.");

      await reloadSuite(gmPage);
      await gmPage.evaluate(
        (payload) => globalThis.__runWayfinderWave3GmExceptionApprovals(payload),
        phasePayload(setup, cases, options, runId, setup.gm.id),
      );
      console.log("Wave 3 equipment: GM exact-item approval finished.");
    }

    await reloadSuite(playerPage);
    finalVerification = await playerPage.evaluate(
      (payload) => globalThis.__runWayfinderWave3PlayerVerification(payload),
      phasePayload(setup, cases, options, runId, setup.playerId),
    );
    console.log("Wave 3 equipment: non-GM durable verification finished.");
  } finally {
    try {
      if (setup) {
        await reloadSuite(gmPage);
        cleanup = await gmPage.evaluate(
          (payload) => globalThis.__cleanupWayfinderWave3EquipmentSmoke(payload),
          {
            allowDestructive: options.allowDestructive,
            expectedWorldId: options.expectedWorldId,
            fixtures: setup.fixtures,
            judgmentSetting: JUDGMENT_SETTING,
            moduleId: MODULE_ID,
            policySetting: POLICY_SETTING,
            policySnapshot: setup.policySnapshot,
            runId,
          },
        );
        console.log("Wave 3 equipment: guarded fixtures and judgments cleaned up.");
      }
    } finally {
      await playerContext.close();
      await closeFoundryBrowser(gmContext, browser);
    }
  }

  if (!setup || !playerStart || !finalVerification) {
    throw new Error("Wave 3 equipment smoke produced incomplete role evidence.");
  }
  const result = {
    schemaVersion: 1,
    evidenceId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    runtime: setup.runtime,
    users: { gm: setup.gm, player: finalVerification.player },
    zeroWrite: playerStart.zeroWrite,
    cases: finalVerification.cases,
    cleanup,
  };
  const qualification = qualifyWave3EquipmentResult(result, cases);
  if (
    cleanup?.actorsMissingAfterCleanup !== true ||
    cleanup?.fixtureJudgmentsRemoved !== true ||
    cleanup?.policyRestored !== true
  ) {
    qualification.ok = false;
    qualification.failures.push("Guarded cleanup did not prove actor deletion, judgment removal, and policy restoration.");
  }
  await writeWave3EquipmentArtifacts(outDir, result, qualification);
  console.log(`Wave 3 equipment artifacts: ${path.relative(repoRoot, outDir)}`);
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
    judgmentSetting: JUDGMENT_SETTING,
    moduleId: MODULE_ID,
    playerName: options.playerUser,
    policySetting: POLICY_SETTING,
    runId,
  };
}

function phasePayload(setup, cases, options, runId, expectedUserId) {
  return {
    cases,
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

function validateOptions(options) {
  const failures = [];
  if (!options.setupUser.trim()) failures.push("An existing GM setup user is required.");
  if (!options.playerUser.trim()) failures.push("An existing non-GM player user is required.");
  if (options.setupUser.trim().toLowerCase() === options.playerUser.trim().toLowerCase()) {
    failures.push("GM and player users must be distinct.");
  }
  if (!options.expectedWorldId.trim()) failures.push("An exact guarded world id is required.");
  if (!options.allowDestructive) failures.push("Guarded fixture cleanup requires destructive opt-in.");
  if (failures.length > 0) throw new Error(failures.join(" "));
  return options;
}

function selectCases(caseIds) {
  if (caseIds.length === 0) return [...wave3EquipmentCases];
  const byId = new Map(wave3EquipmentCases.map((entry) => [entry.id, entry]));
  const missing = [...new Set(caseIds)].filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`Unknown Wave 3 equipment case id(s): ${missing.join(", ")}`);
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
  console.error(`Wave 3 equipment smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
