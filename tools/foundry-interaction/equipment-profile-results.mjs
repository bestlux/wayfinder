import { createHash } from "node:crypto";

const REQUIRED_ACTIONS = [
  "cold-open",
  "warm-reopen",
  "rapid-search",
  "facet-change",
  "cart-quantity",
  "recipe-change",
  "preview-change",
];
const CATALOGUE_VIEWPORT_ACTIONS = new Set([
  "cold-open",
  "warm-reopen",
  "rapid-search",
  "facet-change",
  "cart-quantity",
  "preview-change",
]);

const FROZEN_VIEWPORT = { width: 1440, height: 1000 };
const FROZEN_APP_WIDTHS = [1240, 1180, 980, 760];
const FROZEN_RESULT_WINDOW_PROFILES = [
  { id: "default", appHeight: 820 },
  { id: "expanded", appHeight: 1200 },
  { id: "tall", appHeight: 1500 },
];
const FROZEN_RESULT_WINDOW_SIZING = {
  baselineMountedRows: 36,
  viewportMultiplier: 3,
  overscanRows: 24,
  hydrationChunkRows: 12,
  maximumMountedRows: 144,
};
const FROZEN_RESULT_WINDOW_SAMPLING = {
  appWidth: 1240,
  browserViewportPaddingPx: 100,
  observationsPerProfile: 1,
};
const FROZEN_SCROLL_SAMPLING = {
  resultWindowProfileId: "tall",
  rapidFullScreenScrollsWhilePending: 1,
  framesWhilePending: 3,
  maxVisibleGapPx: 2,
};
const FROZEN_PARTIAL_RENDER_RECOVERY_SAMPLING = {
  resultWindowProfileId: "default",
  forcedRejections: 1,
};
const FROZEN_SAMPLING_SEMANTICS = {
  performance:
    "Each required action is sampled at every app width using the default 820px result-window profile and the frozen 1440x1000 browser viewport; warmup and measured depths apply per action-width cell, the exact default policy-available usefulness-ranked shelf is required, and mounted rows are derived from positive live list geometry.",
  resultWindows:
    "One settled default policy-available shelf layout observation is recorded per result-window profile at 1240px app width; these probes are not timing samples, browser height is max(1000px, app height plus 100px), mounted rows are max(36, three viewport heights, visible rows plus 24) rounded to 12 and capped at 144, the tall probe adds one full-screen scroll while a prior prefetch is held pending, and the default-height probe forces one real partial-render rejection followed by recovery and retry.",
};
const FROZEN_BUDGETS = Object.freeze({
  maxP95MsPerActionWidth: 75,
  maxDomElementCount: 850,
  maxResultDomElementCount: 434,
  maxMountedResultCount: 144,
  maxDefaultMountedResultCount: 36,
  maxResultDomElementsPerMountedRow: 12,
  maxResultChromeDomElementCount: 2,
  maxAdaptiveResultDomElementCount: 1730,
  maxNonResultChromeDomElementCount: 416,
  maxImageRequestsPerSample: 0,
  maxLongTaskCountPerActionWidth: 0,
});
const FROZEN_QUERY = ["s", "sp", "spr", "spra", "spray pellets"];
const FROZEN_RESULT_VALUES = ["Compendium.pf2e.equipment-srd.Item.qaAQnuLVia6vS1LU"];
const FROZEN_DEFAULT_SHELF_VALUES = [
  "Compendium.pf2e.equipment-srd.Item.2req0jGaxz8hScdB",
  "Compendium.pf2e.equipment-srd.Item.8V4mgecGASsQ7fjl",
  "Compendium.pf2e.equipment-srd.Item.rHugmTjO3kgyiTH0",
  "Compendium.pf2e.equipment-srd.Item.k6xZkDUpF7E1Totd",
  "Compendium.pf2e.equipment-srd.Item.4ftXXUCBHcf4b0MH",
  "Compendium.pf2e.equipment-srd.Item.UMAXLDpI6YLSfYX1",
  "Compendium.pf2e.equipment-srd.Item.GbR8rgZMCVBn3Evb",
  "Compendium.pf2e.equipment-srd.Item.TqqWFIiJYA5tXlSE",
  "Compendium.pf2e.equipment-srd.Item.40T4HrQdIIwGHMDq",
  "Compendium.pf2e.equipment-srd.Item.pr2xsD4tk0mzWhms",
  "Compendium.pf2e.equipment-srd.Item.K3qNqWRvBhnlwE3Q",
  "Compendium.pf2e.equipment-srd.Item.GvAGrcl14Ywcgm2I",
  "Compendium.pf2e.equipment-srd.Item.bkbL0YitEh46Ne0f",
  "Compendium.pf2e.equipment-srd.Item.w2ENw2VMPcsbif8g",
  "Compendium.pf2e.equipment-srd.Item.y34yjumCFakrbtdw",
  "Compendium.pf2e.equipment-srd.Item.Ka49l6JYNi41tgVi",
  "Compendium.pf2e.equipment-srd.Item.3lgwjrFEsQVKzhh7",
  "Compendium.pf2e.equipment-srd.Item.A1CDXAP4bNGgntE7",
  "Compendium.pf2e.equipment-srd.Item.Hl2JP8PQKrKxAfAD",
  "Compendium.pf2e.equipment-srd.Item.ZWTK4Q2JlvJ5Bx6A",
  "Compendium.pf2e.equipment-srd.Item.8SkeqnhhYm4QGuJQ",
  "Compendium.pf2e.equipment-srd.Item.w4Hd6nunVVqw3GWj",
  "Compendium.pf2e.equipment-srd.Item.IGgK7NAdfyAPm8V0",
  "Compendium.pf2e.equipment-srd.Item.kKnMlymiqZLVEAtI",
  "Compendium.pf2e.equipment-srd.Item.6KWYmeRMxsQfWhhJ",
  "Compendium.pf2e.equipment-srd.Item.War0uyLBx1jA0Ge7",
  "Compendium.pf2e.equipment-srd.Item.7mXZyzL5v3K6Buu2",
  "Compendium.pf2e.equipment-srd.Item.jm5gQnfvVeUiVfdW",
  "Compendium.pf2e.equipment-srd.Item.VTFTlP8xmPKKV4S6",
  "Compendium.pf2e.equipment-srd.Item.fagzYdmfYyMQ6J77",
  "Compendium.pf2e.equipment-srd.Item.f0A1zqCFiUJuXc9U",
  "Compendium.pf2e.equipment-srd.Item.IM2pz0wnO4OEMr1f",
  "Compendium.pf2e.equipment-srd.Item.2DoUHoueAyyP4lMN",
  "Compendium.pf2e.equipment-srd.Item.FPwsiGqMCNPLHmjX",
  "Compendium.pf2e.equipment-srd.Item.sqhr1crb184s3Vnd",
  "Compendium.pf2e.equipment-srd.Item.hMYdSFmMWzidzHih",
];
const FROZEN_COUNTS = { indexed: 5856, levelQualified: 2283, defaultShelf: 1138, matching: 1, visible: 1 };
const FROZEN_COUNT_SEMANTICS = {
  indexed: "Raw entries in the exact core equipment pack index.",
  levelQualified: "Runtime browse entries after recipe maximum-level filtering, including policy-unavailable rows.",
  defaultShelf: "Runtime browse entries after the default policy-available facet, before the adaptive mounted window.",
  matching: "Registered runtime-adapter records for the exact final query before the 12-row cap.",
  visible: "Rendered result rows for the exact final query.",
};
const FROZEN_RUNTIME = { foundryVersion: "14.366", pf2eVersion: "8.4.1" };
const FROZEN_POLICY = {
  effectivePackIds: ["pf2e.equipment-srd"],
  blanketRarity: "common",
  enabledRecipes: ["lump-sum", "permanent-items"],
  recipeChoiceAuthority: "actor-owner",
};
const FROZEN_IDENTITY = {
  id: "wizard-level-5-equipment-catalogue",
  smokeCaseId: "wizard-l1-l5-apply-rerun",
  stepId: "starting-equipment-level-5",
  locale: "en",
};
const FROZEN_TIMING = { keyDelayMs: 8, settleTimeoutMs: 15000, postSettleMs: 350 };
const FROZEN_TIMING_SEMANTICS = {
  catalogueOpenPrimary: "open-dispatch-to-semantic-catalogue-ready",
  rapidSearchPrimary: "final-input-dispatch-to-final-results",
  rapidSearchDiagnostic: "first-input-dispatch-to-final-results",
  previewPrimary: ["new-preview-dispatch-to-visible", "repeat-preview-dispatch-to-visible"],
  previewDiagnostic: "new-preview-dispatch-to-repeat-visible",
  qualifyingLongTasks: "overlap-primary-action-intervals",
  postSettleLongTasks: "overlap-semantic-completion-to-observation-end-diagnostic-only",
};
const FROZEN_DRIVER_PATHS = [
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
const COUNTER_LIMITS = [
  ["packIndexReadCount", "maxPackIndexReads", "pack-index reads"],
  ["packDocumentReadCount", "maxPackDocumentReads", "pack-document reads"],
  ["planBuildCount", "maxPlanBuilds", "plan builds"],
  ["fullRenderCallCount", "maxFullRenders", "full renders"],
  ["fullPrepareContextCount", "maxFullContextPreparations", "full context preparations"],
];
const FROZEN_ACTION_CONTRACTS = [
  ["cold-open", 1, 36, 1, 1, 1],
  ["warm-reopen", 0, 12, 1, 1, 1],
  ["rapid-search", 0, 12, 0, 0, 0],
  ["facet-change", 0, 12, 0, 0, 0],
  ["cart-quantity", 0, 12, 0, 0, 0],
  ["recipe-change", 0, 12, 0, 0, 0],
  ["preview-change", 0, 1, 0, 0, 0],
];

export function validateEquipmentProfile(profile) {
  const failures = [];
  if (profile?.schemaVersion !== 3 || !nonempty(profile.id) || !nonempty(profile.smokeCaseId)) {
    failures.push("Equipment profile requires schemaVersion 3, id, and smokeCaseId.");
  }
  if (
    stableJson({
      id: profile?.id,
      smokeCaseId: profile?.smokeCaseId,
      stepId: profile?.stepId,
      locale: profile?.locale,
    }) !== stableJson(FROZEN_IDENTITY)
  ) {
    failures.push("Equipment profile must preserve the exact Wizard level-5 fixture, equipment step, and English locale.");
  }
  if (
    stableJson({
      keyDelayMs: profile?.keyDelayMs,
      settleTimeoutMs: profile?.settleTimeoutMs,
      postSettleMs: profile?.postSettleMs,
    }) !== stableJson(FROZEN_TIMING)
  ) {
    failures.push("Equipment profile must preserve the frozen 8ms key delay, 15s settle timeout, and 350ms observation window.");
  }
  if (stableJson(profile?.timingSemantics) !== stableJson(FROZEN_TIMING_SEMANTICS)) {
    failures.push(
      "Equipment profile timing semantics drifted from the semantic-open, final-input, split-preview, and action-overlap contract.",
    );
  }
  if (stableJson(profile?.viewport) !== stableJson(FROZEN_VIEWPORT)) {
    failures.push("Equipment profile must freeze the 1440x1000 viewport.");
  }
  if (stableJson(profile?.appWidths) !== stableJson(FROZEN_APP_WIDTHS)) {
    failures.push("Equipment profile must freeze app widths 1240, 1180, 980, and 760 in order.");
  }
  if (stableJson(profile?.resultWindowProfiles) !== stableJson(FROZEN_RESULT_WINDOW_PROFILES)) {
    failures.push("Equipment profile must freeze the default, expanded, and tall application heights.");
  }
  if (stableJson(profile?.resultWindowSizing) !== stableJson(FROZEN_RESULT_WINDOW_SIZING)) {
    failures.push("Equipment profile must freeze the adaptive 36-to-144-row result-window formula.");
  }
  if (stableJson(profile?.resultWindowSampling) !== stableJson(FROZEN_RESULT_WINDOW_SAMPLING)) {
    failures.push("Equipment profile must probe every result-window profile once at 1240px with 100px viewport padding.");
  }
  if (stableJson(profile?.scrollSampling) !== stableJson(FROZEN_SCROLL_SAMPLING)) {
    failures.push("Equipment profile must freeze one pending-prefetch full-screen scroll probe at the tall height.");
  }
  if (
    stableJson(profile?.partialRenderRecoverySampling) !==
    stableJson(FROZEN_PARTIAL_RENDER_RECOVERY_SAMPLING)
  ) {
    failures.push("Equipment profile must freeze one real partial-render rejection, recovery, and retry probe.");
  }
  if (stableJson(profile?.samplingSemantics) !== stableJson(FROZEN_SAMPLING_SEMANTICS)) {
    failures.push("Equipment profile sampling semantics must distinguish default-height timing samples from layout probes.");
  }
  if (profile?.warmupSamplesPerActionWidth !== 2 || profile?.measuredSamplesPerActionWidth !== 30) {
    failures.push("Equipment profile must freeze two warmups and 30 measured samples per action and width.");
  }
  if (!validGrowingPrefixes(profile?.querySequence)) {
    failures.push("Equipment rapid-search query must contain strictly growing prefixes.");
  }
  if (stableJson(profile?.querySequence) !== stableJson(FROZEN_QUERY)) {
    failures.push("Equipment profile query drifted from the frozen Spray Pellets oracle.");
  }
  if (
    !Array.isArray(profile?.expectedFinalResultValues) ||
    profile.expectedFinalResultValues.length < 1 ||
    profile.expectedFinalResultValues.some((value) => !nonempty(value))
  ) {
    failures.push("Equipment profile must freeze at least one exact final result identity.");
  }
  if (stableJson(profile?.expectedFinalResultValues) !== stableJson(FROZEN_RESULT_VALUES)) {
    failures.push("Equipment profile final identity drifted from the frozen Spray Pellets source.");
  }
  if (stableJson(profile?.expectedDefaultShelfValues) !== stableJson(FROZEN_DEFAULT_SHELF_VALUES)) {
    failures.push("Equipment profile default-shelf identities drifted from the frozen 36-row usefulness ranking.");
  }
  if (profile?.expectedDefaultShelfValues?.length !== profile?.resultWindowSizing?.baselineMountedRows) {
    failures.push("Equipment profile must bind every baseline mounted row to an exact default-shelf identity.");
  }
  if (stableJson(profile?.expectedRuntime) !== stableJson(FROZEN_RUNTIME)) {
    failures.push("Equipment profile runtime must remain Foundry 14.366 and PF2E 8.4.1.");
  }
  if (stableJson(profile?.expectedPolicy) !== stableJson(FROZEN_POLICY)) {
    failures.push("Equipment profile policy drifted from the frozen core-only owner contract.");
  }
  const actions = Array.isArray(profile?.actions) ? profile.actions : [];
  if (stableJson(actions.map((action) => action?.id)) !== stableJson(REQUIRED_ACTIONS)) {
    failures.push(`Equipment profile must define the exact ordered actions: ${REQUIRED_ACTIONS.join(", ")}.`);
  }
  for (const action of actions) {
    for (const [, limit, label] of COUNTER_LIMITS) {
      if (!nonnegativeInteger(action?.[limit])) failures.push(`${action?.id ?? "unknown"} lacks a ${label} limit.`);
    }
  }
  const observedContracts = actions.map((action) => [
    action.id,
    action.maxPackIndexReads,
    action.maxPackDocumentReads,
    action.maxPlanBuilds,
    action.maxFullRenders,
    action.maxFullContextPreparations,
  ]);
  if (stableJson(observedContracts) !== stableJson(FROZEN_ACTION_CONTRACTS)) {
    failures.push("Equipment profile action counter limits drifted from the frozen release contracts.");
  }
  const preview = actions.find((action) => action.id === "preview-change");
  if (preview?.newPreviewHydrations !== 1 || preview?.repeatPreviewHydrations !== 0) {
    failures.push("Preview profiling must require one new hydration and zero unchanged-repeat hydrations.");
  }
  const budgets = profile?.budgets;
  for (const key of [
    "maxP95MsPerActionWidth",
    "maxDomElementCount",
    "maxResultDomElementCount",
    "maxMountedResultCount",
    "maxDefaultMountedResultCount",
    "maxResultDomElementsPerMountedRow",
    "maxResultChromeDomElementCount",
    "maxAdaptiveResultDomElementCount",
    "maxNonResultChromeDomElementCount",
    "maxImageRequestsPerSample",
    "maxLongTaskCountPerActionWidth",
  ]) {
    if (!nonnegativeFinite(budgets?.[key])) failures.push(`Equipment profile budget ${key} must be finite and nonnegative.`);
  }
  if (stableJson(budgets) !== stableJson(FROZEN_BUDGETS)) {
    failures.push("Equipment profile must preserve the adaptive 12/24/36-row measured envelope.");
  }
  if (profile?.expectedCatalogueCounts !== null && !validCatalogueCounts(profile.expectedCatalogueCounts)) {
    failures.push(
      "Frozen catalogue counts must provide positive indexed, levelQualified, defaultShelf, matching, and visible integers.",
    );
  }
  if (stableJson(profile?.expectedCatalogueCounts) !== stableJson(FROZEN_COUNTS)) {
    failures.push("Equipment profile catalogue counts drifted from the frozen live tuple.");
  }
  if (stableJson(profile?.catalogueCountSemantics) !== stableJson(FROZEN_COUNT_SEMANTICS)) {
    failures.push("Equipment profile catalogue count semantics drifted from the registered runtime boundaries.");
  }
  return failures;
}

export function validateEquipmentFixture(profile, fixture, expectedWorldId) {
  const failures = [];
  if (fixture?.runtime?.worldId !== expectedWorldId) failures.push(`Expected world ${expectedWorldId}.`);
  if (fixture?.runtime?.locale !== profile.locale) failures.push(`Expected locale ${profile.locale}.`);
  if (fixture?.executor?.locale !== profile.locale || fixture?.executor?.userId !== fixture?.users?.player?.id) {
    failures.push(`Equipment profile executor must be the exact player using locale ${profile.locale}.`);
  }
  for (const [key, value] of Object.entries(profile.expectedRuntime ?? {})) {
    if (fixture?.runtime?.[key] !== value) failures.push(`Expected runtime ${key} ${value}.`);
  }
  if (fixture?.users?.gm?.isGM !== true || fixture?.users?.player?.isGM !== false) {
    failures.push("Equipment profiling requires a distinct GM setup user and non-GM owner executor.");
  }
  if (!fixture?.users?.gm?.id || !fixture?.users?.player?.id || fixture.users.gm.id === fixture.users.player.id) {
    failures.push("Equipment profiling roles must have distinct stable ids.");
  }
  if (fixture?.actorCountAfterCreate !== fixture?.actorCountBefore + 1) {
    failures.push("Equipment profile setup must create exactly one guarded actor.");
  }
  if (stableJson(fixture?.policy) !== stableJson(profile.expectedPolicy)) {
    failures.push("Equipment profile policy does not match the frozen core-only owner policy.");
  }
  if (
    !sameStrings(fixture?.expectedFinalResultValues ?? [], profile.expectedFinalResultValues) ||
    fixture?.finalResultCount !== profile.expectedFinalResultValues.length
  ) {
    failures.push("Equipment profile final result identities drifted.");
  }
  if (
    profile.expectedCatalogueCounts !== null &&
    stableJson(fixture?.catalogueCounts) !== stableJson(profile.expectedCatalogueCounts)
  ) {
    failures.push(
      `Equipment profile catalogue counts drifted: observed ${stableJson(fixture?.catalogueCounts)}, expected ${stableJson(profile.expectedCatalogueCounts)}.`,
    );
  }
  return failures;
}

export function validateEquipmentSample(sample, profile) {
  const failures = [];
  const action = profile.actions?.find((entry) => entry.id === sample?.actionId);
  if (!action) return [`Unknown equipment profile action ${sample?.actionId ?? "<missing>"}.`];
  if (sample?.schemaVersion !== 3) failures.push("Equipment sample requires timing schemaVersion 3.");
  if (!profile.appWidths.includes(sample.requestedAppWidth)) failures.push("Sample app width is not frozen by the profile.");
  const defaultWindow = profile.resultWindowProfiles?.find((entry) => entry.id === "default");
  if (
    sample.resultWindowProfileId !== "default" ||
    sample.requestedAppHeight !== defaultWindow?.appHeight ||
    stableJson(sample.browserViewport) !== stableJson(profile.viewport)
  ) {
    failures.push("Timing samples must use the default result-window height and frozen browser viewport.");
  }
  failures.push(...validateSampleTiming(sample, profile));
  if (sample.semanticPassed !== true) failures.push("Sample did not reach its exact semantic DOM oracle.");
  if (sample.actionId === "rapid-search") {
    const finalQuery = profile.querySequence.at(-1);
    if (sample.finalValue !== finalQuery) failures.push("Rapid search did not preserve the exact final query.");
    if (sample.focused !== true || sample.focusLossCount !== 0) failures.push("Rapid search lost input focus.");
    if (
      sample.selectionStart !== finalQuery.length ||
      sample.selectionEnd !== finalQuery.length ||
      sample.caretMismatchCount !== 0
    ) {
      failures.push("Rapid search did not preserve the caret.");
    }
    if (sample.staleFlashCount !== 0) failures.push("Rapid search flashed stale final results.");
    if (!sameStrings(sample.observedResultValues ?? [], profile.expectedFinalResultValues)) {
      failures.push("Rapid search final result identities drifted.");
    }
  }
  const outcome = sample.actionOutcome;
  if (
    ["cold-open", "warm-reopen"].includes(sample.actionId) &&
    (outcome?.searchDisabled !== false ||
      outcome?.diagnosticCount !== 0 ||
      outcome?.catalogueStatePresent !== false ||
      !sameStrings(outcome?.visibleResultValues ?? [], profile.expectedDefaultShelfValues))
  ) {
    failures.push(`${sample.actionId} did not record the exact enabled, healthy default shelf.`);
  }
  if (sample.actionId === "facet-change") {
    if (!nonempty(outcome?.filterKey) || !nonempty(outcome?.filterValue)) {
      failures.push("Facet change lacks an exact filter identity.");
    }
    if (typeof outcome?.previousPressed !== "boolean" || outcome?.observedPressed !== !outcome?.previousPressed) {
      failures.push("Facet change did not record the exact pressed-state inversion.");
    }
  }
  if (sample.actionId === "cart-quantity") {
    if (
      !nonempty(outcome?.lineId) ||
      !Number.isInteger(outcome?.previousQuantity) ||
      outcome.previousQuantity < 1 ||
      outcome?.observedQuantity !== outcome.previousQuantity + 1
    ) {
      failures.push("Cart quantity did not record the exact line increment.");
    }
  }
  if (
    sample.actionId === "recipe-change" &&
    (outcome?.previousRecipe !== "permanent-items" || outcome?.observedRecipe !== "lump-sum")
  ) {
    failures.push("Recipe change did not record permanent-items to lump-sum.");
  }
  if (!nonnegativeFinite(sample.actualAppWidth) || Math.abs(sample.actualAppWidth - sample.requestedAppWidth) > 2) {
    failures.push("Sample app width did not match the requested application width.");
  }
  if (!nonnegativeFinite(sample.actualAppHeight) || Math.abs(sample.actualAppHeight - sample.requestedAppHeight) > 2) {
    failures.push("Sample app height did not match the requested application height.");
  }
  for (const key of ["domElementCount", "resultDomElementCount", "imageRequestCount"]) {
    if (!nonnegativeInteger(sample[key])) failures.push(`Sample ${key} is missing or invalid.`);
  }
  for (const key of ["mountedResultCount", "resultOffset", "resultEnd"]) {
    if (!nonnegativeInteger(sample[key])) failures.push(`Sample ${key} is missing or invalid.`);
  }
  if (
    CATALOGUE_VIEWPORT_ACTIONS.has(sample.actionId) &&
    (!nonnegativeFinite(sample.listClientHeight) || sample.listClientHeight <= 0)
  ) {
    failures.push("Timing sample result list height is missing or invalid.");
  }
  if (nonnegativeInteger(sample.mountedResultCount)) {
    const expectedMountedRows = expectedEquipmentMountedRows(profile, sample);
    if (["cold-open", "warm-reopen"].includes(sample.actionId) && expectedMountedRows === null) {
      failures.push("Default-height timing sample list geometry is collapsed or unmeasurable.");
    }
    if (
      (["cold-open", "warm-reopen"].includes(sample.actionId) &&
        expectedMountedRows !== null &&
        sample.mountedResultCount !== expectedMountedRows) ||
      sample.mountedResultCount > profile.budgets.maxDefaultMountedResultCount
    ) {
      failures.push("Default-height timing sample did not preserve its geometry-derived mounted-row budget.");
    }
    if (sample.mountedResultCount > profile.budgets.maxMountedResultCount) {
      failures.push(`Sample mounted ${sample.mountedResultCount} results; limit ${profile.budgets.maxMountedResultCount}.`);
    }
    const resultDomLimit =
      sample.mountedResultCount * profile.budgets.maxResultDomElementsPerMountedRow +
      profile.budgets.maxResultChromeDomElementCount;
    if (sample.resultDomElementCount > resultDomLimit) {
      failures.push(`Sample result DOM exceeded its ${resultDomLimit}-element mounted-window limit.`);
    }
  }
  if (sample.longTaskSupported !== true) failures.push("This browser did not expose Long Task performance entries.");
  if (sample.planBuildCounterSupported !== true) failures.push("The render-plan execution counter is unavailable.");
  for (const key of ["observedLongTasks", "qualifyingLongTasks", "postSettleLongTasks"]) {
    if (!Array.isArray(sample[key])) failures.push(`Sample lacks ${key}.`);
    else if (sample[key].some((entry) => !validLongTask(entry))) failures.push(`${key} contained an invalid entry.`);
  }
  if (Array.isArray(sample.observedLongTasks) && Array.isArray(sample.actionIntervals)) {
    const qualifying = sample.observedLongTasks.filter((entry) =>
      sample.actionIntervals.some((interval) =>
        intervalsOverlap(entry.startTime, entry.startTime + entry.duration, interval.startedAt, interval.completedAt),
      ),
    );
    const postSettle = sample.observedLongTasks.filter((entry) =>
      intervalsOverlap(
        entry.startTime,
        entry.startTime + entry.duration,
        sample.semanticCompletedAt,
        sample.observationCompletedAt,
      ),
    );
    if (stableJson(sample.qualifyingLongTasks) !== stableJson(qualifying)) {
      failures.push("Qualifying Long Tasks do not rederive from exact action intervals.");
    }
    if (stableJson(sample.postSettleLongTasks) !== stableJson(postSettle)) {
      failures.push("Post-settle Long Tasks do not rederive from the observation interval.");
    }
  }
  for (const [counter, limit, label] of COUNTER_LIMITS) {
    if (!nonnegativeInteger(sample[counter])) failures.push(`Sample lacks ${label}.`);
    else if (sample[counter] > action[limit]) failures.push(`${sample.actionId} used ${sample[counter]} ${label}; limit ${action[limit]}.`);
  }
  for (const counter of ["allPackIndexReadCount", "allPackDocumentReadCount"]) {
    if (!nonnegativeInteger(sample[counter])) failures.push(`Sample lacks diagnostic ${counter}.`);
  }
  if (sample.actionId === "preview-change") {
    if (
      !nonempty(outcome?.targetSourceUuid) ||
      outcome.targetSourceUuid !== outcome?.visiblePreviewSourceUuid
    ) {
      failures.push("Preview change did not record the exact visible target identity.");
    }
    if (sample.newPreviewHydrationCount !== action.newPreviewHydrations) {
      failures.push(`New preview hydrated ${sample.newPreviewHydrationCount} time(s); expected ${action.newPreviewHydrations}.`);
    }
    if (sample.repeatPreviewHydrationCount !== action.repeatPreviewHydrations) {
      failures.push(`Unchanged preview hydrated ${sample.repeatPreviewHydrationCount} time(s); expected ${action.repeatPreviewHydrations}.`);
    }
  }
  return failures;
}

export function validateEquipmentResultWindowObservation(observation, profile) {
  const failures = [];
  const windowProfile = profile.resultWindowProfiles?.find(
    (entry) => entry.id === observation?.resultWindowProfileId,
  );
  if (!windowProfile) return [`Unknown equipment result-window profile ${observation?.resultWindowProfileId ?? "<missing>"}.`];
  if (observation?.schemaVersion !== 3) failures.push("Equipment result-window observation requires schemaVersion 3.");
  const expectedViewport = resultWindowBrowserViewport(profile, windowProfile);
  if (stableJson(observation?.browserViewport) !== stableJson(expectedViewport)) {
    failures.push(`${windowProfile.id} result-window observation used the wrong browser viewport.`);
  }
  if (observation?.requestedAppWidth !== profile.resultWindowSampling.appWidth) {
    failures.push(`${windowProfile.id} result-window observation used the wrong application width.`);
  }
  if (observation?.requestedAppHeight !== windowProfile.appHeight) {
    failures.push(`${windowProfile.id} result-window observation used the wrong application height.`);
  }
  if (
    !nonnegativeFinite(observation?.actualAppWidth) ||
    Math.abs(observation.actualAppWidth - observation.requestedAppWidth) > 2
  ) {
    failures.push(`${windowProfile.id} result-window application width did not match its request.`);
  }
  if (
    !nonnegativeFinite(observation?.actualAppHeight) ||
    Math.abs(observation.actualAppHeight - observation.requestedAppHeight) > 2
  ) {
    failures.push(`${windowProfile.id} result-window application height did not match its request.`);
  }
  if (!nonnegativeFinite(observation?.listClientHeight) || observation.listClientHeight <= 0) {
    failures.push(`${windowProfile.id} result-window list height is missing or invalid.`);
  }
  const expectedMountedRows = expectedEquipmentMountedRows(profile, observation);
  if (!nonnegativeInteger(expectedMountedRows)) {
    failures.push(`${windowProfile.id} result-window could not derive mounted rows from live geometry.`);
  }
  if (
    observation?.mountedResultCount !== expectedMountedRows ||
    observation?.resultLimit !== expectedMountedRows ||
    observation?.resultOffset !== 0 ||
    observation?.resultEnd !== expectedMountedRows ||
    observation?.firstMountedResultIndex !== 0 ||
    observation?.lastMountedResultIndex !== expectedMountedRows - 1
  ) {
    failures.push(
      `${windowProfile.id} result-window observation did not mount the geometry-derived 0-${expectedMountedRows - 1} window.`,
    );
  }
  if (observation?.totalResultCount !== profile.expectedCatalogueCounts?.defaultShelf) {
    failures.push(`${windowProfile.id} result-window total disagreed with the frozen default-shelf count.`);
  }
  const values = observation?.mountedResultValues;
  if (
    !Array.isArray(values) ||
    values.length !== expectedMountedRows ||
    values.some((value) => !nonempty(value)) ||
    !sameStrings(
      values?.slice(0, profile.expectedDefaultShelfValues.length) ?? [],
      profile.expectedDefaultShelfValues,
    ) ||
    observation?.firstMountedSourceUuid !== values?.[0] ||
    observation?.lastMountedSourceUuid !== values?.at(-1)
  ) {
    failures.push(`${windowProfile.id} result-window mounted identities were incomplete or drifted.`);
  }
  if (!nonnegativeFinite(observation?.leadingSpacerPx) || !nearlyEqual(observation.leadingSpacerPx, 0)) {
    failures.push(`${windowProfile.id} result-window leading spacer was not the exact top-of-list zero.`);
  }
  if (!nonnegativeFinite(observation?.trailingSpacerPx) || observation.trailingSpacerPx <= 0) {
    failures.push(`${windowProfile.id} result-window trailing spacer did not preserve the unmounted catalogue extent.`);
  }
  const resultDomLimit =
    expectedMountedRows * profile.budgets.maxResultDomElementsPerMountedRow +
    profile.budgets.maxResultChromeDomElementCount;
  if (
    resultDomLimit > profile.budgets.maxAdaptiveResultDomElementCount ||
    !nonnegativeInteger(observation?.resultDomElementCount) ||
    observation.resultDomElementCount > resultDomLimit
  ) {
    failures.push(`${windowProfile.id} result-window DOM exceeded its ${resultDomLimit}-element mounted-window limit.`);
  }
  const rootDomLimit = resultDomLimit + profile.budgets.maxNonResultChromeDomElementCount;
  if (!nonnegativeInteger(observation?.domElementCount) || observation.domElementCount > rootDomLimit) {
    failures.push(`${windowProfile.id} root DOM exceeded its ${rootDomLimit}-element size-specific limit.`);
  }
  if (expectedMountedRows > profile.budgets.maxMountedResultCount) {
    failures.push(`${windowProfile.id} result-window exceeded the frozen mounted-row budget.`);
  }
  return failures;
}

export function validateEquipmentResultWindows(profile, observations) {
  const failures = [];
  const expectedKeys = new Set();
  for (const windowProfile of profile.resultWindowProfiles ?? []) {
    for (let index = 1; index <= profile.resultWindowSampling?.observationsPerProfile; index += 1) {
      expectedKeys.add(`${windowProfile.id}|${index}`);
    }
  }
  const observedKeys = new Set();
  for (const observation of observations ?? []) {
    const key = `${observation?.resultWindowProfileId}|${observation?.observationIndex}`;
    if (!expectedKeys.has(key)) failures.push(`Result-window evidence contains out-of-scenario observation ${key}.`);
    if (observedKeys.has(key)) failures.push(`Result-window evidence duplicates observation ${key}.`);
    observedKeys.add(key);
    failures.push(...validateEquipmentResultWindowObservation(observation, profile));
  }
  for (const key of expectedKeys) {
    if (!observedKeys.has(key)) failures.push(`Result-window evidence is missing observation ${key}.`);
  }
  const ordered = (observations ?? [])
    .filter((entry) => profile.resultWindowProfiles?.some((profileEntry) => profileEntry.id === entry.resultWindowProfileId))
    .sort(
      (left, right) =>
        profile.resultWindowProfiles.findIndex((entry) => entry.id === left.resultWindowProfileId) -
        profile.resultWindowProfiles.findIndex((entry) => entry.id === right.resultWindowProfileId),
    );
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].actualAppHeight <= ordered[index - 1].actualAppHeight) {
      failures.push("Result-window application heights did not grow in profile order.");
    }
    if (ordered[index].listClientHeight <= ordered[index - 1].listClientHeight) {
      failures.push("Result-window list heights did not grow in profile order.");
    }
  }
  return failures;
}

export function validateEquipmentScrollProbe(profile, probe) {
  const failures = [];
  const windowProfile = profile.resultWindowProfiles?.find(
    (entry) => entry.id === profile.scrollSampling?.resultWindowProfileId,
  );
  if (probe?.schemaVersion !== 3) failures.push("Equipment pending-prefetch scroll probe requires schemaVersion 3.");
  if (!windowProfile || probe?.resultWindowProfileId !== windowProfile.id) {
    failures.push("Equipment pending-prefetch scroll probe used the wrong result-window profile.");
    return failures;
  }
  if (stableJson(probe?.browserViewport) !== stableJson(resultWindowBrowserViewport(profile, windowProfile))) {
    failures.push("Equipment pending-prefetch scroll probe used the wrong browser viewport.");
  }
  if (
    probe?.requestedAppWidth !== profile.resultWindowSampling.appWidth ||
    probe?.requestedAppHeight !== windowProfile.appHeight
  ) {
    failures.push("Equipment pending-prefetch scroll probe used the wrong application size.");
  }
  if (
    !nonnegativeFinite(probe?.requestedScrollDeltaPx) ||
    probe.requestedScrollDeltaPx <= 0 ||
    !nonnegativeFinite(probe?.observedScrollDeltaPx) ||
    probe.observedScrollDeltaPx + 2 < probe.requestedScrollDeltaPx ||
    probe?.rapidFullScreenScrollCount !== profile.scrollSampling.rapidFullScreenScrollsWhilePending
  ) {
    failures.push("Equipment pending-prefetch probe did not perform the exact full-screen scroll while pending.");
  }
  if (
    !nonnegativeInteger(probe?.pendingBeforeRapidScroll) ||
    probe.pendingBeforeRapidScroll < 1 ||
    !nonnegativeInteger(probe?.pendingAfterRapidScroll) ||
    probe.pendingAfterRapidScroll < 1 ||
    !nonnegativeInteger(probe?.maxPendingDocumentReads) ||
    probe.maxPendingDocumentReads < probe.pendingBeforeRapidScroll ||
    probe?.pendingAfterSettle !== 0
  ) {
    failures.push("Equipment scroll probe did not prove a prior prefetch stayed pending through the rapid scroll and settled.");
  }
  if (
    probe?.initialWindow?.mountedResultCount !== expectedEquipmentMountedRows(profile, probe?.initialWindow) ||
    !nonnegativeInteger(probe?.initialWindow?.resultOffset) ||
    !nonnegativeInteger(probe?.settledWindow?.resultOffset) ||
    probe.settledWindow.resultOffset <= probe.initialWindow.resultOffset
  ) {
    failures.push("Equipment scroll probe did not advance from the declared mounted window.");
  }
  const rawPendingShelves = probe?.shelvesWhilePending;
  const pendingShelves = Array.isArray(rawPendingShelves) ? rawPendingShelves : [];
  const shelves = [...pendingShelves, probe?.settledShelf].filter(Boolean);
  if (
    !Array.isArray(rawPendingShelves) ||
    pendingShelves.length !== profile.scrollSampling.framesWhilePending ||
    shelves.some(
      (shelf) =>
        !nonnegativeFinite(shelf?.viewportHeight) ||
        shelf.viewportHeight <= 0 ||
        !nonnegativeInteger(shelf?.visibleResultCount) ||
        !nonnegativeInteger(shelf?.visibleSkeletonCount) ||
        shelf.visibleResultCount + shelf.visibleSkeletonCount < 1 ||
        !nonnegativeFinite(shelf?.maxVisibleGapPx) ||
        shelf.maxVisibleGapPx > profile.scrollSampling.maxVisibleGapPx ||
        shelf.skeletonContractValid !== true,
    )
  ) {
    failures.push("Equipment scroll probe exposed an empty shelf or visible result gap.");
  }
  if (
    !Array.isArray(probe?.shelvesWhilePending) ||
    probe.shelvesWhilePending.some((shelf) => shelf?.pendingDocumentReads < 1) ||
    probe?.settledShelf?.pendingDocumentReads !== 0
  ) {
    failures.push("Equipment scroll shelf observations did not remain bound to pending and settled prefetch state.");
  }
  return failures;
}

export function validateEquipmentPartialRenderRecoveryProbe(profile, probe) {
  const failures = [];
  const windowProfile = profile.resultWindowProfiles?.find(
    (entry) => entry.id === profile.partialRenderRecoverySampling?.resultWindowProfileId,
  );
  if (probe?.schemaVersion !== 3) failures.push("Equipment partial-render recovery probe requires schemaVersion 3.");
  if (!windowProfile || probe?.resultWindowProfileId !== windowProfile.id) {
    failures.push("Equipment partial-render recovery probe used the wrong result-window profile.");
    return failures;
  }
  if (stableJson(probe?.browserViewport) !== stableJson(resultWindowBrowserViewport(profile, windowProfile))) {
    failures.push("Equipment partial-render recovery probe used the wrong browser viewport.");
  }
  if (
    probe?.requestedAppWidth !== profile.resultWindowSampling.appWidth ||
    probe?.requestedAppHeight !== windowProfile.appHeight
  ) {
    failures.push("Equipment partial-render recovery probe used the wrong application size.");
  }
  if (
    probe?.forcedRejectionCount !== profile.partialRenderRecoverySampling.forcedRejections ||
    probe?.forcedRejectionStage !== "post-context-preparation" ||
    probe?.recoveryFullRenderCount !== 1 ||
    probe?.successfulRetryEquipmentRenderCount !== 1
  ) {
    failures.push(
      "Equipment partial-render recovery probe did not force exactly one post-context rejection, full recovery, and retry render.",
    );
  }
  const initial = probe?.initialState;
  const pending = probe?.rejectionPendingState;
  const recovered = probe?.recoveredState;
  const retry = probe?.retryState;
  const initialValues = initial?.window?.mountedResultValues;
  if (
    !Array.isArray(initialValues) ||
    initialValues.length !== expectedEquipmentMountedRows(profile, initial?.window) ||
    initial?.window?.resultOffset !== 0 ||
    initial?.window?.totalResultCount !== profile.expectedCatalogueCounts?.defaultShelf ||
    !sameStrings(initialValues, profile.expectedDefaultShelfValues)
  ) {
    failures.push("Equipment partial-render recovery probe did not start from the exact committed default shelf.");
  }
  if (
    pending?.ariaBusy !== true ||
    typeof pending?.skeletonHidden !== "boolean" ||
    !nonnegativeInteger(pending?.skeletonCount) ||
    (pending.skeletonHidden ? pending.skeletonCount !== 0 : pending.skeletonCount < 1) ||
    !sameStrings(pending?.window?.mountedResultValues ?? [], initialValues ?? []) ||
    pending?.window?.resultOffset !== initial?.window?.resultOffset ||
    pending?.focusedSourceUuid !== initialValues?.[0]
  ) {
    failures.push("Rejected equipment partial render did not preserve committed rows and focus in a coherent busy state.");
  }
  if (
    recovered?.ariaBusy !== false ||
    recovered?.skeletonHidden !== true ||
    recovered?.skeletonCount !== 0 ||
    !sameStrings(recovered?.window?.mountedResultValues ?? [], initialValues ?? []) ||
    recovered?.window?.resultOffset !== initial?.window?.resultOffset ||
    recovered?.focusedSourceUuid !== initialValues?.[0]
  ) {
    failures.push("Equipment partial-render recovery did not restore the committed shelf, focus, and idle state.");
  }
  const retryValues = retry?.window?.mountedResultValues;
  const expectedRetryOffset = profile.resultWindowSizing?.hydrationChunkRows;
  const expectedRetryRows = expectedEquipmentMountedRows(profile, retry?.window);
  const frozenRetryValues = profile.expectedDefaultShelfValues.slice(
    expectedRetryOffset,
    Math.min(profile.expectedDefaultShelfValues.length, expectedRetryOffset + (expectedRetryRows ?? 0)),
  );
  if (
    retry?.ariaBusy !== false ||
    retry?.skeletonHidden !== true ||
    retry?.skeletonCount !== 0 ||
    !Array.isArray(retryValues) ||
    expectedRetryRows === null ||
    retryValues.length !== expectedRetryRows ||
    retry?.window?.totalResultCount !== profile.expectedCatalogueCounts?.defaultShelf ||
    retry?.window?.resultLimit !== expectedRetryRows ||
    retry?.window?.mountedResultCount !== expectedRetryRows ||
    retry?.window?.resultOffset !== expectedRetryOffset ||
    retry?.window?.resultEnd !== expectedRetryOffset + expectedRetryRows ||
    retry?.window?.firstMountedResultIndex !== expectedRetryOffset ||
    retry?.window?.lastMountedResultIndex !== expectedRetryOffset + expectedRetryRows - 1 ||
    retry?.window?.firstMountedSourceUuid !== retryValues[0] ||
    retry?.window?.lastMountedSourceUuid !== retryValues.at(-1) ||
    retryValues.some((value) => !nonempty(value)) ||
    !sameStrings(retryValues.slice(0, frozenRetryValues.length), frozenRetryValues)
  ) {
    failures.push("Equipment partial-render retry did not preserve its exact advanced window and clear loading state.");
  }
  return failures;
}

export function resultWindowBrowserViewport(profile, windowProfile) {
  return {
    width: profile.viewport.width,
    height: Math.max(
      profile.viewport.height,
      windowProfile.appHeight + profile.resultWindowSampling.browserViewportPaddingPx,
    ),
  };
}

export function expectedEquipmentMountedRows(profile, geometry) {
  const listHeight = geometry?.listClientHeight;
  const rowHeight = geometry?.measuredRowHeightPx;
  if (!nonnegativeFinite(listHeight) || listHeight <= 0 || !nonnegativeFinite(rowHeight) || rowHeight <= 0) return null;
  const visibleRows = Math.ceil(listHeight / rowHeight);
  const sizing = profile.resultWindowSizing;
  const target = Math.max(
    sizing.baselineMountedRows,
    Math.ceil(visibleRows * sizing.viewportMultiplier),
    visibleRows + sizing.overscanRows,
  );
  return Math.min(
    sizing.maximumMountedRows,
    Math.ceil(target / sizing.hydrationChunkRows) * sizing.hydrationChunkRows,
  );
}

function validateSampleTiming(sample, profile) {
  const failures = [];
  const intervals = sample?.actionIntervals;
  const expectedKinds =
    sample?.actionId === "preview-change"
      ? ["preview-new", "preview-repeat"]
      : sample?.actionId === "rapid-search"
        ? ["rapid-final-query"]
        : [sample?.actionId];
  if (!Array.isArray(intervals) || stableJson(intervals.map((entry) => entry?.kind)) !== stableJson(expectedKinds)) {
    return [`${sample?.actionId ?? "Sample"} lacks its exact ordered primary action intervals.`];
  }
  if (
    !nonnegativeFinite(sample.sampleStartedAt) ||
    !nonnegativeFinite(sample.semanticCompletedAt) ||
    !nonnegativeFinite(sample.observationCompletedAt) ||
    sample.observationCompletedAt - sample.semanticCompletedAt < profile.postSettleMs
  ) {
    failures.push("Sample timing boundaries are missing, invalid, out of order, or omit the post-settle window.");
  }
  for (const [index, interval] of intervals.entries()) {
    if (
      !nonnegativeFinite(interval?.startedAt) ||
      !nonnegativeFinite(interval?.completedAt) ||
      interval.completedAt < interval.startedAt ||
      interval.startedAt < sample.sampleStartedAt ||
      (index > 0 && interval.startedAt < intervals[index - 1].completedAt)
    ) {
      failures.push(`${interval?.kind ?? "Action"} timing boundaries are invalid or out of order.`);
    }
  }
  const durations = intervals.map((interval) => interval.completedAt - interval.startedAt);
  const expectedDuration = Math.max(...durations);
  if (!nonnegativeFinite(sample.durationMs) || !nearlyEqual(sample.durationMs, expectedDuration)) {
    failures.push("Primary duration does not rederive from the exact action interval(s).");
  }
  if (
    !nonnegativeFinite(sample.combinedDurationMs) ||
    !nearlyEqual(sample.combinedDurationMs, sample.semanticCompletedAt - sample.sampleStartedAt)
  ) {
    failures.push("Combined diagnostic duration does not rederive from the sample boundaries.");
  }
  if (!nearlyEqual(sample.semanticCompletedAt, intervals.at(-1)?.completedAt)) {
    failures.push("Semantic completion does not match the final primary interval.");
  }
  if (sample.actionId === "rapid-search") {
    const finalInterval = intervals[0];
    const minimumPrefixDelay = profile.keyDelayMs * (profile.querySequence.length - 1);
    if (
      !nonnegativeFinite(sample.typingStartedAt) ||
      sample.typingStartedAt > finalInterval.startedAt ||
      finalInterval.startedAt - sample.typingStartedAt < minimumPrefixDelay ||
      !nonnegativeFinite(sample.endToEndTypingDurationMs) ||
      !nearlyEqual(sample.endToEndTypingDurationMs, sample.semanticCompletedAt - sample.typingStartedAt) ||
      sample.endToEndTypingDurationMs < sample.durationMs
    ) {
      failures.push("Rapid-search primary and end-to-end typing timings do not rederive from the final input boundary.");
    }
  } else if (sample.typingStartedAt !== null || sample.endToEndTypingDurationMs !== null) {
    failures.push("Non-search samples must not report typing diagnostics.");
  }
  if (sample.actionId === "preview-change") {
    const [fresh, repeated] = intervals;
    if (
      !nearlyEqual(sample.newPreviewDurationMs, fresh.completedAt - fresh.startedAt) ||
      !nearlyEqual(sample.repeatPreviewDurationMs, repeated.completedAt - repeated.startedAt) ||
      !nearlyEqual(sample.combinedPreviewDurationMs, repeated.completedAt - fresh.startedAt) ||
      sample.combinedPreviewDurationMs < sample.newPreviewDurationMs + sample.repeatPreviewDurationMs ||
      typeof sample.repeatPreviewRenderScheduled !== "boolean" ||
      sample.repeatPreviewDetailReplaced !== sample.repeatPreviewRenderScheduled
    ) {
      failures.push("Preview primary and combined diagnostic timings do not rederive from the split intervals.");
    }
  }
  return failures;
}

export function percentile(values, quantile) {
  const sorted = values.filter(nonnegativeFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export function summarizeEquipmentProfile(profile, samples) {
  const measured = samples.filter((sample) => sample.sampleKind === "measured");
  const byActionWidth = profile.actions.flatMap((action) =>
    profile.appWidths.map((requestedAppWidth) => {
      const selected = measured.filter(
        (sample) => sample.actionId === action.id && sample.requestedAppWidth === requestedAppWidth
      );
      const durations = selected.map((sample) => sample.durationMs);
      return {
        actionId: action.id,
        requestedAppWidth,
        sampleCount: selected.length,
        failedSampleCount: selected.filter((sample) => (sample.failures ?? []).length > 0).length,
        p50Ms: percentile(durations, 0.5),
        p75Ms: percentile(durations, 0.75),
        p95Ms: percentile(durations, 0.95),
        maxDomElementCount: maximum(selected, "domElementCount"),
        maxResultDomElementCount: maximum(selected, "resultDomElementCount"),
        maxImageRequestsPerSample: maximum(selected, "imageRequestCount"),
        longTaskCount: selected.reduce((total, sample) => total + (sample.qualifyingLongTasks?.length ?? 0), 0),
        observedLongTaskCount: selected.reduce((total, sample) => total + (sample.observedLongTasks?.length ?? 0), 0),
        postSettleLongTaskCount: selected.reduce((total, sample) => total + (sample.postSettleLongTasks?.length ?? 0), 0),
        endToEndTypingDiagnosticP50Ms:
          action.id === "rapid-search"
            ? percentile(
                selected.map((sample) => sample.endToEndTypingDurationMs),
                0.5,
              )
            : null,
        endToEndTypingDiagnosticP75Ms:
          action.id === "rapid-search"
            ? percentile(
                selected.map((sample) => sample.endToEndTypingDurationMs),
                0.75,
              )
            : null,
        endToEndTypingDiagnosticP95Ms:
          action.id === "rapid-search"
            ? percentile(
                selected.map((sample) => sample.endToEndTypingDurationMs),
                0.95,
              )
            : null,
        newPreviewP50Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.newPreviewDurationMs),
                0.5,
              )
            : null,
        newPreviewP75Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.newPreviewDurationMs),
                0.75,
              )
            : null,
        newPreviewP95Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.newPreviewDurationMs),
                0.95,
              )
            : null,
        repeatPreviewP50Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.repeatPreviewDurationMs),
                0.5,
              )
            : null,
        repeatPreviewP75Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.repeatPreviewDurationMs),
                0.75,
              )
            : null,
        repeatPreviewP95Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.repeatPreviewDurationMs),
                0.95,
              )
            : null,
        combinedPreviewDiagnosticP50Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.combinedPreviewDurationMs),
                0.5,
              )
            : null,
        combinedPreviewDiagnosticP75Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.combinedPreviewDurationMs),
                0.75,
              )
            : null,
        combinedPreviewDiagnosticP95Ms:
          action.id === "preview-change"
            ? percentile(
                selected.map((sample) => sample.combinedPreviewDurationMs),
                0.95,
              )
            : null,
      };
    })
  );
  return {
    measuredSampleCount: measured.length,
    failedSampleCount: samples.filter((sample) => (sample.failures ?? []).length > 0).length,
    p50Ms: percentile(measured.map((sample) => sample.durationMs), 0.5),
    p75Ms: percentile(measured.map((sample) => sample.durationMs), 0.75),
    p95Ms: percentile(measured.map((sample) => sample.durationMs), 0.95),
    byActionWidth,
  };
}

export function validateEquipmentBudgets(profile, summary, options = {}) {
  const failures = Array.isArray(options.resultWindowObservations)
    ? validateEquipmentResultWindows(profile, options.resultWindowObservations)
    : [];
  if (options.scrollProbe !== undefined) failures.push(...validateEquipmentScrollProbe(profile, options.scrollProbe));
  if (options.partialRenderRecoveryProbe !== undefined) {
    failures.push(...validateEquipmentPartialRenderRecoveryProbe(profile, options.partialRenderRecoveryProbe));
  }
  const required = options.requireQualificationSamples === false ? null : profile.measuredSamplesPerActionWidth;
  for (const row of summary.byActionWidth ?? []) {
    const label = `${row.actionId} at ${row.requestedAppWidth}px`;
    if (required !== null && row.sampleCount !== required) failures.push(`${label} recorded ${row.sampleCount} measured samples; expected ${required}.`);
    if (row.failedSampleCount > 0) failures.push(`${label} had ${row.failedSampleCount} semantic/counter failure(s).`);
    if (!nonnegativeFinite(row.p95Ms) || row.p95Ms > profile.budgets.maxP95MsPerActionWidth) failures.push(`${label} p95 exceeded ${profile.budgets.maxP95MsPerActionWidth}ms.`);
    if (
      row.actionId === "preview-change" &&
      (!nonnegativeFinite(row.newPreviewP95Ms) || row.newPreviewP95Ms > profile.budgets.maxP95MsPerActionWidth)
    ) {
      failures.push(`${label} new-preview p95 exceeded ${profile.budgets.maxP95MsPerActionWidth}ms.`);
    }
    if (
      row.actionId === "preview-change" &&
      (!nonnegativeFinite(row.repeatPreviewP95Ms) || row.repeatPreviewP95Ms > profile.budgets.maxP95MsPerActionWidth)
    ) {
      failures.push(`${label} repeat-preview p95 exceeded ${profile.budgets.maxP95MsPerActionWidth}ms.`);
    }
    if (row.maxDomElementCount > profile.budgets.maxDomElementCount) failures.push(`${label} DOM exceeded ${profile.budgets.maxDomElementCount}.`);
    if (row.maxResultDomElementCount > profile.budgets.maxResultDomElementCount) failures.push(`${label} result DOM exceeded ${profile.budgets.maxResultDomElementCount}.`);
    if (row.maxImageRequestsPerSample > profile.budgets.maxImageRequestsPerSample) failures.push(`${label} made image requests.`);
    if (row.longTaskCount > profile.budgets.maxLongTaskCountPerActionWidth) failures.push(`${label} recorded long tasks.`);
  }
  return { passed: failures.length === 0, failures };
}

export function compactEquipmentEvidence(result) {
  return {
    schemaVersion: 3,
    profile: {
      id: result.profile.id,
      viewport: result.profile.viewport,
      appWidths: result.profile.appWidths,
      resultWindowProfiles: result.profile.resultWindowProfiles,
      resultWindowSizing: result.profile.resultWindowSizing,
      resultWindowSampling: result.profile.resultWindowSampling,
      scrollSampling: result.profile.scrollSampling,
      partialRenderRecoverySampling: result.profile.partialRenderRecoverySampling,
      sampleDepth: {
        warmup: result.profile.warmupSamplesPerActionWidth,
        measured: result.profile.measuredSamplesPerActionWidth,
      },
      budgets: result.profile.budgets,
      timingSemantics: result.profile.timingSemantics,
      samplingSemantics: result.profile.samplingSemantics,
      counts: result.fixture.catalogueCounts,
      countSemantics: result.profile.catalogueCountSemantics,
      finalResultValues: result.profile.expectedFinalResultValues,
      defaultShelfValues: result.profile.expectedDefaultShelfValues,
    },
    candidate: result.candidate,
    driver: {
      sha256: result.driver?.sha256,
      inputFileCount: result.driver?.files?.length ?? 0,
    },
    environment: result.environment,
    servedCandidate: servedCandidateSummary(result.servedModuleFiles),
    runtime: result.runtime,
    users: result.fixture.users,
    runIds: [result.runId],
    resultWindowObservations: result.resultWindowObservations,
    scrollProbe: result.scrollProbe,
    partialRenderRecoveryProbe: result.partialRenderRecoveryProbe,
    byActionWidth: result.summary.byActionWidth,
  };
}

export function qualifyEquipmentEvidenceRuns(results) {
  const failures = [];
  if (!Array.isArray(results) || results.length !== 2) {
    return { ok: false, failures: ["Equipment evidence requires exactly two qualified runs."], evidence: null };
  }
  const [first, second] = results;
  const runIds = results.map((result) => result?.runId);
  if (runIds.some((runId) => !nonempty(runId)) || new Set(runIds).size !== results.length) {
    failures.push("Equipment evidence requires two distinct nonempty run ids.");
  }
  for (const [index, result] of results.entries()) {
    const label = `Run ${index + 1}`;
    failures.push(...validateEquipmentProfile(result?.profile).map((failure) => `${label}: ${failure}`));
    failures.push(
      ...validateEquipmentFixture(result?.profile, result?.fixture, result?.runtime?.worldId).map(
        (failure) => `${label}: ${failure}`,
      ),
    );
    if (result?.runMode !== "qualification") failures.push(`${label} is not a qualification-depth run.`);
    if (result?.schemaVersion !== 3) failures.push(`${label} does not use equipment evidence schemaVersion 3.`);
    if (result?.profile?.expectedCatalogueCounts === null) failures.push(`${label} did not freeze live catalogue counts.`);
    failures.push(...deriveQualifiedRun(result, label));
    failures.push(...validateProvenance(result, label));
    if (result?.status !== "completed") failures.push(`${label} is not a completed equipment profile run.`);
    if (!validRunInterval(result?.startedAt, result?.finishedAt)) failures.push(`${label} has an invalid run interval.`);
    if (
      result?.cleanup?.policyRestored !== true ||
      result?.cleanup?.languageUnchanged !== true ||
      result?.cleanup?.actorDeleted !== true ||
      result?.cleanup?.actorMissingAfterCleanup !== true ||
      result?.cleanup?.actorCountAfter !== result?.fixture?.actorCountBefore
    ) {
      failures.push(`${label} did not prove exact actor cleanup and policy restoration.`);
    }
  }
  const actorIds = results.map((result) => result?.fixture?.actorId);
  if (actorIds.some((id) => !nonempty(id)) || new Set(actorIds).size !== results.length) {
    failures.push("Qualified equipment runs require distinct stable fixture actor ids.");
  }
  for (const [index, result] of results.entries()) {
    const expectedName = `WF Equipment Profile - ${result?.profile?.id} - ${result?.runId}`;
    if (result?.fixture?.actorName !== expectedName) {
      failures.push(`Run ${index + 1} fixture actor name does not bind its exact profile and run marker.`);
    }
  }
  if (
    validRunInterval(first?.startedAt, first?.finishedAt) &&
    validRunInterval(second?.startedAt, second?.finishedAt) &&
    Date.parse(first.finishedAt) > Date.parse(second.startedAt)
  ) {
    failures.push("Qualified equipment runs must be independent non-overlapping executions in input order.");
  }
  for (const key of ["profile", "candidate", "runtime", "driver", "environment"]) {
    if (stableJson(first?.[key]) !== stableJson(second?.[key])) failures.push(`Qualified runs disagree on ${key}.`);
  }
  if (stableJson(servedCandidateSummary(first?.servedModuleFiles)) !== stableJson(servedCandidateSummary(second?.servedModuleFiles))) {
    failures.push("Qualified runs disagree on the served candidate manifest.");
  }
  const evidence = failures.length === 0 ? compactEquipmentEvidence(first) : null;
  if (evidence) evidence.runIds = results.map((result) => result.runId);
  return { ok: failures.length === 0, failures, evidence };
}

function deriveQualifiedRun(result, label) {
  const failures = [];
  const profile = result?.profile;
  const samples = Array.isArray(result?.samples) ? result.samples : [];
  const expectedKeys = new Set();
  for (const action of profile?.actions ?? []) {
    for (const width of profile?.appWidths ?? []) {
      for (const [kind, count] of [
        ["warmup", profile.warmupSamplesPerActionWidth],
        ["measured", profile.measuredSamplesPerActionWidth],
      ]) {
        for (let sampleIndex = 1; sampleIndex <= count; sampleIndex += 1) {
          expectedKeys.add(`${action.id}|${width}|${kind}|${sampleIndex}`);
        }
      }
    }
  }
  const observedKeys = new Set();
  for (const sample of samples) {
    const key = `${sample?.actionId}|${sample?.requestedAppWidth}|${sample?.sampleKind}|${sample?.sampleIndex}`;
    if (!expectedKeys.has(key)) failures.push(`${label} contains out-of-scenario sample ${key}.`);
    if (observedKeys.has(key)) failures.push(`${label} duplicates sample ${key}.`);
    observedKeys.add(key);
    const derivedFailures = validateEquipmentSample(sample, profile);
    failures.push(...derivedFailures.map((failure) => `${label} ${key}: ${failure}`));
    if (stableJson(sample?.failures ?? []) !== stableJson(derivedFailures)) {
      failures.push(`${label} stored failures disagree with derived validation for ${key}.`);
    }
  }
  for (const key of expectedKeys) {
    if (!observedKeys.has(key)) failures.push(`${label} is missing sample ${key}.`);
  }
  const observations = Array.isArray(result?.resultWindowObservations) ? result.resultWindowObservations : [];
  for (const observation of observations) {
    const key = `${observation?.resultWindowProfileId}|${observation?.observationIndex}`;
    const derivedFailures = validateEquipmentResultWindowObservation(observation, profile);
    if (stableJson(observation?.failures ?? []) !== stableJson(derivedFailures)) {
      failures.push(`${label} stored failures disagree with derived validation for result-window ${key}.`);
    }
  }
  const scrollFailures = validateEquipmentScrollProbe(profile, result?.scrollProbe);
  if (stableJson(result?.scrollProbe?.failures ?? []) !== stableJson(scrollFailures)) {
    failures.push(`${label} stored failures disagree with derived validation for the pending-prefetch scroll probe.`);
  }
  const recoveryFailures = validateEquipmentPartialRenderRecoveryProbe(
    profile,
    result?.partialRenderRecoveryProbe,
  );
  if (stableJson(result?.partialRenderRecoveryProbe?.failures ?? []) !== stableJson(recoveryFailures)) {
    failures.push(`${label} stored failures disagree with derived validation for the partial-render recovery probe.`);
  }
  const summary = summarizeEquipmentProfile(profile, samples);
  const qualification = validateEquipmentBudgets(profile, summary, {
    resultWindowObservations: observations,
    scrollProbe: result?.scrollProbe,
    partialRenderRecoveryProbe: result?.partialRenderRecoveryProbe,
  });
  if (stableJson(result?.summary) !== stableJson(summary)) failures.push(`${label} stored summary disagrees with raw samples.`);
  if (stableJson(result?.qualification) !== stableJson(qualification)) {
    failures.push(`${label} stored qualification disagrees with raw samples.`);
  }
  if (!qualification.passed) failures.push(`${label} did not pass its action-width budgets.`);
  return failures;
}

function validateProvenance(result, label) {
  const failures = [];
  const candidate = result?.candidate;
  if (!/^[0-9a-f]{40}$/i.test(candidate?.gitSha ?? "") || !nonempty(candidate?.gitDescribe)) {
    failures.push(`${label} has malformed candidate provenance.`);
  }
  if (candidate?.requestedRef !== null && !nonempty(candidate?.requestedRef)) {
    failures.push(`${label} candidate requestedRef must be null or nonempty.`);
  }
  if (!Array.isArray(candidate?.dirtyPaths) || candidate.dirtyPaths.length !== 0) {
    failures.push(`${label} candidate must record an exact empty dirtyPaths array.`);
  }
  const files = result?.driver?.files;
  if (
    !Array.isArray(files) ||
    stableJson(files.map((entry) => entry?.path)) !== stableJson(FROZEN_DRIVER_PATHS) ||
    files.some((entry) => !/^[0-9a-f]{64}$/i.test(entry?.sha256 ?? "")) ||
    new Set(files?.map((entry) => entry.path)).size !== FROZEN_DRIVER_PATHS.length
  ) {
    failures.push(`${label} has malformed or incomplete driver file provenance.`);
  } else {
    const aggregate = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    if (result.driver.sha256 !== aggregate) failures.push(`${label} driver aggregate hash is not rederivable.`);
  }
  const environment = result?.environment;
  if (
    !nonempty(environment?.browserVersion) ||
    !nonempty(environment?.nodeVersion) ||
    !nonempty(environment?.os?.platform) ||
    !nonempty(environment?.os?.release) ||
    !nonempty(environment?.os?.arch) ||
    !nonempty(environment?.cpu?.model) ||
    !Number.isInteger(environment?.cpu?.logicalProcessorCount) ||
    environment.cpu.logicalProcessorCount < 1
  ) {
    failures.push(`${label} has malformed environment provenance.`);
  }
  if (stableJson(result?.runtime) !== stableJson(result?.fixture?.runtime)) {
    failures.push(`${label} top-level runtime disagrees with the live fixture runtime.`);
  }
  const served = result?.servedModuleFiles;
  if (
    !Array.isArray(served) ||
    served.length === 0 ||
    served.some(
      (entry) =>
        !safeRelativePath(entry?.path) ||
        !Number.isInteger(entry?.bytes) ||
        entry.bytes < 0 ||
        !/^[0-9a-f]{64}$/i.test(entry?.sha256 ?? "") ||
        !Number.isInteger(entry?.requests) ||
        entry.requests < 1,
    ) ||
    new Set(served?.map((entry) => entry.path)).size !== served.length
  ) {
    failures.push(`${label} has malformed or empty served-candidate provenance.`);
  }
  return failures;
}

function servedCandidateSummary(files) {
  const canonical = (Array.isArray(files) ? files : [])
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    .sort((left, right) => String(left.path).localeCompare(String(right.path)));
  return {
    fileCount: canonical.length,
    totalBytes: canonical.reduce((total, entry) => total + (Number.isInteger(entry.bytes) ? entry.bytes : 0), 0),
    manifestSha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

function safeRelativePath(value) {
  return nonempty(value) && !value.startsWith("/") && !value.startsWith("\\") && !value.includes("..") && !/^[a-z]:/i.test(value);
}

export { REQUIRED_ACTIONS };

function validGrowingPrefixes(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !nonempty(value))) return false;
  return values.slice(1).every((value, index) => value.startsWith(values[index]) && value.length > values[index].length);
}

function validCatalogueCounts(value) {
  return ["indexed", "levelQualified", "defaultShelf", "matching", "visible"].every(
    (key) => Number.isInteger(value?.[key]) && value[key] > 0,
  );
}

function maximum(values, key) {
  return Math.max(0, ...values.map((value) => (nonnegativeFinite(value[key]) ? value[key] : 0)));
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function nonnegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.000_001;
}

function validLongTask(entry) {
  return nonnegativeFinite(entry?.startTime) && nonnegativeFinite(entry?.duration);
}

function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return [leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite) && leftStart < rightEnd && leftEnd > rightStart;
}

function validRunInterval(startedAt, finishedAt) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  return Number.isFinite(start) && Number.isFinite(finish) && finish > start;
}

function sameStrings(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
