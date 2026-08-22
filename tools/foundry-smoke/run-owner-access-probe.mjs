#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import {
  createExclusiveOwnerProbeArtifactDirectory,
  writeOwnerProbeArtifacts,
} from "./owner-probe-artifacts.mjs";
import {
  closeFoundryBrowser,
  loginToFoundryWorld,
  resolveFoundryChromePath,
} from "./browser-session.mjs";
import { buildOwnerProbeEvidence, validateOwnerProbeOptions } from "./owner-probe-contract.mjs";
import { loadWayfinderBrowserSuite } from "./shared-browser-suite-lifecycle.mjs";

const MODULE_ID = "wayfinder-pf2e";
const fixturePrefix = "WF Smoke Harness";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function usage() {
  return `Usage: node tools/foundry-smoke/run-owner-access-probe.mjs [options]

Options:
  --out <path>  Fresh artifact directory. Defaults to .wayfinder-smoke/owner-probe-<timestamp>-<id>.
  --headed      Run with a visible browser.
  --help        Show this help text.

Environment:
  FOUNDRY_URL                         Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER                        Existing GM setup user.
  FOUNDRY_PASSWORD                    GM password. Optional.
  FOUNDRY_SMOKE_PLAYER_USER           Existing, distinct non-GM user.
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
  const options = validateOwnerProbeOptions({
    setupUser: process.env.FOUNDRY_USER ?? "",
    playerUser: process.env.FOUNDRY_SMOKE_PLAYER_USER ?? "",
    allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
    expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
  });
  const chromePath = resolveFoundryChromePath();
  if (!chromePath) {
    throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH to a browser executable.");
  }

  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const headless = cli.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true);
  const startedAt = new Date().toISOString();
  const evidenceId = randomUUID();
  const runId = randomUUID();
  const outDir = await createExclusiveOwnerProbeArtifactDirectory(repoRoot, cli.outDir, evidenceId);
  const failureStages = [];
  let browser = null;
  let setupContext = null;
  let setupPage = null;
  let playerContext = null;
  let setup = null;
  let player = null;
  let cleanup = null;

  try {
    try {
      browser = await chromium.launch({ executablePath: chromePath, headless });
      setupContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
      setupPage = await setupContext.newPage();
      await loginToFoundryWorld(setupPage, {
        foundryUrl,
        password: process.env.FOUNDRY_PASSWORD ?? "",
        user: options.setupUser,
      });
      await loadWayfinderBrowserSuite(setupPage);
      setup = await setupPage.evaluate(
        (payload) => globalThis.__prepareWayfinderOwnerProbe(payload),
        {
          allowDestructive: options.allowDestructive,
          expectedWorldId: options.expectedWorldId,
          fixturePrefix,
          moduleId: MODULE_ID,
          playerName: options.playerUser,
          runId,
        },
      );
    } catch {
      failureStages.push("setup-session");
    }

    if (setup && browser) {
      try {
        playerContext = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
        const playerPage = await playerContext.newPage();
        await loginToFoundryWorld(playerPage, {
          foundryUrl,
          password: process.env.FOUNDRY_SMOKE_PLAYER_PASSWORD ?? "",
          user: options.playerUser,
        });
        await loadWayfinderBrowserSuite(playerPage);
        player = await playerPage.evaluate(
          (payload) => globalThis.__runWayfinderOwnerProbe(payload),
          {
            actorId: setup.actorId,
            expectedPlayerId: setup.playerId,
            expectedWorldId: options.expectedWorldId,
            moduleId: MODULE_ID,
            runId,
          },
        );
      } catch {
        failureStages.push("player-session");
      } finally {
        if (playerContext) {
          try {
            await playerContext.close();
          } catch {
            failureStages.push("player-context-close");
          } finally {
            playerContext = null;
          }
        }
      }
    }

    if (setup && setupPage) {
      try {
        cleanup = await setupPage.evaluate(
          (payload) => globalThis.__cleanupWayfinderOwnerProbe(payload),
          {
            actorId: setup.actorId,
            allowDestructive: options.allowDestructive,
            expectedWorldId: options.expectedWorldId,
            fixtureName: setup.fixtureName,
            moduleId: MODULE_ID,
            runId,
          },
        );
      } catch {
        failureStages.push("cleanup");
      }
    }
  } finally {
    try {
      if (setupContext && browser) await closeFoundryBrowser(setupContext, browser);
      else if (browser) await browser.close();
    } catch {
      failureStages.push("browser-close");
    }
  }

  const uniqueFailureStages = [...new Set(failureStages)];
  const result = buildOwnerProbeEvidence({
    evidenceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    setup,
    player,
    cleanup,
    execution: {
      completed: uniqueFailureStages.length === 0,
      failureStages: uniqueFailureStages,
    },
  });
  const markdown = buildMarkdown(result);
  await writeOwnerProbeArtifacts(outDir, result, markdown);
  printSummary(result, outDir);
  if (!result.qualification.passed) process.exitCode = 1;
}

function parseArgs(argv) {
  const options = { headed: false, help: false, outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --out.");
      options.outDir = value;
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
  return `# Foundry Owner Probe

- Evidence: ${result.evidenceId}
- Started: ${result.startedAt}
- Finished: ${result.finishedAt}
- Foundry: ${result.runtime.foundryVersion ?? "unknown"}
- PF2E: ${result.runtime.pf2eVersion ?? "unknown"}
- Wayfinder: ${result.runtime.moduleVersion ?? "unknown"}
- Setup role: ${result.setupSession.role} (GM ${result.setupSession.isGM})
- Player role: ${result.playerSession.role} (GM ${result.playerSession.isGM})
- Execution stages: ${result.execution.failureStages.join(", ") || "none"}
- Qualified: ${result.qualification.passed}
- Failures: ${result.failures.join("; ") || "none"}
`;
}

function printSummary(result, outDir) {
  console.log(`Foundry owner probe artifacts: ${path.relative(repoRoot, outDir)}`);
  console.log(result.qualification.passed ? "PASS owner-probe" : `FAIL owner-probe: ${result.failures.join("; ")}`);
}

await main().catch(() => {
  console.error("Foundry owner probe could not initialize or publish its guarded evidence directory.");
  process.exitCode = 1;
});
