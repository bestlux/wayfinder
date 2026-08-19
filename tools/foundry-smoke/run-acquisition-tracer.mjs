#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import {
  createExclusiveAcquisitionTracerArtifactDirectory,
  writeAcquisitionTracerArtifacts,
} from "./acquisition-tracer-artifacts.mjs";
import {
  acquisitionSmokeCases,
  validateAcquisitionSmokeCaseDefinition,
} from "./acquisition-cases.mjs";
import {
  closeFoundryBrowser,
  loginToFoundryWorld,
  resolveFoundryChromePath,
} from "./browser-session.mjs";
import { qualifySmokeResult } from "./evidence-contract.mjs";

const MODULE_ID = "wayfinder-pf2e";
const fixturePrefix = "WF Smoke Harness";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");

function usage() {
  return `Usage: node tools/foundry-smoke/run-acquisition-tracer.mjs [options]

Options:
  --case <id>  Run one acquisition case. Can be passed more than once.
  --list       List acquisition tracer case ids.
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
  if (cli.list) {
    for (const smokeCase of acquisitionSmokeCases) console.log(`${smokeCase.id} - ${smokeCase.label}`);
    return;
  }
  const cases = selectCases(cli.caseIds);
  for (const smokeCase of cases) {
    const failures = validateAcquisitionSmokeCaseDefinition(smokeCase);
    if (failures.length > 0) throw new Error(failures.join(" "));
  }
  const { ownerCases, gmReviewCases } = partitionCasesByExecutor(cases);
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
  const outDir = await createExclusiveAcquisitionTracerArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const headless = cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true);
  const browser = await chromium.launch({ executablePath: chromePath, headless });
  const setupContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
  const setupPage = await setupContext.newPage();
  let playerContext = null;
  let gmReviewContext = null;
  let setup = null;
  let equipmentSettingsSnapshot = null;
  let equipmentSettingsRestored = false;
  let ownerResult = null;
  let gmReviewResult = null;
  let result;
  let cleanup = null;

  try {
    await loginToFoundryWorld(setupPage, {
      foundryUrl,
      password: process.env.FOUNDRY_PASSWORD ?? "",
      user: options.setupUser,
    });
    await setupPage.addScriptTag({ path: browserSuitePath });
    equipmentSettingsSnapshot = await captureEquipmentSettings(setupPage, MODULE_ID);
    await setEquipmentApplyAuthority(setupPage, MODULE_ID, "actor-owner");
    setup = await setupPage.evaluate(
      (payload) => globalThis.__prepareWayfinderAcquisitionTracer(payload),
      {
        allowDestructive: options.allowDestructive,
        cases,
        expectedWorldId: options.expectedWorldId,
        fixturePrefix,
        moduleId: MODULE_ID,
        playerName: options.playerUser,
        runId,
      },
    );

    if (ownerCases.length > 0) {
      const ownerFixtures = fixturesForCases(setup.fixtures, ownerCases);
      playerContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
      await playerContext.addInitScript(
        (bootstrap) => {
          Object.defineProperty(globalThis, "__wayfinderAcquisitionSmokeBootstrap", {
            configurable: true,
            enumerable: false,
            value: Object.freeze(bootstrap),
            writable: false,
          });
        },
        acquisitionBootstrap({
          cases: ownerCases,
          executorRole: "non-gm-owner",
          executorUserId: setup.playerId,
          fixtures: ownerFixtures,
          moduleId: MODULE_ID,
          preparedByUserId: setup.reviewSession.userId,
          runId,
          worldId: options.expectedWorldId,
        }),
      );
      const playerPage = await playerContext.newPage();
      await loginToFoundryWorld(playerPage, {
        foundryUrl,
        password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
        user: options.playerUser,
      });
      await playerPage.addScriptTag({ path: browserSuitePath });
      ownerResult = await playerPage.evaluate(
        (payload) => globalThis.__runWayfinderAcquisitionTracer(payload),
        {
          cases: ownerCases,
          expectedExecutorId: setup.playerId,
          expectedExecutorRole: "non-gm-owner",
          expectedWorldId: options.expectedWorldId,
          fixtures: ownerFixtures,
          moduleId: MODULE_ID,
          runId,
        },
      );
      await playerContext.close();
      playerContext = null;
    }

    if (gmReviewCases.length > 0) {
      const gmReviewFixtures = fixturesForCases(setup.fixtures, gmReviewCases);
      await setEquipmentApplyAuthority(setupPage, MODULE_ID, "gm-review");
      gmReviewContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
      await gmReviewContext.addInitScript(
        (bootstrap) => {
          Object.defineProperty(globalThis, "__wayfinderAcquisitionSmokeBootstrap", {
            configurable: true,
            enumerable: false,
            value: Object.freeze(bootstrap),
            writable: false,
          });
        },
        acquisitionBootstrap({
          cases: gmReviewCases,
          executorRole: "gm-reviewer",
          executorUserId: setup.reviewSession.userId,
          fixtures: gmReviewFixtures,
          moduleId: MODULE_ID,
          preparedByUserId: setup.reviewSession.userId,
          runId,
          worldId: options.expectedWorldId,
        }),
      );
      const gmReviewPage = await gmReviewContext.newPage();
      await loginToFoundryWorld(gmReviewPage, {
        foundryUrl,
        password: process.env.FOUNDRY_PASSWORD ?? "",
        user: options.setupUser,
      });
      await gmReviewPage.addScriptTag({ path: browserSuitePath });
      gmReviewResult = await gmReviewPage.evaluate(
        (payload) => globalThis.__runWayfinderAcquisitionTracer(payload),
        {
          cases: gmReviewCases,
          expectedExecutorId: setup.reviewSession.userId,
          expectedExecutorRole: "gm-reviewer",
          expectedWorldId: options.expectedWorldId,
          fixtures: gmReviewFixtures,
          moduleId: MODULE_ID,
          runId,
        },
      );
      await gmReviewContext.close();
      gmReviewContext = null;
    }

    result = mergeAcquisitionTracerResults(ownerResult, gmReviewResult, cases);
    await restoreEquipmentSettings(setupPage, MODULE_ID, equipmentSettingsSnapshot);
    equipmentSettingsRestored = true;
    if (result) {
      await setupPage.reload({ waitUntil: "domcontentloaded" });
      await setupPage.waitForFunction(() => globalThis.game?.ready === true, null, {
        timeout: 60000,
      });
      await setupPage.addScriptTag({ path: browserSuitePath });
      const durability = await setupPage.evaluate(
        (payload) => globalThis.__collectWayfinderAcquisitionDurability(payload),
        {
          cases,
          expectedWorldId: options.expectedWorldId,
          fixtures: setup.fixtures,
          moduleId: MODULE_ID,
          runId,
        },
      );
      attachDurabilityEvidence(result, cases, durability);
    }
  } finally {
    try {
      try {
        if (playerContext) {
          await playerContext.close();
          playerContext = null;
        }
      } finally {
        if (gmReviewContext) {
          await gmReviewContext.close();
          gmReviewContext = null;
        }
      }
    } finally {
      try {
        if (equipmentSettingsSnapshot && !equipmentSettingsRestored) {
          await restoreEquipmentSettings(setupPage, MODULE_ID, equipmentSettingsSnapshot);
          equipmentSettingsRestored = true;
        }
      } finally {
        try {
          if (setup) {
            cleanup = await setupPage.evaluate(
              (payload) => globalThis.__cleanupWayfinderAcquisitionTracer(payload),
              {
                allowDestructive: options.allowDestructive,
                expectedWorldId: options.expectedWorldId,
                fixtures: setup.fixtures,
                moduleId: MODULE_ID,
                runId,
              },
            );
          }
        } finally {
          await closeFoundryBrowser(setupContext, browser);
        }
      }
    }
  }

  if (!result) throw new Error("Acquisition tracer produced no executor evidence.");
  Object.assign(result, {
    evidenceId,
    caseDefinitionFingerprints: cases.map((smokeCase) => ({
      caseId: smokeCase.id,
      fingerprint: smokeCase.definitionFingerprint,
    })),
    cleanup,
    reviewSession: acquisitionReviewSession(setup, gmReviewResult, gmReviewCases, options.expectedWorldId),
  });
  result = qualifySmokeResult(result, cases);
  const markdown = buildMarkdown(result);
  await writeAcquisitionTracerArtifacts(outDir, result, markdown);
  printSummary(result, outDir);
  if (!result.qualification.passed) process.exitCode = 1;
}

function partitionCasesByExecutor(cases) {
  const ownerCases = [];
  const gmReviewCases = [];
  for (const smokeCase of cases) {
    if (smokeCase.acquisitionCase.executorRole === "non-gm-owner") ownerCases.push(smokeCase);
    else if (smokeCase.acquisitionCase.executorRole === "gm-reviewer") gmReviewCases.push(smokeCase);
    else throw new Error(`Unsupported acquisition executor role for ${smokeCase.id}.`);
  }
  return { ownerCases, gmReviewCases };
}

function fixturesForCases(fixtures, cases) {
  const fixturesById = new Map((fixtures ?? []).map((fixture) => [fixture.caseId, fixture]));
  const selected = cases.map((smokeCase) => fixturesById.get(smokeCase.id));
  if (selected.some((fixture) => !fixture)) {
    throw new Error("Acquisition executor lane is missing an exact guarded fixture.");
  }
  return selected;
}

function acquisitionBootstrap({
  cases,
  executorRole,
  executorUserId,
  fixtures,
  moduleId,
  preparedByUserId,
  runId,
  worldId,
}) {
  const casesById = new Map(cases.map((smokeCase) => [smokeCase.id, smokeCase]));
  return {
    schemaVersion: 1,
    nonce: randomUUID(),
    createdAt: Date.now(),
    moduleId,
    worldId,
    executorUserId,
    executorRole,
    preparedByUserId,
    runId,
    bindings: fixtures.map((fixture) => {
      const smokeCase = casesById.get(fixture.caseId);
      if (
        !smokeCase ||
        fixture.executorRole !== executorRole ||
        fixture.executorUserId !== executorUserId
      ) {
        throw new Error(`Acquisition fixture ${fixture.caseId} does not match its exact executor binding.`);
      }
      return {
        actorId: fixture.actorId,
        caseId: fixture.caseId,
        definitionFingerprint: fixture.definitionFingerprint,
        checkpointTarget: smokeCase.acquisitionCase.failure,
        caseDefinition: smokeCase,
      };
    }),
  };
}

async function captureEquipmentSettings(page, moduleId) {
  return page.evaluate((module) => ({
    policy: structuredClone(globalThis.game.settings.get(module, "equipmentPolicy")),
    judgments: structuredClone(globalThis.game.settings.get(module, "equipmentPolicyJudgments")),
  }), moduleId);
}

async function setEquipmentApplyAuthority(page, moduleId, applyAuthority) {
  return page.evaluate(
    async ({ authority, module }) => {
      const currentPolicy = structuredClone(globalThis.game.settings.get(module, "equipmentPolicy"));
      await globalThis.game.settings.set(module, "equipmentPolicy", { ...currentPolicy, applyAuthority: authority });
      const observed = globalThis.game.settings.get(module, "equipmentPolicy");
      if (observed?.applyAuthority !== authority) {
        throw new Error(`Acquisition tracer could not activate ${authority} equipment Apply authority.`);
      }
    },
    { authority: applyAuthority, module: moduleId },
  );
}

async function restoreEquipmentSettings(page, moduleId, snapshot) {
  if (!snapshot) return;
  await page.evaluate(
    async ({ module, saved }) => {
      await globalThis.game.settings.set(module, "equipmentPolicy", structuredClone(saved.policy));
      await globalThis.game.settings.set(module, "equipmentPolicyJudgments", structuredClone(saved.judgments));
      const policy = globalThis.game.settings.get(module, "equipmentPolicy");
      const judgments = globalThis.game.settings.get(module, "equipmentPolicyJudgments");
      if (JSON.stringify(policy) !== JSON.stringify(saved.policy) || JSON.stringify(judgments) !== JSON.stringify(saved.judgments)) {
        throw new Error("Acquisition tracer could not restore the exact equipment policy and judgment settings.");
      }
    },
    { module: moduleId, saved: snapshot },
  );
}

function mergeAcquisitionTracerResults(ownerResult, gmReviewResult, cases) {
  const laneResults = [ownerResult, gmReviewResult].filter(Boolean);
  if (laneResults.length === 0) return null;
  const primary = ownerResult ?? gmReviewResult;
  for (const lane of laneResults) {
    for (const field of ["foundryVersion", "pf2eVersion", "moduleId", "moduleVersion", "world"]) {
      if (lane[field] !== primary[field]) {
        throw new Error(`Acquisition executor contexts disagree on ${field}.`);
      }
    }
  }
  const entries = laneResults.flatMap((lane) => lane.cases ?? []);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  if (entriesById.size !== entries.length || cases.some((smokeCase) => !entriesById.has(smokeCase.id))) {
    throw new Error("Acquisition executor contexts did not produce exact, nonduplicate case coverage.");
  }
  const orderedCases = cases.map((smokeCase) => entriesById.get(smokeCase.id));
  return {
    ...primary,
    startedAt: (ownerResult ?? gmReviewResult).startedAt,
    finishedAt: (gmReviewResult ?? ownerResult).finishedAt,
    cases: orderedCases,
    summary: {
      classified: orderedCases.filter((entry) => entry.status === "classified").length,
      failed: orderedCases.filter((entry) => entry.status === "fail").length,
      passed: orderedCases.filter((entry) => entry.status === "pass").length,
    },
  };
}

function acquisitionReviewSession(setup, gmReviewResult, gmReviewCases, expectedWorldId) {
  if (gmReviewCases.length === 0) return setup.reviewSession;
  if (!gmReviewResult) throw new Error("GM-review acquisition cases produced no separate executor session.");
  return {
    source: "separate-gm-browser-context",
    userId: gmReviewResult.user.id,
    role: gmReviewResult.user.role,
    isGM: gmReviewResult.user.isGM,
    runtime: {
      foundryVersion: gmReviewResult.foundryVersion,
      pf2eVersion: gmReviewResult.pf2eVersion,
      moduleVersion: gmReviewResult.moduleVersion,
      guardedWorldMatched: gmReviewResult.world === expectedWorldId,
    },
    reviewedCaseIds: gmReviewResult.cases
      .filter((entry) => entry.status === "pass")
      .map((entry) => entry.id),
  };
}

function attachDurabilityEvidence(result, cases, durabilityEntries) {
  const expectedIds = cases.map((smokeCase) => smokeCase.id);
  const durabilityById = new Map((durabilityEntries ?? []).map((entry) => [entry?.caseId, entry]));
  if (
    !Array.isArray(durabilityEntries) ||
    durabilityById.size !== expectedIds.length ||
    expectedIds.some((id) => !durabilityById.has(id))
  ) {
    throw new Error("Reloaded GM durability evidence did not cover every exact acquisition case.");
  }
  for (const entry of result.cases ?? []) {
    const durability = durabilityById.get(entry.id);
    if (!entry.evidence?.acquisition || !durability) {
      throw new Error("Acquisition result cannot accept unmatched durability evidence.");
    }
    entry.evidence.acquisition.durability = durability;
  }
}

function validateOptions(options) {
  const failures = [];
  if (!options.setupUser.trim()) failures.push("An existing GM setup user is required.");
  if (!options.playerUser.trim()) failures.push("An existing non-GM player user is required.");
  if (options.setupUser.trim().toLowerCase() === options.playerUser.trim().toLowerCase()) {
    failures.push("The GM and player users must be distinct.");
  }
  if (!options.allowDestructive) failures.push("Acquisition tracer cleanup requires destructive opt-in.");
  if (!options.expectedWorldId.trim()) failures.push("Acquisition tracer cleanup requires an expected world id.");
  if (failures.length > 0) throw new Error(failures.join(" "));
  return options;
}

function selectCases(ids) {
  if (ids.length === 0) return [...acquisitionSmokeCases];
  const byId = new Map(acquisitionSmokeCases.map((smokeCase) => [smokeCase.id, smokeCase]));
  const selected = [...new Set(ids)].map((id) => byId.get(id));
  const missing = [...new Set(ids)].filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`Unknown acquisition tracer case id(s): ${missing.join(", ")}`);
  return selected;
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
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function buildMarkdown(result) {
  const rows = result.cases.map(
    (entry) => `| ${entry.id} | ${entry.status} | ${entry.failures.join("<br>") || "ok"} |`,
  );
  return `# Foundry Acquisition Tracer

- Evidence: ${result.evidenceId}
- World: ${result.world}
- Player role: ${result.user.role} (GM ${result.user.isGM})
- Review role: ${result.reviewSession.role} (GM ${result.reviewSession.isGM})
- Foundry: ${result.foundryVersion}
- PF2E: ${result.pf2eVersion}
- Wayfinder: ${result.moduleVersion}
- Cleanup: ${result.cleanup?.actorsMissingAfterCleanup === true ? "verified" : "not verified"}
- Qualified: ${result.qualification.passed}

| Case | Status | Notes |
| --- | --- | --- |
${rows.join("\n")}
`;
}

function printSummary(result, outDir) {
  console.log(`Foundry acquisition tracer artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of result.cases) {
    console.log(`${entry.status.toUpperCase()} ${entry.id}${entry.failures.length ? `: ${entry.failures.join("; ")}` : ""}`);
  }
}

await main().catch(() => {
  console.error("Foundry acquisition tracer could not initialize or publish its guarded evidence directory.");
  process.exitCode = 1;
});
