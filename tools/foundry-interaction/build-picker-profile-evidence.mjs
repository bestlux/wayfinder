#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  summarizePickerProfile,
  validatePickerBudgets,
  validatePickerSample,
} from "./profile-results.mjs";

const STORY_ID = "WF-080-00";
const REQUIRED_QUALIFIED_RUNS = 2;
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export function buildPickerProfileEvidence({ baselineBytes, qualifiedBytes }) {
  if (!Array.isArray(qualifiedBytes) || qualifiedBytes.length !== REQUIRED_QUALIFIED_RUNS) {
    throw new Error(`Picker evidence requires exactly ${REQUIRED_QUALIFIED_RUNS} qualified runs.`);
  }

  const baseline = prepareRawRun(baselineBytes, "baseline", "baseline");
  const qualified = qualifiedBytes.map((bytes, index) =>
    prepareRawRun(bytes, `qualified-${index + 1}`, "qualified")
  );
  const failures = baseline.validationFailures.concat(qualified.flatMap((run) => run.validationFailures));
  if (failures.length > 0) {
    throw new Error(failures.join(" "));
  }
  failures.push(...matchingRunFailures(qualified));

  const qualifiedProfileSha256 = profileSha256(qualified[0].result.profile);
  const scenarioSha256 = profileScenarioSha256(qualified[0].result.profile);
  if (profileScenarioSha256(baseline.result.profile) !== scenarioSha256) {
    failures.push("The baseline and qualified runs do not describe the same scenario.");
  }
  if (baseline.result.runtime.worldId !== qualified[0].result.runtime.worldId) {
    failures.push("The baseline and qualified runs were not captured in the same guarded world.");
  }
  if (failures.length > 0) {
    throw new Error(failures.join(" "));
  }

  const profile = qualified[0].result.profile;
  const fixture = qualified[0].result.fixture;
  return {
    schemaVersion: 1,
    storyId: STORY_ID,
    scenario: {
      profileId: profile.id,
      smokeCaseId: profile.smokeCaseId,
      stepId: profile.stepId,
      locale: profile.locale,
      viewport: profile.viewport,
      appWidths: profile.appWidths,
      querySequence: profile.querySequence,
      optionCount: fixture.optionCount,
      resultCount: fixture.expectedResultCount,
      packPolicy: fixture.packPolicy,
    },
    qualification: {
      requiredRuns: REQUIRED_QUALIFIED_RUNS,
      passed: true,
      scenarioSha256,
      qualifiedProfileSha256,
      budgetEnvelope: structuredClone(profile.budgets),
    },
    baseline: compactRun(baseline, "pre-fix-baseline"),
    qualifiedRuns: qualified.map((run, index) => compactRun(run, `qualified-candidate-${index + 1}`)),
  };
}

export function canonicalManifestSha256(entries, fields) {
  if (!Array.isArray(entries)) {
    throw new Error("Manifest entries must be an array.");
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Manifest entries must be objects.");
    for (const field of fields) {
      const value = entry[field];
      if (field === "bytes") {
        if (!Number.isInteger(value) || value < 0) throw new Error("Manifest bytes must be nonnegative integers.");
      } else if (!nonemptyString(value)) {
        throw new Error(`Manifest ${field} must be a nonempty string.`);
      }
    }
  }
  const normalized = entries
    .map((entry) =>
      Object.fromEntries(fields.map((field) => [field, field === "path" ? normalizePath(entry[field]) : entry[field]]))
    )
    .sort((left, right) => compareCodeUnits(String(left.path), String(right.path)));
  const unsafePath = normalized.find(
    (entry) =>
      entry.path === "." ||
      entry.path.startsWith("../") ||
      entry.path.startsWith("/") ||
      /^[A-Za-z]:\//u.test(entry.path)
  )?.path;
  if (unsafePath !== undefined) {
    throw new Error(`Manifest path must be repository-relative: ${JSON.stringify(unsafePath)}.`);
  }
  const duplicatePath = normalized.find((entry, index) => index > 0 && entry.path === normalized[index - 1].path)?.path;
  if (duplicatePath !== undefined) {
    throw new Error(`Manifest contains duplicate normalized path ${JSON.stringify(duplicatePath)}.`);
  }
  return sha256(stableJson(normalized));
}

function prepareRawRun(bytes, label, kind) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let result;
  try {
    result = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${label} picker evidence: ${errorMessage(error)}`, { cause: error });
  }
  const run = {
    label,
    bytes: buffer.length,
    sha256: sha256(buffer),
    result,
  };
  const shapeFailures = rawRunShapeFailures(run, kind);
  if (shapeFailures.length > 0) {
    return { ...run, derived: null, validationFailures: shapeFailures };
  }
  const samples = result.samples.map((sample) => ({
    ...sample,
    failures: validatePickerSample(sample, result.profile),
  }));
  const summary = summarizePickerProfile(result.profile, samples);
  const budgetValidation = validatePickerBudgets(result.profile, summary);
  const derived = { samples, summary, budgetValidation };
  const validationFailures =
    kind === "qualified" ? qualificationFailures({ ...run, derived }) : baselineFailures({ ...run, derived });
  return { ...run, derived, validationFailures };
}

function rawRunShapeFailures(run, kind) {
  const { result, label } = run;
  const failures = [];
  const expectedSchema = kind === "qualified" ? 2 : 1;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [`${label} is not a picker result object.`];
  }
  if (result.schemaVersion !== expectedSchema) {
    failures.push(`${label} must use picker result schema ${expectedSchema}.`);
  }
  if (kind === "qualified" && result.runMode !== "qualification") {
    failures.push(`${label} was not captured in qualification mode.`);
  }
  if (!validTimestamp(result.startedAt) || !validTimestamp(result.finishedAt)) {
    failures.push(`${label} has invalid timestamps.`);
  } else if (Date.parse(result.finishedAt) <= Date.parse(result.startedAt)) {
    failures.push(`${label} did not finish after it started.`);
  }

  const profile = result.profile;
  if (!profile || typeof profile !== "object" || profile.schemaVersion !== 1) {
    failures.push(`${label} must embed picker profile schema 1.`);
    return failures;
  }
  for (const field of ["id", "smokeCaseId", "stepId", "locale"]) {
    if (!nonemptyString(profile[field])) failures.push(`${label} profile lacks ${field}.`);
  }
  if (!positiveFinite(profile.viewport?.width) || !positiveFinite(profile.viewport?.height)) {
    failures.push(`${label} profile has an invalid viewport.`);
  }
  if (
    !Array.isArray(profile.appWidths) ||
    profile.appWidths.length === 0 ||
    profile.appWidths.some((width) => !positiveFinite(width)) ||
    new Set(profile.appWidths).size !== profile.appWidths.length
  ) {
    failures.push(`${label} profile must contain unique positive app widths.`);
  }
  if (!validQuerySequence(profile.querySequence)) {
    failures.push(`${label} profile must contain strictly growing query prefixes.`);
  }
  if (profile.measuredSamplesPerWidth !== 30 || profile.warmupSamplesPerWidth !== 2) {
    failures.push(`${label} profile must require exactly 30 measured samples and 2 warmups per width.`);
  }
  if (!Number.isInteger(profile.expectedOptionCount) || profile.expectedOptionCount < 1) {
    failures.push(`${label} profile lacks a positive frozen option count.`);
  }
  if (
    !Array.isArray(profile.expectedResultValues) ||
    profile.expectedResultValues.length === 0 ||
    profile.expectedResultValues.some((value) => !nonemptyString(value))
  ) {
    failures.push(`${label} profile lacks frozen result identities.`);
  }
  if (kind === "baseline" && profile.budgets != null) {
    failures.push(`${label} must be the pre-budget baseline profile.`);
  }

  if (!Array.isArray(result.samples) || result.samples.length === 0) {
    failures.push(`${label} has no raw samples.`);
  } else {
    const configuredWidths = new Set(Array.isArray(profile.appWidths) ? profile.appWidths : []);
    if (
      result.samples.some(
        (sample) =>
          !sample ||
          typeof sample !== "object" ||
          !["warmup", "measured"].includes(sample.sampleKind) ||
          !configuredWidths.has(sample.requestedAppWidth) ||
          !Number.isInteger(sample.sampleIndex) ||
          sample.sampleIndex < 1
      )
    ) {
      failures.push(`${label} contains a malformed or out-of-scenario sample.`);
    }
    if (Array.isArray(profile.appWidths)) failures.push(...sampleDepthFailures(result, label));
  }

  if (!result.candidate || !nonemptyString(result.candidate.gitSha) || !Array.isArray(result.candidate.dirtyPaths)) {
    failures.push(`${label} has malformed candidate provenance.`);
  }
  if (
    !result.driver ||
    !nonemptyString(result.driver.gitSha) ||
    !Array.isArray(result.driver.dirtyInputPaths) ||
    !Array.isArray(result.driver.files) ||
    result.driver.files.length === 0
  ) {
    failures.push(`${label} has malformed driver provenance.`);
  }
  if (!Array.isArray(result.servedModuleFiles) || result.servedModuleFiles.length === 0) {
    failures.push(`${label} has malformed served-module provenance.`);
  }
  for (const [entries, fields, name] of [
    [result.driver?.files, ["path", "sha256"], "driver"],
    [result.servedModuleFiles, ["path", "bytes", "sha256"], "served-module"],
  ]) {
    if (!Array.isArray(entries)) continue;
    try {
      canonicalManifestSha256(entries, fields);
    } catch (error) {
      failures.push(`${label} ${name} manifest is invalid: ${errorMessage(error)}`);
    }
  }

  for (const field of ["worldId", "foundryVersion", "pf2eVersion", "moduleVersion", "locale"]) {
    if (!nonemptyString(result.runtime?.[field])) failures.push(`${label} lacks runtime ${field}.`);
  }
  if (!result.fixture || typeof result.fixture !== "object") failures.push(`${label} lacks fixture evidence.`);
  if (stableJson(result.browser?.viewport) !== stableJson(profile.viewport)) {
    failures.push(`${label} browser viewport does not match the profile.`);
  }
  if (!nonemptyString(result.browser?.version)) failures.push(`${label} lacks a browser version.`);

  if (kind === "qualified") {
    failures.push(...environmentShapeFailures(result.environment, label));
    if (result.browser?.headless !== true) failures.push(`${label} was not captured in the fixed headless lane.`);
    if (result.candidateRouteFailureCount !== 0) failures.push(`${label} has candidate route failures.`);
  } else if (result.candidateRouteFailureCount !== undefined && result.candidateRouteFailureCount !== 0) {
    failures.push(`${label} has candidate route failures.`);
  }
  return failures;
}

function sampleDepthFailures(result, label) {
  const failures = [];
  for (const width of result.profile.appWidths) {
    for (const [sampleKind, expectedCount] of [
      ["measured", result.profile.measuredSamplesPerWidth],
      ["warmup", result.profile.warmupSamplesPerWidth],
    ]) {
      const samples = result.samples.filter(
        (sample) => sample && sample.sampleKind === sampleKind && sample.requestedAppWidth === width
      );
      if (samples.length !== expectedCount) {
        failures.push(`${label} ${width}px has ${samples.length} ${sampleKind} samples; exactly ${expectedCount} are required.`);
      }
      const indexes = samples.map((sample) => sample.sampleIndex).sort((left, right) => left - right);
      const expectedIndexes = Array.from({ length: expectedCount }, (_, index) => index + 1);
      if (stableJson(indexes) !== stableJson(expectedIndexes)) {
        failures.push(`${label} ${width}px ${sampleKind} sample indexes are incomplete or duplicated.`);
      }
    }
  }
  return failures;
}

function baselineFailures(run) {
  const failures = commonEvidenceFailures(run);
  if (run.derived.summary.failedSampleCount === 0) {
    failures.push(`${run.label} does not demonstrate the expected pre-fix semantic failure.`);
  }
  return failures;
}

function qualificationFailures(run) {
  const { label, derived } = run;
  const failures = commonEvidenceFailures(run);
  if (derived.budgetValidation.configured !== true || derived.budgetValidation.passed !== true) {
    failures.push(`${label} did not pass configured budgets.`);
  }
  if (derived.summary.failedSampleCount !== 0) failures.push(`${label} has semantic sample failures.`);
  if (derived.samples.some((sample) => sample.failures.length > 0)) {
    failures.push(`${label} contains a failed warmup or measured sample.`);
  }
  return failures;
}

function commonEvidenceFailures(run) {
  const { result, label } = run;
  const failures = [];
  if (result.candidate?.gitSha === "unknown") failures.push(`${label} lacks a candidate SHA.`);
  if (result.driver?.gitSha === "unknown") failures.push(`${label} lacks a driver SHA.`);
  if ((result.candidate?.dirtyPaths?.length ?? 0) !== 0) failures.push(`${label} candidate is dirty.`);
  if ((result.driver?.dirtyInputPaths?.length ?? 0) !== 0) failures.push(`${label} driver inputs are dirty.`);
  if (result.fixture?.actorCountAfterCleanup !== result.fixture?.actorCountBefore) {
    failures.push(`${label} did not restore the actor baseline.`);
  }
  if (result.fixture?.actorCountAfterCreate !== result.fixture?.actorCountBefore + 1) {
    failures.push(`${label} did not create exactly one guarded actor.`);
  }
  if (result.fixture?.restrictedSpellRarityAccess !== false) {
    failures.push(`${label} changed restricted spell rarity access.`);
  }
  if (result.fixture?.optionCount !== result.profile?.expectedOptionCount) {
    failures.push(`${label} option count does not match the frozen profile.`);
  }
  if (result.fixture?.expectedResultCount !== result.profile.expectedResultValues.length) {
    failures.push(`${label} result count does not match the frozen profile.`);
  }
  if (stableJson(result.fixture?.expectedResultValues ?? []) !== stableJson(result.profile?.expectedResultValues ?? [])) {
    failures.push(`${label} result identities do not match the frozen profile.`);
  }
  const expectedPackPolicy = { officialSpellPack: "pf2e.spells-srd", ...(result.profile?.expectedPackPolicy ?? {}) };
  if (stableJson(result.fixture?.packPolicy ?? {}) !== stableJson(expectedPackPolicy)) {
    failures.push(`${label} pack policy does not match the frozen profile.`);
  }
  for (const field of ["foundryVersion", "pf2eVersion", "moduleVersion", "locale"]) {
    if (typeof result.runtime?.[field] !== "string" || result.runtime[field].length === 0) {
      failures.push(`${label} lacks runtime ${field}.`);
    }
  }
  for (const [field, expected] of Object.entries(result.profile?.expectedRuntime ?? {})) {
    if (result.runtime?.[field] !== expected) failures.push(`${label} runtime ${field} does not match the profile.`);
  }
  return failures;
}

function matchingRunFailures(runs) {
  const failures = [];
  const first = matchingFingerprint(runs[0]);
  for (const run of runs.slice(1)) {
    if (stableJson(matchingFingerprint(run)) !== stableJson(first)) {
      failures.push(`${run.label} does not match the first qualified candidate, driver, profile, assets, or environment.`);
    }
  }
  if (new Set(runs.map((run) => run.sha256)).size !== runs.length) {
    failures.push("Qualified raw artifacts must be distinct.");
  }
  if (new Set(runs.map((run) => run.result.startedAt)).size !== runs.length) {
    failures.push("Qualified runs must have distinct start times.");
  }
  return failures;
}

function matchingFingerprint(run) {
  const result = run.result;
  return {
    candidateGitSha: result.candidate?.gitSha,
    driverGitSha: result.driver?.gitSha,
    driverManifestSha256: driverManifest(result),
    profileSha256: profileSha256(result.profile),
    scenarioSha256: profileScenarioSha256(result.profile),
    servedManifestSha256: servedManifest(result),
    runtime: {
      worldId: result.runtime?.worldId,
      foundryVersion: result.runtime?.foundryVersion,
      pf2eVersion: result.runtime?.pf2eVersion,
      moduleVersion: result.runtime?.moduleVersion,
      locale: result.runtime?.locale,
    },
    browser: result.browser,
    environment: compactEnvironment(result.environment),
    optionCount: result.fixture?.optionCount,
    resultCount: result.fixture?.expectedResultCount,
    packPolicy: result.fixture?.packPolicy,
  };
}

function compactRun(run, id) {
  const result = run.result;
  const samples = run.derived.samples;
  const summary = run.derived.summary;
  const budgetValidation = run.derived.budgetValidation;
  const measured = samples.filter((sample) => sample.sampleKind === "measured");
  const warmups = samples.filter((sample) => sample.sampleKind === "warmup");
  const durations = measured.map((sample) => sample.durationMs).filter(Number.isFinite);
  const longTasks = measured.flatMap((sample) => sample.longTasks ?? []);
  return {
    id,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    raw: { sha256: run.sha256, bytes: run.bytes },
    candidate: {
      gitSha: result.candidate?.gitSha,
      gitDescribe: result.candidate?.gitDescribe,
      clean: (result.candidate?.dirtyPaths?.length ?? 0) === 0,
      dirtyPathCount: result.candidate?.dirtyPaths?.length ?? 0,
    },
    driver: {
      gitSha: result.driver?.gitSha,
      inputsClean: (result.driver?.dirtyInputPaths?.length ?? 0) === 0,
      dirtyInputCount: result.driver?.dirtyInputPaths?.length ?? 0,
      inputFileCount: result.driver?.files?.length ?? 0,
      manifestSha256: driverManifest(result),
    },
    servedModule: {
      fileCount: result.servedModuleFiles?.length ?? 0,
      totalBytes: (result.servedModuleFiles ?? []).reduce((total, entry) => total + (entry.bytes ?? 0), 0),
      manifestSha256: servedManifest(result),
      routeFailureCountSupported: Number.isInteger(result.candidateRouteFailureCount),
      routeFailureCount: Number.isInteger(result.candidateRouteFailureCount)
        ? result.candidateRouteFailureCount
        : null,
    },
    runtime: {
      foundryVersion: result.runtime?.foundryVersion,
      pf2eVersion: result.runtime?.pf2eVersion,
      moduleVersion: result.runtime?.moduleVersion,
      locale: result.runtime?.locale,
    },
    browser: {
      version: result.browser?.version,
      viewport: result.browser?.viewport,
      headless: result.browser?.headless ?? null,
    },
    environmentCapture: result.environment?.capture === "full" ? "full" : "partial",
    environment: result.environment?.capture === "full" ? compactEnvironment(result.environment) : null,
    fixture: {
      guardedWorldMatched: true,
      createdActorDelta: (result.fixture?.actorCountAfterCreate ?? 0) - (result.fixture?.actorCountBefore ?? 0),
      cleanupRestoredBaseline: result.fixture?.actorCountAfterCleanup === result.fixture?.actorCountBefore,
      optionCount: result.fixture?.optionCount,
      resultCount: result.fixture?.expectedResultCount,
      restrictedRarityAccess: result.fixture?.restrictedSpellRarityAccess,
      packPolicy: result.fixture?.packPolicy,
    },
    samples: {
      warmup: warmups.length,
      measured: measured.length,
      failedAll: samples.filter((sample) => (sample.failures?.length ?? 0) > 0).length,
      failedMeasured: measured.filter((sample) => (sample.failures?.length ?? 0) > 0).length,
    },
    semanticValidation: {
      passed:
        summary.failedSampleCount === 0 && samples.every((sample) => sample.failures.length === 0),
      failureCount: samples.filter((sample) => (sample.failures?.length ?? 0) > 0).length,
    },
    timing: {
      p50Ms: summary.p50Ms,
      p75Ms: summary.p75Ms,
      p95Ms: summary.p95Ms,
      maxMs: maximum(durations),
    },
    longTasks: {
      count: longTasks.length,
      totalMs: sum(longTasks.map((task) => task.duration)),
      maxMs: maximum(longTasks.map((task) => task.duration)),
    },
    counterSupport: {
      planBuild: samples.every((sample) => sample.planBuildCounterSupported === true),
      previewHydration: samples.every((sample) => sample.previewHydrationCounterSupported === true),
      longTask: samples.every((sample) => sample.longTaskSupported === true),
    },
    counterRanges: compactCounterRanges(measured),
    byWidth: result.profile.appWidths.map((width) => compactWidth(summary, measured, width)),
    budgetValidation: {
      configured: budgetValidation.configured === true,
      passed: budgetValidation.passed === true,
      failureCount: budgetValidation.failures.length,
    },
  };
}

function compactCounterRanges(samples) {
  return Object.fromEntries(
    [
      "searchInputReplacementCount",
      "shellReplacementCount",
      "fullRenderCallCount",
      "fullPrepareContextCount",
      "pickerPartRenderCallCount",
      "pickerPartPrepareContextCount",
      "packIndexReadCount",
      "packDocumentReadCount",
      "planBuildCount",
      "previewHydrationCount",
      "focusLossCount",
      "caretMismatchCount",
      "staleFlashCount",
      "staleRenderCommitCount",
      "imageRequestCount",
      "domElementCount",
      "resultDomElementCount",
      "observedResultCount",
    ].map((key) => [key, numberRange(samples.map((sample) => sample[key]))])
  );
}

function compactWidth(profileSummary, measured, requestedAppWidth) {
  const samples = measured.filter((sample) => sample.requestedAppWidth === requestedAppWidth);
  const summary = profileSummary.byWidth.find((entry) => entry.requestedAppWidth === requestedAppWidth) ?? {};
  const longTasks = samples.flatMap((sample) => sample.longTasks ?? []);
  return {
    appWidthPx: requestedAppWidth,
    actualAppWidthPx: numberRange(samples.map((sample) => sample.actualAppWidth)),
    windowContentWidthPx: numberRange(samples.map((sample) => sample.windowContentWidth)),
    sampleCount: samples.length,
    failedSampleCount: samples.filter((sample) => (sample.failures?.length ?? 0) > 0).length,
    p50Ms: summary.p50Ms,
    p75Ms: summary.p75Ms,
    p95Ms: summary.p95Ms,
    maxDomElementCount: maximum(samples.map((sample) => sample.domElementCount)),
    maxResultDomElementCount: maximum(samples.map((sample) => sample.resultDomElementCount)),
    maxResultCount: maximum(samples.map((sample) => sample.observedResultCount)),
    maxImageRequestsPerSample: maximum(samples.map((sample) => sample.imageRequestCount)),
    longTaskCount: longTasks.length,
    maxLongTaskMs: maximum(longTasks.map((task) => task.duration)),
  };
}

function driverManifest(result) {
  return canonicalManifestSha256(result.driver?.files ?? [], ["path", "sha256"]);
}

function servedManifest(result) {
  return canonicalManifestSha256(result.servedModuleFiles ?? [], ["path", "bytes", "sha256"]);
}

function profileSha256(profile) {
  return sha256(stableJson(profile));
}

function profileScenarioSha256(profile) {
  const scenario = { ...profile };
  delete scenario.budgets;
  return sha256(stableJson(scenario));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function numberRange(values) {
  const finite = values.filter(Number.isFinite);
  return { min: minimum(finite), max: maximum(finite) };
}

function minimum(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

function sum(values) {
  return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

function environmentShapeFailures(environment, label) {
  const failures = [];
  if (environment?.capture !== "full") failures.push(`${label} lacks full environment capture.`);
  if (!nonemptyString(environment?.nodeVersion)) failures.push(`${label} lacks a Node version.`);
  if (!nonemptyString(environment?.playwrightCoreVersion)) failures.push(`${label} lacks a Playwright version.`);
  for (const field of ["platform", "release", "arch"]) {
    if (!nonemptyString(environment?.os?.[field])) failures.push(`${label} lacks environment os.${field}.`);
  }
  if (!nonemptyString(environment?.cpu?.model)) failures.push(`${label} lacks a CPU model.`);
  if (!Number.isInteger(environment?.cpu?.logicalProcessorCount) || environment.cpu.logicalProcessorCount < 1) {
    failures.push(`${label} lacks a positive logical processor count.`);
  }
  return failures;
}

function compactEnvironment(environment) {
  if (!environment || typeof environment !== "object") return null;
  return {
    capture: environment.capture,
    nodeVersion: environment.nodeVersion,
    playwrightCoreVersion: environment.playwrightCoreVersion,
    os: {
      platform: environment.os?.platform,
      release: environment.os?.release,
      arch: environment.os?.arch,
    },
    cpu: {
      model: environment.cpu?.model,
      logicalProcessorCount: environment.cpu?.logicalProcessorCount,
    },
  };
}

function validTimestamp(value) {
  return nonemptyString(value) && Number.isFinite(Date.parse(value));
}

function validQuerySequence(sequence) {
  if (!Array.isArray(sequence) || sequence.length < 2 || sequence.some((value) => !nonemptyString(value))) {
    return false;
  }
  return sequence.slice(1).every(
    (value, index) => value.startsWith(sequence[index]) && value.length > sequence[index].length
  );
}

function nonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value) {
  return path.posix.normalize(String(value ?? "").replaceAll("\\", "/")).replace(/^\.\//u, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const options = parsePickerEvidenceArgs(process.argv.slice(2));
  const baselineBytes = await readFile(options.baselinePath);
  const qualifiedBytes = await Promise.all(options.qualifiedPaths.map((candidatePath) => readFile(candidatePath)));
  const evidence = buildPickerProfileEvidence({ baselineBytes, qualifiedBytes });
  const outPath = path.resolve(repoRoot, options.outPath);
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Picker evidence: ${path.relative(repoRoot, outPath)}`);
}

export function parsePickerEvidenceArgs(argv) {
  const options = {
    baselinePath: "",
    qualifiedPaths: [],
    outPath: "docs/coverage/picker-search-wf-080-00.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (!["--baseline", "--qualified", "--out"].includes(arg) || !value || value.startsWith("--")) {
      throw new Error(`Invalid picker evidence argument: ${arg ?? "<missing>"}.`);
    }
    if (arg === "--baseline") options.baselinePath = path.resolve(repoRoot, value);
    if (arg === "--qualified") options.qualifiedPaths.push(path.resolve(repoRoot, value));
    if (arg === "--out") options.outPath = value;
    index += 1;
  }
  if (!options.baselinePath) throw new Error("Picker evidence requires --baseline.");
  if (options.qualifiedPaths.length !== REQUIRED_QUALIFIED_RUNS) {
    throw new Error(`Picker evidence requires exactly ${REQUIRED_QUALIFIED_RUNS} --qualified arguments.`);
  }
  return options;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
