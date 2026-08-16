#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { applySafetySmokeCases, gradualBoostsSmokeCases, smokeCases } from "./class-cases.mjs";
import { ancestryParagonSection, campaignFeatSmokeCases } from "./campaign-feat-cases.mjs";
import { freeArchetypeSmokeCases } from "./free-archetype-cases.mjs";
import { assertIncrementalSmokeCasesSupported, qualifySmokeResult } from "./evidence-contract.mjs";
import {
  closeFoundryBrowser,
  loginToFoundryWorld,
  resolveFoundryChromePath,
} from "./browser-session.mjs";
import { validateSmokeSafety } from "./safety.mjs";

const MODULE_ID = "wayfinder-pf2e";
const fixturePrefix = "WF Smoke Harness";
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");
const defaultArtifactRoot = ".wayfinder-smoke";
const allSmokeCases = [
  ...smokeCases,
  ...freeArchetypeSmokeCases,
  ...campaignFeatSmokeCases,
  ...gradualBoostsSmokeCases,
  ...applySafetySmokeCases,
];

function usage() {
  return `Usage: npm run smoke:foundry -- -- [options]

Options:
  --case <id>        Run one case. Can be passed more than once.
  --incremental-case <id>
                     Also run an existing-character incremental rerun for this case.
  --list            List available smoke case ids.
  --out <path>      Artifact directory. Defaults to ${defaultArtifactRoot}/<timestamp>.
  --headed          Run with a visible browser.
  --keep-actors     Do not delete disposable actors after the run.
  --free-archetype <unchanged|on|off>
                     Temporarily set PF2E's Free Archetype variant for this invocation and restore it afterward.
  --campaign-feat-sections <unchanged|ancestry-paragon|off>
                     Temporarily set PF2E's campaign feat sections for this invocation and restore them afterward.
  --gradual-boosts <unchanged|on|off>
                     Temporarily set PF2E's Gradual Ability Boosts variant and restore it afterward.
  --help            Show this help text.

Environment:
  FOUNDRY_URL              Foundry URL. Defaults to http://localhost:30000.
  FOUNDRY_USER             Foundry user name or label. Required unless already logged in.
  FOUNDRY_PASSWORD         Foundry user password. Optional.
  FOUNDRY_CHROME_PATH      Chrome/Edge executable path. Defaults to an installed Windows Chrome/Edge.
  FOUNDRY_SMOKE_CASES      Comma-separated case ids.
  FOUNDRY_SMOKE_INCREMENTAL_CASES Comma-separated case ids for existing-character reruns.
  FOUNDRY_SMOKE_HEADLESS   true/false. Defaults to true.
  FOUNDRY_SMOKE_KEEP_ACTORS true/false. Defaults to false.
  FOUNDRY_SMOKE_FREE_ARCHETYPE unchanged/on/off. Defaults to unchanged.
  FOUNDRY_SMOKE_CAMPAIGN_FEAT_SECTIONS unchanged/ancestry-paragon/off. Defaults to unchanged.
  FOUNDRY_SMOKE_GRADUAL_BOOSTS unchanged/on/off. Defaults to unchanged.
  FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE true/false. Required for actor cleanup/deletion.
  FOUNDRY_SMOKE_WORLD_ID   Expected Foundry world id. Required for actor cleanup/deletion.
  FOUNDRY_SMOKE_ARTIFACT_DIR Artifact directory override.
`;
}

function parseArgs(argv) {
  const options = {
    caseIds: [],
    incrementalCaseIds: [],
    headed: false,
    help: false,
    allowDestructive: envFlag("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE", false),
    keepActors: envFlag("FOUNDRY_SMOKE_KEEP_ACTORS", false),
    list: false,
    outDir: process.env.FOUNDRY_SMOKE_ARTIFACT_DIR ?? "",
    expectedWorldId: process.env.FOUNDRY_SMOKE_WORLD_ID ?? "",
    freeArchetypeMode: normalizeVariantMode(
      process.env.FOUNDRY_SMOKE_FREE_ARCHETYPE ?? "unchanged",
      "Free Archetype",
    ),
    campaignFeatSectionsMode: normalizeCampaignFeatSectionsMode(
      process.env.FOUNDRY_SMOKE_CAMPAIGN_FEAT_SECTIONS ?? "unchanged",
    ),
    gradualBoostsMode: normalizeVariantMode(
      process.env.FOUNDRY_SMOKE_GRADUAL_BOOSTS ?? "unchanged",
      "Gradual Ability Boosts",
    ),
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

    if (
      arg === "--case" ||
      arg === "--incremental-case" ||
      arg === "--out" ||
      arg === "--free-archetype" ||
      arg === "--campaign-feat-sections" ||
      arg === "--gradual-boosts"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }

      if (arg === "--case") {
        options.caseIds.push(value);
      } else if (arg === "--incremental-case") {
        options.incrementalCaseIds.push(value);
      } else if (arg === "--free-archetype") {
        options.freeArchetypeMode = normalizeVariantMode(value, "Free Archetype");
      } else if (arg === "--campaign-feat-sections") {
        options.campaignFeatSectionsMode = normalizeCampaignFeatSectionsMode(value);
      } else if (arg === "--gradual-boosts") {
        options.gradualBoostsMode = normalizeVariantMode(value, "Gradual Ability Boosts");
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
  const envIncrementalCaseIds = (process.env.FOUNDRY_SMOKE_INCREMENTAL_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  options.incrementalCaseIds.push(...envIncrementalCaseIds);

  return options;
}

function normalizeVariantMode(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["unchanged", "on", "off"].includes(normalized)) {
    return normalized;
  }

  throw new Error(`Invalid ${label} mode: ${value}. Expected unchanged, on, or off.`);
}

function normalizeCampaignFeatSectionsMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["unchanged", "ancestry-paragon", "off"].includes(normalized)) {
    return normalized;
  }

  throw new Error(
    `Invalid Campaign Feat Sections mode: ${value}. Expected unchanged, ancestry-paragon, or off.`,
  );
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

function selectedCases(caseIds, { defaultAll = true } = {}) {
  const ids = Array.from(new Set(caseIds));
  if (ids.length === 0) {
    return defaultAll ? smokeCases : [];
  }

  const byId = new Map(allSmokeCases.map((entry) => [entry.id, entry]));
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
    for (const entry of allSmokeCases) {
      console.log(`${entry.id} - ${entry.label}`);
    }
    return;
  }

  const chromePath = resolveFoundryChromePath();
  if (!chromePath) {
    throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH to a browser executable.");
  }

  const cases = selectedCases(options.caseIds);
  const incrementalCases = selectedCases(options.incrementalCaseIds, { defaultAll: false });
  assertIncrementalSmokeCasesSupported(incrementalCases);
  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const headless = options.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true);
  const safety = validateSmokeSafety({
    allowDestructive: options.allowDestructive,
    campaignFeatSectionsMode: options.campaignFeatSectionsMode,
    expectedWorldId: options.expectedWorldId,
    freeArchetypeMode: options.freeArchetypeMode,
    gradualBoostsMode: options.gradualBoostsMode,
    keepActors: options.keepActors,
  });
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
    await loginToFoundryWorld(page, {
      foundryUrl,
      password: process.env.FOUNDRY_PASSWORD ?? "",
      user: process.env.FOUNDRY_USER ?? "",
    });
    await page.addScriptTag({ path: browserSuitePath });

    const variantStates = {
      freeArchetypeVariant: await readVariantState(page, {
        expectedWorldId: safety.expectedWorldId,
        mode: options.freeArchetypeMode,
        settingKey: "freeArchetypeVariant",
        preparedKey: "fa",
        label: "Free Archetype",
      }),
      gradualBoostsVariant: await readVariantState(page, {
        expectedWorldId: safety.expectedWorldId,
        mode: options.gradualBoostsMode,
        settingKey: "gradualBoostsVariant",
        preparedKey: "gab",
        label: "Gradual Ability Boosts",
      }),
    };
    const campaignFeatSections = await readCampaignFeatSectionsState(page, {
      expectedWorldId: safety.expectedWorldId,
      mode: options.campaignFeatSectionsMode,
    });
    let result;
    let restorationError = null;
    try {
      for (const state of Object.values(variantStates)) {
        state.effective = await configureVariant(page, state);
      }
      campaignFeatSections.effective = await configureCampaignFeatSections(page, campaignFeatSections);
      result = await page.evaluate(
        (payload) => globalThis.__runWayfinderSmokeSuite(payload),
        {
          cases,
          allowDestructive: safety.allowDestructive,
          expectedWorldId: safety.expectedWorldId,
          fixturePrefix,
          incrementalCases,
          keepActors: options.keepActors,
          moduleId: MODULE_ID,
        },
      );
      result = qualifySmokeResult(result, [
        ...cases,
        ...incrementalCases.map((smokeCase) => ({
          ...smokeCase,
          id: `${smokeCase.id}-incremental-existing`,
        })),
      ]);
    } finally {
      try {
        campaignFeatSections.restored = await restoreCampaignFeatSections(page, campaignFeatSections);
      } catch (error) {
        restorationError = error;
      }
      try {
        await restoreVariants(page, variantStates);
      } catch (error) {
        restorationError ??= error;
      }
    }
    if (restorationError) throw restorationError;
    Object.assign(result, variantStates, { campaignFeatSections });

    await writeArtifacts(outDir, result);
    printSummary(result, outDir);

    if (!result.qualification.passed) {
      process.exitCode = 1;
    }
  } finally {
    await closeFoundryBrowser(context, browser);
  }
}

async function readVariantState(page, { expectedWorldId, mode, settingKey, preparedKey, label }) {
  return page.evaluate(
    ({ expectedWorldId, label, mode, preparedKey, settingKey }) => {
      const foundryGame = globalThis.game;
      const original = Boolean(foundryGame.settings.get("pf2e", settingKey));
      if (mode === "unchanged") {
        return {
          changed: false,
          effective: original,
          mode,
          original,
          requested: null,
          restored: null,
        };
      }

      if (!foundryGame.user?.isGM) {
        throw new Error(`${label} smoke runs require a GM user.`);
      }
      if (String(foundryGame.world?.id ?? "").trim() !== String(expectedWorldId ?? "").trim()) {
        throw new Error(
          `${label} smoke expected world ${expectedWorldId}, but connected to ${foundryGame.world?.id}.`,
        );
      }

      const requested = mode === "on";
      return {
        changed: original !== requested,
        effective: null,
        mode,
        original,
        label,
        preparedKey,
        requested,
        restored: null,
        settingKey,
      };
    },
    { expectedWorldId, label, mode, preparedKey, settingKey },
  );
}

async function readCampaignFeatSectionsState(page, { expectedWorldId, mode }) {
  return page.evaluate(
    ({ ancestryParagonSection, expectedWorldId, mode }) => {
      const foundryGame = globalThis.game;
      const stored = foundryGame.settings.get("pf2e", "campaignFeatSections");
      const original = Array.isArray(stored) ? JSON.parse(JSON.stringify(stored)) : [];
      if (mode === "unchanged") {
        return {
          changed: false,
          effective: original,
          mode,
          original,
          requested: null,
          restored: null,
        };
      }

      if (!foundryGame.user?.isGM) {
        throw new Error("Campaign Feat Sections smoke runs require a GM user.");
      }
      if (String(foundryGame.world?.id ?? "").trim() !== String(expectedWorldId ?? "").trim()) {
        throw new Error(
          `Campaign Feat Sections smoke expected world ${expectedWorldId}, but connected to ${foundryGame.world?.id}.`,
        );
      }

      const requested = mode === "ancestry-paragon" ? [ancestryParagonSection] : [];
      return {
        changed: JSON.stringify(original) !== JSON.stringify(requested),
        effective: null,
        mode,
        original,
        requested,
        restored: null,
      };
    },
    { ancestryParagonSection, expectedWorldId, mode },
  );
}

async function configureCampaignFeatSections(page, state) {
  if (state.mode === "unchanged") {
    return state.original;
  }

  return page.evaluate(async ({ requested }) => {
    const foundryGame = globalThis.game;
    if (JSON.stringify(foundryGame.settings.get("pf2e", "campaignFeatSections")) !== JSON.stringify(requested)) {
      await foundryGame.settings.set("pf2e", "campaignFeatSections", requested);
    }
    const stored = foundryGame.settings.get("pf2e", "campaignFeatSections");
    const prepared = foundryGame.pf2e?.settings?.campaign?.feats?.sections;
    if (JSON.stringify(stored) !== JSON.stringify(requested) || JSON.stringify(prepared) !== JSON.stringify(requested)) {
      throw new Error(
        `PF2E Campaign Feat Sections did not reach the requested value; stored=${JSON.stringify(stored)}, prepared=${JSON.stringify(prepared)}.`,
      );
    }
    return JSON.parse(JSON.stringify(stored));
  }, state);
}

async function restoreCampaignFeatSections(page, state) {
  if (state.mode === "unchanged") {
    return state.original;
  }

  return page.evaluate(async ({ original }) => {
    const foundryGame = globalThis.game;
    if (JSON.stringify(foundryGame.settings.get("pf2e", "campaignFeatSections")) !== JSON.stringify(original)) {
      await foundryGame.settings.set("pf2e", "campaignFeatSections", original);
    }
    const stored = foundryGame.settings.get("pf2e", "campaignFeatSections");
    const prepared = foundryGame.pf2e?.settings?.campaign?.feats?.sections;
    if (JSON.stringify(stored) !== JSON.stringify(original) || JSON.stringify(prepared) !== JSON.stringify(original)) {
      throw new Error(
        `PF2E Campaign Feat Sections restoration failed; stored=${JSON.stringify(stored)}, prepared=${JSON.stringify(prepared)}.`,
      );
    }
    return JSON.parse(JSON.stringify(stored));
  }, state);
}

async function configureVariant(page, state) {
  if (state.mode === "unchanged") {
    return state.original;
  }

  return page.evaluate(async ({ label, preparedKey, requested, settingKey }) => {
    const foundryGame = globalThis.game;
    if (Boolean(foundryGame.settings.get("pf2e", settingKey)) !== requested) {
      await foundryGame.settings.set("pf2e", settingKey, requested);
    }
    const effective = Boolean(foundryGame.settings.get("pf2e", settingKey));
    const preparedEffective = Boolean(foundryGame.pf2e?.settings?.variants?.[preparedKey]);
    if (effective !== requested || preparedEffective !== requested) {
      throw new Error(
        `PF2E ${label} setting did not reach ${requested}; stored=${effective}, prepared=${preparedEffective}.`,
      );
    }
    return effective;
  }, state);
}

async function restoreVariant(page, state) {
  if (state.mode === "unchanged") {
    return state.original;
  }

  return page.evaluate(async ({ label, original, preparedKey, settingKey }) => {
    const foundryGame = globalThis.game;
    if (Boolean(foundryGame.settings.get("pf2e", settingKey)) !== original) {
      await foundryGame.settings.set("pf2e", settingKey, original);
    }
    const restored = Boolean(foundryGame.settings.get("pf2e", settingKey));
    const preparedRestored = Boolean(foundryGame.pf2e?.settings?.variants?.[preparedKey]);
    if (restored !== original || preparedRestored !== original) {
      throw new Error(
        `PF2E ${label} setting restoration failed; stored=${restored}, prepared=${preparedRestored}.`,
      );
    }
    return restored;
  }, state);
}

async function restoreVariants(page, variantStates) {
  let restoreError = null;
  for (const state of Object.values(variantStates).reverse()) {
    try {
      state.restored = await restoreVariant(page, state);
    } catch (error) {
      restoreError ??= error;
    }
  }
  if (restoreError) throw restoreError;
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
      plannedStepCount(entry),
      rerunStepCount(entry),
      entry.failures.join("<br>") || entry.classifications.join("<br>") || "ok",
    ].join(" | "),
  );

  return `# Foundry Smoke Results

- Started: ${result.startedAt}
- Finished: ${result.finishedAt}
- World: ${result.world}
- User: ${result.user.name} (role ${result.user.role}, GM ${result.user.isGM})
- Foundry: ${result.foundryVersion ?? "unknown"}
- PF2E: ${result.pf2eVersion}
- Wayfinder: ${result.moduleId} ${result.moduleVersion ?? "unknown"} (active: ${result.moduleActive})
- Free Archetype: mode ${result.freeArchetypeVariant?.mode ?? "unchanged"}, effective ${result.freeArchetypeVariant?.effective ?? "unknown"}, restored ${result.freeArchetypeVariant?.restored ?? "unknown"}
- Campaign Feat Sections: mode ${result.campaignFeatSections?.mode ?? "unchanged"}, effective ${JSON.stringify(result.campaignFeatSections?.effective ?? "unknown")}, restored ${JSON.stringify(result.campaignFeatSections?.restored ?? "unknown")}
- Gradual Ability Boosts: mode ${result.gradualBoostsVariant?.mode ?? "unchanged"}, effective ${result.gradualBoostsVariant?.effective ?? "unknown"}, restored ${result.gradualBoostsVariant?.restored ?? "unknown"}
- Summary: ${result.summary.passed} passed, ${result.summary.classified} classified, ${result.summary.failed} failed

| Case | Status | Level | Planned steps | Rerun steps | Notes |
| --- | --- | ---: | ---: | ---: | --- |
${rows.map((row) => `| ${row} |`).join("\n")}
`;
}

function plannedStepCount(entry) {
  if (Array.isArray(entry.evidence?.preStepIds)) {
    return entry.evidence.preStepIds.length;
  }

  return (
    (Array.isArray(entry.evidence?.initialStepIds) ? entry.evidence.initialStepIds.length : 0) +
    (Array.isArray(entry.evidence?.incrementalStepIds) ? entry.evidence.incrementalStepIds.length : 0)
  );
}

function rerunStepCount(entry) {
  return Array.isArray(entry.evidence?.rerunStepIds) ? entry.evidence.rerunStepIds.length : 0;
}

function printSummary(result, outDir) {
  console.log(`Foundry smoke artifacts: ${path.relative(repoRoot, outDir)}`);
  for (const entry of result.cases) {
    const notes = entry.failures.length > 0 ? `: ${entry.failures.join("; ")}` : "";
    console.log(`${entry.status.toUpperCase()} ${entry.id}${notes}`);
  }
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
