/* global document, game, MutationObserver, requestAnimationFrame */

const ROOT_SELECTOR = ".wayfinder-app";
const SEARCH_SELECTOR = "[data-wayfinder-equipment-search]";
const RESULT_SELECTOR = ".equipment-result-list .equipment-result";
const PACK_ID = "pf2e.equipment-srd";
const MODULE_ID = "wayfinder-pf2e";
const SPRAY_PELLETS_SOURCE_UUID = "Compendium.pf2e.equipment-srd.Item.qaAQnuLVia6vS1LU";

let actorId = null;
let counters = null;
let configured = false;
let readyDraftSnapshot = null;

globalThis.__wayfinderEquipmentProfile = {
  async configure(payload) {
    actorId = payload.actorId;
    counters ??= freshCounters();
    if (!configured) {
      instrumentPacks();
      await instrumentAppPrototype();
      configured = true;
    }
    return snapshot();
  },

  async initializeWorkspace({ settleTimeoutMs }) {
    const root = currentRoot();
    const start = root.querySelector('[data-wayfinder-action="initialize-starting-equipment"]');
    if (start) {
      start.click();
      await waitUntil(() => currentRoot().querySelector('[data-wayfinder-action="activate-equipment-policy"]'), settleTimeoutMs);
    }
    const activate = currentRoot().querySelector(
      '[data-wayfinder-action="activate-equipment-policy"][data-start-kind="replacement-character"]',
    );
    if (activate) {
      activate.click();
      await waitUntil(() => currentRoot().querySelector(SEARCH_SELECTOR), settleTimeoutMs);
    }
    await ensureSprayPelletsCart(settleTimeoutMs);
    await reopen(false, settleTimeoutMs);
    readyDraftSnapshot = structuredClone(game.actors.get(actorId)?.getFlag(MODULE_ID, "draft") ?? null);
    if (!readyDraftSnapshot?.acquisition?.policySnapshot || readyDraftSnapshot.acquisition.lines.length < 1) {
      throw new Error("Equipment profile could not capture the durable ready-cart fixture.");
    }
    return snapshot();
  },

  async resize({ width }) {
    const app = currentApp();
    app.setPosition?.({ width });
    if (!app.setPosition) app.element.style.width = `${width}px`;
    await frames(2);
    return currentRoot().getBoundingClientRect().width;
  },

  async discoverCatalogueCounts({ finalResultValues, querySequence, settleTimeoutMs }) {
    const actor = game.actors.get(actorId);
    const draft = structuredClone(actor?.getFlag(MODULE_ID, "draft") ?? null);
    if (!actor || !draft?.acquisition?.policySnapshot) {
      throw new Error("Equipment count discovery requires the ready durable draft.");
    }
    const [adapterModule, stepModule] = await Promise.all([
      import("/modules/wayfinder-pf2e/scripts/wayfinder/application/starting-equipment-ui-adapter.js"),
      import("/modules/wayfinder-pf2e/scripts/wayfinder/domain/step-types.js"),
    ]);
    const adapter = adapterModule.getStartingEquipmentUiAdapter();
    const step = stepModule.createStartingEquipmentStep(draft.targetLevel);
    const request = {
      actor,
      draft,
      step,
      filters: {},
      previewSourceUuid: null,
    };
    const emptyProjection = await adapter.project({ ...request, query: "" });
    if (emptyProjection.state !== "ready" || (emptyProjection.diagnostics?.length ?? 0) > 0) {
      throw new Error("Equipment count discovery found a non-ready or unhealthy empty projection.");
    }
    const levelQualifiedMatch = /^(\d+) pieces? of gear to browse\.$/.exec(emptyProjection.message);
    if (!levelQualifiedMatch) throw new Error("Equipment count discovery could not parse the runtime projection size.");
    const finalQuery = querySequence.at(-1);
    const finalProjection = await adapter.project({ ...request, query: finalQuery });
    if (finalProjection.state !== "ready" || (finalProjection.diagnostics?.length ?? 0) > 0) {
      throw new Error("Equipment count discovery found a non-ready or unhealthy final projection.");
    }
    const matchingValues = finalProjection.records.map((entry) => entry.sourceUuid);
    if (matchingValues.length >= 12 || !sameStrings(matchingValues, finalResultValues)) {
      throw new Error("Equipment count discovery final identities drifted from the profile.");
    }
    const rawIndex = await game.packs.get(PACK_ID).getIndex();
    const input = currentSearch();
    input.value = querySequence.at(-1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitUntil(() => sameStrings(visibleResultValues(), finalResultValues), settleTimeoutMs);
    const filtered = snapshot();
    const counts = {
      indexed: Number(rawIndex?.size ?? rawIndex?.length ?? 0),
      levelQualified: Number(levelQualifiedMatch[1]),
      matching: matchingValues.length,
      visible: filtered.visibleResultCount,
    };
    if (filtered.visibleResultCount !== counts.visible) {
      throw new Error("Equipment count discovery disagreed with the rendered final-query visible count.");
    }
    const reset = currentSearch();
    reset.value = "";
    reset.dispatchEvent(new Event("input", { bubbles: true }));
    await waitUntil(() => visibleResultValues().length > 1, settleTimeoutMs);
    return counts;
  },

  async runSample({ actionId, finalResultValues, keyDelayMs, postSettleMs, querySequence, settleTimeoutMs }) {
    await prepareAction(actionId, settleTimeoutMs);
    const sample = beginSample({ finalQuery: querySequence.at(-1), finalResultValues });
    let semantic;
    let previewSplit = null;
    let actionOutcome = null;
    let primaryInterval = null;
    try {
      if (actionId === "cold-open" || actionId === "warm-reopen") {
        primaryInterval = startActionInterval(sample, actionId);
        await reopen(actionId === "cold-open", settleTimeoutMs);
        const ready = () => {
          const root = currentRoot();
          return (
            root.querySelector(SEARCH_SELECTOR)?.disabled === false &&
            root.querySelectorAll("[data-equipment-source-diagnostic]").length === 0 &&
            !root.querySelector(".equipment-catalogue-state") &&
            visibleResultValues().length === 12
          );
        };
        semantic = ready;
        actionOutcome = () => {
          const root = currentRoot();
          return {
            searchDisabled: root.querySelector(SEARCH_SELECTOR)?.disabled ?? null,
            diagnosticCount: root.querySelectorAll("[data-equipment-source-diagnostic]").length,
            catalogueStatePresent: Boolean(root.querySelector(".equipment-catalogue-state")),
            visibleResultValues: visibleResultValues(),
          };
        };
      } else if (actionId === "rapid-search") {
        const input = currentSearch();
        input.focus();
        for (const [index, query] of querySequence.entries()) {
          input.value = query;
          input.setSelectionRange(query.length, query.length);
          const dispatchedAt = performance.now();
          if (index === 0) sample.typingStartedAt = dispatchedAt;
          if (index === querySequence.length - 1) {
            primaryInterval = startActionInterval(sample, "rapid-final-query", dispatchedAt);
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (index < querySequence.length - 1) await delay(keyDelayMs);
        }
        semantic = () => {
          const current = currentSearch();
          const finalQuery = querySequence.at(-1);
          return (
            sameStrings(visibleResultValues(), finalResultValues) &&
            current.value === finalQuery &&
            document.activeElement === current &&
            current.selectionStart === finalQuery.length &&
            current.selectionEnd === finalQuery.length
          );
        };
      } else if (actionId === "facet-change") {
        const button = currentRoot().querySelector('[data-wayfinder-action="toggle-equipment-filter"]');
        if (!button) throw new Error("Equipment profile could not resolve a facet control.");
        const previous = button.getAttribute("aria-pressed");
        const filterKey = button.dataset.filterKey;
        const filterValue = button.dataset.value;
        primaryInterval = startActionInterval(sample, actionId);
        button.click();
        semantic = () => {
          const current = currentRoot().querySelector(
            `[data-wayfinder-action="toggle-equipment-filter"][data-filter-key="${css(button.dataset.filterKey)}"][data-value="${css(button.dataset.value)}"]`,
          );
          return Boolean(current && current.getAttribute("aria-pressed") !== previous);
        };
        actionOutcome = () => ({
          filterKey,
          filterValue,
          previousPressed: previous === "true",
          observedPressed:
            currentRoot()
              .querySelector(
                `[data-wayfinder-action="toggle-equipment-filter"][data-filter-key="${css(filterKey)}"][data-value="${css(filterValue)}"]`,
              )
              ?.getAttribute("aria-pressed") === "true",
        });
      } else if (actionId === "cart-quantity") {
        const button = currentRoot().querySelector('[data-wayfinder-action="change-equipment-quantity"][data-delta="1"]');
        if (!button) throw new Error("Equipment profile requires a mutable cart line.");
        const line = button.closest(".equipment-cart-line");
        const previous = Number(line?.querySelector(".equipment-quantity input")?.value ?? 0);
        const lineId = button.dataset.lineId;
        primaryInterval = startActionInterval(sample, actionId);
        button.click();
        const observedQuantity = () =>
          Number(
            currentRoot()
              .querySelector(`[data-wayfinder-action="change-equipment-quantity"][data-line-id="${css(lineId)}"]`)
              ?.closest(".equipment-cart-line")
              ?.querySelector(".equipment-quantity input")?.value ?? 0,
          );
        semantic = () => observedQuantity() === previous + 1;
        actionOutcome = () => ({ lineId, previousQuantity: previous, observedQuantity: observedQuantity() });
      } else if (actionId === "recipe-change") {
        const button = currentRoot().querySelector(
          '[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]',
        );
        if (!button) throw new Error("Equipment profile requires the awaiting-authority recipe control.");
        const previousRecipe = currentRoot().querySelector(
          '[data-wayfinder-action="select-equipment-recipe"][aria-pressed="true"]',
        )?.dataset.recipe;
        primaryInterval = startActionInterval(sample, actionId);
        button.click();
        semantic = () =>
          currentRoot()
            .querySelector('[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]')
            ?.getAttribute("aria-pressed") === "true";
        actionOutcome = () => ({
          previousRecipe,
          observedRecipe: currentRoot().querySelector(
            '[data-wayfinder-action="select-equipment-recipe"][aria-pressed="true"]',
          )?.dataset.recipe,
        });
      } else if (actionId === "preview-change") {
        const buttons = [...currentRoot().querySelectorAll('[data-wayfinder-action="preview-equipment-item"]')];
        if (buttons.length < 2) throw new Error("Equipment profile requires two visible preview candidates.");
        const target = buttons.find((button) => !button.closest(".equipment-result")?.classList.contains("is-previewing")) ?? buttons[1];
        const targetUuid = target.dataset.sourceUuid;
        const beforeNew = documentReads(targetUuid);
        const newPreviewInterval = startActionInterval(sample, "preview-new");
        target.click();
        await waitUntil(() => visiblePreviewUuid() === targetUuid, settleTimeoutMs);
        completeActionInterval(newPreviewInterval);
        const afterNew = documentReads(targetUuid);
        const repeated = currentRoot().querySelector(
          `[data-wayfinder-action="preview-equipment-item"][data-source-uuid="${css(targetUuid)}"]`,
        );
        if (!repeated) throw new Error("Equipment profile could not resolve the repeated preview control.");
        const detailBeforeRepeat = currentRoot().querySelector('[data-application-part="equipment-detail"]');
        if (!detailBeforeRepeat) throw new Error("Equipment profile could not resolve the pre-repeat preview detail part.");
        const rendersBeforeRepeat = counters.equipmentRender;
        const repeatPreviewInterval = startActionInterval(sample, "preview-repeat");
        repeated.click();
        const repeatPreviewRenderScheduled = counters.equipmentRender > rendersBeforeRepeat;
        if (repeatPreviewRenderScheduled) {
          await waitUntil(
            () =>
              visiblePreviewUuid() === targetUuid &&
              currentRoot().querySelector('[data-application-part="equipment-detail"]') !== detailBeforeRepeat,
            settleTimeoutMs,
          );
        } else if (visiblePreviewUuid() !== targetUuid) {
          throw new Error("Equipment profile repeated-preview no-op did not preserve the exact visible identity.");
        }
        completeActionInterval(repeatPreviewInterval);
        sample.semanticCompletedAt = repeatPreviewInterval.completedAt;
        previewSplit = {
          newPreviewHydrationCount: afterNew - beforeNew,
          repeatPreviewHydrationCount: documentReads(targetUuid) - afterNew,
          newPreviewDurationMs: intervalDuration(newPreviewInterval),
          repeatPreviewDurationMs: intervalDuration(repeatPreviewInterval),
          combinedPreviewDurationMs: repeatPreviewInterval.completedAt - newPreviewInterval.startedAt,
          repeatPreviewRenderScheduled,
          repeatPreviewDetailReplaced:
            currentRoot().querySelector('[data-application-part="equipment-detail"]') !== detailBeforeRepeat,
        };
        semantic = () => visiblePreviewUuid() === targetUuid;
        actionOutcome = () => ({ targetSourceUuid: targetUuid, visiblePreviewSourceUuid: visiblePreviewUuid() });
      } else {
        throw new Error(`Unknown equipment profile action ${actionId}.`);
      }

      if (sample.semanticCompletedAt === null) {
        await waitUntil(semantic, settleTimeoutMs);
        completeActionInterval(primaryInterval);
        sample.semanticCompletedAt = primaryInterval.completedAt;
      }
      await delay(postSettleMs);
      return finishSample(sample, true, previewSplit, typeof actionOutcome === "function" ? actionOutcome() : actionOutcome);
    } catch (error) {
      return {
        ...finishSample(sample, false, previewSplit, typeof actionOutcome === "function" ? actionOutcome() : actionOutcome),
        semanticError: error instanceof Error ? error.message : String(error),
      };
    }
  },

  inspect: snapshot,
};

async function prepareAction(actionId, timeoutMs) {
  if (readyDraftSnapshot) {
    await replaceDraftAndReopen(readyDraftSnapshot, timeoutMs);
  }
  if (actionId === "preview-change") {
    const runtime = await import(
      "/modules/wayfinder-pf2e/scripts/wayfinder/application/equipment-acquisition-runtime-service.js"
    );
    runtime.invalidateFoundryEquipmentCataloguePack(PACK_ID);
    await replaceDraftAndReopen(readyDraftSnapshot, timeoutMs);
  }
  if (actionId === "rapid-search") {
    const input = currentSearch();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitUntil(() => currentSearch().value === "" && visibleResultValues().length > 1, timeoutMs);
  }
  if (actionId === "recipe-change") {
    if (!readyDraftSnapshot) throw new Error("Equipment recipe profiling lacks a ready baseline draft.");
    const awaiting = structuredClone(readyDraftSnapshot);
    awaiting.acquisition = null;
    awaiting.equipmentPolicyRequests = [];
    await replaceDraftAndReopen(awaiting, timeoutMs);
    const start = currentRoot().querySelector('[data-wayfinder-action="initialize-starting-equipment"]');
    if (!start) throw new Error("Equipment profile could not reset to the recipe-selection boundary.");
    start.click();
    await waitUntil(
      () => currentRoot().querySelector('[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]'),
      timeoutMs,
    );
  }
}

async function replaceDraftAndReopen(draft, timeoutMs) {
  const actor = game.actors.get(actorId);
  const app = currentApp();
  const width = app.element.getBoundingClientRect().width;
  await app.close({ animate: false });
  await actor.setFlag(MODULE_ID, "draft", structuredClone(draft));
  const { WayfinderApp } = await import("/modules/wayfinder-pf2e/scripts/wayfinder/app-shell.js");
  WayfinderApp.open(actor);
  await waitUntil(
    () =>
      currentApp()?.element?.querySelector?.(
        `${SEARCH_SELECTOR}, [data-wayfinder-action="initialize-starting-equipment"]`,
      ),
    timeoutMs,
  );
  currentApp().setPosition?.({ width });
  await frames(2);
}

async function reopen(cold, timeoutMs) {
  const actor = game.actors.get(actorId);
  const app = currentApp();
  const width = app.element.getBoundingClientRect().width;
  await app.close({ animate: false });
  if (cold) {
    const runtime = await import("/modules/wayfinder-pf2e/scripts/wayfinder/application/equipment-acquisition-runtime-service.js");
    runtime.invalidateFoundryEquipmentCataloguePack(PACK_ID);
  }
  const { WayfinderApp } = await import("/modules/wayfinder-pf2e/scripts/wayfinder/app-shell.js");
  WayfinderApp.open(actor);
  await waitUntil(() => currentApp()?.element?.querySelector?.(SEARCH_SELECTOR), timeoutMs);
  currentApp().setPosition?.({ width });
}

async function ensureSprayPelletsCart(timeoutMs) {
  if (currentRoot().querySelector(".equipment-cart-line")) return;
  const input = currentSearch();
  input.value = "spray pellets";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await waitUntil(() => resultForSourceUuid(SPRAY_PELLETS_SOURCE_UUID), timeoutMs);
  const result = resultForSourceUuid(SPRAY_PELLETS_SOURCE_UUID);
  const preview = result?.matches('[data-wayfinder-action="preview-equipment-item"]')
    ? result
    : result?.querySelector(
        `[data-wayfinder-action="preview-equipment-item"][data-source-uuid="${css(SPRAY_PELLETS_SOURCE_UUID)}"]`,
      );
  if (!preview) throw new Error("Equipment profile could not select the exact Spray Pellets result.");
  preview.click();
  await waitUntil(
    () => visiblePreviewUuid() === SPRAY_PELLETS_SOURCE_UUID && selectedCurrencyAdd(SPRAY_PELLETS_SOURCE_UUID),
    timeoutMs,
  );
  const add = selectedCurrencyAdd(SPRAY_PELLETS_SOURCE_UUID);
  if (!add) throw new Error("Equipment profile could not add Spray Pellets to the fixture cart.");
  add.click();
  await waitUntil(() => currentRoot().querySelector(".equipment-cart-line"), timeoutMs);
  const next = currentSearch();
  next.value = "";
  next.dispatchEvent(new Event("input", { bubbles: true }));
  await waitUntil(() => visibleResultValues().length > 1, timeoutMs);
}

function beginSample({ finalQuery, finalResultValues }) {
  const longTasks = [];
  let observer = null;
  let supported = false;
  if (typeof PerformanceObserver === "function" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    supported = true;
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    });
    observer.observe({ type: "longtask", buffered: false });
  }
  const root = currentRoot();
  const sample = {
    startedAt: performance.now(),
    actionIntervals: [],
    counterStart: structuredClone(counters),
    imageUrlsAtStart: imageUrls(root),
    resourceStart: performance.now(),
    longTasks,
    observer,
    longTaskSupported: supported,
    semanticCompletedAt: null,
    typingStartedAt: null,
    focusLossCount: 0,
    caretMismatchCount: 0,
    staleFlashCount: 0,
    correctFinalSeen: false,
    focusListener: null,
    inputListener: null,
    mutationObserver: null,
  };
  sample.focusListener = (event) => {
    if (event.target?.matches?.(SEARCH_SELECTOR)) sample.focusLossCount += 1;
  };
  sample.inputListener = (event) => {
    const input = event.target;
    if (
      input?.matches?.(SEARCH_SELECTOR) &&
      (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length)
    ) {
      sample.caretMismatchCount += 1;
    }
  };
  const observeFinal = () => {
    const input = currentRoot().querySelector(SEARCH_SELECTOR);
    if (input?.value !== finalQuery) return;
    const correct = sameStrings(visibleResultValues(), finalResultValues);
    if (sample.correctFinalSeen && !correct) sample.staleFlashCount += 1;
    sample.correctFinalSeen ||= correct;
  };
  document.addEventListener("focusout", sample.focusListener, true);
  document.addEventListener("input", sample.inputListener, true);
  sample.mutationObserver = new MutationObserver(observeFinal);
  sample.mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  return sample;
}

function startActionInterval(sample, kind, startedAt = performance.now()) {
  const interval = { kind, startedAt, completedAt: null };
  sample.actionIntervals.push(interval);
  return interval;
}

function completeActionInterval(interval) {
  if (!interval) throw new Error("Equipment profile action interval was not started.");
  interval.completedAt = performance.now();
}

function intervalDuration(interval) {
  return interval?.completedAt === null ? null : interval.completedAt - interval.startedAt;
}

function finishSample(sample, semanticPassed, previewSplit, actionOutcome) {
  for (const entry of sample.observer?.takeRecords?.() ?? []) sample.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  sample.observer?.disconnect();
  sample.mutationObserver?.disconnect();
  document.removeEventListener("focusout", sample.focusListener, true);
  document.removeEventListener("input", sample.inputListener, true);
  const root = currentRoot();
  const search = root.querySelector(SEARCH_SELECTOR);
  const resultList = root.querySelector(".equipment-result-list");
  const mountedResults = [...(resultList?.querySelectorAll("[data-result-index]") ?? [])];
  const resultOffset = Number(resultList?.dataset.resultOffset ?? 0);
  const urls = new Set([...sample.imageUrlsAtStart, ...imageUrls(root)]);
  const images = performance
    .getEntriesByType("resource")
    .filter((entry) => entry.startTime >= sample.resourceStart && entry.initiatorType === "img" && urls.has(entry.name));
  const observationCompletedAt = performance.now();
  const observedLongTasks = sample.longTasks.map((entry) => ({ startTime: entry.startTime, duration: entry.duration }));
  const completedIntervals = sample.actionIntervals.filter((interval) => interval.completedAt !== null);
  const qualifyingLongTasks = observedLongTasks.filter((entry) =>
    completedIntervals.some((interval) => intervalsOverlap(entry.startTime, entry.startTime + entry.duration, interval.startedAt, interval.completedAt)),
  );
  const postSettleLongTasks = observedLongTasks.filter(
    (entry) =>
      sample.semanticCompletedAt !== null &&
      intervalsOverlap(
        entry.startTime,
        entry.startTime + entry.duration,
        sample.semanticCompletedAt,
        observationCompletedAt,
      ),
  );
  const primaryDurations = completedIntervals.map(intervalDuration);
  const durationMs = primaryDurations.length > 0 ? Math.max(...primaryDurations) : null;
  return {
    schemaVersion: 2,
    sampleStartedAt: sample.startedAt,
    semanticCompletedAt: sample.semanticCompletedAt,
    observationCompletedAt,
    actionIntervals: sample.actionIntervals,
    durationMs,
    combinedDurationMs: sample.semanticCompletedAt === null ? null : sample.semanticCompletedAt - sample.startedAt,
    typingStartedAt: sample.typingStartedAt,
    endToEndTypingDurationMs:
      sample.typingStartedAt === null || sample.semanticCompletedAt === null
        ? null
        : sample.semanticCompletedAt - sample.typingStartedAt,
    semanticPassed,
    actualAppWidth: root.getBoundingClientRect().width,
    domElementCount: root.querySelectorAll("*").length,
    resultDomElementCount: resultList?.querySelectorAll("*").length ?? 0,
    mountedResultCount: mountedResults.length,
    resultOffset,
    resultEnd: resultOffset + mountedResults.length,
    firstMountedSourceUuid: mountedResults[0]?.dataset.sourceUuid ?? null,
    lastMountedSourceUuid: mountedResults.at(-1)?.dataset.sourceUuid ?? null,
    leadingSpacerPx: Number.parseFloat(resultList?.querySelector("[data-equipment-leading-spacer]")?.style.height ?? "0"),
    trailingSpacerPx: Number.parseFloat(resultList?.querySelector("[data-equipment-trailing-spacer]")?.style.height ?? "0"),
    imageRequestCount: images.length,
    longTaskSupported: sample.longTaskSupported,
    observedLongTasks,
    qualifyingLongTasks,
    postSettleLongTasks,
    finalValue: search?.value ?? null,
    focused: search ? document.activeElement === search : null,
    selectionStart: search?.selectionStart ?? null,
    selectionEnd: search?.selectionEnd ?? null,
    observedResultValues: visibleResultValues(),
    focusLossCount: sample.focusLossCount,
    caretMismatchCount: sample.caretMismatchCount,
    staleFlashCount: sample.staleFlashCount,
    packIndexReadCount: counters.equipmentPackIndex - sample.counterStart.equipmentPackIndex,
    packDocumentReadCount: counters.equipmentPackDocument - sample.counterStart.equipmentPackDocument,
    allPackIndexReadCount: counters.allPackIndex - sample.counterStart.allPackIndex,
    allPackDocumentReadCount: counters.allPackDocument - sample.counterStart.allPackDocument,
    planBuildCount: counters.planBuild - sample.counterStart.planBuild,
    planBuildCounterSupported: counters.planBuildCounterSupported,
    fullRenderCallCount: counters.fullRender - sample.counterStart.fullRender,
    fullPrepareContextCount: counters.fullPrepareContext - sample.counterStart.fullPrepareContext,
    equipmentRenderCallCount: counters.equipmentRender - sample.counterStart.equipmentRender,
    equipmentPrepareContextCount: counters.equipmentPrepareContext - sample.counterStart.equipmentPrepareContext,
    actionOutcome,
    ...previewSplit,
  };
}

function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

async function instrumentAppPrototype() {
  const { WayfinderApp } = await import("/modules/wayfinder-pf2e/scripts/wayfinder/app-shell.js");
  const prototype = WayfinderApp.prototype;
  if (prototype.__wayfinderEquipmentProfileInstrumented) return;
  Object.defineProperty(prototype, "__wayfinderEquipmentProfileInstrumented", { value: true });
  const render = prototype.render;
  prototype.render = function (...args) {
    if (this.actor?.id === actorId) {
      const options = args[0];
      counters[options?.wayfinderEquipmentUpdate === true ? "equipmentRender" : "fullRender"] += 1;
    }
    return render.apply(this, args);
  };
  const prepare = prototype._prepareContext;
  prototype._prepareContext = async function (...args) {
    const context = await prepare.apply(this, args);
    if (this.actor?.id === actorId) {
      counters[context?.wayfinderRenderScope === "equipment" ? "equipmentPrepareContext" : "fullPrepareContext"] += 1;
    }
    return context;
  };
  if (typeof prototype._buildRenderPlan === "function") {
    counters.planBuildCounterSupported = true;
    const build = prototype._buildRenderPlan;
    prototype._buildRenderPlan = function (...args) {
      if (this.actor?.id === actorId) counters.planBuild += 1;
      return build.apply(this, args);
    };
  }
}

function instrumentPacks() {
  for (const pack of game.packs ?? []) {
    if (typeof pack.getIndex === "function") {
      const getIndex = pack.getIndex.bind(pack);
      pack.getIndex = async (...args) => {
        counters.allPackIndex += 1;
        if (pack.collection === PACK_ID) counters.equipmentPackIndex += 1;
        const result = await getIndex(...args);
        counters.indexCounts[pack.collection] = Number(result?.size ?? result?.length ?? 0);
        return result;
      };
    }
    if (typeof pack.getDocument === "function") {
      const getDocument = pack.getDocument.bind(pack);
      pack.getDocument = (id, ...args) => {
        counters.allPackDocument += 1;
        if (pack.collection === PACK_ID) counters.equipmentPackDocument += 1;
        const key = `${pack.collection}|${id}`;
        counters.documentReads[key] = (counters.documentReads[key] ?? 0) + 1;
        return getDocument(id, ...args);
      };
    }
  }
}

function freshCounters() {
  return {
    equipmentPackIndex: 0,
    equipmentPackDocument: 0,
    allPackIndex: 0,
    allPackDocument: 0,
    planBuild: 0,
    planBuildCounterSupported: false,
    fullRender: 0,
    fullPrepareContext: 0,
    equipmentRender: 0,
    equipmentPrepareContext: 0,
    documentReads: {},
    indexCounts: {},
  };
}

function snapshot() {
  const root = currentRoot();
  return {
    actualAppWidth: root.getBoundingClientRect().width,
    visibleResultValues: visibleResultValues(),
    visibleResultCount: visibleResultValues().length,
    totalResultCount: Number(root.querySelector(".equipment-result-count")?.textContent?.match(/of\s+(\d+)/i)?.[1] ?? 0),
  };
}

function visibleResultValues() {
  return [...currentRoot().querySelectorAll(RESULT_SELECTOR)].map(resultSourceUuid);
}

function resultSourceUuid(result) {
  return result.dataset.sourceUuid ?? result.querySelector(":scope [data-source-uuid]")?.dataset.sourceUuid ?? "";
}

function resultForSourceUuid(sourceUuid) {
  return [...currentRoot().querySelectorAll(RESULT_SELECTOR)].find((result) => resultSourceUuid(result) === sourceUuid) ?? null;
}

function selectedCurrencyAdd(sourceUuid) {
  return currentRoot()
    .querySelector(`[data-equipment-preview="${css(sourceUuid)}"]`)
    ?.querySelector(
      `[data-wayfinder-action="add-equipment-item"][data-source-uuid="${css(sourceUuid)}"][data-funding="currency"]`,
    );
}

function visiblePreviewUuid() {
  return currentRoot().querySelector("[data-equipment-preview]:not([hidden])")?.dataset.equipmentPreview ?? null;
}

function documentReads(sourceUuid) {
  const id = String(sourceUuid ?? "").split(".").at(-1);
  return counters.documentReads[`${PACK_ID}|${id}`] ?? 0;
}

function currentApp() {
  const actor = actorId ? game.actors.get(actorId) : null;
  return Object.values(actor?.apps ?? {}).find((app) => app?.element?.matches?.(ROOT_SELECTOR)) ?? null;
}

function currentRoot() {
  const root = currentApp()?.element;
  if (!root) throw new Error("Equipment profile actor app is not rendered.");
  return root;
}

function currentSearch() {
  const input = currentRoot().querySelector(SEARCH_SELECTOR);
  if (!input) throw new Error("Equipment profile search is not rendered.");
  return input;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    await frames(1);
    if (predicate()) return;
  }
  throw new Error(`Equipment profile semantic oracle timed out after ${timeoutMs}ms.`);
}

function frames(count) {
  return new Promise((resolve) => {
    const next = () => (count-- <= 0 ? resolve() : requestAnimationFrame(next));
    next();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageUrls(root) {
  return new Set([...root.querySelectorAll("img")].map((image) => image.currentSrc || image.src).filter(Boolean));
}

function sameStrings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}


function css(value) {
  return String(value ?? "").replaceAll('"', '\\"');
}
