var _a;
import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor, DraftApplyPhaseError, finalizeRecoveredDraftOnActor } from "../actor-updater.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { MODULE_ID, MODULE_TITLE, STATE_FLAG } from "../constants.js";
import { createEmptyDraft, normalizeDraft, normalizeState } from "../draft-service.js";
import { FeedbackSupportApp } from "../feedback-support-app.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { getOptionsForStep, resolveSelection } from "../pack/options.js";
import { getPickerInfoState } from "../pack/picker-state.js";
import { assertCanUseWayfinder, canUseWayfinder, WayfinderActorAuthorityError } from "../permissions.js";
import { getSpellRarityCeilingSetting } from "../settings.js";
import { enqueueActorOperation } from "../shared/actor-operation-queue.js";
import { cloneData } from "../shared/cloning.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import { findSpellcastingEntryForChoice } from "../shared/spellcasting.js";
import { bindWayfinderInteractions, isDraftMutationAction, parseWayfinderAction, } from "./actions.js";
import { assertApplyCandidateCurrent, persistApplyCandidateIfCurrent, WayfinderApplyDriftError, } from "./application/apply-candidate-service.js";
import { buildSelectionPane } from "./application/build-selection-pane-service.js";
import { buildSkillPane, projectSkillRanks } from "./application/build-skill-pane-service.js";
import { prepareCurrentClassGrantPlan } from "./application/class-grant-projection-service.js";
import { adjustDraftTargetLevel, setManualStepComplete, setTrainingLoreSelection, setTrainingRuleSelection, syncLanguageChoiceSelections, syncSkillTrainingSelections, toggleAncestryMode, toggleBoostChoice, toggleSkillIncreaseSelection, toggleTrainingSkillSelection, toggleVoluntaryChoice, toggleVoluntaryEnabled, toggleVoluntaryLegacy, } from "./application/draft-adjustment-service.js";
import { applyDraftLifecycle, buildApplyAttemptDraft, clearDraftLifecycle, hasApplyRecoveryState, } from "./application/draft-lifecycle-service.js";
import { DraftPersistenceCoordinator } from "./application/draft-persistence-service.js";
import { assertDraftSideEffectAllowed, assertFailedApplyRecoveryCandidateCurrent, captureDraftSideEffectPrecondition, capturePersistedDraftPrecondition, clearDraftWithWriteGuard, PersistedDraftWriteGuard, readPersistedDraftSnapshot, saveDraftWithWriteGuard, updateActorWithPersistedDraftPrecondition, WayfinderDraftWriteConflictError, } from "./application/draft-write-guard.js";
import { buildExistingCharacterHistory, withExistingCharacterHistory, } from "./application/existing-character-history-service.js";
import { decideExternalDraftRefresh } from "./application/external-draft-refresh-service.js";
import { buildContextNote, buildOptionContext, resolveSelectionClassHasSpellcasting, resolveSelectionSlug, resolveSelectionTraits, } from "./application/option-context-service.js";
import { derivePickerRenderSession } from "./application/picker-render-session.js";
import { PickerSearchScheduler } from "./application/picker-search-scheduler.js";
import { chooseSelectionOption, selectClassArchetypeValue, selectClassChoiceValue, selectSingletonChoiceValue, toggleLanguageChoiceValue, toggleSpellChoiceSelection, } from "./application/selection-command-service.js";
import { createSelectionInvalidationService } from "./application/selection-invalidation-service.js";
import { SemanticCommandQueue } from "./application/semantic-command-queue.js";
import { buildDraftSaveView, buildWayfinderContext, } from "./application/wayfinder-context-service.js";
import { buildWayfinderAppPlan, findPlanStepBySlotId } from "./application/wayfinder-plan-builder-service.js";
import { recordClassGrantReconciliations } from "./domain/acquisition-draft.js";
import { manifestsDescribeSameOutcome } from "./domain/completed-acquisition-manifest.js";
import { evaluateWayfinderDraftReadiness, isTrainingStepCompleteFromDraft, WayfinderDraftNotReadyError, } from "./domain/step-evaluation.js";
import { hasDuplicateDraftSelection } from "./draft-decisions.js";
import { buildBoostPane } from "./panes/boost-pane.js";
import { buildPreview, matchesSearch } from "./panes/pick-pane.js";
import { emptyPickerFilterState, togglePickerFilterValue } from "./panes/picker-filters.js";
import { evaluateWayfinderStep, resolveActiveStep } from "./plan-service.js";
import { isWizardArcaneSchoolSlotId } from "./slot-ids.js";
import { canGrantRestrictedSpellRarityAccess, withRestrictedSpellRarityAccess, } from "./spell-choice/rarity-access.js";
import { buildAppliedSpellRarityAttestations, buildSpellRarityAttestationReviewLines, createSpellRarityAttestation, evaluateSpellRarityAttestation, frozenSpellRarityAttestationForStep, listSpellRarityAttestationProblems, listSpellRarityRecoveryProblems, } from "./spell-choice/rarity-attestation.js";
import { buildHistoricalSpellChoicePlanningNote } from "./spell-choice-service.js";
const PICKER_COUNT_PART = "picker-count";
const PICKER_RESULTS_PART = "picker-results";
const PICKER_SEARCH_PARTS = [PICKER_COUNT_PART, PICKER_RESULTS_PART];
const PICKER_SEARCH_DELAY_MS = 40;
export class WayfinderApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static #openApps = new Set();
    static DEFAULT_OPTIONS = {
        id: MODULE_ID,
        tag: "section",
        classes: ["wayfinder-app"],
        position: {
            width: 1240,
            height: 820,
        },
        window: {
            icon: "fa-solid fa-compass",
            title: "wayfinder-pf2e.App.Title",
            contentClasses: ["standard-form"],
            resizable: true,
        },
    };
    static PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/wayfinder-app.hbs`,
            root: true,
        },
    };
    actor;
    #draft = null;
    #activeStepId = null;
    #searchByStepId = new Map();
    #pickerFiltersByStepId = new Map();
    #openPickerFilterMenu = null;
    #previewValueByStepId = new Map();
    #scrollById = new Map();
    #pendingSearchFocus = null;
    #pendingStepFocusId = null;
    #recentlyInvalidatedStepIds = new Set();
    #statusNote = null;
    #draftPersistence;
    #draftWriteGuard;
    #semanticCommands = new SemanticCommandQueue();
    #closePromise = null;
    #lastDraftSavePhase = "idle";
    #pickerRenderSession = null;
    #pickerSearchScheduler = new PickerSearchScheduler({
        delayMs: PICKER_SEARCH_DELAY_MS,
        render: (request) => this.#renderPickerSearch(request),
        onError: (error) => {
            console.error("PF2E Wayfinder picker search render failed", error);
            ui.notifications.error("Wayfinder could not update these search results. Reopen the window and try again.");
        },
    });
    static open(actor) {
        if (!canUseWayfinder(actor)) {
            ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.OwnerOnly"));
            return;
        }
        const existing = Object.values(actor.apps).find((app) => app instanceof _a);
        if (existing) {
            existing.render(true);
            return;
        }
        new _a({ actor }).render(true);
    }
    static rerenderOpenApps() {
        for (const app of this.#openApps) {
            app.render(false);
        }
    }
    static refreshDraftFromActorUpdate(actor) {
        for (const app of this.#openApps) {
            if (app.actor.id === actor.id) {
                app.#queueExternalDraftRefresh();
            }
        }
    }
    constructor(options) {
        super({
            uniqueId: `${MODULE_ID}-${options.actor.id}`,
        });
        this.actor = options.actor;
        const initialLevel = inspectActor(this.actor).level;
        this.#draftWriteGuard = new PersistedDraftWriteGuard(readPersistedDraftSnapshot(this.actor, initialLevel));
        this.#draftPersistence = new DraftPersistenceCoordinator({
            saveDraft: (draft) => enqueueActorOperation(this.actor, async () => {
                const currentLevel = inspectActor(this.actor).level;
                await saveDraftWithWriteGuard(this.actor, draft, currentLevel, this.#draftWriteGuard);
            }),
            onStateChange: (state) => this.#onDraftSaveStateChange(state),
        });
        this.actor.apps[this.id] = this;
    }
    get id() {
        return `${MODULE_ID}-${this.actor.id}`;
    }
    get title() {
        return `${MODULE_TITLE}: ${this.actor.name}`;
    }
    _configureRenderOptions(options) {
        if (!isPickerSearchRender(options)) {
            options.wayfinderPickerSourceRevision = this.#pickerSearchScheduler.invalidateSource();
            options.wayfinderPickerViewRevision = this.#pickerSearchScheduler.viewRevision;
        }
        super._configureRenderOptions(options);
    }
    _configureRenderParts(options) {
        const parts = super._configureRenderParts(options);
        if (!isPickerSearchRender(options)) {
            return parts;
        }
        const isSpellChoice = this.#pickerRenderSession?.session.basePane.kind === "spell-choice";
        parts[PICKER_COUNT_PART] = {
            template: `modules/${MODULE_ID}/templates/wayfinder/picker-result-count.hbs`,
        };
        parts[PICKER_RESULTS_PART] = {
            template: `modules/${MODULE_ID}/templates/wayfinder/${isSpellChoice ? "spell-choice-results" : "pick-results"}.hbs`,
        };
        return parts;
    }
    _canRender(options) {
        if (super._canRender(options) === false) {
            return false;
        }
        const request = pickerSearchRequest(options);
        if (!request) {
            return;
        }
        if (!this.#canCommitPickerSearch(request)) {
            return false;
        }
    }
    async _prepareContext(options = {}) {
        const pickerRequest = pickerSearchRequest(options);
        if (pickerRequest) {
            const session = this.#pickerRenderSession?.session;
            if (!session || !this.#canCommitPickerSearch(pickerRequest)) {
                options.wayfinderSkippedReplacement = true;
                return {
                    wayfinderRenderScope: "picker-search",
                    activePane: null,
                    pickerRequest,
                };
            }
            return {
                wayfinderRenderScope: "picker-search",
                activePane: derivePickerRenderSession(session, {
                    search: pickerRequest.query,
                    filterState: this.#pickerFiltersByStepId.get(pickerRequest.stepId),
                    openFilterKind: this.#openPickerFilterMenu?.stepId === pickerRequest.stepId ? this.#openPickerFilterMenu.filterKind : null,
                }),
                pickerRequest,
            };
        }
        const snapshot = inspectActor(this.actor);
        const draft = this.#ensureDraft(snapshot.level);
        const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
        const plan = await this._buildRenderPlan(snapshot, draft);
        if (!this.#semanticCommands.busy && !hasApplyRecoveryState(draft)) {
            const orphanedSpellChoices = this.#selectionInvalidationService(draft).invalidateOrphanedSpellChoicesForSteps(plan.steps);
            if (orphanedSpellChoices.length > 0) {
                this.#statusNote = "Wayfinder removed spell choices and player attestations from vanished steps.";
                this.#draftDidChange();
            }
        }
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        const readiness = await evaluateWayfinderDraftReadiness(plan.steps, (step) => this.#evaluateStep(step, effectiveBuildState, draft, plan.steps, snapshot.skillRanks));
        const evaluationsByStepId = new Map(plan.steps.map((step, index) => [step.id, readiness.evaluations[index]]));
        const activeStep = await this.#resolveActiveStep(plan.steps, evaluationsByStepId);
        const activeEvaluation = activeStep ? evaluationsByStepId.get(activeStep.id) : null;
        let pickerRenderSession = null;
        const activePane = activeStep && activeEvaluation
            ? await this.#buildActivePane(activeStep, activeEvaluation, effectiveBuildState, plan.steps, (session) => {
                pickerRenderSession = session;
            })
            : null;
        const [effectiveAncestry, effectiveHeritage, effectiveBackground, effectiveClass, effectiveDeity] = await Promise.all([
            getEffectiveSingletonDocument(this.actor, draft, "ancestry"),
            getEffectiveSingletonDocument(this.actor, draft, "heritage"),
            getEffectiveSingletonDocument(this.actor, draft, "background"),
            getEffectiveSingletonDocument(this.actor, draft, "class"),
            getEffectiveSingletonDocument(this.actor, draft, "deity"),
        ]);
        const planningNote = buildHistoricalSpellChoicePlanningNote({
            currentLevel: snapshot.level,
            effectiveClassDocument: effectiveClass,
            extractSlug: extractDocumentSlug,
        });
        return Object.assign(await buildWayfinderContext({
            actorId: this.actor.id,
            actorName: this.actor.name,
            currentLevel: snapshot.level,
            targetLevel: plan.targetLevel,
            steps: plan.steps,
            activeStep,
            activePane,
            statusNote: this.#statusNote,
            planningNote,
            summaryDocuments: {
                ancestry: effectiveAncestry,
                heritage: effectiveHeritage,
                background: effectiveBackground,
                classDocument: effectiveClass,
                deity: effectiveDeity,
            },
            readiness,
            canImportExistingHistory: !snapshot.isBlank,
            existingCharacterHistory: state.existingCharacterHistory,
            lastAppliedSpellRarityAttestations: state.lastAppliedSpellRarityAttestations,
            draftSaveState: this.#draftPersistence.state,
            lifecycleBusy: this.#semanticCommands.barrierActive,
        }), {
            wayfinderRenderScope: "full",
            pickerRenderSession,
            pickerSourceRevision: numericRenderOption(options.wayfinderPickerSourceRevision),
        });
    }
    _replaceHTML(result, content, options) {
        const pickerRequest = pickerSearchRequest(options);
        if (pickerRequest) {
            if (!this.#canCommitPickerSearch(pickerRequest) || !hasPickerPartTargets(content, pickerRequest.stepId)) {
                options.wayfinderSkippedReplacement = true;
                return;
            }
            super._replaceHTML(result, content, options);
            return;
        }
        const startingViewRevision = numericRenderOption(options.wayfinderPickerViewRevision);
        if (!options.isFirstRender && startingViewRevision !== this.#pickerSearchScheduler.viewRevision) {
            options.wayfinderSkippedReplacement = true;
            queueMicrotask(() => {
                if (this.actor.apps[this.id] === this) {
                    void this.render(false).catch((error) => {
                        console.error("PF2E Wayfinder failed to refresh a stale full render", error);
                    });
                }
            });
            return;
        }
        super._replaceHTML(result, content, options);
    }
    async _onRender(context, options) {
        await super._onRender(context, options);
        if (options.wayfinderSkippedReplacement) {
            return;
        }
        const root = this.element;
        if (!(root instanceof HTMLElement)) {
            return;
        }
        if (context.wayfinderRenderScope === "picker-search") {
            const results = root.querySelector(`[data-application-part="${PICKER_RESULTS_PART}"]`);
            if (results) {
                bindWayfinderInteractions(results, {
                    onActionClick: this.#onActionClick,
                    onSearchInput: this.#onSearchInput,
                    onScrollableScroll: this.#onScrollableScroll,
                    onManualChange: this.#onManualChange,
                    onLoreInputChange: this.#onLoreInputChange,
                }, this.#scrollById, null);
            }
            this.#pendingSearchFocus = null;
            return;
        }
        this.#pickerRenderSession = context.pickerRenderSession
            ? { sourceRevision: context.pickerSourceRevision, session: context.pickerRenderSession }
            : null;
        this.#pendingSearchFocus = bindWayfinderInteractions(root, {
            onActionClick: this.#onActionClick,
            onSearchInput: this.#onSearchInput,
            onScrollableScroll: this.#onScrollableScroll,
            onManualChange: this.#onManualChange,
            onLoreInputChange: this.#onLoreInputChange,
        }, this.#scrollById, this.#pendingSearchFocus).pendingSearchFocus;
        const pendingStepFocusId = this.#pendingStepFocusId;
        const stepHeading = root.querySelector("[data-wayfinder-step-heading]");
        if (pendingStepFocusId && stepHeading?.dataset.wayfinderStepHeading === pendingStepFocusId) {
            stepHeading.focus();
        }
        if (pendingStepFocusId) {
            this.#pendingStepFocusId = null;
        }
        _a.#openApps.add(this);
        this.#patchDraftSaveStatus(this.#draftPersistence.state);
    }
    _tearDown(options) {
        try {
            super._tearDown(options);
        }
        finally {
            this.#finalizeClosedState();
        }
    }
    _canDetach() {
        return false;
    }
    close(options = {}) {
        if (this.#closePromise !== null) {
            return this.#closePromise;
        }
        const closing = this.#closeWithPersistence(options);
        this.#closePromise = closing;
        void closing
            .finally(() => {
            if (this.#closePromise === closing) {
                this.#closePromise = null;
            }
        })
            .catch(() => undefined);
        return closing;
    }
    async #closeWithPersistence(options) {
        const barrier = await this.#semanticCommands.acquireBarrier();
        if (barrier === "acquired") {
            try {
                await this.#draftPersistence.pauseAndFlush();
            }
            catch (error) {
                this.#draftPersistence.resume();
                this.#semanticCommands.releaseBarrier();
                this.#statusNote =
                    "Wayfinder could not save the latest draft, so the window stayed open. Retry the save first.";
                this.#patchDraftSaveStatus(this.#draftPersistence.state);
                ui.notifications.error("Wayfinder kept this window open because the latest draft could not be saved.");
                console.error("PF2E Wayfinder failed to save before close", error);
                this.render(false);
                return this;
            }
        }
        try {
            const closed = (await super.close(options));
            this.#finalizeClosedState();
            return closed;
        }
        catch (error) {
            if (barrier === "acquired") {
                this.#draftPersistence.resume();
                this.#semanticCommands.releaseBarrier();
            }
            throw error;
        }
    }
    #finalizeClosedState() {
        this.#pickerSearchScheduler.dispose();
        this.#semanticCommands.completeTerminalOperation();
        this.#draftPersistence.dispose();
        _a.#openApps.delete(this);
        if (this.actor.apps[this.id] === this) {
            delete this.actor.apps[this.id];
        }
    }
    #onActionClick = async (event) => {
        const target = event.currentTarget;
        const action = parseWayfinderAction(target);
        if (!action) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.#rememberInteractiveState();
        if (action.type !== "toggle-picker-filter" && action.type !== "toggle-picker-filter-menu") {
            this.#openPickerFilterMenu = null;
        }
        if ((isDraftMutationAction(action) || action.type === "clear-draft" || action.type === "import-existing-history") &&
            !this.#allowDraftMutation()) {
            return;
        }
        if (isDraftMutationAction(action)) {
            const queued = this.#semanticCommands.enqueue(async () => {
                const before = draftFingerprint(this.#draft);
                try {
                    await this.#dispatchAction(action);
                }
                finally {
                    if (draftFingerprint(this.#draft) !== before) {
                        this.#draftDidChange();
                    }
                }
            });
            if (queued !== null) {
                await queued;
            }
            return;
        }
        if (action.type === "save-draft" || action.type === "retry-draft-save") {
            const queued = this.#semanticCommands.enqueue(() => action.type === "retry-draft-save" ? this.#retryDraftSave() : this.#saveDraft());
            if (queued !== null) {
                await queued;
            }
            return;
        }
        if (action.type === "apply-draft") {
            const apply = this.#semanticCommands.runBarrier(() => this.#applyDraft());
            if (apply !== null) {
                const applied = await apply;
                if (applied) {
                    await this.close({ animate: false });
                }
                else {
                    this.render(false);
                }
            }
            return;
        }
        if (action.type === "clear-draft") {
            const clear = this.#semanticCommands.runBarrier(() => this.#clearDraft());
            if (clear !== null) {
                await clear;
                this.render(false);
            }
            return;
        }
        if (action.type === "import-existing-history") {
            const queued = this.#semanticCommands.enqueue(() => this.#importExistingHistory());
            if (queued !== null) {
                await queued;
            }
            return;
        }
        if (action.type === "open-feedback") {
            FeedbackSupportApp.open();
            return;
        }
        await this.#dispatchAction(action);
    };
    async #dispatchAction(action) {
        switch (action.type) {
            case "select-step":
                this.#activeStepId = action.stepId;
                this.#pendingStepFocusId = action.stepId;
                this.render(false);
                break;
            case "previous-step":
                await this.#moveStep(-1);
                break;
            case "next-step":
                await this.#moveStep(1);
                break;
            case "preview-option":
                this.#previewValueByStepId.set(action.stepId, action.value);
                this.render(false);
                break;
            case "select-option":
                await this.#chooseOption(action.stepId, action.value);
                break;
            case "toggle-picker-filter-menu":
                this.#togglePickerFilterMenu(action.stepId, action.filterKind);
                break;
            case "toggle-picker-filter":
                this.#togglePickerFilter(action.stepId, action.filterKind, action.value);
                break;
            case "clear-picker-filters":
                this.#clearPickerFilters(action.stepId);
                break;
            case "toggle-ancestry-mode":
                await this.#toggleAncestryMode();
                break;
            case "toggle-voluntary-enabled":
                await this.#toggleVoluntaryEnabled();
                break;
            case "toggle-voluntary-legacy":
                await this.#toggleVoluntaryLegacy();
                break;
            case "toggle-boost-choice":
                await this.#toggleBoostChoice(action.stepId, action.section, action.attribute);
                break;
            case "toggle-voluntary-choice":
                await this.#toggleVoluntaryChoice(action.stepId, action.attribute, action.choiceKind);
                break;
            case "select-skill-increase":
                this.#selectSkillIncrease(action.stepId, action.slug);
                break;
            case "select-training-rule":
                await this.#selectTrainingRule(action.stepId, action.key, action.slug);
                break;
            case "toggle-training-skill":
                await this.#toggleTrainingSkill(action.stepId, action.slug);
                break;
            case "select-training-lore-suggestion":
                await this.#setTrainingLore(action.stepId, action.key, action.value);
                break;
            case "toggle-language-choice":
                await this.#toggleLanguageChoice(action.stepId, action.value);
                break;
            case "select-singleton-choice":
                await this.#selectSingletonChoice(action.stepId, action.value);
                break;
            case "select-class-archetype":
                await this.#selectClassArchetype(action.stepId, action.value);
                break;
            case "select-class-choice":
                await this.#selectClassChoice(action.stepId, action.value);
                break;
            case "toggle-spell-choice":
                await this.#toggleSpellChoice(action.stepId, action.value);
                break;
            case "toggle-spell-rarity-access":
                await this.#toggleSpellRarityAccess(action.stepId);
                break;
            case "remove-spell-rarity-attestation":
                await this.#removeSpellRarityAttestation(action.stepId);
                break;
            case "clear-option":
                this.#statusNote = null;
                {
                    const invalidation = this.#selectionInvalidationService();
                    invalidation.clearSelection(action.stepId);
                    await invalidation.invalidateOrphanedSpellChoices();
                }
                this.render(false);
                break;
            case "target-up":
                await this.#adjustTargetLevel(1);
                break;
            case "target-down":
                await this.#adjustTargetLevel(-1);
                break;
            case "save-draft":
            case "retry-draft-save":
            case "apply-draft":
            case "import-existing-history":
            case "open-feedback":
            case "clear-draft":
                break;
        }
    }
    #onSearchInput = (event) => {
        const input = event.currentTarget;
        const stepId = input?.dataset.stepId;
        if (!stepId) {
            return;
        }
        this.#openPickerFilterMenu = null;
        this.#searchByStepId.set(stepId, input.value);
        this.#pickerSearchScheduler.schedule(stepId, input.value);
    };
    async #renderPickerSearch(request) {
        if (!this.#canCommitPickerSearch(request)) {
            return;
        }
        await this.render({
            parts: [...PICKER_SEARCH_PARTS],
            wayfinderPickerRequest: request,
        });
    }
    #canCommitPickerSearch(request) {
        const prepared = this.#pickerRenderSession;
        const root = this.element;
        return (this.#pickerSearchScheduler.isCurrent(request) &&
            prepared?.sourceRevision === request.sourceRevision &&
            prepared.session.basePane.stepId === request.stepId &&
            this.#searchByStepId.get(request.stepId) === request.query &&
            root instanceof HTMLElement &&
            hasPickerPartTargets(root, request.stepId));
    }
    #onScrollableScroll = (event) => {
        const scrollable = event.currentTarget;
        const scrollId = scrollable?.dataset.wayfinderScrollId;
        if (!scrollId || !scrollable) {
            return;
        }
        this.#scrollById.set(scrollId, scrollable.scrollTop);
    };
    #onManualChange = async (event) => {
        const input = event.currentTarget;
        const stepId = input?.dataset.stepId;
        if (!stepId) {
            return;
        }
        if (!this.#allowDraftMutation()) {
            return;
        }
        const queued = this.#semanticCommands.enqueue(async () => {
            this.#statusNote = null;
            this.#openPickerFilterMenu = null;
            if (setManualStepComplete(this.#draftAdjustmentState(), stepId, input.checked)) {
                this.#draftDidChange();
                this.render(false);
            }
        });
        if (queued !== null) {
            await queued;
        }
        else {
            this.render(false);
        }
    };
    #onLoreInputChange = async (event) => {
        const input = event.currentTarget;
        const stepId = input?.dataset.stepId;
        const key = input?.dataset.key;
        if (!stepId || !key) {
            return;
        }
        if (!this.#allowDraftMutation()) {
            return;
        }
        const queued = this.#semanticCommands.enqueue(async () => {
            const before = draftFingerprint(this.#draft);
            try {
                await this.#setTrainingLore(stepId, key, input.value);
            }
            finally {
                if (draftFingerprint(this.#draft) !== before) {
                    this.#draftDidChange();
                }
            }
        });
        if (queued !== null) {
            await queued;
        }
        else {
            this.render(false);
        }
    };
    #ensureDraft(defaultTargetLevel) {
        if (!this.#draft) {
            this.#draft = normalizeDraft(this.actor.getFlag(MODULE_ID, "draft"), defaultTargetLevel);
            this.#draftPersistence.initialize(this.#draft);
        }
        else {
            this.#reconcileLiveRecoveryDraft(defaultTargetLevel);
        }
        return this.#draft;
    }
    #requireDraft() {
        if (!this.#draft) {
            this.#draft = createEmptyDraft(1);
            this.#draftPersistence.initialize(this.#draft);
        }
        return this.#draft;
    }
    _buildRenderPlan(snapshot, draft) {
        return this.#buildPlan(snapshot, draft);
    }
    _buildRenderPreview(...args) {
        return buildPreview(...args);
    }
    async #buildPlan(snapshot = inspectActor(this.actor), draft = this.#requireDraft()) {
        return buildWayfinderAppPlan({
            actor: this.actor,
            snapshot,
            draft,
            resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType, draft),
            resolveArcaneSchoolDocument: () => this.#resolveDraftOrActorArcaneSchoolDocument(draft),
            localize: (value) => game.i18n.localize(value),
        });
    }
    async #findPlanStepBySlotId(slotId, snapshot = inspectActor(this.actor), draft = this.#requireDraft()) {
        return findPlanStepBySlotId({
            actor: this.actor,
            snapshot,
            draft,
            resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType, draft),
            resolveArcaneSchoolDocument: () => this.#resolveDraftOrActorArcaneSchoolDocument(draft),
            localize: (value) => game.i18n.localize(value),
        }, slotId);
    }
    async #resolveActiveStep(steps, evaluationsByStepId) {
        const resolved = await resolveActiveStep(steps, this.#activeStepId, async (step) => evaluationsByStepId.get(step.id)?.complete === true);
        this.#activeStepId = resolved.activeStepId;
        return resolved.activeStep;
    }
    async #buildActivePane(step, stepEvaluation, effectiveBuildState, planSteps, onPickerRenderSession) {
        if (step.kind === "manual") {
            const pane = {
                kind: "manual",
                templateKind: "manual",
                stepId: step.id,
                slotId: step.slotId,
                level: step.level,
                modeLabel: "Manual",
                title: step.title,
                description: step.description,
                completed: this.#requireDraft().manual[step.slotId] === true,
                selectedLabel: stepEvaluation.status,
            };
            return pane;
        }
        if (step.kind === "boost") {
            return buildBoostPane(step, effectiveBuildState, {
                isStepComplete: async () => stepEvaluation.complete,
                stepStatus: async () => stepEvaluation.status,
                abilityLabel: (attribute) => this.#abilityLabel(attribute),
            });
        }
        const skillPane = await buildSkillPane(step, this.#requireDraft(), {
            baseSkillRanks: inspectActor(this.actor).skillRanks,
            resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
            configSkills: getPf2eConfig()?.skills ?? null,
            localize: (value) => game.i18n.localize(value),
            isTrainingStepComplete: (trainingStep) => this.#isTrainingStepComplete(trainingStep),
        });
        if (skillPane) {
            return skillPane;
        }
        const selectionPane = await buildSelectionPane(step, effectiveBuildState, {
            actorId: this.actor.id,
            draft: this.#requireDraft(),
            searchByStepId: this.#searchByStepId,
            pickerFiltersByStepId: this.#pickerFiltersByStepId,
            openPickerFilterMenu: this.#openPickerFilterMenu,
            previewValueByStepId: this.#previewValueByStepId,
            spellRarityCeiling: getSpellRarityCeilingSetting(),
            resolveOptionContext: (paneStep) => buildOptionContext({
                draft: this.#requireDraft(),
                steps: planSteps,
                excludedFeatSlotId: paneStep.slotId,
                maximumFeatLevel: paneStep.level,
                skillRanks: inspectActor(this.actor).skillRanks,
                resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                listActorItems: () => listActorItems(this.actor),
                fetchSelectionDocument,
                extractDocumentSlug,
            }),
            resolveDeityDocument: () => this.#resolveDraftOrActorDocument("deity"),
            buildContextNote: (paneStep, context) => buildContextNote(paneStep, context, {
                resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
            }),
            resolveStepStatus: async () => stepEvaluation.status,
            stepEvaluation,
            getOptionsForStep,
            getPickerInfoState,
            buildPreview: (...args) => this._buildRenderPreview(...args),
            matchesSearch,
            onPickerRenderSession,
        });
        if (selectionPane) {
            return selectionPane;
        }
        throw new Error(`Unsupported pane step kind: ${step.kind}`);
    }
    async #chooseOption(stepId, rawValue) {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        const plan = await this.#buildPlan(snapshot, draft);
        const invalidation = this.#selectionInvalidationService(draft);
        const step = plan.steps.find((entry) => entry.id === stepId);
        if (!step) {
            return;
        }
        const result = await chooseSelectionOption(this.#selectionCommandState(draft), step, rawValue, {
            resolveSelection: async (value, selectionStep) => {
                const optionContext = await buildOptionContext({
                    draft,
                    steps: plan.steps,
                    excludedFeatSlotId: selectionStep.slotId,
                    maximumFeatLevel: selectionStep.level,
                    skillRanks: snapshot.skillRanks,
                    resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                    listActorItems: () => listActorItems(this.actor),
                    fetchSelectionDocument,
                    extractDocumentSlug,
                });
                return resolveSelection(value, withRestrictedSpellRarityAccess(selectionStep, getSpellRarityCeilingSetting(), this.#spellRarityAccessGranted(draft, selectionStep)), optionContext);
            },
            hasDuplicateDraftSelection: (selection) => hasDuplicateDraftSelection(draft, selection),
            resolveSelectionTraits: (selection) => resolveSelectionTraits(selection, {
                fetchSelectionDocument,
                extractDocumentSlug,
            }),
            resolveSelectionSlug: (selection) => resolveSelectionSlug(selection, {
                fetchSelectionDocument,
                extractDocumentSlug,
            }),
            resolveSelectionClassHasSpellcasting: (selection) => resolveSelectionClassHasSpellcasting(selection, {
                fetchSelectionDocument,
                extractDocumentSlug,
            }),
            invalidateSelection: invalidation.invalidateSelection,
            invalidateSelectionsByPrefix: invalidation.invalidateSelectionsByPrefix,
            invalidateSingletonChoicesBySource: invalidation.invalidateSingletonChoicesBySource,
            invalidateGrantSelectionsBySource: invalidation.invalidateGrantSelectionsBySource,
            invalidateGrantSelectionsByDependency: invalidation.invalidateGrantSelectionsByDependency,
            invalidateFlagChoicesBySource: invalidation.invalidateFlagChoicesBySource,
            invalidateFlagChoicesByDependency: invalidation.invalidateFlagChoicesByDependency,
            invalidateCampaignFeatSelectionsByFeatType: invalidation.invalidateCampaignFeatSelectionsByFeatType,
            invalidateClassChoicesByDependency: invalidation.invalidateClassChoicesByDependency,
            invalidateBranchSelectionsByDependency: invalidation.invalidateBranchSelectionsByDependency,
            invalidateSpellChoicesByDependency: invalidation.invalidateSpellChoicesByDependency,
            invalidateOrphanedSpellChoices: invalidation.invalidateOrphanedSpellChoices,
            resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
            resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
            resetClassBoostDraft: () => this.#resetClassBoostDraft(),
        });
        await this.#finalizeSelectionCommand(result);
    }
    #rememberInteractiveState(searchInput) {
        const root = this.element;
        if (!(root instanceof HTMLElement)) {
            return;
        }
        for (const scrollable of root.querySelectorAll("[data-wayfinder-scroll-id]")) {
            const scrollId = scrollable.dataset.wayfinderScrollId;
            if (!scrollId) {
                continue;
            }
            this.#scrollById.set(scrollId, scrollable.scrollTop);
        }
        const activeSearch = searchInput ?? root.querySelector("[data-wayfinder-search]:focus");
        const stepId = activeSearch?.dataset.stepId;
        if (!activeSearch || !stepId) {
            this.#pendingSearchFocus = null;
            return;
        }
        this.#pendingSearchFocus = {
            stepId,
            cursor: activeSearch.selectionStart ?? activeSearch.value.length,
        };
    }
    #selectSkillIncrease(stepId, slug) {
        this.#statusNote = null;
        if (toggleSkillIncreaseSelection(this.#draftAdjustmentState(), stepId, slug)) {
            this.render(false);
        }
    }
    async #selectTrainingRule(stepId, key, slug) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        if (setTrainingRuleSelection(this.#draftAdjustmentState(), stepId, key, slug)) {
            const invalidated = await this.#invalidateGrantChoicesForTrainingRule(step, key);
            if (invalidated.length > 0) {
                this.#statusNote = "Skill training changed. Wayfinder marked dependent granted choices for review.";
            }
            this.render(false);
        }
    }
    async #invalidateGrantChoicesForTrainingRule(step, key) {
        if (step?.kind !== "skill-training") {
            return [];
        }
        const choice = step.training.choiceRules.find((entry) => entry.key === key);
        const sourceUuid = choice?.persistence?.sourceUuid;
        if (!sourceUuid) {
            return [];
        }
        const invalidation = this.#selectionInvalidationService();
        return invalidation.invalidateGrantSelectionsBySourceUuid(sourceUuid);
    }
    async #setTrainingLore(stepId, key, value) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        if (setTrainingLoreSelection(this.#draftAdjustmentState(), step ?? null, key, value)) {
            this.render(false);
        }
    }
    async #selectSingletonChoice(stepId, value) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        const result = await selectSingletonChoiceValue(this.#selectionCommandState(), step ?? null, value, {
            buildPlan: () => this.#buildPlan(),
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #toggleLanguageChoice(stepId, value) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        const result = await toggleLanguageChoiceValue(this.#selectionCommandState(), step ?? null, value);
        await this.#finalizeSelectionCommand(result);
    }
    async #selectClassChoice(stepId, value) {
        this.#statusNote = null;
        const invalidation = this.#selectionInvalidationService();
        const step = await this.#findPlanStepBySlotId(stepId);
        const result = await selectClassChoiceValue(this.#selectionCommandState(), step ?? null, value, {
            invalidateSelectionsByPrefix: invalidation.invalidateSelectionsByPrefix,
            invalidateBranchSelectionsByDependency: invalidation.invalidateBranchSelectionsByDependency,
            invalidateClassChoicesBySourceChoice: invalidation.invalidateClassChoicesBySourceChoice,
            invalidateGrantSelectionsBySource: invalidation.invalidateGrantSelectionsBySource,
            invalidateFlagChoicesBySource: invalidation.invalidateFlagChoicesBySource,
            invalidateSpellChoicesByDependency: invalidation.invalidateSpellChoicesByDependency,
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #selectClassArchetype(stepId, value) {
        this.#statusNote = null;
        const invalidation = this.#selectionInvalidationService();
        const step = await this.#findPlanStepBySlotId(stepId);
        const result = await selectClassArchetypeValue(this.#selectionCommandState(), step ?? null, value, {
            invalidateSelection: invalidation.invalidateSelection,
            invalidateSelectionsByPrefix: invalidation.invalidateSelectionsByPrefix,
            invalidateGrantSelectionsBySource: invalidation.invalidateGrantSelectionsBySource,
            invalidateFlagChoicesBySource: invalidation.invalidateFlagChoicesBySource,
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #toggleSpellChoice(stepId, rawValue) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const snapshot = inspectActor(this.actor);
        const plan = await this.#buildPlan(snapshot, draft);
        const step = plan.steps.find((entry) => entry.id === stepId) ?? null;
        const result = await toggleSpellChoiceSelection(this.#selectionCommandState(draft), step ?? null, rawValue, {
            resolveSelection: async (value, selectionStep) => {
                const optionContext = await buildOptionContext({
                    draft,
                    steps: plan.steps,
                    excludedFeatSlotId: selectionStep.slotId,
                    maximumFeatLevel: selectionStep.level,
                    skillRanks: snapshot.skillRanks,
                    resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                    listActorItems: () => listActorItems(this.actor),
                    fetchSelectionDocument,
                    extractDocumentSlug,
                });
                return resolveSelection(value, withRestrictedSpellRarityAccess(selectionStep, getSpellRarityCeilingSetting(), this.#spellRarityAccessGranted(draft, selectionStep)), optionContext);
            },
            selectionExistsOnActor: (selection, selectionStep) => {
                if (selectionStep.kind !== "spell-choice") {
                    return false;
                }
                const entry = findSpellcastingEntryForChoice(this.actor, selectionStep.spellChoice);
                const entryId = typeof entry?.id === "string" ? entry.id : null;
                const normalizedUuid = selection.uuid.trim().toLowerCase();
                return (!!entryId &&
                    listActorItems(this.actor).some((item) => item?.type === "spell" &&
                        sourceIdOf(item)?.trim().toLowerCase() === normalizedUuid &&
                        actorItemLocationId(item) === entryId));
            },
            destinationKeyForSlotId: (slotId) => {
                const spellStep = plan.steps.find((candidate) => candidate.slotId === slotId);
                return spellStep?.kind === "spell-choice" ? spellStep.spellChoice.destination.key : null;
            },
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #toggleSpellRarityAccess(stepId) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const plan = await this.#buildPlan(inspectActor(this.actor), draft);
        const step = plan.steps.find((entry) => entry.id === stepId);
        if (!step) {
            return;
        }
        const worldRarityCeiling = getSpellRarityCeilingSetting();
        const evaluation = evaluateSpellRarityAttestation(this.actor.id, draft, step, worldRarityCeiling);
        if (evaluation.granted) {
            if ((draft.spellChoices[step.slotId] ?? []).length > 0) {
                ui.notifications.warn("Clear the spells chosen for this step before removing its player attestation.");
                return;
            }
            delete draft.spellRarityAttestations[step.slotId];
            this.#statusNote = "The restricted-spell player attestation was removed.";
            this.render(false);
            return;
        }
        if (!canGrantRestrictedSpellRarityAccess(step, worldRarityCeiling)) {
            if (evaluation.attestation) {
                delete draft.spellRarityAttestations[step.slotId];
                this.#statusNote = "The obsolete restricted-spell player attestation was removed.";
                this.render(false);
            }
            return;
        }
        const input = await requestSpellRarityAttestationInput();
        if (!input)
            return;
        const currentUser = game.user;
        if (!currentUser?.id || !currentUser.name) {
            ui.notifications.warn("Wayfinder could not identify the user recording this player attestation.");
            return;
        }
        try {
            draft.spellRarityAttestations[step.slotId] = createSpellRarityAttestation({
                actorId: this.actor.id,
                step,
                targetLevel: draft.targetLevel,
                worldRarityCeiling,
                claimedBasis: input.claimedBasis,
                reason: input.reason,
                authorUserId: currentUser.id,
                authorName: currentUser.name,
                attestedAt: new Date().toISOString(),
            });
        }
        catch (error) {
            console.error("PF2E Wayfinder could not record the restricted-spell player attestation", error);
            ui.notifications.warn("Enter a reason before recording this player attestation.");
            return;
        }
        this.#statusNote =
            "Restricted spell rarities are available through a player attestation. This is not GM authorization.";
        this.render(false);
    }
    async #removeSpellRarityAttestation(stepId) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const step = (await this.#buildPlan(inspectActor(this.actor), draft)).steps.find((entry) => entry.id === stepId);
        if (!step)
            return;
        const attestation = draft.spellRarityAttestations[step.slotId];
        if (!attestation)
            return;
        const evaluation = evaluateSpellRarityAttestation(this.actor.id, draft, step, getSpellRarityCeilingSetting());
        if (evaluation.granted && (draft.spellChoices[step.slotId] ?? []).length > 0) {
            ui.notifications.warn("Clear the spells chosen for this step before removing its player attestation.");
            return;
        }
        delete draft.spellRarityAttestations[step.slotId];
        this.#statusNote = "The restricted-spell player attestation was removed.";
        this.render(false);
    }
    async #toggleTrainingSkill(stepId, slug) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        if (toggleTrainingSkillSelection(this.#draftAdjustmentState(), step ?? null, slug)) {
            await this.#syncDependentChoicesAfterBuildChange();
            this.render(false);
        }
    }
    async #toggleAncestryMode() {
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        this.#statusNote = null;
        if (toggleAncestryMode(this.#draftAdjustmentState(), effectiveBuildState.ancestry?.mode ?? null)) {
            await this.#syncDependentChoicesAfterBuildChange();
            this.render(false);
        }
    }
    async #toggleVoluntaryEnabled() {
        this.#statusNote = null;
        if (toggleVoluntaryEnabled(this.#draftAdjustmentState())) {
            await this.#syncDependentChoicesAfterBuildChange();
            this.render(false);
        }
    }
    async #toggleVoluntaryLegacy() {
        this.#statusNote = null;
        if (toggleVoluntaryLegacy(this.#draftAdjustmentState())) {
            await this.#syncDependentChoicesAfterBuildChange();
            this.render(false);
        }
    }
    async #toggleBoostChoice(stepId, section, attribute) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        if (!step) {
            return;
        }
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        if (toggleBoostChoice(this.#draftAdjustmentState(), effectiveBuildState, step, section, attribute)) {
            await this.#syncDependentChoicesAfterBuildChange();
            this.render(false);
        }
    }
    async #toggleVoluntaryChoice(stepId, attribute, choiceKind) {
        this.#statusNote = null;
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        if (toggleVoluntaryChoice(this.#draftAdjustmentState(), effectiveBuildState.ancestry, stepId, attribute, choiceKind)) {
            await this.#syncDependentChoicesAfterBuildChange();
            this.render(false);
        }
    }
    async #syncDependentChoicesAfterBuildChange() {
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        const plan = await this.#buildPlan();
        const baseSkillRanks = inspectActor(this.actor).skillRanks;
        const projectedSkillRanksByStepId = Object.fromEntries(await Promise.all(plan.steps.flatMap((step) => step.kind === "skill-training"
            ? [
                projectSkillRanks(this.#requireDraft(), step.slotId, {
                    baseSkillRanks,
                    resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                    localize: (value) => game.i18n.localize(value),
                }).then((ranks) => [step.slotId, ranks]),
            ]
            : [])));
        const trainingChanged = syncSkillTrainingSelections(this.#draftAdjustmentState(), plan.steps, projectedSkillRanksByStepId);
        const languageChanged = syncLanguageChoiceSelections(this.#draftAdjustmentState(), effectiveBuildState, plan.steps);
        const spellAttestationsChanged = (await this.#selectionInvalidationService().invalidateOrphanedSpellChoices()).length > 0;
        if (spellAttestationsChanged) {
            this.#statusNote =
                "Wayfinder removed a player spell attestation whose subject is no longer in the projected build.";
        }
        else if (trainingChanged && languageChanged) {
            this.#statusNote =
                "Wayfinder marked drafted skill training and language choices for review after the projected build changed.";
        }
        else if (trainingChanged) {
            this.#statusNote =
                "Wayfinder marked drafted skill training choices for review after the projected build changed.";
        }
        else if (languageChanged) {
            this.#statusNote = "Wayfinder marked drafted language choices for review after the projected build changed.";
        }
    }
    #abilityLabel(attribute) {
        const abilities = getPf2eConfig()?.abilities;
        return game.i18n.localize(abilities?.[attribute] ?? attribute.toUpperCase());
    }
    async #resolveDraftOrActorDocument(itemType, draft = this.#requireDraft()) {
        return getEffectiveSingletonDocument(this.actor, draft, itemType);
    }
    async #resolveDraftOrActorArcaneSchoolDocument(draft = this.#requireDraft()) {
        const draftSelection = Object.values(draft.branchSelections).find((selection) => isWizardArcaneSchoolSlotId(selection.slotId));
        if (draftSelection) {
            return fetchSelectionDocument(draftSelection);
        }
        return listActorItems(this.actor).find(isWizardArcaneSchoolItem) ?? null;
    }
    async #moveStep(delta) {
        const snapshot = inspectActor(this.actor);
        const plan = await this.#buildPlan(snapshot, this.#requireDraft());
        const currentIndex = plan.steps.findIndex((step) => step.id === this.#activeStepId);
        if (currentIndex === -1) {
            return;
        }
        const nextIndex = Math.min(plan.steps.length - 1, Math.max(0, currentIndex + delta));
        this.#activeStepId = plan.steps[nextIndex]?.id ?? this.#activeStepId;
        this.render(false);
    }
    #selectionInvalidationService(draft = this.#requireDraft()) {
        return createSelectionInvalidationService({
            draft,
            previewValueByStepId: this.#previewValueByStepId,
            pickerFiltersByStepId: this.#pickerFiltersByStepId,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
            scrollById: this.#scrollById,
        }, {
            buildPlan: () => this.#buildPlan(inspectActor(this.actor), draft),
            resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
            resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
            resetClassBoostDraft: () => this.#resetClassBoostDraft(),
        });
    }
    #resetAncestryBoostDraft() {
        const draft = this.#requireDraft().boosts.ancestry;
        const hadValues = draft.mode !== "standard" ||
            draft.modeTouched ||
            Object.values(draft.selectedBoosts).some((value) => value !== null) ||
            draft.alternateBoosts.length > 0 ||
            draft.voluntary.touched ||
            draft.voluntary.enabled ||
            draft.voluntary.flaws.length > 0 ||
            !!draft.voluntary.boost;
        draft.modeTouched = false;
        draft.mode = "standard";
        draft.selectedBoosts = {};
        draft.alternateBoosts = [];
        draft.voluntary = {
            touched: false,
            enabled: false,
            legacy: false,
            boost: null,
            flaws: [],
        };
        return hadValues;
    }
    #resetBackgroundBoostDraft() {
        const draft = this.#requireDraft().boosts.background;
        const hadValues = Object.values(draft.selectedBoosts).some((value) => value !== null);
        draft.selectedBoosts = {};
        return hadValues;
    }
    #resetClassBoostDraft() {
        const draft = this.#requireDraft().boosts.class;
        const hadValues = !!draft.keyAbility;
        draft.keyAbility = null;
        return hadValues;
    }
    #selectionCommandState(draft = this.#requireDraft()) {
        return {
            draft,
            previewValueByStepId: this.#previewValueByStepId,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
        };
    }
    #draftAdjustmentState(draft = this.#requireDraft()) {
        return {
            draft,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
        };
    }
    async #finalizeSelectionCommand(result) {
        if (result.kind === "warning") {
            if (result.warning === "duplicate-selection") {
                ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.DuplicateSelections"));
            }
            else if (result.warning === "language-choice-full") {
                ui.notifications.warn("This language step is already full. Remove one before adding another.");
            }
            return;
        }
        if (result.kind !== "changed") {
            return;
        }
        this.#statusNote = result.statusNote;
        if (result.shouldAdvance) {
            await this.#moveStep(1);
            return;
        }
        if (result.shouldRender) {
            this.render(false);
        }
    }
    async #evaluateStep(step, effectiveBuildState, draft = this.#requireDraft(), steps, skillRanks) {
        const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
        const evaluation = await evaluateWayfinderStep(step, draft, this.#recentlyInvalidatedStepIds, buildState);
        if (step.kind !== "spell-choice") {
            return evaluation;
        }
        const attestation = evaluateSpellRarityAttestation(this.actor.id, draft, step, getSpellRarityCeilingSetting());
        if (attestation.state === "unresolved" || attestation.state === "stale") {
            const message = attestation.state === "unresolved"
                ? `${step.title}: review the migrated restricted-spell player attestation before Apply.`
                : `${step.title}: re-record or remove the stale restricted-spell player attestation.`;
            return {
                state: "invalid",
                complete: false,
                status: "Review player attestation",
                issue: {
                    code: "access-attestation",
                    stepId: step.id,
                    slotId: step.slotId,
                    title: step.title,
                    message,
                },
            };
        }
        if (evaluation.complete && steps && skillRanks) {
            for (const selection of draft.spellChoices[step.slotId] ?? []) {
                if (!(await this.#validateSelectionEligibility(selection, step, draft, steps, skillRanks))) {
                    return {
                        state: "invalid",
                        complete: false,
                        status: "Selected spell no longer eligible",
                        issue: {
                            code: "selection-ineligible",
                            stepId: step.id,
                            slotId: step.slotId,
                            title: step.title,
                            message: `${step.title}: a selected spell no longer satisfies the current source, rank, or access policy.`,
                        },
                    };
                }
            }
        }
        return evaluation;
    }
    #isTrainingStepComplete(step) {
        return step.kind === "skill-training" && isTrainingStepCompleteFromDraft(step, this.#requireDraft());
    }
    async #adjustTargetLevel(delta) {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        if (!adjustDraftTargetLevel(draft, snapshot.level, delta)) {
            return;
        }
        if ((await this.#selectionInvalidationService(draft).invalidateOrphanedSpellChoices()).length > 0) {
            this.#statusNote = "Wayfinder removed player spell attestations whose steps are no longer in the plan.";
        }
        this.render(false);
    }
    async #saveDraft() {
        if (this.#reconcileLiveRecoveryDraft() === "conflict")
            return;
        try {
            this.#draftPersistence.schedule(this.#requireDraft(), { force: true });
            if (this.#draftPersistence.state.phase === "error") {
                await this.#draftPersistence.retry();
            }
            else {
                await this.#draftPersistence.flush();
            }
            ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.SavedDraft"));
        }
        catch (error) {
            console.error("PF2E Wayfinder failed to save draft", error);
            ui.notifications.error("Wayfinder could not save this draft. Review the save status and retry.");
        }
        this.render(false);
    }
    async #retryDraftSave() {
        if (this.#reconcileLiveRecoveryDraft() === "conflict")
            return;
        try {
            this.#draftPersistence.schedule(this.#requireDraft());
            await this.#draftPersistence.retry();
            ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.SavedDraft"));
        }
        catch (error) {
            console.error("PF2E Wayfinder failed to retry draft save", error);
            ui.notifications.error("Wayfinder still could not save this draft.");
        }
        this.render(false);
    }
    #draftDidChange() {
        const draft = this.#requireDraft();
        draft.applyAttemptStepIds = [];
        draft.applyCompletedStepIds = [];
        draft.applyRecoveryActorUpdate = {};
        draft.applySpellRarityAttestations = [];
        this.#draftPersistence.schedule(draft);
        this.#patchDraftSaveStatus(this.#draftPersistence.state);
    }
    #allowDraftMutation() {
        if (this.#reconcileLiveRecoveryDraft() === "conflict") {
            return false;
        }
        if (!hasApplyRecoveryState(this.#requireDraft())) {
            return true;
        }
        this.#statusNote =
            "Wayfinder partially applied this draft. Retry Apply without changing choices; manual actor recovery is required if the retry cannot finish.";
        ui.notifications.warn("Wayfinder locked this recovery draft so partial actor changes cannot diverge from it.");
        this.render(false);
        return false;
    }
    #reconcileLiveRecoveryDraft(defaultTargetLevel = inspectActor(this.actor).level) {
        const liveDraft = normalizeDraft(this.actor.getFlag(MODULE_ID, "draft"), defaultTargetLevel);
        if (!hasApplyRecoveryState(liveDraft) || JSON.stringify(liveDraft) === JSON.stringify(this.#draft)) {
            return "none";
        }
        const decision = decideExternalDraftRefresh({
            localDraft: this.#draft,
            liveDraft,
            currentLevel: defaultTargetLevel,
            saveState: this.#draftPersistence.state,
            lifecycleBusy: this.#semanticCommands.busy,
        });
        if (decision === "acknowledge") {
            this.#draftWriteGuard.acceptCurrent(liveDraft);
            return decision;
        }
        if (decision === "adopt") {
            this.#draft = liveDraft;
            this.#draftWriteGuard.acceptCurrent(liveDraft);
            this.#draftPersistence.reset(liveDraft);
            return decision;
        }
        this.#statusNote =
            "This actor has a partial-Apply recovery draft from another client. Wayfinder kept your local work unsaved; reopen before continuing.";
        return "conflict";
    }
    #queueExternalDraftRefresh() {
        const queued = this.#semanticCommands.enqueue(async () => this.#refreshPersistedDraft());
        if (queued !== null) {
            void queued.catch((error) => {
                console.error("PF2E Wayfinder failed to reconcile an externally updated draft", error);
            });
        }
    }
    async #refreshPersistedDraft() {
        let deferredOnce = false;
        while (true) {
            const currentLevel = inspectActor(this.actor).level;
            const liveDraft = readPersistedDraftSnapshot(this.actor, currentLevel);
            const decision = decideExternalDraftRefresh({
                localDraft: this.#draft,
                liveDraft,
                currentLevel,
                saveState: this.#draftPersistence.state,
                lifecycleBusy: this.#semanticCommands.barrierActive,
            });
            if (decision === "defer" && !deferredOnce) {
                deferredOnce = true;
                await this.#draftPersistence.flush().catch(() => undefined);
                continue;
            }
            if (decision === "acknowledge") {
                this.#draftWriteGuard.acceptCurrent(liveDraft);
                return;
            }
            if (decision === "conflict" || decision === "defer") {
                this.#statusNote =
                    "This actor's draft changed in another client while local work was pending. Reopen Wayfinder before saving over it.";
                ui.notifications.warn("Wayfinder detected a newer draft in another client and kept your local work unsaved.");
                this.render(false);
                return;
            }
            const nextDraft = liveDraft ?? createEmptyDraft(currentLevel);
            this.#draft = nextDraft;
            this.#draftWriteGuard.acceptCurrent(liveDraft);
            this.#draftPersistence.reset(nextDraft);
            this.#activeStepId = null;
            this.#searchByStepId.clear();
            this.#pickerFiltersByStepId.clear();
            this.#openPickerFilterMenu = null;
            this.#previewValueByStepId.clear();
            this.#recentlyInvalidatedStepIds.clear();
            this.#statusNote = "Draft refreshed from another client.";
            this.render(false);
            return;
        }
    }
    #onDraftSaveStateChange(state) {
        if (state.phase === "error" && this.#lastDraftSavePhase !== "error") {
            ui.notifications.error("Wayfinder could not autosave the latest draft. Retry from the footer.");
        }
        this.#lastDraftSavePhase = state.phase;
        this.#patchDraftSaveStatus(state);
    }
    #patchDraftSaveStatus(state) {
        const root = this.element;
        if (!(root instanceof HTMLElement)) {
            return;
        }
        const view = buildDraftSaveView(state);
        const status = root.querySelector("[data-wayfinder-save-status]");
        if (status) {
            status.hidden = !view.visible;
            status.dataset.phase = view.phase;
            status.classList.remove("idle", "saving", "saved", "error");
            status.classList.add(view.phase);
            status.setAttribute("role", view.error ? "alert" : "status");
            status.setAttribute("aria-live", view.live);
            const message = status.querySelector("[data-wayfinder-save-message]");
            if (message) {
                message.textContent = game.i18n.localize(view.labelKey);
            }
            const icon = status.querySelector("i");
            if (icon) {
                icon.className = view.saving
                    ? "fa-solid fa-spinner fa-spin"
                    : view.saved
                        ? "fa-solid fa-circle-check"
                        : "fa-solid fa-triangle-exclamation";
            }
            const retry = status.querySelector("[data-wayfinder-action='retry-draft-save']");
            if (retry) {
                retry.hidden = !view.retryable;
            }
        }
        const apply = root.querySelector("[data-wayfinder-action='apply-draft']");
        if (apply) {
            apply.disabled =
                apply.dataset.wayfinderReadinessReady !== "true" || view.error || this.#semanticCommands.barrierActive;
        }
    }
    async #applyDraft() {
        this.#statusNote = null;
        if (this.#reconcileLiveRecoveryDraft() === "conflict") {
            ui.notifications.warn("Wayfinder kept your local work because another client has a recovery draft.");
            return false;
        }
        const snapshot = inspectActor(this.actor);
        const draft = cloneData(this.#requireDraft());
        const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
        const plan = await this.#buildPlan(snapshot, draft);
        const steps = cloneData(plan.steps);
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        const spellRarityCeiling = getSpellRarityCeilingSetting();
        const recovering = hasApplyRecoveryState(draft);
        const computedSpellRarityAttestations = buildAppliedSpellRarityAttestations(this.actor.id, draft, recovering ? undefined : steps, recovering ? undefined : spellRarityCeiling);
        const appliedSpellRarityAttestations = recovering
            ? cloneData(draft.applySpellRarityAttestations)
            : computedSpellRarityAttestations;
        const spellRarityBlockers = (recovering
            ? listSpellRarityRecoveryProblems(this.actor.id, draft)
            : listSpellRarityAttestationProblems(this.actor.id, draft, steps, spellRarityCeiling)).map((problem) => ({
            code: "access-attestation",
            stepId: problem.stepId,
            slotId: problem.slotId,
            title: problem.title,
            message: problem.message,
        }));
        const applyCandidate = { value: null };
        let finalizedDespiteApplyError = false;
        let result;
        try {
            result = await applyDraftLifecycle({
                actorName: this.actor.name,
                currentLevel: snapshot.level,
                draft,
                existingCompletedStepIds: state.completedStepIds,
                existingCharacterHistory: state.existingCharacterHistory,
                appliedSpellRarityAttestations,
                steps,
                evaluateStep: (step) => this.#evaluateStep(step, effectiveBuildState, draft, steps, snapshot.skillRanks),
                additionalBlockers: spellRarityBlockers,
                reviewLines: buildSpellRarityAttestationReviewLines(appliedSpellRarityAttestations),
                confirmApply: confirmWayfinderApply,
                beforeApply: (applyAttemptDraft) => persistApplyCandidateIfCurrent({
                    actorSnapshot: snapshot,
                    stateSnapshot: state,
                    draftSnapshot: draft,
                    stepSnapshots: steps,
                    currentDraft: () => this.#draft,
                    inspectCurrentActor: () => inspectActor(this.actor),
                    readCurrentState: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
                    buildCurrentSteps: async (currentSnapshot, currentDraft) => (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
                }, async () => {
                    assertCanUseWayfinder(this.actor);
                    this.#draftPersistence.schedule(applyAttemptDraft, { force: true });
                    await this.#draftPersistence.pauseAndFlush();
                    applyCandidate.value = cloneData(applyAttemptDraft);
                }),
                applyDraftToActor: (buildFinalActorUpdate) => applyDraftToActor(this.actor, draft, steps, {
                    beforePrepare: async () => {
                        this.#assertPersistedApplyCandidateCurrent();
                        await assertApplyCandidateCurrent({
                            actorSnapshot: snapshot,
                            stateSnapshot: state,
                            draftSnapshot: draft,
                            stepSnapshots: steps,
                            currentDraft: () => this.#draft,
                            inspectCurrentActor: () => inspectActor(this.actor),
                            readCurrentState: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
                            buildCurrentSteps: async (currentSnapshot, currentDraft) => (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
                        });
                    },
                    resolveFinalActorUpdate: (evidence) => buildFinalActorUpdate(normalizeState(this.actor.getFlag(MODULE_ID, "state")), evidence),
                    beforeFinalActorUpdate: () => this.#assertPersistedApplyCandidateCurrent(),
                    persistFinalActorUpdate: (actorUpdate) => updateActorWithPersistedDraftPrecondition(this.actor, actorUpdate, capturePersistedDraftPrecondition(this.actor, inspectActor(this.actor).level, this.#draftWriteGuard)),
                    validateActorAuthority: canUseWayfinder,
                    spellRarityCeiling,
                    validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
                    validateSelectionEligibility: (selection, step) => this.#validateSelectionEligibility(selection, step, draft, steps, snapshot.skillRanks, this.#applySpellRarityCeiling(draft, step, recovering)),
                    prepareClassGrantPlan: (actor, currentDraft, currentSteps) => prepareCurrentClassGrantPlan(actor, currentDraft, currentSteps),
                }).then(() => undefined),
                finalizeRecoveredDraft: (recoveryActorUpdate, buildFinalActorUpdate) => finalizeRecoveredDraftOnActor(this.actor, {
                    beforeFinalize: async () => {
                        this.#assertPersistedApplyCandidateCurrent();
                        await assertApplyCandidateCurrent({
                            actorSnapshot: snapshot,
                            stateSnapshot: state,
                            draftSnapshot: draft,
                            stepSnapshots: steps,
                            currentDraft: () => this.#draft,
                            inspectCurrentActor: () => inspectActor(this.actor),
                            readCurrentState: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
                            buildCurrentSteps: async (currentSnapshot, currentDraft) => (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
                        });
                    },
                    resolveFinalActorUpdate: (evidence) => buildFinalActorUpdate(normalizeState(this.actor.getFlag(MODULE_ID, "state")), evidence),
                    beforeFinalActorUpdate: () => this.#assertPersistedApplyCandidateCurrent(),
                    persistFinalActorUpdate: (actorUpdate) => updateActorWithPersistedDraftPrecondition(this.actor, actorUpdate, capturePersistedDraftPrecondition(this.actor, inspectActor(this.actor).level, this.#draftWriteGuard)),
                    recoveryActorUpdate,
                    validateActorAuthority: canUseWayfinder,
                    classGrantRecovery: draft.acquisition
                        ? {
                            kind: "required",
                            preparePlan: (actor) => prepareCurrentClassGrantPlan(actor, draft, steps),
                            verifyAcquisitionRecovery: () => {
                                throw new Error("Starting-equipment recovery is unavailable until the prepared acquisition executor is active.");
                            },
                        }
                        : { kind: "none" },
                }).then(() => undefined),
            });
        }
        catch (error) {
            this.#draftPersistence.resume();
            const persistedApplyCandidate = applyCandidate.value;
            let draftWriteConflict = error instanceof WayfinderDraftWriteConflictError
                ? error
                : error instanceof DraftApplyPhaseError && error.cause instanceof WayfinderDraftWriteConflictError
                    ? error.cause
                    : null;
            if (!draftWriteConflict && persistedApplyCandidate) {
                const currentSnapshot = inspectActor(this.actor);
                const currentDraft = readPersistedDraftSnapshot(this.actor, currentSnapshot.level);
                try {
                    assertFailedApplyRecoveryCandidateCurrent(this.#draftWriteGuard, currentDraft, error instanceof DraftApplyPhaseError ? error.phase : null);
                }
                catch (candidateConflict) {
                    if (candidateConflict instanceof WayfinderDraftWriteConflictError) {
                        draftWriteConflict = candidateConflict;
                    }
                    else {
                        throw candidateConflict;
                    }
                }
            }
            if (draftWriteConflict) {
                const currentSnapshot = inspectActor(this.actor);
                const currentDraft = readPersistedDraftSnapshot(this.actor, currentSnapshot.level);
                this.#draftWriteGuard.acceptCurrent(currentDraft);
                this.#draft = currentDraft ? cloneData(currentDraft) : createEmptyDraft(currentSnapshot.level);
                this.#statusNote = draftWriteConflict.message;
                ui.notifications.warn(draftWriteConflict.message);
                this.render(false);
                return false;
            }
            if (persistedApplyCandidate) {
                const currentSnapshot = inspectActor(this.actor);
                const currentState = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
                const confirmedAfterBoundary = error instanceof DraftApplyPhaseError &&
                    (error.checkpoint?.checkpointId === "write:final-actor-update:after" ||
                        error.checkpoint?.checkpointId === "phase:finalize-actor:after");
                const completedAcquisitionManifest = currentState.completedAcquisitionManifest;
                const intendedAcquisitionManifest = error instanceof DraftApplyPhaseError && error.intendedFinalActorUpdate
                    ? normalizeState(error.intendedFinalActorUpdate[STATE_FLAG]).completedAcquisitionManifest
                    : null;
                const acquisitionConverged = persistedApplyCandidate.acquisition
                    ? !currentState.completedAcquisitionManifestCorrupt &&
                        completedAcquisitionManifest !== null &&
                        intendedAcquisitionManifest !== null &&
                        manifestsDescribeSameOutcome(completedAcquisitionManifest, intendedAcquisitionManifest)
                    : true;
                finalizedDespiteApplyError =
                    confirmedAfterBoundary &&
                        this.actor.getFlag(MODULE_ID, "draft") == null &&
                        currentSnapshot.level === persistedApplyCandidate.targetLevel &&
                        currentState.lastTargetLevel === persistedApplyCandidate.targetLevel &&
                        acquisitionConverged &&
                        [...persistedApplyCandidate.applyCompletedStepIds, ...persistedApplyCandidate.applyAttemptStepIds].every((stepId) => currentState.completedStepIds.includes(stepId));
                if (finalizedDespiteApplyError) {
                    this.#draft = createEmptyDraft(currentSnapshot.level);
                }
                else {
                    this.#draftWriteGuard.acceptCurrent(readPersistedDraftSnapshot(this.actor, currentSnapshot.level));
                    let recoverableDraft = cloneData(persistedApplyCandidate);
                    if (error instanceof DraftApplyPhaseError) {
                        recoverableDraft.applyRecoveryActorUpdate = cloneData(error.recoveryActorUpdate);
                        if (recoverableDraft.acquisition) {
                            recoverableDraft.acquisition = recordClassGrantReconciliations(recoverableDraft.acquisition, error.completedClassGrantReconciliations);
                        }
                    }
                    if (currentSnapshot.level < recoverableDraft.targetLevel) {
                        try {
                            const pendingPlan = await this.#buildPlan(currentSnapshot, recoverableDraft);
                            recoverableDraft = buildApplyAttemptDraft(recoverableDraft, pendingPlan.steps);
                        }
                        catch (recoveryError) {
                            console.error("PF2E Wayfinder could not classify the partial Apply draft", recoveryError);
                        }
                    }
                    this.#draft = recoverableDraft;
                    try {
                        this.#draftPersistence.schedule(recoverableDraft, { force: true });
                        await this.#draftPersistence.flush();
                    }
                    catch (persistenceError) {
                        console.error("PF2E Wayfinder could not restore the failed Apply draft", persistenceError);
                    }
                }
            }
            if (error instanceof WayfinderDraftNotReadyError) {
                const blocker = error.blockers[0];
                this.#activeStepId = blocker?.stepId ?? this.#activeStepId;
                this.#pendingStepFocusId = blocker?.stepId ?? null;
                this.#statusNote = blocker?.message ?? error.message;
                ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.MissingSelections"));
                this.render(false);
                return false;
            }
            if (error instanceof WayfinderActorAuthorityError) {
                this.#statusNote = error.message;
                ui.notifications.warn(error.message);
                this.render(false);
                return false;
            }
            if (error instanceof WayfinderApplyDriftError) {
                this.#statusNote = error.message;
                ui.notifications.warn(error.message);
                this.render(false);
                return false;
            }
            console.error("PF2E Wayfinder failed to apply draft", error);
            this.#statusNote = finalizedDespiteApplyError
                ? "The actor reached the reviewed final state, but Foundry reported a late Apply error. Review the actor before closing."
                : hasApplyRecoveryState(this.#requireDraft())
                    ? "Wayfinder partially applied this draft. Retry Apply without changing choices; details are in the console."
                    : "Wayfinder could not apply this draft. The draft was kept for review; details are in the console.";
            ui.notifications.error(game.i18n.localize("wayfinder-pf2e.Notifications.ApplyFailed"));
            this.render(false);
            return false;
        }
        if (result.kind === "warning") {
            this.#draftPersistence.resume();
            this.#statusNote = result.blockers[0]?.message ?? null;
            const notificationKey = result.warning === "no-pending-steps"
                ? "wayfinder-pf2e.Notifications.NoPendingSteps"
                : "wayfinder-pf2e.Notifications.MissingSelections";
            ui.notifications.warn(game.i18n.localize(notificationKey));
            this.render(false);
            return false;
        }
        if (result.kind === "cancelled") {
            this.#draftPersistence.resume();
            ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.ApplyCancelled"));
            return false;
        }
        this.#draftPersistence.completeTerminalOperation();
        this.#semanticCommands.completeTerminalOperation();
        this.#draft = result.nextDraft;
        this.#recentlyInvalidatedStepIds.clear();
        ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.Applied"));
        return true;
    }
    #assertPersistedApplyCandidateCurrent() {
        const currentSnapshot = inspectActor(this.actor);
        this.#draftWriteGuard.assertCurrent(readPersistedDraftSnapshot(this.actor, currentSnapshot.level));
    }
    #spellRarityAccessGranted(draft, step) {
        return evaluateSpellRarityAttestation(this.actor.id, draft, step, getSpellRarityCeilingSetting()).granted;
    }
    #applySpellRarityCeiling(draft, step, recovering) {
        if (recovering && step.kind === "spell-choice" && draft.spellRarityAttestations[step.slotId]) {
            const frozen = frozenSpellRarityAttestationForStep(this.actor.id, draft, step);
            if (frozen)
                return frozen.subject.worldRarityCeiling;
            return getSpellRarityCeilingSetting() === "unique" ? "unique" : null;
        }
        return getSpellRarityCeilingSetting();
    }
    async #validateSelectionEligibility(selection, step, draft, steps, skillRanks, spellRarityCeiling = getSpellRarityCeilingSetting()) {
        if (spellRarityCeiling === null)
            return false;
        const normalizedUuid = selection.uuid.trim().toLowerCase();
        const alreadyApplied = listActorItems(this.actor).some((item) => {
            if (sourceIdOf(item)?.trim().toLowerCase() !== normalizedUuid)
                return false;
            const wayfinderFlags = item?.flags?.[MODULE_ID];
            if (wayfinderFlags?.slotId === selection.slotId)
                return true;
            if (step.kind !== "spell-choice")
                return false;
            const entry = findSpellcastingEntryForChoice(this.actor, step.spellChoice);
            return typeof entry?.id === "string" && actorItemLocationId(item) === entry.id;
        });
        if (alreadyApplied)
            return true;
        if ((step.kind !== "pick-item" && step.kind !== "class-branch" && step.kind !== "spell-choice") || !step.filters) {
            return true;
        }
        const optionContext = await buildOptionContext({
            draft,
            steps,
            excludedFeatSlotId: step.slotId,
            maximumFeatLevel: step.level,
            skillRanks,
            resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType, draft),
            listActorItems: () => listActorItems(this.actor),
            fetchSelectionDocument,
            extractDocumentSlug,
        });
        const optionStep = step.kind === "spell-choice"
            ? withRestrictedSpellRarityAccess(step, spellRarityCeiling, evaluateSpellRarityAttestation(this.actor.id, draft, step, spellRarityCeiling).granted)
            : step;
        const options = await getOptionsForStep(optionStep, optionContext);
        return options.some((option) => option.uuid.trim().toLowerCase() === normalizedUuid);
    }
    async #importExistingHistory() {
        const history = await buildExistingCharacterHistory(this.actor, {
            gradualBoostsEnabled: inspectActor(this.actor).gradualBoostsEnabled,
        });
        await enqueueActorOperation(this.actor, async () => {
            const currentLevel = inspectActor(this.actor).level;
            assertDraftSideEffectAllowed(this.actor, currentLevel, this.#draftWriteGuard);
            const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
            await updateActorWithPersistedDraftPrecondition(this.actor, { [STATE_FLAG]: withExistingCharacterHistory(state, history) }, captureDraftSideEffectPrecondition(this.actor, currentLevel, this.#draftWriteGuard));
        });
        const mappedCount = history.entries.filter((entry) => entry.status === "mapped").length;
        const reviewCount = history.entries.length - mappedCount;
        this.#statusNote = `Mapped ${mappedCount} observable choices; ${reviewCount} historical decisions need review.`;
        ui.notifications.info("Wayfinder mapped the source-backed history it could verify from this actor.");
        this.render(false);
    }
    async #clearDraft() {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        let result;
        try {
            result = await clearDraftLifecycle({
                currentLevel: snapshot.level,
                draft,
                confirmClear: confirmWayfinderClear,
                clearPersistedDraft: () => this.#draftPersistence.discardAndRun(() => enqueueActorOperation(this.actor, async () => {
                    await clearDraftWithWriteGuard(this.actor, snapshot.level, this.#draftWriteGuard);
                })),
            });
        }
        catch (error) {
            console.error("PF2E Wayfinder failed to clear draft", error);
            this.#statusNote =
                "Wayfinder could not clear this draft. Nothing was removed; retry the save or Clear Draft again.";
            ui.notifications.error("Wayfinder could not clear the draft. Your choices are still open for review.");
            this.render(false);
            return;
        }
        if (result.kind === "cancelled") {
            return;
        }
        this.#draft = result.nextDraft;
        this.#draftPersistence.reset(result.nextDraft);
        this.#searchByStepId.clear();
        this.#pickerFiltersByStepId.clear();
        this.#openPickerFilterMenu = null;
        this.#previewValueByStepId.clear();
        this.#recentlyInvalidatedStepIds.clear();
        ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.ClearedDraft"));
        this.render(false);
    }
    #togglePickerFilterMenu(stepId, filterKind) {
        this.#statusNote = null;
        if (this.#openPickerFilterMenu?.stepId === stepId && this.#openPickerFilterMenu.filterKind === filterKind) {
            this.#openPickerFilterMenu = null;
        }
        else {
            this.#openPickerFilterMenu = { stepId, filterKind };
        }
        this.render(false);
    }
    #togglePickerFilter(stepId, filterKind, value) {
        this.#statusNote = null;
        const next = togglePickerFilterValue(this.#pickerFiltersByStepId.get(stepId) ?? emptyPickerFilterState(), filterKind, value);
        if (next.rank.length === 0 && next.rarity.length === 0 && next.source.length === 0) {
            this.#pickerFiltersByStepId.delete(stepId);
        }
        else {
            this.#pickerFiltersByStepId.set(stepId, next);
        }
        this.render(false);
    }
    #clearPickerFilters(stepId) {
        this.#statusNote = null;
        if (this.#pickerFiltersByStepId.delete(stepId)) {
            this.render(false);
        }
    }
}
_a = WayfinderApp;
function isPickerSearchRender(options) {
    return pickerSearchRequest(options) !== null;
}
function pickerSearchRequest(options) {
    if (options.parts?.length !== PICKER_SEARCH_PARTS.length ||
        !PICKER_SEARCH_PARTS.every((partId, index) => options.parts?.[index] === partId)) {
        return null;
    }
    const candidate = options.wayfinderPickerRequest;
    if (!candidate ||
        !Number.isInteger(candidate.viewRevision) ||
        !Number.isInteger(candidate.sourceRevision) ||
        typeof candidate.stepId !== "string" ||
        typeof candidate.query !== "string") {
        return null;
    }
    return candidate;
}
function numericRenderOption(value) {
    return Number.isInteger(value) ? Number(value) : -1;
}
function hasPickerPartTargets(root, stepId) {
    const countTargets = [...root.querySelectorAll(`[data-application-part="${PICKER_COUNT_PART}"]`)];
    const resultTargets = [...root.querySelectorAll(`[data-application-part="${PICKER_RESULTS_PART}"]`)];
    return (countTargets.length === 1 &&
        resultTargets.length === 1 &&
        countTargets[0]?.dataset.stepId === stepId &&
        resultTargets[0]?.dataset.stepId === stepId);
}
function actorItemLocationId(item) {
    const rawLocation = item?.system?.location;
    if (typeof rawLocation === "string") {
        return rawLocation;
    }
    if (rawLocation && typeof rawLocation === "object" && "value" in rawLocation) {
        return typeof rawLocation.value === "string" ? rawLocation.value : null;
    }
    return null;
}
function draftFingerprint(draft) {
    return draft ? JSON.stringify(draft) : "null";
}
function getPf2eConfig() {
    return globalThis.CONFIG?.PF2E ?? null;
}
async function confirmWayfinderApply(message) {
    const foundryApi = foundry;
    const dialog = foundryApi.applications?.api?.DialogV2;
    if (dialog) {
        const escapeHTML = foundryApi.utils?.escapeHTML ?? fallbackEscapeHtml;
        const result = await dialog.confirm({
            window: { title: "wayfinder-pf2e.App.ApplyConfirmTitle" },
            content: `<p style="white-space: pre-line">${escapeHTML(message)}</p>`,
            modal: true,
            yes: { label: "wayfinder-pf2e.App.ApplyConfirmYes", icon: "fa-solid fa-check" },
            no: { label: "wayfinder-pf2e.App.ApplyConfirmNo", icon: "fa-solid fa-xmark", default: true },
        });
        return result === true;
    }
    return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : true;
}
async function requestSpellRarityAttestationInput() {
    const foundryApi = foundry;
    const dialog = foundryApi.applications?.api?.DialogV2;
    if (dialog?.input) {
        const result = await dialog.input({
            window: { title: "Record restricted-spell player attestation" },
            modal: true,
            content: `
        <fieldset class="wayfinder-attestation-input">
          <legend>Claimed basis</legend>
          <label><input type="radio" name="claimedBasis" value="rules-access" checked> Character or rules Access</label>
          <label><input type="radio" name="claimedBasis" value="reported-gm-permission"> GM permission reported by player</label>
        </fieldset>
        <label class="wayfinder-attestation-reason">
          Reason
          <textarea name="reason" required maxlength="500" aria-describedby="wayfinder-attestation-disclaimer"></textarea>
        </label>
        <p id="wayfinder-attestation-disclaimer">This is a player claim, not verified GM authorization.</p>
      `,
            ok: { label: "Record player attestation", icon: "fa-solid fa-pen" },
        });
        if (!isRecord(result))
            return null;
        return normalizeSpellRarityAttestationInput(result.claimedBasis, result.reason);
    }
    if (typeof globalThis.prompt !== "function")
        return null;
    const reason = globalThis.prompt("Describe the character or rules Access supporting restricted spell selection. This records a player claim, not GM authorization.");
    return normalizeSpellRarityAttestationInput("rules-access", reason);
}
function normalizeSpellRarityAttestationInput(claimedBasis, reason) {
    if ((claimedBasis !== "rules-access" && claimedBasis !== "reported-gm-permission") ||
        typeof reason !== "string" ||
        reason.trim().length === 0 ||
        reason.trim().length > 500) {
        ui.notifications.warn("Enter a reason before recording this player attestation.");
        return null;
    }
    return { claimedBasis, reason: reason.trim() };
}
async function confirmWayfinderClear(message) {
    const foundryApi = foundry;
    const dialog = foundryApi.applications?.api?.DialogV2;
    if (dialog) {
        const escapeHTML = foundryApi.utils?.escapeHTML ?? fallbackEscapeHtml;
        const result = await dialog.confirm({
            window: { title: "Clear Wayfinder Draft" },
            content: `<p>${escapeHTML(message)}</p>`,
            modal: true,
            yes: { label: "Clear Draft", icon: "fa-solid fa-trash" },
            no: { label: "Cancel", icon: "fa-solid fa-xmark", default: true },
        });
        return result === true;
    }
    return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false;
}
function fallbackEscapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isWizardArcaneSchoolItem(item) {
    const candidate = item;
    if (candidate?.type !== "feat" || candidate.system?.category !== "classfeature") {
        return false;
    }
    const otherTags = Array.isArray(candidate.system?.traits?.otherTags) ? candidate.system.traits.otherTags : [];
    return otherTags.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "wizard-arcane-school");
}
//# sourceMappingURL=app-shell.js.map