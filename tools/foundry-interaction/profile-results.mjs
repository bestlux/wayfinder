export function percentile(values, percentileValue) {
  const finiteValues = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (finiteValues.length === 0) {
    return null;
  }

  const bounded = Math.min(1, Math.max(0, percentileValue));
  const index = Math.max(0, Math.ceil(bounded * finiteValues.length) - 1);
  return finiteValues[index];
}

export function validatePickerSample(sample, profile) {
  const failures = [];
  const finalQuery = profile.querySequence.at(-1) ?? "";
  const expectedQueries = profile.querySequence;

  if (!sample.finalInputObserved) {
    failures.push(`Final query ${JSON.stringify(finalQuery)} never reached the input handler.`);
  }
  if (sample.finalValue !== finalQuery) {
    failures.push(`Final input value was ${JSON.stringify(sample.finalValue)}, expected ${JSON.stringify(finalQuery)}.`);
  }
  if (JSON.stringify(sample.observedQueries ?? []) !== JSON.stringify(expectedQueries)) {
    failures.push(
      `Observed input sequence ${JSON.stringify(sample.observedQueries ?? [])} did not contain ${JSON.stringify(expectedQueries)}.`
    );
  }
  if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
    failures.push("No final-keystroke-to-correct-results paint duration was recorded.");
  }
  if (sample.observedResultCount !== sample.expectedResultCount) {
    failures.push(`Observed ${sample.observedResultCount} results, expected ${sample.expectedResultCount}.`);
  }
  if (!sameStrings(sample.observedResultValues ?? [], sample.expectedResultValues ?? [])) {
    failures.push("The final visible result identities did not match the expected filtered options.");
  }
  if (!sample.focused) {
    failures.push("Search focus was not retained after the final results paint.");
  }
  if (sample.selectionStart !== finalQuery.length || sample.selectionEnd !== finalQuery.length) {
    failures.push(
      `Final caret was ${sample.selectionStart}:${sample.selectionEnd}, expected ${finalQuery.length}:${finalQuery.length}.`
    );
  }
  if ((sample.focusLossCount ?? 0) > 0) {
    failures.push(`Search focus was lost ${sample.focusLossCount} time(s) after typing began.`);
  }
  if ((sample.caretMismatchCount ?? 0) > 0) {
    failures.push(`Search caret was incorrect during ${sample.caretMismatchCount} input event(s).`);
  }
  if ((sample.staleFlashCount ?? 0) > 0) {
    failures.push(`Observed ${sample.staleFlashCount} stale result transition(s) after correct final results appeared.`);
  }
  if ((sample.staleRenderCommitCount ?? 0) > 0) {
    failures.push(`Observed ${sample.staleRenderCommitCount} stale render commit(s) after the final input event.`);
  }
  if ((sample.searchInputReplacementCount ?? 0) > 0) {
    failures.push(`Search replaced its input ${sample.searchInputReplacementCount} time(s).`);
  }
  if ((sample.shellReplacementCount ?? 0) > 0) {
    failures.push(`Search replaced the non-picker shell ${sample.shellReplacementCount} time(s).`);
  }
  if (sample.longTaskSupported !== true) {
    failures.push("This browser did not expose Long Task performance entries.");
  }
  if ((sample.fullRenderCallCount ?? 0) > 0) {
    failures.push(`Search called the full application render path ${sample.fullRenderCallCount} time(s).`);
  }
  if ((sample.fullPrepareContextCount ?? 0) > 0) {
    failures.push(`Search prepared the full application context ${sample.fullPrepareContextCount} time(s).`);
  }
  const expectedPickerRenderCount = profile.expectedPickerRenderCount ?? 1;
  if (sample.pickerPartRenderCallCount !== expectedPickerRenderCount) {
    failures.push(
      `Search called the picker-part render path ${sample.pickerPartRenderCallCount} time(s), expected ${expectedPickerRenderCount}.`
    );
  }
  if (sample.pickerPartPrepareContextCount !== expectedPickerRenderCount) {
    failures.push(
      `Search prepared picker-part context ${sample.pickerPartPrepareContextCount} time(s), expected ${expectedPickerRenderCount}.`
    );
  }
  if ((sample.packIndexReadCount ?? 0) > 0) {
    failures.push(`Search read live pack indexes ${sample.packIndexReadCount} time(s).`);
  }
  if ((sample.packDocumentReadCount ?? 0) > 0) {
    failures.push(`Search hydrated pack documents ${sample.packDocumentReadCount} time(s).`);
  }
  if (Math.abs((sample.actualAppWidth ?? sample.requestedAppWidth) - sample.requestedAppWidth) > 2) {
    failures.push(
      `App width settled at ${sample.actualAppWidth}px, expected ${sample.requestedAppWidth}px within 2px.`
    );
  }

  return failures;
}

export function validatePickerFixture(profile, fixture, expectedWorldId) {
  const failures = [];
  if (fixture.runtime?.worldId !== expectedWorldId) {
    failures.push(`Connected to ${fixture.runtime?.worldId}, expected ${expectedWorldId}.`);
  }
  if (fixture.runtime?.locale !== profile.locale) {
    failures.push(`Picker profile requires locale ${profile.locale}, observed ${fixture.runtime?.locale}.`);
  }
  if (fixture.actorCountAfterCreate !== fixture.actorCountBefore + 1) {
    failures.push("Picker fixture creation did not add exactly one disposable actor.");
  }
  if (fixture.restrictedSpellRarityAccess !== false) {
    failures.push("Picker fixture must not grant draft-level restricted spell rarity access.");
  }
  if (
    Number.isInteger(profile.expectedOptionCount) &&
    fixture.optionCount !== profile.expectedOptionCount
  ) {
    failures.push(`Picker option count was ${fixture.optionCount}, expected ${profile.expectedOptionCount}.`);
  }
  if (
    Array.isArray(profile.expectedResultValues) &&
    !sameStrings(fixture.expectedResultValues ?? [], profile.expectedResultValues)
  ) {
    failures.push("Picker final result identities or ordering drifted from the frozen profile.");
  }
  for (const [key, expectedValue] of Object.entries(profile.expectedRuntime ?? {})) {
    if (fixture.runtime?.[key] !== expectedValue) {
      failures.push(
        `Picker runtime ${key} was ${JSON.stringify(fixture.runtime?.[key])}, expected ${JSON.stringify(expectedValue)}.`
      );
    }
  }

  const expectedPolicy = {
    officialSpellPack: "pf2e.spells-srd",
    ...profile.expectedPackPolicy,
  };
  const observedPolicy = fixture.packPolicy ?? {};
  if (observedPolicy.officialSpellPack !== expectedPolicy.officialSpellPack) {
    failures.push(
      `Official spell pack was ${JSON.stringify(observedPolicy.officialSpellPack)}, expected ${JSON.stringify(expectedPolicy.officialSpellPack)}.`
    );
  }
  if (observedPolicy.additionalSourcePacks !== expectedPolicy.additionalSourcePacks) {
    failures.push(
      `Additional source packs were ${JSON.stringify(observedPolicy.additionalSourcePacks)}, expected ${JSON.stringify(expectedPolicy.additionalSourcePacks)}.`
    );
  }
  if (observedPolicy.spellRarityCeiling !== expectedPolicy.spellRarityCeiling) {
    failures.push(
      `Spell rarity ceiling was ${JSON.stringify(observedPolicy.spellRarityCeiling)}, expected ${JSON.stringify(expectedPolicy.spellRarityCeiling)}.`
    );
  }
  if (!sameStringSet(observedPolicy.observedPackIds ?? [], expectedPolicy.observedPackIds ?? [])) {
    failures.push(
      `Observed pack ids ${JSON.stringify(observedPolicy.observedPackIds ?? [])} did not match ${JSON.stringify(expectedPolicy.observedPackIds ?? [])}.`
    );
  }

  return failures;
}

export function summarizePickerProfile(profile, samples) {
  const measuredSamples = samples.filter((sample) => sample.sampleKind === "measured");
  const byWidth = profile.appWidths.map((requestedAppWidth) => {
    const widthSamples = measuredSamples.filter((sample) => sample.requestedAppWidth === requestedAppWidth);
    return summarizeSamples(requestedAppWidth, widthSamples);
  });
  return {
    measuredSampleCount: measuredSamples.length,
    failedSampleCount: samples.filter((sample) => (sample.failures?.length ?? 0) > 0).length,
    p50Ms: percentile(
      measuredSamples.map((sample) => sample.durationMs),
      0.5
    ),
    p75Ms: percentile(
      measuredSamples.map((sample) => sample.durationMs),
      0.75
    ),
    p95Ms: percentile(
      measuredSamples.map((sample) => sample.durationMs),
      0.95
    ),
    longTaskCount: measuredSamples.reduce((total, sample) => total + (sample.longTasks?.length ?? 0), 0),
    byWidth,
  };
}

export function buildPickerProfileMarkdown(result) {
  const rows = result.summary.byWidth.map((entry) =>
    [
      entry.requestedAppWidth,
      entry.sampleCount,
      entry.failedSampleCount,
      formatMetric(entry.p50Ms),
      formatMetric(entry.p75Ms),
      formatMetric(entry.p95Ms),
      entry.longTaskCount,
      entry.maxDomElementCount ?? "",
      entry.maxResultCount ?? "",
      entry.imageRequestCount,
    ].join(" | ")
  );
  const failures = result.samples
    .filter((sample) => (sample.failures?.length ?? 0) > 0)
    .map(
      (sample) =>
        `- ${sample.requestedAppWidth}px ${sample.sampleKind} #${sample.sampleIndex}: ${sample.failures.join(" ")}`
    );

  return `# Wayfinder Picker Interaction Profile

- Profile: ${result.profile.id} (schema ${result.profile.schemaVersion})
- Started: ${result.startedAt}
- Finished: ${result.finishedAt}
- Git: ${result.candidate.gitSha}${result.candidate.dirtyPaths.length ? `; dirty: ${result.candidate.dirtyPaths.join(", ")}` : ""}
- Runtime: Foundry ${result.runtime.foundryVersion}, PF2E ${result.runtime.pf2eVersion}, Wayfinder ${result.runtime.moduleVersion}
- Browser viewport: ${result.profile.viewport.width}x${result.profile.viewport.height}
- Query sequence: ${result.profile.querySequence.map((query) => `\`${query}\``).join(" → ")}
- Catalogue: ${result.fixture.optionCount} eligible options; ${result.fixture.expectedResultCount} final results
- Samples: ${result.summary.measuredSampleCount} measured; ${result.summary.failedSampleCount} failed semantic validation
- Aggregate duration: p50 ${formatMetric(result.summary.p50Ms)} ms, p75 ${formatMetric(result.summary.p75Ms)} ms, p95 ${formatMetric(result.summary.p95Ms)} ms
- Budgets: ${result.profile.budgets === null ? "not frozen; this run is measurement evidence" : "configured in the profile"}

| App width | Samples | Failed | p50 ms | p75 ms | p95 ms | Long tasks | Max DOM elements | Max results | Image requests |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.map((row) => `| ${row} |`).join("\n")}

## Semantic failures

${failures.length > 0 ? failures.join("\n") : "None."}
`;
}

function summarizeSamples(requestedAppWidth, samples) {
  return {
    requestedAppWidth,
    sampleCount: samples.length,
    failedSampleCount: samples.filter((sample) => (sample.failures?.length ?? 0) > 0).length,
    p50Ms: percentile(
      samples.map((sample) => sample.durationMs),
      0.5
    ),
    p75Ms: percentile(
      samples.map((sample) => sample.durationMs),
      0.75
    ),
    p95Ms: percentile(
      samples.map((sample) => sample.durationMs),
      0.95
    ),
    longTaskCount: samples.reduce((total, sample) => total + (sample.longTasks?.length ?? 0), 0),
    imageRequestCount: samples.reduce((total, sample) => total + (sample.imageRequestCount ?? 0), 0),
    maxDomElementCount: maximum(samples.map((sample) => sample.domElementCount)),
    maxResultCount: maximum(samples.map((sample) => sample.observedResultCount)),
  };
}

function maximum(values) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
}

function sameStringSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sameStrings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "n/a";
}
