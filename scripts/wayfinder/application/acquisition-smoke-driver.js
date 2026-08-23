import { MODULE_ID } from "../../constants.js";
const DRIVER_GLOBAL = "__wayfinderAcquisitionSmokeDriver";
const CAPABILITY_TOMBSTONE = "wayfinder-pf2e:acquisition-smoke-capability-consumed:v1";
const DRIVER_TIMEOUT_MS = 45_000;
const CAPABILITY_MAX_AGE_MS = 15 * 60_000;
const LEVEL_ONE_BUDGET_COPPER = 1_500;
const DAGGER_SOURCE_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
const DAGGER_UNIT_PRICE_COPPER = 20;
const EQUIPMENT_STEP_ID = "starting-equipment-level-1";
const NATIVE_GRANT_PROFILES = Object.freeze({
    "dwarf-clan-dagger": Object.freeze({
        id: "equipment-l1-owner-dwarf-clan-dagger-native-retry",
        grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
        ancestryUuid: "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
        ancestryName: "Dwarf",
        heritageUuid: "Compendium.pf2e.heritages.Item.5CqsBKCZuGON53Hk",
        heritageName: "Forge Dwarf",
        featUuid: "Compendium.pf2e.feats-srd.Item.UJ8AqzkkDqRCMNFW",
        featName: "Dwarven Doughtiness",
        granterUuid: "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
        targetUuid: "Compendium.pf2e.equipment-srd.Item.kJJvKm80KwWXPukV",
        targetName: "Clan Dagger",
        targetType: "weapon",
        targetRarity: "uncommon",
        targetPublication: "Pathfinder Player Core",
        targetRulesCount: 0,
        targetPriceCopper: 200,
        selection: { key: "clanWeapon", value: "clan-dagger" },
    }),
    "sarangay-head-gem": Object.freeze({
        id: "equipment-l1-owner-sarangay-head-gem-native-retry",
        grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
        ancestryUuid: "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
        ancestryName: "Sarangay",
        heritageUuid: "Compendium.pf2e.heritages.Item.BHiOV3ETYSv6k7kF",
        heritageName: "Waxing Moon Sarangay",
        featUuid: "Compendium.pf2e.feats-srd.Item.pC9sGxKBOGWQLOuw",
        featName: "Crown of Bone",
        granterUuid: "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
        targetUuid: "Compendium.pf2e.equipment-srd.Item.FA1mAc7rEyC9vzZa",
        targetName: "Head Gem",
        targetType: "equipment",
        targetRarity: "common",
        targetPublication: "Pathfinder Lost Omens Tian Xia Character Guide",
        targetRulesCount: 1,
        targetPriceCopper: 0,
        selection: null,
    }),
});
const RECOVERY_STATUS = "Wayfinder partially applied this draft. Retry Apply without changing choices; details are in the console.";
const LATE_ACKNOWLEDGEMENT_STATUS = "The actor reached the reviewed final state, but Foundry reported a late Apply error. Review the actor before closing.";
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
    #initialItemCreateCheckpoints = 0;
    #failure = null;
    constructor(target, onRetryCheckpoint) {
        this.#target = target ? normalizeCheckpointTarget(target) : null;
        this.#onRetryCheckpoint = onRetryCheckpoint;
    }
    hook = async (checkpoint) => {
        if (this.#mode === "finished") {
            throw new Error("The acquisition smoke checkpoint capability has been revoked.");
        }
        assertValidCheckpoint(checkpoint);
        if (this.#mode === "retry") {
            if (checkpoint.kind === "write") {
                await this.#onRetryCheckpoint?.(cloneCheckpoint(checkpoint));
            }
            return;
        }
        if (checkpoint.kind === "write" &&
            checkpoint.operation === "embedded-item-create" &&
            checkpoint.boundary === "before") {
            this.#initialItemCreateCheckpoints += 1;
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
    get initialItemCreateCheckpoints() {
        return this.#initialItemCreateCheckpoints;
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
    #handledFailure = null;
    #settledFailure = null;
    constructor(args) {
        this.actor = args.actor;
        this.caseDefinition = args.caseDefinition;
        this.binding = args.binding;
        this.markerFingerprint = canonicalJson(args.marker);
        this.controller = new AcquisitionSmokeCheckpointController(args.binding.checkpointTarget, args.onRetryCheckpoint);
    }
    checkpointHook(draft) {
        this.assertLiveIdentity();
        this.#assertBoundAcquisition(draft);
        return async (checkpoint) => {
            this.assertLiveIdentity();
            await this.controller.hook(checkpoint);
        };
    }
    handleFailedApply(draft, error) {
        this.assertLiveIdentity();
        this.#assertBoundAcquisition(draft);
        const failure = this.controller.failure;
        const candidate = error;
        if (!failure ||
            candidate?.name !== "DraftApplyPhaseError" ||
            candidate.failureKind !== "checkpoint-hook" ||
            candidate.cause !== failure ||
            canonicalJson(candidate.checkpoint) !== canonicalJson(failure.checkpoint)) {
            throw new Error("The acquisition smoke Apply settled without its exact injected checkpoint failure.");
        }
        if (this.#handledFailure) {
            throw new Error("The acquisition smoke Apply failure was handled more than once.");
        }
        this.#handledFailure = failure;
    }
    settleFailedApplyRender() {
        if (!this.#handledFailure || this.#settledFailure) {
            throw new Error("The acquisition smoke Apply rendered without one exact unsettled failure.");
        }
        this.#settledFailure = this.#handledFailure;
    }
    failureSettled(failure) {
        return this.#settledFailure === failure;
    }
    #assertBoundAcquisition(draft) {
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
    }
    assertLiveIdentity() {
        const marker = normalizeMarker(this.actor.getFlag(MODULE_ID, "smokeAcquisitionTracer"));
        if (!marker || canonicalJson(marker) !== this.markerFingerprint) {
            throw new Error("The guarded acquisition smoke actor identity changed while Apply was running.");
        }
        assertCurrentExecutorAndRuntime(this.actor, marker);
    }
}
/** Dormant in ordinary pages; only an exact active smoke session can obtain a hook. */
export function acquisitionSmokeCheckpointHookFor(actor, draft) {
    if (!activeSession || activeSession.actor !== actor)
        return undefined;
    return activeSession.checkpointHook(draft);
}
/** Records only the exact active smoke fault after app recovery handling has completed. */
export function acquisitionSmokeApplyFailureHandledFor(actor, draft, error) {
    if (!activeSession || activeSession.actor !== actor)
        return;
    activeSession.handleFailedApply(draft, error);
}
/** Settles the exact handled smoke fault only after the outer post-barrier render completes. */
export function acquisitionSmokeApplyFailureRenderedFor(actor) {
    if (!activeSession || activeSession.actor !== actor)
        return;
    activeSession.settleFailedApplyRender();
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
        marker.executorUserId !== bootstrap.executorUserId ||
        marker.executorRole !== bootstrap.executorRole ||
        marker.preparedByUserId !== bootstrap.preparedByUserId ||
        marker.worldId !== bootstrap.worldId) {
        throw new Error("The acquisition smoke actor does not match its exact GM-prepared marker.");
    }
    if (marker.executorRole !== caseDefinition.acquisitionCase.executorRole) {
        throw new Error("The acquisition smoke actor marker belongs to another executor role.");
    }
    assertCurrentExecutorAndRuntime(actor, marker);
    assertCleanSmokeActor(actor, caseDefinition);
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
            ui.acquisitionItemCreateCheckpoints = session.controller.initialItemCreateCheckpoints;
            assertExpectedItemCreateCheckpoints(caseDefinition, ui.acquisitionItemCreateCheckpoints);
            await waitForValue(() => (session.failureSettled(failure) ? true : null), "settled acquisition failure recovery");
            if (binding.checkpointTarget.expectedPoint === "final-state-after") {
                await waitForValue(() => completedActorState(actor), "durable lost-ack acquisition convergence");
                await waitForValue(() => visibleLateAcknowledgementEvidence(actor, wayfinderApplication), "visible lost-ack status and durable acquisition receipt");
                await args.onFailure?.(failure);
                ui.lateAcknowledgementConverged = true;
                ui.completed = true;
                return { ui };
            }
            const recovery = await waitForValue(() => visibleRecoveryEvidence(actor, wayfinderApplication, caseDefinition), "visible acquisition recovery state");
            ui.failureVisible = recovery.failureVisible;
            ui.draftRecoveryVisible = recovery.draftRecoveryVisible;
            ui.partialStateVisible = await exposeExpectedItemOnActorSheet(actor, recovery.batchId, caseDefinition);
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
        ui.acquisitionItemCreateCheckpoints = session.controller.initialItemCreateCheckpoints;
        assertExpectedItemCreateCheckpoints(caseDefinition, ui.acquisitionItemCreateCheckpoints);
        await waitForValue(() => (wayfinderRoot(wayfinderApplication)?.isConnected !== true ? true : null), "closed Wayfinder application");
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
        const preview = await waitForValue(() => {
            const catalogueProjection = wayfinderRoot(application)?.querySelector('[data-application-part="equipment-catalogue"][data-wayfinder-rendered-query="Dagger"]');
            const catalogueHost = catalogueProjection
                ?.closest(".equipment-catalogue")
                ?.querySelector(`[data-equipment-stable-host][data-step-id="${EQUIPMENT_STEP_ID}"][data-wayfinder-rendered-query="Dagger"]`);
            const candidate = catalogueHost?.querySelector(`[data-equipment-item][data-wayfinder-action="preview-equipment-item"][data-source-uuid="${DAGGER_SOURCE_UUID}"]`);
            if (!catalogueProjection?.isConnected || !catalogueHost?.isConnected || !candidate?.isConnected)
                return null;
            if (isDisabled(candidate))
                throw new Error("The exact Dagger catalogue preview is disabled.");
            return candidate;
        }, "settled exact PF2E Dagger catalogue preview");
        clickElement(preview);
        const add = await waitForValue(() => {
            const root = wayfinderRoot(application);
            const selectedPreview = root?.querySelector(`[data-equipment-stable-host][data-step-id="${EQUIPMENT_STEP_ID}"][data-wayfinder-rendered-query="Dagger"] [data-equipment-item][data-wayfinder-action="preview-equipment-item"][data-source-uuid="${DAGGER_SOURCE_UUID}"][aria-pressed="true"]`);
            const detail = root?.querySelector(`[data-application-part="equipment-detail"][data-equipment-preview="${DAGGER_SOURCE_UUID}"]`);
            const candidate = detail?.querySelector(`[data-wayfinder-action="add-equipment-item"][data-source-uuid="${DAGGER_SOURCE_UUID}"][data-funding="currency"]`);
            if (!selectedPreview?.isConnected || !detail?.isConnected || !candidate?.isConnected)
                return null;
            if (isDisabled(candidate))
                throw new Error("The exact Dagger currency action is disabled.");
            return candidate;
        }, "settled exact PF2E Dagger detail currency action");
        clickElement(add);
        await waitForCartQuantity(application, 1);
        for (let current = 1; current < quantity; current += 1) {
            const increase = await waitForValue(() => daggerCartLine(application)?.querySelector('[data-wayfinder-action="change-equipment-quantity"][data-delta="1"]') ?? null, "Dagger quantity control");
            clickElement(increase);
            await waitForCartQuantity(application, current + 1);
        }
        const review = await waitForEnabledAction(application, "review-equipment-purchases");
        clickElement(review);
        await waitForReviewLabel(application, "Kit confirmed");
    }
    else {
        if (daggerCartLine(application))
            throw new Error("Retain-all acquisition unexpectedly contains a cart item.");
        const retain = await waitForEnabledAction(application, "retain-all-equipment");
        clickElement(retain);
        await waitForReviewLabel(application, "Keeping all your coin");
    }
    await waitForValue(() => {
        const apply = applyButton(application);
        return apply && applyCanRun(application, apply) ? apply : null;
    }, "enabled reviewed Apply control");
}
async function clickApplyAndConfirm(application, actorName) {
    const apply = await waitForValue(() => {
        const candidate = applyButton(application);
        return candidate?.isConnected && applyCanRun(application, candidate) ? candidate : null;
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
            const notifications = [...document.querySelectorAll(".notification")]
                .map((entry) => entry.textContent?.trim())
                .filter(nonEmptyString)
                .join(" | ");
            const statuses = [...document.querySelectorAll(".wayfinder-app .status-note span")]
                .map((entry) => entry.textContent?.trim())
                .filter(nonEmptyString)
                .join(" | ");
            reject(new Error(`The real Foundry Apply confirmation dialog did not render.${notifications ? ` Notifications: ${notifications}` : ""}${statuses ? ` Status: ${statuses}` : ""}`));
        }, DRIVER_TIMEOUT_MS);
    });
}
async function exposeExpectedItemOnActorSheet(actor, batchId, caseDefinition) {
    const expected = caseDefinition.acquisitionCase.expectedEntries[0];
    const native = caseDefinition.acquisitionCase.nativeGrant !== null;
    const item = actorItems(actor).find((candidate) => {
        const acquisition = recordValue(recordValue(candidate, "flags"), MODULE_ID)?.acquisition;
        return native
            ? itemSourceId(candidate) === expected?.sourceUuid && acquisition == null
            : stringValue(acquisition, "batchId") === batchId;
    });
    const itemId = stringValue(item, "id");
    if (!itemId)
        return false;
    const root = await rerenderActorSheet(actor);
    const inventoryTab = root.querySelector('nav.sheet-navigation a[data-tab="inventory"]');
    if (!inventoryTab)
        return false;
    clickElement(inventoryTab);
    const row = await waitForValue(() => {
        const currentRoot = actorSheetRootOf(actor);
        const inventory = currentRoot?.querySelector('.tab.inventory[data-tab="inventory"].active');
        const candidate = inventory?.querySelector(`[data-inventory] [data-item-id="${itemId}"]`) ?? null;
        return candidate?.isConnected && candidate.getClientRects().length > 0 ? candidate : null;
    }, "visible partially created PF2E inventory row");
    const name = row.querySelector('h4.name a[data-action="toggle-summary"]')?.textContent?.trim();
    const quantity = Number(row.querySelector(".quantity > span")?.textContent?.trim());
    return name === expected?.name && quantity === Number(expected?.quantity);
}
function rerenderActorSheet(actor) {
    return new Promise((resolve, reject) => {
        const hookId = Hooks.on("renderActorSheet", (application, html) => {
            const candidate = application;
            if (candidate?.actor?.id !== actor.id && candidate?.document?.id !== actor.id)
                return;
            const root = rootElement(html) ?? actorSheetRootOf(actor);
            if (!root?.isConnected)
                return;
            clearTimeout(timeoutId);
            Hooks.off("renderActorSheet", hookId);
            resolve(root);
        });
        const timeoutId = globalThis.setTimeout(() => {
            Hooks.off("renderActorSheet", hookId);
            reject(new Error("The PF2E actor sheet did not rerender for partial-state review."));
        }, DRIVER_TIMEOUT_MS);
        try {
            actor.sheet.render(true);
        }
        catch (error) {
            clearTimeout(timeoutId);
            Hooks.off("renderActorSheet", hookId);
            reject(error);
        }
    });
}
function visibleLateAcknowledgementEvidence(actor, application) {
    if (!completedActorState(actor))
        return null;
    const root = wayfinderRoot(application);
    const status = [...(root?.querySelectorAll(".status-note span") ?? [])].find((candidate) => candidate.textContent?.trim() === LATE_ACKNOWLEDGEMENT_STATUS);
    const receipt = root?.querySelector('.wayfinder-acquisition-receipt[aria-label="Last starting-equipment Apply receipt"]');
    return status && receipt ? true : null;
}
function visibleRecoveryEvidence(actor, application, caseDefinition) {
    const root = wayfinderRoot(application);
    const status = [...(root?.querySelectorAll(".status-note span") ?? [])].find((candidate) => candidate.textContent?.trim() === RECOVERY_STATUS);
    const draft = normalizeDraftRecord(actor.getFlag(MODULE_ID, "draft"));
    const acquisition = draft ? recordValue(draft, "acquisition") : null;
    const batchId = stringValue(acquisition, "batchId");
    const hasRecovery = Array.isArray(draft?.applyAttemptStepIds) &&
        draft.applyAttemptStepIds.includes(EQUIPMENT_STEP_ID) &&
        batchId !== null;
    const apply = applyButton(application);
    const expectedName = String(caseDefinition.acquisitionCase.expectedEntries[0]?.name ?? "");
    const expectedLineVisible = expectedName ? cartLineByName(application, expectedName) !== null : true;
    if (!status || !hasRecovery || !expectedLineVisible || !apply || apply.disabled)
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
        throw new Error("The acquisition smoke Apply was not reviewed by the bound executor.");
    }
    const expected = caseDefinition.acquisitionCase;
    const expectedApplyAuthority = expected.executorRole === "gm-reviewer" ? "gm-review" : "actor-owner";
    if (acquisition.policySnapshot?.material.authorityPolicy.apply !== expectedApplyAuthority) {
        throw new Error("The acquisition smoke Apply did not capture its exact executor authority policy.");
    }
    if (expected.disposition === "retain-all") {
        const nativeGrantId = stringValue(expected.nativeGrant, "grantId");
        const line = acquisition.lines[0];
        const exactNativeLine = nativeGrantId !== null &&
            acquisition.lines.length === 1 &&
            line?.sourceUuid === expected.expectedEntries[0]?.sourceUuid &&
            line?.stackingIntent === "separate" &&
            line?.funding.lane === "class-grant" &&
            line.funding.grant.plannedGrantId === nativeGrantId &&
            line.price.linePriceCopper === expected.expectedEntries[0]?.unitPriceCopper;
        if (acquisition.disposition.kind !== "retain-all" ||
            (expected.nativeGrant === null ? acquisition.lines.length !== 0 : !exactNativeLine)) {
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
        !nonEmptyString(value.executorUserId) ||
        (value.executorRole !== "non-gm-owner" && value.executorRole !== "gm-reviewer") ||
        !nonEmptyString(value.preparedByUserId) ||
        !nonEmptyString(value.runId)) {
        return null;
    }
    const bindings = value.bindings.map(normalizeBinding);
    if (bindings.some((binding) => binding === null))
        return null;
    const typedBindings = bindings;
    if (typedBindings.length === 0 ||
        new Set(typedBindings.map((binding) => binding.caseId)).size !== typedBindings.length ||
        typedBindings.some((binding) => binding.caseDefinition.acquisitionCase.executorRole !== value.executorRole)) {
        return null;
    }
    return {
        schemaVersion: 1,
        nonce: value.nonce,
        createdAt: Number(value.createdAt),
        moduleId: value.moduleId,
        worldId: value.worldId,
        executorUserId: value.executorUserId,
        executorRole: value.executorRole,
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
        !nonEmptyString(value.executorUserId) ||
        (value.executorRole !== "non-gm-owner" && value.executorRole !== "gm-reviewer") ||
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
        acquisition.schemaVersion !== 2 ||
        (acquisition.executorRole !== "non-gm-owner" && acquisition.executorRole !== "gm-reviewer") ||
        acquisition.targetLevel !== 1 ||
        (disposition !== "purchase-ledger" && disposition !== "retain-all") ||
        acquisition.expectedBudgetCopper !== LEVEL_ONE_BUDGET_COPPER ||
        !Number.isSafeInteger(expectedSpentCopper) ||
        !Number.isSafeInteger(expectedRemainingCopper) ||
        expectedSpentCopper + expectedRemainingCopper !== LEVEL_ONE_BUDGET_COPPER ||
        !Array.isArray(entries) ||
        !isRecord(acquisition.policyReview) ||
        acquisition.policyReview.reviewerRole !== "gm" ||
        (acquisition.executorRole === "non-gm-owner" && acquisition.policyReview.required !== false) ||
        (acquisition.executorRole === "gm-reviewer" && acquisition.policyReview.required !== true)) {
        throw new Error("The acquisition smoke case is outside the supported level-1 owner boundary.");
    }
    const nativeGrant = acquisition.nativeGrant;
    const nativeProfile = normalizeNativeGrant(value.id, nativeGrant, entries);
    if (disposition === "retain-all") {
        if (expectedSpentCopper !== 0 ||
            (nativeGrant === null &&
                (entries.length !== 0 || acquisition.expectedAcquisitionItemCreateCheckpoints !== null)) ||
            (nativeGrant !== null && (!nativeProfile || acquisition.expectedAcquisitionItemCreateCheckpoints !== 0))) {
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
        if (nativeGrant !== null || acquisition.expectedAcquisitionItemCreateCheckpoints !== null) {
            throw new Error("The purchase smoke case cannot declare a native grant.");
        }
    }
    const failure = normalizeNullableTarget(acquisition.failure);
    return {
        id: value.id,
        caseKind: "acquisition",
        targetLevel: 1,
        definitionFingerprint: value.definitionFingerprint,
        acquisitionCase: {
            schemaVersion: 2,
            executorRole: acquisition.executorRole,
            targetLevel: 1,
            disposition,
            expectedBudgetCopper: LEVEL_ONE_BUDGET_COPPER,
            expectedSpentCopper,
            expectedRemainingCopper,
            expectedEntries: entries,
            nativeGrant: nativeProfile,
            expectedAcquisitionItemCreateCheckpoints: acquisition.expectedAcquisitionItemCreateCheckpoints === 0 ? 0 : null,
            policyReview: { required: acquisition.policyReview.required === true, reviewerRole: "gm" },
            failure,
        },
    };
}
function normalizeNativeGrant(caseId, value, entries) {
    if (value === null)
        return null;
    if (!isRecord(value) || !nonEmptyString(value.profileId)) {
        throw new Error("The native-grant smoke profile is malformed.");
    }
    const profile = NATIVE_GRANT_PROFILES[value.profileId];
    const ancestry = recordValue(value, "ancestry");
    const heritage = recordValue(value, "heritage");
    const ancestryFeat = recordValue(value, "ancestryFeat");
    const granter = recordValue(value, "granter");
    const target = recordValue(value, "target");
    const requiredRuleSelection = value.requiredRuleSelection;
    const fixture = recordValue(value, "fixture");
    const background = recordValue(fixture, "background");
    const classSelection = recordValue(fixture, "class");
    const classFeat = recordValue(fixture, "classFeat");
    const entry = entries[0];
    if (!profile ||
        caseId !== profile.id ||
        value.kind !== "fixed-native-grant" ||
        value.grantId !== profile.grantId ||
        value.materializer !== "pf2e-native" ||
        value.fundingLane !== "class-grant" ||
        value.originSlotId !== "ancestry-level-1" ||
        ancestry?.name !== profile.ancestryName ||
        ancestry?.sourceUuid !== profile.ancestryUuid ||
        heritage?.name !== profile.heritageName ||
        heritage?.sourceUuid !== profile.heritageUuid ||
        ancestryFeat?.name !== profile.featName ||
        ancestryFeat?.sourceUuid !== profile.featUuid ||
        granter?.sourceUuid !== profile.granterUuid ||
        target?.sourceUuid !== profile.targetUuid ||
        target?.name !== profile.targetName ||
        target?.itemType !== profile.targetType ||
        target?.level !== 0 ||
        target?.rarity !== profile.targetRarity ||
        target?.publication !== profile.targetPublication ||
        target?.quantity !== 1 ||
        target?.sourceQuantity !== 1 ||
        target?.rulesCount !== profile.targetRulesCount ||
        target?.containerId !== null ||
        target?.unitPriceCopper !== profile.targetPriceCopper ||
        canonicalJson(requiredRuleSelection) !== canonicalJson(profile.selection) ||
        canonicalJson(value.nativeGrantChainSourceUuids) !== canonicalJson([profile.granterUuid, profile.ancestryUuid]) ||
        background?.name !== "Acolyte" ||
        background?.sourceUuid !== "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy" ||
        classSelection?.name !== "Fighter" ||
        classSelection?.sourceUuid !== "Compendium.pf2e.classes.Item.8zn3cD6GSmoo1LW4" ||
        classFeat?.name !== "Sudden Charge" ||
        classFeat?.sourceUuid !== "Compendium.pf2e.feats-srd.Item.qQt3CMrhLkUV1wCv" ||
        fixture?.kind !== "complete-draft" ||
        fixture?.keyAbility !== "str" ||
        canonicalJson(fixture?.levelOneBoosts) !== canonicalJson(["str", "dex", "con", "wis"]) ||
        canonicalJson(fixture?.preferredSkills) !== canonicalJson(["athletics", "crafting", "medicine", "stealth"]) ||
        canonicalJson(fixture?.ruleSelections) !== canonicalJson({ fighterSkill: "athletics" }) ||
        entries.length !== 1 ||
        !isRecord(entry) ||
        entry.sourceUuid !== profile.targetUuid ||
        entry.name !== profile.targetName ||
        entry.itemType !== profile.targetType ||
        entry.level !== 0 ||
        entry.rarity !== profile.targetRarity ||
        entry.publication !== profile.targetPublication ||
        entry.quantity !== 1 ||
        entry.sourceQuantity !== 1 ||
        entry.rulesCount !== profile.targetRulesCount ||
        entry.containerId !== null ||
        entry.stackingIntent !== "separate" ||
        entry.unitPriceCopper !== profile.targetPriceCopper ||
        entry.fundingLane !== "class-grant" ||
        entry.plannedGrantId !== profile.grantId ||
        entry.materializer !== "pf2e-native") {
        throw new Error("The native-grant smoke case is outside the exact supported PF2E profile boundary.");
    }
    return structuredClone(value);
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
function assertCurrentExecutorAndRuntime(actor, marker) {
    const user = game.user;
    const runtime = currentRuntime();
    const role = Number(user?.role);
    const executorRoleMatches = marker.executorRole === "gm-reviewer"
        ? user?.isGM === true && Number.isInteger(role) && role >= 3
        : user?.isGM === false && Number.isInteger(role) && role < 3;
    if (!user ||
        !executorRoleMatches ||
        user.id !== marker.executorUserId ||
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
function assertCleanSmokeActor(actor, caseDefinition) {
    const state = normalizeDraftRecord(actor.getFlag(MODULE_ID, "state"));
    const draft = normalizeDraftRecord(actor.getFlag(MODULE_ID, "draft"));
    const nativeGrant = caseDefinition.acquisitionCase.nativeGrant;
    const nativeDraftMatches = nativeGrant ? nativeFixtureDraftMatches(draft, nativeGrant) : draft === null;
    if (!nativeDraftMatches ||
        recordValue(state, "completedAcquisitionManifest") != null ||
        actorItems(actor).some((item) => Boolean(recordValue(recordValue(item, "flags"), MODULE_ID)?.acquisition))) {
        throw new Error("The acquisition smoke actor is not a clean GM-prepared fixture.");
    }
}
function nativeFixtureDraftMatches(draft, nativeGrant) {
    const ancestry = recordValue(nativeGrant, "ancestry");
    const selections = recordValue(draft, "selections");
    const ancestrySelection = recordValue(selections, "ancestry-level-1");
    return Boolean(draft &&
        draft.targetLevel === 1 &&
        draft.acquisition == null &&
        selections &&
        ancestry &&
        ancestrySelection?.uuid === ancestry.sourceUuid &&
        ancestrySelection?.name === ancestry.name &&
        Object.keys(selections).length === 1);
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
        acquisitionItemCreateCheckpoints: 0,
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
function applyCanRun(application, apply) {
    const savePhase = wayfinderRoot(application)?.querySelector("[data-wayfinder-save-status]")?.dataset.phase;
    return (!apply.disabled &&
        apply.dataset.wayfinderReadinessReady === "true" &&
        (savePhase === "idle" || savePhase === "saved"));
}
function daggerCartLine(application) {
    return cartLineByName(application, "Dagger");
}
function cartLineByName(application, name) {
    return ([...(wayfinderRoot(application)?.querySelectorAll(".equipment-cart-line") ?? [])].find((line) => line.querySelector("span strong")?.textContent?.trim() === name) ?? null);
}
function itemSourceId(item) {
    const flags = recordValue(item, "flags");
    const core = recordValue(flags, "core");
    const stats = recordValue(item, "_stats");
    return stringValue(core, "sourceId") ?? stringValue(stats, "compendiumSource");
}
function assertExpectedItemCreateCheckpoints(caseDefinition, observed) {
    const expected = caseDefinition.acquisitionCase.expectedAcquisitionItemCreateCheckpoints;
    if (expected !== null && observed !== expected) {
        throw new Error(`The native-grant smoke case observed ${observed} acquisition item-create checkpoint(s).`);
    }
}
async function waitForCartQuantity(application, quantity) {
    await waitForValue(() => {
        const line = daggerCartLine(application);
        return Number(line?.querySelector(".equipment-quantity > input")?.value) === quantity
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
function assertValidCheckpoint(checkpoint) {
    if (checkpoint.kind === "phase") {
        if (!nonEmptyString(checkpoint.phase) ||
            (checkpoint.boundary !== "before" && checkpoint.boundary !== "after") ||
            checkpoint.checkpointId !== `phase:${checkpoint.phase}:${checkpoint.boundary}`) {
            throw new Error("The acquisition smoke driver observed a malformed Apply phase checkpoint.");
        }
        return;
    }
    const phaseByOperation = {
        "embedded-item-create": "acquisition-items",
        "currency-convergence": "acquisition-currency",
        "final-actor-update": "finalize-actor",
    };
    const expectedPhase = phaseByOperation[checkpoint.operation];
    if (checkpoint.phase !== expectedPhase ||
        (checkpoint.boundary !== "before" && checkpoint.boundary !== "after") ||
        checkpoint.checkpointId !== `write:${checkpoint.operation}:${checkpoint.boundary}` ||
        !Number.isSafeInteger(checkpoint.ordinal) ||
        checkpoint.ordinal < 1 ||
        (checkpoint.operation !== "embedded-item-create" && checkpoint.ordinal !== 1)) {
        throw new Error("The acquisition smoke driver observed a malformed Apply write checkpoint.");
    }
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
    return typeof value === "string" && /^wf-acquisition-case-v2-[a-f0-9]{64}$/u.test(value);
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