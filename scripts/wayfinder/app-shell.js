var _a;
import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor } from "../actor-updater.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { DRAFT_FLAG, MODULE_ID, MODULE_TITLE, STATE_FLAG } from "../constants.js";
import { createEmptyDraft, normalizeDraft, normalizeState } from "../draft-service.js";
import { FeedbackSupportApp } from "../feedback-support-app.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { getOptionsForStep, resolveSelection } from "../pack/options.js";
import { getPickerInfoState } from "../pack/picker-state.js";
import { canUseWayfinder } from "../permissions.js";
import { getSpellRarityCeilingSetting } from "../settings.js";
import { enqueueActorOperation } from "../shared/actor-operation-queue.js";
import { cloneData } from "../shared/cloning.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import { findSpellcastingEntryForChoice } from "../shared/spellcasting.js";
import { bindWayfinderInteractions, isDraftMutationAction, parseWayfinderAction, } from "./actions.js";
import { assertApplyCandidateCurrent, persistApplyCandidateIfCurrent, WayfinderApplyDriftError, } from "./application/apply-candidate-service.js";
import { buildSelectionPane } from "./application/build-selection-pane-service.js";
import { buildSkillPane } from "./application/build-skill-pane-service.js";
import { adjustDraftTargetLevel, setManualStepComplete, setTrainingLoreSelection, setTrainingRuleSelection, syncLanguageChoiceSelections, syncSkillTrainingSelections, toggleAncestryMode, toggleBoostChoice, toggleSkillIncreaseSelection, toggleTrainingSkillSelection, toggleVoluntaryChoice, toggleVoluntaryEnabled, toggleVoluntaryLegacy, } from "./application/draft-adjustment-service.js";
import { applyDraftLifecycle, buildSaveDraftUpdate, clearDraftLifecycle, } from "./application/draft-lifecycle-service.js";
import { DraftPersistenceCoordinator } from "./application/draft-persistence-service.js";
import { buildExistingCharacterHistory, withExistingCharacterHistory, } from "./application/existing-character-history-service.js";
import { buildContextNote, buildOptionContext, resolveSelectionClassHasSpellcasting, resolveSelectionSlug, resolveSelectionTraits, } from "./application/option-context-service.js";
import { chooseSelectionOption, selectClassArchetypeValue, selectClassChoiceValue, selectSingletonChoiceValue, toggleLanguageChoiceValue, toggleSpellChoiceSelection, } from "./application/selection-command-service.js";
import { createSelectionInvalidationService } from "./application/selection-invalidation-service.js";
import { SemanticCommandQueue } from "./application/semantic-command-queue.js";
import { buildDraftSaveView, buildWayfinderContext, } from "./application/wayfinder-context-service.js";
import { buildWayfinderAppPlan, findPlanStepBySlotId } from "./application/wayfinder-plan-builder-service.js";
import { evaluateWayfinderDraftReadiness, isTrainingStepCompleteFromDraft, WayfinderDraftNotReadyError, } from "./domain/step-evaluation.js";
import { hasDuplicateDraftSelection } from "./draft-decisions.js";
import { buildBoostPane } from "./panes/boost-pane.js";
import { buildPreview, matchesSearch } from "./panes/pick-pane.js";
import { emptyPickerFilterState, togglePickerFilterValue } from "./panes/picker-filters.js";
import { evaluateWayfinderStep, resolveActiveStep } from "./plan-service.js";
import { isWizardArcaneSchoolSlotId } from "./slot-ids.js";
import { canGrantRestrictedSpellRarityAccess, withRestrictedSpellRarityAccess } from "./spell-choice/rarity-access.js";
import { buildHistoricalSpellChoicePlanningNote } from "./spell-choice-service.js";
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
    #semanticCommands = new SemanticCommandQueue();
    #closePromise = null;
    #lastDraftSavePhase = "idle";
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
    constructor(options) {
        super({
            uniqueId: `${MODULE_ID}-${options.actor.id}`,
        });
        this.actor = options.actor;
        this.#draftPersistence = new DraftPersistenceCoordinator({
            saveDraft: (draft) => enqueueActorOperation(this.actor, async () => {
                await this.actor.update(buildSaveDraftUpdate(draft));
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
    async _prepareContext() {
        const snapshot = inspectActor(this.actor);
        const draft = this.#ensureDraft(snapshot.level);
        const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
        const plan = await this.#buildPlan(snapshot, draft);
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        const readiness = await evaluateWayfinderDraftReadiness(plan.steps, (step) => this.#evaluateStep(step, effectiveBuildState, draft));
        const evaluationsByStepId = new Map(plan.steps.map((step, index) => [step.id, readiness.evaluations[index]]));
        const activeStep = await this.#resolveActiveStep(plan.steps, evaluationsByStepId);
        const activeEvaluation = activeStep ? evaluationsByStepId.get(activeStep.id) : null;
        const activePane = activeStep && activeEvaluation
            ? await this.#buildActivePane(activeStep, activeEvaluation, effectiveBuildState, plan.steps)
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
        return buildWayfinderContext({
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
            draftSaveState: this.#draftPersistence.state,
            lifecycleBusy: this.#semanticCommands.barrierActive,
        });
    }
    async _onRender(context, options) {
        await super._onRender(context, options);
        const root = this.element;
        if (!(root instanceof HTMLElement)) {
            return;
        }
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
            case "clear-option":
                this.#statusNote = null;
                this.#selectionInvalidationService().clearSelection(action.stepId);
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
        this.#rememberInteractiveState(input);
        this.#openPickerFilterMenu = null;
        this.#searchByStepId.set(stepId, input.value);
        this.render(false);
    };
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
        return this.#draft;
    }
    #requireDraft() {
        if (!this.#draft) {
            this.#draft = createEmptyDraft(1);
            this.#draftPersistence.initialize(this.#draft);
        }
        return this.#draft;
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
    async #buildActivePane(step, stepEvaluation, effectiveBuildState, planSteps) {
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
            buildPreview,
            matchesSearch,
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
                return resolveSelection(value, withRestrictedSpellRarityAccess(selectionStep, getSpellRarityCeilingSetting(), draft.spellRarityAccess[selectionStep.slotId] === true), optionContext);
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
                return resolveSelection(value, withRestrictedSpellRarityAccess(selectionStep, getSpellRarityCeilingSetting(), draft.spellRarityAccess[selectionStep.slotId] === true), optionContext);
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
        if (!step || !canGrantRestrictedSpellRarityAccess(step, getSpellRarityCeilingSetting())) {
            return;
        }
        if ((draft.spellChoices[step.slotId] ?? []).length > 0) {
            ui.notifications.warn("Clear the spells chosen for this step before changing rarity access.");
            return;
        }
        if (draft.spellRarityAccess[step.slotId] === true) {
            delete draft.spellRarityAccess[step.slotId];
            this.#statusNote = "Restricted spell rarities are hidden for this step.";
        }
        else {
            draft.spellRarityAccess[step.slotId] = true;
            this.#statusNote =
                "Restricted spell rarities are available for this step. Choose only options granted by the rules or approved by the GM.";
        }
        this.render(false);
    }
    async #toggleTrainingSkill(stepId, slug) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        if (toggleTrainingSkillSelection(this.#draftAdjustmentState(), step ?? null, slug)) {
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
        const trainingChanged = syncSkillTrainingSelections(this.#draftAdjustmentState(), plan.steps);
        const languageChanged = syncLanguageChoiceSelections(this.#draftAdjustmentState(), effectiveBuildState, plan.steps);
        if (trainingChanged && languageChanged) {
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
    async #evaluateStep(step, effectiveBuildState, draft = this.#requireDraft()) {
        const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
        return evaluateWayfinderStep(step, draft, this.#recentlyInvalidatedStepIds, buildState);
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
        this.render(false);
    }
    async #saveDraft() {
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
        this.#draftPersistence.schedule(this.#requireDraft());
        this.#patchDraftSaveStatus(this.#draftPersistence.state);
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
        const snapshot = inspectActor(this.actor);
        const draft = cloneData(this.#requireDraft());
        const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
        const plan = await this.#buildPlan(snapshot, draft);
        const steps = cloneData(plan.steps);
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        let result;
        try {
            result = await applyDraftLifecycle({
                actorName: this.actor.name,
                currentLevel: snapshot.level,
                draft,
                existingCompletedStepIds: state.completedStepIds,
                existingCharacterHistory: state.existingCharacterHistory,
                steps,
                evaluateStep: (step) => this.#evaluateStep(step, effectiveBuildState, draft),
                confirmApply: confirmWayfinderApply,
                beforeApply: () => persistApplyCandidateIfCurrent({
                    actorSnapshot: snapshot,
                    stateSnapshot: state,
                    draftSnapshot: draft,
                    stepSnapshots: steps,
                    currentDraft: () => this.#draft,
                    inspectCurrentActor: () => inspectActor(this.actor),
                    readCurrentState: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
                    buildCurrentSteps: async (currentSnapshot, currentDraft) => (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
                }, async () => {
                    this.#draftPersistence.schedule(draft, { force: true });
                    await this.#draftPersistence.pauseAndFlush();
                }),
                applyDraftToActor: (buildFinalActorUpdate) => applyDraftToActor(this.actor, draft, steps, {
                    beforePrepare: () => assertApplyCandidateCurrent({
                        actorSnapshot: snapshot,
                        stateSnapshot: state,
                        draftSnapshot: draft,
                        stepSnapshots: steps,
                        currentDraft: () => this.#draft,
                        inspectCurrentActor: () => inspectActor(this.actor),
                        readCurrentState: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
                        buildCurrentSteps: async (currentSnapshot, currentDraft) => (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
                    }),
                    resolveFinalActorUpdate: () => buildFinalActorUpdate(normalizeState(this.actor.getFlag(MODULE_ID, "state"))),
                    validateActorAuthority: canUseWayfinder,
                    validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
                    validateSelectionEligibility: (selection, step) => this.#validateSelectionEligibility(selection, step, draft, steps, snapshot.skillRanks),
                }).then(() => undefined),
            });
        }
        catch (error) {
            this.#draftPersistence.resume();
            if (error instanceof WayfinderDraftNotReadyError) {
                const blocker = error.blockers[0];
                this.#activeStepId = blocker?.stepId ?? this.#activeStepId;
                this.#pendingStepFocusId = blocker?.stepId ?? null;
                this.#statusNote = blocker?.message ?? error.message;
                ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.MissingSelections"));
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
            this.#statusNote =
                "Wayfinder could not apply this draft. The draft was kept for review; details are in the console.";
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
    async #validateSelectionEligibility(selection, step, draft, steps, skillRanks) {
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
            ? withRestrictedSpellRarityAccess(step, getSpellRarityCeilingSetting(), draft.spellRarityAccess[step.slotId] === true)
            : step;
        const options = await getOptionsForStep(optionStep, optionContext);
        return options.some((option) => option.uuid.trim().toLowerCase() === normalizedUuid);
    }
    async #importExistingHistory() {
        const history = await buildExistingCharacterHistory(this.actor, {
            gradualBoostsEnabled: inspectActor(this.actor).gradualBoostsEnabled,
        });
        await enqueueActorOperation(this.actor, async () => {
            const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
            await this.actor.update({
                [STATE_FLAG]: withExistingCharacterHistory(state, history),
            });
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
                    await this.actor.update({ [DRAFT_FLAG]: null });
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
            content: `<p>${escapeHTML(message)}</p>`,
            modal: true,
            yes: { label: "wayfinder-pf2e.App.ApplyConfirmYes", icon: "fa-solid fa-check" },
            no: { label: "wayfinder-pf2e.App.ApplyConfirmNo", icon: "fa-solid fa-xmark", default: true },
        });
        return result === true;
    }
    return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : true;
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
function isWizardArcaneSchoolItem(item) {
    const candidate = item;
    if (candidate?.type !== "feat" || candidate.system?.category !== "classfeature") {
        return false;
    }
    const otherTags = Array.isArray(candidate.system?.traits?.otherTags) ? candidate.system.traits.otherTags : [];
    return otherTags.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "wizard-arcane-school");
}
//# sourceMappingURL=app-shell.js.map