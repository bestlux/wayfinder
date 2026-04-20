import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor } from "../actor-updater.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { DRAFT_FLAG, MODULE_ID, MODULE_TITLE, STATE_FLAG } from "../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../draft-service.js";
import { fetchSelectionDocument, getOptionsForStep, getPickerInfoState, resolveSelection } from "../pack-service.js";
import { canUseWayfinder } from "../permissions.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import { bindWayfinderInteractions, parseWayfinderAction } from "./actions.js";
import { buildSelectionPane } from "./application/build-selection-pane-service.js";
import { buildSkillPane } from "./application/build-skill-pane-service.js";
import { buildContextNote, buildOptionContext, resolveSelectionSlug, resolveSelectionTraits, } from "./application/option-context-service.js";
import { chooseSelectionOption, selectClassChoiceValue, toggleSpellChoiceSelection, } from "./application/selection-command-service.js";
import { buildClassBranchSteps, buildClassChoiceSteps, buildClassFeatSteps, buildClassGrantedItemSteps, buildClassTrainingSteps, } from "./class-choice-service.js";
import { findDraftSelectionByType, hasDuplicateDraftSelection } from "./draft-decisions.js";
import { readExistingBranchSelection, readExistingClassChoiceSelection, readExistingGrantedSelection, } from "./existing-selection-service.js";
import { clearSelectionState, invalidateSelectionState, invalidateSelectionsByPrefix } from "./invalidation.js";
import { buildBoostPane, toggleSlotRecordChoice } from "./panes/boost-pane.js";
import { buildPreview, matchesSearch } from "./panes/pick-pane.js";
import { buildWayfinderPlan, getWayfinderStepStatus, isWayfinderStepComplete, modeLabel, resolveActiveStep, } from "./plan-service.js";
import { isWizardArcaneSchoolSlotId, SLOT_IDS, SLOT_PREFIXES } from "./slot-ids.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "./spell-choice-service.js";
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
        const existing = Object.values(actor.apps ?? {}).find((app) => app instanceof WayfinderApp);
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
        const activeStepIndex = activeStep ? plan.steps.findIndex((step) => step.id === activeStep.id) : -1;
        const [effectiveAncestry, effectiveHeritage, effectiveBackground, effectiveClass, effectiveDeity] = await Promise.all([
            getEffectiveSingletonDocument(this.actor, draft, "ancestry"),
            getEffectiveSingletonDocument(this.actor, draft, "heritage"),
            getEffectiveSingletonDocument(this.actor, draft, "background"),
            getEffectiveSingletonDocument(this.actor, draft, "class"),
            getEffectiveSingletonDocument(this.actor, draft, "deity"),
        ]);
        const summary = [
            {
                label: "Ancestry",
                value: effectiveAncestry?.name ?? "Missing",
                complete: !!effectiveAncestry,
            },
            {
                label: "Heritage",
                value: effectiveHeritage?.name ?? "Missing",
                complete: !!effectiveHeritage,
            },
            {
                label: "Background",
                value: effectiveBackground?.name ?? "Missing",
                complete: !!effectiveBackground,
            },
            {
                label: "Class",
                value: effectiveClass?.name ?? "Missing",
                complete: !!effectiveClass,
            },
        ];
        if (effectiveClass?.name === "Cleric" || effectiveDeity) {
            summary.push({
                label: "Deity",
                value: effectiveDeity?.name ?? "Missing",
                complete: !!effectiveDeity,
            });
        }
        const dossierLine = summary
            .filter((item) => item.complete)
            .map((item) => item.value)
            .filter(Boolean)
            .join(" • ") || "Creation path in progress";
        const stepStateRows = await Promise.all(plan.steps.map(async (step, index) => ({
            id: step.id,
            index: index + 1,
            level: step.level,
            title: step.title,
            active: step.id === activeStep?.id,
            complete: await this.#isStepComplete(step, effectiveBuildState),
            invalidated: this.#recentlyInvalidatedStepIds.has(step.slotId) &&
                !(await this.#isStepComplete(step, effectiveBuildState)),
            modeLabel: modeLabel(step.kind),
            status: await this.#stepStatus(step, effectiveBuildState),
            firstInLevel: index === 0 || plan.steps[index - 1].level !== step.level,
        })));
        return {
            actorName: this.actor.name,
            dossierLine,
            currentLevel: snapshot.level,
            targetLevel: plan.targetLevel,
            hasPendingSteps: plan.steps.length > 0,
            guidance: "Review one decision at a time, keep the draft coherent, and let earlier choices narrow what comes next.",
            summary,
            stepCount: plan.steps.length,
            completedCount: stepStateRows.filter((step) => step.complete).length,
            activeStepIndex: activeStepIndex + 1,
            statusNote: this.#statusNote,
            steps: stepStateRows,
            activePane,
            canGoPrevious: !!activeStep && plan.steps.findIndex((step) => step.id === activeStep.id) > 0,
            canGoNext: !!activeStep && plan.steps.findIndex((step) => step.id === activeStep.id) < plan.steps.length - 1,
        };
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
                this.#clearSelection(action.stepId);
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
        this.#requireDraft().manual[stepId] = input.checked;
        this.render(false);
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
        return buildWayfinderPlan(snapshot, draft, {
            buildClassFeatSteps: async (planSnapshot, _planDraft, targetLevel) => buildClassFeatSteps({
                effectiveClassDocument: await this.#resolveDraftOrActorDocument("class"),
                targetLevel,
                fulfilledCount: planSnapshot.featCounts.class + planSnapshot.featCounts.archetype,
            }),
            buildClassTrainingSteps: (_planSnapshot, _planDraft, targetLevel) => buildClassTrainingSteps({
                draftClassSelection: findDraftSelectionByType(this.#requireDraft(), "class"),
                targetLevel,
                fetchSelectionDocument,
                extractSlug: extractDocumentSlug,
                localize: (value) => game.i18n.localize(value),
            }),
            buildClassBranchSteps: async (_planSnapshot, planDraft, targetLevel) => buildClassBranchSteps({
                draft: planDraft,
                effectiveClassDocument: await this.#resolveDraftOrActorDocument("class"),
                targetLevel,
                fetchSelectionDocument,
                extractSlug: extractDocumentSlug,
                readExistingBranchSelection: (branch) => readExistingBranchSelection(this.actor, branch),
            }),
            buildClassGrantedItemSteps: async (_planSnapshot, planDraft, targetLevel) => buildClassGrantedItemSteps({
                draft: planDraft,
                effectiveClassDocument: await this.#resolveDraftOrActorDocument("class"),
                targetLevel,
                fetchSelectionDocument,
                extractSlug: extractDocumentSlug,
                readExistingGrantedSelection: (grant) => readExistingGrantedSelection(this.actor, grant),
            }),
            buildClassChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => buildClassChoiceSteps({
                draft: planDraft,
                effectiveClassDocument: await this.#resolveDraftOrActorDocument("class"),
                effectiveDeityDocument: await this.#resolveDraftOrActorDocument("deity"),
                targetLevel,
                fetchSelectionDocument,
                extractSlug: extractDocumentSlug,
                localize: (value) => game.i18n.localize(value),
                readExistingClassChoiceSelection: (choice) => readExistingClassChoiceSelection(this.actor, choice),
            }),
            buildSpellChoiceSteps: async (planSnapshot, planDraft, targetLevel) => buildSpellChoiceSteps({
                draft: planDraft,
                currentLevel: planSnapshot.level,
                effectiveClassDocument: await this.#resolveDraftOrActorDocument("class"),
                effectiveDeityDocument: await this.#resolveDraftOrActorDocument("deity"),
                effectiveSchoolDocument: await this.#resolveDraftOrActorArcaneSchoolDocument(),
                targetLevel,
                extractSlug: extractDocumentSlug,
                readExistingSpellChoiceSelections: (choice) => readExistingSpellChoiceSelections(this.actor, choice),
            }),
        });
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
            configSkills: globalThis.CONFIG?.PF2E
                ?.skills ?? null,
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
            invalidateSelection: (slotId) => this.#invalidateSelection(slotId),
            invalidateSelectionsByPrefix: (prefix) => this.#invalidateSelectionsByPrefix(prefix),
            invalidateClassChoicesByDependency: (dependency) => this.#invalidateClassChoicesByDependency(dependency),
            invalidateBranchSelectionsByDependency: (dependency) => this.#invalidateBranchSelectionsByDependency(dependency),
            invalidateSpellChoicesByDependency: (dependency) => this.#invalidateSpellChoicesByDependency(dependency),
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
        const draft = this.#requireDraft();
        const slotId = stepId;
        if (draft.skillIncreases[slotId] === slug) {
            delete draft.skillIncreases[slotId];
        }
        else {
            draft.skillIncreases[slotId] = slug;
        }
        this.render(false);
    }
    #selectTrainingRule(stepId, flag, slug) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        draft.skillTrainings[stepId] ??= { ruleChoices: {}, additional: [] };
        draft.skillTrainings[stepId].ruleChoices[flag] = slug;
        this.render(false);
    }
    async #selectClassChoice(stepId, value) {
        this.#statusNote = null;
        const step = (await this.#buildPlan()).steps.find((entry) => entry.slotId === stepId);
        const result = await selectClassChoiceValue(this.#selectionCommandState(), step ?? null, value, {
            invalidateBranchSelectionsByDependency: (dependency) => this.#invalidateBranchSelectionsByDependency(dependency),
        });
        await this.#finalizeSelectionCommand(result);
    }
    async #toggleSpellChoice(stepId, rawValue) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const plan = await this.#buildPlan();
        const step = plan.steps.find((entry) => entry.slotId === stepId);
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
        const draft = this.#requireDraft();
        const step = (await this.#buildPlan()).steps.find((entry) => entry.slotId === stepId);
        const additionalCount = step?.training?.additionalCount ?? 0;
        draft.skillTrainings[stepId] ??= { ruleChoices: {}, additional: [] };
        const current = draft.skillTrainings[stepId].additional;
        draft.skillTrainings[stepId].additional = current.includes(slug)
            ? current.filter((entry) => entry !== slug)
            : [...current, slug].slice(0, additionalCount);
        this.render(false);
    }
    async #toggleAncestryMode() {
        const ancestry = (await getEffectiveBuildState(this.actor, this.#requireDraft())).ancestry;
        if (!ancestry) {
            return;
        }
        this.#statusNote = null;
        const draft = this.#requireDraft();
        draft.boosts.ancestry.modeTouched = true;
        draft.boosts.ancestry.mode = ancestry.mode === "alternate" ? "standard" : "alternate";
        if (draft.boosts.ancestry.mode === "alternate") {
            draft.boosts.ancestry.selectedBoosts = {};
        }
        else {
            draft.boosts.ancestry.alternateBoosts = [];
        }
        this.render(false);
    }
    async #toggleVoluntaryEnabled() {
        this.#statusNote = null;
        const voluntary = this.#requireDraft().boosts.ancestry.voluntary;
        voluntary.touched = true;
        voluntary.enabled = !voluntary.enabled;
        if (!voluntary.enabled) {
            voluntary.legacy = false;
            voluntary.boost = null;
            voluntary.flaws = [];
        }
        this.render(false);
    }
    async #toggleVoluntaryLegacy() {
        this.#statusNote = null;
        const voluntary = this.#requireDraft().boosts.ancestry.voluntary;
        voluntary.touched = true;
        voluntary.enabled = true;
        voluntary.legacy = !voluntary.legacy;
        if (!voluntary.legacy) {
            voluntary.boost = null;
            voluntary.flaws = Array.from(new Set(voluntary.flaws));
        }
        else {
            voluntary.flaws = voluntary.flaws.slice(0, 2);
        }
        this.render(false);
    }
    async #toggleBoostChoice(stepId, section, attribute) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
        switch (section) {
            case "ancestry":
                if (!effectiveBuildState.ancestry) {
                    return;
                }
                if (effectiveBuildState.ancestry.mode === "alternate") {
                    const current = draft.boosts.ancestry.alternateBoosts;
                    draft.boosts.ancestry.alternateBoosts = current.includes(attribute)
                        ? current.filter((entry) => entry !== attribute)
                        : [...current, attribute].slice(0, 2);
                }
                else {
                    toggleSlotRecordChoice(draft.boosts.ancestry.selectedBoosts, effectiveBuildState.ancestry.document?.system?.boosts, attribute);
                }
                break;
            case "background":
                if (!effectiveBuildState.background) {
                    return;
                }
                toggleSlotRecordChoice(draft.boosts.background.selectedBoosts, effectiveBuildState.background.document?.system?.boosts, attribute);
                break;
            case "class":
                draft.boosts.class.keyAbility = draft.boosts.class.keyAbility === attribute ? null : attribute;
                break;
            case "level-1":
            case "level-5":
            case "level-10":
            case "level-15":
            case "level-20": {
                const level = section.split("-")[1] ?? "";
                const selected = draft.boosts.levels[level] ?? [
                    ...effectiveBuildState.levelBoosts[Number(level)],
                ];
                draft.boosts.levels[level] = selected.includes(attribute)
                    ? selected.filter((entry) => entry !== attribute)
                    : [...selected, attribute].slice(0, effectiveBuildState.allowedBoosts[Number(level)]);
                break;
            }
        }
        this.#recentlyInvalidatedStepIds.delete(stepId);
        this.render(false);
    }
    async #toggleVoluntaryChoice(stepId, attribute, choiceKind) {
        this.#statusNote = null;
        const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
        const ancestry = effectiveBuildState.ancestry;
        if (!ancestry) {
            return;
        }
        const voluntary = this.#requireDraft().boosts.ancestry.voluntary;
        if (!voluntary.enabled) {
            return;
        }
        voluntary.touched = true;
        const flaws = [...voluntary.flaws];
        const numFlaws = flaws.filter((entry) => entry === attribute).length;
        if (choiceKind === "flaw") {
            if (numFlaws > 0) {
                flaws.splice(flaws.indexOf(attribute), 1);
            }
            else if (!voluntary.legacy || flaws.length < 2) {
                flaws.push(attribute);
            }
        }
        else if (choiceKind === "second-flaw") {
            if (!voluntary.legacy || !ancestry.lockedBoosts.includes(attribute) || numFlaws === 0) {
                return;
            }
            if (numFlaws > 1) {
                flaws.splice(flaws.lastIndexOf(attribute), 1);
            }
            else if (flaws.length < 2) {
                flaws.push(attribute);
            }
        }
        else if (choiceKind === "boost" && voluntary.legacy && flaws.length >= 2) {
            voluntary.boost = voluntary.boost === attribute ? null : attribute;
        }
        voluntary.flaws = flaws;
        this.#recentlyInvalidatedStepIds.delete(stepId);
        this.render(false);
    }
    #abilityLabel(attribute) {
        const abilities = globalThis.CONFIG?.PF2E?.abilities;
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
        return (listActorItems(this.actor).find((item) => {
            if (item?.type !== "feat" || item?.system?.category !== "classfeature") {
                return false;
            }
            const otherTags = Array.isArray(item?.system?.traits?.otherTags) ? item.system.traits.otherTags : [];
            return otherTags.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "wizard-arcane-school");
        }) ?? null);
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
    #clearSelection(slotId) {
        const cleared = clearSelectionState({
            draft: this.#requireDraft(),
            previewValueByStepId: this.#previewValueByStepId,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
            scrollById: this.#scrollById,
        }, slotId, {
            resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
            resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
            resetClassBoostDraft: () => this.#resetClassBoostDraft(),
        });
        if (cleared === 0) {
            return 0;
        }
        if (slotId === SLOT_IDS.deity) {
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice);
        }
        else if (slotId === SLOT_IDS.class) {
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.deity);
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice);
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.skillTraining);
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.spellChoice);
            this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classFeat);
        }
        return cleared;
    }
    #invalidateSelection(slotId) {
        return invalidateSelectionState({
            draft: this.#requireDraft(),
            previewValueByStepId: this.#previewValueByStepId,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
            scrollById: this.#scrollById,
        }, slotId, {
            resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
            resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
            resetClassBoostDraft: () => this.#resetClassBoostDraft(),
        });
    }
    #invalidateSelectionsByPrefix(prefix) {
        return invalidateSelectionsByPrefix({
            draft: this.#requireDraft(),
            previewValueByStepId: this.#previewValueByStepId,
            recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
            scrollById: this.#scrollById,
        }, prefix, {
            resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
            resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
            resetClassBoostDraft: () => this.#resetClassBoostDraft(),
        });
    }
    async #invalidateBranchSelectionsByDependency(dependency) {
        const invalidated = [];
        const plan = await this.#buildPlan();
        for (const step of plan.steps) {
            if (step.kind !== "class-branch" || step.branch?.dependsOn !== dependency) {
                continue;
            }
            invalidated.push(...this.#invalidateSelection(step.slotId));
        }
        return invalidated;
    }
    async #invalidateSpellChoicesByDependency(dependency) {
        const invalidated = [];
        const plan = await this.#buildPlan();
        for (const step of plan.steps) {
            if (step.kind !== "spell-choice" || step.spellChoice?.dependsOn !== dependency) {
                continue;
            }
            invalidated.push(...this.#invalidateSelection(step.slotId));
        }
        return invalidated;
    }
    async #invalidateClassChoicesByDependency(dependency) {
        const invalidated = [];
        const plan = await this.#buildPlan();
        for (const step of plan.steps) {
            if (step.kind !== "class-choice" || step.classChoice?.dependsOn !== dependency) {
                continue;
            }
            invalidated.push(...this.#invalidateSelection(step.slotId));
        }
        return invalidated;
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
        draft.targetLevel = Math.min(20, Math.max(snapshot.level, draft.targetLevel + delta));
        await this.#saveDraft(false);
        this.render(false);
    }
    async #saveDraft(notify = true) {
        await this.actor.update({
            [DRAFT_FLAG]: buildDraftPatch(this.#requireDraft()),
        });
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
        const completion = await Promise.all(plan.steps.map((step) => this.#isStepComplete(step, effectiveBuildState)));
        const missing = completion.some((value) => !value);
        if (missing) {
            ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.MissingSelections"));
            return;
        }
        const confirmed = typeof globalThis.confirm === "function"
            ? globalThis.confirm(`Apply ${plan.steps.length} Wayfinder step(s) to ${this.actor.name}?`)
            : true;
        if (!confirmed) {
            ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.ApplyCancelled"));
            return;
        }
        await applyDraftToActor(this.actor, draft, plan.steps);
        await this.actor.update({
            [DRAFT_FLAG]: null,
            [STATE_FLAG]: {
                ...createEmptyState(),
                lastAppliedAt: new Date().toISOString(),
                lastTargetLevel: draft.targetLevel,
                completedStepIds: plan.steps.map((step) => step.id),
            },
        });
        this.#draft = normalizeDraft(null, snapshot.level);
        this.#recentlyInvalidatedStepIds.clear();
        ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.Applied"));
        this.render(false);
    }
    async #clearDraft() {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        this.#draft = createEmptyDraft(snapshot.level);
        this.#searchByStepId.clear();
        this.#previewValueByStepId.clear();
        this.#recentlyInvalidatedStepIds.clear();
        await this.actor.update({
            [DRAFT_FLAG]: null,
        });
        ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.ClearedDraft"));
        this.render(false);
    }
}
//# sourceMappingURL=app-shell.js.map