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

const profilePath = fileURLToPath(
  new URL("../tools/foundry-interaction/equipment-catalogue-profile.json", import.meta.url)
);
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

describe("equipment catalogue performance profile", () => {
  it("freezes the inherited release envelope and exact action contracts", () => {
    expect(validateEquipmentProfile(profile)).toEqual([]);
    expect(profile.appWidths).toEqual([1240, 1180, 980, 760]);
    expect(profile.budgets).toEqual({
      maxP95MsPerActionWidth: 75,
      maxDomElementCount: 325,
      maxResultDomElementCount: 12,
      maxImageRequestsPerSample: 0,
      maxLongTaskCountPerActionWidth: 0,
    });
    expect(profile.expectedCatalogueCounts).toEqual({ indexed: 5856, levelQualified: 2283, matching: 1, visible: 1 });
  });

  it("rejects weakened sample depth, widths, budgets, and preview caching", () => {
    const changed = structuredClone(profile);
    changed.appWidths = [1240];
    changed.measuredSamplesPerActionWidth = 29;
    changed.budgets.maxP95MsPerActionWidth = 76;
    changed.smokeCaseId = "different-fixture";
    changed.postSettleMs = 0;
    changed.actions.at(-1).repeatPreviewHydrations = 1;
    changed.actions.find((action: { id: string }) => action.id === "rapid-search").maxPlanBuilds = 999_999;
    expect(validateEquipmentProfile(changed)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("app widths"),
        expect.stringContaining("30 measured"),
        expect.stringContaining("Wave 0"),
        expect.stringContaining("zero unchanged-repeat"),
        expect.stringContaining("counter limits"),
        expect.stringContaining("exact Wizard"),
        expect.stringContaining("350ms"),
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
  return {
    actionId,
    requestedAppWidth: 1240,
    actualAppWidth: 1240,
    sampleKind: "measured",
    sampleIndex: 1,
    durationMs: 25,
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
    imageRequestCount: 0,
    longTaskSupported: true,
    longTasks: [],
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
    "tools/foundry-interaction/browser-equipment-profile.js",
    "tools/foundry-interaction/equipment-profile-results.mjs",
    "tools/foundry-interaction/build-equipment-profile-evidence.mjs",
    "tools/foundry-interaction/run-equipment-profile.mjs",
  ];
  const files = paths.map((path, index) => ({ path, sha256: String(index).padStart(64, "0") }));
  return { files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
