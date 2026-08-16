import { describe, expect, it } from "vitest";
import {
  buildPickerProfileEvidence,
  canonicalManifestSha256,
  parsePickerEvidenceArgs,
} from "../tools/foundry-interaction/build-picker-profile-evidence.mjs";

describe("Foundry picker profile compact evidence", () => {
  it("qualifies two independent matching clean runs without leaking raw identities or paths", () => {
    const first = qualifiedRun("2026-08-15T01:00:00.000Z");
    const second = qualifiedRun("2026-08-15T02:00:00.000Z");
    const evidence = buildPickerProfileEvidence({
      baselineBytes: rawBytes(baselineRun()),
      qualifiedBytes: [rawBytes(first), rawBytes(second)],
    });

    expect(evidence.qualification).toMatchObject({ requiredRuns: 2, passed: true });
    expect(evidence.qualification.budgetEnvelope).toEqual(profileFixture().budgets);
    expect(evidence.qualifiedRuns).toHaveLength(2);
    expect(evidence.qualifiedRuns[0]).toMatchObject({
      candidate: { clean: true },
      driver: { inputsClean: true },
      environmentCapture: "full",
      samples: { warmup: 8, measured: 120, failedAll: 0 },
      semanticValidation: { passed: true, failureCount: 0 },
      budgetValidation: { configured: true, passed: true, failureCount: 0 },
    });
    expect(evidence.baseline.environmentCapture).toBe("partial");
    expect(evidence.baseline.environment).toBeNull();

    const serialized = JSON.stringify(evidence);
    for (const sentinel of [
      "C:/private/candidate",
      "testing-world-secret",
      "actor-secret",
      "app-secret",
      "result-uuid-secret",
      "transition-secret",
      "password-secret",
      "environment-path-secret",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/u);
    expect(serialized).not.toContain("/private/candidate");
  });

  it.each([
    ["one run", (runs: any[]) => runs.slice(0, 1), "exactly 2"],
    [
      "dirty candidate",
      (runs: any[]) => withChange(runs, 1, ["candidate", "dirtyPaths"], ["src/dirty.ts"]),
      "candidate is dirty",
    ],
    [
      "dirty driver",
      (runs: any[]) => withChange(runs, 1, ["driver", "dirtyInputPaths"], ["tools/dirty.mjs"]),
      "driver inputs are dirty",
    ],
    [
      "budget failure",
      (runs: any[]) => mutateMeasuredWidth(runs, 1, 1240, { durationMs: 1000, domElementCount: 999 }),
      "configured budgets",
    ],
    ["29 samples", (runs: any[]) => removeMeasuredSample(runs, 1, 760), "29 measured samples"],
    [
      "semantic failure",
      (runs: any[]) => withChange(runs, 1, ["samples", 2, "fullRenderCallCount"], 1),
      "semantic sample failures",
    ],
    [
      "candidate mismatch",
      (runs: any[]) => withChange(runs, 1, ["candidate", "gitSha"], "other-sha"),
      "does not match",
    ],
    ["runtime mismatch", (runs: any[]) => withChange(runs, 1, ["runtime", "pf2eVersion"], "other"), "does not match"],
    [
      "asset mismatch",
      (runs: any[]) => withChange(runs, 1, ["servedModuleFiles", 0, "sha256"], "other"),
      "does not match",
    ],
    ["world mismatch", (runs: any[]) => withChange(runs, 1, ["runtime", "worldId"], "other-world"), "does not match"],
    ["wrong result schema", (runs: any[]) => withChange(runs, 1, ["schemaVersion"], 1), "result schema 2"],
    ["empty app widths", (runs: any[]) => withChange(runs, 1, ["profile", "appWidths"], []), "positive app widths"],
    [
      "missing measured metric",
      (runs: any[]) => withChange(runs, 1, ["samples", 2, "domElementCount"], undefined),
      "semantic sample failures",
    ],
    [
      "missing zero-work counter",
      (runs: any[]) => withChange(runs, 1, ["samples", 2, "fullRenderCallCount"], undefined),
      "semantic sample failures",
    ],
    [
      "negative zero-work counter",
      (runs: any[]) => withChange(runs, 1, ["samples", 2, "packDocumentReadCount"], -1),
      "semantic sample failures",
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    const runs = [qualifiedRun("2026-08-15T01:00:00.000Z"), qualifiedRun("2026-08-15T02:00:00.000Z")];
    const changed = mutate(runs);

    expect(() =>
      buildPickerProfileEvidence({
        baselineBytes: rawBytes(baselineRun()),
        qualifiedBytes: changed.map(rawBytes),
      })
    ).toThrow(expected);
  });

  it("hashes manifests independently of input order and changes on content", () => {
    const entries = [
      { path: "b.js", bytes: 2, sha256: "bbb" },
      { path: "a.js", bytes: 1, sha256: "aaa" },
    ];
    const first = canonicalManifestSha256(entries, ["path", "bytes", "sha256"]);
    const reordered = canonicalManifestSha256([...entries].reverse(), ["path", "bytes", "sha256"]);
    const changed = canonicalManifestSha256([{ ...entries[0], bytes: 3 }, entries[1]], ["path", "bytes", "sha256"]);

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
    expect(() =>
      canonicalManifestSha256(
        [
          { path: "same\\file.js", bytes: 1, sha256: "one" },
          { path: "same/file.js", bytes: 2, sha256: "two" },
        ],
        ["path", "bytes", "sha256"]
      )
    ).toThrow("duplicate normalized path");
  });

  it("recomputes verdicts instead of trusting serialized summaries", () => {
    const runs = [qualifiedRun("2026-08-15T01:00:00.000Z"), qualifiedRun("2026-08-15T02:00:00.000Z")];
    for (const sample of runs[1].samples.filter((entry: any) => entry.requestedAppWidth === 1240)) {
      sample.durationMs = 1000;
      sample.domElementCount = 999;
      sample.failures = [];
    }
    runs[1].summary = summaryFixture(runs[1].profile.appWidths);
    runs[1].budgetValidation = { configured: true, passed: true, failures: [] };

    expect(() =>
      buildPickerProfileEvidence({
        baselineBytes: rawBytes(baselineRun()),
        qualifiedBytes: runs.map(rawBytes),
      })
    ).toThrow("configured budgets");
  });

  it("rejects an invalid baseline instead of labeling it verified", () => {
    const baseline = baselineRun();
    baseline.fixture.actorCountAfterCleanup += 1;
    expect(() =>
      buildPickerProfileEvidence({
        baselineBytes: rawBytes(baseline),
        qualifiedBytes: [
          rawBytes(qualifiedRun("2026-08-15T01:00:00.000Z")),
          rawBytes(qualifiedRun("2026-08-15T02:00:00.000Z")),
        ],
      })
    ).toThrow("did not restore the actor baseline");

    const falselyCleanBaseline = baselineRun();
    for (const sample of falselyCleanBaseline.samples) {
      sample.planBuildCounterSupported = true;
      sample.previewHydrationCounterSupported = true;
    }
    expect(() =>
      buildPickerProfileEvidence({
        baselineBytes: rawBytes(falselyCleanBaseline),
        qualifiedBytes: [
          rawBytes(qualifiedRun("2026-08-15T01:00:00.000Z")),
          rawBytes(qualifiedRun("2026-08-15T02:00:00.000Z")),
        ],
      })
    ).toThrow("expected pre-fix semantic failure");
  });

  it("requires the CLI to bind one baseline and exactly two qualified artifacts", () => {
    const parsed = parsePickerEvidenceArgs([
      "--baseline",
      "baseline.json",
      "--qualified",
      "first.json",
      "--qualified",
      "second.json",
      "--out",
      "evidence.json",
    ]);
    expect(parsed.baselinePath).toMatch(/baseline\.json$/u);
    expect(parsed.qualifiedPaths).toHaveLength(2);
    expect(parsed.outPath).toBe("evidence.json");
    expect(() => parsePickerEvidenceArgs(["--baseline", "baseline.json", "--qualified", "only.json"])).toThrow(
      "exactly 2"
    );
  });
});

function qualifiedRun(startedAt: string): any {
  const profile = profileFixture();
  const samples = profile.appWidths.flatMap((requestedAppWidth: number) => [
    ...Array.from({ length: 2 }, (_, index) => sampleFixture(requestedAppWidth, "warmup", index + 1)),
    ...Array.from({ length: 30 }, (_, index) => sampleFixture(requestedAppWidth, "measured", index + 1)),
  ]);
  return {
    schemaVersion: 2,
    runMode: "qualification",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    profile,
    candidate: {
      root: "C:/private/candidate",
      requestedRef: "password-secret",
      gitSha: "candidate-sha",
      gitDescribe: "candidate-sha",
      dirtyPaths: [],
    },
    driver: {
      gitSha: "driver-sha",
      dirtyPaths: ["module.json"],
      dirtyInputPaths: [],
      files: [
        { path: "tools/driver.mjs", sha256: "driver-one" },
        { path: "tools/profile.json", sha256: "driver-two" },
      ],
    },
    browser: { version: "151.0", viewport: profile.viewport, headless: true },
    environment: {
      capture: "full",
      nodeVersion: "v24.0.0",
      playwrightCoreVersion: "1.59.1",
      os: { platform: "win32", release: "10.0", arch: "x64" },
      cpu: { model: "Test CPU", logicalProcessorCount: 8 },
      cwd: "C:/environment-path-secret",
    },
    runtime: {
      worldId: "testing-world-secret",
      locale: "en",
      foundryVersion: "14.366",
      pf2eVersion: "8.4.0",
      moduleVersion: "0.7.3",
    },
    fixture: {
      appElementId: "app-secret",
      actorId: "actor-secret",
      optionCount: 401,
      expectedResultCount: 1,
      expectedResultNames: ["Private Result"],
      expectedResultValues: ["result-uuid-secret"],
      restrictedSpellRarityAccess: false,
      packPolicy: { officialSpellPack: "pf2e.spells-srd", ...profile.expectedPackPolicy },
      actorCountBefore: 5,
      actorCountAfterCreate: 6,
      actorCountAfterCleanup: 5,
    },
    servedModuleFiles: [
      { path: "scripts/module.js", bytes: 100, sha256: "asset-one", requests: 2 },
      { path: "styles/module.css", bytes: 50, sha256: "asset-two", requests: 1 },
    ],
    candidateRouteFailureCount: 0,
    samples,
    summary: summaryFixture(profile.appWidths),
    budgetValidation: { configured: true, passed: true, failures: [] },
  };
}

function baselineRun(): any {
  const run = qualifiedRun("2026-08-15T00:00:00.000Z");
  run.schemaVersion = 1;
  run.profile = { ...run.profile, budgets: null };
  run.candidate = { ...run.candidate, gitSha: "baseline-sha", gitDescribe: "baseline-sha" };
  delete run.environment;
  run.browser = { version: "151.0", viewport: run.profile.viewport };
  delete run.budgetValidation;
  for (const sample of run.samples) {
    sample.planBuildCounterSupported = false;
    sample.previewHydrationCounterSupported = false;
    sample.transitions = ["transition-secret"];
  }
  return run;
}

function profileFixture(): any {
  return {
    schemaVersion: 1,
    id: "wizard-level-5-spell-search",
    smokeCaseId: "wizard-l1-l5-apply-rerun",
    stepId: "spell-choice-wizard-spellbook-level-5",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    appWidths: [1240, 1180, 980, 760],
    querySequence: ["f", "fa", "fal", "fals", "false"],
    expectedPackPolicy: {
      additionalSourcePacks: "",
      spellRarityCeiling: "common",
      observedPackIds: ["pf2e.spells-srd"],
    },
    expectedOptionCount: 401,
    expectedResultValues: ["result-uuid-secret"],
    expectedRuntime: { foundryVersion: "14.366", pf2eVersion: "8.4.0" },
    measuredSamplesPerWidth: 30,
    warmupSamplesPerWidth: 2,
    budgets: {
      maxP95MsPerWidth: 75,
      maxDomElementCount: 325,
      maxResultDomElementCount: 12,
      maxImageRequestsPerSample: 0,
      maxLongTaskCountPerWidth: 0,
    },
  };
}

function sampleFixture(requestedAppWidth: number, sampleKind: string, sampleIndex: number): any {
  return {
    requestedAppWidth,
    actualAppWidth: requestedAppWidth,
    windowContentWidth: requestedAppWidth - 2,
    sampleKind,
    sampleIndex,
    durationMs: 50,
    finalInputObserved: true,
    finalValue: "false",
    observedQueries: ["f", "fa", "fal", "fals", "false"],
    expectedResultCount: 1,
    observedResultCount: 1,
    expectedResultValues: ["result-uuid-secret"],
    observedResultValues: ["result-uuid-secret"],
    focused: true,
    selectionStart: 5,
    selectionEnd: 5,
    failures: [],
    longTasks: [],
    longTaskSupported: true,
    planBuildCounterSupported: true,
    previewHydrationCounterSupported: true,
    searchInputReplacementCount: 0,
    shellReplacementCount: 0,
    fullRenderCallCount: 0,
    fullPrepareContextCount: 0,
    pickerPartRenderCallCount: 1,
    pickerPartPrepareContextCount: 1,
    packIndexReadCount: 0,
    packDocumentReadCount: 0,
    planBuildCount: 0,
    previewHydrationCount: 0,
    focusLossCount: 0,
    caretMismatchCount: 0,
    staleFlashCount: 0,
    staleRenderCommitCount: 0,
    imageRequestCount: 0,
    domElementCount: 320,
    resultDomElementCount: 11,
  };
}

function summaryFixture(widths: number[]): any {
  return {
    measuredSampleCount: 120,
    failedSampleCount: 0,
    p50Ms: 50,
    p75Ms: 52,
    p95Ms: 55,
    longTaskCount: 0,
    byWidth: widths.map((requestedAppWidth) => ({
      requestedAppWidth,
      sampleCount: 30,
      failedSampleCount: 0,
      p50Ms: 50,
      p75Ms: 52,
      p95Ms: 55,
      longTaskCount: 0,
      maxDomElementCount: 320,
      maxResultDomElementCount: 11,
      maxResultCount: 1,
      maxImageRequestsPerSample: 0,
    })),
  };
}

function rawBytes(value: any): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function withChange(runs: any[], runIndex: number, path: Array<string | number>, value: unknown): any[] {
  const clone = structuredClone(runs);
  let target = clone[runIndex];
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1) as string] = value;
  return clone;
}

function removeMeasuredSample(runs: any[], runIndex: number, width: number): any[] {
  const clone = structuredClone(runs);
  const index = clone[runIndex].samples.findIndex(
    (sample: any) => sample.sampleKind === "measured" && sample.requestedAppWidth === width
  );
  clone[runIndex].samples.splice(index, 1);
  return clone;
}

function mutateMeasuredWidth(runs: any[], runIndex: number, width: number, changes: Record<string, unknown>): any[] {
  const clone = structuredClone(runs);
  for (const sample of clone[runIndex].samples.filter(
    (entry: any) => entry.sampleKind === "measured" && entry.requestedAppWidth === width
  )) {
    Object.assign(sample, changes);
  }
  return clone;
}
