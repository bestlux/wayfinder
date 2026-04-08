import { DRAFT_FLAG, MODULE_ID, MODULE_TITLE, STATE_FLAG } from "./constants.js";
import { inspectActor } from "./actor-inspector.js";
import { applyDraftToActor } from "./actor-updater.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "./draft-service.js";
import { fetchSelectionDocument, getOptionsForStep, resolveSelection } from "./pack-service.js";
import { canUseWayfinder } from "./permissions.js";
import { buildProgressionPlan } from "./progression.js";
import type { DraftState, OptionRecord, PendingStep } from "./types.js";

interface StepNavRow {
  id: string;
  index: number;
  level: number;
  title: string;
  active: boolean;
  complete: boolean;
  modeLabel: string;
  status: string;
}

interface SummaryItem {
  label: string;
  value: string;
  complete: boolean;
}

interface DetailRow {
  label: string;
  value: string;
}

interface PreviewPane {
  title: string;
  img: string;
  source: string | null;
  rarity: string | null;
  tags: string[];
  details: DetailRow[];
  description: string;
  selected: boolean;
  selectedLabel: string;
  value: string;
}

interface PickStepPane {
  kind: "pick-item";
  isPickItem: true;
  isManual: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  search: string;
  selectedValue: string;
  selectedLabel: string | null;
  resultCount: number;
  options: Array<OptionRecord & { selected: boolean; previewing: boolean; sourceLabel: string }>;
  preview: PreviewPane | null;
}

interface ManualStepPane {
  kind: "manual";
  isPickItem: false;
  isManual: true;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
}

type ActivePane = PickStepPane | ManualStepPane | null;

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

  actor: any;
  #draft: DraftState | null = null;
  #activeStepId: string | null = null;
  #searchByStepId = new Map<string, string>();
  #previewValueByStepId = new Map<string, string>();

  static open(actor: any): void {
    if (!canUseWayfinder(actor)) {
      ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.OwnerOnly"));
      return;
    }

    const existing = Object.values(actor.apps ?? {}).find((app: any) => app instanceof WayfinderApp);
    if (existing) {
      existing.render(true);
      return;
    }

    new WayfinderApp({ actor }).render(true);
  }

  constructor(options: { actor: any }) {
    super({
      uniqueId: `${MODULE_ID}-${options.actor.id}`
    });
    this.actor = options.actor;
    this.actor.apps[this.id] = this;
  }

  get id(): string {
    return `${MODULE_ID}-${this.actor.id}`;
  }

  get title(): string {
    return `${MODULE_TITLE}: ${this.actor.name}`;
  }

  async _prepareContext(): Promise<any> {
    const snapshot = inspectActor(this.actor);
    const draft = this.#ensureDraft(snapshot.level);
    const plan = buildProgressionPlan(snapshot, draft.targetLevel);
    const activeStep = this.#resolveActiveStep(plan.steps);
    const activePane = activeStep ? await this.#buildActivePane(activeStep) : null;
    const activeStepIndex = activeStep ? plan.steps.findIndex((step) => step.id === activeStep.id) : -1;
    const summary: SummaryItem[] = [
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
      }) satisfies StepNavRow),
      activePane,
      canGoPrevious: !!activeStep && plan.steps.findIndex((step) => step.id === activeStep.id) > 0,
      canGoNext: !!activeStep && plan.steps.findIndex((step) => step.id === activeStep.id) < plan.steps.length - 1
    };
  }

  async _onRender(context: any, options: any): Promise<void> {
    await super._onRender(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    for (const element of root.querySelectorAll<HTMLElement>("[data-wayfinder-action]")) {
      element.addEventListener("click", this.#onActionClick);
    }

    const search = root.querySelector<HTMLInputElement>("[data-wayfinder-search]");
    if (search) {
      search.addEventListener("input", this.#onSearchInput);
    }

    const manual = root.querySelector<HTMLInputElement>("[data-wayfinder-manual]");
    if (manual) {
      manual.addEventListener("change", this.#onManualChange);
    }
  }

  _tearDown(options: any): void {
    super._tearDown(options);
    delete this.actor.apps[this.id];
  }

  #onActionClick = async (event: Event): Promise<void> => {
    const target = event.currentTarget as HTMLElement | null;
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

  #onSearchInput = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    if (!stepId) {
      return;
    }

    this.#searchByStepId.set(stepId, input.value);
    this.render(false);
  };

  #onManualChange = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    if (!stepId) {
      return;
    }

    this.#requireDraft().manual[stepId] = input.checked;
    this.render(false);
  };

  #ensureDraft(defaultTargetLevel: number): DraftState {
    if (!this.#draft) {
      this.#draft = normalizeDraft(this.actor.getFlag(MODULE_ID, "draft"), defaultTargetLevel);
    }
    return this.#draft;
  }

  #requireDraft(): DraftState {
    if (!this.#draft) {
      this.#draft = createEmptyDraft(1);
    }
    return this.#draft;
  }

  #resolveActiveStep(steps: PendingStep[]): PendingStep | null {
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

  async #buildActivePane(step: PendingStep): Promise<ActivePane> {
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

    const optionContext = await this.#buildOptionContext();
    const options = await getOptionsForStep(step, optionContext);
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

  async #buildPreview(option: OptionRecord | null, selectedValue: string): Promise<PreviewPane | null> {
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
      tags: Array.isArray(system.traits?.value) ? system.traits.value.map((trait: string) => this.#formatSlug(trait)) : [],
      details: this.#buildPreviewDetails(document),
      description: await TextEditor.enrichHTML(String(system.description?.value ?? ""), { async: true }),
      selected: option.value === selectedValue,
      selectedLabel: option.value === selectedValue ? "Selected" : "Choose for draft",
      value: option.value
    };
  }

  #buildPreviewDetails(document: any): DetailRow[] {
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
          row("Languages", Array.isArray(system.languages?.value) ? system.languages.value.map((value: string) => this.#formatSlug(value)).join(", ") : null)
        ].filter(Boolean) as DetailRow[];
      case "heritage":
        return [
          row("Ancestry", system.ancestry?.name ?? this.#formatSlug(system.ancestry?.slug)),
          row("Rarity", this.#formatSlug(system.traits?.rarity))
        ].filter(Boolean) as DetailRow[];
      case "background":
        return [
          row("Boosts", this.#formatBoosts(system.boosts)),
          row("Skills", Array.isArray(system.trainedSkills?.value) ? system.trainedSkills.value.map((value: string) => this.#formatSlug(value)).join(", ") : null),
          row("Lore", Array.isArray(system.trainedSkills?.lore) ? system.trainedSkills.lore.join(", ") : null),
          row("Granted Item", system.items ? Object.values(system.items).map((item: any) => item.name).join(", ") : null)
        ].filter(Boolean) as DetailRow[];
      case "class":
        return [
          row("Hit Points", system.hp),
          row("Key Ability", Array.isArray(system.keyAbility?.value) ? system.keyAbility.value.map((value: string) => value.toUpperCase()).join(" or ") : null),
          row("Perception", this.#rankLabel(system.perception)),
          row("Saving Throws", this.#formatSavingThrows(system.savingThrows)),
          row("Skill Training", typeof system.trainedSkills?.additional === "number" ? `Trained in ${system.trainedSkills.additional} additional skills` : null)
        ].filter(Boolean) as DetailRow[];
      case "feat":
        return [
          row("Level", system.level?.value),
          row("Category", this.#formatSlug(system.category ?? system.featType?.value ?? document.featType)),
          row("Actions", this.#formatActions(system)),
          row("Prerequisites", Array.isArray(system.prerequisites?.value) ? system.prerequisites.value.map((entry: any) => entry.value ?? entry).join(", ") : null)
        ].filter(Boolean) as DetailRow[];
      default:
        return [row("Level", system.level?.value)].filter(Boolean) as DetailRow[];
    }
  }

  #selectedValueFor(step: PendingStep): string {
    const selection = this.#requireDraft().selections[step.slotId];
    return selection ? `${selection.packId}:${selection.documentId}` : "";
  }

  #resolvePreviewValue(stepId: string, filteredOptions: OptionRecord[], allOptions: OptionRecord[], selectedValue: string): string {
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

  #matchesSearch(option: OptionRecord, search: string): boolean {
    const query = search.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [option.name, option.source ?? "", option.rarity ?? ""].some((value) => value.toLowerCase().includes(query));
  }

  async #chooseOption(stepId: string, rawValue: string): Promise<void> {
    const snapshot = inspectActor(this.actor);
    const plan = buildProgressionPlan(snapshot, this.#requireDraft().targetLevel);
    const step = plan.steps.find((entry) => entry.id === stepId);
    if (!step) {
      return;
    }

    const optionContext = await this.#buildOptionContext();
    const selection = await resolveSelection(rawValue, step, optionContext);
    if (!selection) {
      return;
    }

    const duplicates = Object.values(this.#requireDraft().selections).some(
      (existing) => existing.uuid === selection.uuid && existing.slotId !== selection.slotId
    );
    if (duplicates) {
      ui.notifications.warn(game.i18n.localize("PF2E-WAYFINDER.Notifications.DuplicateSelections"));
      return;
    }

    const previousSelection = this.#requireDraft().selections[selection.slotId];
    this.#requireDraft().selections[selection.slotId] = selection;
    if (step.slotKind === "ancestry" && previousSelection?.uuid !== selection.uuid) {
      this.#clearDependentAncestrySelections();
    }
    this.#previewValueByStepId.set(stepId, rawValue);
    this.#moveStep(1);
  }

  #clearDependentAncestrySelections(): void {
    delete this.#requireDraft().selections["heritage-level-1"];
    this.#previewValueByStepId.delete("heritage-level-1");

    for (const slotId of Object.keys(this.#requireDraft().selections)) {
      if (slotId.startsWith("ancestry-feat-level-")) {
        delete this.#requireDraft().selections[slotId];
        this.#previewValueByStepId.delete(slotId);
      }
    }
  }

  async #buildOptionContext(): Promise<{ ancestrySlug: string | null }> {
    return {
      ancestrySlug: await this.#resolveAncestrySlug()
    };
  }

  async #resolveAncestrySlug(): Promise<string | null> {
    const draftSelection = Object.values(this.#requireDraft().selections).find((selection) => selection.itemType === "ancestry");
    if (draftSelection) {
      const draftDocument = await fetchSelectionDocument(draftSelection);
      const slug = this.#extractSlug(draftDocument);
      if (slug) {
        return slug;
      }
    }

    const ancestryItem = this.#findActorItemByType("ancestry");
    if (!ancestryItem) {
      return null;
    }

    const sourceId = ancestryItem?.flags?.core?.sourceId;
    if (typeof sourceId === "string" && sourceId.startsWith("Compendium.")) {
      const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(sourceId);
      const packId = match?.[1];
      const documentId = match?.[2];
      if (packId && documentId) {
        const sourceDocument = await fetchSelectionDocument({
          slotId: "ancestry-level-1",
          packId,
          documentId,
          uuid: sourceId,
          itemType: "ancestry",
          featType: null,
          name: ancestryItem.name ?? "",
          level: null
        });
        const sourceSlug = this.#extractSlug(sourceDocument);
        if (sourceSlug) {
          return sourceSlug;
        }
      }
    }

    return this.#extractSlug(ancestryItem);
  }

  #findActorItemByType(type: string): any | null {
    const items = Array.isArray(this.actor?.items?.contents)
      ? this.actor.items.contents
      : Array.isArray(this.actor?.items)
        ? this.actor.items
        : [];
    return items.find((item: any) => item?.type === type) ?? null;
  }

  #extractSlug(document: any): string | null {
    const systemSlug = document?.system?.slug;
    if (typeof systemSlug === "string" && systemSlug.trim()) {
      return systemSlug.trim();
    }

    const ancestrySlug = document?.system?.ancestry?.slug;
    if (typeof ancestrySlug === "string" && ancestrySlug.trim()) {
      return ancestrySlug.trim();
    }

    const name = typeof document?.name === "string" ? document.name.trim() : "";
    if (!name) {
      return null;
    }

    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || null;
  }

  #moveStep(delta: number): void {
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

  #isStepComplete(step: PendingStep): boolean {
    const draft = this.#requireDraft();
    return step.kind === "manual" ? draft.manual[step.slotId] === true : !!draft.selections[step.slotId];
  }

  #stepStatus(step: PendingStep): string {
    const draft = this.#requireDraft();
    if (step.kind === "manual") {
      return draft.manual[step.slotId] === true ? "Ready to apply" : "Needs manual review";
    }

    return draft.selections[step.slotId]?.name ?? "Choose one";
  }

  async #adjustTargetLevel(delta: number): Promise<void> {
    const snapshot = inspectActor(this.actor);
    const draft = this.#requireDraft();
    draft.targetLevel = Math.min(20, Math.max(snapshot.level, draft.targetLevel + delta));
    await this.#saveDraft(false);
    this.render(false);
  }

  async #saveDraft(notify = true): Promise<void> {
    await this.actor.update({
      [DRAFT_FLAG]: buildDraftPatch(this.#requireDraft())
    });

    if (notify) {
      ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.SavedDraft"));
    }
  }

  async #applyDraft(): Promise<void> {
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

  async #clearDraft(): Promise<void> {
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

  #formatSlug(value: unknown): string {
    if (typeof value !== "string" || value.length === 0) {
      return "";
    }
    return value
      .split(/[-_ ]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  #formatBoosts(boosts: any): string {
    if (!boosts || typeof boosts !== "object") {
      return "";
    }
    return Object.values(boosts)
      .flatMap((entry: any) => Array.isArray(entry?.value) ? entry.value : [])
      .map((value: string) => value.toUpperCase())
      .join(", ");
  }

  #formatFlaws(flaws: any): string {
    if (!flaws || typeof flaws !== "object") {
      return "";
    }
    return Object.values(flaws)
      .flatMap((entry: any) => Array.isArray(entry?.value) ? entry.value : [])
      .map((value: string) => value.toUpperCase())
      .join(", ");
  }

  #formatSavingThrows(saves: any): string {
    if (!saves || typeof saves !== "object") {
      return "";
    }
    return [
      saves.fortitude ? `Fort ${this.#rankLabel(saves.fortitude)}` : null,
      saves.reflex ? `Ref ${this.#rankLabel(saves.reflex)}` : null,
      saves.will ? `Will ${this.#rankLabel(saves.will)}` : null
    ].filter(Boolean).join(" • ");
  }

  #rankLabel(rank: unknown): string {
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

  #formatActions(system: any): string {
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

function row(label: string, value: unknown): DetailRow | null {
  if (value === null || value === undefined) {
    return null;
  }
  const rendered = String(value).trim();
  return rendered ? { label, value: rendered } : null;
}
