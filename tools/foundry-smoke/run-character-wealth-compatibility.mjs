#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { canonicalJson, digest, sha256 } from "../starting-equipment/character-wealth-extractor.mjs";
import {
  assertGeneratedCharacterWealthIntegrity,
  parseGeneratedCharacterWealthModule,
} from "../starting-equipment/generate-character-wealth.mjs";
import { compareCharacterWealthCompatibility } from "./character-wealth-compatibility.mjs";
import { closeFoundryBrowser, loginToFoundryWorld, resolveFoundryChromePath } from "./browser-session.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const generatedPolicyPath = path.join(
  repoRoot,
  "scripts",
  "wayfinder",
  "domain",
  "character-wealth-policy.generated.js",
);
const runtimePolicyUrl = "/modules/wayfinder-pf2e/scripts/wayfinder/domain/character-wealth-policy.generated.js";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const outDir = await reserveCharacterWealthCompatibilityDirectory(options.outDir);
  const evidenceId = randomUUID();
  let expectedPolicy = null;
  let browser = null;
  let context = null;
  let failureStage = "preflight";
  try {
    const expectedWorldId = String(process.env.FOUNDRY_SMOKE_WORLD_ID ?? "").trim();
    if (!expectedWorldId) throw new Error("FOUNDRY_SMOKE_WORLD_ID is required for compatibility evidence.");
    const chromePath = resolveFoundryChromePath();
    if (!chromePath) throw new Error("Could not find Chrome or Edge. Set FOUNDRY_CHROME_PATH.");

    const builtPolicySource = await readFile(generatedPolicyPath, "utf8");
    expectedPolicy = parseGeneratedCharacterWealthModule(builtPolicySource);
    failureStage = "browser-launch";
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: options.headed ? false : envFlag("FOUNDRY_SMOKE_HEADLESS", true),
    });
    context = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
    const page = await context.newPage();
    failureStage = "world-capture";
    await loginToFoundryWorld(page, {
      foundryUrl: process.env.FOUNDRY_URL || "http://localhost:30000",
      password: process.env.FOUNDRY_PASSWORD ?? "",
      user: process.env.FOUNDRY_USER ?? "",
    });
    const captured = await page.evaluate(async ({ expectedWorldId, journalId, runtimePolicyUrl }) => {
      if (globalThis.game?.world?.id !== expectedWorldId) {
        throw new Error("Foundry compatibility probe opened the wrong world.");
      }
      const policyResponse = await fetch(runtimePolicyUrl, { cache: "no-store" });
      if (!policyResponse.ok) {
        throw new Error("Foundry compatibility probe could not load the served Character Wealth policy.");
      }
      const runtimePolicyModule = await import(
        `${runtimePolicyUrl}?wayfinderCharacterWealthProbe=${Date.now()}-${Math.random()}`
      );
      const runtimePolicyExport = runtimePolicyModule.GENERATED_CHARACTER_WEALTH_POLICY;
      if (!runtimePolicyExport || typeof runtimePolicyExport !== "object") {
        throw new Error("Foundry compatibility probe could not import the served Character Wealth policy export.");
      }
      const pack = globalThis.game.packs.get("pf2e.journals");
      const journal = pack ? await pack.getDocument(journalId) : null;
      return {
        journal: journal?.toObject() ?? null,
        runtimePolicyExport: structuredClone(runtimePolicyExport),
        runtimePolicySource: await policyResponse.text(),
        runtime: {
          foundryVersion: globalThis.game.version ?? null,
          pf2eVersion: globalThis.game.system?.version ?? null,
          locale: globalThis.game.i18n?.lang ?? null,
        },
      };
    }, { expectedWorldId, journalId: expectedPolicy.source.journalId, runtimePolicyUrl });

    failureStage = "browser-close";
    await closeFoundryBrowser(context, browser);
    context = null;
    browser = null;

    failureStage = "comparison";
    const inspectedArtifact = inspectCharacterWealthRuntimeArtifact({
      builtSource: builtPolicySource,
      servedSource: captured.runtimePolicySource,
      runtimePolicy: captured.runtimePolicyExport,
    });
    const comparison = compareCharacterWealthCompatibility(captured.journal, inspectedArtifact.runtimePolicy);
    const result = {
      schemaVersion: 1,
      storyId: "WF-080-10",
      evidenceId,
      capturedAt: new Date().toISOString(),
      runtime: captured.runtime,
      policyArtifact: inspectedArtifact.evidence,
      comparison,
      execution: { completed: true, failureStage: null },
      qualification: { passed: comparison.status === "match" && inspectedArtifact.evidence.matched },
    };
    await writeCharacterWealthCompatibilityArtifacts(outDir, result);
    console.log(`Character Wealth compatibility: ${comparison.status}`);
    console.log(`Artifacts: ${path.relative(repoRoot, outDir)}`);
    if (!result.qualification.passed) process.exitCode = 1;
  } catch (error) {
    const result = failedCharacterWealthCompatibilityResult(expectedPolicy, failureStage, evidenceId);
    await writeCharacterWealthCompatibilityArtifacts(outDir, result);
    console.error(error instanceof Error ? error.message : String(error));
    console.log(`Artifacts: ${path.relative(repoRoot, outDir)}`);
    process.exitCode = 1;
  } finally {
    if (context && browser) await closeFoundryBrowser(context, browser);
    else if (browser) await browser.close();
  }
}

export async function reserveCharacterWealthCompatibilityDirectory(requestedOutDir = "") {
  const outDir = path.resolve(repoRoot, requestedOutDir || defaultOutDir());
  await mkdir(path.dirname(outDir), { recursive: true });
  await mkdir(outDir);
  return outDir;
}

export async function writeCharacterWealthCompatibilityArtifacts(outDir, result) {
  if (typeof result?.evidenceId !== "string" || result.evidenceId.length === 0) {
    throw new Error("Character Wealth compatibility evidence requires an evidence id.");
  }
  await writeFile(path.join(outDir, ".character-wealth-publish.lock"), `${result.evidenceId}\n`, { flag: "wx" });
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
  const markdownBytes = markdown(result);
  const completion = {
    schemaVersion: 1,
    evidenceId: result.evidenceId,
    qualified: result.qualification.passed,
    resultSha256: sha256(resultBytes),
    summarySha256: sha256(markdownBytes),
  };
  const files = [
    ["character-wealth-compatibility.json", resultBytes],
    ["character-wealth-compatibility.md", markdownBytes],
    ["character-wealth-compatibility-completion.json", `${JSON.stringify(completion, null, 2)}\n`],
  ];
  const temporaryFiles = [];
  for (const [name, contents] of files) {
    const temporaryPath = path.join(outDir, `.${name}.tmp`);
    await writeFile(temporaryPath, contents, { flag: "wx" });
    temporaryFiles.push([temporaryPath, path.join(outDir, name)]);
  }
  for (const [temporaryPath, finalPath] of temporaryFiles) await rename(temporaryPath, finalPath);
  return completion;
}

export function inspectCharacterWealthRuntimeArtifact({ builtSource, servedSource, runtimePolicy }) {
  const builtPolicy = parseGeneratedCharacterWealthModule(builtSource);
  const servedPolicy = parseGeneratedCharacterWealthModule(servedSource);
  assertGeneratedCharacterWealthIntegrity(runtimePolicy);

  const builtSourceDigest = digest(sha256(builtSource));
  const servedSourceDigest = digest(sha256(servedSource));
  const runtimeExportMatched = canonicalJson(runtimePolicy) === canonicalJson(servedPolicy);
  const sourceMatched = builtSourceDigest === servedSourceDigest;
  return {
    expectedPolicy: builtPolicy,
    runtimePolicy,
    evidence: {
      builtArtifactDigest: builtPolicy.artifactDigest,
      servedArtifactDigest: servedPolicy.artifactDigest,
      runtimeExportArtifactDigest: runtimePolicy.artifactDigest,
      builtSourceDigest,
      servedSourceDigest,
      sourceMatched,
      runtimeExportMatched,
      matched:
        sourceMatched &&
        runtimeExportMatched &&
        builtPolicy.artifactDigest === servedPolicy.artifactDigest &&
        servedPolicy.artifactDigest === runtimePolicy.artifactDigest,
    },
  };
}

function parseArgs(argv) {
  const options = { headed: false, help: false, outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headed") options.headed = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --out.");
      options.outDir = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: node tools/foundry-smoke/run-character-wealth-compatibility.mjs [options]\n\nOptions:\n  --out <path>  Artifact directory.\n  --headed      Show the browser.\n  --help        Show this help.\n\nEnvironment:\n  FOUNDRY_USER             Existing Foundry user.\n  FOUNDRY_PASSWORD         Optional password.\n  FOUNDRY_URL              Defaults to http://localhost:30000.\n  FOUNDRY_SMOKE_WORLD_ID   Exact guarded world id.\n`;
}

function defaultOutDir() {
  return path.join(
    ".wayfinder-smoke",
    `character-wealth-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`,
  );
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function markdown(result) {
  return `# Character Wealth Compatibility\n\n- Captured: ${result.capturedAt}\n- Foundry: ${result.runtime.foundryVersion ?? "unknown"}\n- PF2E: ${result.runtime.pf2eVersion ?? "unknown"}\n- Locale: ${result.runtime.locale ?? "unknown"}\n- Status: ${result.comparison.status}\n- Difference kind: ${result.comparison.differenceKind ?? "none"}\n- Built/served policy matched: ${result.policyArtifact.matched}\n- Served source matched built bytes: ${result.policyArtifact.sourceMatched}\n- Runtime export matched served payload: ${result.policyArtifact.runtimeExportMatched}\n- Expected data digest: ${result.comparison.expectedDataDigest ?? "unavailable"}\n- Installed data digest: ${result.comparison.installedDataDigest ?? "unavailable"}\n- Execution completed: ${result.execution.completed}\n- Failure stage: ${result.execution.failureStage ?? "none"}\n- Qualified: ${result.qualification.passed}\n- Diagnostics: ${result.comparison.diagnostics.join("; ") || "none"}\n`;
}

function failedCharacterWealthCompatibilityResult(expectedPolicy, failureStage, evidenceId) {
  return {
    schemaVersion: 1,
    storyId: "WF-080-10",
    evidenceId,
    capturedAt: new Date().toISOString(),
    runtime: { foundryVersion: null, pf2eVersion: null, locale: null },
    policyArtifact: {
      builtArtifactDigest: expectedPolicy?.artifactDigest ?? null,
      servedArtifactDigest: null,
      runtimeExportArtifactDigest: null,
      builtSourceDigest: null,
      servedSourceDigest: null,
      sourceMatched: false,
      runtimeExportMatched: false,
      matched: false,
    },
    comparison: {
      status: "unavailable",
      differenceKind: null,
      expectedArtifactDigest: expectedPolicy?.artifactDigest ?? null,
      expectedDataDigest: expectedPolicy?.dataDigest ?? null,
      installedSourceDigest: null,
      installedTableDigest: null,
      installedDataDigest: null,
      diagnostics: [`Character Wealth compatibility did not complete during ${failureStage}.`],
    },
    execution: { completed: false, failureStage },
    qualification: { passed: false },
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
