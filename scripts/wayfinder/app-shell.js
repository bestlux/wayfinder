import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor } from "../actor-updater.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { MODULE_ID, MODULE_TITLE } from "../constants.js";
import { createEmptyDraft, normalizeDraft } from "../draft-service.js";
import { fetchSelectionDocument, getOptionsForStep, getPickerInfoState, resolveSelection } from "../pack-service.js";
import { canUseWayfinder } from "../permissions.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import { bindWayfinderInteractions, parseWayfinderAction } from "./actions.js";
import { buildSelectionPane } from "./application/build-selection-pane-service.js";
import { buildSkillPane } from "./application/build-skill-pane-service.js";
import { adjustDraftTargetLevel, setManualStepComplete, setTrainingRuleSelection, toggleAncestryMode, toggleBoostChoice, toggleSkillIncreaseSelection, toggleTrainingSkillSelection, toggleVoluntaryChoice, toggleVoluntaryEnabled, toggleVoluntaryLegacy, } from "./application/draft-adjustment-service.js";
import { applyDraftLifecycle, buildSaveDraftUpdate, createClearedDraftResult, } from "./application/draft-lifecycle-service.js";
import { buildContextNote, buildOptionContext, resolveSelectionSlug, resolveSelectionTraits, } from "./application/option-context-service.js";
import { chooseSelectionOption, selectClassChoiceValue, toggleSpellChoiceSelection, } from "./application/selection-command-service.js";
import { createSelectionInvalidationService } from "./application/selection-invalidation-service.js";
import { buildWayfinderContext } from "./application/wayfinder-context-service.js";
import { buildWayfinderAppPlan, findPlanStepBySlotId } from "./application/wayfinder-plan-builder-service.js";
import { hasDuplicateDraftSelection } from "./draft-decisions.js";
import { buildBoostPane } from "./panes/boost-pane.js";
import { buildPreview, matchesSearch } from "./panes/pick-pane.js";
import { getWayfinderStepStatus, isWayfinderStepComplete, resolveActiveStep } from "./plan-service.js";
import { isWizardArcaneSchoolSlotId } from "./slot-ids.js";
export class WayfinderApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
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
            title: "PF2E-WAYFINDER.App.Title",
            contentClasses: ["standard-form"],
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
    #previewValueByStepId = new Map();
    #scrollById = new Map();
    #pendingSearchFocus = null;
    #recentlyInvalidatedStepIds = new Set();
    #statusNote = null;
    static open(actor) {
        if (!canUseWayfinder(actor)) {
            ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.OwnerOnly"));
            return;
        }
        const existing = Object.values(actor.apps).find((app) => app instanceof WayfinderApp);
        if (existing) {
            existing.render(true);
            return;
        }
        new WayfinderApp({ actor }).render(true);
    }
    constructor(options) {
        super({
            uniqueId: `${MODULE_ID}-${options.actor.id}`,
        });
        this.actor = options.actor;
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
        const plan = await this.#buildPlan(snapshot, draft);
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        const activeStep = await this.#resolveActiveStep(plan.steps, effectiveBuildState);
        const activePane = activeStep ? await this.#buildActivePane(activeStep, effectiveBuildState) : null;
        const [effectiveAncestry, effectiveHeritage, effectiveBackground, effectiveClass, effectiveDeity] = await Promise.all([
            getEffectiveSingletonDocument(this.actor, draft, "ancestry"),
            getEffectiveSingletonDocument(this.actor, draft, "heritage"),
            getEffectiveSingletonDocument(this.actor, draft, "background"),
            getEffectiveSingletonDocument(this.actor, draft, "class"),
            getEffectiveSingletonDocument(this.actor, draft, "deity"),
        ]);
        return buildWayfinderContext({
            actorName: this.actor.name,
            currentLevel: snapshot.level,
            targetLevel: plan.targetLevel,
            steps: plan.steps,
            activeStep,
            activePane,
            statusNote: this.#statusNote,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
            summaryDocuments: {
                ancestry: effectiveAncestry,
                heritage: effectiveHeritage,
                background: effectiveBackground,
                classDocument: effectiveClass,
                deity: effectiveDeity,
            },
            isStepComplete: (step) => this.#isStepComplete(step, effectiveBuildState),
            getStepStatus: (step) => this.#stepStatus(step, effectiveBuildState),
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
        }, this.#scrollById, this.#pendingSearchFocus).pendingSearchFocus;
    }
    _tearDown(options) {
        super._tearDown(options);
        delete this.actor.apps[this.id];
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
        switch (action.type) {
            case "select-step":
                this.#activeStepId = action.stepId;
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
                this.#selectTrainingRule(action.stepId, action.flag, action.slug);
                break;
            case "toggle-training-skill":
                await this.#toggleTrainingSkill(action.stepId, action.slug);
                break;
            case "select-class-choice":
                await this.#selectClassChoice(action.stepId, action.value);
                break;
            case "toggle-spell-choice":
                await this.#toggleSpellChoice(action.stepId, action.value);
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
                await this.#saveDraft();
                break;
            case "apply-draft":
                await this.#applyDraft();
                break;
            case "clear-draft":
                await this.#clearDraft();
                break;
        }
    };
    #onSearchInput = (event) => {
        const input = event.currentTarget;
        const stepId = input?.dataset.stepId;
        if (!stepId) {
            return;
        }
        this.#rememberInteractiveState(input);
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
    #onManualChange = (event) => {
        const input = event.currentTarget;
        const stepId = input?.dataset.stepId;
        if (!stepId) {
            return;
        }
        this.#statusNote = null;
        if (setManualStepComplete(this.#draftAdjustmentState(), stepId, input.checked)) {
            this.render(false);
        }
    };
    #ensureDraft(defaultTargetLevel) {
        if (!this.#draft) {
            this.#draft = normalizeDraft(this.actor.getFlag(MODULE_ID, "draft"), defaultTargetLevel);
        }
        return this.#draft;
    }
    #requireDraft() {
        if (!this.#draft) {
            this.#draft = createEmptyDraft(1);
        }
        return this.#draft;
    }
    async #buildPlan(snapshot = inspectActor(this.actor), draft = this.#requireDraft()) {
        return buildWayfinderAppPlan({
            actor: this.actor,
            snapshot,
            draft,
            resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
            resolveArcaneSchoolDocument: () => this.#resolveDraftOrActorArcaneSchoolDocument(),
            localize: (value) => game.i18n.localize(value),
        });
    }
    async #findPlanStepBySlotId(slotId, snapshot = inspectActor(this.actor), draft = this.#requireDraft()) {
        return findPlanStepBySlotId({
            actor: this.actor,
            snapshot,
            draft,
            resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
            resolveArcaneSchoolDocument: () => this.#resolveDraftOrActorArcaneSchoolDocument(),
            localize: (value) => game.i18n.localize(value),
        }, slotId);
    }
    async #resolveActiveStep(steps, effectiveBuildState) {
        const resolved = await resolveActiveStep(steps, this.#activeStepId, (step) => this.#isStepComplete(step, effectiveBuildState));
        this.#activeStepId = resolved.activeStepId;
        return resolved.activeStep;
    }
    async #buildActivePane(step, effectiveBuildState) {
        if (step.kind === "manual") {
            const pane = {
                kind: "manual",
                isPickItem: false,
                isManual: true,
                isBoost: false,
                isSkillIncrease: false,
                isSkillTraining: false,
                isClassChoice: false,
                isSpellChoice: false,
                stepId: step.id,
                slotId: step.slotId,
                level: step.level,
                modeLabel: "Manual",
                title: step.title,
                description: step.description,
                completed: this.#requireDraft().manual[step.slotId] === true,
                selectedLabel: await this.#stepStatus(step, effectiveBuildState),
            };
            return pane;
        }
        if (step.kind === "boost") {
            return buildBoostPane(step, effectiveBuildState, {
                isStepComplete: (paneStep, buildState) => this.#isStepComplete(paneStep, buildState),
                stepStatus: (paneStep, buildState) => this.#stepStatus(paneStep, buildState),
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
            previewValueByStepId: this.#previewValueByStepId,
            resolveOptionContext: () => buildOptionContext({
                draft: this.#requireDraft(),
                resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                listActorItems: () => listActorItems(this.actor),
                fetchSelectionDocument,
                extractDocumentSlug,
            }),
            resolveDeityDocument: () => this.#resolveDraftOrActorDocument("deity"),
            buildContextNote: (paneStep, context) => buildContextNote(paneStep, context, {
                resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
            }),
            resolveStepStatus: (paneStep, buildState) => this.#stepStatus(paneStep, buildState),
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
                    resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                    listActorItems: () => listActorItems(this.actor),
                    fetchSelectionDocument,
                    extractDocumentSlug,
                });
                return resolveSelection(value, selectionStep, optionContext);
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
            invalidateSelection: invalidation.invalidateSelection,
            invalidateSelectionsByPrefix: invalidation.invalidateSelectionsByPrefix,
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
    #selectTrainingRule(stepId, flag, slug) {
        this.#statusNote = null;
        if (setTrainingRuleSelection(this.#draftAdjustmentState(), stepId, flag, slug)) {
            this.render(false);
        }
    }
    async #selectClassChoice(stepId, value) {
        this.#statusNote = null;
        const invalidation = this.#selectionInvalidationService();
        const step = await this.#findPlanStepBySlotId(stepId);
        const result = await selectClassChoiceValue(this.#selectionCommandState(), step ?? null, value, {
            invalidateBranchSelectionsByDependency: invalidation.invalidateBranchSelectionsByDependency,
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #toggleSpellChoice(stepId, rawValue) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const step = await this.#findPlanStepBySlotId(stepId, inspectActor(this.actor), draft);
        const result = await toggleSpellChoiceSelection(this.#selectionCommandState(draft), step ?? null, rawValue, {
            resolveSelection: async (value, selectionStep) => {
                const optionContext = await buildOptionContext({
                    draft,
                    resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                    listActorItems: () => listActorItems(this.actor),
                    fetchSelectionDocument,
                    extractDocumentSlug,
                });
                return resolveSelection(value, selectionStep, optionContext);
            },
            selectionExistsOnActor: (selection) => {
                return listActorItems(this.actor).some((item) => item?.type === "spell" && sourceIdOf(item) === selection.uuid);
            },
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #toggleTrainingSkill(stepId, slug) {
        this.#statusNote = null;
        const step = await this.#findPlanStepBySlotId(stepId);
        if (toggleTrainingSkillSelection(this.#draftAdjustmentState(), step ?? null, slug)) {
            this.render(false);
        }
    }
    async #toggleAncestryMode() {
        const ancestry = (await getEffectiveBuildState(this.actor, this.#requireDraft())).ancestry;
        this.#statusNote = null;
        if (toggleAncestryMode(this.#draftAdjustmentState(), ancestry?.mode ?? null)) {
            this.render(false);
        }
    }
    async #toggleVoluntaryEnabled() {
        this.#statusNote = null;
        if (toggleVoluntaryEnabled(this.#draftAdjustmentState())) {
            this.render(false);
        }
    }
    async #toggleVoluntaryLegacy() {
        this.#statusNote = null;
        if (toggleVoluntaryLegacy(this.#draftAdjustmentState())) {
            this.render(false);
        }
    }
    async #toggleBoostChoice(stepId, section, attribute) {
        this.#statusNote = null;
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        if (toggleBoostChoice(this.#draftAdjustmentState(), effectiveBuildState, stepId, section, attribute)) {
            this.render(false);
        }
    }
    async #toggleVoluntaryChoice(stepId, attribute, choiceKind) {
        this.#statusNote = null;
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        if (toggleVoluntaryChoice(this.#draftAdjustmentState(), effectiveBuildState.ancestry, stepId, attribute, choiceKind)) {
            this.render(false);
        }
    }
    #abilityLabel(attribute) {
        const abilities = getPf2eConfig()?.abilities;
        return game.i18n.localize(abilities?.[attribute] ?? attribute.toUpperCase());
    }
    async #resolveDraftOrActorDocument(itemType) {
        return getEffectiveSingletonDocument(this.actor, this.#requireDraft(), itemType);
    }
    async #resolveDraftOrActorArcaneSchoolDocument() {
        const draftSelection = Object.values(this.#requireDraft().branchSelections).find((selection) => isWizardArcaneSchoolSlotId(selection.slotId));
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
                ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.DuplicateSelections"));
            }
            else if (result.warning === "spell-choice-full") {
                ui.notifications.warn("This spell choice is already full. Remove one before adding another.");
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
    async #isStepComplete(step, effectiveBuildState) {
        const draft = this.#requireDraft();
        const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
        return isWayfinderStepComplete(step, draft, buildState, {
            isTrainingStepComplete: (trainingStep) => this.#isTrainingStepComplete(trainingStep),
        });
    }
    async #stepStatus(step, effectiveBuildState) {
        const draft = this.#requireDraft();
        const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
        return getWayfinderStepStatus(step, draft, this.#recentlyInvalidatedStepIds, buildState, {
            isTrainingStepComplete: (trainingStep) => this.#isTrainingStepComplete(trainingStep),
        });
    }
    #isTrainingStepComplete(step) {
        const training = step.training;
        if (!training) {
            return false;
        }
        const draftTraining = this.#requireDraft().skillTrainings[step.slotId];
        if (!draftTraining) {
            return false;
        }
        const choiceComplete = training.choiceRules.every((rule) => {
            const selection = draftTraining.ruleChoices[rule.flag];
            return typeof selection === "string" && selection.length > 0;
        });
        const additionalComplete = draftTraining.additional.length === training.additionalCount;
        return choiceComplete && additionalComplete;
    }
    async #adjustTargetLevel(delta) {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        if (!adjustDraftTargetLevel(draft, snapshot.level, delta)) {
            return;
        }
        await this.#saveDraft(false);
        this.render(false);
    }
    async #saveDraft(notify = true) {
        await this.actor.update(buildSaveDraftUpdate(this.#requireDraft()));
        if (notify) {
            ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.SavedDraft"));
        }
    }
    async #applyDraft() {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        const plan = await this.#buildPlan(snapshot, draft);
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        const result = await applyDraftLifecycle({
            actorName: this.actor.name,
            currentLevel: snapshot.level,
            draft,
            steps: plan.steps,
            isStepComplete: (step) => this.#isStepComplete(step, effectiveBuildState),
            confirmApply: typeof globalThis.confirm === "function" ? (message) => globalThis.confirm(message) : undefined,
            applyDraftToActor: () => applyDraftToActor(this.actor, draft, plan.steps),
            updateActor: async (update) => {
                await this.actor.update(update);
            },
        });
        if (result.kind === "warning") {
            ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.MissingSelections"));
            return;
        }
        if (result.kind === "cancelled") {
            ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.ApplyCancelled"));
            return;
        }
        this.#draft = result.nextDraft;
        this.#recentlyInvalidatedStepIds.clear();
        ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.Applied"));
        this.render(false);
    }
    async #clearDraft() {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const cleared = createClearedDraftResult(snapshot.level);
        this.#draft = cleared.nextDraft;
        this.#searchByStepId.clear();
        this.#previewValueByStepId.clear();
        this.#recentlyInvalidatedStepIds.clear();
        await this.actor.update(cleared.actorUpdate);
        ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.ClearedDraft"));
        this.render(false);
    }
}
function getPf2eConfig() {
    return globalThis.CONFIG?.PF2E ?? null;
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