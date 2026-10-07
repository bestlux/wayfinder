/* global document, game, getComputedStyle, HTMLElement */

(() => {
  const clone = (value) => structuredClone(value);
  const projections = [];
  const events = [];
  let adapterRegistry;
  let originalAdapter;
  let sourcePolicy;
  let policyService;
  let acquisitionDomain;
  const moduleId = "wayfinder-pf2e";
  const dagger = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
  const identity = (acquisition) => ({
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    manifestId: acquisition.manifestId,
  });
  const cart = (acquisition) =>
    acquisition.lines.map((line) => ({
      lineId: line.lineId,
      sourceUuid: line.sourceUuid,
      quantity: line.price.requestedQuantity,
      funding: clone(line.funding),
      stackingIntent: clone(line.stackingIntent),
      documentFingerprint: line.documentFingerprint,
      priceFingerprint: line.priceFingerprint,
    }));
  const baseline = (acquisition) => {
    const facts = clone(acquisition.baseline ?? {});
    delete facts.capturedAt;
    return facts;
  };
  function choices(draft, level) {
    const result = {};
    for (const [key, value] of Object.entries(draft)) {
      if (key === "boosts")
        result.boosts = {
          ...value,
          levels: Object.fromEntries(Object.entries(value.levels).filter(([key]) => Number(key) <= level)),
        };
      else if (value && typeof value === "object" && !Array.isArray(value) && key !== "acquisition") {
        const entries = Object.entries(value).filter(
          ([slot]) =>
            !slot.startsWith("starting-equipment-") &&
            Number(slot.match(/-level-(\d+)(?:$|-)/u)?.[1] ?? Infinity) <= level
        );
        if (entries.length) result[key] = Object.fromEntries(entries);
      }
    }
    return result;
  }
  function descriptors() {
    return sourcePolicy.discoverInstalledEquipmentPackDescriptors({ packs: game.packs }).map((entry) => ({
      id: entry.id,
      family: entry.family,
      equipmentTab: entry.equipmentTab,
      documentName: entry.documentName,
      indexSize: game.packs.get(entry.id)?.index?.size ?? null,
    }));
  }
  function currentMaterial(request) {
    const acquisition = request.draft.acquisition;
    const reviewed = acquisition?.policySnapshot?.material;
    if (!reviewed) return null;
    const evidence = reviewed.higherLevelStartEvidence;
    const claim =
      evidence.kind === "not-required"
        ? null
        : evidence.kind === "gm-confirmation"
          ? { kind: "gm-confirmation", judgmentId: evidence.judgment.id, startKind: evidence.startKind }
          : evidence;
    try {
      const policy = policyService.resolveEquipmentPolicyForActor({
        actor: request.actor,
        draftId: acquisition.draftId,
        targetLevel: acquisition.targetLevel,
        selectedRecipe: acquisition.recipe.kind === "permanent-items" ? "permanent-items" : "lump-sum",
        higherLevelStartClaim: claim,
        customLumpSum:
          acquisition.recipe.kind === "custom-lump-sum"
            ? { amountCopper: acquisition.recipe.amountCopper, judgmentId: acquisition.recipe.judgmentRef }
            : null,
        extraCurrentLevelAllowanceIds: reviewed.gmJudgments
          .filter((entry) => entry.kind === "extra-current-level-allowance")
          .map((entry) => entry.id),
        exceptionJudgmentIds: reviewed.gmJudgments
          .filter((entry) => entry.kind === "rarity-source-exception")
          .map((entry) => entry.id),
      });
      return clone(
        acquisitionDomain.createAcquisitionPolicySnapshot(policy, acquisition.recipe, acquisition.recipeSelection)
          .material
      );
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  async function wait(read, label, timeout = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Outfitter timed out: ${label}`);
  }
  function guard(payload, gm) {
    if (!payload.allowDestructive || game.world.id !== payload.expectedWorldId || Boolean(game.user.isGM) !== gm)
      throw new Error("Outfitter world/role guard failed.");
  }
  function actorFor(payload) {
    guard(payload, payload.definition.executor === "gm");
    const actor = game.actors.get(payload.setup.actorId);
    const marker = actor?.getFlag(moduleId, "equipmentProfileFixture");
    if (
      !actor?.isOwner ||
      actor.name !== payload.setup.actorName ||
      marker?.profileId !== payload.definition.id ||
      marker?.runId !== payload.runId
    )
      throw new Error("Outfitter exact fixture guard failed.");
    return actor;
  }
  function controls(app) {
    return Object.fromEntries(
      [
        "[data-wayfinder-equipment-search]",
        "[data-wayfinder-action='retain-all-equipment']",
        "[data-wayfinder-action='review-equipment-purchases']",
      ].map((selector) => {
        const element = app.element?.querySelector(selector);
        if (!element) return [selector, { present: false }];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return [
          selector,
          {
            present: true,
            disabled: Boolean(element.disabled),
            readOnly: Boolean(element.readOnly),
            inert: Boolean(element.closest("[inert]")),
            fieldsetDisabled: Boolean(element.closest("fieldset[disabled]")),
            ariaDisabled: element.getAttribute("aria-disabled"),
            pointerEvents: style.pointerEvents,
            visibility: style.visibility,
            focused: document.activeElement === element,
            hit: hit
              ? { tag: hit.tagName, className: hit.className, action: hit.dataset.wayfinderAction ?? null }
              : null,
            receivesCenterHit: hit === element || element.contains(hit),
            value: element.value ?? null,
          },
        ];
      })
    );
  }
  function snapshot(app, actor) {
    const draft = actor.getFlag(moduleId, "draft");
    const acquisition = draft?.acquisition;
    return {
      controls: controls(app),
      status: app.element?.querySelector('[data-application-part="equipment-status"]')?.textContent?.trim() ?? "",
      catalogueText: app.element?.querySelector(".equipment-catalogue-state")?.textContent?.trim() ?? "",
      sourceDiagnosticText: [...(app.element?.querySelectorAll("[data-equipment-source-diagnostic]") ?? [])].map(
        (element) => element.textContent?.trim()
      ),
      authorityGateway:
        app.element?.querySelector(".equipment-authority")?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
      recipeControls: [
        ...(app.element?.querySelectorAll('[data-wayfinder-action="select-equipment-recipe"]') ?? []),
      ].map((element) => ({ recipe: element.dataset.recipe, disabled: element.disabled })),
      latestProjection: clone(projections.filter((entry) => entry.actorId === actor.id).at(-1) ?? null),
      recentEvents: clone(events.filter((entry) => entry.actorId === actor.id).slice(-12)),
      acquisition: acquisition
        ? {
            ...identity(acquisition),
            targetLevel: acquisition.targetLevel,
            policyPresent: Boolean(acquisition.policySnapshot),
            baseline: clone(acquisition.baseline),
            recipe: clone(acquisition.recipe),
            disposition: clone(acquisition.disposition),
            cart: cart(acquisition),
            higherLevelStartEvidence: clone(acquisition.policySnapshot?.material?.higherLevelStartEvidence ?? null),
          }
        : null,
      ownership: clone(actor.ownership),
      user: { id: game.user.id, role: game.user.role, isGM: game.user.isGM },
      targetLevel: draft?.targetLevel,
    };
  }
  async function input(app, payload, selector, kind = "click", text) {
    return globalThis.__issue44OutfitterInput({ actorId: payload.setup.actorId, selector, kind, text });
  }
  async function open(actor) {
    const { WayfinderApp } = await import(`/modules/${moduleId}/scripts/wayfinder-app.js`);
    WayfinderApp.open(actor);
    const app = await wait(
      () => Object.values(actor.apps ?? {}).find((entry) => entry instanceof WayfinderApp),
      "actor-bound app"
    );
    await wait(() => app.element?.isConnected, "connected app");
    app.element.setAttribute("data-issue44-outfitter-actor-id", actor.id);
    return app;
  }
  async function equipment(app, actor, payload) {
    const stepId = `starting-equipment-level-${actor.getFlag(moduleId, "draft").targetLevel}`;
    const group = app.element.querySelector(`.step-link[data-step-id="${stepId}"]`)?.closest("details");
    if (group && !group.open)
      await input(
        app,
        payload,
        `[data-wayfinder-action="toggle-rail-level"][data-level="${actor.getFlag(moduleId, "draft").targetLevel}"]`
      );
    await input(app, payload, `.step-link[data-wayfinder-action="select-step"][data-step-id="${stepId}"]`);
    await wait(
      () => app.element.querySelector(`[data-application-part="equipment-status"][data-step-id="${stepId}"]`),
      "equipment pane"
    );
  }
  async function activate(app, actor, payload) {
    if (app.element.querySelector('[data-wayfinder-action="initialize-starting-equipment"]')) {
      await input(app, payload, '[data-wayfinder-action="initialize-starting-equipment"]');
      await wait(() => actor.getFlag(moduleId, "draft")?.acquisition, "initialized acquisition");
    }
    const selector = '[data-wayfinder-action="activate-equipment-policy"][data-start-kind="replacement-character"]';
    const requestSelector =
      '[data-wayfinder-action="request-equipment-start"][data-start-kind="replacement-character"]';
    let activation = { kind: "unchanged" };
    if (app.element.querySelector(requestSelector)) {
      const beforeStore = clone(game.settings.get(moduleId, "equipmentPolicyJudgments"));
      const beforeIds = new Set(
        actor.getFlag(moduleId, "draft").equipmentPolicyRequests.map((entry) => entry.requestId)
      );
      await input(app, payload, requestSelector);
      const request = await wait(
        () => actor.getFlag(moduleId, "draft").equipmentPolicyRequests.find((entry) => !beforeIds.has(entry.requestId)),
        "durable physical higher-start request"
      );
      const afterRequestStore = clone(game.settings.get(moduleId, "equipmentPolicyJudgments"));
      if (JSON.stringify(beforeStore) !== JSON.stringify(afterRequestStore))
        throw new Error("Player request wrote trusted GM authority before approval");
      const approval = await globalThis.__issue44OutfitterApprove({ actorId: actor.id, requestId: request.requestId });
      await wait(
        () =>
          actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot?.material.higherLevelStartEvidence.kind ===
          "gm-confirmation",
        "approved GM-confirmation snapshot"
      );
      activation = {
        kind: "requested-gm",
        request: clone(request),
        trustedStoreUnchangedBeforeApproval: true,
        approval,
      };
    }
    if (!actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot || app.element.querySelector(selector)) {
      await wait(
        () => actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot || app.element.querySelector(selector),
        "current policy authority control"
      );
      if (!actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot || app.element.querySelector(selector)) {
        await input(app, payload, selector);
        const authorityMode = game.settings.get(moduleId, "equipmentPolicy").higherLevelStartAuthority;
        await wait(() => {
          const evidence = actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot?.material
            .higherLevelStartEvidence;
          return authorityMode === "gm-confirmation"
            ? evidence?.kind === "gm-confirmation" && evidence.judgment.authorUserId === game.user.id
            : evidence?.authorUserId === game.user.id;
        }, "current owner attestation");
        activation = { kind: "confirmed-current-account" };
      }
    }
    await wait(() => app.element.querySelector("[data-wayfinder-equipment-search]"), "inner outfitter search");
    return activation;
  }
  async function exercise(app, actor, payload, observations) {
    observations.push({ phase: "entered", ...snapshot(app, actor) });
    const impossibleQuery = `wf44nomatch${actor.id}`;
    let projectionCount = projections.length;
    await input(app, payload, "[data-wayfinder-equipment-search]", "type", impossibleQuery);
    await wait(
      () =>
        projections
          .slice(projectionCount)
          .some(
            (entry) =>
              entry.actorId === actor.id &&
              entry.query === impossibleQuery &&
              entry.state === "ready" &&
              entry.matchedRecordCount === 0
          ) &&
        app.element.querySelector("[data-equipment-stable-host]")?.dataset.wayfinderRenderedQuery === impossibleQuery,
      "real impossible-query filtering"
    );
    observations.push({ phase: "no-match-query", ...snapshot(app, actor) });
    projectionCount = projections.length;
    await input(app, payload, "[data-wayfinder-equipment-search]", "type", "Dagger");
    await wait(
      () =>
        projections
          .slice(projectionCount)
          .some((entry) => entry.actorId === actor.id && entry.query === "Dagger" && entry.state === "ready") &&
        app.element.querySelector("[data-equipment-stable-host]")?.dataset.wayfinderRenderedQuery === "Dagger",
      "new ready Dagger projection and rendered query"
    );
    const preview = `[data-wayfinder-action="preview-equipment-item"][data-source-uuid="${dagger}"]`;
    await wait(() => app.element.querySelector(preview), "typed exact Dagger result");
    observations.push({ phase: "typed", ...snapshot(app, actor) });
    await input(app, payload, preview);
    const purchase = `[data-wayfinder-action="add-equipment-item"][data-source-uuid="${dagger}"][data-funding="currency"]`;
    await wait(() => app.element.querySelector(purchase), "Dagger currency button");
    const quantity = () =>
      actor
        .getFlag(moduleId, "draft")
        ?.acquisition?.lines.filter((entry) => entry.sourceUuid === dagger)
        .reduce((sum, entry) => sum + entry.price.requestedQuantity, 0) ?? 0;
    const beforeQuantity = quantity();
    await input(app, payload, purchase);
    await wait(() => quantity() === beforeQuantity + 1, "durable Dagger quantity increment");
    const line = await wait(
      () => actor.getFlag(moduleId, "draft")?.acquisition?.lines.find((entry) => entry.sourceUuid === dagger),
      "durable added Dagger"
    );
    observations.push({ phase: "added", ...snapshot(app, actor) });
    await input(app, payload, '[data-wayfinder-action="review-equipment-purchases"]');
    await wait(
      () => actor.getFlag(moduleId, "draft")?.acquisition?.disposition.kind === "purchase-ledger",
      "reviewed purchase"
    );
    if (payload.keepItem) {
      observations.push({ phase: "item-reviewed", ...snapshot(app, actor) });
      return;
    }
    await input(app, payload, `[data-wayfinder-action="remove-equipment-line"][data-line-id="${line.lineId}"]`);
    await wait(
      () => !actor.getFlag(moduleId, "draft")?.acquisition?.lines.some((entry) => entry.lineId === line.lineId),
      "Dagger removal"
    );
    await input(app, payload, '[data-wayfinder-action="retain-all-equipment"]');
    await wait(
      () => actor.getFlag(moduleId, "draft")?.acquisition?.disposition.kind === "retain-all",
      "reviewed coin-only disposition"
    );
    observations.push({ phase: "coin-reviewed", ...snapshot(app, actor) });
  }
  globalThis.__issue44Outfitter = {
    async instrument() {
      adapterRegistry = await import(
        `/modules/${moduleId}/scripts/wayfinder/application/starting-equipment-ui-adapter.js`
      );
      [sourcePolicy, policyService, acquisitionDomain] = await Promise.all([
        import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-source-policy.js`),
        import(`/modules/${moduleId}/scripts/wayfinder/application/equipment-policy-service.js`),
        import(`/modules/${moduleId}/scripts/wayfinder/domain/acquisition-draft.js`),
      ]);
      originalAdapter = adapterRegistry.getStartingEquipmentUiAdapter();
      adapterRegistry.registerStartingEquipmentUiAdapter({
        ...originalAdapter,
        async project(request) {
          const beforeDescriptors = descriptors();
          const reviewedMaterial = clone(request.draft.acquisition?.policySnapshot?.material ?? null);
          const result = await originalAdapter.project(request);
          projections.push({
            actorId: request.actor.id,
            targetLevel: request.draft.targetLevel,
            query: request.query,
            state: result.state,
            message: result.message,
            diagnostics: clone(result.diagnostics ?? []),
            matchedRecordCount: result.matchedRecordCount,
            beforeDescriptors,
            afterDescriptors: descriptors(),
            reviewedMaterial,
            currentMaterial: currentMaterial(request),
          });
          return result;
        },
      });
      for (const type of ["pointerdown", "click", "focusin", "keydown", "input"])
        document.addEventListener(
          type,
          (event) => {
            const root =
              event.target instanceof HTMLElement ? event.target.closest("[data-issue44-outfitter-actor-id]") : null;
            if (root)
              events.push({
                actorId: root.dataset.issue44OutfitterActorId,
                type,
                trusted: event.isTrusted,
                action: event.target.dataset?.wayfinderAction ?? null,
                search: event.target.hasAttribute?.("data-wayfinder-equipment-search") ?? false,
              });
          },
          true
        );
    },
    async prepareFixture(payload) {
      guard(payload, true);
      const actor = game.actors.get(payload.setup.actorId);
      const marker = actor?.getFlag(moduleId, "equipmentProfileFixture");
      if (!actor || marker?.runId !== payload.runId || marker.profileId !== payload.definition.id)
        throw new Error("Fixture preparation guard failed.");
      await game.settings.set(moduleId, "equipmentPolicy", payload.setup.policySnapshot);
      if (payload.definition.executor === "gm")
        await actor.update({
          ownership: {
            default: 0,
            [game.user.id]: 3,
            ...(payload.coowner ? { [payload.setup.users.player.id]: 3 } : {}),
          },
        });
      return {
        ownership: clone(actor.ownership),
        originalPolicyRestored:
          JSON.stringify(game.settings.get(moduleId, "equipmentPolicy")) ===
          JSON.stringify(payload.setup.policySnapshot),
      };
    },
    trace(payload) {
      const actor = actorFor(payload);
      const trace = {
        projections: clone(projections.filter((entry) => entry.actorId === actor.id)),
        events: clone(events.filter((entry) => entry.actorId === actor.id)),
      };
      for (const collection of [projections, events])
        for (let index = collection.length - 1; index >= 0; index -= 1)
          if (collection[index].actorId === actor.id) collection.splice(index, 1);
      return trace;
    },
    async saveForOtherOwner(payload) {
      const actor = actorFor(payload);
      const app = Object.values(actor.apps ?? {}).find(
        (entry) => entry.element?.dataset.issue44OutfitterActorId === actor.id
      );
      await input(app, payload, '[data-wayfinder-action="save-draft"]');
      await wait(
        () => app.element.querySelector("[data-wayfinder-save-status]")?.dataset.phase === "saved",
        "saved GM-owned attestation"
      );
      await app.close({ animate: false });
      return { draft: clone(actor.getFlag(moduleId, "draft")), ownership: clone(actor.ownership) };
    },
    async changeAuthority(payload) {
      guard(payload, true);
      const actor = game.actors.get(payload.setup.actorId);
      const marker = actor?.getFlag(moduleId, "equipmentProfileFixture");
      if (
        !actor ||
        actor.name !== payload.setup.actorName ||
        marker?.runId !== payload.runId ||
        marker.profileId !== payload.definition.id
      )
        throw new Error("Authority edge fixture guard failed.");
      const before = {
        policy: clone(game.settings.get(moduleId, "equipmentPolicy")),
        ownership: clone(actor.ownership),
        evidence: clone(
          actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot?.material.higherLevelStartEvidence
        ),
      };
      if (
        before.evidence?.kind !== "actor-owner-attestation" ||
        before.evidence.authorUserId !== payload.setup.users.player.id
      )
        throw new Error("Authority edge requires the player's original current attestation");
      if (payload.authorityEdge === "policy-gm")
        await game.settings.set(moduleId, "equipmentPolicy", {
          ...before.policy,
          higherLevelStartAuthority: "gm-confirmation",
        });
      else if (payload.authorityEdge === "lost-owner")
        await actor.update({ ownership: { ...before.ownership, [payload.setup.users.player.id]: 0 } });
      else throw new Error("Unsupported guarded authority edge");
      return {
        kind: payload.authorityEdge,
        before,
        after: { policy: clone(game.settings.get(moduleId, "equipmentPolicy")), ownership: clone(actor.ownership) },
      };
    },
    async approveAuthorityRequest(payload) {
      const actor = actorFor(payload);
      const app = await open(actor);
      await equipment(app, actor, payload);
      const request = await wait(
        () =>
          actor
            .getFlag(moduleId, "draft")
            .equipmentPolicyRequests.find((entry) => entry.requestId === payload.requestId),
        "GM sees player's persisted request"
      );
      const beforeStore = clone(game.settings.get(moduleId, "equipmentPolicyJudgments"));
      if ((beforeStore.requestDecisions ?? []).some((entry) => entry.request.requestId === payload.requestId))
        throw new Error("Request already has trusted authority before the physical approval");
      const selector = `[data-wayfinder-action="approve-equipment-policy-request"][data-request-id="${payload.requestId}"]`;
      await wait(() => app.element.querySelector(selector), "visible guarded GM approval action");
      await input(app, payload, selector);
      const evidence = await wait(() => {
        const value = actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot?.material.higherLevelStartEvidence;
        return value?.kind === "gm-confirmation" && value.judgment.authorUserId === game.user.id && value;
      }, "physical approval writes GM confirmation");
      const afterStore = clone(game.settings.get(moduleId, "equipmentPolicyJudgments"));
      if (
        !afterStore.judgments.some((entry) => entry.id === evidence.judgment.id && entry.authorUserId === game.user.id)
      )
        throw new Error("Physical approval did not persist the current GM's trusted judgment");
      const result = {
        request: clone(request),
        beforeStore,
        afterStore,
        evidence: clone(evidence),
        gmUserId: game.user.id,
      };
      await app.close({ animate: false });
      return result;
    },
    async applyWithRetry(payload) {
      const actor = actorFor(payload);
      const app = Object.values(actor.apps ?? {}).find(
        (entry) => entry.element?.dataset.issue44OutfitterActorId === actor.id
      );
      const item = actor.getFlag(moduleId, "draft").acquisition.lines.find((entry) => entry.sourceUuid === dagger);
      if (item) {
        await input(app, payload, `[data-wayfinder-equipment-quantity][data-line-id="${item.lineId}"]`, "type", "1");
        await globalThis.__issue44OutfitterInput({ actorId: actor.id, kind: "tab" });
        await wait(
          () =>
            actor.getFlag(moduleId, "draft").acquisition.lines.find((entry) => entry.lineId === item.lineId).price
              .requestedQuantity === 1,
          "quantity one before Apply"
        );
        await input(app, payload, '[data-wayfinder-action="review-equipment-purchases"]');
        await wait(
          () => actor.getFlag(moduleId, "draft").acquisition.disposition.kind === "purchase-ledger",
          "fresh item review before Apply"
        );
      }
      const reviewed = clone(actor.getFlag(moduleId, "draft").acquisition);
      const inventory = () => ({
        copper: actor.inventory.currency.copperValue,
        items: actor.items
          .filter((entry) => entry.isOfType?.("physical"))
          .map((entry) => ({ id: entry.id, source: entry.sourceId, quantity: entry.quantity }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      });
      let injected = false;
      const restore = globalThis.interceptActorUpdate(actor, async ({ updates, operation, callOriginal }) => {
        if (
          !injected &&
          updates[`flags.${moduleId}.draft`] === null &&
          updates[`flags.${moduleId}.state`]?.completedAcquisitionManifest?.id === reviewed.manifestId
        ) {
          injected = true;
          await globalThis.__issue44OutfitterFault({ actorId: actor.id, phase: "armed" });
          throw new Error(`Intentional outfitter fixture final update failure ${actor.id}`);
        }
        return callOriginal(updates, operation);
      });
      async function apply() {
        await input(app, payload, '[data-wayfinder-action="apply-draft"]');
        await globalThis.__issue44OutfitterInput({ actorId: actor.id, kind: "confirm" });
      }
      try {
        await apply();
        await wait(
          () =>
            injected &&
            actor.getFlag(moduleId, "draft")?.acquisition?.currencyConvergenceWitness &&
            app.element.querySelector('[data-wayfinder-action="apply-draft"]')?.disabled === false,
          "durable recovery and enabled retry",
          60_000
        );
      } finally {
        restore();
        await globalThis.__issue44OutfitterFault({ actorId: actor.id, phase: "disarmed" });
      }
      const beforeRetry = inventory();
      const recovery = clone(actor.getFlag(moduleId, "draft"));
      await apply();
      await wait(() => actor.getFlag(moduleId, "draft") == null, "cleared draft after physical retry", 60_000);
      const afterRetry = inventory();
      const manifest = clone(actor.getFlag(moduleId, "state").completedAcquisitionManifest);
      const expectedCopper =
        reviewed.policySnapshot.material.budgetCopper -
        reviewed.lines
          .filter((entry) => entry.funding.lane === "currency")
          .reduce((sum, entry) => sum + entry.price.linePriceCopper, 0);
      const daggers = afterRetry.items.filter((entry) => entry.source === dagger);
      const passed =
        injected &&
        JSON.stringify(identity(recovery.acquisition)) === JSON.stringify(identity(reviewed)) &&
        JSON.stringify(beforeRetry) === JSON.stringify(afterRetry) &&
        afterRetry.copper === expectedCopper &&
        manifest.id === reviewed.manifestId &&
        manifest.draftId === reviewed.draftId &&
        manifest.batchId === reviewed.batchId &&
        actor.system.details.level.value === reviewed.targetLevel &&
        (item ? daggers.length === 1 && daggers[0].quantity === 1 : daggers.length === 0);
      return {
        passed,
        injected,
        beforeRetry,
        afterRetry,
        expectedCopper,
        manifest,
        recoveryIdentity: identity(recovery.acquisition),
        reviewedIdentity: identity(reviewed),
        targetLevel: actor.system.details.level.value,
      };
    },
    async cleanupAuthority(payload) {
      guard(payload, true);
      const actor = game.actors.get(payload.setup.actorId);
      const marker = actor?.getFlag(moduleId, "equipmentProfileFixture");
      if (
        !actor ||
        actor.name !== payload.setup.actorName ||
        marker?.runId !== payload.runId ||
        marker.profileId !== payload.definition.id
      )
        throw new Error("Authority cleanup fixture guard failed.");
      const store = clone(game.settings.get(moduleId, "equipmentPolicyJudgments"));
      const originalIds = new Set((payload.originalJudgments?.judgments ?? []).map((entry) => entry.id));
      const judgments = (store.judgments ?? []).filter(
        (entry) => entry.actorId !== actor.id || originalIds.has(entry.id)
      );
      const originalRequests = new Set(
        (payload.originalJudgments?.requestDecisions ?? []).map((entry) => entry.request?.requestId)
      );
      const decisions = (store.requestDecisions ?? []).filter(
        (entry) => entry.request?.facts?.actorId !== actor.id || originalRequests.has(entry.request?.requestId)
      );
      const removedJudgments = (store.judgments?.length ?? 0) - judgments.length;
      const removedDecisions = (store.requestDecisions?.length ?? 0) - decisions.length;
      const cleaned = {
        ...store,
        judgments,
        ...(Array.isArray(store.requestDecisions) ? { requestDecisions: decisions } : {}),
      };
      const removeEmptyDecisions =
        !Object.hasOwn(payload.originalJudgments, "requestDecisions") &&
        Array.isArray(cleaned.requestDecisions) &&
        cleaned.requestDecisions.length === 0;
      if (removeEmptyDecisions) delete cleaned.requestDecisions;
      if (removedJudgments || removedDecisions || removeEmptyDecisions)
        await game.settings.set(moduleId, "equipmentPolicyJudgments", cleaned);
      return { removedJudgments, removedDecisions };
    },
    async probe(payload) {
      const actor = actorFor(payload);
      const app = await open(actor);
      const observations = [];
      try {
        if (payload.definition.fill === "level-one" && !payload.reopen) {
          for (const target of [2, 3]) {
            await input(app, payload, '[data-wayfinder-action="target-up"]');
            await wait(() => actor.getFlag(moduleId, "draft")?.targetLevel === target, "target level");
          }
        }
        await equipment(app, actor, payload);
        observations.push({ phase: "before-activation", ...snapshot(app, actor) });
        const previousEvidence = actor.getFlag(moduleId, "draft")?.acquisition?.policySnapshot?.material
          .higherLevelStartEvidence;
        const gateway = app.element.querySelector(".equipment-authority");
        if (gateway) await globalThis.__issue44OutfitterCapture({ actorId: actor.id, phase: "authority-gateway" });
        const reclaiming =
          previousEvidence?.kind === "actor-owner-attestation" &&
          previousEvidence.authorUserId !== game.user.id &&
          !game.user.isGM;
        const renewingAuthority = payload.requireGateway && (reclaiming || Boolean(payload.authorityEdge));
        if (
          renewingAuthority &&
          (!gateway ||
            app.element.querySelector("[data-wayfinder-equipment-search]") ||
            (reclaiming && !/your account/iu.test(gateway.textContent)) ||
            [...app.element.querySelectorAll('[data-wayfinder-action="select-equipment-recipe"]')].some(
              (entry) => !entry.disabled
            ))
        )
          throw new Error(
            "Foreign-owner gateway did not explain the account confirmation, lock recipe, and omit the workspace"
          );
        const activation = await activate(app, actor, payload);
        observations.push({ phase: "activation-result", activation, ...snapshot(app, actor) });
        await globalThis.__issue44OutfitterCapture({ actorId: actor.id, phase: "recovered-workspace" });
        if (payload.expectedCarry) {
          const activated = clone(actor.getFlag(moduleId, "draft"));
          const carryChecks = {
            identityPreserved:
              JSON.stringify(identity(activated.acquisition)) ===
              JSON.stringify(identity(payload.expectedCarry.acquisition)),
            cartPreserved:
              JSON.stringify(cart(activated.acquisition)) === JSON.stringify(cart(payload.expectedCarry.acquisition)),
            baselinePreserved:
              JSON.stringify(baseline(activated.acquisition)) ===
              JSON.stringify(baseline(payload.expectedCarry.acquisition)),
            recipePreserved:
              JSON.stringify(activated.acquisition.recipe) === JSON.stringify(payload.expectedCarry.acquisition.recipe),
            choicesPreserved:
              JSON.stringify(choices(activated, payload.expectedCarry.targetLevel)) ===
              JSON.stringify(choices(payload.expectedCarry, payload.expectedCarry.targetLevel)),
            unreviewedAfterReclaim: !renewingAuthority || activated.acquisition.disposition.kind === "unreviewed",
            currentClaimAuthor: activated.acquisition.policySnapshot.material.higherLevelStartEvidence.authorUserId,
            currentAuthorityConfirmed:
              !renewingAuthority ||
              (activation.kind === "requested-gm"
                ? activated.acquisition.policySnapshot.material.higherLevelStartEvidence.kind === "gm-confirmation" &&
                  activated.acquisition.policySnapshot.material.higherLevelStartEvidence.judgment.authorUserId ===
                    activation.approval.gmUserId
                : activated.acquisition.policySnapshot.material.higherLevelStartEvidence.authorUserId === game.user.id),
          };
          observations.push({ phase: "carried-reactivated-before-input", carryChecks, ...snapshot(app, actor) });
          if (
            !carryChecks.identityPreserved ||
            !carryChecks.cartPreserved ||
            !carryChecks.baselinePreserved ||
            !carryChecks.recipePreserved ||
            !carryChecks.choicesPreserved ||
            !carryChecks.unreviewedAfterReclaim ||
            !carryChecks.currentAuthorityConfirmed
          )
            throw new Error(
              "Carried legacy identity, cart, baseline, recipe, or character choices changed before input"
            );
        }
        await exercise(app, actor, payload, observations);
        return { status: "pass", observations };
      } catch (error) {
        observations.push({ phase: "failure", ...snapshot(app, actor) });
        return { status: "fail", error: error instanceof Error ? error.message : String(error), observations };
      }
    },
    async retarget(payload) {
      const actor = actorFor(payload);
      const app = Object.values(actor.apps ?? {}).find(
        (entry) => entry.element?.dataset.issue44OutfitterActorId === actor.id
      );
      if (!app) throw new Error("Retarget requires the already-open tested fixture window.");
      const observations = [];
      try {
        const before = clone(actor.getFlag(moduleId, "draft"));
        const target = before.targetLevel + payload.delta;
        const retainedLevel = Math.min(before.targetLevel, target);
        observations.push({ phase: "before-retarget", ...snapshot(app, actor) });
        await input(app, payload, `[data-wayfinder-action="target-${payload.delta > 0 ? "up" : "down"}"]`);
        await wait(() => actor.getFlag(moduleId, "draft")?.targetLevel === target, "retargeted durable draft");
        await equipment(app, actor, payload);
        observations.push({ phase: "before-reactivation", ...snapshot(app, actor) });
        if (payload.leaveStranded) {
          await input(app, payload, '[data-wayfinder-action="save-draft"]');
          await wait(
            () => app.element.querySelector("[data-wayfinder-save-status]")?.dataset.phase === "saved",
            "saved stranded draft"
          );
          await app.close({ animate: false });
          const saved = clone(actor.getFlag(moduleId, "draft"));
          if (
            saved.targetLevel !== target ||
            saved.acquisition.policySnapshot !== null ||
            !saved.acquisition.baseline ||
            saved.acquisition.disposition.kind !== "unreviewed" ||
            !saved.acquisition.disposition.reasons.includes("target-level") ||
            JSON.stringify(identity(before.acquisition)) !== JSON.stringify(identity(saved.acquisition)) ||
            JSON.stringify(cart(before.acquisition)) !== JSON.stringify(cart(saved.acquisition))
          )
            throw new Error("The saved old-package draft does not satisfy stranded carry invariants");
          return {
            status: "prepared-stranded",
            savedDraft: saved,
            identity: identity(saved.acquisition),
            cart: cart(saved.acquisition),
            observations,
          };
        }
        await activate(app, actor, payload);
        const activated = clone(actor.getFlag(moduleId, "draft"));
        const invariants = {
          identityPreserved:
            JSON.stringify(identity(before.acquisition)) === JSON.stringify(identity(activated.acquisition)),
          cartPreserved: JSON.stringify(cart(before.acquisition)) === JSON.stringify(cart(activated.acquisition)),
          choicesPreserved:
            JSON.stringify(choices(before, retainedLevel)) === JSON.stringify(choices(activated, retainedLevel)),
          beforeCart: cart(before.acquisition),
          activatedCart: cart(activated.acquisition),
        };
        observations.push({ phase: "reactivated-before-input", invariants, ...snapshot(app, actor) });
        if (!invariants.identityPreserved || !invariants.cartPreserved || !invariants.choicesPreserved)
          throw new Error("Retarget altered retained acquisition, cart, or character choices before new input");
        await exercise(app, actor, payload, observations);
        await input(app, payload, '[data-wayfinder-action="save-draft"]');
        await wait(
          () => app.element.querySelector("[data-wayfinder-save-status]")?.dataset.phase === "saved",
          "saved retargeted draft"
        );
        return { status: "pass", observations };
      } catch (error) {
        observations.push({ phase: "failure", ...snapshot(app, actor) });
        return { status: "fail", error: error instanceof Error ? error.message : String(error), observations };
      }
    },
  };
})();
