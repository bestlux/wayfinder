/* global document, game, HTMLButtonElement, MutationObserver */

(() => {
  const clone = (value) => structuredClone(value);
  const slots = { first: "class-branch-first-implement-and-esoterica-level-1", second: "class-branch-second-implement-level-5" };
  const fixed = [
    { name: "Amulet", featureId: "PoclGJ7BCEyIuqJe", itemId: "GbR8rgZMCVBn3Evb" },
    { name: "Bell", featureId: "DK1LCE5pd0YCY11c", itemId: "f0A1zqCFiUJuXc9U" },
    { name: "Chalice", featureId: "1vgFGSnn0DIBmK7j", itemId: "FodtZGtCsH9NDXlC" },
    { name: "Lantern", featureId: "AltwHU7hCqTwpn48", itemId: "AtiSK2lwEi25f3PT" },
    { name: "Mirror", featureId: "N6KvTbaRsphc0Ymb", itemId: "NpNDlH8YE2i67vQV" },
    { name: "Regalia", featureId: "DhdLzrcMvB93Rjmt", itemId: "7FzmHy7PugYNGkoX" },
    { name: "Tome", featureId: "MyN1cQgE0HsLF20e", itemId: "V9mhR91d2qWa3dGh" },
    { name: "Wand", featureId: "pDxdE8S8QJV2PGiB", itemId: "ZjApNlusD5oZkPTJ" },
  ];
  const featureUuid = (entry) => `Compendium.pf2e.classfeatures.Item.${entry.featureId}`;
  const itemUuid = (entry) => `Compendium.pf2e.equipment-srd.Item.${entry.itemId}`;
  const sourceId = (item) => item.sourceId ?? item.flags?.core?.sourceId ?? item._stats?.compendiumSource ?? null;
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  async function digest(value) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function guard(payload, isGM) {
    if (!payload.allowDestructive || !payload.expectedWorldId || game.world.id !== payload.expectedWorldId || Boolean(game.user.isGM) !== isGM) throw new Error("Issue 47 world, executor, or cleanup guard failed.");
  }
  function actorFor(payload) {
    guard(payload, false);
    const actor = game.actors.get(payload.setup.actorId);
    const marker = actor?.getFlag(payload.moduleId, "equipmentProfileFixture");
    if (!actor || !actor.isOwner || game.user.id !== payload.setup.users.player.id || actor.name !== payload.setup.actorName || !actor.name.startsWith("WF Smoke Harness - Issue 47 implements - ") || marker?.profileId !== payload.definition.id || marker?.runId !== payload.runId) throw new Error("Issue 47 fixture identity or owner changed.");
    return actor;
  }
  const draftFor = (actor, moduleId) => clone(actor.getFlag(moduleId, "draft"));
  const acquisitionIdentity = (acquisition) => acquisition ? { draftId: acquisition.draftId, batchId: acquisition.batchId, manifestId: acquisition.manifestId } : null;
  function inventory(actor, moduleId) {
    return {
      copper: Number(actor.inventory?.currency?.copperValue ?? 0),
      items: actor.items.map((item) => ({ id: item.id, sourceUuid: sourceId(item), name: item.name, type: item.type, quantity: item.isOfType?.("physical") ? Number(item.quantity ?? item.system?.quantity ?? 0) : null, grantedBy: clone(item.flags?.pf2e?.grantedBy ?? null), itemGrants: clone(item.flags?.pf2e?.itemGrants ?? {}), location: typeof item.system?.location === "string" ? item.system.location : null, acquisition: clone(item.getFlag(moduleId, "acquisition") ?? null) })).sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
  async function waitFor(read, label, timeoutMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Issue 47 timed out: ${label}.`);
  }
  async function openApp(actor, moduleId) {
    const { WayfinderApp } = await import(`/modules/${moduleId}/scripts/wayfinder-app.js`);
    WayfinderApp.open(actor);
    const app = await waitFor(() => Object.values(actor.apps ?? {}).find((entry) => entry instanceof WayfinderApp), "actor-bound app");
    await waitFor(() => app.element?.isConnected, "connected app");
    return app;
  }
  function button(app, selector) {
    const value = app.element?.querySelector(selector);
    if (!(value instanceof HTMLButtonElement) || value.disabled) throw new Error(`Issue 47 enabled control unavailable: ${selector}.`);
    return value;
  }
  async function action(app, selector, read, label, timeoutMs) {
    await waitFor(() => {
      const candidate = app.element?.querySelector(selector);
      return candidate instanceof HTMLButtonElement && !candidate.disabled ? candidate : null;
    }, `enabled ${selector}`);
    await globalThis.__issue47Click(selector);
    return waitFor(read, label || selector, timeoutMs);
  }
  async function step(app, stepId) {
    await action(app, `[data-wayfinder-action="select-step"][data-step-id="${stepId}"]`, () => app.element?.querySelector(`.option-browser-scroll[data-step-id="${stepId}"]`) || app.element?.querySelector(`.class-choice-option[data-step-id="${stepId}"]`) || app.element?.querySelector(`.starting-equipment-pane[data-step-id="${stepId}"]`) || app.element?.querySelector(`[data-application-part="equipment-status"][data-step-id="${stepId}"]`), `active step ${stepId}`);
  }
  async function saved(app) {
    await waitFor(() => app.element?.querySelector("[data-wayfinder-save-status]")?.dataset.phase === "saved", "autosave settled");
  }
  async function save(app) {
    let changed = false;
    const observer = new MutationObserver(() => { changed = true; });
    observer.observe(app.element, { attributes: true, childList: true, subtree: true });
    try {
      button(app, '[data-wayfinder-action="save-draft"]');
      await globalThis.__issue47Click('[data-wayfinder-action="save-draft"]');
      await waitFor(() => changed && app.element?.querySelector("[data-wayfinder-save-status]")?.dataset.phase === "saved", "manual Save Draft completion");
    } finally { observer.disconnect(); }
  }
  async function selectImplement(app, actor, payload, origin, name) {
    const slotId = slots[origin];
    const desired = fixed.find((entry) => entry.name === name);
    const otherName = origin === "first" ? payload.definition.second : payload.definition.first;
    const alternative = fixed.find((entry) => entry.name !== name && entry.name !== otherName && entry.name !== "Wand");
    await step(app, slotId);
    const unavailable = await unavailableChoices(app, payload, slotId);
    for (const entry of [alternative, desired]) {
      const uuid = featureUuid(entry);
      const value = `pf2e.classfeatures:${entry.featureId}`;
      await action(app, `[data-wayfinder-action="select-option"][data-step-id="${slotId}"][data-value="${value}"]`, () => draftFor(actor, payload.moduleId)?.branchSelections?.[slotId]?.uuid === uuid, `persisted ${origin} ${entry.name}`);
      await saved(app);
      if (entry !== desired) await step(app, slotId);
    }
    return { origin, name, sourceUuid: featureUuid(desired), unavailable };
  }
  async function unavailableChoices(app, payload, slotId) {
    const notice = await waitFor(() => app.element?.querySelector(".picker-unavailable-choices"), "named unavailable implement explanations");
    notice.open = true;
    const choices = [...notice.querySelectorAll("li")].map((entry) => ({ name: entry.querySelector("strong")?.textContent?.trim(), reason: entry.querySelector("p")?.textContent?.replace(/\s+/gu, " ").trim() }));
    for (const name of ["Weapon", "Shield"]) {
      const choice = choices.find((entry) => entry.name === name);
      if (!choice?.reason || !/choos|select/iu.test(choice.reason) || !/grant|track/iu.test(choice.reason)) throw new Error(`${name} lacks a concrete physical-choice and grant explanation.`);
    }
    const unsupportedValues = ["pf2e.classfeatures:YiDkrwaxiF7Gao7y", "pf2e.classfeatures:84GDSAXaMKMTg2IT"];
    for (const value of unsupportedValues) {
      if (app.element.querySelector(`[data-wayfinder-action="select-option"][data-step-id="${slotId}"][data-value="${value}"]:not(:disabled)`)) throw new Error("Unsupported Weapon/Shield was offered as selectable.");
    }
    // PF2E 8.6 adds Censer; unknown/new physical grants must remain visible as unsupported.
    const pack = game.packs.get("pf2e.classfeatures");
    const index = await pack.getIndex({ fields: ["system.slug"] });
    const censer = index.find((entry) => entry.name === "Censer" || entry.system?.slug === "censer");
    if (censer) {
      const choice = choices.find((entry) => entry.name === "Censer");
      if (!choice?.reason || !/review/iu.test(choice.reason)) throw new Error("New Censer implement lacks an unreviewed-grant explanation.");
      if (app.element.querySelector(`[data-wayfinder-action="select-option"][data-value="pf2e.classfeatures:${censer._id}"]:not(:disabled)`)) throw new Error("Unreviewed Censer was selectable.");
    }
    const beforeSelection = canonical(draftFor(actorFor(payload), payload.moduleId).branchSelections);
    const interaction = await globalThis.__issue47ExerciseUnavailable({ stepId: slotId, names: censer ? ["Weapon", "Shield", "Censer"] : ["Weapon", "Shield"] });
    if (canonical(draftFor(actorFor(payload), payload.moduleId).branchSelections) !== beforeSelection) throw new Error("Unavailable-choice search changed the saved supported selection.");
    await globalThis.__issue47Screenshot(`unavailable-${slotId.includes("second") ? "second" : "first"}`);
    return { choices, interaction, savedSelectionPreserved: true };
  }
  async function wandFollowup(app, actor, payload) {
    if (![payload.definition.first, payload.definition.second].includes("Wand")) return null;
    const modules = await globalThis.loadWayfinderModules(payload.moduleId);
    const plan = await globalThis.buildPlan(actor, modules.normalizeDraft(actor.getFlag(payload.moduleId, "draft"), payload.definition.targetLevel), modules);
    const choice = plan.steps.find((entry) => entry.kind === "class-choice" && entry.slotId.includes("initiate-benefit-wand"));
    if (!choice) throw new Error("Wand selection omitted its damage-type follow-up.");
    await step(app, choice.slotId);
    await waitFor(() => app.element?.querySelector(`[data-wayfinder-action="select-class-choice"][data-step-id="${choice.slotId}"]`), "Wand damage choice control");
    const values = [...new Set([...app.element.querySelectorAll(`[data-wayfinder-action="select-class-choice"][data-step-id="${choice.slotId}"]`)].map((control) => control.dataset.value))];
    if (values.length !== 3) throw new Error("Wand damage choice did not offer its three reviewed values.");
    const branches = canonical(draftFor(actor, payload.moduleId).branchSelections);
    const current = draftFor(actor, payload.moduleId).classChoices[choice.slotId];
    const start = values.indexOf(current);
    const changes = [];
    for (let index = 1; index <= values.length; index += 1) {
      const value = values[(Math.max(start, 0) + index) % values.length];
      await step(app, choice.slotId);
      await action(app, `[data-wayfinder-action="select-class-choice"][data-step-id="${choice.slotId}"][data-value="${value}"]`, () => draftFor(actor, payload.moduleId)?.classChoices?.[choice.slotId] === value, "persisted Wand damage choice");
      await saved(app);
      if (canonical(draftFor(actor, payload.moduleId).branchSelections) !== branches) throw new Error("Changing Wand damage cleared its parent implement selections.");
      changes.push(value);
    }
    return { slotId: choice.slotId, value: changes.at(-1), changedValues: changes, parentSelectionsPreserved: true };
  }
  async function equipment(app, actor, payload) {
    const beforeBranches = canonical(draftFor(actor, payload.moduleId).branchSelections);
    const assertBranches = (stage) => {
      if (canonical(draftFor(actor, payload.moduleId).branchSelections) !== beforeBranches) throw new Error(`Equipment ${stage} changed implement selections.`);
    };
    await step(app, `starting-equipment-level-${payload.definition.targetLevel}`);
    assertBranches("navigation");
    const read = () => draftFor(actor, payload.moduleId)?.acquisition;
    if (app.element?.querySelector('[data-wayfinder-action="initialize-starting-equipment"]')) {
      await action(app, '[data-wayfinder-action="initialize-starting-equipment"]', () => read(), "initialize acquisition");
      assertBranches("initialization");
    }
    if (!read()?.policySnapshot) {
      if (payload.definition.targetLevel > 1) {
        const choose = app.element?.querySelector('[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]');
        if (choose && !choose.disabled && read()?.recipe?.kind !== "lump-sum") await action(app, '[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]', () => read()?.recipe?.kind === "lump-sum", "lump-sum recipe");
        assertBranches("recipe selection");
        await action(app, '[data-wayfinder-action="activate-equipment-policy"][data-start-kind="replacement-character"]', () => read()?.policySnapshot && read()?.baseline, "higher-level admission");
        assertBranches("policy admission");
      }
    }
    await action(app, '[data-wayfinder-action="retain-all-equipment"]', () => read()?.disposition?.kind === "retain-all", "retained free-grant equipment review");
    await saved(app);
    assertBranches("review autosave");
    const reviewed = read();
    const expectedCount = payload.definition.second ? 2 : 1;
    if (reviewed.plannedClassGrants.length !== expectedCount || reviewed.lines.length !== expectedCount) throw new Error(`Reviewed equipment did not contain exactly ${expectedCount} expected fixed implements: ${JSON.stringify({ grants: reviewed.plannedClassGrants.map((grant) => ({ profileId: grant.profileId, sourceUuid: grant.expected.sourceUuid })), lines: reviewed.lines.map((line) => ({ sourceUuid: line.sourceUuid, lane: line.funding.lane })), branches: draftFor(actor, payload.moduleId).branchSelections })}`);
    for (const line of reviewed.lines) {
      if (line.funding.lane !== "class-grant" || Number(line.price.requestedQuantity) !== 1) throw new Error("Fixed implement was not a quantity-one class-grant line.");
    }
    return reviewed;
  }
  async function assertComplete(actor, payload) {
    const modules = await globalThis.loadWayfinderModules(payload.moduleId);
    const draft = modules.normalizeDraft(actor.getFlag(payload.moduleId, "draft"), payload.definition.targetLevel);
    const plan = await globalThis.buildPlan(actor, draft, modules);
    const incomplete = await globalThis.incompleteSteps(actor, draft, plan.steps, modules);
    if (incomplete.length) throw new Error(`Real UI path left incomplete steps: ${incomplete.map((entry) => entry.slotId).join(", ")}`);
  }
  function unrelatedChoices(draft) {
    const snapshot = clone(draft);
    snapshot.updatedAt = null;
    snapshot.acquisition = null;
    delete snapshot.branchSelections[slots.first];
    return snapshot;
  }
  function reviewedChangeSnapshot(draft) {
    const acquisition = draft.acquisition;
    return {
      acquisitionIdentity: acquisitionIdentity(acquisition),
      recipe: clone(acquisition.recipe),
      policySnapshot: clone(acquisition.policySnapshot),
      userCart: clone(acquisition.lines.filter((line) => line.funding.lane !== "class-grant")),
      unrelatedChoices: unrelatedChoices(draft),
    };
  }
  async function assertChangedReview(app, actor, payload, before) {
    const current = draftFor(actor, payload.moduleId);
    const acquisition = current?.acquisition;
    const desired = fixed.find((entry) => entry.name === payload.definition.first);
    const previous = fixed.find((entry) => entry.name === payload.definition.initialReviewedFirst);
    if (current?.branchSelections?.[slots.first]?.uuid !== featureUuid(desired)) throw new Error("Reviewed implement change did not persist the current first implement.");
    if (acquisition?.disposition?.kind !== "unreviewed") throw new Error("Changing the reviewed first implement reused the old equipment review.");
    if (canonical(reviewedChangeSnapshot(current)) !== canonical(before)) throw new Error("Changing a reviewed implement altered acquisition identity, recipe, policy, user cart, or unrelated choices.");
    if (acquisition.plannedClassGrants.length !== 1 || acquisition.plannedClassGrants[0].expected.sourceUuid !== itemUuid(desired) || acquisition.lines.length !== before.userCart.length + 1 || acquisition.lines.filter((line) => line.funding.lane === "class-grant").some((line) => line.sourceUuid !== itemUuid(desired)) || acquisition.lines.some((line) => line.sourceUuid === itemUuid(previous))) throw new Error("Reviewed implement change did not replace the old grant with the current implement exactly once.");
    await step(app, `starting-equipment-level-${payload.definition.targetLevel}`);
    const reviewControl = await waitFor(() => {
      const candidate = app.element?.querySelector('[data-wayfinder-action="retain-all-equipment"]');
      return candidate instanceof HTMLButtonElement && !candidate.disabled ? candidate : null;
    }, "editable invalidated equipment review");
    const applyControl = await waitFor(() => app.element?.querySelector('[data-wayfinder-action="apply-draft"]'), "invalidated review Apply surface");
    if (!applyControl.disabled || applyControl.dataset.wayfinderReadinessReady === "true") throw new Error("Apply remained ready after changing the reviewed implement.");
    return { disposition: acquisition.disposition.kind, applyDisabled: true, editableReview: !reviewControl.disabled, currentGrantSourceUuid: acquisition.plannedClassGrants[0].expected.sourceUuid, currentLineSourceUuids: acquisition.lines.map((line) => line.sourceUuid), acquisitionIdentity: acquisitionIdentity(acquisition), recipe: clone(acquisition.recipe), preservedUserCart: clone(before.userCart), unrelatedChoicesPreserved: true };
  }
  async function apply(app, actor, payload) {
    await waitFor(() => {
      const control = app.element?.querySelector('[data-wayfinder-action="apply-draft"]');
      const phase = app.element?.querySelector("[data-wayfinder-save-status]")?.dataset.phase;
      return control && !control.disabled && ["idle", "saved"].includes(phase);
    }, "enabled Apply readiness");
    button(app, '[data-wayfinder-action="apply-draft"]');
    await globalThis.__issue47Click('[data-wayfinder-action="apply-draft"]');
    const dialog = await waitFor(() => document.querySelector("[data-wayfinder-apply-confirmation]")?.closest(".application"), "real Apply confirmation");
    const confirm = dialog.querySelector('button[data-action="yes"]');
    if (!(confirm instanceof HTMLButtonElement) || confirm.disabled) throw new Error("Real Apply confirmation is unavailable.");
    await globalThis.__issue47Click('button[data-action="yes"]', true);
    await waitFor(() => actor.getFlag(payload.moduleId, "draft") == null || app.element?.textContent?.includes("draft was kept for recovery") || app.element?.textContent?.includes("draft changed"), "Apply completed or visibly failed", 90_000);
  }
  function faultInjection(actor, payload, reviewed) {
    const fault = payload.definition.fault;
    if (!fault) return { restore() {}, evidence: { configured: null, injected: false } };
    const isNative = fault.startsWith("native-");
    const method = isNative ? "createEmbeddedDocuments" : "update";
    const descriptor = Object.getOwnPropertyDescriptor(actor, method);
    const original = actor[method];
    const evidence = { configured: fault, injected: false, targetSourceUuid: isNative ? featureUuid(fixed.find((entry) => entry.name === payload.definition.second)) : null };
    Object.defineProperty(actor, method, { configurable: true, writable: true, value: async function (...args) {
      const match = isNative
        ? args[0] === "Item" && Array.isArray(args[1]) && args[1].some((source) => sourceId(source) === evidence.targetSourceUuid)
        : args[0]?.[`flags.${payload.moduleId}.draft`] === null && args[0]?.[`flags.${payload.moduleId}.state`]?.completedAcquisitionManifest?.id === reviewed.manifestId;
      if (!evidence.injected && match) {
        evidence.injected = true;
        evidence.before = inventory(actor, payload.moduleId);
        if (fault.endsWith("-before")) throw new Error(`Intentional Issue 47 guarded fixture ${fault} failure.`);
        await original.apply(this, args);
        evidence.after = inventory(actor, payload.moduleId);
        throw new Error(`Intentional Issue 47 guarded fixture ${fault} acknowledgement failure.`);
      }
      return original.apply(this, args);
    } });
    return { evidence, restore() { if (descriptor) Object.defineProperty(actor, method, descriptor); else delete actor[method]; } };
  }
  function nativeOutcome(actor, payload, reviewed) {
    const observed = inventory(actor, payload.moduleId);
    const expectedNames = [payload.definition.first, payload.definition.second].filter(Boolean);
    const manifest = clone(actor.getFlag(payload.moduleId, "state")?.completedAcquisitionManifest ?? null);
    const failures = [];
    if (Number(actor.system.details.level.value) !== payload.definition.targetLevel) failures.push("Final actor level is wrong.");
    if (actor.getFlag(payload.moduleId, "draft") != null) failures.push("Draft was not cleared.");
    if (!manifest || manifest.id !== reviewed.manifestId || manifest.batchId !== reviewed.batchId || manifest.draftId !== reviewed.draftId) failures.push("Completed manifest identity changed.");
    const budgetCopper = reviewed.policySnapshot.material.budgetCopper;
    const expectedCopper = reviewed.baseline.currencyCopper + budgetCopper;
    if (observed.copper !== expectedCopper || manifest?.currency?.spentCopper !== 0 || manifest?.currency?.budgetCopper !== budgetCopper || manifest?.currency?.observedCopper !== expectedCopper) failures.push("Free implements changed the budget or exact currency outcome.");
    for (const [index, name] of expectedNames.entries()) {
      const entry = fixed.find((candidate) => candidate.name === name);
      const matching = observed.items.filter((item) => item.sourceUuid === itemUuid(entry));
      if (matching.length !== 1 || matching[0].quantity !== 1 || matching[0].acquisition !== null) { failures.push(`${name} did not materialize once as an unstamped native item with quantity one.`); continue; }
      const physical = matching[0];
      const granter = observed.items.find((item) => item.id === physical.grantedBy?.id);
      const selector = observed.items.find((item) => item.id === granter?.grantedBy?.id);
      const classItem = observed.items.find((item) => item.id === selector?.location);
      const expectedSelector = index === 0 ? "Compendium.pf2e.classfeatures.Item.VSQJtzQE6ikKdsnP" : "Compendium.pf2e.classfeatures.Item.Z8WpDAdAXyefLB7Q";
      if (granter?.sourceUuid !== featureUuid(entry) || selector?.sourceUuid !== expectedSelector || classItem?.sourceUuid !== "Compendium.pf2e.classes.Item.Y5GsHqzCzJlKka6x" || !Object.values(granter?.itemGrants ?? {}).some((grant) => grant.id === physical.id) || !Object.values(selector?.itemGrants ?? {}).some((grant) => grant.id === granter.id)) failures.push(`${name} native physical/implement/selector/class provenance graph is incomplete.`);
      const completed = manifest?.classGrants?.find((grant) => grant.grant.expected.sourceUuid === itemUuid(entry));
      if (completed?.status !== "resolved" || canonical(completed.observedItemIds) !== canonical([physical.id]) || completed.grant.materializer !== "pf2e-native") failures.push(`${name} lacks exact resolved native manifest evidence.`);
    }
    if (payload.definition.initialReviewedFirst) {
      const previous = fixed.find((entry) => entry.name === payload.definition.initialReviewedFirst);
      if (observed.items.some((item) => item.sourceUuid === itemUuid(previous) || item.sourceUuid === featureUuid(previous)) || manifest?.classGrants?.some((grant) => grant.grant.expected.sourceUuid === itemUuid(previous))) failures.push("Apply retained the previously reviewed implement feature, physical item, or manifest grant.");
    }
    if (manifest?.classGrants?.length !== expectedNames.length) failures.push("Completed manifest class-grant count is wrong.");
    return { observed, manifest, budgetCopper, expectedCopper, failures, passed: failures.length === 0 };
  }
  async function boundary(payload) {
    guard(payload, true);
    const module = game.modules.get(payload.moduleId);
    if (!module?.active) throw new Error("Wayfinder is inactive.");
    return {
      runtime: { worldId: game.world.id, foundryVersion: game.version, pf2eVersion: game.system.version, moduleVersion: module.version, locale: game.i18n.lang },
      actors: (await Promise.all(game.actors.map(async (actor) => ({ id: actor.id, sha256: await digest(actor.toObject()) })))).sort((left, right) => left.id.localeCompare(right.id)),
      settings: {
        policy: await digest(game.settings.get(payload.moduleId, "equipmentPolicy")),
        judgments: await digest(game.settings.get(payload.moduleId, "equipmentPolicyJudgments")),
        packs: await digest(game.settings.get("pf2e", "compendiumBrowserPacks")),
        sources: await digest(game.settings.get("pf2e", "compendiumBrowserSources")),
      },
    };
  }
  globalThis.__issue47Implements = {
    captureBoundary: boundary,
    async verifyBoundary(payload) {
      const after = await boundary(payload);
      return { before: payload.boundary, after, unchanged: canonical(payload.boundary) === canonical(after) };
    },
    async initial(payload) {
      const actor = actorFor(payload);
      const before = inventory(actor, payload.moduleId);
      const app = await openApp(actor, payload.moduleId);
      let first = await selectImplement(app, actor, payload, "first", payload.definition.initialReviewedFirst ?? payload.definition.first);
      const second = payload.definition.second ? await selectImplement(app, actor, payload, "second", payload.definition.second) : null;
      const checkBranches = (stage) => {
        const branches = draftFor(actor, payload.moduleId).branchSelections;
        if (!branches[slots.first] || (payload.definition.second && !branches[slots.second])) throw new Error(`Implement selections lost ${stage}: ${JSON.stringify(branches)}`);
      };
      checkBranches("after implement UI selection");
      const wand = await wandFollowup(app, actor, payload);
      checkBranches("after Wand follow-up");
      const autosaved = draftFor(actor, payload.moduleId);
      const autosaveHash = await digest(autosaved);
      await save(app);
      const savedDraft = draftFor(actor, payload.moduleId);
      checkBranches("after manual Save Draft");
      if (canonical({ ...autosaved, updatedAt: null }) !== canonical({ ...savedDraft, updatedAt: null })) throw new Error("Manual Save Draft changed already autosaved implement choices.");
      const reviewed = await equipment(app, actor, payload);
      await save(app);
      await assertComplete(actor, payload);
      let reviewChange = null;
      if (payload.definition.initialReviewedFirst) {
        const beforeDraft = draftFor(actor, payload.moduleId);
        const preserved = reviewedChangeSnapshot(beforeDraft);
        const beforeChangeScreenshot = await globalThis.__issue47Screenshot("before-reviewed-change");
        first = await selectImplement(app, actor, payload, "first", payload.definition.first);
        const changed = await assertChangedReview(app, actor, payload, preserved);
        await save(app);
        const afterSave = await assertChangedReview(app, actor, payload, preserved);
        reviewChange = { previous: payload.definition.initialReviewedFirst, current: payload.definition.first, preserved, beforeReviewed: reviewed, changed, afterSave, beforeChangeScreenshot };
      }
      const persisted = draftFor(actor, payload.moduleId);
      const screenshot = await globalThis.__issue47Screenshot(reviewChange ? "changed-review-invalidated" : "reviewed");
      await app.close({ animate: false });
      if (canonical(before) !== canonical(inventory(actor, payload.moduleId))) throw new Error("Implement selection or review mutated actor items/currency before Apply.");
      return { passed: true, first, second, wand, reviewChange, autosaveHash, autosaveAndManualSaveEqual: true, savedDraftHash: await digest(persisted), reviewed, acquisitionIdentity: acquisitionIdentity(reviewed), before, screenshot };
    },
    async reopenAndReview(payload) {
      const actor = actorFor(payload);
      const persisted = draftFor(actor, payload.moduleId);
      if (!payload.definition.initialReviewedFirst || !payload.initial.reviewChange || await digest(persisted) !== payload.initial.savedDraftHash) throw new Error("Cold reopen lost the exact invalidated implement-review draft.");
      const app = await openApp(actor, payload.moduleId);
      const reopened = await assertChangedReview(app, actor, payload, payload.initial.reviewChange.preserved);
      const invalidatedScreenshot = await globalThis.__issue47Screenshot("cold-review-still-invalidated");
      const reviewed = await equipment(app, actor, payload);
      await save(app);
      await assertComplete(actor, payload);
      if (canonical(reviewedChangeSnapshot(draftFor(actor, payload.moduleId))) !== canonical(payload.initial.reviewChange.preserved)) throw new Error("Re-review changed acquisition identity, recipe, policy, user cart, or unrelated choices.");
      const savedDraftHash = await digest(draftFor(actor, payload.moduleId));
      const screenshot = await globalThis.__issue47Screenshot("current-implement-re-reviewed");
      await app.close({ animate: false });
      if (canonical(payload.initial.before) !== canonical(inventory(actor, payload.moduleId))) throw new Error("Changing or re-reviewing implements mutated actor items/currency before Apply.");
      return { passed: true, coldReopenPreservedInvalidation: true, reopened, invalidatedScreenshot, reviewed, savedDraftHash, acquisitionIdentity: acquisitionIdentity(reviewed), screenshot };
    },
    async reopenAndApply(payload) {
      const actor = actorFor(payload);
      const persisted = draftFor(actor, payload.moduleId);
      if (await digest(persisted) !== payload.initial.savedDraftHash || canonical(acquisitionIdentity(persisted.acquisition)) !== canonical(payload.initial.acquisitionIdentity)) throw new Error("Cold reopen changed saved choices, review, or acquisition identity.");
      if (payload.initial.wand && persisted.classChoices[payload.initial.wand.slotId] !== payload.initial.wand.value) throw new Error("Cold reopen lost Wand damage choice.");
      const app = await openApp(actor, payload.moduleId);
      await assertComplete(actor, payload);
      const injected = faultInjection(actor, payload, payload.initial.reviewed);
      try { await apply(app, actor, payload); }
      finally { injected.restore(); }
      if (payload.definition.fault && !injected.evidence.injected) throw new Error(`Configured ${payload.definition.fault} fault never reached its exact write.`);
      const recovery = draftFor(actor, payload.moduleId);
      const finalized = recovery == null && Boolean(actor.getFlag(payload.moduleId, "state")?.completedAcquisitionManifest);
      if (payload.definition.fault && !finalized && !recovery?.applyRecoveryActorUpdate) throw new Error("Failed Apply did not persist a durable recovery candidate.");
      if (!payload.definition.fault && !finalized) throw new Error("Apply failed without an injected failure.");
      if (recovery && canonical(acquisitionIdentity(recovery.acquisition)) !== canonical(payload.initial.acquisitionIdentity)) throw new Error("Failed Apply replaced acquisition identity.");
      const screenshot = await globalThis.__issue47Screenshot(finalized ? "applied" : "failure-recovery");
      return { passed: true, coldReopenPreservedDraft: true, fault: injected.evidence, finalized, recoveryHash: recovery ? await digest(recovery) : null, acquisitionIdentity: acquisitionIdentity(recovery?.acquisition), afterAttempt: inventory(actor, payload.moduleId), screenshot };
    },
    async retryAndVerify(payload) {
      const actor = actorFor(payload);
      const recovery = draftFor(actor, payload.moduleId);
      let retry = null;
      if (!payload.attempted.finalized) {
        if (!recovery || await digest(recovery) !== payload.attempted.recoveryHash || canonical(acquisitionIdentity(recovery.acquisition)) !== canonical(payload.initial.acquisitionIdentity)) throw new Error("Fresh context lost the exact durable recovery candidate.");
        const app = await openApp(actor, payload.moduleId);
        await apply(app, actor, payload);
        await waitFor(() => actor.getFlag(payload.moduleId, "draft") == null && actor.getFlag(payload.moduleId, "state")?.completedAcquisitionManifest, "successful retry", 90_000);
        retry = { appliedThroughUi: true, coldRecoveryPreserved: true };
        await app.close({ animate: false });
      }
      const outcome = nativeOutcome(actor, payload, payload.initial.reviewed);
      const beforeRerun = inventory(actor, payload.moduleId);
      const modules = await globalThis.loadWayfinderModules(payload.moduleId);
      const rerun = await globalThis.buildPlan(actor, modules.createEmptyDraft(payload.definition.targetLevel), modules);
      if (rerun.steps.length) outcome.failures.push(`Rerun still has steps: ${rerun.steps.map((entry) => entry.slotId).join(", ")}`);
      const app = await openApp(actor, payload.moduleId);
      const applyControl = await waitFor(() => app.element?.querySelector('[data-wayfinder-action="apply-draft"]'), "rerun Apply surface");
      if (!applyControl.disabled) outcome.failures.push("Completed rerun still offers an enabled Apply.");
      const screenshot = await globalThis.__issue47Screenshot("rerun");
      await app.close({ animate: false });
      if (canonical(beforeRerun) !== canonical(inventory(actor, payload.moduleId))) outcome.failures.push("Reopening the completed build changed or duplicated items/currency.");
      return { ...outcome, passed: outcome.failures.length === 0, retry, rerun: { pendingSteps: rerun.steps.map((entry) => entry.slotId), applyDisabled: applyControl.disabled, inventoryUnchanged: canonical(beforeRerun) === canonical(inventory(actor, payload.moduleId)), screenshot } };
    },
  };
})();
