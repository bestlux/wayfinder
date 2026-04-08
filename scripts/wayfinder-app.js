import { DRAFT_FLAG, MODULE_ID, MODULE_TITLE, STATE_FLAG } from "./constants.js";
import { inspectActor } from "./actor-inspector.js";
import { applyDraftToActor } from "./actor-updater.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "./draft-service.js";
import { fetchSelectionDocument, getOptionsForStep, resolveSelection } from "./pack-service.js";
import { canUseWayfinder } from "./permissions.js";
import { buildProgressionPlan } from "./progression.js";
export class WayfinderApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: MODULE_ID,
        tag: "section",
        classes: ["wayfinder-app"],
        position: {
            width: 1240,
            height: 820
        },
        window: {
            icon: "fa-solid fa-compass",
            title: "PF2E-WAYFINDER.App.Title",
            contentClasses: ["standard-form"]
        }
    };
    static PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/wayfinder-app.hbs`,
            root: true
        }
    };
    actor;
    #draft = null;
    #activeStepId = null;
    #searchByStepId = new Map();
    #previewValueByStepId = new Map();
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
            uniqueId: `${MODULE_ID}-${options.actor.id}`
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
        const plan = buildProgressionPlan(snapshot, draft.targetLevel);
        const activeStep = this.#resolveActiveStep(plan.steps);
        const activePane = activeStep ? await this.#buildActivePane(activeStep) : null;
        const activeStepIndex = activeStep ? plan.steps.findIndex((step) => step.id === activeStep.id) : -1;
        const summary = [
            {
                label: "Ancestry",
                value: snapshot.singletonSlots.ancestry ? (snapshot.namesByType.ancestry?.[0] ?? "Set") : "Missing",
                complete: snapshot.singletonSlots.ancestry
            },
            {
                label: "Heritage",
                value: snapshot.singletonSlots.heritage ? (snapshot.namesByType.heritage?.[0] ?? "Set") : "Missing",
                complete: snapshot.singletonSlots.heritage
            },
            {
                label: "Background",
                value: snapshot.singletonSlots.background ? (snapshot.namesByType.background?.[0] ?? "Set") : "Missing",
                complete: snapshot.singletonSlots.background
            },
            {
                label: "Class",
                value: snapshot.singletonSlots.class ? (snapshot.namesByType.class?.[0] ?? "Set") : "Missing",
                complete: snapshot.singletonSlots.class
            }
        ];
        return {
            actorName: this.actor.name,
            currentLevel: snapshot.level,
            targetLevel: plan.targetLevel,
            hasPendingSteps: plan.steps.length > 0,
            guidance: "Work through the build in order. Review each choice in a compact browser, inspect the details, and commit it to the draft only when it fits the character.",
            summary,
            stepCount: plan.steps.length,
            completedCount: plan.steps.filter((step) => this.#isStepComplete(step)).length,
            activeStepIndex: activeStepIndex + 1,
            steps: plan.steps.map((step, index) => ({
                id: step.id,
                index: index + 1,
                level: step.level,
                title: step.title,
                active: step.id === activeStep?.id,
                complete: this.#isStepComplete(step),
                modeLabel: step.kind === "pick-item" ? "Selection" : "Manual",
                status: this.#stepStatus(step)
            })),
            activePane,
            canGoPrevious: !!activeStep && plan.steps.findIndex((step) => step.id === activeStep.id) > 0,
            canGoNext: !!activeStep && plan.steps.findIndex((step) => step.id === activeStep.id) < plan.steps.length - 1
        };
    }
    async _onRender(context, options) {
        await super._onRender(context, options);
        const root = this.element;
        if (!(root instanceof HTMLElement)) {
            return;
        }
        for (const element of root.querySelectorAll("[data-wayfinder-action]")) {
            element.addEventListener("click", this.#onActionClick);
        }
        const search = root.querySelector("[data-wayfinder-search]");
        if (search) {
            search.addEventListener("input", this.#onSearchInput);
        }
        const manual = root.querySelector("[data-wayfinder-manual]");
        if (manual) {
            manual.addEventListener("change", this.#onManualChange);
        }
    }
    _tearDown(options) {
        super._tearDown(options);
        delete this.actor.apps[this.id];
    }
    #onActionClick = async (event) => {
        const target = event.currentTarget;
        const action = target?.dataset.wayfinderAction;
        if (!action) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        switch (action) {
            case "select-step":
                this.#activeStepId = target.dataset.stepId ?? null;
                this.render(false);
                break;
            case "previous-step":
                this.#moveStep(-1);
                break;
            case "next-step":
                this.#moveStep(1);
                break;
            case "preview-option":
                if (target.dataset.stepId && target.dataset.value) {
                    this.#previewValueByStepId.set(target.dataset.stepId, target.dataset.value);
                    this.render(false);
                }
                break;
            case "select-option":
                if (target.dataset.stepId && target.dataset.value) {
                    await this.#chooseOption(target.dataset.stepId, target.dataset.value);
                }
                break;
            case "clear-option":
                if (target.dataset.stepId) {
                    delete this.#requireDraft().selections[target.dataset.stepId];
                    this.#previewValueByStepId.delete(target.dataset.stepId);
                    this.render(false);
                }
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
        this.#searchByStepId.set(stepId, input.value);
        this.render(false);
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
    #resolveActiveStep(steps) {
        if (steps.length === 0) {
            this.#activeStepId = null;
            return null;
        }
        const explicit = steps.find((step) => step.id === this.#activeStepId);
        if (explicit) {
            return explicit;
        }
        const nextIncomplete = steps.find((step) => !this.#isStepComplete(step)) ?? steps[0];
        this.#activeStepId = nextIncomplete.id;
        return nextIncomplete;
    }
    async #buildActivePane(step) {
        if (step.kind === "manual") {
            return {
                kind: "manual",
                isPickItem: false,
                isManual: true,
                stepId: step.id,
                slotId: step.slotId,
                level: step.level,
                modeLabel: "Manual",
                title: step.title,
                description: step.description,
                completed: this.#requireDraft().manual[step.slotId] === true,
                selectedLabel: this.#stepStatus(step)
            };
        }
        const options = await getOptionsForStep(step);
        const search = this.#searchByStepId.get(step.id) ?? "";
        const filteredOptions = options.filter((option) => this.#matchesSearch(option, search));
        const selectedValue = this.#selectedValueFor(step);
        const previewValue = this.#resolvePreviewValue(step.id, filteredOptions, options, selectedValue);
        const preview = previewValue
            ? await this.#buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValue)
            : null;
        return {
            kind: "pick-item",
            isPickItem: true,
            isManual: false,
            stepId: step.id,
            slotId: step.slotId,
            level: step.level,
            modeLabel: "Selection",
            title: step.title,
            description: step.description,
            search,
            selectedValue,
            selectedLabel: this.#requireDraft().selections[step.slotId]?.name ?? null,
            resultCount: filteredOptions.length,
            options: filteredOptions.map((option) => ({
                ...option,
                selected: option.value === selectedValue,
                previewing: option.value === previewValue,
                sourceLabel: option.source ?? "Unknown Source"
            })),
            preview
        };
    }
    async #buildPreview(option, selectedValue) {
        if (!option) {
            return null;
        }
        const document = await fetchSelectionDocument({
            slotId: "",
            packId: option.packId,
            documentId: option.documentId,
            uuid: option.uuid,
            itemType: option.itemType,
            featType: option.featType,
            name: option.name,
            level: option.level
        });
        if (!document) {
            return {
                title: option.name,
                img: option.img,
                source: option.source,
                rarity: option.rarity,
                tags: [],
                details: [],
                description: "",
                selected: option.value === selectedValue,
                selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
                value: option.value
            };
        }
        const system = document.system ?? {};
        return {
            title: document.name,
            img: document.img,
            source: system.publication?.title?.trim() || option.source,
            rarity: system.traits?.rarity ?? option.rarity,
            tags: Array.isArray(system.traits?.value) ? system.traits.value.map((trait) => this.#formatSlug(trait)) : [],
            details: this.#buildPreviewDetails(document),
            description: await TextEditor.enrichHTML(String(system.description?.value ?? ""), { async: true }),
            selected: option.value === selectedValue,
            selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
            value: option.value
        };
    }
    #buildPreviewDetails(document) {
        const system = document.system ?? {};
        switch (document.type) {
            case "ancestry":
                return [
                    row("Hit Points", system.hp),
                    row("Size", this.#formatSlug(system.size)),
                    row("Speed", system.speed ? `${system.speed} ft` : null),
                    row("Vision", this.#formatSlug(system.vision)),
                    row("Boosts", this.#formatBoosts(system.boosts)),
                    row("Flaw", this.#formatFlaws(system.flaws)),
                    row("Languages", Array.isArray(system.languages?.value) ? system.languages.value.map((value) => this.#formatSlug(value)).join(", ") : null)
                ].filter(Boolean);
            case "heritage":
                return [
                    row("Ancestry", system.ancestry?.name ?? this.#formatSlug(system.ancestry?.slug)),
                    row("Rarity", this.#formatSlug(system.traits?.rarity))
                ].filter(Boolean);
            case "background":
                return [
                    row("Boosts", this.#formatBoosts(system.boosts)),
                    row("Skills", Array.isArray(system.trainedSkills?.value) ? system.trainedSkills.value.map((value) => this.#formatSlug(value)).join(", ") : null),
                    row("Lore", Array.isArray(system.trainedSkills?.lore) ? system.trainedSkills.lore.join(", ") : null),
                    row("Granted Item", system.items ? Object.values(system.items).map((item) => item.name).join(", ") : null)
                ].filter(Boolean);
            case "class":
                return [
                    row("Hit Points", system.hp),
                    row("Key Ability", Array.isArray(system.keyAbility?.value) ? system.keyAbility.value.map((value) => value.toUpperCase()).join(" or ") : null),
                    row("Perception", this.#rankLabel(system.perception)),
                    row("Saving Throws", this.#formatSavingThrows(system.savingThrows)),
                    row("Skill Training", typeof system.trainedSkills?.additional === "number" ? `Trained in ${system.trainedSkills.additional} additional skills` : null)
                ].filter(Boolean);
            case "feat":
                return [
                    row("Level", system.level?.value),
                    row("Category", this.#formatSlug(system.category ?? system.featType?.value ?? document.featType)),
                    row("Actions", this.#formatActions(system)),
                    row("Prerequisites", Array.isArray(system.prerequisites?.value) ? system.prerequisites.value.map((entry) => entry.value ?? entry).join(", ") : null)
                ].filter(Boolean);
            default:
                return [row("Level", system.level?.value)].filter(Boolean);
        }
    }
    #selectedValueFor(step) {
        const selection = this.#requireDraft().selections[step.slotId];
        return selection ? `${selection.packId}:${selection.documentId}` : "";
    }
    #resolvePreviewValue(stepId, filteredOptions, allOptions, selectedValue) {
        const current = this.#previewValueByStepId.get(stepId);
        if (current && allOptions.some((option) => option.value === current)) {
            return current;
        }
        if (selectedValue) {
            this.#previewValueByStepId.set(stepId, selectedValue);
            return selectedValue;
        }
        const fallback = filteredOptions[0]?.value ?? allOptions[0]?.value ?? "";
        if (fallback) {
            this.#previewValueByStepId.set(stepId, fallback);
        }
        return fallback;
    }
    #matchesSearch(option, search) {
        const query = search.trim().toLowerCase();
        if (!query) {
            return true;
        }
        return [option.name, option.source ?? "", option.rarity ?? ""].some((value) => value.toLowerCase().includes(query));
    }
    async #chooseOption(stepId, rawValue) {
        const snapshot = inspectActor(this.actor);
        const plan = buildProgressionPlan(snapshot, this.#requireDraft().targetLevel);
        const step = plan.steps.find((entry) => entry.id === stepId);
        if (!step) {
            return;
        }
        const selection = await resolveSelection(rawValue, step);
        if (!selection) {
            return;
        }
        const duplicates = Object.values(this.#requireDraft().selections).some((existing) => existing.uuid === selection.uuid && existing.slotId !== selection.slotId);
        if (duplicates) {
            ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.DuplicateSelections"));
            return;
        }
        this.#requireDraft().selections[selection.slotId] = selection;
        this.#previewValueByStepId.set(stepId, rawValue);
        this.#moveStep(1);
    }
    #moveStep(delta) {
        const snapshot = inspectActor(this.actor);
        const plan = buildProgressionPlan(snapshot, this.#requireDraft().targetLevel);
        const currentIndex = plan.steps.findIndex((step) => step.id === this.#activeStepId);
        if (currentIndex === -1) {
            return;
        }
        const nextIndex = Math.min(plan.steps.length - 1, Math.max(0, currentIndex + delta));
        this.#activeStepId = plan.steps[nextIndex]?.id ?? this.#activeStepId;
        this.render(false);
    }
    #isStepComplete(step) {
        const draft = this.#requireDraft();
        return step.kind === "manual" ? draft.manual[step.slotId] === true : !!draft.selections[step.slotId];
    }
    #stepStatus(step) {
        const draft = this.#requireDraft();
        if (step.kind === "manual") {
            return draft.manual[step.slotId] === true ? "Ready to apply" : "Needs manual review";
        }
        return draft.selections[step.slotId]?.name ?? "Choose one";
    }
    async #adjustTargetLevel(delta) {
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        draft.targetLevel = Math.min(20, Math.max(snapshot.level, draft.targetLevel + delta));
        await this.#saveDraft(false);
        this.render(false);
    }
    async #saveDraft(notify = true) {
        await this.actor.update({
            [DRAFT_FLAG]: buildDraftPatch(this.#requireDraft())
        });
        if (notify) {
            ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.SavedDraft"));
        }
    }
    async #applyDraft() {
        const snapshot = inspectActor(this.actor);
        const draft = this.#requireDraft();
        const plan = buildProgressionPlan(snapshot, draft.targetLevel);
        const missing = plan.steps.some((step) => !this.#isStepComplete(step));
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
                completedStepIds: plan.steps.map((step) => step.id)
            }
        });
        this.#draft = normalizeDraft(null, snapshot.level);
        ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.Applied"));
        this.render(false);
    }
    async #clearDraft() {
        const snapshot = inspectActor(this.actor);
        this.#draft = createEmptyDraft(snapshot.level);
        this.#searchByStepId.clear();
        this.#previewValueByStepId.clear();
        await this.actor.update({
            [DRAFT_FLAG]: null
        });
        ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.ClearedDraft"));
        this.render(false);
    }
    #formatSlug(value) {
        if (typeof value !== "string" || value.length === 0) {
            return "";
        }
        return value
            .split(/[-_ ]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }
    #formatBoosts(boosts) {
        if (!boosts || typeof boosts !== "object") {
            return "";
        }
        return Object.values(boosts)
            .flatMap((entry) => Array.isArray(entry?.value) ? entry.value : [])
            .map((value) => value.toUpperCase())
            .join(", ");
    }
    #formatFlaws(flaws) {
        if (!flaws || typeof flaws !== "object") {
            return "";
        }
        return Object.values(flaws)
            .flatMap((entry) => Array.isArray(entry?.value) ? entry.value : [])
            .map((value) => value.toUpperCase())
            .join(", ");
    }
    #formatSavingThrows(saves) {
        if (!saves || typeof saves !== "object") {
            return "";
        }
        return [
            saves.fortitude ? `Fort ${this.#rankLabel(saves.fortitude)}` : null,
            saves.reflex ? `Ref ${this.#rankLabel(saves.reflex)}` : null,
            saves.will ? `Will ${this.#rankLabel(saves.will)}` : null
        ].filter(Boolean).join(" • ");
    }
    #rankLabel(rank) {
        const numeric = Number(rank);
        switch (numeric) {
            case 0: return "Untrained";
            case 1: return "Trained";
            case 2: return "Expert";
            case 3: return "Master";
            case 4: return "Legendary";
            default: return String(rank ?? "");
        }
    }
    #formatActions(system) {
        const actionType = system?.actionType?.value;
        const actions = system?.actions?.value;
        if (actionType === "passive") {
            return "Passive";
        }
        if (actionType === "free") {
            return "Free Action";
        }
        if (actionType === "reaction") {
            return "Reaction";
        }
        if (actionType === "action" && actions) {
            return `${actions} Action${Number(actions) === 1 ? "" : "s"}`;
        }
        return "";
    }
}
function row(label, value) {
    if (value === null || value === undefined) {
        return null;
    }
    const rendered = String(value).trim();
    return rendered ? { label, value: rendered } : null;
}
//# sourceMappingURL=wayfinder-app.js.map