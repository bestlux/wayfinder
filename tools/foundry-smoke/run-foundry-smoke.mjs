#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const MODULE_ID = "pf2e-wayfinder";
const fixturePrefix = "WF Smoke Harness";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");
const defaultArtifactRoot = ".wayfinder-smoke";
const defaultChromePaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const smokeCases = [
  {
    id: "fighter-l1-l5-apply-rerun",
    label: "Fighter level 1 through 5 apply/rerun",
    className: "Fighter",
    classSlug: "fighter",
    keyAbility: "str",
    targetLevel: 5,
    preferredSelections: {
      "ancestry-feat": ["Cooperative Nature", "Haughty Obstinacy"],
      "class-feat": ["Reactive Shield", "Intimidating Strike", "Quick Reversal"],
      "general-feat": ["Toughness"],
      "skill-feat": ["Cat Fall", "Forager", "Acrobatic Performer", "Group Impression", "Quick Jump"],
    },
    preferredSkills: ["athletics", "acrobatics", "survival", "intimidation", "religion", "stealth"],
  },
  {
    id: "investigator-l1-l5-apply-rerun",
    label: "Investigator level 1 through 5 apply/rerun",
    className: "Investigator",
    classSlug: "investigator",
    keyAbility: "int",
    targetLevel: 5,
    preferredSelections: {
      "ancestry-feat": ["Cooperative Nature", "Haughty Obstinacy"],
      "class-branch-methodology-level-1": [
        "Interrogation Methodology",
        "Forensic Medicine Methodology",
        "Empiricism Methodology",
      ],
      "class-feat": ["Known Weaknesses", "Flexible Studies", "Scalpel's Point"],
      "general-feat": ["Toughness"],
      "skill-feat": ["Cat Fall", "Forager", "Experienced Smuggler", "Acrobatic Performer", "Group Impression"],
    },
    preferredSkills: ["society", "arcana", "crafting", "medicine", "diplomacy", "stealth", "thievery", "deception"],
  },
  {
    id: "wizard-l1-l5-apply-rerun",
    label: "Wizard level 1 through 5 apply/rerun",
    className: "Wizard",
    classSlug: "wizard",
    keyAbility: "int",
    targetLevel: 5,
    preferredSelections: {
      "ancestry-feat": ["Cooperative Nature", "Haughty Obstinacy"],
      "class-feat": ["Reach Spell", "Counterspell", "Cantrip Expansion"],
      "general-feat": ["Toughness"],
      "skill-feat": ["Recognize Spell", "Cat Fall", "Forager", "Acrobatic Performer"],
    },
    preferredSkills: ["arcana", "crafting", "society", "occultism", "religion", "medicine", "nature"],
  },
  {
    id: "cleric-l1-l5-apply-rerun",
    label: "Cleric level 1 through 5 apply/rerun",
    className: "Cleric",
    classSlug: "cleric",
    deityName: "Sarenrae",
    keyAbility: "wis",
    targetLevel: 5,
    preferredSelections: {
      deity: ["Sarenrae", "Pharasma", "Abadar"],
      "ancestry-feat": ["Cooperative Nature", "Haughty Obstinacy"],
      "class-branch-doctrine-level-1": ["Cloistered Cleric", "Warpriest"],
      "class-feat": ["Healing Hands", "Reach Spell", "Sap Life"],
      "general-feat": ["Toughness"],
      "skill-feat": ["Forager", "Recognize Spell", "Cat Fall", "Acrobatic Performer"],
    },
    preferredSkills: ["religion", "medicine", "diplomacy", "nature", "society", "athletics", "survival"],
  },
  {
    id: "sorcerer-l1-l5-apply-rerun",
    label: "Sorcerer level 1 through 5 apply/rerun",
    className: "Sorcerer",
    classSlug: "sorcerer",
    keyAbility: "cha",
    targetLevel: 5,
    preferredSelections: {
      "ancestry-feat": ["Cooperative Nature", "Haughty Obstinacy"],
      "class-feat": ["Dangerous Sorcery", "Reach Spell", "Cantrip Expansion"],
      "general-feat": ["Toughness"],
      "skill-feat": ["Group Impression", "Cat Fall", "Forager", "Acrobatic Performer"],
    },
    preferredSkills: ["arcana", "deception", "diplomacy", "intimidation", "society", "religion", "stealth"],
  },
];

function usage() {
  return `Usage: npm run smoke:foundry -- -- [options]

Options:
  --case <id>        Run one case. Can be passed more than once.
  --list            List available smoke case ids.
  --out <path>      Artifact directory. Defaults to ${defaultArtifactRoot}/<timestamp>.
  --headed          Run with a visible browser.
  --keep-actors     Do not delete disposable actors after the run.
  --help            Show this help text.

Environment:
  FOUNDRY_URL              Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER             Foundry user name or label. Required unless already logged in.
  FOUNDRY_PASSWORD         Foundry user password. Optional.
  FOUNDRY_CHROME_PATH      Chrome/Edge executable path. Defaults to an installed Windows Chrome/Edge.
  FOUNDRY_SMOKE_CASES      Comma-separated case ids.
  FOUNDRY_SMOKE_HEADLESS   true/false. Defaults to true.
  FOUNDRY_SMOKE_KEEP_ACTORS true/false. Defaults to false.
  FOUNDRY_SMOKE_ARTIFACT_DIR Artifact directory override.
`;
}

function parseArgs(argv) {
  const options = {
    caseIds: [],
    headed: false,
    help: false,
    keepActors: envFlag("FOUNDRY_SMOKE_KEEP_ACTORS", false),
    list: false,
    outDir: process.env.FOUNDRY_SMOKE_ARTIFACT_DIR ?? "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--headed") {
      options.headed = true;
      continue;
    }

    if (arg === "--keep-actors") {
      options.keepActors = true;
      continue;
    }

    if (arg === "--case" || arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }

      if (arg === "--case") {
        options.caseIds.push(value);
      } else {
        options.outDir = value;
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const envCaseIds = (process.env.FOUNDRY_SMOKE_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  options.caseIds.push(...envCaseIds);

  return options;
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/u, "Z");
}

function resolveOutDir(value) {
  return path.resolve(repoRoot, value || path.join(defaultArtifactRoot, normalizeTimestamp()));
}

function resolveChromePath() {
  const configured = process.env.FOUNDRY_CHROME_PATH;
  if (configured) {
    return configured;
  }

  return defaultChromePaths.find((entry) => existsSync(entry)) ?? "";
}

function selectedCases(caseIds) {
  const ids = Array.from(new Set(caseIds));
  if (ids.length === 0) {
    return smokeCases;
  }

  const byId = new Map(smokeCases.map((entry) => [entry.id, entry]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown smoke case id(s): ${missing.join(", ")}`);
  }

  return ids.map((id) => byId.get(id));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.list) {
    for (const entry of smokeCases) {
      console.log(`${entry.id} - ${entry.label}`);
    }
    return;
  }

  const chromePath = resolveChromePath();
  if (!chromePath) {
    throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH to a browser executable.");
  }

  const cases = selectedCases(options.caseIds);
  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const headless = options.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true);
  const outDir = resolveOutDir(options.outDir);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless,
  });
  const context = await browser.newContext({
    viewport: { height: 1000, width: 1440 },
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("WFSMOKE") || /error|warn/i.test(text)) {
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });

  try {
    await login(page, {
      foundryUrl,
      password: process.env.FOUNDRY_PASSWORD ?? "",
      user: process.env.FOUNDRY_USER ?? "",
    });
    await page.addScriptTag({ path: browserSuitePath });

    const result = await page.evaluate(
      (payload) => globalThis.__runWayfinderSmokeSuite(payload),
      {
        cases,
        fixturePrefix,
        keepActors: options.keepActors,
        moduleId: MODULE_ID,
      },
    );

    await writeArtifacts(outDir, result);
    printSummary(result, outDir);

    if (result.summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeBrowser(context, browser);
  }
}

async function login(page, { foundryUrl, password, user }) {
  await page.goto(`${foundryUrl.replace(/\/$/u, "")}/join`, { waitUntil: "networkidle" });
  if (page.url().includes("/join")) {
    if (!user) {
      throw new Error("FOUNDRY_USER is required when the browser is not already logged in.");
    }

    await page.locator('select[name="userid"]').selectOption({ label: user });
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[name="join"]').click();
  }

  await page.waitForURL(/\/game/u, { timeout: 30000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
}

async function writeArtifacts(outDir, result) {
  await writeFile(path.join(outDir, "foundry-smoke-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(outDir, "foundry-smoke-summary.md"), buildMarkdownSummary(result));
}

function buildMarkdownSummary(result) {
  const rows = result.cases.map((entry) =>
    [
      entry.id,
      entry.status,
      entry.actor?.levelAfterApply ?? "",
      entry.evidence?.preStepIds?.length ?? 0,
      entry.evidence?.rerunStepIds?.length ?? 0,
      entry.failures.join("<br>") || entry.classifications.join("<br>") || "ok",
    ].join(" | "),
  );

  return `# Foundry Smoke Results

- Started: ${result.startedAt}
- Finished: ${result.finishedAt}
- World: ${result.world}
- User: ${result.user}
- PF2E: ${result.pf2eVersion}
- Wayfinder active: ${result.moduleActive}
- Summary: ${result.summary.passed} passed, ${result.summary.classified} classified, ${result.summary.failed} failed

| Case | Status | Level | Planned steps | Rerun steps | Notes |
| --- | --- | ---: | ---: | ---: | --- |
${rows.map((row) => `| ${row} |`).join("\n")}
`;
}

function printSummary(result, outDir) {
  console.log(`Foundry smoke artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of result.cases) {
    const notes = entry.failures.length > 0 ? `: ${entry.failures.join("; ")}` : "";
    console.log(`${entry.status.toUpperCase()} ${entry.id}${notes}`);
  }
}

async function closeBrowser(context, browser) {
  await Promise.race([
    (async () => {
      await context.close();
      await browser.close();
    })(),
    new Promise((resolve) => {
      setTimeout(resolve, 5000);
    }),
  ]);
}

function errorToString(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

main().catch((error) => {
  console.error(errorToString(error));
  process.exitCode = 1;
});
