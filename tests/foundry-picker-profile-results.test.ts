import { describe, expect, it } from "vitest";
import {
  buildPickerProfileMarkdown,
  percentile,
  summarizePickerProfile,
  validatePickerBudgetConfiguration,
  validatePickerBudgets,
  validatePickerFixture,
  validatePickerSample,
} from "../tools/foundry-interaction/profile-results.mjs";

const profile = {
  schemaVersion: 1,
  id: "test-profile",
  viewport: { width: 1440, height: 1000 },
  appWidths: [1240, 760],
  querySequence: ["f", "fo", "for", "force"],
  expectedPickerRenderCount: 1,
  budgets: null,
};

describe("Foundry picker profile results", () => {
  it("uses nearest-rank percentiles without inventing data for an empty sample", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.75)).toBe(30);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
    expect(percentile([-1, 10], 0.5)).toBe(10);
  });

  it("accepts a settled final query with exact results, focus, and caret", () => {
    expect(validatePickerSample(validSample(), profile)).toEqual([]);
  });

  it("accepts only the pinned world, locale, actor delta, rarity access, and pack policy", () => {
    expect(validatePickerFixture(fixtureProfile(), validFixture(), "testing-world")).toEqual([]);

    expect(
      validatePickerFixture(
        fixtureProfile(),
        {
          ...validFixture(),
          actorCountAfterCreate: 12,
          restrictedSpellRarityAccess: true,
          runtime: { worldId: "other-world", locale: "fr" },
          packPolicy: {
            officialSpellPack: "other.spells",
            additionalSourcePacks: "homebrew.spells",
            spellRarityCeiling: "rare",
            observedPackIds: ["other.spells"],
          },
        },
        "testing-world"
      )
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("other-world"),
        expect.stringContaining("locale en"),
        expect.stringContaining("exactly one"),
        expect.stringContaining("must not grant"),
        expect.stringContaining("Official spell pack"),
        expect.stringContaining("Additional source packs"),
        expect.stringContaining("rarity ceiling"),
        expect.stringContaining("Observed pack ids"),
      ])
    );
  });

  it("treats visible result order as part of picker correctness", () => {
    const failures = validatePickerSample(
      {
        ...validSample(),
        expectedResultCount: 2,
        observedResultCount: 2,
        expectedResultValues: ["pf2e.spells-srd:first", "pf2e.spells-srd:second"],
        observedResultValues: ["pf2e.spells-srd:second", "pf2e.spells-srd:first"],
      },
      profile
    );

    expect(failures).toContain("The final visible result identities did not match the expected filtered options.");
  });

  it("binds each sample oracle to the frozen profile identities", () => {
    const failures = validatePickerSample(
      {
        ...validSample(),
        expectedResultValues: ["pf2e.spells-srd:wrong"],
        observedResultValues: ["pf2e.spells-srd:wrong"],
      },
      { ...profile, expectedResultValues: ["pf2e.spells-srd:force-barrage"] }
    );

    expect(failures).toContain("The sample result oracle did not match the frozen profile identities or ordering.");
  });

  it("reports dropped input, stale flashes, result drift, and focus loss independently", () => {
    const sample = {
      ...validSample(),
      durationMs: null,
      finalInputObserved: false,
      finalValue: "for",
      focused: false,
      focusLossCount: 1,
      caretMismatchCount: 1,
      observedQueries: ["f", "fo", "for"],
      observedResultCount: 2,
      observedResultValues: ["pf2e.spells-srd:force-barrage", "pf2e.spells-srd:wrong"],
      selectionStart: 2,
      selectionEnd: 2,
      staleFlashCount: 1,
    };

    const failures = validatePickerSample(sample, profile);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("never reached"),
        expect.stringContaining("did not contain"),
        expect.stringContaining("No final-keystroke"),
        expect.stringContaining("result identities"),
        expect.stringContaining("focus was lost"),
        expect.stringContaining("caret was incorrect"),
        expect.stringContaining("stale result"),
      ])
    );
  });

  it("rejects full renders, context preparation, node replacement, and unsupported long-task evidence", () => {
    const failures = validatePickerSample(
      {
        ...validSample(),
        longTaskSupported: false,
        fullRenderCallCount: 1,
        fullPrepareContextCount: 2,
        pickerPartRenderCallCount: 2,
        pickerPartPrepareContextCount: 2,
        packIndexReadCount: 1,
        packDocumentReadCount: 1,
        planBuildCount: 1,
        planBuildCounterSupported: false,
        previewHydrationCount: 1,
        previewHydrationCounterSupported: false,
        searchInputReplacementCount: 1,
        shellReplacementCount: 1,
      },
      profile
    );

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("replaced its input"),
        expect.stringContaining("non-picker shell"),
        expect.stringContaining("Long Task"),
        expect.stringContaining("full application render"),
        expect.stringContaining("full application context"),
        expect.stringContaining("picker-part render"),
        expect.stringContaining("picker-part context"),
        expect.stringContaining("live pack indexes"),
        expect.stringContaining("pack documents"),
        expect.stringContaining("render-plan execution counter"),
        expect.stringContaining("preview-hydration execution counter"),
      ])
    );
  });

  it("rejects executed plan construction and preview hydration during steady search", () => {
    const failures = validatePickerSample(
      {
        ...validSample(),
        planBuildCount: 1,
        previewHydrationCount: 1,
      },
      profile
    );

    expect(failures).toEqual([
      "Search rebuilt the Wayfinder plan 1 time(s).",
      "Search hydrated the active preview 1 time(s).",
    ]);
  });

  it("summarizes only measured samples by configured app width", () => {
    const samples = [
      {
        ...validSample(),
        sampleKind: "warmup",
        requestedAppWidth: 1240,
        durationMs: 999,
        failures: ["warmup failed"],
      },
      { ...validSample(), sampleKind: "measured", requestedAppWidth: 1240, durationMs: 10 },
      { ...validSample(), sampleKind: "measured", requestedAppWidth: 1240, durationMs: 30 },
      {
        ...validSample(),
        sampleKind: "measured",
        requestedAppWidth: 760,
        durationMs: 20,
        failures: ["failed"],
      },
    ];

    const summary = summarizePickerProfile(profile, samples);
    expect(summary).toMatchObject({
      measuredSampleCount: 3,
      failedSampleCount: 2,
      p50Ms: 20,
      p75Ms: 30,
      p95Ms: 30,
      byWidth: [
        { requestedAppWidth: 1240, sampleCount: 2, p50Ms: 10, p95Ms: 30 },
        { requestedAppWidth: 760, sampleCount: 1, failedSampleCount: 1, p50Ms: 20 },
      ],
    });
  });

  it("qualifies each width independently at the exact frozen boundaries", () => {
    const budgetProfile = {
      ...profile,
      budgets: {
        maxP95MsPerWidth: 30,
        maxDomElementCount: 800,
        maxResultDomElementCount: 12,
        maxImageRequestsPerSample: 0,
        maxLongTaskCountPerWidth: 0,
      },
    };
    const samples = budgetProfile.appWidths.flatMap((requestedAppWidth) =>
      Array.from({ length: 30 }, (_, index) => ({
        ...validSample(),
        requestedAppWidth,
        sampleIndex: index + 1,
        durationMs: 30,
      }))
    );
    const summary = summarizePickerProfile(budgetProfile, samples);

    expect(validatePickerBudgets(budgetProfile, summary)).toEqual({
      configured: true,
      passed: true,
      failures: [],
    });
  });

  it("fails one slow or structurally expensive width without hiding it in aggregate metrics", () => {
    const budgetProfile = {
      ...profile,
      budgets: {
        maxP95MsPerWidth: 30,
        maxDomElementCount: 800,
        maxResultDomElementCount: 12,
        maxImageRequestsPerSample: 0,
        maxLongTaskCountPerWidth: 0,
      },
    };
    const summary = {
      p95Ms: 20,
      byWidth: [
        {
          requestedAppWidth: 1240,
          sampleCount: 30,
          p95Ms: 31,
          maxDomElementCount: 801,
          maxResultDomElementCount: 13,
          maxImageRequestsPerSample: 1,
          longTaskCount: 1,
        },
        {
          requestedAppWidth: 760,
          sampleCount: 29,
          p95Ms: 20,
          maxDomElementCount: 800,
          maxResultDomElementCount: 12,
          maxImageRequestsPerSample: 0,
          longTaskCount: 0,
        },
      ],
    };

    expect(validatePickerBudgets(budgetProfile, summary).failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("1240px p95 duration"),
        expect.stringContaining("1240px DOM element count"),
        expect.stringContaining("1240px result DOM element count"),
        expect.stringContaining("1240px image requests per sample"),
        expect.stringContaining("1240px long-task count"),
        expect.stringContaining("760px recorded 29 measured samples"),
      ])
    );
  });

  it("keeps development sample overrides useful without weakening qualification", () => {
    const budgetProfile = {
      ...profile,
      appWidths: [1240],
      budgets: {
        maxP95MsPerWidth: 30,
        maxDomElementCount: 800,
        maxResultDomElementCount: 12,
        maxImageRequestsPerSample: 0,
        maxLongTaskCountPerWidth: 0,
      },
    };
    const summary = summarizePickerProfile(budgetProfile, [validSample()]);

    expect(validatePickerBudgets(budgetProfile, summary).passed).toBe(false);
    expect(validatePickerBudgets(budgetProfile, summary, { requireQualificationSamples: false })).toMatchObject({
      configured: true,
      passed: true,
      failures: [],
    });
  });

  it("fails closed when structural measurements or long-task entries are missing", () => {
    const missing = validatePickerSample(
      {
        ...validSample(),
        windowContentWidth: undefined,
        domElementCount: Number.NaN,
        resultDomElementCount: undefined,
        imageRequestCount: undefined,
        longTasks: undefined,
      },
      profile
    );
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Window-content width"),
        expect.stringContaining("DOM element count"),
        expect.stringContaining("Result DOM element count"),
        expect.stringContaining("Image request count"),
        expect.stringContaining("Long Task entries"),
      ])
    );

    expect(validatePickerSample({ ...validSample(), longTasks: [{ duration: Number.NaN }] }, profile)).toContain(
      "Long Task entries contained a missing, nonfinite, or negative duration."
    );
  });

  it("marks an unfrozen profile as measurement-only and rejects malformed limits", () => {
    const summary = summarizePickerProfile(profile, []);
    expect(validatePickerBudgets(profile, summary)).toEqual({ configured: false, passed: false, failures: [] });

    const malformed = validatePickerBudgets({ ...profile, budgets: { maxP95MsPerWidth: Number.NaN } }, summary);
    expect(malformed).toMatchObject({ configured: true, passed: false });
    expect(malformed.failures).toEqual(expect.arrayContaining([expect.stringContaining("finite nonnegative")]));
    expect(validatePickerBudgetConfiguration({ ...profile, budgets: { maxP95MsPerWidth: Number.NaN } })).toEqual(
      expect.arrayContaining([expect.stringContaining("maxP95MsPerWidth")])
    );
  });

  it("renders candidate, runtime, diagnostics, and semantic failures into Markdown", () => {
    const samples = [{ ...validSample(), sampleKind: "measured", failures: ["lost focus"] }];
    const summary = summarizePickerProfile({ ...profile, appWidths: [1240] }, samples);
    const markdown = buildPickerProfileMarkdown({
      profile: { ...profile, appWidths: [1240] },
      startedAt: "2026-08-15T00:00:00.000Z",
      finishedAt: "2026-08-15T00:01:00.000Z",
      candidate: { gitSha: "abc123", dirtyPaths: [] },
      runtime: { foundryVersion: "14.366", pf2eVersion: "8.4.0", moduleVersion: "0.7.3" },
      fixture: { optionCount: 200, expectedResultCount: 1 },
      samples,
      summary,
    });

    expect(markdown).toContain("Git: abc123");
    expect(markdown).toContain("Foundry 14.366, PF2E 8.4.0, Wayfinder 0.7.3");
    expect(markdown).toContain("Catalogue: 200 eligible options; 1 final results");
    expect(markdown).toContain("lost focus");
  });
});

function validSample() {
  return {
    requestedAppWidth: 1240,
    actualAppWidth: 1240,
    windowContentWidth: 1238,
    sampleIndex: 1,
    sampleKind: "measured",
    durationMs: 25,
    finalInputObserved: true,
    observedQueries: ["f", "fo", "for", "force"],
    expectedResultCount: 1,
    observedResultCount: 1,
    expectedResultNames: ["Force Barrage"],
    observedResultNames: ["Force Barrage"],
    expectedResultValues: ["pf2e.spells-srd:force-barrage"],
    observedResultValues: ["pf2e.spells-srd:force-barrage"],
    finalValue: "force",
    selectionStart: 5,
    selectionEnd: 5,
    focused: true,
    focusLossCount: 0,
    caretMismatchCount: 0,
    staleFlashCount: 0,
    staleRenderCommitCount: 0,
    rootReplacementCount: 0,
    searchInputReplacementCount: 0,
    shellReplacementCount: 0,
    domElementCount: 800,
    resultDomElementCount: 12,
    imageRequestCount: 0,
    longTasks: [],
    longTaskSupported: true,
    fullRenderCallCount: 0,
    fullPrepareContextCount: 0,
    pickerPartRenderCallCount: 1,
    pickerPartPrepareContextCount: 1,
    packIndexReadCount: 0,
    packDocumentReadCount: 0,
    planBuildCount: 0,
    planBuildCounterSupported: true,
    previewHydrationCount: 0,
    previewHydrationCounterSupported: true,
    failures: [],
  };
}

function fixtureProfile() {
  return {
    ...profile,
    locale: "en",
    expectedPackPolicy: {
      additionalSourcePacks: "",
      spellRarityCeiling: "common",
      observedPackIds: ["pf2e.spells-srd"],
    },
    expectedOptionCount: 200,
    expectedResultValues: ["pf2e.spells-srd:force-barrage"],
    expectedRuntime: {
      foundryVersion: "14.366",
      pf2eVersion: "8.4.0",
    },
  };
}

function validFixture() {
  return {
    actorCountBefore: 10,
    actorCountAfterCreate: 11,
    restrictedSpellRarityAccess: false,
    optionCount: 200,
    expectedResultValues: ["pf2e.spells-srd:force-barrage"],
    runtime: {
      worldId: "testing-world",
      locale: "en",
      foundryVersion: "14.366",
      pf2eVersion: "8.4.0",
    },
    packPolicy: {
      officialSpellPack: "pf2e.spells-srd",
      additionalSourcePacks: "",
      spellRarityCeiling: "common",
      observedPackIds: ["pf2e.spells-srd"],
    },
  };
}
