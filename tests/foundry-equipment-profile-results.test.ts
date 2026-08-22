import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveEvidencePaths } from "../tools/foundry-interaction/build-equipment-profile-evidence.mjs";
import {
  compactEquipmentEvidence,
  qualifyEquipmentEvidenceRuns,
  summarizeEquipmentProfile,
  validateEquipmentBudgets,
  validateEquipmentFixture,
  validateEquipmentProfile,
  validateEquipmentSample,
} from "../tools/foundry-interaction/equipment-profile-results.mjs";
import { buildEquipmentProfileResult } from "../tools/foundry-interaction/run-equipment-profile.mjs";

const profilePath = fileURLToPath(
  new URL("../tools/foundry-interaction/equipment-catalogue-profile.json", import.meta.url)
);
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const browserProfile = readFileSync(
  fileURLToPath(new URL("../tools/foundry-interaction/browser-equipment-profile.js", import.meta.url)),
  "utf8"
);
const runner = readFileSync(
  fileURLToPath(new URL("../tools/foundry-interaction/run-equipment-profile.mjs", import.meta.url)),
  "utf8"
);

describe("equipment catalogue performance profile", () => {
  it("loads the shared smoke policy before the browser suite in both equipment contexts", () => {
    expect(runner.match(/await loadWayfinderBrowserSuite\((?:gmPage|playerPage)\)/gu)).toHaveLength(2);
    expect(runner).not.toContain("await gmPage.addScriptTag({ path: browserSuitePath })");
    expect(runner).not.toContain("await playerPage.addScriptTag({ path: browserSuitePath })");
  });

  it("freezes the inherited release envelope and exact action contracts", () => {
    expect(validateEquipmentProfile(profile)).toEqual([]);
    expect(profile.appWidths).toEqual([1240, 1180, 980, 760]);
    expect(profile.budgets).toEqual({
      maxP95MsPerActionWidth: 75,
      maxDomElementCount: 850,
      maxResultDomElementCount: 434,
      maxMountedResultCount: 36,
      maxResultDomElementsPerMountedRow: 12,
      maxResultChromeDomElementCount: 2,
      maxImageRequestsPerSample: 0,
      maxLongTaskCountPerActionWidth: 0,
    });
    expect(profile.resultWindowProfiles).toEqual([
      { id: "default", appHeight: 820, expectedMountedRows: 12 },
      { id: "expanded", appHeight: 1200, expectedMountedRows: 24 },
      { id: "tall", appHeight: 1500, expectedMountedRows: 36 },
    ]);
    expect(profile.expectedCatalogueCounts).toEqual({ indexed: 5856, levelQualified: 2283, matching: 1, visible: 1 });
    expect(profile.schemaVersion).toBe(2);
  });

  it("rejects weakened sample depth, widths, budgets, and preview caching", () => {
    const changed = structuredClone(profile);
    changed.appWidths = [1240];
    changed.measuredSamplesPerActionWidth = 29;
    changed.budgets.maxP95MsPerActionWidth = 76;
    changed.smokeCaseId = "different-fixture";
    changed.postSettleMs = 0;
    changed.timingSemantics.rapidSearchPrimary = "whole-typing-sequence";
    changed.actions.at(-1).repeatPreviewHydrations = 1;
    changed.actions.find((action: { id: string }) => action.id === "rapid-search").maxPlanBuilds = 999_999;
    expect(validateEquipmentProfile(changed)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("app widths"),
        expect.stringContaining("30 measured"),
        expect.stringContaining("measured"),
        expect.stringContaining("zero unchanged-repeat"),
        expect.stringContaining("counter limits"),
        expect.stringContaining("exact Wizard"),
        expect.stringContaining("350ms"),
        expect.stringContaining("timing semantics"),
      ])
    );
  });

  it("requires guarded distinct roles, exact runtime, policy, actor delta, and final identity", () => {
    expect(validateEquipmentFixture(profile, fixture(), "testing-world")).toEqual([]);
    const changed = fixture();
    changed.users.player.id = changed.users.gm.id;
    changed.runtime.pf2eVersion = "8.4.0";
    changed.actorCountAfterCreate += 1;
    changed.expectedFinalResultValues = ["wrong"];
    expect(validateEquipmentFixture(profile, changed, "testing-world")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("distinct"),
        expect.stringContaining("8.4.1"),
        expect.stringContaining("exactly one"),
        expect.stringContaining("identities"),
      ])
    );
  });

  it("enforces steady-action counters and the split preview hydration oracle", () => {
    expect(validateEquipmentSample(sample("rapid-search"), profile)).toEqual([]);
    const search = sample("rapid-search");
    search.planBuildCount = 1;
    search.fullPrepareContextCount = 1;
    expect(validateEquipmentSample(search, profile)).toEqual(
      expect.arrayContaining([expect.stringContaining("plan builds"), expect.stringContaining("full context")])
    );

    expect(validateEquipmentSample(sample("preview-change"), profile)).toEqual([]);
    const preview = sample("preview-change");
    preview.repeatPreviewHydrationCount = 1;
    expect(validateEquipmentSample(preview, profile)).toContain("Unchanged preview hydrated 1 time(s); expected 0.");
  });

  it("rederives final-input search timing and split preview timing", () => {
    const search = sample("rapid-search");
    expect(validateEquipmentSample(search, profile)).toEqual([]);
    search.durationMs = search.endToEndTypingDurationMs;
    expect(validateEquipmentSample(search, profile)).toContain(
      "Primary duration does not rederive from the exact action interval(s)."
    );
    const earlyBoundary = sample("rapid-search");
    earlyBoundary.typingStartedAt = 149;
    earlyBoundary.endToEndTypingDurationMs = 26;
    expect(validateEquipmentSample(earlyBoundary, profile)).toContain(
      "Rapid-search primary and end-to-end typing timings do not rederive from the final input boundary."
    );

    const preview = sample("preview-change");
    preview.durationMs = preview.combinedPreviewDurationMs;
    preview.repeatPreviewDurationMs += 1;
    expect(validateEquipmentSample(preview, profile)).toEqual(
      expect.arrayContaining([
        "Primary duration does not rederive from the exact action interval(s).",
        "Preview primary and combined diagnostic timings do not rederive from the split intervals.",
      ])
    );
    const noOpRepeat = sample("preview-change");
    noOpRepeat.repeatPreviewRenderScheduled = false;
    noOpRepeat.repeatPreviewDetailReplaced = false;
    expect(validateEquipmentSample(noOpRepeat, profile)).toEqual([]);
    noOpRepeat.repeatPreviewRenderScheduled = true;
    expect(validateEquipmentSample(noOpRepeat, profile)).toContain(
      "Preview primary and combined diagnostic timings do not rederive from the split intervals."
    );
  });

  it("binds browser completion to final dispatch and repeat partial replacement", () => {
    expect(browserProfile).toContain("const dispatchedAt = performance.now()");
    expect(browserProfile).toContain('startActionInterval(sample, "rapid-final-query", dispatchedAt)');
    expect(browserProfile).toContain("detailBeforeRepeat");
    expect(browserProfile).toContain("!== detailBeforeRepeat");
  });

  it("measures catalogue reopen through semantic readiness without fixed post-open frame padding", () => {
    expect(profile.timingSemantics.catalogueOpenPrimary).toBe("open-dispatch-to-semantic-catalogue-ready");
    const reopenSource = browserProfile.slice(
      browserProfile.indexOf("async function reopen("),
      browserProfile.indexOf("async function ensureSprayPelletsCart(")
    );
    expect(reopenSource).toContain("currentApp().setPosition?.({ width })");
    expect(reopenSource).not.toContain("await frames(2)");
  });

  it("reads compact leaf identities and adds the exact selected Spray Pellets preview", () => {
    expect(browserProfile).toContain(
      'result.dataset.sourceUuid ?? result.querySelector(":scope [data-source-uuid]")?.dataset.sourceUuid ?? ""'
    );
    expect(browserProfile).toContain("resultSourceUuid(result) === sourceUuid");
    expect(browserProfile).toContain("visiblePreviewUuid() === SPRAY_PELLETS_SOURCE_UUID");
    expect(browserProfile).toContain('querySelector(`[data-equipment-preview="${css(sourceUuid)}"]`)');
    expect(browserProfile).toContain(
      '`[data-wayfinder-action="add-equipment-item"][data-source-uuid="${css(sourceUuid)}"][data-funding="currency"]`'
    );
    expect(browserProfile).toContain("const add = selectedCurrencyAdd(SPRAY_PELLETS_SOURCE_UUID)");
    expect(browserProfile).toMatch(
      /const add = selectedCurrencyAdd\(SPRAY_PELLETS_SOURCE_UUID\);[\s\S]*?add\.click\(\);/
    );
    expect(browserProfile).toContain(
      'await waitUntil(() => currentRoot().querySelector(".equipment-cart-line"), timeoutMs)'
    );
    expect(browserProfile).not.toContain(
      '.equipment-result [data-wayfinder-action="add-equipment-item"][data-funding="currency"]'
    );
  });

  it("qualifies only Long Tasks overlapping primary action intervals", () => {
    const postSettle = { startTime: 200, duration: 60 };
    const observed = sample("cart-quantity");
    observed.observedLongTasks = [postSettle];
    observed.postSettleLongTasks = [postSettle];
    expect(validateEquipmentSample(observed, profile)).toEqual([]);
    const summary = summarizeEquipmentProfile(profile, [observed]);
    const row = summary.byActionWidth.find(
      (entry: { actionId: string; requestedAppWidth: number }) =>
        entry.actionId === "cart-quantity" && entry.requestedAppWidth === 1240
    );
    expect(row).toMatchObject({ longTaskCount: 0, observedLongTaskCount: 1, postSettleLongTaskCount: 1 });
    observed.postSettleLongTasks = [];
    expect(validateEquipmentSample(observed, profile)).toContain(
      "Post-settle Long Tasks do not rederive from the observation interval."
    );
    observed.postSettleLongTasks = [postSettle];

    const overlapping = { startTime: 120, duration: 50 };
    observed.observedLongTasks = [overlapping, postSettle];
    observed.qualifyingLongTasks = [];
    expect(validateEquipmentSample(observed, profile)).toContain(
      "Qualifying Long Tasks do not rederive from exact action intervals."
    );
  });

  it("rederives every action outcome from raw DOM evidence", () => {
    for (const action of profile.actions) expect(validateEquipmentSample(sample(action.id), profile)).toEqual([]);
    const cold = sample("cold-open");
    (cold.actionOutcome as { searchDisabled: boolean }).searchDisabled = true;
    expect(validateEquipmentSample(cold, profile)).toContain(
      "cold-open did not record the exact enabled, healthy 12-row catalogue outcome."
    );
    const cart = sample("cart-quantity");
    const cartOutcome = cart.actionOutcome as { observedQuantity: number; previousQuantity: number };
    cartOutcome.observedQuantity = cartOutcome.previousQuantity;
    expect(validateEquipmentSample(cart, profile)).toContain("Cart quantity did not record the exact line increment.");
  });

  it("refuses to overwrite either evidence input", () => {
    expect(() => resolveEvidencePaths("one.json", "two.json", "one.json")).toThrow(/must not overwrite/);
    expect(() => resolveEvidencePaths("one.json", "two.json", "two.json")).toThrow(/must not overwrite/);
  });

  it("writes truthful non-qualifying evidence for pre-measurement orchestration failures", () => {
    const failed = buildEquipmentProfileResult({
      browserVersion: "Chrome/140",
      candidate: { gitSha: "a".repeat(40), dirtyPaths: [] },
      cleanup: {
        actorCountAfter: 4,
        actorDeleted: true,
        actorMissingAfterCleanup: true,
        languageUnchanged: true,
        policyRestored: true,
      },
      cleanupFailures: [],
      driver: driverProvenance(),
      liveFixture: null,
      orchestrationFailure: { stage: "player-open", name: "Error", message: "render failed" },
      options: { samples: 1, warmups: 0 },
      preflight: { actorCountBefore: 4, languageSnapshot: "en", policySnapshot: { version: 1 } },
      profile,
      routeFailures: ["route diagnostic"],
      runId: "failed-run",
      samples: [],
      servedFiles: [{ path: "module.json", bytes: 100, requests: 1, sha256: "b".repeat(64) }],
      setup: { ...fixture("failed-run"), policySnapshot: { version: 1 } },
      startedAt: "2026-08-21T12:00:00.000Z",
    });
    expect(failed).toMatchObject({
      status: "failed",
      failure: { stage: "player-open", message: "render failed" },
      runtime: fixture().runtime,
      preflight: { actorCountBefore: 4, languageSnapshot: "en", policySnapshotCaptured: true },
      cleanup: { actorMissingAfterCleanup: true, policyRestored: true },
      servedRouteFailures: ["route diagnostic"],
      qualification: { passed: false },
    });
    expect(failed.fixture).not.toHaveProperty("policySnapshot");
    expect(failed.qualification.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("player-open"),
        expect.stringContaining("Candidate route failed"),
      ])
    );
  });

  it("preserves cleanup failures when no live fixture was available", () => {
    const failed = buildEquipmentProfileResult({
      browserVersion: "Chrome/140",
      candidate: { gitSha: "a".repeat(40), dirtyPaths: [] },
      cleanup: null,
      cleanupFailures: [{ stage: "fixture-cleanup", name: "Error", message: "cleanup transport lost" }],
      driver: driverProvenance(),
      liveFixture: null,
      orchestrationFailure: { stage: "fixture-setup", name: "Error", message: "setup response lost" },
      options: { samples: 1, warmups: 0 },
      preflight: {
        actorCountBefore: 4,
        languageSnapshot: "en",
        policySnapshot: { version: 1 },
        runtime: fixture().runtime,
      },
      profile,
      routeFailures: [],
      runId: "failed-before-setup",
      samples: [],
      servedFiles: [],
      setup: null,
      startedAt: "2026-08-21T12:00:00.000Z",
    });
    expect(failed).toMatchObject({
      status: "failed",
      runtime: fixture().runtime,
      preflight: { actorCountBefore: 4, languageSnapshot: "en", policySnapshotCaptured: true },
      fixture: null,
      cleanup: null,
      cleanupFailures: [{ stage: "fixture-cleanup", message: "cleanup transport lost" }],
      qualification: { passed: false },
    });
  });

  it("preserves the read-only GM runtime when guarded preflight fails", () => {
    const observedRuntime = fixture().runtime;
    const failed = buildEquipmentProfileResult({
      browserVersion: "Chrome/140",
      candidate: { gitSha: "a".repeat(40), dirtyPaths: [] },
      cleanup: null,
      cleanupFailures: [],
      driver: driverProvenance(),
      liveFixture: null,
      observedRuntime,
      orchestrationFailure: { stage: "preflight", name: "Error", message: "expected world mismatch" },
      options: { samples: 1, warmups: 0 },
      preflight: null,
      profile,
      routeFailures: [],
      runId: "preflight-failed",
      samples: [],
      servedFiles: [{ path: "module.json", bytes: 100, requests: 1, sha256: "b".repeat(64) }],
      setup: null,
      startedAt: "2026-08-21T12:00:00.000Z",
    });
    expect(failed).toMatchObject({
      status: "failed",
      failure: { stage: "preflight", message: "expected world mismatch" },
      runtime: observedRuntime,
      preflight: null,
      qualification: { passed: false },
    });
  });

  it("does not mislabel cleanup-only failures as orchestration failures", () => {
    const failed = buildEquipmentProfileResult({
      browserVersion: "Chrome/140",
      candidate: { gitSha: "a".repeat(40), dirtyPaths: [] },
      cleanup: null,
      cleanupFailures: [{ stage: "browser-close", name: "Error", message: "close failed" }],
      driver: driverProvenance(),
      liveFixture: fixture(),
      orchestrationFailure: null,
      options: { samples: 1, warmups: 0 },
      preflight: null,
      profile,
      routeFailures: [],
      runId: "cleanup-only",
      samples: [],
      servedFiles: [],
      setup: fixture(),
      startedAt: "2026-08-21T12:00:00.000Z",
    });
    expect(failed).toMatchObject({
      status: "failed",
      failure: { stage: "browser-close", message: "close failed" },
      qualification: { passed: false, failures: ["Cleanup failed at browser-close: close failed"] },
    });
  });

  it("qualifies every action and width independently", () => {
    const samples = profile.actions.flatMap((action: { id: string }) =>
      profile.appWidths.flatMap((requestedAppWidth: number) =>
        Array.from({ length: 30 }, (_, index) => ({
          ...sample(action.id),
          requestedAppWidth,
          actualAppWidth: requestedAppWidth,
          sampleIndex: index + 1,
        }))
      )
    );
    const summary = summarizeEquipmentProfile(profile, samples);
    expect(summary.measuredSampleCount).toBe(840);
    expect(summary.byActionWidth).toHaveLength(28);
    expect(validateEquipmentBudgets(profile, summary)).toEqual({ passed: true, failures: [] });

    summary.byActionWidth[27].p95Ms = 76;
    expect(validateEquipmentBudgets(profile, summary).failures).toContain("preview-change at 760px p95 exceeded 75ms.");
    summary.byActionWidth[27].p95Ms = 25;
    summary.byActionWidth[27].newPreviewP95Ms = 76;
    expect(validateEquipmentBudgets(profile, summary).failures).toContain(
      "preview-change at 760px new-preview p95 exceeded 75ms."
    );
  });

  it("emits compact evidence without raw samples", () => {
    const summary = summarizeEquipmentProfile(profile, [sample("rapid-search")]);
    const compact = compactEquipmentEvidence({
      profile,
      candidate: { gitSha: "abc" },
      runtime: fixture().runtime,
      fixture: fixture(),
      runId: "run-1",
      summary,
    });
    expect(compact.runIds).toEqual(["run-1"]);
    expect(compact.schemaVersion).toBe(2);
    expect(compact.profile.timingSemantics).toEqual(profile.timingSemantics);
    expect(compact.byActionWidth).toHaveLength(28);
    expect(compact).not.toHaveProperty("samples");
  });

  it("requires two identical clean qualified runs with guarded cleanup", () => {
    const result = qualifiedResult("run-1");
    const second = qualifiedResult("run-2");
    expect(qualifyEquipmentEvidenceRuns([result, second])).toMatchObject({
      ok: true,
      evidence: { runIds: ["run-1", "run-2"] },
    });
    second.candidate.gitSha = "different";
    expect(qualifyEquipmentEvidenceRuns([result, second]).failures).toContain("Qualified runs disagree on candidate.");

    expect(qualifyEquipmentEvidenceRuns([result, result]).failures).toContain(
      "Equipment evidence requires two distinct nonempty run ids."
    );

    const reusedActor = qualifiedResult("run-2");
    reusedActor.fixture.actorId = result.fixture.actorId;
    expect(qualifyEquipmentEvidenceRuns([result, reusedActor]).failures).toContain(
      "Qualified equipment runs require distinct stable fixture actor ids."
    );

    const failedStatus = qualifiedResult("run-2");
    failedStatus.status = "failed";
    expect(qualifyEquipmentEvidenceRuns([result, failedStatus]).failures).toContain(
      "Run 2 is not a completed equipment profile run."
    );

    const oldSchema = qualifiedResult("run-2");
    oldSchema.schemaVersion = 1;
    expect(qualifyEquipmentEvidenceRuns([result, oldSchema]).failures).toContain(
      "Run 2 does not use equipment evidence schemaVersion 2."
    );

    const malformed = qualifiedResult("run-2");
    malformed.candidate.requestedRef = undefined;
    malformed.driver.sha256 = "0".repeat(64);
    malformed.environment.cpu.logicalProcessorCount = 0;
    malformed.runtime.locale = "fr";
    malformed.cleanup.actorDeleted = false;
    malformed.servedModuleFiles = [];
    expect(qualifyEquipmentEvidenceRuns([result, malformed]).failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("candidate requestedRef"),
        expect.stringContaining("aggregate hash"),
        expect.stringContaining("environment provenance"),
        expect.stringContaining("runtime disagrees"),
        expect.stringContaining("exact actor cleanup"),
        expect.stringContaining("served-candidate provenance"),
      ])
    );
  });

  it("rederives evidence from exact raw sample cardinality and rejects tampering", () => {
    const first = qualifiedResult("run-1");
    const missing = qualifiedResult("run-2");
    missing.samples.pop();
    expect(qualifyEquipmentEvidenceRuns([first, missing]).failures).toEqual(
      expect.arrayContaining([expect.stringContaining("missing sample")])
    );

    const tampered = qualifiedResult("run-2");
    tampered.samples[0].planBuildCount = 999;
    expect(qualifyEquipmentEvidenceRuns([first, tampered]).failures).toEqual(
      expect.arrayContaining([expect.stringContaining("plan builds"), expect.stringContaining("stored failures")])
    );
  });
});

function fixture(runId = "run-1") {
  return {
    actorId: `actor-${runId}`,
    actorName: `WF Equipment Profile - ${profile.id} - ${runId}`,
    runtime: {
      worldId: "testing-world",
      locale: "en",
      foundryVersion: "14.366",
      pf2eVersion: "8.4.1",
    },
    users: {
      gm: { id: "gm", isGM: true },
      player: { id: "player", isGM: false },
    },
    executor: { userId: "player", locale: "en" },
    actorCountBefore: 4,
    actorCountAfterCreate: 5,
    policy: structuredClone(profile.expectedPolicy),
    catalogueCounts: structuredClone(profile.expectedCatalogueCounts),
    expectedFinalResultValues: [...profile.expectedFinalResultValues],
    finalResultCount: profile.expectedFinalResultValues.length,
  };
}

function sample(actionId: string) {
  const outcomes = {
    "cold-open": {
      searchDisabled: false,
      diagnosticCount: 0,
      catalogueStatePresent: false,
      visibleResultValues: [...profile.expectedBroadResultValues],
    },
    "warm-reopen": {
      searchDisabled: false,
      diagnosticCount: 0,
      catalogueStatePresent: false,
      visibleResultValues: [...profile.expectedBroadResultValues],
    },
    "facet-change": { filterKey: "rarity", filterValue: "common", previousPressed: false, observedPressed: true },
    "cart-quantity": { lineId: "line-1", previousQuantity: 1, observedQuantity: 2 },
    "recipe-change": { previousRecipe: "permanent-items", observedRecipe: "lump-sum" },
    "preview-change": {
      targetSourceUuid: profile.expectedFinalResultValues[0],
      visiblePreviewSourceUuid: profile.expectedFinalResultValues[0],
    },
  };
  const sampleStartedAt = 100;
  const actionIntervals =
    actionId === "preview-change"
      ? [
          { kind: "preview-new", startedAt: 110, completedAt: 130 },
          { kind: "preview-repeat", startedAt: 140, completedAt: 165 },
        ]
      : actionId === "rapid-search"
        ? [{ kind: "rapid-final-query", startedAt: 150, completedAt: 175 }]
        : [{ kind: actionId, startedAt: 110, completedAt: 135 }];
  const semanticCompletedAt = actionIntervals.at(-1)?.completedAt ?? 0;
  return {
    schemaVersion: 2,
    actionId,
    requestedAppWidth: 1240,
    actualAppWidth: 1240,
    sampleKind: "measured",
    sampleIndex: 1,
    sampleStartedAt,
    semanticCompletedAt,
    observationCompletedAt: semanticCompletedAt + 350,
    actionIntervals,
    durationMs: 25,
    combinedDurationMs: semanticCompletedAt - sampleStartedAt,
    typingStartedAt: actionId === "rapid-search" ? 110 : null,
    endToEndTypingDurationMs: actionId === "rapid-search" ? 65 : null,
    semanticPassed: true,
    finalValue: actionId === "rapid-search" ? "spray pellets" : null,
    focused: actionId === "rapid-search" ? true : null,
    selectionStart: actionId === "rapid-search" ? 13 : null,
    selectionEnd: actionId === "rapid-search" ? 13 : null,
    observedResultValues: actionId === "rapid-search" ? ["Compendium.pf2e.equipment-srd.Item.qaAQnuLVia6vS1LU"] : [],
    focusLossCount: 0,
    caretMismatchCount: 0,
    staleFlashCount: 0,
    actionOutcome: outcomes[actionId as keyof typeof outcomes] ?? null,
    domElementCount: 300,
    resultDomElementCount: 12,
    mountedResultCount: 1,
    resultOffset: 0,
    resultEnd: 1,
    imageRequestCount: 0,
    longTaskSupported: true,
    observedLongTasks: [],
    qualifyingLongTasks: [],
    postSettleLongTasks: [],
    packIndexReadCount: 0,
    packDocumentReadCount: actionId === "preview-change" ? 1 : 0,
    allPackIndexReadCount: 0,
    allPackDocumentReadCount: actionId === "preview-change" ? 1 : 0,
    planBuildCount: 0,
    planBuildCounterSupported: true,
    fullRenderCallCount: 0,
    fullPrepareContextCount: 0,
    newPreviewHydrationCount: actionId === "preview-change" ? 1 : undefined,
    repeatPreviewHydrationCount: actionId === "preview-change" ? 0 : undefined,
    newPreviewDurationMs: actionId === "preview-change" ? 20 : undefined,
    repeatPreviewDurationMs: actionId === "preview-change" ? 25 : undefined,
    combinedPreviewDurationMs: actionId === "preview-change" ? 55 : undefined,
    repeatPreviewRenderScheduled: actionId === "preview-change" ? true : undefined,
    repeatPreviewDetailReplaced: actionId === "preview-change" ? true : undefined,
    failures: [],
  };
}

function qualifiedResult(runId: string) {
  const qualifiedProfile = structuredClone(profile);
  const samples = profile.actions.flatMap((action: { id: string }) =>
    profile.appWidths.flatMap((requestedAppWidth: number) => [
      ...Array.from({ length: 2 }, (_, index) => ({
        ...sample(action.id),
        requestedAppWidth,
        actualAppWidth: requestedAppWidth,
        sampleKind: "warmup",
        sampleIndex: index + 1,
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        ...sample(action.id),
        requestedAppWidth,
        actualAppWidth: requestedAppWidth,
        sampleIndex: index + 1,
      })),
    ])
  );
  const qualifiedFixture = fixture(runId);
  qualifiedFixture.catalogueCounts = structuredClone(qualifiedProfile.expectedCatalogueCounts);
  return {
    schemaVersion: 2,
    status: "completed",
    profile: qualifiedProfile,
    runId,
    runMode: "qualification",
    startedAt: runId === "run-1" ? "2026-08-21T10:00:00.000Z" : "2026-08-21T10:02:00.000Z",
    finishedAt: runId === "run-1" ? "2026-08-21T10:01:00.000Z" : "2026-08-21T10:03:00.000Z",
    candidate: { gitSha: "a".repeat(40), gitDescribe: "a9d3176", requestedRef: null, dirtyPaths: [] },
    runtime: fixture(runId).runtime,
    driver: driverProvenance(),
    environment: {
      browserVersion: "Chrome/140",
      nodeVersion: "v22.0.0",
      os: { platform: "win32", release: "10.0", arch: "x64" },
      cpu: { model: "Test CPU", logicalProcessorCount: 8 },
    },
    servedModuleFiles: [
      { path: "module.json", bytes: 100, requests: runId === "run-1" ? 1 : 2, sha256: "b".repeat(64) },
      { path: "scripts/wayfinder-app.js", bytes: 200, requests: 1, sha256: "c".repeat(64) },
    ],
    fixture: qualifiedFixture,
    cleanup: {
      actorCountAfter: 4,
      actorDeleted: true,
      actorMissingAfterCleanup: true,
      languageUnchanged: true,
      policyRestored: true,
    },
    samples,
    summary: summarizeEquipmentProfile(qualifiedProfile, samples),
    qualification: validateEquipmentBudgets(qualifiedProfile, summarizeEquipmentProfile(qualifiedProfile, samples)),
  };
}

function driverProvenance() {
  const paths = [
    "tools/foundry-interaction/equipment-catalogue-profile.json",
    "tools/foundry-smoke/browser-suite.js",
    "tools/foundry-smoke/browser-session.mjs",
    "tools/foundry-smoke/class-cases.mjs",
    "tools/foundry-smoke/shared-browser-suite-lifecycle.mjs",
    "tools/foundry-smoke/skill-selection-policy.js",
    "tools/foundry-interaction/browser-equipment-profile.js",
    "tools/foundry-interaction/equipment-profile-results.mjs",
    "tools/foundry-interaction/build-equipment-profile-evidence.mjs",
    "tools/foundry-interaction/run-equipment-profile.mjs",
  ];
  const files = paths.map((path, index) => ({ path, sha256: String(index).padStart(64, "0") }));
  return { files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
