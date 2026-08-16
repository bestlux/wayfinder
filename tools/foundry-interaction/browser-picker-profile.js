/* global MutationObserver, document, game, requestAnimationFrame */

const ROOT_SELECTOR = ".wayfinder-app";
const SEARCH_SELECTOR = "[data-wayfinder-search]";
const OPTION_ROW_SELECTOR = "[data-wayfinder-option-list] .option-row";
const SHELL_SENTINEL_SELECTOR = ".wizard-rail";

let activeSample = null;
let fixtureActorId = null;
let appCounters = null;

globalThis.__wayfinderPickerProfile = {
  configure({ actorId }) {
    fixtureActorId = actorId;
    const app = currentApp();
    if (!appCounters) {
      appCounters = {
        fullPrepareContext: 0,
        fullRender: 0,
        packDocument: 0,
        packIndex: 0,
        pickerPrepareContext: 0,
        pickerRender: 0,
      };
      const prepareContext = app._prepareContext.bind(app);
      const render = app.render.bind(app);
      app._prepareContext = async (...args) => {
        const context = await prepareContext(...args);
        appCounters[isPickerPreparedContext(context) ? "pickerPrepareContext" : "fullPrepareContext"] += 1;
        return context;
      };
      app.render = (...args) => {
        appCounters[isPickerPartsRequest(args[0]) ? "pickerRender" : "fullRender"] += 1;
        return render(...args);
      };
      instrumentPackReads();
    }
    return this.inspect();
  },

  async resize({ actorId, width }) {
    const actor = game.actors.get(actorId);
    const app = Object.values(actor?.apps ?? {}).find((candidate) => candidate?.element?.matches?.(ROOT_SELECTOR));
    if (!app) {
      throw new Error(`Could not find the open Wayfinder app for actor ${actorId}.`);
    }

    if (typeof app.setPosition === "function") {
      app.setPosition({ width });
    } else {
      app.element.style.width = `${width}px`;
    }
    await animationFrames(2);
    return app.element.getBoundingClientRect().width;
  },

  async reset({ expectedResultCount, stableMs, timeoutMs }) {
    const input = currentSearchInput();
    input.focus();
    input.value = "";
    input.setSelectionRange(0, 0);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const deadline = performance.now() + timeoutMs;
    let correctSince = null;
    while (performance.now() < deadline) {
      await animationFrames(1);
      const snapshot = pickerSnapshot([], "");
      const correct = snapshot.inputValue === "" && snapshot.resultCount === expectedResultCount;
      correctSince = correct ? (correctSince ?? performance.now()) : null;
      if (correctSince !== null && performance.now() - correctSince >= stableMs) {
        const settledInput = currentSearchInput();
        settledInput.focus();
        settledInput.setSelectionRange(0, 0);
        return snapshot;
      }
    }

    throw new Error(`Picker did not reset to ${expectedResultCount} results within ${timeoutMs}ms.`);
  },

  beginSample({ expectedResultNames, expectedResultValues, finalQuery, postSettleMs, settleTimeoutMs }) {
    if (activeSample) {
      throw new Error("A picker interaction sample is already active.");
    }

    const sample = {
      expectedResultNames: [...expectedResultNames],
      expectedResultValues: [...expectedResultValues],
      finalQuery,
      postSettleMs,
      settleTimeoutMs,
      startedAt: performance.now(),
      counterStart: { ...appCounters },
      firstInputAt: null,
      finalInputAt: null,
      correctResultsPaintAt: null,
      observationEndAt: null,
      observationPromise: null,
      observedQueries: [],
      transitions: [],
      staleFlashCount: 0,
      staleRenderCommitCount: 0,
      rootReplacementCount: 0,
      searchInputReplacementCount: 0,
      shellReplacementCount: 0,
      focusLossCount: 0,
      caretMismatchCount: 0,
      correctSeen: false,
      focusWasLost: false,
      lastSignature: null,
      lastRoot: currentRoot(),
      lastRenderedInput: currentSearchInput(),
      lastShellSentinel: currentRoot().querySelector(SHELL_SENTINEL_SELECTOR),
      lastRenderedQuery: pickerSnapshot([], "").renderedQuery,
      imageUrlsAtStart: imageUrls(currentRoot()),
      longTasks: [],
      longTaskSupported: false,
      mutationObserver: null,
      longTaskObserver: null,
      inputListener: null,
      focusOutListener: null,
    };

    sample.inputListener = (event) => {
      const input = event.target;
      if (input?.tagName !== "INPUT" || !input.matches(SEARCH_SELECTOR) || !currentRoot().contains(input)) {
        return;
      }
      sample.observedQueries.push(input.value);
      sample.firstInputAt ??= performance.now();
      if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) {
        sample.caretMismatchCount += 1;
      }
      if (input.value === sample.finalQuery && sample.finalInputAt === null) {
        sample.finalInputAt = performance.now();
        sample.observationPromise = observeSampleFrames(sample);
      }
      recordTransition(sample, false);
    };
    document.addEventListener("input", sample.inputListener, true);

    sample.focusOutListener = (event) => {
      if (
        sample.firstInputAt !== null &&
        event.target === sample.lastRenderedInput &&
        !sample.focusWasLost
      ) {
        sample.focusLossCount += 1;
        sample.focusWasLost = true;
      }
    };
    document.addEventListener("focusout", sample.focusOutListener, true);

    sample.mutationObserver = new MutationObserver(() => recordTransition(sample, false));
    sample.mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    if (
      typeof PerformanceObserver === "function" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
      try {
        sample.longTaskSupported = true;
        sample.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            sample.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        sample.longTaskObserver.observe({ type: "longtask", buffered: false });
      } catch {
        sample.longTaskSupported = false;
        sample.longTaskObserver = null;
      }
    }

    activeSample = sample;
    return { startedAt: sample.startedAt };
  },

  async finishSample() {
    const sample = activeSample;
    if (!sample) {
      throw new Error("No picker interaction sample is active.");
    }

    await (sample.observationPromise ?? animationFrames(2));

    const finalSnapshot = recordTransition(sample, true);
    sample.mutationObserver?.disconnect();
    if (sample.longTaskObserver) {
      for (const entry of sample.longTaskObserver.takeRecords()) {
        sample.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }
    sample.longTaskObserver?.disconnect();
    document.removeEventListener("input", sample.inputListener, true);
    document.removeEventListener("focusout", sample.focusOutListener, true);
    activeSample = null;

    const root = currentRoot();
    const resultList = root.querySelector("[data-wayfinder-option-list]");
    const relevantImageUrls = new Set([...sample.imageUrlsAtStart, ...imageUrls(root)]);
    const resources = performance
      .getEntriesByType("resource")
      .filter(
        (entry) =>
          entry.startTime >= (sample.firstInputAt ?? sample.startedAt) &&
          entry.initiatorType === "img" &&
          relevantImageUrls.has(entry.name),
      );
    const relevantLongTasks = sample.longTasks.filter(
      (entry) =>
        entry.startTime <= (sample.observationEndAt ?? performance.now()) &&
        entry.startTime + entry.duration >= (sample.firstInputAt ?? sample.startedAt),
    );
    return {
      durationMs:
        sample.finalInputAt !== null && sample.correctResultsPaintAt !== null
          ? sample.correctResultsPaintAt - sample.finalInputAt
          : null,
      finalInputObserved: sample.finalInputAt !== null,
      finalValue: finalSnapshot.inputValue,
      observedQueries: sample.observedQueries,
      expectedResultCount: sample.expectedResultValues.length,
      expectedResultNames: sample.expectedResultNames,
      expectedResultValues: sample.expectedResultValues,
      observedResultCount: finalSnapshot.resultCount,
      observedResultNames: finalSnapshot.resultNames,
      observedResultValues: finalSnapshot.resultValues,
      focused: finalSnapshot.focused,
      selectionStart: finalSnapshot.selectionStart,
      selectionEnd: finalSnapshot.selectionEnd,
      focusLossCount: sample.focusLossCount,
      caretMismatchCount: sample.caretMismatchCount,
      staleFlashCount: sample.staleFlashCount,
      staleRenderCommitCount: sample.staleRenderCommitCount,
      rootReplacementCount: sample.rootReplacementCount,
      searchInputReplacementCount: sample.searchInputReplacementCount,
      shellReplacementCount: sample.shellReplacementCount,
      transitions: sample.transitions,
      domElementCount: root.querySelectorAll("*").length,
      resultDomElementCount: resultList?.querySelectorAll("*").length ?? 0,
      imageRequestCount: resources.length,
      uniqueImageRequestCount: new Set(resources.map((entry) => entry.name)).size,
      imageNetworkTransferCount: resources.filter((entry) => entry.transferSize > 0).length,
      longTasks: relevantLongTasks,
      longTaskTotalMs: relevantLongTasks.reduce((total, entry) => total + entry.duration, 0),
      maxLongTaskMs: Math.max(0, ...relevantLongTasks.map((entry) => entry.duration)),
      longTaskSupported: sample.longTaskSupported,
      fullPrepareContextCount: appCounters.fullPrepareContext - sample.counterStart.fullPrepareContext,
      fullRenderCallCount: appCounters.fullRender - sample.counterStart.fullRender,
      pickerPartPrepareContextCount:
        appCounters.pickerPrepareContext - sample.counterStart.pickerPrepareContext,
      pickerPartRenderCallCount: appCounters.pickerRender - sample.counterStart.pickerRender,
      packIndexReadCount: appCounters.packIndex - sample.counterStart.packIndex,
      packDocumentReadCount: appCounters.packDocument - sample.counterStart.packDocument,
      actualAppWidth: root.getBoundingClientRect().width,
      windowContentWidth: root.querySelector(".window-content")?.getBoundingClientRect().width ?? null,
    };
  },

  inspect() {
    const root = currentRoot();
    const snapshot = pickerSnapshot([], "");
    return {
      ...snapshot,
      domElementCount: root.querySelectorAll("*").length,
      actualAppWidth: root.getBoundingClientRect().width,
    };
  },
};

function recordTransition(sample, frameSample) {
  const root = currentRoot();
  const renderedInput = currentSearchInput();
  const shellSentinel = root.querySelector(SHELL_SENTINEL_SELECTOR);
  const snapshot = pickerSnapshot(sample.expectedResultValues, sample.finalQuery);
  if (root !== sample.lastRoot) {
    if (sample.firstInputAt !== null) {
      sample.rootReplacementCount += 1;
    }
    sample.lastRoot = root;
  }
  if (renderedInput !== sample.lastRenderedInput) {
    if (sample.firstInputAt !== null) {
      sample.searchInputReplacementCount += 1;
    }
    sample.lastRenderedInput = renderedInput;
  }
  if (snapshot.renderedQuery !== sample.lastRenderedQuery) {
    if (sample.finalInputAt !== null && snapshot.renderedQuery !== sample.finalQuery) {
      sample.staleRenderCommitCount += 1;
    }
    sample.lastRenderedQuery = snapshot.renderedQuery;
  }
  if (shellSentinel !== sample.lastShellSentinel) {
    if (sample.firstInputAt !== null) {
      sample.shellReplacementCount += 1;
    }
    sample.lastShellSentinel = shellSentinel;
  }
  if (sample.firstInputAt !== null && frameSample) {
    if (sample.finalInputAt !== null) {
      if (sample.correctSeen && !snapshot.correct) {
        sample.staleFlashCount += 1;
      }
      sample.correctSeen ||= snapshot.correct;
    }

    if (!snapshot.focused && !sample.focusWasLost) {
      sample.focusLossCount += 1;
      sample.focusWasLost = true;
    } else if (snapshot.focused) {
      sample.focusWasLost = false;
    }
  }

  const signature = JSON.stringify([
    snapshot.inputValue,
    snapshot.renderedQuery,
    snapshot.resultCount,
    snapshot.resultValues,
    snapshot.focused,
  ]);
  if (signature !== sample.lastSignature && sample.transitions.length < 200) {
    sample.lastSignature = signature;
    sample.transitions.push({
      at: performance.now(),
      inputValue: snapshot.inputValue,
      renderedQuery: snapshot.renderedQuery,
      renderedResultCount: snapshot.renderedResultCount,
      resultCount: snapshot.resultCount,
      resultNames: snapshot.resultNames,
      resultValues: snapshot.resultValues,
      focused: snapshot.focused,
      correct: snapshot.correct,
    });
  }
  return snapshot;
}

async function observeSampleFrames(sample) {
  const deadline = performance.now() + sample.settleTimeoutMs;
  let consecutiveCorrectFrames = 0;
  while (performance.now() < deadline) {
    await nextAnimationFrame();
    const snapshot = recordTransition(sample, true);
    if (snapshot.correct) {
      sample.correctResultsPaintAt ??= performance.now();
    }
    consecutiveCorrectFrames = snapshot.correct ? consecutiveCorrectFrames + 1 : 0;
    if (consecutiveCorrectFrames >= 2) {
      break;
    }
  }

  const postSettleDeadline = performance.now() + sample.postSettleMs;
  while (performance.now() < postSettleDeadline) {
    await nextAnimationFrame();
    recordTransition(sample, true);
  }
  sample.observationEndAt = performance.now();
}

function pickerSnapshot(expectedResultValues, finalQuery) {
  const root = currentRoot();
  const input = currentSearchInput();
  const results = Array.from(root.querySelectorAll(OPTION_ROW_SELECTOR), (row) => ({
    name: row.querySelector(".option-name")?.textContent.trim() ?? "",
    value: row.querySelector("[data-value]")?.dataset.value ?? "",
  }));
  const resultNames = results.map((entry) => entry.name);
  const resultValues = results.map((entry) => entry.value);
  const resultList = root.querySelector("[data-wayfinder-option-list]");
  const renderedQuery = resultList?.dataset.wayfinderRenderedQuery ?? input.getAttribute("value") ?? "";
  const renderedResultCount = Number(resultList?.dataset.wayfinderResultCount ?? resultValues.length);
  return {
    inputValue: input.value,
    renderedQuery,
    renderedResultCount,
    resultCount: resultNames.length,
    resultNames,
    resultValues,
    focused: document.activeElement === input,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
    correct:
      input.value === finalQuery &&
      renderedQuery === finalQuery &&
      renderedResultCount === expectedResultValues.length &&
      sameStrings(resultValues, expectedResultValues),
  };
}

function currentRoot() {
  const appRoot = currentApp()?.element;
  const root = appRoot ?? document.querySelector(ROOT_SELECTOR);
  if (!root || root.nodeType !== 1) {
    throw new Error("Wayfinder app is not rendered.");
  }
  return root;
}

function currentApp() {
  const actor = fixtureActorId ? game.actors.get(fixtureActorId) : null;
  return Object.values(actor?.apps ?? {}).find((app) => app?.element?.matches?.(ROOT_SELECTOR)) ?? null;
}

function currentSearchInput() {
  const input = currentRoot().querySelector(SEARCH_SELECTOR);
  if (!input || input.tagName !== "INPUT") {
    throw new Error("Wayfinder picker search input is not rendered.");
  }
  return input;
}

function sameStrings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function imageUrls(root) {
  return new Set(
    Array.from(root.querySelectorAll("img"), (image) => image.currentSrc || image.src).filter(Boolean),
  );
}

function isPickerPartsRequest(options) {
  return (
    options !== null &&
    typeof options === "object" &&
    Array.isArray(options.parts) &&
    options.parts.length > 0 &&
    options.parts.every((partId) => typeof partId === "string" && partId.startsWith("picker-"))
  );
}

function isPickerPreparedContext(context) {
  return context?.wayfinderRenderScope === "picker-search";
}

function instrumentPackReads() {
  for (const pack of game.packs.values()) {
    const getIndex = pack.getIndex?.bind(pack);
    const getDocument = pack.getDocument?.bind(pack);
    if (getIndex) {
      pack.getIndex = (...args) => {
        appCounters.packIndex += 1;
        return getIndex(...args);
      };
    }
    if (getDocument) {
      pack.getDocument = (...args) => {
        appCounters.packDocument += 1;
        return getDocument(...args);
      };
    }
  }
}

function animationFrames(count) {
  return new Promise((resolve) => {
    const next = () => {
      if (count <= 0) {
        resolve();
        return;
      }
      count -= 1;
      requestAnimationFrame(next);
    };
    next();
  });
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
