import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor } from "../actor-updater.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { DRAFT_FLAG, MODULE_ID, MODULE_TITLE, SKILL_LABELS, STATE_FLAG } from "../constants.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "../draft-service.js";
import { fetchSelectionDocument, getOptionsForStep, getPickerInfoState, resolveSelection } from "../pack-service.js";
import { canUseWayfinder } from "../permissions.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import { bindWayfinderInteractions, parseWayfinderAction } from "./actions.js";
import { buildClassBranchSteps, buildClassChoiceSteps, buildClassFeatSteps, buildClassGrantedItemSteps, buildClassTrainingSteps, } from "./class-choice-service.js";
import { findDraftSelectionByType, hasDuplicateDraftSelection, writeDraftStepSelection } from "./draft-decisions.js";
import { readExistingBranchSelection, readExistingClassChoiceSelection, readExistingGrantedSelection, } from "./existing-selection-service.js";
import { formatSlug, sameMembers } from "./formatting.js";
import { clearSelectionState, invalidateSelectionState, invalidateSelectionsByPrefix } from "./invalidation.js";
import { buildBoostPane, toggleSlotRecordChoice } from "./panes/boost-pane.js";
import { buildClassChoicePane } from "./panes/class-choice-pane.js";
import { buildPickItemPane, buildPreview, matchesSearch, resolvePreviewValue, selectedSelection, selectedValueFor, } from "./panes/pick-pane.js";
import { buildSkillIncreasePane, buildSkillTrainingPane, compareSkillIncreaseSlotIds } from "./panes/skill-pane.js";
import { buildSpellChoicePane } from "./panes/spell-pane.js";
import { buildWayfinderPlan, getWayfinderStepStatus, isWayfinderStepComplete, modeLabel, resolveActiveStep, } from "./plan-service.js";
import { isSanctificationChoiceSlotId, isWizardArcaneSchoolSlotId, SLOT_IDS, SLOT_PREFIXES } from "./slot-ids.js";
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
        if (step.kind === "skill-training") {
            const projectedRanks = await this.#projectSkillRanks(this.#requireDraft(), step.slotId);
            return buildSkillTrainingPane(step, this.#requireDraft(), projectedRanks, this.#getSkillList(projectedRanks), {
                isTrainingStepComplete: (trainingStep) => this.#isTrainingStepComplete(trainingStep),
            });
        }
        if (step.kind === "skill-increase") {
            const projectedRanks = await this.#projectSkillRanks(this.#requireDraft(), step.slotId);
            return buildSkillIncreasePane(step, this.#requireDraft(), projectedRanks, this.#getSkillList(projectedRanks));
        }
        if (step.kind === "class-choice") {
            const selectedValue = this.#requireDraft().classChoices[step.slotId] ?? null;
            const choice = step.classChoice;
            const blocked = choice?.dependsOn === "deity" && !(await this.#resolveDraftOrActorDocument("deity"));
            return buildClassChoicePane({
                step,
                selectedValue,
                selectedLabel: await this.#stepStatus(step, effectiveBuildState),
                blocked,
                blockedTitle: blocked ? "Choose a deity first" : null,
                blockedMessage: blocked
                    ? "This class choice depends on the drafted deity. Resolve the deity step before choosing this option."
                    : null,
            });
        }
        if (step.kind === "spell-choice") {
            const optionContext = await this.#buildOptionContext();
            const options = await getOptionsForStep(step, optionContext);
            const search = this.#searchByStepId.get(step.id) ?? "";
            const filteredOptions = options.filter((option) => matchesSearch(option, search));
            const infoState = getPickerInfoState(step, optionContext, options.length, filteredOptions.length, search);
            const visibleOptions = infoState?.tone === "blocked" ? [] : filteredOptions;
            const contextNote = await this.#buildContextNote(step, optionContext);
            const selectedSelections = this.#requireDraft().spellChoices[step.slotId] ?? [];
            const selectedValues = selectedSelections.map((selection) => `${selection.packId}:${selection.documentId}`);
            const previewValue = resolvePreviewValue(step.id, visibleOptions, options, selectedValues[0] ?? "", this.#previewValueByStepId);
            const previewBase = previewValue
                ? await buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValues.includes(previewValue) ? previewValue : "")
                : null;
            const preview = previewBase
                ? {
                    ...previewBase,
                    selectedLabel: selectedValues.includes(previewValue) ? "Added to draft" : "Add to draft",
                }
                : null;
            return buildSpellChoicePane({
                step,
                search,
                selectedSelections,
                selectedLabel: await this.#stepStatus(step, effectiveBuildState),
                visibleOptions,
                infoState,
                contextNote,
                preview,
                modeLabel: modeLabel(step.kind),
                previewValue,
            });
        }
        const optionContext = await this.#buildOptionContext();
        const options = await getOptionsForStep(step, optionContext);
        const search = this.#searchByStepId.get(step.id) ?? "";
        const filteredOptions = options.filter((option) => matchesSearch(option, search));
        const infoState = getPickerInfoState(step, optionContext, options.length, filteredOptions.length, search);
        const visibleOptions = infoState?.tone === "blocked" ? [] : filteredOptions;
        const contextNote = await this.#buildContextNote(step, optionContext);
        const selectedValue = selectedValueFor(step, this.#requireDraft());
        const previewValue = resolvePreviewValue(step.id, visibleOptions, options, selectedValue, this.#previewValueByStepId);
        const preview = previewValue
            ? await buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValue)
            : null;
        return buildPickItemPane({
            step,
            search,
            selectedValue,
            selectedLabel: selectedSelection(step, this.#requireDraft())?.name ?? null,
            visibleOptions,
            infoState,
            contextNote,
            preview,
            modeLabel: modeLabel(step.kind),
            previewValue,
        });
    }
    async #chooseOption(stepId, rawValue) {
        this.#statusNote = null;
        const snapshot = inspectActor(this.actor);
        const plan = await this.#buildPlan(snapshot, this.#requireDraft());
        const step = plan.steps.find((entry) => entry.id === stepId);
        if (!step) {
            return;
        }
        const optionContext = await this.#buildOptionContext();
        const selection = await resolveSelection(rawValue, step, optionContext);
        if (!selection) {
            return;
        }
        if (hasDuplicateDraftSelection(this.#requireDraft(), selection)) {
            ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.DuplicateSelections"));
            return;
        }
        const previousSelection = writeDraftStepSelection(this.#requireDraft(), step, selection);
        this.#recentlyInvalidatedStepIds.delete(selection.slotId);
        if (step.slotKind === "ancestry" && previousSelection?.uuid !== selection.uuid) {
            const invalidated = this.#invalidateDependentAncestrySelections();
            const boostReset = this.#resetAncestryBoostDraft();
            if (boostReset) {
                this.#recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
            }
            if (invalidated.length > 0 || boostReset) {
                this.#statusNote = boostReset
                    ? "Ancestry changed. Wayfinder cleared ancestry-specific boost draft choices and marked dependent heritage and ancestry-feat picks for review."
                    : "Ancestry changed. Wayfinder marked dependent heritage and ancestry-feat draft picks for review.";
            }
        }
        if (step.slotKind === "heritage" && previousSelection?.uuid !== selection.uuid) {
            const previousTraits = await this.#resolveSelectionTraits(previousSelection);
            const nextTraits = await this.#resolveSelectionTraits(selection);
            if (!sameMembers(previousTraits, nextTraits)) {
                const invalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat);
                if (invalidated.length > 0) {
                    this.#statusNote = "Heritage changed. Wayfinder marked ancestry-feat draft picks for review.";
                }
            }
        }
        if (step.slotKind === "background" && previousSelection?.uuid !== selection.uuid) {
            const boostReset = this.#resetBackgroundBoostDraft();
            if (boostReset) {
                this.#recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
                this.#statusNote = "Background changed. Wayfinder cleared background boost draft choices for review.";
            }
        }
        if (step.slotKind === "class" && previousSelection?.uuid !== selection.uuid) {
            const previousClassSlug = await this.#resolveSelectionSlug(previousSelection);
            const nextClassSlug = await this.#resolveSelectionSlug(selection);
            const boostReset = this.#resetClassBoostDraft();
            if (boostReset) {
                this.#recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
            }
            if (previousClassSlug !== nextClassSlug) {
                const invalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classFeat);
                const deityInvalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.deity);
                const branchInvalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
                const classChoiceInvalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice);
                const trainingInvalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.skillTraining);
                const spellInvalidated = this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.spellChoice);
                if (invalidated.length > 0 ||
                    deityInvalidated.length > 0 ||
                    branchInvalidated.length > 0 ||
                    classChoiceInvalidated.length > 0 ||
                    trainingInvalidated.length > 0 ||
                    spellInvalidated.length > 0 ||
                    boostReset) {
                    this.#statusNote = boostReset
                        ? "Class changed. Wayfinder cleared the key-ability draft choice and marked drafted deity, class training, class path, class choice, spell, and class feat selections for review."
                        : "Class changed. Wayfinder marked drafted deity, class training, class path, class choice, spell, and class feat selections for review.";
                }
            }
            else if (boostReset) {
                this.#statusNote = "Class changed. Wayfinder cleared the key-ability draft choice for review.";
            }
        }
        if (step.slotKind === "deity" && previousSelection?.uuid !== selection.uuid) {
            const invalidatedChoices = await this.#invalidateClassChoicesByDependency("deity");
            const invalidatedBranches = await this.#invalidateBranchSelectionsByDependency("deity");
            if (invalidatedChoices.length > 0 || invalidatedBranches.length > 0) {
                this.#statusNote = "Deity changed. Wayfinder marked dependent class choices and class paths for review.";
            }
        }
        if (step.kind === "class-branch" && previousSelection?.uuid !== selection.uuid) {
            const invalidatedSpells = await this.#invalidateSpellChoicesByDependency("class-branch");
            if (invalidatedSpells.length > 0 && step.branch?.flag === "arcaneSchool") {
                this.#statusNote = "Arcane school changed. Wayfinder marked dependent curriculum spell choices for review.";
            }
        }
        this.#previewValueByStepId.set(stepId, rawValue);
        await this.#moveStep(1);
    }
    #invalidateDependentAncestrySelections() {
        return [
            ...this.#invalidateSelection(SLOT_IDS.heritage),
            ...this.#invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat),
        ];
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
    async #buildOptionContext() {
        const [ancestryDocument, heritageDocument, classDocument, deityDocument, hasDedicationFeat] = await Promise.all([
            this.#resolveDraftOrActorDocument("ancestry"),
            this.#resolveDraftOrActorDocument("heritage"),
            this.#resolveDraftOrActorDocument("class"),
            this.#resolveDraftOrActorDocument("deity"),
            this.#hasDedicationFeatInContext(),
        ]);
        const ancestrySlug = extractDocumentSlug(ancestryDocument);
        return {
            ancestrySlug,
            ancestryTraits: this.#extractContextTraits(ancestryDocument, ancestrySlug),
            heritageTraits: this.#extractContextTraits(heritageDocument),
            classSlug: extractDocumentSlug(classDocument),
            deitySelected: !!deityDocument,
            sanctification: this.#resolveSanctificationChoice(deityDocument),
            hasDedicationFeat,
        };
    }
    async #buildContextNote(step, context) {
        switch (step.slotKind) {
            case "heritage": {
                const ancestryDocument = await this.#resolveDraftOrActorDocument("ancestry");
                const ancestryName = ancestryDocument?.name;
                return ancestryName
                    ? `Showing ${ancestryName} heritages and versatile heritage options that remain legal for this draft.`
                    : null;
            }
            case "ancestry-feat": {
                const ancestryDocument = await this.#resolveDraftOrActorDocument("ancestry");
                const heritageDocument = await this.#resolveDraftOrActorDocument("heritage");
                const ancestryName = ancestryDocument?.name;
                const isVersatile = heritageDocument?.system?.ancestry === null;
                const heritageName = isVersatile ? heritageDocument?.name : null;
                if (ancestryName && heritageName) {
                    return `Showing ancestry feats keyed to ${ancestryName} plus versatile-heritage feats unlocked by ${heritageName}. Shared ancestry feats stay visible when PF2E encodes their gate in prerequisite text instead of traits.`;
                }
                if (ancestryName) {
                    return `Showing ancestry feats keyed to ${ancestryName}. Shared ancestry feats stay visible when PF2E encodes their gate in prerequisite text instead of traits.`;
                }
                return null;
            }
            case "class-feat": {
                const classDocument = await this.#resolveDraftOrActorDocument("class");
                const className = classDocument?.name;
                if (!className) {
                    return null;
                }
                return context.hasDedicationFeat
                    ? `Showing feats keyed to ${className} plus archetype follow-up feats unlocked by an existing dedication. Shared class feats that list ${className} also remain available.`
                    : `Showing feats keyed to ${className} plus dedication feats that can begin an archetype path. Shared class feats that list ${className} also remain available.`;
            }
            case "class-branch": {
                const classDocument = await this.#resolveDraftOrActorDocument("class");
                const className = classDocument?.name;
                const selectorName = step.branch?.selectorName;
                if (step.branch?.optionTag === "champion-cause") {
                    if (!context.deitySelected) {
                        return "Resolve the deity step first so Wayfinder can narrow champion causes to the legal sanctification path.";
                    }
                    const sanctificationLabel = context.sanctification === "holy"
                        ? "holy"
                        : context.sanctification === "unholy"
                            ? "unholy"
                            : context.sanctification === "none"
                                ? "non-sanctified"
                                : "currently unresolved";
                    return className
                        ? `Showing ${className} causes currently legal for the ${sanctificationLabel} sanctification state in this draft.`
                        : null;
                }
                if (className && selectorName) {
                    return `Showing ${className} options granted by ${selectorName}. Wayfinder will write the selector choice into PF2E's native class-feature data on apply.`;
                }
                return className ? `Showing class branch options keyed to ${className}.` : null;
            }
            case "deity": {
                const classDocument = await this.#resolveDraftOrActorDocument("class");
                return classDocument?.name
                    ? `Showing deity choices currently legal for ${classDocument.name}. Wayfinder will wire the selected deity into PF2E's native class-feature data on apply.`
                    : null;
            }
            case "class-choice": {
                if (step.classChoice?.dependsOn === "deity") {
                    const deityDocument = await this.#resolveDraftOrActorDocument("deity");
                    return deityDocument?.name
                        ? `Showing choices unlocked by ${deityDocument.name}. Wayfinder will write this directly into the granting class feature on apply.`
                        : "Resolve the deity step first so Wayfinder can narrow this class choice.";
                }
                const classDocument = await this.#resolveDraftOrActorDocument("class");
                return classDocument?.name
                    ? `Showing direct class-feature choices from ${classDocument.name}. Wayfinder will write this directly into the granting class feature on apply.`
                    : null;
            }
            case "spell-choice": {
                const spellChoice = step.spellChoice;
                if (!spellChoice) {
                    return null;
                }
                if (spellChoice.dependsOn === "class-branch" && spellChoice.curriculumSpellNames.length === 0) {
                    return "Resolve the arcane school step first so Wayfinder can narrow this list to the chosen curriculum.";
                }
                const rankLabel = spellChoice.cantrip
                    ? "arcane cantrips"
                    : spellChoice.minRank === spellChoice.maxRank
                        ? `rank ${spellChoice.maxRank} arcane spells`
                        : `arcane spells of rank ${spellChoice.minRank} to ${spellChoice.maxRank}`;
                const sourceLabel = spellChoice.sourceName || "Wizard Spellcasting";
                return `Showing ${rankLabel} that will be added to the ${spellChoice.destination.label}. Source: ${sourceLabel}. Daily prepared loadouts remain on PF2E's character sheet.`;
            }
            case "skill-feat":
                return "Showing baseline skill feats. Archetype-tagged skill feats stay hidden until Wayfinder tracks a specific archetype path.";
            case "general-feat":
                return "Showing the full general-feat pool from the enabled compendia. Wayfinder does not narrow this step by ancestry or class draft.";
            default:
                return null;
        }
    }
    async #projectSkillRanks(draft, upToSlotId) {
        const snapshot = inspectActor(this.actor);
        const projected = { ...snapshot.skillRanks };
        const [backgroundDocument, classDocument] = await Promise.all([
            this.#resolveDraftOrActorDocument("background"),
            this.#resolveDraftOrActorDocument("class"),
        ]);
        for (const slug of this.#extractFixedTrainedSkills(backgroundDocument)) {
            projected[slug] = Math.max(projected[slug] ?? 0, 1);
        }
        for (const slug of this.#extractFixedTrainedSkills(classDocument)) {
            projected[slug] = Math.max(projected[slug] ?? 0, 1);
        }
        const sortedTrainingSlotIds = Object.keys(draft.skillTrainings).sort((left, right) => left.localeCompare(right));
        for (const slotId of sortedTrainingSlotIds) {
            if (slotId >= upToSlotId) {
                break;
            }
            const training = draft.skillTrainings[slotId];
            if (!training) {
                continue;
            }
            for (const slug of [...Object.values(training.ruleChoices), ...training.additional]) {
                if (!slug) {
                    continue;
                }
                projected[slug] = Math.max(projected[slug] ?? 0, 1);
            }
        }
        const sortedSlotIds = Object.keys(draft.skillIncreases).sort(compareSkillIncreaseSlotIds);
        for (const slotId of sortedSlotIds) {
            if (slotId >= upToSlotId) {
                break;
            }
            const slug = draft.skillIncreases[slotId];
            if (slug && typeof projected[slug] === "number") {
                projected[slug] = Math.min(4, projected[slug] + 1);
            }
            else if (slug) {
                projected[slug] = 1;
            }
        }
        return projected;
    }
    #extractFixedTrainedSkills(document) {
        const skills = Array.isArray(document?.system?.trainedSkills?.value) ? document.system.trainedSkills.value : [];
        return skills
            .filter((entry) => typeof entry === "string" && entry.length > 0)
            .map((entry) => entry.trim().toLowerCase());
    }
    #getSkillList(actorSkillRanks) {
        const configSkills = globalThis.CONFIG?.PF2E?.skills;
        const result = [];
        const seen = new Set();
        if (configSkills && typeof configSkills === "object") {
            for (const slug of Object.keys(configSkills)) {
                const entry = configSkills[slug];
                const sourceLabel = typeof entry === "string" ? entry : entry?.label;
                const label = this.#skillLabel(slug, sourceLabel);
                result.push({ slug, label });
                seen.add(slug);
            }
        }
        else {
            for (const [slug, label] of Object.entries(SKILL_LABELS)) {
                result.push({ slug, label: this.#skillLabel(slug, label) });
                seen.add(slug);
            }
        }
        for (const slug of Object.keys(actorSkillRanks)) {
            if (!seen.has(slug)) {
                result.push({ slug, label: this.#skillLabel(slug) });
            }
        }
        return result.sort((a, b) => a.label.localeCompare(b.label));
    }
    #skillLabel(slug, sourceLabel) {
        const localized = typeof sourceLabel === "string" && sourceLabel.length > 0 ? game.i18n.localize(sourceLabel) : "";
        if (localized && localized !== sourceLabel) {
            return localized;
        }
        const fallback = SKILL_LABELS[slug];
        if (fallback) {
            return game.i18n.localize(fallback);
        }
        return formatSlug(slug);
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
        const draft = this.#requireDraft();
        const step = (await this.#buildPlan()).steps.find((entry) => entry.slotId === stepId);
        const invalidatesDeityBranches = step?.classChoice?.flag === "sanctification";
        const wasSelected = draft.classChoices[stepId] === value;
        if (wasSelected) {
            delete draft.classChoices[stepId];
            if (invalidatesDeityBranches) {
                const invalidated = await this.#invalidateBranchSelectionsByDependency("deity");
                if (invalidated.length > 0) {
                    this.#statusNote = "Sanctification changed. Wayfinder marked dependent class paths for review.";
                }
            }
            this.#recentlyInvalidatedStepIds.delete(stepId);
            this.render(false);
            return;
        }
        const previousValue = draft.classChoices[stepId] ?? null;
        draft.classChoices[stepId] = value;
        if (invalidatesDeityBranches && previousValue !== value) {
            const invalidated = await this.#invalidateBranchSelectionsByDependency("deity");
            if (invalidated.length > 0) {
                this.#statusNote = "Sanctification changed. Wayfinder marked dependent class paths for review.";
            }
        }
        this.#recentlyInvalidatedStepIds.delete(stepId);
        await this.#moveStep(1);
    }
    async #toggleSpellChoice(stepId, rawValue) {
        this.#statusNote = null;
        const draft = this.#requireDraft();
        const plan = await this.#buildPlan();
        const step = plan.steps.find((entry) => entry.slotId === stepId);
        if (!step || step.kind !== "spell-choice") {
            return;
        }
        const optionContext = await this.#buildOptionContext();
        const selection = await resolveSelection(rawValue, step, optionContext);
        if (!selection) {
            return;
        }
        draft.spellChoices[stepId] ??= [];
        const current = draft.spellChoices[stepId];
        const existingIndex = current.findIndex((entry) => entry.uuid === selection.uuid);
        if (existingIndex !== -1) {
            current.splice(existingIndex, 1);
            if (current.length === 0) {
                delete draft.spellChoices[stepId];
            }
            this.#recentlyInvalidatedStepIds.delete(stepId);
            this.render(false);
            return;
        }
        const selectedElsewhere = Object.entries(draft.spellChoices).some(([slotId, selections]) => {
            if (slotId === stepId) {
                return false;
            }
            return selections.some((entry) => entry.uuid === selection.uuid);
        });
        const existsOnActor = listActorItems(this.actor).some((item) => {
            return item?.type === "spell" && sourceIdOf(item) === selection.uuid;
        });
        if (selectedElsewhere || existsOnActor) {
            ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.DuplicateSelections"));
            return;
        }
        const requiredCount = step.spellChoice?.count ?? 0;
        if (current.length >= requiredCount) {
            ui.notifications.warn("This spell choice is already full. Remove one before adding another.");
            return;
        }
        current.push(selection);
        this.#recentlyInvalidatedStepIds.delete(stepId);
        if (current.length >= requiredCount) {
            await this.#moveStep(1);
            return;
        }
        this.render(false);
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
    #extractContextTraits(document, fallbackSlug) {
        const traits = Array.isArray(document?.system?.traits?.value) ? document.system.traits.value : [];
        const normalized = new Set(traits
            .filter((entry) => typeof entry === "string")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean));
        const slug = fallbackSlug ?? extractDocumentSlug(document);
        if (slug) {
            normalized.add(slug);
        }
        return Array.from(normalized);
    }
    #resolveSanctificationChoice(deityDocument) {
        const drafted = Object.entries(this.#requireDraft().classChoices).find(([slotId]) => isSanctificationChoiceSlotId(slotId))?.[1];
        if (drafted === "holy" || drafted === "unholy" || drafted === "none") {
            return drafted;
        }
        const actorSelection = listActorItems(this.actor)
            .map((item) => item?.flags?.pf2e?.rulesSelections?.sanctification)
            .find((value) => typeof value === "string" && value.length > 0) ?? null;
        if (actorSelection === "holy" || actorSelection === "unholy" || actorSelection === "none") {
            return actorSelection;
        }
        const sanctification = deityDocument?.system?.sanctification;
        if (!sanctification || typeof sanctification !== "object") {
            return "none";
        }
        const modal = typeof sanctification.modal === "string" ? sanctification.modal.trim().toLowerCase() : "";
        const values = Array.isArray(sanctification.what)
            ? sanctification.what.filter((value) => typeof value === "string")
            : [];
        if (modal === "must" && values.length === 1) {
            const value = values[0]?.trim().toLowerCase();
            return value === "holy" || value === "unholy" ? value : "none";
        }
        if (values.length === 0) {
            return "none";
        }
        return null;
    }
    async #resolveSelectionTraits(selection) {
        if (!selection) {
            return [];
        }
        const document = await fetchSelectionDocument(selection);
        return this.#extractContextTraits(document);
    }
    async #resolveSelectionSlug(selection) {
        if (!selection) {
            return null;
        }
        const document = await fetchSelectionDocument(selection);
        return extractDocumentSlug(document);
    }
    async #hasDedicationFeatInContext() {
        const actorHasDedication = listActorItems(this.actor).some((item) => item?.type === "feat" && this.#extractContextTraits(item).includes("dedication"));
        if (actorHasDedication) {
            return true;
        }
        const draftedFeatSelections = Object.values(this.#requireDraft().selections).filter((selection) => selection.itemType === "feat");
        if (draftedFeatSelections.length === 0) {
            return false;
        }
        const draftedFeatDocuments = await Promise.all(draftedFeatSelections.map((selection) => fetchSelectionDocument(selection)));
        return draftedFeatDocuments.some((document) => this.#extractContextTraits(document).includes("dedication"));
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