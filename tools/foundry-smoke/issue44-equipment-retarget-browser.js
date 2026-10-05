/* global document, game, HTMLButtonElement, MutationObserver */

(() => {
  const daggerUuid = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
  const clone = (value) => structuredClone(value);
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  async function digest(value) {
    const bytes = new TextEncoder().encode(canonical(value));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function assertWorld(payload, isGM) {
    if (!payload.allowDestructive || !payload.expectedWorldId || game.world.id !== payload.expectedWorldId || Boolean(game.user.isGM) !== isGM) throw new Error("Issue 44 world/role/cleanup guard failed.");
  }
  function actorFor(payload) {
    assertWorld(payload, false);
    const actor = game.actors.get(payload.setup.actorId);
    const marker = actor?.getFlag(payload.moduleId, "equipmentProfileFixture");
    if (!actor || !actor.isOwner || game.user.id !== payload.setup.users.player.id || actor.name !== payload.setup.actorName || marker?.profileId !== payload.definition.id || marker?.runId !== payload.runId) throw new Error("Issue 44 fixture identity or owner changed.");
    return actor;
  }
  const draftFor = (actor, moduleId) => clone(actor.getFlag(moduleId, "draft"));
  const identity = (acquisition) => acquisition ? { draftId: acquisition.draftId, batchId: acquisition.batchId, manifestId: acquisition.manifestId } : null;
  function inventory(actor, moduleId) {
    return {
      copper: Number(actor.inventory?.currency?.copperValue ?? 0),
      items: actor.items.filter((item) => item.isOfType?.("physical")).map((item) => ({ id: item.id, uuid: item.sourceId ?? item.flags?.core?.sourceId ?? null, quantity: Number(item.quantity ?? item.system?.quantity ?? 0), acquisition: clone(item.getFlag(moduleId, "acquisition") ?? null) })).sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
  function retainedChoices(draft, retainedLevel) {
    const result = {};
    for (const [key, value] of Object.entries(draft ?? {})) {
      if (key === "boosts") result.boosts = { ancestry: value.ancestry, background: value.background, class: value.class, levels: Object.fromEntries(Object.entries(value.levels ?? {}).filter(([level]) => Number(level) <= retainedLevel)) };
      else if (value && typeof value === "object" && !Array.isArray(value) && !["acquisition", "applyRecoveryActorUpdate"].includes(key)) {
        const entries = Object.entries(value).filter(([slotId]) => {
          const level = slotId.match(/-level-(\d+)(?:$|-)/u)?.[1];
          return level && Number(level) <= retainedLevel;
        });
        if (entries.length) result[key] = Object.fromEntries(entries);
      }
    }
    return result;
  }
  async function waitFor(read, label, timeoutMs = 20_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Issue 44 timed out: ${label}.`);
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
    if (!(value instanceof HTMLButtonElement) || value.disabled) throw new Error(`Issue 44 control unavailable: ${selector}.`);
    return value;
  }
  async function click(app, selector, ready, label, timeoutMs) {
    button(app, selector).click();
    await waitFor(ready, label || selector, timeoutMs);
  }
  async function equipment(app, actor, moduleId) {
    const stepId = `starting-equipment-level-${draftFor(actor, moduleId).targetLevel}`;
    const selector = `[data-wayfinder-action="select-step"][data-step-id="${stepId}"]`;
    await waitFor(() => app.element?.querySelector(selector), "equipment rail control");
    button(app, selector).click();
    await waitFor(() => app.element?.querySelector(`.starting-equipment-pane[data-step-id="${stepId}"]`) || app.element?.querySelector(`[data-application-part="equipment-status"][data-step-id="${stepId}"]`), "active equipment pane");
  }
  async function save(app) {
    let changed = false;
    const observer = new MutationObserver(() => { changed = true; });
    observer.observe(app.element, { attributes: true, childList: true, subtree: true });
    try {
      button(app, '[data-wayfinder-action="save-draft"]').click();
      await waitFor(() => changed && app.element?.querySelector("[data-wayfinder-save-status]")?.dataset.phase === "saved", "manual Save Draft completion");
    } finally { observer.disconnect(); }
  }
  async function activate(app, actor, moduleId, timeoutMs = 20_000) {
    const read = () => draftFor(actor, moduleId)?.acquisition;
    if (app.element?.querySelector('[data-wayfinder-action="initialize-starting-equipment"]')) {
      const existing = Boolean(read());
      await click(app, '[data-wayfinder-action="initialize-starting-equipment"]', () => existing ? read()?.policySnapshot : read(), "initialize acquisition", timeoutMs);
    }
    if (read()?.policySnapshot) return;
    const choose = app.element?.querySelector('[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]');
    if (choose && !choose.disabled && read()?.recipe?.kind !== "lump-sum") {
      await click(app, '[data-wayfinder-action="select-equipment-recipe"][data-recipe="lump-sum"]', () => read()?.recipe?.kind === "lump-sum", "choose lump-sum", timeoutMs);
    }
    const activateSelector = '[data-wayfinder-action="activate-equipment-policy"][data-start-kind="replacement-character"]';
    await waitFor(() => app.element?.querySelector(activateSelector) || read()?.policySnapshot, "authority controls", timeoutMs);
    if (!read()?.policySnapshot) await click(app, activateSelector, () => read()?.policySnapshot && read()?.baseline, "current policy/admission activation", timeoutMs);
    await waitFor(() => app.element?.querySelector('[data-wayfinder-action="retain-all-equipment"]'), "shopping controls", timeoutMs);
  }
  async function addDagger(app, actor, moduleId) {
    const search = await waitFor(() => app.element?.querySelector("[data-wayfinder-equipment-search]"), "catalogue search");
    search.value = "Dagger";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const previewSelector = `[data-wayfinder-action="preview-equipment-item"][data-source-uuid="${daggerUuid}"]`;
    await waitFor(() => app.element?.querySelector(previewSelector), "exact dagger result");
    await click(app, previewSelector, () => app.element?.querySelector(`[data-equipment-preview="${daggerUuid}"]`), "dagger preview");
    const addSelector = `[data-wayfinder-action="add-equipment-item"][data-source-uuid="${daggerUuid}"][data-funding="currency"]`;
    await waitFor(() => app.element?.querySelector(addSelector), "dagger purchase control");
    await click(app, addSelector, () => draftFor(actor, moduleId)?.acquisition?.lines.some((line) => line.sourceUuid === daggerUuid), "durable dagger cart line");
  }
  async function review(app, actor, moduleId, cart) {
    const kind = cart === "coin" ? "retain-all" : "purchase-ledger";
    const action = cart === "coin" ? "retain-all-equipment" : "review-equipment-purchases";
    await waitFor(() => app.element?.querySelector(`[data-wayfinder-action="${action}"]`) && !app.element.querySelector(`[data-wayfinder-action="${action}"]`).disabled, "enabled review control");
    await click(app, `[data-wayfinder-action="${action}"]`, () => draftFor(actor, moduleId)?.acquisition?.disposition?.kind === kind, "durable current review");
  }
  function surface(app) {
    return {
      controls: [...(app.element?.querySelectorAll(".starting-equipment-pane button[data-wayfinder-action]") ?? [])].map((entry) => ({ action: entry.dataset.wayfinderAction, enabled: !entry.disabled })),
      status: app.element?.querySelector('[data-application-part="equipment-status"]')?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
      shopping: Boolean(app.element?.querySelector('[data-wayfinder-action="retain-all-equipment"]')),
    };
  }
  async function boundary(payload) {
    assertWorld(payload, true);
    const module = game.modules.get(payload.moduleId);
    if (!module?.active) throw new Error("Wayfinder is inactive.");
    const actors = await Promise.all(game.actors.map(async (actor) => ({ id: actor.id, sha256: await digest(actor.toObject()) })));
    return {
      runtime: { worldId: game.world.id, foundryVersion: game.version, pf2eVersion: game.system.version, moduleVersion: module.version, locale: game.i18n.lang },
      actors: actors.sort((left, right) => left.id.localeCompare(right.id)),
      settings: {
        policy: await digest(game.settings.get(payload.moduleId, "equipmentPolicy")),
        judgments: await digest(game.settings.get(payload.moduleId, "equipmentPolicyJudgments")),
        packs: await digest(game.settings.get("pf2e", "compendiumBrowserPacks")),
        sources: await digest(game.settings.get("pf2e", "compendiumBrowserSources")),
      },
    };
  }
  async function applyWithRetry(app, actor, payload, reviewed) {
    const moduleId = payload.moduleId;
    const expectedCopper = reviewed.policySnapshot.material.budgetCopper - (payload.definition.cart === "coin" ? 0 : reviewed.lines.reduce((sum, line) => sum + Number(line.price?.linePriceCopper ?? line.priceSnapshot?.linePriceCopper ?? 0), 0));
    let injected = false;
    let atFailure = null;
    const restore = globalThis.interceptActorUpdate(actor, async ({ updates, operation, callOriginal }) => {
      const manifest = updates[`flags.${moduleId}.state`]?.completedAcquisitionManifest;
      if (!injected && updates[`flags.${moduleId}.draft`] === null && manifest?.id === reviewed.manifestId) {
        injected = true;
        atFailure = { inventory: inventory(actor, moduleId), draft: draftFor(actor, moduleId), intendedManifest: clone(manifest) };
        throw new Error("Intentional Issue 44 disposable-fixture final update failure.");
      }
      return callOriginal(updates, operation);
    });
    async function apply() {
      button(app, '[data-wayfinder-action="apply-draft"]').click();
      const dialog = await waitFor(() => document.querySelector("[data-wayfinder-apply-confirmation]")?.closest(".application"), "Apply confirmation");
      const yes = dialog.querySelector('button[data-action="yes"]');
      if (!(yes instanceof HTMLButtonElement)) throw new Error("Issue 44 Apply confirmation button missing.");
      yes.click();
    }
    try {
      await apply();
      await waitFor(() => injected && draftFor(actor, moduleId)?.applyRecoveryActorUpdate, "durable partial-Apply recovery", 60_000);
      await waitFor(() => {
        const control = app.element?.querySelector('[data-wayfinder-action="apply-draft"]');
        return control && !control.disabled && !["saving", "dirty"].includes(app.element?.querySelector("[data-wayfinder-save-status]")?.dataset.phase);
      }, "enabled recovery Apply");
    } finally { restore(); }
    const recovery = draftFor(actor, moduleId);
    const beforeRetry = inventory(actor, moduleId);
    await apply();
    await waitFor(() => actor.getFlag(moduleId, "draft") == null && actor.getFlag(moduleId, "state")?.completedAcquisitionManifest, "successful retry", 60_000);
    const after = inventory(actor, moduleId);
    const manifest = clone(actor.getFlag(moduleId, "state").completedAcquisitionManifest);
    const failures = [];
    if (!injected || canonical(identity(recovery?.acquisition)) !== canonical(identity(reviewed))) failures.push("Recovery acquisition identity changed.");
    if (!recovery?.acquisition?.currencyConvergenceWitness) failures.push("Recovery lost the currency convergence witness.");
    if (canonical(beforeRetry) !== canonical(after)) failures.push("Retry duplicated or altered physical items/currency.");
    if (after.copper !== expectedCopper) failures.push(`Currency ${after.copper} differs from current reviewed balance ${expectedCopper}.`);
    if (manifest.id !== reviewed.manifestId || manifest.batchId !== reviewed.batchId || manifest.draftId !== reviewed.draftId) failures.push("Completed manifest identity changed.");
    if (Number(actor.system.details.level.value) !== payload.smokeCase.targetLevel) failures.push("Final character level is wrong.");
    const daggers = after.items.filter((item) => item.uuid === daggerUuid);
    if (payload.definition.cart === "item" && (daggers.length !== 1 || daggers[0].quantity !== 1)) failures.push("Dagger purchase did not have exactly one outcome.");
    return { injected, atFailure: { inventory: atFailure?.inventory, intendedManifestId: atFailure?.intendedManifest?.id }, recoveryIdentity: identity(recovery?.acquisition), convergenceWitnessPresent: Boolean(recovery?.acquisition?.currencyConvergenceWitness), beforeRetry, after, expectedCopper, manifest, failures };
  }
  globalThis.__issue44Equipment = {
    captureBoundary: boundary,
    async verifyBoundary(payload) {
      const after = await boundary(payload);
      return { before: payload.boundary, after, unchanged: canonical(payload.boundary) === canonical(after) };
    },
    async initial(payload) {
      const actor = actorFor(payload);
      const app = await openApp(actor, payload.moduleId);
      await equipment(app, actor, payload.moduleId);
      await activate(app, actor, payload.moduleId);
      if (payload.definition.cart === "item") await addDagger(app, actor, payload.moduleId);
      await review(app, actor, payload.moduleId, payload.definition.cart);
      await save(app);
      const before = draftFor(actor, payload.moduleId);
      const beforeInventory = inventory(actor, payload.moduleId);
      const target = payload.definition.initialLevel + payload.definition.delta;
      await click(app, `[data-wayfinder-action="target-${payload.definition.delta > 0 ? "up" : "down"}"]`, () => draftFor(actor, payload.moduleId)?.targetLevel === target, "durable target level change");
      await equipment(app, actor, payload.moduleId);
      await save(app);
      const after = draftFor(actor, payload.moduleId);
      const evidence = {
        beforeIdentity: identity(before.acquisition), afterIdentity: identity(after.acquisition), targetLevel: after.targetLevel,
        policyInvalidated: after.acquisition.policySnapshot === null,
        reviewInvalidated: after.acquisition.disposition.kind === "unreviewed",
        baselinePresent: Boolean(after.acquisition.baseline),
        cartBefore: clone(before.acquisition.lines), cartAfter: clone(after.acquisition.lines),
        choicesPreserved: canonical(retainedChoices(before, Math.min(before.targetLevel, target))) === canonical(retainedChoices(after, Math.min(before.targetLevel, target))),
        retainedChoices: clone(retainedChoices(before, Math.min(before.targetLevel, target))),
        beforeInventory, actorUnchanged: canonical(beforeInventory) === canonical(inventory(actor, payload.moduleId)),
        savedDraftHash: await digest(after),
        beforeSurface: surface(app),
      };
      await app.close({ animate: false });
      return evidence;
    },
    async resume(payload) {
      const actor = actorFor(payload);
      let app = await openApp(actor, payload.moduleId);
      await equipment(app, actor, payload.moduleId);
      const reopened = draftFor(actor, payload.moduleId);
      const failures = [];
      if (await digest(reopened) !== payload.initial.savedDraftHash) failures.push("Saved draft changed on a fresh page reload.");
      if (canonical(identity(reopened.acquisition)) !== canonical(payload.initial.beforeIdentity)) failures.push("Target change replaced acquisition identity.");
      const retainedLevel = Math.min(payload.definition.initialLevel, payload.smokeCase.targetLevel);
      if (!payload.initial.choicesPreserved || canonical(retainedChoices(reopened, retainedLevel)) !== canonical(payload.initial.retainedChoices) || !payload.initial.actorUnchanged) failures.push("Target change altered retained character choices or actor inventory.");
      let recoveryError = null;
      try { await activate(app, actor, payload.moduleId, payload.baseline ? 3_000 : 20_000); }
      catch (error) { recoveryError = error instanceof Error ? error.message : String(error); }
      if (payload.baseline) {
        const stranded = Boolean(recoveryError) && !draftFor(actor, payload.moduleId)?.acquisition?.policySnapshot && !surface(app).shopping;
        const observedSurface = surface(app);
        return { passed: stranded && !failures.length, reproducedStranding: stranded, recoveryError, failures, surface: observedSurface };
      }
      if (recoveryError) throw new Error(recoveryError);
      const activated = draftFor(actor, payload.moduleId);
      if (activated.acquisition.targetLevel !== payload.smokeCase.targetLevel || activated.acquisition.policySnapshot.material.subject.targetLevel !== payload.smokeCase.targetLevel || !activated.acquisition.baseline) failures.push("Restaged policy/admission does not describe the current target.");
      if (canonical(identity(activated.acquisition)) !== canonical(payload.initial.beforeIdentity)) failures.push("Reentry replaced acquisition identity.");
      if (canonical(retainedChoices(activated, retainedLevel)) !== canonical(payload.initial.retainedChoices)) failures.push("Equipment reentry altered retained character choices.");
      if (activated.acquisition.disposition.kind !== "unreviewed") failures.push("Reentry reused stale equipment review.");
      if (canonical(activated.acquisition.lines.map((line) => ({ lineId: line.lineId, sourceUuid: line.sourceUuid, quantity: line.price.requestedQuantity }))) !== canonical(payload.initial.cartBefore.map((line) => ({ lineId: line.lineId, sourceUuid: line.sourceUuid, quantity: line.price.requestedQuantity })))) failures.push("Reentry changed retained cart identity or quantity.");
      await review(app, actor, payload.moduleId, payload.definition.cart);
      await save(app);
      const reviewed = draftFor(actor, payload.moduleId).acquisition;
      await app.close({ animate: false });
      const modules = await globalThis.loadWayfinderModules(payload.moduleId);
      const draft = modules.normalizeDraft(actor.getFlag(payload.moduleId, "draft"), payload.smokeCase.targetLevel);
      const plan = await globalThis.buildPlan(actor, draft, modules);
      const unexpected = (await globalThis.incompleteSteps(actor, draft, plan.steps, modules)).filter((step) => step.kind !== "starting-equipment" && step.level <= retainedLevel);
      if (unexpected.length || failures.length) throw new Error([...failures, ...unexpected.map((step) => `Previously completed retained step became incomplete: ${step.slotId}`)].join(" "));
      const fill = await globalThis.completeDraft(actor, draft, payload.smokeCase, modules, { moduleId: payload.moduleId, skipStepIds: new Set(plan.steps.filter((step) => step.kind === "starting-equipment" || step.level <= retainedLevel).map((step) => step.slotId)) });
      if (fill.warnings.length || fill.classifications.length) throw new Error(`Guardian fixture choices could not complete: ${[...fill.warnings, ...fill.classifications].join(" ")}`);
      // Only the disposable fixture's newly introduced character choices are filled here.
      await actor.setFlag(payload.moduleId, "draft", draft);
      app = await openApp(actor, payload.moduleId);
      await equipment(app, actor, payload.moduleId);
      const recoveredScreenshot = await globalThis.__issue44CaptureRecoveredPane(payload.definition.id);
      await waitFor(() => app.element?.querySelector('[data-wayfinder-action="apply-draft"]') && !app.element.querySelector('[data-wayfinder-action="apply-draft"]').disabled, "completed Guardian Apply readiness");
      const apply = await applyWithRetry(app, actor, payload, reviewed);
      failures.push(...apply.failures);
      return { passed: !failures.length, recoveryError, recoveredScreenshot, retainedChoicesPreserved: true, targetLevel: activated.targetLevel, identity: identity(activated.acquisition), policyLevel: activated.acquisition.policySnapshot.material.subject.targetLevel, baselinePresent: Boolean(activated.acquisition.baseline), reviewFresh: reviewed.disposition.kind !== "unreviewed", apply, failures };
    },
  };
})();
