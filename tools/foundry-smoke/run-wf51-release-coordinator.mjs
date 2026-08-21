#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWf51AggregateRecords } from "./wf51-release-overlay-aggregate.mjs";
import { writeWf51ReleaseOverlayArtifacts } from "./wf51-release-overlay-artifacts.mjs";
import { applySafetySmokeCases, gradualBoostsSmokeCases } from "./class-cases.mjs";
import { campaignFeatSmokeCases } from "./campaign-feat-cases.mjs";
import { freeArchetypeSmokeCases } from "./free-archetype-cases.mjs";
import {
  buildFreshMatrixResult,
  collectWf51ActorIds,
  expectedWf51MatrixExecutionIds,
  qualifyFreshWf51Child,
  qualifyFreshWf51Matrix,
  validateWf51CoordinatorDefinitions,
  WF51_CORE_BASELINE_CASE_IDS,
  WF51_INCREMENTAL_CASE_IDS,
} from "./wf51-release-coordinator-contract.mjs";
import { qualifyWf51ReleaseOverlay } from "./wf51-release-overlay-evidence.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) return console.log(usage());
  const definitionFailures = validateWf51CoordinatorDefinitions();
  if (definitionFailures.length > 0) throw new Error(definitionFailures.join(" "));

  const runId = randomUUID();
  const evidenceId = randomUUID();
  const candidateSha = await captureCleanCandidate();
  const root = cli.outDir
    ? path.resolve(cli.outDir)
    : path.join(repoRoot, ".wayfinder-smoke", `wf51-release-coordinator-${evidenceId}`);
  await mkdir(path.dirname(root), { recursive: true });
  await mkdir(root, { recursive: false });
  const statePath = path.join(root, "wf51-release-coordinator-state.json");
  const state = {
    schemaVersion: 1,
    evidenceId,
    runId,
    candidateSha,
    startedAt: new Date().toISOString(),
    status: "running",
    children: [],
    error: null,
  };
  await persistState(statePath, state);

  try {
    const matrixChildren = [];
    for (const spec of matrixChildSpecs(root, cli.headed)) {
      const child = await runChild(spec, candidateSha, state, statePath);
      matrixChildren.push(child);
      assertChild(child, qualifyMatrixChild(child));
    }
    const matrixFailures = qualifyFreshWf51Matrix(matrixChildren);
    if (matrixFailures.length > 0) throw new Error(matrixFailures.join(" "));

    const acquisition = await runChild(
      childSpec("acquisition", "run-acquisition-tracer.mjs", root, "acquisition-tracer-results.json", cli.headed),
      candidateSha,
      state,
      statePath,
    );
    assertChild(acquisition, qualifyFreshWf51Child("acquisition", acquisition.result));

    const wave3 = await runChild(
      childSpec("wave3", "run-wave3-equipment-smoke.mjs", root, "wave3-equipment-results.json", cli.headed),
      candidateSha,
      state,
      statePath,
    );
    assertChild(wave3, qualifyFreshWf51Child("wave3", wave3.result));

    const wave4 = await runChild(
      childSpec("wave4", "run-wave4-equipment-smoke.mjs", root, "wave4-equipment-results.json", cli.headed),
      candidateSha,
      state,
      statePath,
    );
    assertChild(wave4, qualifyFreshWf51Child("wave4", wave4.result));

    const experience = await runChild(
      childSpec("experience", "run-wf43-experience-smoke.mjs", root, "wf43-experience-results.json", cli.headed),
      candidateSha,
      state,
      statePath,
    );
    assertChild(experience, qualifyFreshWf51Child("experience", experience.result));

    const priorChildren = [...matrixChildren, acquisition, wave3, wave4, experience];
    const coordinatorManifestPath = path.join(root, "wf51-focused-coordinator-manifest.json");
    const coordinatorManifest = {
      schemaVersion: 1,
      runId,
      candidateSha,
      children: priorChildren.map(childRecord),
      actorIds: collectWf51ActorIds(priorChildren.map((entry) => entry.result)),
    };
    await writeFile(coordinatorManifestPath, `${JSON.stringify(coordinatorManifest, null, 2)}\n`, { flag: "wx" });

    const focused = await runChild(
      childSpec(
        "focused",
        "run-wf51-release-overlay.mjs",
        root,
        "wf51-release-overlay-results.json",
        cli.headed,
        ["--coordinator-manifest", coordinatorManifestPath],
      ),
      candidateSha,
      state,
      statePath,
    );
    assertChild(focused, focused.result?.qualification?.ok === true ? [] : focused.result?.qualification?.failures ?? ["Focused qualification failed."]);
    if (focused.result?.candidate?.gitSha !== candidateSha) {
      throw new Error("Focused child served a different git candidate.");
    }

    const matrixActorIds = collectWf51ActorIds(matrixChildren.map((entry) => entry.result));
    const matrixCleanup = {
      verified: focused.result.coordinator?.priorActorCleanup?.allMissing === true && matrixActorIds.length === 55,
      actorIdsChecked: matrixActorIds.length,
      restorationFailures: [],
    };
    const matrixResult = buildFreshMatrixResult(`matrix-${runId}`, matrixChildren, matrixCleanup);
    const candidate = focused.result.candidate;
    const sources = [
      sourceRecord("acquisition", acquisition, candidate),
      sourceRecord("experience", experience, candidate),
      sourceRecord("matrix", derivedChild("matrix", matrixResult, matrixChildren), candidate),
      sourceRecord("wave3", wave3, candidate),
      sourceRecord("wave4", wave4, candidate),
    ];
    const overlay = buildWf51AggregateRecords({
      candidate,
      focusedCases: {
        evidenceId: focused.result.evidenceId,
        cases: focused.result.cases,
        cleanup: focused.result.cleanup,
      },
      childSources: sources,
    });
    const result = {
      schemaVersion: 1,
      evidenceId,
      runId,
      status: "complete",
      stage: "qualified",
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      runtime: focused.result.runtime,
      users: focused.result.users,
      candidate,
      coordinator: {
        runId,
        candidateSha,
        servedScriptManifestSha256: candidate.servedScriptManifestSha256,
        children: [...priorChildren, focused].map(childRecord),
        matrixExecutionIds: expectedWf51MatrixExecutionIds(),
        matrixUniqueScenarioCount: 54,
      },
      cases: focused.result.cases,
      overlay,
      cleanup: focused.result.cleanup,
      error: null,
    };
    const qualification = qualifyWf51ReleaseOverlay(result);
    const finalDirectory = path.join(root, "final");
    await mkdir(finalDirectory, { recursive: false });
    await writeWf51ReleaseOverlayArtifacts(finalDirectory, result, qualification);
    state.status = qualification.ok ? "complete" : "failed";
    state.finishedAt = result.finishedAt;
    state.qualification = qualification;
    await persistState(statePath, state);
    console.log(`WF-080-51 coordinator artifacts: ${path.relative(repoRoot, root)}`);
    if (!qualification.ok) {
      for (const failure of qualification.failures) console.error(`FAIL ${failure}`);
      process.exitCode = 1;
    }
  } catch (error) {
    state.status = "failed";
    state.finishedAt = new Date().toISOString();
    state.error = serializeError(error);
    await persistState(statePath, state);
    console.error(`WF-080-51 coordinator failed: ${state.error.message}`);
    process.exitCode = 1;
  }
}

function matrixChildSpecs(root, headed) {
  const equipmentArgs = ["--default-reviewed-equipment", "retain-all"];
  const baselineArgs = [...WF51_CORE_BASELINE_CASE_IDS.flatMap((id) => ["--case", id]), ...equipmentArgs];
  const incrementalArgs = [
    "--case",
    "fighter-l1-l5-apply-rerun",
    ...WF51_INCREMENTAL_CASE_IDS.flatMap((id) => ["--incremental-case", id]),
    ...equipmentArgs,
  ];
  return [
    childSpec("matrix-baseline", "run-foundry-smoke.mjs", root, "foundry-smoke-results.json", headed, baselineArgs),
    childSpec("matrix-incremental", "run-foundry-smoke.mjs", root, "foundry-smoke-results.json", headed, incrementalArgs),
    childSpec(
      "matrix-free-archetype",
      "run-foundry-smoke.mjs",
      root,
      "foundry-smoke-results.json",
      headed,
      [...freeArchetypeSmokeCases.flatMap((entry) => ["--case", entry.id]), "--free-archetype", "on", ...equipmentArgs],
    ),
    childSpec(
      "matrix-ancestry-paragon",
      "run-foundry-smoke.mjs",
      root,
      "foundry-smoke-results.json",
      headed,
      ["--case", campaignFeatSmokeCases[0].id, "--campaign-feat-sections", "ancestry-paragon", ...equipmentArgs],
    ),
    childSpec(
      "matrix-gradual-boosts",
      "run-foundry-smoke.mjs",
      root,
      "foundry-smoke-results.json",
      headed,
      ["--case", gradualBoostsSmokeCases[0].id, "--gradual-boosts", "on", ...equipmentArgs],
    ),
    childSpec(
      "matrix-apply-safety",
      "run-foundry-smoke.mjs",
      root,
      "foundry-smoke-results.json",
      headed,
      ["--case", applySafetySmokeCases[0].id, ...equipmentArgs],
    ),
  ];
}

function childSpec(id, scriptName, root, resultName, headed, extraArgs = []) {
  const outDir = path.join(root, id);
  return {
    id,
    scriptPath: path.join(repoRoot, "tools", "foundry-smoke", scriptName),
    args: [...extraArgs, "--out", outDir, ...(headed ? ["--headed"] : [])],
    outDir,
    resultPath: path.join(outDir, resultName),
  };
}

async function runChild(spec, candidateSha, state, statePath) {
  const startedAt = new Date().toISOString();
  const { exitCode, stdout, stderr } = await spawnChild(spec.scriptPath, spec.args);
  await mkdir(spec.outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(spec.outDir, "coordinator-stdout.log"), stdout),
    writeFile(path.join(spec.outDir, "coordinator-stderr.log"), stderr),
  ]);
  let result = null;
  let resultSha256 = null;
  try {
    const bytes = await readFile(spec.resultPath);
    result = JSON.parse(bytes.toString("utf8"));
    resultSha256 = sha256(bytes);
  } catch {
    // The child record remains truthful and unqualified when no parseable result exists.
  }
  const observedSha = await captureCleanCandidate(path.dirname(spec.outDir));
  const child = {
    id: spec.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    candidateSha: observedSha,
    resultPath: spec.resultPath,
    resultSha256,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    result,
  };
  if (observedSha !== candidateSha) child.candidateDrift = true;
  state.children.push(childRecord(child));
  await persistState(statePath, state);
  return child;
}

function qualifyMatrixChild(child) {
  const expectedById = {
    "matrix-baseline": WF51_CORE_BASELINE_CASE_IDS,
    "matrix-incremental": [
      "fighter-l1-l5-apply-rerun",
      ...WF51_INCREMENTAL_CASE_IDS.map((id) => `${id}-incremental-existing`),
    ],
    "matrix-free-archetype": freeArchetypeSmokeCases.map((entry) => entry.id),
    "matrix-ancestry-paragon": campaignFeatSmokeCases.map((entry) => entry.id),
    "matrix-gradual-boosts": gradualBoostsSmokeCases.map((entry) => entry.id),
    "matrix-apply-safety": applySafetySmokeCases.map((entry) => entry.id),
  };
  const failures = [];
  if (JSON.stringify(child.result?.cases?.map((entry) => entry.id) ?? []) !== JSON.stringify(expectedById[child.id])) {
    failures.push(`${child.id}: exact matrix case order drifted.`);
  }
  if (child.result?.qualification?.passed !== true || child.result?.cases?.some((entry) => entry.status !== "pass")) {
    failures.push(`${child.id}: one or more matrix cases did not qualify.`);
  }
  return failures;
}

function assertChild(child, failures) {
  const all = [...failures];
  if (child.exitCode !== 0) all.push(`${child.id}: child exited ${child.exitCode}.`);
  if (!child.result || !/^[0-9a-f]{64}$/u.test(child.resultSha256 ?? "")) all.push(`${child.id}: raw result is missing.`);
  if (child.candidateDrift) all.push(`${child.id}: git candidate drifted during the child run.`);
  if (all.length > 0) throw new Error(all.join(" "));
}

function sourceRecord(route, child, candidate) {
  return {
    route,
    evidenceId: child.result.evidenceId ?? `${route}-${child.resultSha256}`,
    qualified: true,
    resultSha256: child.resultSha256,
    candidateSha: candidate.gitSha,
    servedScriptManifestSha256: candidate.servedScriptManifestSha256,
    result: child.result,
  };
}

function derivedChild(id, result, children) {
  const bytes = JSON.stringify(result);
  return {
    id,
    exitCode: 0,
    result,
    resultSha256: sha256(`${bytes}:${children.map((entry) => entry.resultSha256).join(":")}`),
  };
}

function childRecord(child) {
  return {
    id: child.id,
    startedAt: child.startedAt ?? null,
    finishedAt: child.finishedAt ?? null,
    exitCode: child.exitCode,
    candidateSha: child.candidateSha ?? null,
    resultPath: child.resultPath ?? null,
    resultSha256: child.resultSha256,
    stdoutSha256: child.stdoutSha256 ?? null,
    stderrSha256: child.stderrSha256 ?? null,
    candidateDrift: child.candidateDrift === true,
  };
}

async function spawnChild(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: repoRoot, env: process.env, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

async function captureCleanCandidate(ignoredArtifactRoot = null) {
  const { execFile } = await import("node:child_process");
  const output = (args) =>
    new Promise((resolve, reject) => {
      execFile("git", args, { cwd: repoRoot }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
  const [sha, status] = await Promise.all([output(["rev-parse", "HEAD"]), output(["status", "--porcelain", "--untracked-files=all"])]);
  const ignoredPrefix = ignoredArtifactRoot ? repoRelativePath(ignoredArtifactRoot) : null;
  const dirty = status
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(
      (entry) =>
        !entry.startsWith(".wayfinder-smoke/") &&
        (!ignoredPrefix || (entry !== ignoredPrefix && !entry.startsWith(`${ignoredPrefix}/`))),
    );
  if (dirty.length > 0) throw new Error(`WF-080-51 coordinator requires a clean candidate: ${dirty.join(", ")}`);
  return sha.trim();
}

function repoRelativePath(value) {
  const relative = path.relative(repoRoot, value).replaceAll("\\", "/");
  return relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative) ? relative : null;
}

async function persistState(filePath, state) {
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
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

function usage() {
  return `Usage: node tools/foundry-smoke/run-wf51-release-coordinator.mjs [--out <fresh-path>] [--headed]\n\nRuns the exact 55/54 core matrix and every required equipment child gate fresh on one immutable candidate.`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function serializeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error && typeof error.stack === "string" ? error.stack : null,
  };
}

await main().catch((error) => {
  console.error(`WF-080-51 coordinator failed before artifact setup: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
