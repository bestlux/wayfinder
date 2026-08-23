import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveEvidencePaths } from "../tools/foundry-interaction/build-equipment-profile-evidence.mjs";
import {
  compactEquipmentEvidence,
  expectedEquipmentMountedRows,
  qualifyEquipmentEvidenceRuns,
  resultWindowBrowserViewport,
  summarizeEquipmentProfile,
  validateEquipmentBudgets,
  validateEquipmentControllerRecoveryProbe,
  validateEquipmentFixture,
  validateEquipmentProfile,
  validateEquipmentResultWindowObservation,
  validateEquipmentResultWindows,
  validateEquipmentSample,
  validateEquipmentScrollProbe,
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
      maxMountedResultCount: 144,
      maxSettledMountedResultCount: 64,
      maxResultDomElementsPerMountedRow: 12,
      maxResultChromeDomElementCount: 2,
      maxAdaptiveResultDomElementCount: 1730,
      maxNonResultChromeDomElementCount: 416,
      maxImageRequestsPerSample: 0,
      maxLongTaskCountPerActionWidth: 0,
    });
    expect(profile.resultWindowProfiles).toEqual([
      { id: "default", appHeight: 820 },
      { id: "expanded", appHeight: 1200 },
      { id: "tall", appHeight: 1500 },
    ]);
    expect(profile.resultWindowSizing).toEqual({
      rowsBehind: 12,
      rowsAhead: 24,
      maximumMountedRows: 144,
    });
    expect(profile.resultWindowSampling).toEqual({
      appWidth: 1240,
      browserViewportPaddingPx: 100,
      observationsPerProfile: 1,
    });
    expect(profile.scrollSampling).toEqual({
      resultWindowProfileId: "tall",
      rapidFullScreenScrolls: 2,
      framesAfterScroll: 3,
      maxVisibleGapPx: 2,
    });
    expect(profile.controllerRecoverySampling).toEqual({
      resultWindowProfileId: "default",
      forcedEnrichmentFailures: 1,
    });
    expect(profile.actions.find((action: { id: string }) => action.id === "cold-open").maxPackDocumentReads).toBe(0);
    expect(profile.samplingSemantics.performance).toContain("default 820px");
    expect(profile.samplingSemantics.resultWindows).toContain("not timing samples");
    expect(profile.expectedCatalogueCounts).toEqual({
      indexed: 5856,
      levelQualified: 2283,
      defaultShelf: 1138,
      matching: 1,
      visible: 1,
    });
    expect(profile.expectedDefaultShelfValues).toHaveLength(36);
    expect(profile.schemaVersion).toBe(3);
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
    changed.resultWindowSampling.observationsPerProfile = 0;
    changed.resultWindowSizing.maximumMountedRows = 36;
    changed.scrollSampling.rapidFullScreenScrolls = 0;
    changed.controllerRecoverySampling.forcedEnrichmentFailures = 0;
    changed.samplingSemantics.resultWindows = "all height profiles are timing samples";
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
        expect.stringContaining("result-window profile once"),
        expect.stringContaining("12-behind/24-ahead"),
        expect.stringContaining("render-free full-screen scroll"),
        expect.stringContaining("preview-enrichment failure"),
        expect.stringContaining("sampling semantics"),
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
    expect(reopenSource).toContain("currentApp().setPosition?.({ height, width })");
    expect(reopenSource).not.toContain("await frames(2)");
  });

  it("resizes both the browser viewport and Foundry application for the bounded height probes", () => {
    expect(runner).toContain("await playerPage.setViewportSize(browserViewport)");
    expect(runner).toContain("__wayfinderEquipmentProfile.inspectResultWindow(payload)");
    expect(runner).toContain("await playerPage.setViewportSize(profile.viewport)");
    expect(browserProfile).toContain("async resize({ height, width })");
    expect(browserProfile).toContain("app.setPosition?.({ height, width })");
    expect(browserProfile).toContain("async probeStableHostScroll({ framesAfterScroll");
    expect(browserProfile).toContain("const immediateShelf = visibleShelfSnapshot()");
    expect(browserProfile).toContain("stableHostPreserved: currentResultList() === stableHost");
    expect(browserProfile).toContain("packDocumentReadCount: counters.equipmentPackDocument - documentReadsBefore");
    expect(browserProfile).toContain("async probeControllerRecovery(");
    expect(browserProfile).toContain("const target = await findUnresolvedPriceRow(settleTimeoutMs)");
    expect(browserProfile).toContain("gate.reject()");
    expect(browserProfile).toContain("targetPricePending");
  });

  it("injects recovery failure only at the genuine pack-document enrichment boundary", () => {
    expect(browserProfile).not.toContain("partialRenderRejectionGate");
    expect(browserProfile).not.toContain("holdNextEquipmentWindowRenderRejection");
    expect(browserProfile).toMatch(
      /const result = await getDocument\(id, \.\.\.args\);[\s\S]*if \(gate\) await gate\.promise/
    );
    expect(browserProfile).toContain('error.name = "WayfinderEquipmentProfileForcedDocumentError"');
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
      "cold-open did not record the exact enabled, healthy default shelf."
    );
    const collapsed = sample("cold-open");
    collapsed.listClientHeight = 0;
    expect(validateEquipmentSample(collapsed, profile)).toContain(
      "Timing sample result list height is missing or invalid."
    );
    const recipe = sample("recipe-change");
    recipe.listClientHeight = 0;
    recipe.resultDomElementCount = 0;
    recipe.mountedResultCount = 0;
    recipe.totalResultCount = 0;
    recipe.firstMountedResultIndex = -1;
    recipe.lastMountedResultIndex = -1;
    recipe.stableHost = false;
    recipe.canvasHeightPx = 0;
    expect(validateEquipmentSample(recipe, profile)).toEqual([]);
    const cart = sample("cart-quantity");
    const cartOutcome = cart.actionOutcome as { observedQuantity: number; previousQuantity: number };
    cartOutcome.observedQuantity = cartOutcome.previousQuantity;
    expect(validateEquipmentSample(cart, profile)).toContain("Cart quantity did not record the exact line increment.");
  });

  it("keeps a collapsed narrow catalogue viewport as an explicit semantic failure", () => {
    const narrow = sample("cold-open");
    narrow.requestedAppWidth = 760;
    narrow.actualAppWidth = 760;
    narrow.listClientHeight = 0;
    expect(validateEquipmentSample(narrow, profile)).toContain(
      "Default-height timing sample list geometry is collapsed or unmeasurable."
    );
  });

  it("requires one truthful mounted-window observation at every declared app height", () => {
    const observations = resultWindowObservations();
    expect(validateEquipmentResultWindows(profile, observations)).toEqual([]);
    expect(observations.map((entry) => entry.browserViewport.height)).toEqual([1000, 1300, 1600]);
    expect(observations.map((entry) => entry.mountedResultCount)).toEqual([28, 33, 41]);
    expect(
      expectedEquipmentMountedRows(profile, {
        listClientHeight: 4000,
        measuredRowHeightPx: 64,
        totalResultCount: 1138,
      })
    ).toBe(88);

    const wrongHeight = structuredClone(observations[2]);
    wrongHeight.actualAppHeight = 1000;
    wrongHeight.browserViewport.height = 1000;
    expect(validateEquipmentResultWindowObservation(wrongHeight, profile)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("wrong browser viewport"),
        expect.stringContaining("height did not match"),
      ])
    );

    const oversizedRoot = structuredClone(observations[2]);
    oversizedRoot.domElementCount = 9999;
    expect(validateEquipmentResultWindowObservation(oversizedRoot, profile)).toContain(
      "tall root DOM exceeded its 910-element size-specific limit."
    );

    const missing = observations.slice(0, 2);
    expect(validateEquipmentResultWindows(profile, missing)).toContain(
      "Result-window evidence is missing observation tall|1."
    );
  });

  it("requires synchronous real-row coverage through rapid stable-host scrolls", () => {
    const probe = stableHostScrollProbe();
    expect(validateEquipmentScrollProbe(profile, probe)).toEqual([]);

    const gap = structuredClone(probe);
    gap.immediateShelf.visibleResultCount = 0;
    gap.immediateShelf.maxVisibleGapPx = gap.immediateShelf.viewportHeight;
    expect(validateEquipmentScrollProbe(profile, gap)).toContain(
      "Equipment stable-host scroll exposed a blank frame, non-real coverage, or visible gap."
    );

    const rendered = structuredClone(probe);
    rendered.equipmentRenderCallCount = 1;
    expect(validateEquipmentScrollProbe(profile, rendered)).toContain(
      "Equipment scroll caused document I/O, a Foundry render, or replacement of the stable host."
    );
  });

  it("requires a genuine enrichment failure to preserve focus and permit exact same-row retry", () => {
    const probe = controllerRecoveryProbe();
    expect(validateEquipmentControllerRecoveryProbe(profile, probe)).toEqual([]);

    const droppedHost = structuredClone(probe);
    droppedHost.enrichmentPendingState.stableHostPreserved = false;
    expect(validateEquipmentControllerRecoveryProbe(profile, droppedHost)).toContain(
      "Pending preview enrichment did not preserve the stable host, focus, and prior detail."
    );

    const nonretryable = structuredClone(probe);
    nonretryable.failedState.targetPricePending = false;
    expect(validateEquipmentControllerRecoveryProbe(profile, nonretryable)).toContain(
      "Failed preview enrichment did not leave a retryable focused row on the stable host."
    );

    const failedRetry = structuredClone(probe);
    failedRetry.retryState.visiblePreviewSourceUuid = null;
    expect(validateEquipmentControllerRecoveryProbe(profile, failedRetry)).toContain(
      "Same-row preview retry did not converge to exact price and visible detail on the stable host."
    );

    const extraRecovery = structuredClone(probe);
    extraRecovery.packDocumentReadCount = 3;
    expect(validateEquipmentControllerRecoveryProbe(profile, extraRecovery)).toContain(
      "Equipment controller recovery did not force one enrichment failure and one exact same-row retry."
    );
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
      resultWindowObservations: resultWindowObservations(),
      scrollProbe: stableHostScrollProbe(),
      controllerRecoveryProbe: controllerRecoveryProbe(),
      summary,
    });
    expect(compact.runIds).toEqual(["run-1"]);
    expect(compact.schemaVersion).toBe(3);
    expect(compact.profile.timingSemantics).toEqual(profile.timingSemantics);
    expect(compact.profile.samplingSemantics).toEqual(profile.samplingSemantics);
    expect(compact.resultWindowObservations).toHaveLength(3);
    expect(compact.scrollProbe.failures).toEqual([]);
    expect(compact.controllerRecoveryProbe.failures).toEqual([]);
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
    oldSchema.schemaVersion = 2;
    expect(qualifyEquipmentEvidenceRuns([result, oldSchema]).failures).toContain(
      "Run 2 does not use equipment evidence schemaVersion 3."
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
  const broadMountedValues = mountedResultValues(28);
  const outcomes = {
    "cold-open": {
      searchDisabled: false,
      diagnosticCount: 0,
      catalogueStatePresent: false,
      visibleResultValues: broadMountedValues,
    },
    "warm-reopen": {
      searchDisabled: false,
      diagnosticCount: 0,
      catalogueStatePresent: false,
      visibleResultValues: broadMountedValues,
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
    schemaVersion: 3,
    actionId,
    browserViewport: structuredClone(profile.viewport),
    resultWindowProfileId: "default",
    requestedAppHeight: 820,
    requestedAppWidth: 1240,
    actualAppHeight: 820,
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
    listClientHeight: 192,
    measuredRowHeightPx: 64,
    resultDomElementCount: ["cold-open", "warm-reopen"].includes(actionId) ? 282 : 12,
    mountedResultCount: ["cold-open", "warm-reopen"].includes(actionId) ? 28 : 1,
    totalResultCount: ["cold-open", "warm-reopen"].includes(actionId) ? 1138 : 1,
    scrollTop: 0,
    firstMountedResultIndex: 0,
    lastMountedResultIndex: ["cold-open", "warm-reopen"].includes(actionId) ? 27 : 0,
    mountedIndexesContiguous: true,
    stableHost: true,
    canvasHeightPx: ["cold-open", "warm-reopen"].includes(actionId) ? 1138 * 64 : 64,
    maxVisibleGapPx: 0,
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
  const windows = resultWindowObservations();
  const scroll = stableHostScrollProbe();
  const recovery = controllerRecoveryProbe();
  return {
    schemaVersion: 3,
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
    resultWindowObservations: windows,
    scrollProbe: scroll,
    controllerRecoveryProbe: recovery,
    samples,
    summary: summarizeEquipmentProfile(qualifiedProfile, samples),
    qualification: validateEquipmentBudgets(qualifiedProfile, summarizeEquipmentProfile(qualifiedProfile, samples), {
      resultWindowObservations: windows,
      scrollProbe: scroll,
      controllerRecoveryProbe: recovery,
    }),
  };
}

function resultWindowObservations() {
  return profile.resultWindowProfiles.map((windowProfile: { appHeight: number; id: string }, index: number) => {
    const listClientHeight = [192, 500, 1000][index];
    const measuredRowHeightPx = 64;
    const totalResultCount = profile.expectedCatalogueCounts.defaultShelf;
    const expectedMountedRows = expectedEquipmentMountedRows(profile, {
      listClientHeight,
      measuredRowHeightPx,
      scrollTop: 0,
      totalResultCount,
    });
    const values = mountedResultValues(expectedMountedRows);
    const observation = {
      schemaVersion: 3,
      resultWindowProfileId: windowProfile.id,
      observationIndex: 1,
      browserViewport: resultWindowBrowserViewport(profile, windowProfile),
      requestedAppWidth: profile.resultWindowSampling.appWidth,
      requestedAppHeight: windowProfile.appHeight,
      actualAppWidth: profile.resultWindowSampling.appWidth,
      actualAppHeight: windowProfile.appHeight,
      domElementCount: expectedMountedRows * 10 + 300,
      listClientHeight,
      measuredRowHeightPx,
      totalResultCount,
      scrollTop: 0,
      mountedResultCount: expectedMountedRows,
      firstMountedResultIndex: 0,
      lastMountedResultIndex: expectedMountedRows - 1,
      mountedIndexesContiguous: true,
      firstMountedSourceUuid: values[0],
      lastMountedSourceUuid: values.at(-1),
      mountedResultValues: values,
      stableHost: true,
      canvasHeightPx: totalResultCount * measuredRowHeightPx,
      maxVisibleGapPx: 0,
      resultDomElementCount: expectedMountedRows * 10 + 2,
    };
    return { ...observation, failures: validateEquipmentResultWindowObservation(observation, profile) };
  });
}

function mountedResultValues(count: number) {
  return [
    ...profile.expectedDefaultShelfValues.slice(0, count),
    ...Array.from(
      { length: Math.max(0, count - profile.expectedDefaultShelfValues.length) },
      (_, resultIndex) => `Compendium.pf2e.equipment-srd.Item.synthetic-${resultIndex + 37}`
    ),
  ];
}

function stableHostScrollProbe() {
  const windowProfile = profile.resultWindowProfiles.find(
    (entry: { id: string }) => entry.id === profile.scrollSampling.resultWindowProfileId
  );
  const shelf = {
    scrollTop: 2000,
    viewportHeight: 1000,
    visibleResultCount: 16,
    visibleSkeletonCount: 0,
    maxVisibleGapPx: 0,
    pendingDocumentReads: 0,
  };
  const initialWindow = {
    mountedResultCount: 41,
    totalResultCount: 1138,
    scrollTop: 0,
    firstMountedResultIndex: 0,
    lastMountedResultIndex: 40,
    mountedIndexesContiguous: true,
    listClientHeight: 1000,
    measuredRowHeightPx: 64,
  };
  const destinationWindow = {
    mountedResultCount: 53,
    totalResultCount: 1138,
    scrollTop: 2000,
    firstMountedResultIndex: 19,
    lastMountedResultIndex: 71,
    mountedIndexesContiguous: true,
    listClientHeight: 1000,
    measuredRowHeightPx: 64,
  };
  const probe = {
    schemaVersion: 3,
    resultWindowProfileId: windowProfile.id,
    browserViewport: resultWindowBrowserViewport(profile, windowProfile),
    requestedAppWidth: profile.resultWindowSampling.appWidth,
    requestedAppHeight: windowProfile.appHeight,
    rapidFullScreenScrollCount: 2,
    initialWindow,
    destinationWindow,
    requestedScrollDeltaPx: 2000,
    observedScrollDeltaPx: 2000,
    immediateShelf: structuredClone(shelf),
    shelvesAfterScroll: [structuredClone(shelf), structuredClone(shelf), structuredClone(shelf)],
    stableHostPreserved: true,
    packDocumentReadCount: 0,
    equipmentRenderCallCount: 0,
    fullRenderCallCount: 0,
  };
  return { ...probe, failures: validateEquipmentScrollProbe(profile, probe) };
}

function controllerRecoveryProbe() {
  const windowProfile = profile.resultWindowProfiles.find(
    (entry: { id: string }) => entry.id === profile.controllerRecoverySampling.resultWindowProfileId
  );
  const initialWindow = {
    listClientHeight: 192,
    measuredRowHeightPx: 64,
    totalResultCount: profile.expectedCatalogueCounts.defaultShelf,
    scrollTop: 0,
    mountedResultCount: 28,
    firstMountedResultIndex: 0,
    lastMountedResultIndex: 27,
    mountedIndexesContiguous: true,
    firstMountedSourceUuid: profile.expectedDefaultShelfValues[0],
    lastMountedSourceUuid: profile.expectedDefaultShelfValues[27],
    mountedResultValues: profile.expectedDefaultShelfValues.slice(0, 28),
  };
  const targetSourceUuid = profile.expectedDefaultShelfValues[10];
  const initialState = {
    window: structuredClone(initialWindow),
    stableHostPreserved: true,
    pendingDocumentReads: 0,
    focusedSourceUuid: targetSourceUuid,
    visiblePreviewSourceUuid: null,
    targetPricePending: true,
  };
  const probe = {
    schemaVersion: 3,
    resultWindowProfileId: windowProfile.id,
    browserViewport: resultWindowBrowserViewport(profile, windowProfile),
    requestedAppWidth: profile.resultWindowSampling.appWidth,
    requestedAppHeight: windowProfile.appHeight,
    targetSourceUuid,
    forcedEnrichmentFailureCount: 1,
    forcedFailureStage: "pack-document-read",
    failedAttemptEquipmentRenderCount: 1,
    successfulRetryEquipmentRenderCount: 1,
    fullRenderCallCount: 0,
    packDocumentReadCount: 2,
    initialState,
    enrichmentPendingState: {
      ...structuredClone(initialState),
      pendingDocumentReads: 1,
    },
    failedState: {
      ...structuredClone(initialState),
    },
    retryState: {
      ...structuredClone(initialState),
      targetPricePending: false,
      visiblePreviewSourceUuid: targetSourceUuid,
    },
  };
  return { ...probe, failures: validateEquipmentControllerRecoveryProbe(profile, probe) };
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
