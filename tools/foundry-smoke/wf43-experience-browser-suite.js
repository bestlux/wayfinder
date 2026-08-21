/* global CSS, HTMLElement, document, game, getComputedStyle, requestAnimationFrame */

const WF43_PURPOSE = "wf08043-live-experience";
const WF43_REVIEWED_SNAPSHOT_PURPOSE = "wf08043-reviewed-draft-snapshot";

globalThis.__prepareWayfinderWf43Experience = async function prepareWf43Experience({
  allowDestructive,
  definitions,
  expectedWorldId,
  fixturePrefix,
  moduleId,
  packsSetting,
  playerName,
  policySetting,
  runId,
  smokeCase,
}) {
  assertWf43World(expectedWorldId);
  if (!allowDestructive || !game.user?.isGM) {
    throw new Error("WF-080-43 setup requires destructive opt-in and a current GM.");
  }
  if (typeof globalThis.__prepareWayfinderEquipmentProfile !== "function") {
    throw new Error("WF-080-43 requires the shared Foundry smoke fixture suite.");
  }
  const player = game.users.find((user) => user.name === playerName && !user.isGM && user.id !== game.user.id);
  if (!player) throw new Error("WF-080-43 could not resolve the exact distinct non-GM owner.");
  const snapshots = {
    actorCount: game.actors.size,
    language: structuredClone(game.settings.get("core", "language")),
    packs: structuredClone(game.settings.get("pf2e", packsSetting)),
    policy: structuredClone(game.settings.get(moduleId, policySetting)),
  };
  const fixtures = [];
  try {
    for (const definition of definitions) {
      const profile = { id: `wf43-experience-${definition.id}-${runId}`, stepId: definition.fixture.stepId };
      const prepared = await globalThis.__prepareWayfinderEquipmentProfile({
        allowDestructive,
        expectedWorldId,
        fixturePrefix: `${fixturePrefix} - ${definition.id}`,
        moduleId,
        playerName,
        profile,
        runId,
        smokeCase,
      });
      const actor = game.actors.get(prepared.actorId);
      if (!actor) throw new Error(`WF-080-43 lost prepared ${definition.id} actor.`);
      const marker = {
        schemaVersion: 1,
        purpose: WF43_PURPOSE,
        runId,
        locale: definition.id,
        definitionFingerprint: definition.definitionFingerprint,
        fixtureName: actor.name,
        profileId: profile.id,
      };
      await actor.setFlag(moduleId, "smokeWf43Experience", marker);
      fixtures.push({
        actorId: actor.id,
        definitionFingerprint: definition.definitionFingerprint,
        fixtureName: actor.name,
        locale: definition.id,
        profileId: profile.id,
      });
    }
  } catch (error) {
    for (const fixture of fixtures) {
      const actor = game.actors.get(fixture.actorId);
      const marker = actor?.getFlag(moduleId, "smokeWf43Experience");
      if (marker?.purpose === WF43_PURPOSE && marker?.runId === runId) await actor.delete();
    }
    await game.settings.set(moduleId, policySetting, snapshots.policy);
    await game.settings.set("pf2e", packsSetting, snapshots.packs);
    throw error;
  }
  return {
    fixtures,
    snapshots,
    runtime: wf43Runtime(moduleId, expectedWorldId),
    users: {
      gm: wf43User(game.user),
      player: wf43User(player),
    },
  };
};

globalThis.__openWayfinderWf43Experience = async function openWf43Experience({
  expectedPlayerId,
  expectedWorldId,
  fixture,
  moduleId,
  runId,
}) {
  assertWf43World(expectedWorldId);
  if (game.user?.isGM || game.user?.id !== expectedPlayerId) {
    throw new Error("WF-080-43 execution requires the exact non-GM owner.");
  }
  const actor = wf43FixtureActor(fixture, moduleId, runId);
  if (!actor.isOwner) throw new Error("WF-080-43 actor is not owned by the exact player.");
  await closeActorApps(actor);
  return globalThis.__openWayfinderEquipmentProfile({
    actorId: actor.id,
    expectedPlayerId,
    expectedWorldId,
    moduleId,
    profileId: fixture.profileId,
    runId,
  });
};

globalThis.__setWayfinderWf43CorePack = async function setWf43CorePack({
  enabled,
  expectedWorldId,
  moduleId,
  packsSetting,
  runId,
  fixture,
}) {
  assertWf43World(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-43 pack mutation requires a GM.");
  wf43FixtureActor(fixture, moduleId, runId);
  const packs = structuredClone(game.settings.get("pf2e", packsSetting) ?? {});
  packs.equipment = { ...(packs.equipment ?? {}) };
  if (enabled) delete packs.equipment["pf2e.equipment-srd"];
  else packs.equipment["pf2e.equipment-srd"] = { load: false };
  await game.settings.set("pf2e", packsSetting, packs);
  return structuredClone(game.settings.get("pf2e", packsSetting));
};

globalThis.__restoreWayfinderWf43CorePack = async function restoreWf43CorePack({
  expectedWorldId,
  packsSetting,
  snapshot,
}) {
  assertWf43World(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-43 pack restoration requires a GM.");
  await game.settings.set("pf2e", packsSetting, snapshot);
  return wf43Same(game.settings.get("pf2e", packsSetting), snapshot);
};

globalThis.__prepareWayfinderWf43Handoff = async function prepareWf43Handoff({
  expectedWorldId,
  fixture,
  moduleId,
  runId,
}) {
  assertWf43World(expectedWorldId);
  if (game.user?.isGM) throw new Error("WF-080-43 handoff projection requires the non-GM owner.");
  const actor = wf43FixtureActor(fixture, moduleId, runId);
  await closeActorApps(actor);
  const inMemoryDraft = structuredClone(actor.getFlag(moduleId, "draft"));
  if (inMemoryDraft?.acquisition?.disposition?.kind !== "purchase-ledger") {
    throw new Error("WF-080-43 handoff projection requires the reviewed purchase draft.");
  }
  const durableCandidate = wf43JsonDurableClone(inMemoryDraft);
  await actor.setFlag(moduleId, "draft", durableCandidate);
  const durableReviewedDraft = wf43JsonDurableClone(actor.getFlag(moduleId, "draft"));
  wf43AssertExactDurableSnapshot(
    durableCandidate,
    durableReviewedDraft,
    "WF-080-43 reviewed snapshot preparation persistence changed",
  );
  const reviewedSnapshot = wf43CreateReviewedSnapshotToken({
    actor,
    draft: durableReviewedDraft,
    expectedWorldId,
    fixture,
    runId,
  });
  const { recordConfiguredItemHandoff } = await import(
    `/modules/${moduleId}/scripts/wayfinder/domain/acquisition-draft.js`
  );
  const draft = structuredClone(durableReviewedDraft);
  draft.acquisition = recordConfiguredItemHandoff(draft.acquisition, {
    code: "unsafe-configured-item",
    sourceUuid: fixture.itemSourceUuid,
    itemName: fixture.itemName,
    issue: "specific-magic-item",
  });
  await actor.setFlag(moduleId, "draft", draft);
  return {
    kind: draft.acquisition.disposition.kind,
    actorId: actor.id,
    reviewedSnapshot,
    provenance: wf43ReviewedSnapshotProvenance(reviewedSnapshot),
  };
};

globalThis.__restoreWayfinderWf43ReviewedDraft = async function restoreWf43ReviewedDraft({
  expectedWorldId,
  fixture,
  moduleId,
  reviewedSnapshot,
  runId,
}) {
  assertWf43World(expectedWorldId);
  if (game.user?.isGM) throw new Error("WF-080-43 draft restoration requires the non-GM owner.");
  const actor = wf43FixtureActor(fixture, moduleId, runId);
  await closeActorApps(actor);
  const reviewed = wf43ValidateReviewedSnapshotToken(reviewedSnapshot, {
    actor,
    expectedWorldId,
    fixture,
    runId,
  });
  const currentDraft = structuredClone(actor.getFlag(moduleId, "draft"));
  const handoff = currentDraft?.acquisition?.disposition;
  if (
    handoff?.kind !== "handoff" ||
    handoff.handoff?.kind !== "pf2e-sheet" ||
    !wf43Same(handoff.handoff?.reasons, [reviewedSnapshot.subject.configuredItem])
  ) {
    throw new Error("WF-080-43 reviewed snapshot restore requires the configured-item handoff disposition.");
  }
  try {
    await actor.unsetFlag(moduleId, "draft");
  } catch (error) {
    throw new Error(
      `WF-080-43 reviewed snapshot restore could not clear the guarded draft flag (${wf43ValueClass(error)}).`,
      { cause: error },
    );
  }
  if (actor.getFlag(moduleId, "draft") !== undefined) {
    throw new Error("WF-080-43 reviewed snapshot restore did not clear the guarded draft flag exactly.");
  }
  try {
    await actor.setFlag(moduleId, "draft", reviewed);
  } catch (error) {
    throw new Error(
      `WF-080-43 reviewed snapshot restore could not set the guarded draft flag (${wf43ValueClass(error)}).`,
      { cause: error },
    );
  }
  const durable = wf43JsonDurableClone(actor.getFlag(moduleId, "draft"));
  wf43AssertExactDurableSnapshot(
    reviewed,
    durable,
    "WF-080-43 reviewed snapshot restore persistence changed",
  );
  if (wf43Fingerprint(durable) !== reviewedSnapshot.draftFingerprint) {
    throw new Error("WF-080-43 reviewed snapshot restore fingerprint changed after exact durable re-read.");
  }
  return {
    kind: reviewed.acquisition.disposition.kind,
    actorId: actor.id,
    provenance: wf43ReviewedSnapshotProvenance(reviewedSnapshot),
  };
};

globalThis.__measureWayfinderWf43State = async function measureWf43State({ actorId, stateId, width }) {
  const actor = game.actors.get(actorId);
  const app = wf43ActorApp(actor);
  app.setPosition?.({ width });
  if (!app.setPosition) app.element.style.width = `${width}px`;
  await wf43Frames(2);
  const root = app.element;
  const shell = root.querySelector(".wayfinder-shell") ?? root;
  const stage = root.querySelector(".wizard-stage") ?? root;
  const pane = root.querySelector(".starting-equipment-pane, .wayfinder-acquisition-receipt") ?? stage;
  const critical = [...root.querySelectorAll(wf43CriticalSelector(stateId))].filter((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return !node.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
  const stageRect = stage.getBoundingClientRect();
  const clippedCriticalNodes = critical
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < stageRect.left - 1 || rect.right > stageRect.right + 1 || node.scrollWidth - node.clientWidth > 1;
    })
    .map((node) => node.getAttribute("data-wayfinder-focus-id") ?? node.className ?? node.tagName);
  const renderedStrings = wf43RenderedStrings(root);
  return {
    requestedAppWidth: width,
    observedAppWidth: root.getBoundingClientRect().width,
    rootOverflow: shell.scrollWidth - shell.clientWidth,
    stageOverflow: stage.scrollWidth - stage.clientWidth,
    paneOverflow: pane.scrollWidth - pane.clientWidth,
    criticalNodeCount: critical.length,
    clippedCriticalNodes,
    rawLocalizationKeys: wf43RawKeys(renderedStrings),
  };
};

globalThis.__inspectWayfinderWf43State = function inspectWf43State({ actorId }) {
  const root = wf43ActorApp(game.actors.get(actorId)).element;
  const text = (root.innerText ?? "").trim();
  return {
    text,
    rawLocalizationKeys: wf43RawKeys(wf43RenderedStrings(root)),
    observedLocale: String(game.i18n?.lang ?? ""),
  };
};

globalThis.__inspectWayfinderWf43Item = function inspectWf43Item({ actorId, sourceUuid }) {
  const root = wf43ActorApp(game.actors.get(actorId)).element;
  const item = root.querySelector(`[data-equipment-item][data-source-uuid="${CSS.escape(sourceUuid)}"]`);
  const line = root.querySelector(`.equipment-cart-line [data-wayfinder-action="remove-equipment-line"]`)?.closest(
    ".equipment-cart-line",
  );
  const name = (item?.querySelector("strong") ?? line?.querySelector("strong"))?.textContent?.trim() ?? "";
  const label = (selector) => root.querySelector(selector)?.getAttribute("aria-label")?.trim() ?? "";
  return {
    name,
    accessibleNames: {
      preview: label(`[data-wayfinder-action="preview-equipment-item"][data-source-uuid="${CSS.escape(sourceUuid)}"]`),
      buy: label(`[data-wayfinder-action="add-equipment-item"][data-source-uuid="${CSS.escape(sourceUuid)}"]`),
      decrease: label('[data-wayfinder-action="change-equipment-quantity"][data-delta="-1"]'),
      increase: label('[data-wayfinder-action="change-equipment-quantity"][data-delta="1"]'),
      remove: label('[data-wayfinder-action="remove-equipment-line"]'),
    },
  };
};

globalThis.__inspectWayfinderWf43LiveRegions = function inspectWf43LiveRegions({ actorId }) {
  const root = wf43ActorApp(game.actors.get(actorId)).element;
  const text = (selector) => root.querySelector(selector)?.textContent?.trim() ?? "";
  return {
    catalogue: text(".equipment-result-count[role='status']"),
    cart: text(".equipment-cart [role='status'][aria-live='polite']"),
    review: text(".status-note[role='status'] span"),
    failure: text(".status-note[role='alert'] span"),
  };
};

globalThis.__inspectWayfinderWf43Focus = function inspectWf43Focus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return { focusId: "", name: "", visible: false };
  const style = getComputedStyle(active);
  const descriptor = wf43FocusDescriptor(active);
  return {
    ...descriptor,
    focusId: descriptor.focusId || descriptor.action || descriptor.tag,
    visible:
      active.matches(":focus-visible") &&
      ((style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none"),
  };
};

globalThis.__inspectWayfinderWf43TabTraversal = function inspectWf43TabTraversal({
  key,
  limit,
  observedTraversal,
  observedTraversalCount,
  scopeSelector,
  targetSelector,
}) {
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
  const focusable = scope ? wf43FocusableElements(scope) : [];
  const target = document.querySelector(targetSelector);
  const localOrderIndex = focusable.indexOf(target);
  const localTabOrderLimit = 80;
  return {
    active: wf43FocusDescriptor(document.activeElement),
    key,
    limit,
    localOrderIndex,
    localTabOrder: focusable.slice(0, localTabOrderLimit).map(wf43FocusDescriptor),
    localTabOrderCount: focusable.length,
    localTabOrderTruncated: focusable.length > localTabOrderLimit,
    observedTraversal,
    observedTraversalCount,
    observedTraversalTruncated: observedTraversalCount > observedTraversal.length,
    scopeSelector,
    target: wf43KeyboardTarget(target),
    targetSelector,
  };
};

globalThis.__enterWayfinderWf43KeyboardScope = function enterWf43KeyboardScope({
  actorId,
  action = "initialize",
  anchorSelector = "[data-wayfinder-step-heading]",
  mode = "scoped-app-entry",
  state = "policy",
  targetSelector,
}) {
  const root = wf43ActorApp(game.actors.get(actorId)).element;
  const target = root.querySelector(targetSelector);
  const before = wf43FocusDescriptor(document.activeElement);
  const localTabOrder = wf43FocusableElements(root).map(wf43FocusDescriptor);
  const anchor = root.querySelector(anchorSelector);
  if (!(anchor instanceof HTMLElement)) throw new Error("WF-080-43 could not resolve its app keyboard-entry anchor.");
  anchor.focus();
  const targetEvidence = wf43KeyboardTarget(target);
  return {
    action,
    mode,
    state,
    focusMethod: "programmatic-harness-anchor-before-keyboard-actions",
    before,
    visibleWindows: wf43VisibleWindowEvidence(),
    anchor: { ...wf43FocusDescriptor(anchor), focused: document.activeElement === anchor },
    target: {
      ...targetEvidence,
      localOrderIndex: localTabOrder.findIndex(
        (entry) =>
          entry.focusId === targetEvidence.focusId &&
          entry.action === targetEvidence.action &&
          entry.name === targetEvidence.name,
      ),
    },
    localTabOrder,
  };
};

globalThis.__inspectWayfinderWf43Failure = function inspectWf43Failure({ actorId }) {
  const root = wf43ActorApp(game.actors.get(actorId)).element;
  const failure = root.querySelector('[data-wayfinder-focus-id="starting-equipment-status"][role="alert"]');
  const target = wf43KeyboardTarget(failure);
  const rawText = failure?.textContent?.trim() ?? "";
  return {
    role: failure?.getAttribute("role") ?? null,
    ariaLive: failure?.getAttribute("aria-live") ?? null,
    focusId: failure?.getAttribute("data-wayfinder-focus-id") ?? null,
    focused: document.activeElement === failure,
    keyboardFocus: target.keyboardFocus,
    tabIndex: target.tabIndex,
    visible: target.visible,
    text: wf43BoundedText(rawText),
    textLength: rawText.length,
    textTruncated: wf43BoundedText(rawText).length < rawText.length,
  };
};

globalThis.__inspectWayfinderWf43Receipt = function inspectWf43Receipt({ actorId }) {
  const root = wf43ActorApp(game.actors.get(actorId)).element;
  const receipt = root.querySelector(".wayfinder-acquisition-receipt");
  return {
    rendered: Boolean(receipt),
    accessibleName: receipt?.getAttribute("aria-label")?.trim() ?? "",
    itemRowCount: receipt?.querySelectorAll(".acquisition-receipt-items [role='listitem']").length ?? 0,
  };
};

globalThis.__cleanupWayfinderWf43Experience = async function cleanupWf43Experience({
  allowDestructive,
  expectedWorldId,
  fixtures,
  moduleId,
  packsSetting,
  policySetting,
  runId,
  snapshots,
}) {
  assertWf43World(expectedWorldId);
  if (!allowDestructive || !game.user?.isGM) {
    throw new Error("WF-080-43 cleanup requires destructive opt-in and a current GM.");
  }
  const failures = [];
  let actorsDeleted = 0;
  let exactFixturesMatched = true;
  try {
    await game.settings.set(moduleId, policySetting, snapshots.policy);
  } catch (error) {
    failures.push(`equipment policy restoration failed: ${wf43Error(error)}`);
  }
  try {
    await game.settings.set("pf2e", packsSetting, snapshots.packs);
  } catch (error) {
    failures.push(`PF2E pack restoration failed: ${wf43Error(error)}`);
  }
  for (const fixture of fixtures) {
    try {
      const actor = wf43FixtureActor(fixture, moduleId, runId);
      await closeActorApps(actor);
      await actor.delete();
      actorsDeleted += 1;
    } catch (error) {
      exactFixturesMatched = false;
      failures.push(`${fixture?.locale ?? "unknown"} exact actor cleanup failed: ${wf43Error(error)}`);
    }
  }
  return {
    actorsDeleted,
    actorsMissingAfterCleanup: fixtures.every((fixture) => !game.actors.has(fixture.actorId)),
    actorCountRestored: game.actors.size === snapshots.actorCount,
    policyRestored: wf43Same(game.settings.get(moduleId, policySetting), snapshots.policy),
    packsRestored: wf43Same(game.settings.get("pf2e", packsSetting), snapshots.packs),
    exactFixturesMatched,
    restorationFailures: failures,
  };
};

globalThis.__verifyWayfinderWf43Restoration = function verifyWf43Restoration({
  expectedWorldId,
  languageSnapshot,
  moduleId,
  packsSetting,
  policySetting,
  snapshots,
}) {
  assertWf43World(expectedWorldId);
  if (!game.user?.isGM) throw new Error("WF-080-43 restoration verification requires a GM.");
  return {
    languageRestored:
      wf43Same(game.settings.get("core", "language"), languageSnapshot) &&
      String(game.i18n?.lang ?? "") === String(languageSnapshot),
    policyRestored: wf43Same(game.settings.get(moduleId, policySetting), snapshots.policy),
    packsRestored: wf43Same(game.settings.get("pf2e", packsSetting), snapshots.packs),
  };
};

globalThis.__createWayfinderWf43ReviewedSnapshotToken = wf43CreateReviewedSnapshotToken;

function wf43CreateReviewedSnapshotToken({ actor, draft, expectedWorldId, fixture, runId }) {
  if (draft?.acquisition?.disposition?.kind !== "purchase-ledger") {
    throw new Error("WF-080-43 reviewed snapshot requires the purchase-ledger disposition.");
  }
  const snapshot = wf43JsonDurableClone(draft);
  return {
    schemaVersion: 1,
    purpose: WF43_REVIEWED_SNAPSHOT_PURPOSE,
    subject: {
      actorId: actor.id,
      definitionFingerprint: fixture.definitionFingerprint,
      dispositionKind: "purchase-ledger",
      configuredItem: {
        code: "unsafe-configured-item",
        sourceUuid: fixture.itemSourceUuid,
        itemName: fixture.itemName,
        issue: "specific-magic-item",
      },
      fixtureName: fixture.fixtureName,
      locale: fixture.locale,
      profileId: fixture.profileId,
      runId,
      worldId: expectedWorldId,
    },
    draftFingerprint: wf43Fingerprint(snapshot),
    draft: snapshot,
  };
}

function wf43ValidateReviewedSnapshotToken(token, { actor, expectedWorldId, fixture, runId }) {
  if (!token || typeof token !== "object") {
    throw new Error("WF-080-43 reviewed snapshot token is required.");
  }
  if (token.schemaVersion !== 1 || token.purpose !== WF43_REVIEWED_SNAPSHOT_PURPOSE) {
    throw new Error("WF-080-43 reviewed snapshot token schema or purpose changed.");
  }
  if (token.subject?.worldId !== expectedWorldId || token.subject.worldId !== game.world?.id) {
    throw new Error("WF-080-43 reviewed snapshot token world changed.");
  }
  if (token.subject?.actorId !== actor.id || token.subject.fixtureName !== fixture.fixtureName) {
    throw new Error("WF-080-43 reviewed snapshot token actor changed.");
  }
  if (token.subject?.runId !== runId) {
    throw new Error("WF-080-43 reviewed snapshot token run changed.");
  }
  if (
    token.subject?.locale !== fixture.locale ||
    token.subject.profileId !== fixture.profileId ||
    token.subject.definitionFingerprint !== fixture.definitionFingerprint ||
    !wf43Same(token.subject.configuredItem, {
      code: "unsafe-configured-item",
      sourceUuid: fixture.itemSourceUuid,
      itemName: fixture.itemName,
      issue: "specific-magic-item",
    })
  ) {
    throw new Error("WF-080-43 reviewed snapshot token subject changed.");
  }
  if (
    token.subject?.dispositionKind !== "purchase-ledger" ||
    token.draft?.acquisition?.disposition?.kind !== "purchase-ledger"
  ) {
    throw new Error("WF-080-43 reviewed snapshot token disposition changed.");
  }
  const durableDraft = wf43JsonDurableClone(token.draft);
  const durableMismatch = wf43FirstMismatch(token.draft, durableDraft);
  if (durableMismatch) {
    throw new Error(
      `WF-080-43 reviewed snapshot token draft is not durable: ${JSON.stringify(durableMismatch)}`,
    );
  }
  if (token.draftFingerprint !== wf43Fingerprint(durableDraft)) {
    throw new Error("WF-080-43 reviewed snapshot token draft changed.");
  }
  return durableDraft;
}

function wf43ReviewedSnapshotProvenance(token) {
  return {
    schemaVersion: token.schemaVersion,
    purpose: token.purpose,
    actorId: token.subject.actorId,
    dispositionKind: token.subject.dispositionKind,
    locale: token.subject.locale,
    profileId: token.subject.profileId,
    runId: token.subject.runId,
    worldId: token.subject.worldId,
    draftFingerprint: token.draftFingerprint,
  };
}

function wf43Fingerprint(value) {
  const bytes = new TextEncoder().encode(wf43Canonical(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function wf43JsonDurableClone(value) {
  wf43AssertJsonDurable(value, "$", new Set());
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at $ (${wf43ValueClass(value)}).`);
  }
  return JSON.parse(serialized);
}

function wf43AssertJsonDurable(value, path, ancestors) {
  if (value === null || value === undefined || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (${wf43ValueClass(value)}).`);
  }
  if (typeof value !== "object") {
    throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (${wf43ValueClass(value)}).`);
  }
  if (ancestors.has(value)) {
    throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (cyclic-object).`);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (${wf43ValueClass(value)}).`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key === "symbol") {
        throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (symbol-keyed-array).`);
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= value.length) {
        throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (custom-keyed-array).`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(
          `WF-080-43 reviewed snapshot is not JSON-durable at ${wf43BoundedPath(`${path}[${index}]`)} (accessor-property).`,
        );
      }
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (${wf43ValueClass(value)}).`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`WF-080-43 reviewed snapshot is not JSON-durable at ${path} (symbol-keyed-object).`);
    }
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (index in value) wf43AssertJsonDurable(value[index], wf43BoundedPath(`${path}[${index}]`), ancestors);
    }
  } else {
    for (const key of Object.keys(value)) {
      wf43AssertJsonDurable(value[key], wf43BoundedPath(`${path}[${JSON.stringify(key)}]`), ancestors);
    }
  }
  ancestors.delete(value);
}

function wf43AssertExactDurableSnapshot(expected, observed, context) {
  const mismatch = wf43FirstMismatch(expected, observed);
  if (mismatch) throw new Error(`${context}: ${JSON.stringify(mismatch)}`);
}

function wf43FirstMismatch(expected, observed, path = "$", missing = Symbol("missing")) {
  if (Object.is(expected, observed)) return null;
  const expectedClass = expected === missing ? "missing" : wf43ValueClass(expected);
  const observedClass = observed === missing ? "missing" : wf43ValueClass(observed);
  if (expectedClass !== observedClass) return { path: wf43BoundedPath(path), expectedClass, observedClass };
  if (Array.isArray(expected) && Array.isArray(observed)) {
    if (expected.length !== observed.length) {
      return { path: wf43BoundedPath(`${path}.length`), expectedClass: "number:integer", observedClass: "number:integer" };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = wf43FirstMismatch(
        index in expected ? expected[index] : missing,
        index in observed ? observed[index] : missing,
        `${path}[${index}]`,
        missing,
      );
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (expected && observed && typeof expected === "object" && typeof observed === "object") {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(observed)])].sort();
    for (const key of keys) {
      const mismatch = wf43FirstMismatch(
        Object.hasOwn(expected, key) ? expected[key] : missing,
        Object.hasOwn(observed, key) ? observed[key] : missing,
        `${path}[${JSON.stringify(key)}]`,
        missing,
      );
      if (mismatch) return mismatch;
    }
    return null;
  }
  return { path: wf43BoundedPath(path), expectedClass, observedClass };
}

function wf43ValueClass(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "number:non-finite";
    return Number.isInteger(value) ? "number:integer" : "number:finite";
  }
  if (typeof value === "object") {
    const name = value?.constructor?.name;
    return name && name !== "Object" ? `object:${wf43BoundedText(name, 40)}` : "object";
  }
  return typeof value;
}

function wf43BoundedPath(path) {
  return path.length <= 160 ? path : `${path.slice(0, 159)}…`;
}

function wf43FixtureActor(fixture, moduleId, runId) {
  const actor = game.actors.get(fixture?.actorId);
  const marker = actor?.getFlag(moduleId, "smokeWf43Experience");
  const profileMarker = actor?.getFlag(moduleId, "equipmentProfileFixture");
  if (
    !actor ||
    actor.name !== fixture?.fixtureName ||
    marker?.purpose !== WF43_PURPOSE ||
    marker?.runId !== runId ||
    marker?.locale !== fixture?.locale ||
    marker?.definitionFingerprint !== fixture?.definitionFingerprint ||
    marker?.profileId !== fixture?.profileId ||
    profileMarker?.profileId !== fixture?.profileId ||
    profileMarker?.runId !== runId
  ) {
    throw new Error("WF-080-43 refused an actor with changed guarded identity.");
  }
  return actor;
}

function wf43ActorApp(actor) {
  const app = actor && Object.values(actor.apps ?? {}).find((candidate) => candidate?.element?.classList?.contains("wayfinder-app"));
  if (!app?.element?.isConnected) throw new Error("WF-080-43 could not resolve the live actor-bound Wayfinder app.");
  return app;
}

async function closeActorApps(actor) {
  for (const app of Object.values(actor?.apps ?? {})) {
    if (app?.element?.classList?.contains("wayfinder-app")) await app.close?.({ animate: false });
  }
}

function wf43CriticalSelector(stateId) {
  switch (stateId) {
    case "policy":
      return ".equipment-policy-summary, [data-wayfinder-focus-id='starting-equipment-start']";
    case "browse-cart":
      return ".equipment-catalogue, .equipment-cart, [data-wayfinder-focus-id='starting-equipment-review']";
    case "review":
      return ".equipment-cart, [data-wayfinder-focus-id='starting-equipment-confirm-kit'], [data-wayfinder-action='apply-draft']";
    case "handoff":
      return "[data-wayfinder-focus-id='starting-equipment-handoff'], [data-wayfinder-focus-id='starting-equipment-acknowledge-handoff']";
    case "forced-failure":
      return "[data-wayfinder-focus-id='starting-equipment-status'], [data-wayfinder-action='apply-draft']";
    case "receipt":
      return ".wayfinder-acquisition-receipt, .acquisition-receipt-summary, .acquisition-receipt-items";
    default:
      throw new Error(`Unknown WF-080-43 state ${stateId}.`);
  }
}

function wf43RawKeys(text) {
  return [...new Set(String(text).match(/wayfinder-pf2e(?:\.[A-Za-z0-9_-]+)+/gu) ?? [])].sort();
}

function wf43KeyboardTarget(element) {
  if (!(element instanceof HTMLElement)) {
    return {
      present: false,
      visible: false,
      disabled: null,
      tabIndex: null,
      keyboardFocus: null,
      focusId: "",
      action: "",
      dialogAction: "",
      name: "",
    };
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const disabled =
    ("disabled" in element && element.disabled === true) || element.getAttribute("aria-disabled") === "true";
  return {
    ...wf43FocusDescriptor(element),
    present: true,
    visible:
      !element.hidden &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0,
    disabled,
    tabIndex: element.tabIndex,
    keyboardFocus: element.dataset.keyboardFocus ?? null,
  };
}

function wf43FocusableElements(root) {
  return [...root.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")].filter((element) => {
    const target = wf43KeyboardTarget(element);
    return target.visible && !target.disabled && element.tabIndex >= 0;
  });
}

function wf43FocusDescriptor(element) {
  if (!(element instanceof HTMLElement)) {
    return {
      focusId: "",
      action: "",
      dialogAction: "",
      name: "",
      nameLength: 0,
      nameTruncated: false,
      stepHeading: "",
      tag: "",
      keyboardFocus: null,
    };
  }
  const rawName = element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
  const name = wf43BoundedText(rawName);
  return {
    focusId: element.dataset.wayfinderFocusId ?? "",
    action: element.dataset.wayfinderAction ?? "",
    dialogAction: element.dataset.action ?? "",
    name,
    nameLength: rawName.length,
    nameTruncated: name.length < rawName.length,
    stepHeading: element.dataset.wayfinderStepHeading ?? "",
    tag: element.tagName,
    keyboardFocus: element.dataset.keyboardFocus ?? null,
  };
}

function wf43VisibleWindowEvidence() {
  return [...document.querySelectorAll(".application")]
    .filter((element) => wf43KeyboardTarget(element).visible)
    .map((element) => ({
      id: element.id,
      classes: [...element.classList].sort(),
      title: wf43BoundedText(element.querySelector(".window-title")?.textContent ?? element.getAttribute("aria-label") ?? ""),
      ariaModal: element.getAttribute("aria-modal"),
      zIndex: getComputedStyle(element).zIndex,
    }));
}

function wf43BoundedText(value, limit = 160) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function wf43RenderedStrings(root) {
  const attributes = [...root.querySelectorAll("[aria-label], [title], [placeholder]")].flatMap((node) =>
    ["aria-label", "title", "placeholder"]
      .map((name) => node.getAttribute(name))
      .filter((value) => typeof value === "string" && value.trim()),
  );
  return [root.innerText ?? "", ...attributes].join("\n");
}

function assertWf43World(expectedWorldId) {
  if (!String(expectedWorldId ?? "").trim() || game.world?.id !== expectedWorldId) {
    throw new Error(`WF-080-43 expected world ${expectedWorldId}, got ${game.world?.id ?? "unknown"}.`);
  }
}

function wf43Runtime(moduleId, worldId) {
  const moduleRecord = game.modules.get(moduleId);
  return {
    foundryVersion: String(game.version ?? ""),
    pf2eVersion: String(game.system?.version ?? ""),
    moduleVersion: String(moduleRecord?.version ?? moduleRecord?.manifest?.version ?? ""),
    worldId,
  };
}

function wf43User(user) {
  return { id: user.id, name: user.name, role: Number(user.role), isGM: Boolean(user.isGM) };
}

function wf43Same(left, right) {
  return wf43Canonical(left) === wf43Canonical(right);
}

function wf43Canonical(value) {
  if (Array.isArray(value)) return `[${value.map(wf43Canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${wf43Canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function wf43Error(error) {
  return error instanceof Error ? error.message : String(error);
}

function wf43Frames(count) {
  return new Promise((resolve) => {
    const next = (remaining) => (remaining <= 0 ? resolve() : requestAnimationFrame(() => next(remaining - 1)));
    next(count);
  });
}
