import { MODULE_ID } from "../../constants.js";
const DRIVER_GLOBAL = "__wayfinderAcquisitionSmokeDriver";
const CAPABILITY_TOMBSTONE = "wayfinder-pf2e:acquisition-smoke-capability-consumed:v1";
const DRIVER_TIMEOUT_MS = 45_000;
const CAPABILITY_MAX_AGE_MS = 15 * 60_000;
const LEVEL_ONE_BUDGET_COPPER = 1_500;
const DAGGER_SOURCE_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
const DAGGER_UNIT_PRICE_COPPER = 20;
const EQUIPMENT_STEP_ID = "starting-equipment-level-1";
const RECOVERY_STATUS = "Wayfinder partially applied this draft. Retry Apply without changing choices; details are in the console.";
let activeSession = null;
export class AcquisitionSmokeCheckpointFailure extends Error {
    checkpoint;
    constructor(checkpoint) {
        super(`Acquisition smoke fault injected at ${checkpoint.checkpointId}.`);
        this.name = "AcquisitionSmokeCheckpointFailure";
        this.checkpoint = cloneCheckpoint(checkpoint);
    }
}
export class AcquisitionSmokeCheckpointController {
    #target;
    #onRetryCheckpoint;
    #mode = "initial";
    #targetOccurrences = 0;
    #failure = null;
    constructor(target, onRetryCheckpoint) {
        this.#target = target ? normalizeCheckpointTarget(target) : null;
        this.#onRetryCheckpoint = onRetryCheckpoint;
    }
    hook = async (checkpoint) => {
        if (this.#mode === "finished") {
            throw new Error("The acquisition smoke checkpoint capability has been revoked.");
        }
        if (this.#mode === "retry") {
            if (checkpoint.kind === "write") {
                await this.#onRetryCheckpoint?.(cloneCheckpoint(checkpoint));
            }
            return;
        }
        if (!this.#target || checkpoint.checkpointId !== this.#target.checkpointId)
            return;
        this.#targetOccurrences += 1;
        if (this.#targetOccurrences !== this.#target.occurrence)
            return;
        if (this.#failure) {
            throw new Error("The acquisition smoke failure boundary was reached more than once.");
        }
        this.#failure = new AcquisitionSmokeCheckpointFailure(checkpoint);
        throw this.#failure;
    };
    get failure() {
        return this.#failure;
    }
    assertInitialAttemptComplete() {
        if (this.#target && !this.#failure) {
            throw new Error(`The acquisition smoke Apply never reached ${this.#target.checkpointId}.`);
        }
        if (!this.#target && this.#failure) {
            throw new Error("The acquisition smoke Apply injected an unconfigured failure.");
        }
    }
    beginRetry() {
        if (!this.#target || !this.#failure || this.#mode !== "initial") {
            throw new Error("The acquisition smoke retry cannot begin without its exact one-shot failure.");
        }
        this.#mode = "retry";
    }
    finish() {
        this.#mode = "finished";
    }
}
class AcquisitionSmokeSession {
    actor;
    caseDefinition;
    binding;
    markerFingerprint;
    controller;
    #boundAcquisition = null;
    constructor(args) {
        this.actor = args.actor;
        this.caseDefinition = args.caseDefinition;
        this.binding = args.binding;
        this.markerFingerprint = canonicalJson(args.marker);
        this.controller = new AcquisitionSmokeCheckpointController(args.binding.checkpointTarget, args.onRetryCheckpoint);
    }
    checkpointHook(draft) {
        this.assertLiveIdentity();
        const acquisition = assertReviewedAcquisitionDraft(draft, this.caseDefinition);
        const identity = {
            draftId: acquisition.draftId,
            batchId: acquisition.batchId,
            manifestId: acquisition.manifestId,
        };
        if (this.#boundAcquisition && canonicalJson(this.#boundAcquisition) !== canonicalJson(identity)) {
            throw new Error("The acquisition smoke retry changed its draft, batch, or manifest identity.");
        }
        this.#boundAcquisition ??= identity;
        return async (checkpoint) => {
            this.assertLiveIdentity();
            await this.controller.hook(checkpoint);
        };
    }
    assertLiveIdentity() {
        const marker = normalizeMarker(this.actor.getFlag(MODULE_ID, "smokeAcquisitionTracer"));
        if (!marker || canonicalJson(marker) !== this.markerFingerprint) {
            throw new Error("The guarded acquisition smoke actor identity changed while Apply was running.");
        }
        assertCurrentPlayerAndRuntime(this.actor, marker);
    }
}
/** Dormant in ordinary pages; only an exact active smoke session can obtain a hook. */
export function acquisitionSmokeCheckpointHookFor(actor, draft) {
    if (!activeSession || activeSession.actor !== actor)
        return undefined;
    return activeSession.checkpointHook(draft);
}
export function registerAcquisitionSmokeDriver() {
    const globals = globalThis;
    const bootstrap = normalizeBootstrap(globals.__wayfinderAcquisitionSmokeBootstrap);
    delete globals.__wayfinderAcquisitionSmokeBootstrap;
    if (!bootstrap || bootstrap.moduleId !== MODULE_ID)
        return;
    if (Date.now() - bootstrap.createdAt > CAPABILITY_MAX_AGE_MS || bootstrap.createdAt > Date.now() + 5_000)
        return;
    if (globalThis.sessionStorage.getItem(CAPABILITY_TOMBSTONE) !== null)
        return;
    globalThis.sessionStorage.setItem(CAPABILITY_TOMBSTONE, bootstrap.nonce);
    if (globals.__wayfinderAcquisitionSmokeDriver)
        return;
    const remainingBindings = new Map(bootstrap.bindings.map((binding) => [binding.caseId, binding]));
    const driver = {
        runCase: (args) => runAcquisitionSmokeCase(bootstrap, remainingBindings, args),
        revoke: () => {
            activeSession?.controller.finish();
            activeSession = null;
            remainingBindings.clear();
            if (globals.__wayfinderAcquisitionSmokeDriver === driver) {
                delete globals.__wayfinderAcquisitionSmokeDriver;
            }
        },
    };
    Object.defineProperty(globals, DRIVER_GLOBAL, {
        configurable: true,
        enumerable: false,
        value: driver,
        writable: false,
    });
}
async function runAcquisitionSmokeCase(bootstrap, remainingBindings, args) {
    if (activeSession)
        throw new Error("Another acquisition smoke UI case is already active.");
    if (args.moduleId !== MODULE_ID || bootstrap.moduleId !== MODULE_ID) {
        throw new Error("The acquisition smoke capability belongs to another module.");
    }
    const actor = normalizeActor(args.actor);
    const caseDefinition = normalizeCaseDefinition(args.caseDefinition);
    const binding = remainingBindings.get(caseDefinition.id);
    if (!binding)
        throw new Error("The acquisition smoke case is absent or was already consumed.");
    if (binding.actorId !== actor.id ||
        binding.definitionFingerprint !== caseDefinition.definitionFingerprint ||
        canonicalJson(binding.caseDefinition) !== canonicalJson(caseDefinition) ||
        canonicalJson(binding.checkpointTarget) !== canonicalJson(normalizeNullableTarget(args.checkpointTarget)) ||
        canonicalJson(binding.checkpointTarget) !== canonicalJson(caseDefinition.acquisitionCase.failure)) {
        throw new Error("The acquisition smoke case does not match its pre-page capability binding.");
    }
    if (binding.checkpointTarget && (!args.onFailure || !args.onRetryCheckpoint)) {
        throw new Error("A forced acquisition smoke case requires failure capture and retry checkpoint callbacks.");
    }
    const marker = normalizeMarker(actor.getFlag(MODULE_ID, "smokeAcquisitionTracer"));
    if (!marker ||
        marker.runId !== bootstrap.runId ||
        marker.caseId !== binding.caseId ||
        marker.definitionFingerprint !== binding.definitionFingerprint ||
        marker.playerId !== bootstrap.playerId ||
        marker.preparedByUserId !== bootstrap.preparedByUserId ||
        marker.worldId !== bootstrap.worldId) {
        throw new Error("The acquisition smoke actor does not match its exact GM-prepared marker.");
    }
    assertCurrentPlayerAndRuntime(actor, marker);
    assertCleanSmokeActor(actor);
    remainingBindings.delete(caseDefinition.id);
    const session = new AcquisitionSmokeSession({
        actor,
        caseDefinition,
        binding,
        marker,
        onRetryCheckpoint: args.onRetryCheckpoint,
    });
    activeSession = session;
    const ui = emptyUiEvidence();
    let wayfinderApplication = null;
    try {
        await openActorSheet(actor);
        ui.actorSheetOpened = true;
        const launch = await waitForValue(() => actorSheetRootOf(actor)?.querySelector(".wayfinder-launch") ?? null, "Wayfinder actor-sheet launch control");
        clickElement(launch);
        ui.launchControlClicked = true;
        wayfinderApplication = await waitForValue(() => wayfinderApplicationFor(actor), "Wayfinder application");
        await openEquipmentPane(wayfinderApplication);
        ui.equipmentPaneOpened = true;
        await initializeEquipment(wayfinderApplication);
        await reviewDisposition(wayfinderApplication, caseDefinition);
        ui.dispositionReviewed = true;
        await clickApplyAndConfirm(wayfinderApplication, actor.name);
        ui.applyClicked = true;
        if (binding.checkpointTarget) {
            const failure = await waitForValue(() => session.controller.failure, "configured acquisition failure");
            session.controller.assertInitialAttemptComplete();
            if (binding.checkpointTarget.expectedPoint === "final-state-after") {
                await waitForValue(() => completedActorState(actor), "durable lost-ack acquisition convergence");
                await args.onFailure?.(failure);
                ui.lateAcknowledgementConverged = true;
                ui.completed = true;
                return { ui };
            }
            const recovery = await waitForValue(() => visibleRecoveryEvidence(actor, wayfinderApplication), "visible acquisition recovery state");
            ui.failureVisible = recovery.failureVisible;
            ui.draftRecoveryVisible = recovery.draftRecoveryVisible;
            ui.partialStateVisible = await exposePartialItemOnActorSheet(actor, recovery.batchId, Number(caseDefinition.acquisitionCase.expectedEntries[0]?.quantity));
            if (!ui.partialStateVisible) {
                throw new Error("The PF2E inventory did not visibly expose the partially created acquisition item.");
            }
            await args.onFailure?.(failure);
            session.controller.beginRetry();
            await clickApplyAndConfirm(wayfinderApplication, actor.name);
            ui.retryClicked = true;
        }
        await waitForValue(() => completedActorState(actor), "completed acquisition manifest and cleared draft");
        session.controller.assertInitialAttemptComplete();
        await waitForValue(() => (wayfinderRoot(wayfinderApplication)?.isConnected === false ? true : null), "closed Wayfinder application");
        ui.completed = true;
        return { ui };
    }
    finally {
        session.controller.finish();
        if (activeSession === session)
            activeSession = null;
        await closeApplication(wayfinderApplication);
        await closeActorSheet(actor);
    }
}
async function openActorSheet(actor) {
    await Promise.resolve(actor.sheet.render(true));
    return waitForValue(() => actorSheetRootOf(actor), "connected PF2E actor sheet");
}
async function openEquipmentPane(application) {
    const step = await waitForValue(() => wayfinderRoot(application)?.querySelector(`[data-wayfinder-action="select-step"][data-step-id="${EQUIPMENT_STEP_ID}"]`) ?? null, "starting-equipment step control");
    clickElement(step);
    await waitForValue(() => wayfinderRoot(application)?.querySelector(".starting-equipment-pane") ?? null, "starting-equipment pane");
}
async function initializeEquipment(application) {
    const setup = await waitForValue(() => wayfinderRoot(application)?.querySelector(`[data-wayfinder-action="initialize-starting-equipment"][data-step-id="${EQUIPMENT_STEP_ID}"]`) ?? null, "starting-equipment setup control");
    clickElement(setup);
    await waitForValue(() => wayfinderRoot(application)?.querySelector(`input[data-wayfinder-equipment-search][data-step-id="${EQUIPMENT_STEP_ID}"]`) ?? null, "initialized starting-equipment catalogue");
}
async function reviewDisposition(application, caseDefinition) {
    const acquisition = caseDefinition.acquisitionCase;
    if (acquisition.disposition === "purchase-ledger") {
        const quantity = Number(acquisition.expectedEntries[0]?.quantity);
        const search = await waitForValue(() => wayfinderRoot(application)?.querySelector(`input[data-wayfinder-equipment-search][data-step-id="${EQUIPMENT_STEP_ID}"]`) ?? null, "equipment search input");
        search.value = "Dagger";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        const result = await waitForValue(() => wayfinderRoot(application)?.querySelector(`[data-equipment-item][data-source-uuid="${DAGGER_SOURCE_UUID}"]`) ?? null, "exact PF2E Dagger catalogue result");
        const add = result.querySelector(`[data-wayfinder-action="add-equipment-item"][data-source-uuid="${DAGGER_SOURCE_UUID}"]`);
        if (!add || isDisabled(add))
            throw new Error("The exact Dagger result cannot be added through the UI.");
        clickElement(add);
        await waitForCartQuantity(application, 1);
        for (let current = 1; current < quantity; current += 1) {
            const increase = await waitForValue(() => daggerCartLine(application)?.querySelector('[data-wayfinder-action="change-equipment-quantity"][data-delta="1"]') ?? null, "Dagger quantity control");
            clickElement(increase);
            await waitForCartQuantity(application, current + 1);
        }
        const review = await waitForEnabledAction(application, "review-equipment-purchases");
        clickElement(review);
        await waitForReviewLabel(application, "Purchases reviewed");
    }
    else {
        if (daggerCartLine(application))
            throw new Error("Retain-all acquisition unexpectedly contains a cart item.");
        const retain = await waitForEnabledAction(application, "retain-all-equipment");
        clickElement(retain);
        await waitForReviewLabel(application, "All starting wealth retained");
    }
    await waitForValue(() => {
        const apply = applyButton(application);
        return apply && !apply.disabled && apply.dataset.wayfinderReadinessReady === "true" ? apply : null;
    }, "enabled reviewed Apply control");
}
async function clickApplyAndConfirm(application, actorName) {
    const apply = await waitForValue(() => {
        const candidate = applyButton(application);
        return candidate && !candidate.disabled && candidate.dataset.wayfinderReadinessReady === "true" ? candidate : null;
    }, "enabled Apply control");
    const confirmation = waitForApplyConfirmation(actorName);
    clickElement(apply);
    clickElement(await confirmation);
}
function waitForApplyConfirmation(actorName) {
    return new Promise((resolve, reject) => {
        const localizedTitle = String(game.i18n.localize("wayfinder-pf2e.App.ApplyConfirmTitle"));
        const localizedYes = String(game.i18n.localize("wayfinder-pf2e.App.ApplyConfirmYes"));
        const hookId = Hooks.on("renderDialogV2", (application, html) => {
            const root = rootElement(html) ?? rootElement(application?.element);
            const applicationTitle = String(application?.title ?? "");
            const text = root?.textContent ?? "";
            if (!root || (!applicationTitle.includes(localizedTitle) && !text.includes(actorName)))
                return;
            const buttons = [...root.querySelectorAll("button")];
            const yes = root.querySelector('button[data-action="yes"]') ??
                buttons.find((button) => button.textContent?.trim() === localizedYes) ??
                null;
            if (!yes)
                return;
            clearTimeout(timeoutId);
            Hooks.off("renderDialogV2", hookId);
            resolve(yes);
        });
        const timeoutId = globalThis.setTimeout(() => {
            Hooks.off("renderDialogV2", hookId);
            reject(new Error("The real Foundry Apply confirmation dialog did not render."));
        }, DRIVER_TIMEOUT_MS);
    });
}
async function exposePartialItemOnActorSheet(actor, batchId, expectedQuantity) {
    const item = actorItems(actor).find((candidate) => {
        const acquisition = recordValue(recordValue(candidate, "flags"), MODULE_ID)?.acquisition;
        return stringValue(acquisition, "batchId") === batchId;
    });
    const itemId = stringValue(item, "id");
    if (!itemId)
        return false;
    const root = await waitForValue(() => actorSheetRootOf(actor), "PF2E actor sheet for partial-state review");
    const inventoryTab = root.querySelector('nav.sheet-navigation a[data-tab="inventory"]');
    if (!inventoryTab)
        return false;
    clickElement(inventoryTab);
    const row = await waitForValue(() => actorSheetRootOf(actor)?.querySelector(`[data-inventory] [data-item-id="${itemId}"]`) ?? null, "partially created PF2E inventory row");
    const name = row.querySelector('h4.name a[data-action="toggle-summary"]')?.textContent?.trim();
    const quantity = Number(row.querySelector(".quantity > span")?.textContent?.trim());
    return name === "Dagger" && quantity === expectedQuantity;
}
function visibleRecoveryEvidence(actor, application) {
    const root = wayfinderRoot(application);
    const status = [...(root?.querySelectorAll(".status-note span") ?? [])].find((candidate) => candidate.textContent?.trim() === RECOVERY_STATUS);
    const draft = normalizeDraftRecord(actor.getFlag(MODULE_ID, "draft"));
    const acquisition = draft ? recordValue(draft, "acquisition") : null;
    const batchId = stringValue(acquisition, "batchId");
    const hasRecovery = Array.isArray(draft?.applyAttemptStepIds) &&
        draft.applyAttemptStepIds.includes(EQUIPMENT_STEP_ID) &&
        batchId !== null;
    const apply = applyButton(application);
    if (!status || !hasRecovery || !daggerCartLine(application) || !apply || apply.disabled)
        return null;
    return { failureVisible: true, draftRecoveryVisible: true, batchId };
}
function completedActorState(actor) {
    const state = normalizeDraftRecord(actor.getFlag(MODULE_ID, "state"));
    return actor.getFlag(MODULE_ID, "draft") == null && recordValue(state, "completedAcquisitionManifest") ? true : null;
}
function assertReviewedAcquisitionDraft(draft, caseDefinition) {
    if (draft.targetLevel !== 1 || !draft.acquisition) {
        throw new Error("The acquisition smoke hook requires a reviewed level-1 acquisition draft.");
    }
    const acquisition = draft.acquisition;
    if (acquisition.targetLevel !== 1 || acquisition.disposition.kind !== caseDefinition.acquisitionCase.disposition) {
        throw new Error("The acquisition smoke Apply disposition differs from the exact case definition.");
    }
    const review = acquisition.disposition.review;
    if (review.reviewedByUserId !== String(game.user?.id ?? "")) {
        throw new Error("The acquisition smoke Apply was not reviewed by the bound non-GM owner.");
    }
    const expected = caseDefinition.acquisitionCase;
    if (expected.disposition === "retain-all") {
        if (acquisition.lines.length !== 0 || acquisition.disposition.kind !== "retain-all") {
            throw new Error("The retain-all smoke case acquired an item.");
        }
    }
    else {
        const line = acquisition.lines[0];
        const quantity = Number(expected.expectedEntries[0]?.quantity);
        if (acquisition.lines.length !== 1 ||
            !line ||
            line.sourceUuid !== DAGGER_SOURCE_UUID ||
            line.itemLevel !== 0 ||
            line.policyDecision.rarity !== "common" ||
            line.policyDecision.publicationSlug !== "pathfinder-player-core" ||
            line.funding.lane !== "currency" ||
            line.stackingIntent !== "aggregate" ||
            line.price.sourceQuantity !== 1 ||
            line.price.requestedQuantity !== quantity ||
            line.price.materializedQuantity !== quantity ||
            line.price.unitPriceCopper !== DAGGER_UNIT_PRICE_COPPER ||
            line.price.linePriceCopper !== expected.expectedSpentCopper) {
            throw new Error("The reviewed acquisition draft differs from the exact Dagger smoke case.");
        }
    }
    for (const value of [acquisition.draftId, acquisition.batchId, acquisition.manifestId]) {
        if (!nonEmptyString(value))
            throw new Error("The acquisition smoke draft is missing durable identity.");
    }
    return {
        draftId: acquisition.draftId,
        batchId: acquisition.batchId,
        manifestId: acquisition.manifestId,
    };
}
function normalizeBootstrap(value) {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.bindings))
        return null;
    if (!randomUuid(value.nonce) ||
        !Number.isSafeInteger(value.createdAt) ||
        !nonEmptyString(value.moduleId) ||
        !nonEmptyString(value.worldId) ||
        !nonEmptyString(value.playerId) ||
        !nonEmptyString(value.preparedByUserId) ||
        !nonEmptyString(value.runId)) {
        return null;
    }
    const bindings = value.bindings.map(normalizeBinding);
    if (bindings.some((binding) => binding === null))
        return null;
    const typedBindings = bindings;
    if (typedBindings.length === 0 ||
        new Set(typedBindings.map((binding) => binding.caseId)).size !== typedBindings.length) {
        return null;
    }
    return {
        schemaVersion: 1,
        nonce: value.nonce,
        createdAt: Number(value.createdAt),
        moduleId: value.moduleId,
        worldId: value.worldId,
        playerId: value.playerId,
        preparedByUserId: value.preparedByUserId,
        runId: value.runId,
        bindings: typedBindings,
    };
}
function normalizeBinding(value) {
    if (!isRecord(value) ||
        !nonEmptyString(value.actorId) ||
        !nonEmptyString(value.caseId) ||
        !definitionFingerprint(value.definitionFingerprint)) {
        return null;
    }
    let checkpointTarget;
    let caseDefinition;
    try {
        checkpointTarget = normalizeNullableTarget(value.checkpointTarget);
        caseDefinition = normalizeCaseDefinition(value.caseDefinition);
    }
    catch {
        return null;
    }
    if (caseDefinition.id !== value.caseId ||
        caseDefinition.definitionFingerprint !== value.definitionFingerprint ||
        canonicalJson(caseDefinition.acquisitionCase.failure) !== canonicalJson(checkpointTarget)) {
        return null;
    }
    return {
        actorId: value.actorId,
        caseId: value.caseId,
        definitionFingerprint: value.definitionFingerprint,
        checkpointTarget,
        caseDefinition,
    };
}
function normalizeMarker(value) {
    if (!isRecord(value) ||
        value.schemaVersion !== 1 ||
        value.purpose !== "acquisition-ui-smoke" ||
        !nonEmptyString(value.runId) ||
        !nonEmptyString(value.caseId) ||
        !definitionFingerprint(value.definitionFingerprint) ||
        !nonEmptyString(value.fixtureName) ||
        !nonEmptyString(value.playerId) ||
        !nonEmptyString(value.preparedByUserId) ||
        !nonEmptyString(value.worldId) ||
        !isRecord(value.runtime) ||
        !nonEmptyString(value.runtime.foundryVersion) ||
        !nonEmptyString(value.runtime.pf2eVersion) ||
        !nonEmptyString(value.runtime.moduleVersion)) {
        return null;
    }
    return value;
}
function normalizeCaseDefinition(value) {
    if (!isRecord(value) || !isRecord(value.acquisitionCase)) {
        throw new Error("The acquisition smoke case definition is malformed.");
    }
    const acquisition = value.acquisitionCase;
    const disposition = acquisition.disposition;
    const entries = acquisition.expectedEntries;
    const expectedSpentCopper = Number(acquisition.expectedSpentCopper);
    const expectedRemainingCopper = Number(acquisition.expectedRemainingCopper);
    if (!nonEmptyString(value.id) ||
        value.caseKind !== "acquisition" ||
        value.targetLevel !== 1 ||
        !definitionFingerprint(value.definitionFingerprint) ||
        acquisition.schemaVersion !== 1 ||
        acquisition.executorRole !== "non-gm-owner" ||
        acquisition.targetLevel !== 1 ||
        (disposition !== "purchase-ledger" && disposition !== "retain-all") ||
        acquisition.expectedBudgetCopper !== LEVEL_ONE_BUDGET_COPPER ||
        !Number.isSafeInteger(expectedSpentCopper) ||
        !Number.isSafeInteger(expectedRemainingCopper) ||
        expectedSpentCopper + expectedRemainingCopper !== LEVEL_ONE_BUDGET_COPPER ||
        !Array.isArray(entries) ||
        !isRecord(acquisition.policyReview) ||
        acquisition.policyReview.required !== false ||
        acquisition.policyReview.reviewerRole !== "gm") {
        throw new Error("The acquisition smoke case is outside the supported level-1 owner boundary.");
    }
    if (disposition === "retain-all") {
        if (entries.length !== 0 || expectedSpentCopper !== 0) {
            throw new Error("The retain-all smoke case has purchase facts.");
        }
    }
    else {
        const entry = entries[0];
        if (entries.length !== 1 ||
            !isRecord(entry) ||
            entry.sourceUuid !== DAGGER_SOURCE_UUID ||
            entry.name !== "Dagger" ||
            entry.itemType !== "weapon" ||
            entry.level !== 0 ||
            entry.rarity !== "common" ||
            entry.publication !== "Pathfinder Player Core" ||
            entry.sourceQuantity !== 1 ||
            entry.rulesCount !== 0 ||
            entry.containerId !== null ||
            entry.stackingIntent !== "aggregate" ||
            entry.unitPriceCopper !== DAGGER_UNIT_PRICE_COPPER ||
            !Number.isSafeInteger(entry.quantity) ||
            Number(entry.quantity) < 1 ||
            expectedSpentCopper !== Number(entry.quantity) * DAGGER_UNIT_PRICE_COPPER) {
            throw new Error("The purchase smoke case is not the exact supported PF2E Dagger candidate.");
        }
    }
    const failure = normalizeNullableTarget(acquisition.failure);
    return {
        id: value.id,
        caseKind: "acquisition",
        targetLevel: 1,
        definitionFingerprint: value.definitionFingerprint,
        acquisitionCase: {
            schemaVersion: 1,
            executorRole: "non-gm-owner",
            targetLevel: 1,
            disposition,
            expectedBudgetCopper: LEVEL_ONE_BUDGET_COPPER,
            expectedSpentCopper,
            expectedRemainingCopper,
            expectedEntries: entries,
            policyReview: { required: false, reviewerRole: "gm" },
            failure,
        },
    };
}
function normalizeNullableTarget(value) {
    if (value == null)
        return null;
    if (!isRecord(value))
        throw new Error("The acquisition smoke checkpoint target is malformed.");
    return normalizeCheckpointTarget(value);
}
function normalizeCheckpointTarget(value) {
    const supported = new Map([
        ["write:embedded-item-create:after", { point: "item-after", phase: "acquisition-items" }],
        ["write:currency-convergence:before", { point: "currency-before", phase: "acquisition-currency" }],
        ["write:currency-convergence:after", { point: "currency-after", phase: "acquisition-currency" }],
        ["write:final-actor-update:before", { point: "final-state-before", phase: "finalize-actor" }],
        ["write:final-actor-update:after", { point: "final-state-after", phase: "finalize-actor" }],
    ]);
    const supportedTarget = supported.get(value.checkpointId);
    if (!supportedTarget ||
        !Number.isSafeInteger(value.occurrence) ||
        value.occurrence < 1 ||
        (value.checkpointId !== "write:embedded-item-create:after" && value.occurrence !== 1) ||
        value.expectedPoint !== supportedTarget.point) {
        throw new Error("The acquisition smoke checkpoint target is unsupported.");
    }
    return {
        checkpointId: value.checkpointId,
        occurrence: value.occurrence,
        expectedPoint: value.expectedPoint,
    };
}
function assertCurrentPlayerAndRuntime(actor, marker) {
    const user = game.user;
    const runtime = currentRuntime();
    if (!user ||
        user.isGM ||
        user.id !== marker.playerId ||
        game.world?.id !== marker.worldId ||
        actor.id.length === 0 ||
        actor.name !== marker.fixtureName ||
        actor.type !== "character" ||
        actor.isOwner !== true ||
        actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) !== true ||
        actor.canUserModify?.(user, "update") !== true ||
        canonicalJson(runtime) !== canonicalJson(marker.runtime)) {
        throw new Error("The acquisition smoke capability is unavailable to this actor, user, world, or runtime.");
    }
}
function assertCleanSmokeActor(actor) {
    const state = normalizeDraftRecord(actor.getFlag(MODULE_ID, "state"));
    if (actor.getFlag(MODULE_ID, "draft") != null ||
        recordValue(state, "completedAcquisitionManifest") != null ||
        actorItems(actor).some((item) => Boolean(recordValue(recordValue(item, "flags"), MODULE_ID)?.acquisition))) {
        throw new Error("The acquisition smoke actor is not a clean GM-prepared fixture.");
    }
}
function currentRuntime() {
    return {
        foundryVersion: requiredString(game.version, "Foundry version"),
        pf2eVersion: requiredString(game.system?.id === "pf2e" ? game.system.version : null, "PF2E version"),
        moduleVersion: requiredString(game.modules?.get?.(MODULE_ID)?.version, "Wayfinder version"),
    };
}
function normalizeActor(value) {
    if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name) || !isRecord(value.apps)) {
        throw new Error("The acquisition smoke driver requires an exact Foundry actor.");
    }
    if (!isRecord(value.sheet) || typeof value.sheet.render !== "function" || typeof value.getFlag !== "function") {
        throw new Error("The acquisition smoke actor lacks its real PF2E sheet or flags.");
    }
    return value;
}
function emptyUiEvidence() {
    return {
        actorSheetOpened: false,
        launchControlClicked: false,
        equipmentPaneOpened: false,
        dispositionReviewed: false,
        applyClicked: false,
        completed: false,
        retryClicked: false,
        failureVisible: false,
        partialStateVisible: false,
        draftRecoveryVisible: false,
        lateAcknowledgementConverged: false,
    };
}
function actorSheetRootOf(actor) {
    const root = rootElement(actor.sheet.element);
    return root?.isConnected ? root : null;
}
function wayfinderApplicationFor(actor) {
    const application = actor.apps[`${MODULE_ID}-${actor.id}`];
    if (!isRecord(application))
        return null;
    return wayfinderRoot(application)?.isConnected ? application : null;
}
function wayfinderRoot(application) {
    return rootElement(application.element);
}
function rootElement(value) {
    if (value instanceof HTMLElement)
        return value;
    if (isRecord(value) && value[0] instanceof HTMLElement)
        return value[0];
    return null;
}
function applyButton(application) {
    return wayfinderRoot(application)?.querySelector('[data-wayfinder-action="apply-draft"]') ?? null;
}
function daggerCartLine(application) {
    return ([...(wayfinderRoot(application)?.querySelectorAll(".equipment-cart-line") ?? [])].find((line) => line.querySelector("span strong")?.textContent?.trim() === "Dagger") ?? null);
}
async function waitForCartQuantity(application, quantity) {
    await waitForValue(() => {
        const line = daggerCartLine(application);
        return Number(line?.querySelector(".equipment-quantity > strong")?.textContent?.trim()) === quantity
            ? true
            : null;
    }, `Dagger cart quantity ${quantity}`);
}
async function waitForEnabledAction(application, action) {
    return waitForValue(() => {
        const candidate = wayfinderRoot(application)?.querySelector(`[data-wayfinder-action="${action}"]`);
        return candidate && !isDisabled(candidate) ? candidate : null;
    }, `${action} control`);
}
async function waitForReviewLabel(application, expected) {
    await waitForValue(() => [
        ...(wayfinderRoot(application)?.querySelectorAll(".equipment-cart footer > span > strong") ?? []),
    ].some((element) => element.textContent?.trim() === expected)
        ? true
        : null, `review label ${expected}`);
}
function isDisabled(element) {
    return element instanceof HTMLButtonElement ? element.disabled : element.getAttribute("aria-disabled") === "true";
}
function clickElement(element) {
    if (isDisabled(element))
        throw new Error("The acquisition smoke driver refused to click a disabled control.");
    element.click();
}
async function waitForValue(read, label) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < DRIVER_TIMEOUT_MS) {
        try {
            const value = read();
            if (value !== null)
                return value;
        }
        catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    }
    const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
    throw new Error(`Timed out waiting for ${label}.${detail}`);
}
async function closeApplication(application) {
    if (application && typeof application.close === "function") {
        await Promise.resolve(application.close({ animate: false })).catch(() => undefined);
    }
}
async function closeActorSheet(actor) {
    if (typeof actor.sheet.close === "function") {
        await Promise.resolve(actor.sheet.close({ animate: false })).catch(() => undefined);
    }
}
function actorItems(actor) {
    const items = actor.items;
    if (Array.isArray(items))
        return items.filter(isRecord);
    if (!isRecord(items))
        return [];
    if (Array.isArray(items.contents))
        return items.contents.filter(isRecord);
    if (typeof items.values === "function") {
        return [...items.values()].filter(isRecord);
    }
    return [];
}
function normalizeDraftRecord(value) {
    return isRecord(value) ? value : null;
}
function recordValue(value, key) {
    return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}
function stringValue(value, key) {
    return isRecord(value) && nonEmptyString(value[key]) ? value[key] : null;
}
function cloneCheckpoint(checkpoint) {
    return Object.freeze({ ...checkpoint });
}
function requiredString(value, label) {
    if (!nonEmptyString(value))
        throw new Error(`Acquisition smoke requires the current ${label}.`);
    return value.trim();
}
function definitionFingerprint(value) {
    return typeof value === "string" && /^wf-acquisition-case-v1-[a-f0-9]{64}$/u.test(value);
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function randomUuid(value) {
    return (typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("Smoke identity cannot contain non-finite numbers.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    throw new TypeError("Smoke identity contains unsupported data.");
}
//# sourceMappingURL=acquisition-smoke-driver.js.map