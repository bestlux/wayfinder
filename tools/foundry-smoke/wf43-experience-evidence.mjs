import { WF43_APP_WIDTHS, WF43_STATE_IDS, WF43_VIEWPORT, wf43ExperienceCases } from "./wf43-experience-cases.mjs";

export function qualifyWf43ExperienceResult(result, definitions = wf43ExperienceCases) {
  const failures = [];
  if (result?.schemaVersion !== 1) failures.push("WF-080-43 evidence schema is not version 1.");
  for (const key of ["foundryVersion", "pf2eVersion", "moduleVersion", "worldId"]) {
    if (typeof result?.runtime?.[key] !== "string" || !result.runtime[key]) {
      failures.push(`WF-080-43 evidence is missing runtime.${key}.`);
    }
  }
  if (result?.users?.gm?.isGM !== true || result?.users?.player?.isGM !== false) {
    failures.push("WF-080-43 evidence lacks exact GM and non-GM roles.");
  }
  if (result?.users?.gm?.id === result?.users?.player?.id) {
    failures.push("WF-080-43 evidence used the same GM and player.");
  }
  if (JSON.stringify(result?.viewport) !== JSON.stringify(WF43_VIEWPORT)) {
    failures.push("WF-080-43 did not use the frozen 1440x1000 browser viewport.");
  }
  if (JSON.stringify(result?.appWidths) !== JSON.stringify(WF43_APP_WIDTHS)) {
    failures.push("WF-080-43 top-level app widths differ from the frozen release widths.");
  }

  const localeEntries = result?.locales ?? [];
  if (
    localeEntries.length !== definitions.length ||
    JSON.stringify(localeEntries.map((entry) => entry.id)) !== JSON.stringify(definitions.map((entry) => entry.id))
  ) {
    failures.push("WF-080-43 locale evidence is duplicated, incomplete, or reordered.");
  }
  const observed = new Map(localeEntries.map((entry) => [entry.id, entry]));
  for (const definition of definitions) qualifyLocale(observed.get(definition.id), definition, failures);
  if (observed.size !== definitions.length) failures.push("WF-080-43 produced unexpected locale evidence.");

  if (
    result?.cleanup?.actorsDeleted !== definitions.length ||
    result?.cleanup?.actorsMissingAfterCleanup !== true ||
    result?.cleanup?.actorCountRestored !== true ||
    result?.cleanup?.exactFixturesMatched !== true ||
    result?.cleanup?.policyRestored !== true ||
    result?.cleanup?.packsRestored !== true ||
    result?.cleanup?.languageRestored !== true ||
    result?.cleanup?.restorationFailures?.length !== 0
  ) {
    failures.push("WF-080-43 cleanup did not restore the exact actor count, policy, pack setting, and language.");
  }
  return { ok: failures.length === 0, failures };
}

function qualifyLocale(entry, definition, failures) {
  if (!entry) {
    failures.push(`Missing WF-080-43 locale ${definition.id}.`);
    return;
  }
  if (entry.status !== "pass") failures.push(`${definition.id}: browser result did not pass.`);
  if (entry.definitionFingerprint !== definition.definitionFingerprint) {
    failures.push(`${definition.id}: definition fingerprint differs from the executed fixture.`);
  }
  if (entry.observedLocale !== definition.id) {
    failures.push(`${definition.id}: Foundry rendered locale ${entry.observedLocale ?? "unknown"}.`);
  }
  if (entry.rawLocalizationKeys?.length !== 0) {
    failures.push(`${definition.id}: rendered raw wayfinder-pf2e localization keys.`);
  }
  const keyboard = entry.keyboard;
  if (
    keyboard?.inputMode !== "keyboard-events-only" ||
    keyboard?.pointerActionCount !== 0 ||
    keyboard?.actions?.length < 8
  ) {
    failures.push(`${definition.id}: owner flow was not proven with keyboard events only.`);
  }
  if (
    keyboard?.entry?.mode !== "scoped-app-entry" ||
    keyboard?.entry?.focusMethod !== "programmatic-harness-anchor-before-keyboard-actions" ||
    keyboard?.entry?.anchor?.focused !== true ||
    keyboard?.entry?.anchor?.keyboardFocus !== "true" ||
    keyboard?.entry?.target?.present !== true ||
    keyboard?.entry?.target?.visible !== true ||
    keyboard?.entry?.target?.disabled !== false ||
    keyboard?.entry?.target?.keyboardFocus !== "true" ||
    !Number.isInteger(keyboard?.entry?.target?.tabIndex) ||
    keyboard.entry.target.tabIndex < 0 ||
    !Number.isInteger(keyboard?.entry?.target?.localOrderIndex) ||
    keyboard.entry.target.localOrderIndex < 0
  ) {
    failures.push(`${definition.id}: keyboard entry did not prove a visible enabled target in the app-local tab order.`);
  }
  const focusDiagnostics = [
    keyboard?.entry?.before,
    keyboard?.entry?.anchor,
    keyboard?.entry?.target,
    ...(keyboard?.entry?.localTabOrder ?? []),
    ...(keyboard?.entry?.observedTraversal ?? []),
    ...(keyboard?.entry?.visibleWindows ?? []).map((window) => ({ name: window.title })),
  ].filter(Boolean);
  if (focusDiagnostics.some((item) => typeof item.name !== "string" || item.name.length > 160)) {
    failures.push(`${definition.id}: keyboard focus diagnostics contain unbounded accessible names.`);
  }
  if (!Array.isArray(keyboard?.entry?.visibleWindows)) {
    failures.push(`${definition.id}: keyboard entry is missing visible-window diagnostics.`);
  }
  const observedEntryTarget = keyboard?.entry?.observedTraversal?.at(-1);
  if (observedEntryTarget?.focusId !== "starting-equipment-start" || observedEntryTarget?.visible !== true) {
    failures.push(`${definition.id}: keyboard entry did not visibly traverse to Start Shopping.`);
  }
  const keyboardActions = new Set((keyboard?.actions ?? []).map((item) => item.action));
  for (const action of [
    "initialize",
    "search",
    "add-item",
    "increase-quantity",
    "decrease-quantity",
    "review-purchases",
    "acknowledge-handoff",
    "forced-apply",
    "forced-apply-confirm",
    "retry-apply",
    "retry-apply-confirm",
  ]) {
    if (!keyboardActions.has(action)) failures.push(`${definition.id}: keyboard flow is missing ${action}.`);
  }
  const focus = keyboard?.focus ?? [];
  if (focus.length < 5 || focus.some((item) => item.visible !== true || !item.focusId)) {
    failures.push(`${definition.id}: visible focus was not retained across the owner flow.`);
  }
  const itemName = entry.item?.name;
  const accessibleNames = entry.item?.accessibleNames ?? {};
  if (typeof itemName !== "string" || !itemName.trim()) {
    failures.push(`${definition.id}: exact catalogue item name is missing.`);
  }
  for (const key of ["preview", "buy", "decrease", "increase", "remove"]) {
    if (
      typeof itemName !== "string" ||
      !itemName.trim() ||
      typeof accessibleNames[key] !== "string" ||
      !accessibleNames[key].includes(itemName)
    ) {
      failures.push(`${definition.id}: ${key} control lacks the item-specific accessible name for ${itemName}.`);
    }
  }
  for (const [name, change] of Object.entries(entry.liveRegionChanges ?? {})) {
    if (!change || typeof change.before !== "string" || typeof change.after !== "string" || change.before === change.after || !change.after.trim()) {
      failures.push(`${definition.id}: ${name} live region did not announce a real state change.`);
    }
  }
  for (const required of ["catalogue", "cart", "review", "failure"]) {
    if (!(required in (entry.liveRegionChanges ?? {}))) {
      failures.push(`${definition.id}: missing ${required} live-region evidence.`);
    }
  }
  if (
    entry.failure?.role !== "alert" ||
    entry.failure?.ariaLive !== "assertive" ||
    entry.failure?.focusId !== "starting-equipment-status" ||
    entry.failure?.focused !== true ||
    (definition.stateAnchors?.["forced-failure"] &&
      !entry.failure?.text?.includes(definition.stateAnchors["forced-failure"]))
  ) {
    failures.push(`${definition.id}: forced failure was not localized, assertively announced, and focused.`);
  }
  if (entry.receipt?.rendered !== true || entry.receipt?.itemRowCount < 1 || !entry.receipt?.accessibleName) {
    failures.push(`${definition.id}: durable acquisition receipt was not rendered with named item content.`);
  }

  const stateEntries = entry.states ?? [];
  if (
    stateEntries.length !== WF43_STATE_IDS.length ||
    JSON.stringify(stateEntries.map((state) => state.id)) !== JSON.stringify(WF43_STATE_IDS)
  ) {
    failures.push(`${definition.id}: required experience state matrix is incomplete or reordered.`);
  }
  const states = new Map(stateEntries.map((state) => [state.id, state]));
  for (const stateId of WF43_STATE_IDS) {
    const state = states.get(stateId);
    if (!state) continue;
    if (!state.text?.trim()) failures.push(`${definition.id}/${stateId}: state rendered no readable text.`);
    const localeAnchor = definition.stateAnchors?.[stateId];
    if (localeAnchor && !state.text.includes(localeAnchor)) {
      failures.push(`${definition.id}/${stateId}: state did not render its locale-specific anchor ${localeAnchor}.`);
    }
    if (definition.id === "cn" && !/[\u3400-\u9fff]/u.test(state.text)) {
      failures.push(`${definition.id}/${stateId}: state fell back to content without Chinese characters.`);
    }
    if ((state.rawLocalizationKeys ?? []).length > 0) {
      failures.push(`${definition.id}/${stateId}: state rendered raw localization keys.`);
    }
    const widthEntries = state.widths ?? [];
    if (
      widthEntries.length !== WF43_APP_WIDTHS.length ||
      JSON.stringify(widthEntries.map((sample) => sample.requestedAppWidth)) !== JSON.stringify(WF43_APP_WIDTHS)
    ) {
      failures.push(`${definition.id}/${stateId}: frozen width evidence is incomplete or reordered.`);
    }
    const widths = new Map(widthEntries.map((sample) => [sample.requestedAppWidth, sample]));
    for (const requestedWidth of WF43_APP_WIDTHS) {
      const sample = widths.get(requestedWidth);
      if (!sample) continue;
      if (Math.abs(sample.observedAppWidth - requestedWidth) > 2) {
        failures.push(`${definition.id}/${stateId}/${requestedWidth}: app width was not applied exactly.`);
      }
      for (const key of ["rootOverflow", "stageOverflow", "paneOverflow"]) {
        if (!Number.isFinite(sample[key]) || sample[key] > 1) {
          failures.push(`${definition.id}/${stateId}/${requestedWidth}: ${key} exceeded one pixel.`);
        }
      }
      if (sample.criticalNodeCount < 1 || sample.clippedCriticalNodes?.length > 0) {
        failures.push(`${definition.id}/${stateId}/${requestedWidth}: critical content was absent or horizontally clipped.`);
      }
    }
  }
}
