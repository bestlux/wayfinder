import { ABILITY_KEYS, DRAFT_FLAG, MODULE_ID, MODULE_TITLE, STATE_FLAG } from "./constants.js";
import { inspectActor } from "./actor-inspector.js";
import { applyDraftToActor } from "./actor-updater.js";
import { BOOST_LEVELS, getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "./build-state.js";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft } from "./draft-service.js";
import { fetchSelectionDocument, getOptionsForStep, getPickerInfoState, resolveSelection } from "./pack-service.js";
import { canUseWayfinder } from "./permissions.js";
import { buildProgressionPlan } from "./progression.js";
import type { AbilityKey, BoostLevel, DraftState, OptionContext, OptionRecord, PendingStep, PickerInfoState, SelectionRef, StepKind } from "./types.js";
import type { EffectiveBuildState } from "./build-state.js";

interface StepNavRow {
  id: string;
  index: number;
  level: number;
  title: string;
  active: boolean;
  complete: boolean;
  invalidated: boolean;
  modeLabel: string;
  status: string;
  firstInLevel: boolean;
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
  isBoost: false;
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
  contextNote: string | null;
  infoState: PickerInfoState | null;
  options: Array<OptionRecord & { selected: boolean; previewing: boolean; sourceLabel: string }>;
  preview: PreviewPane | null;
}

interface ManualStepPane {
  kind: "manual";
  isPickItem: false;
  isManual: true;
  isBoost: false;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  completed: boolean;
  selectedLabel: string;
}

interface BoostAttributeButton {
  attribute: AbilityKey;
  label: string;
  selected: boolean;
  disabled: boolean;
  partial?: boolean;
}

interface VoluntaryFlawButton {
  attribute: AbilityKey;
  label: string;
  flawSelected: boolean;
  flawDisabled: boolean;
  secondFlawSelected: boolean;
  secondFlawDisabled: boolean;
  showSecondFlaw: boolean;
  boostSelected: boolean;
  boostDisabled: boolean;
  showBoost: boolean;
}

interface BoostAbilitySummary {
  attribute: AbilityKey;
  label: string;
  modifierLabel: string;
  partial: boolean;
}

interface BoostStepPane {
  kind: "boost";
  isPickItem: false;
  isManual: false;
  isBoost: true;
  stepId: string;
  slotId: string;
  level: number;
  modeLabel: string;
  title: string;
  description: string;
  blocked: boolean;
  blockedTitle: string | null;
  blockedMessage: string | null;
  completed: boolean;
  selectedLabel: string;
  abilitySummary: BoostAbilitySummary[];
  ancestrySection: null | {
    mode: "standard" | "alternate";
    canToggleAlternate: boolean;
    remaining: number;
    buttons: BoostAttributeButton[];
  };
  voluntarySection: null | {
    enabled: boolean;
    legacy: boolean;
    buttons: VoluntaryFlawButton[];
  };
  backgroundSection: null | {
    remaining: number;
    buttons: BoostAttributeButton[];
  };
  classSection: null | {
    options: BoostAttributeButton[];
  };
  levelSection: {
    level: BoostLevel;
    remaining: number;
    buttons: BoostAttributeButton[];
  };
}

type ActivePane = PickStepPane | ManualStepPane | BoostStepPane | null;

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
  #listScrollByStepId = new Map<string, number>();
  #pendingSearchFocus: { stepId: string; cursor: number } | null = null;
  #recentlyInvalidatedStepIds = new Set<string>();
  #statusNote: string | null = null;

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
    const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
    const activeStep = await this.#resolveActiveStep(plan.steps, effectiveBuildState);
    const activePane = activeStep ? await this.#buildActivePane(activeStep, effectiveBuildState) : null;
    const activeStepIndex = activeStep ? plan.steps.findIndex((step) => step.id === activeStep.id) : -1;
    const [effectiveAncestry, effectiveHeritage, effectiveBackground, effectiveClass] = await Promise.all([
      getEffectiveSingletonDocument(this.actor, draft, "ancestry"),
      getEffectiveSingletonDocument(this.actor, draft, "heritage"),
      getEffectiveSingletonDocument(this.actor, draft, "background"),
      getEffectiveSingletonDocument(this.actor, draft, "class")
    ]);
    const summary: SummaryItem[] = [
      {
        label: "Ancestry",
        value: effectiveAncestry?.name ?? "Missing",
        complete: !!effectiveAncestry
      },
      {
        label: "Heritage",
        value: effectiveHeritage?.name ?? "Missing",
        complete: !!effectiveHeritage
      },
      {
        label: "Background",
        value: effectiveBackground?.name ?? "Missing",
        complete: !!effectiveBackground
      },
      {
        label: "Class",
        value: effectiveClass?.name ?? "Missing",
        complete: !!effectiveClass
      }
    ];
    const dossierLine = summary
      .filter((item) => item.complete)
      .map((item) => item.value)
      .filter(Boolean)
      .join(" • ") || "Creation path in progress";
    const stepStateRows = await Promise.all(plan.steps.map(async (step, index): Promise<StepNavRow> => ({
      id: step.id,
      index: index + 1,
      level: step.level,
      title: step.title,
      active: step.id === activeStep?.id,
      complete: await this.#isStepComplete(step, effectiveBuildState),
      invalidated: this.#recentlyInvalidatedStepIds.has(step.slotId) && !await this.#isStepComplete(step, effectiveBuildState),
      modeLabel: this.#modeLabel(step.kind),
      status: await this.#stepStatus(step, effectiveBuildState),
      firstInLevel: index === 0 || plan.steps[index - 1].level !== step.level
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

    for (const list of root.querySelectorAll<HTMLElement>("[data-wayfinder-option-list]")) {
      const stepId = list.dataset.stepId;
      if (!stepId) {
        continue;
      }

      const previousScrollTop = this.#listScrollByStepId.get(stepId);
      if (typeof previousScrollTop === "number") {
        list.scrollTop = previousScrollTop;
      }

      list.addEventListener("scroll", this.#onOptionListScroll, { passive: true });
    }

    const manual = root.querySelector<HTMLInputElement>("[data-wayfinder-manual]");
    if (manual) {
      manual.addEventListener("change", this.#onManualChange);
    }

    if (this.#pendingSearchFocus) {
      const { stepId, cursor } = this.#pendingSearchFocus;
      const nextSearch = root.querySelector<HTMLInputElement>(`[data-wayfinder-search][data-step-id="${stepId}"]`);
      if (nextSearch) {
        nextSearch.focus();
        const caret = Math.min(cursor, nextSearch.value.length);
        nextSearch.setSelectionRange(caret, caret);
      }
      this.#pendingSearchFocus = null;
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
    this.#rememberInteractiveState();

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
        if (target.dataset.section && target.dataset.attribute && target.dataset.stepId) {
          this.#toggleBoostChoice(target.dataset.stepId, target.dataset.section, target.dataset.attribute as AbilityKey);
        }
        break;
      case "toggle-voluntary-choice":
        if (target.dataset.attribute && target.dataset.choiceKind && target.dataset.stepId) {
          this.#toggleVoluntaryChoice(
            target.dataset.stepId,
            target.dataset.attribute as AbilityKey,
            target.dataset.choiceKind as "flaw" | "second-flaw" | "boost"
          );
        }
        break;
      case "clear-option":
        if (target.dataset.stepId) {
          this.#statusNote = null;
          this.#clearSelection(target.dataset.stepId);
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

    this.#rememberInteractiveState(input);
    this.#searchByStepId.set(stepId, input.value);
    this.render(false);
  };

  #onOptionListScroll = (event: Event): void => {
    const list = event.currentTarget as HTMLElement | null;
    const stepId = list?.dataset.stepId;
    if (!stepId || !list) {
      return;
    }

    this.#listScrollByStepId.set(stepId, list.scrollTop);
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

  async #resolveActiveStep(steps: PendingStep[], effectiveBuildState: EffectiveBuildState): Promise<PendingStep | null> {
    if (steps.length === 0) {
      this.#activeStepId = null;
      return null;
    }

    const explicit = steps.find((step) => step.id === this.#activeStepId);
    if (explicit) {
      return explicit;
    }

    let nextIncomplete: PendingStep | null = null;
    for (const step of steps) {
      if (!await this.#isStepComplete(step, effectiveBuildState)) {
        nextIncomplete = step;
        break;
      }
    }
    nextIncomplete ??= steps[0];
    this.#activeStepId = nextIncomplete.id;
    return nextIncomplete;
  }

  async #buildActivePane(step: PendingStep, effectiveBuildState: EffectiveBuildState): Promise<ActivePane> {
    if (step.kind === "manual") {
      return {
        kind: "manual",
        isPickItem: false,
        isManual: true,
        isBoost: false,
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel: "Manual",
        title: step.title,
        description: step.description,
        completed: this.#requireDraft().manual[step.slotId] === true,
        selectedLabel: await this.#stepStatus(step, effectiveBuildState)
      };
    }

    if (step.kind === "boost") {
      return this.#buildBoostPane(step, effectiveBuildState);
    }

    const optionContext = await this.#buildOptionContext();
    const options = await getOptionsForStep(step, optionContext);
    const search = this.#searchByStepId.get(step.id) ?? "";
    const filteredOptions = options.filter((option) => this.#matchesSearch(option, search));
    const infoState = getPickerInfoState(step, optionContext, options.length, filteredOptions.length, search);
    const visibleOptions = infoState?.tone === "blocked" ? [] : filteredOptions;
    const contextNote = await this.#buildContextNote(step, optionContext);
    const selectedValue = this.#selectedValueFor(step);
    const previewValue = this.#resolvePreviewValue(step.id, visibleOptions, options, selectedValue);
    const preview = previewValue
      ? await this.#buildPreview(options.find((option) => option.value === previewValue) ?? null, selectedValue)
      : null;

    return {
      kind: "pick-item",
      isPickItem: true,
      isManual: false,
      isBoost: false,
      stepId: step.id,
      slotId: step.slotId,
      level: step.level,
      modeLabel: "Selection",
      title: step.title,
      description: step.description,
      search,
      selectedValue,
      selectedLabel: this.#requireDraft().selections[step.slotId]?.name ?? null,
      resultCount: visibleOptions.length,
      contextNote,
      infoState,
      options: visibleOptions.map((option) => ({
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
    this.#statusNote = null;
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
    this.#recentlyInvalidatedStepIds.delete(selection.slotId);

    if (step.slotKind === "ancestry" && previousSelection?.uuid !== selection.uuid) {
      const invalidated = this.#invalidateDependentAncestrySelections();
      const boostReset = this.#resetAncestryBoostDraft();
      if (boostReset) {
        this.#recentlyInvalidatedStepIds.add("ability-boosts-level-1");
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
        const invalidated = this.#invalidateSelectionsByPrefix("ancestry-feat-level-");
        if (invalidated.length > 0) {
          this.#statusNote = "Heritage changed. Wayfinder marked ancestry-feat draft picks for review.";
        }
      }
    }

    if (step.slotKind === "background" && previousSelection?.uuid !== selection.uuid) {
      const boostReset = this.#resetBackgroundBoostDraft();
      if (boostReset) {
        this.#recentlyInvalidatedStepIds.add("ability-boosts-level-1");
        this.#statusNote = "Background changed. Wayfinder cleared background boost draft choices for review.";
      }
    }

    if (step.slotKind === "class" && previousSelection?.uuid !== selection.uuid) {
      const previousClassSlug = await this.#resolveSelectionSlug(previousSelection);
      const nextClassSlug = await this.#resolveSelectionSlug(selection);
      const boostReset = this.#resetClassBoostDraft();
      if (boostReset) {
        this.#recentlyInvalidatedStepIds.add("ability-boosts-level-1");
      }
      if (previousClassSlug !== nextClassSlug) {
        const invalidated = this.#invalidateSelectionsByPrefix("class-feat-level-");
        if (invalidated.length > 0 || boostReset) {
          this.#statusNote = boostReset
            ? "Class changed. Wayfinder cleared the key-ability draft choice and marked drafted class feats for review."
            : "Class changed. Wayfinder marked drafted class feats for review.";
        }
      } else if (boostReset) {
        this.#statusNote = "Class changed. Wayfinder cleared the key-ability draft choice for review.";
      }
    }

    this.#previewValueByStepId.set(stepId, rawValue);
    this.#moveStep(1);
  }

  #invalidateDependentAncestrySelections(): string[] {
    return [
      ...this.#invalidateSelection("heritage-level-1"),
      ...this.#invalidateSelectionsByPrefix("ancestry-feat-level-")
    ];
  }

  #rememberInteractiveState(searchInput?: HTMLInputElement | null): void {
    const root = this.element;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    for (const list of root.querySelectorAll<HTMLElement>("[data-wayfinder-option-list]")) {
      const stepId = list.dataset.stepId;
      if (!stepId) {
        continue;
      }
      this.#listScrollByStepId.set(stepId, list.scrollTop);
    }

    const activeSearch = searchInput ?? root.querySelector<HTMLInputElement>("[data-wayfinder-search]:focus");
    const stepId = activeSearch?.dataset.stepId;
    if (!activeSearch || !stepId) {
      this.#pendingSearchFocus = null;
      return;
    }

    this.#pendingSearchFocus = {
      stepId,
      cursor: activeSearch.selectionStart ?? activeSearch.value.length
    };
  }

  async #buildOptionContext(): Promise<OptionContext> {
    const [ancestryDocument, heritageDocument, classDocument, hasDedicationFeat] = await Promise.all([
      this.#resolveDraftOrActorDocument("ancestry"),
      this.#resolveDraftOrActorDocument("heritage"),
      this.#resolveDraftOrActorDocument("class"),
      this.#hasDedicationFeatInContext()
    ]);

    const ancestrySlug = this.#extractSlug(ancestryDocument);
    return {
      ancestrySlug,
      ancestryTraits: this.#extractContextTraits(ancestryDocument, ancestrySlug),
      heritageTraits: this.#extractContextTraits(heritageDocument),
      classSlug: this.#extractSlug(classDocument),
      hasDedicationFeat
    };
  }

  async #buildContextNote(step: PendingStep, context: OptionContext): Promise<string | null> {
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
      case "skill-feat":
        return "Showing baseline skill feats. Archetype-tagged skill feats stay hidden until Wayfinder tracks a specific archetype path.";
      case "general-feat":
        return "Showing the full general-feat pool from the enabled compendia. Wayfinder does not narrow this step by ancestry or class draft.";
      default:
        return null;
    }
  }

  async #buildBoostPane(step: PendingStep, effectiveBuildState: EffectiveBuildState): Promise<BoostStepPane> {
    const isCreationStep = step.level === 1;
    const blocked = isCreationStep && (!effectiveBuildState.ancestry || !effectiveBuildState.background || !effectiveBuildState.class);
    const abilitySummary = Object.values(effectiveBuildState.projectedAbilities).map((entry) => ({
      attribute: entry.key,
      label: this.#abilityLabel(entry.key),
      modifierLabel: `${entry.modifier >= 0 ? "+" : ""}${entry.modifier}`,
      partial: entry.partial
    }));
    const ancestrySection = isCreationStep && effectiveBuildState.ancestry
      ? this.#buildAncestryBoostSection(effectiveBuildState)
      : null;
    const voluntarySection = isCreationStep && effectiveBuildState.ancestry
      ? this.#buildVoluntaryFlawSection(effectiveBuildState)
      : null;
    const backgroundSection = isCreationStep && effectiveBuildState.background
      ? this.#buildBackgroundBoostSection(effectiveBuildState)
      : null;
    const classSection = isCreationStep && effectiveBuildState.class
      ? this.#buildClassBoostSection(effectiveBuildState)
      : null;
    const levelSection = this.#buildLevelBoostSection(step.level as BoostLevel, effectiveBuildState);

    return {
      kind: "boost",
      isPickItem: false,
      isManual: false,
      isBoost: true,
      stepId: step.id,
      slotId: step.slotId,
      level: step.level,
      modeLabel: "Boosts",
      title: step.title,
      description: step.description,
      blocked,
      blockedTitle: blocked ? "Choose ancestry, background, and class first" : null,
      blockedMessage: blocked ? "Wayfinder needs the drafted ancestry, background, and class before it can offer a legal creation-boost layout." : null,
      completed: await this.#isStepComplete(step, effectiveBuildState),
      selectedLabel: await this.#stepStatus(step, effectiveBuildState),
      abilitySummary,
      ancestrySection,
      voluntarySection,
      backgroundSection,
      classSection,
      levelSection
    };
  }

  #buildAncestryBoostSection(effectiveBuildState: EffectiveBuildState): BoostStepPane["ancestrySection"] {
    const ancestry = effectiveBuildState.ancestry;
    if (!ancestry) {
      return null;
    }

    if (ancestry.mode === "alternate") {
      return {
        mode: "alternate",
        canToggleAlternate: true,
        remaining: Math.max(0, 2 - ancestry.alternateBoosts.length),
        buttons: ABILITY_KEYS.map((attribute) => ({
          attribute,
          label: this.#abilityLabel(attribute),
          selected: ancestry.alternateBoosts.includes(attribute),
          disabled: !ancestry.alternateBoosts.includes(attribute) && ancestry.alternateBoosts.length >= 2
        }))
      };
    }

    const selected = Object.values(ancestry.selectedBoosts).filter((ability): ability is AbilityKey => ability !== null);
    const remaining = this.#requiredBoostSlots(ancestry.document?.system?.boosts) - selected.length;

    return {
      mode: "standard",
      canToggleAlternate: true,
      remaining,
      buttons: ABILITY_KEYS.map((attribute) => ({
        attribute,
        label: this.#abilityLabel(attribute),
        selected: selected.includes(attribute),
        disabled: !selected.includes(attribute) && !this.#canChooseFromSlotRecord(ancestry.document?.system?.boosts, ancestry.selectedBoosts, attribute)
      }))
    };
  }

  #buildVoluntaryFlawSection(effectiveBuildState: EffectiveBuildState): BoostStepPane["voluntarySection"] {
    const ancestry = effectiveBuildState.ancestry;
    if (!ancestry) {
      return null;
    }

    const netBoosted = ancestry.buildBoosts.filter((attribute) => !ancestry.buildFlaws.includes(attribute));
    const flawsComplete = ancestry.voluntary.legacy && ancestry.voluntary.flaws.length >= 2;

    return {
      enabled: ancestry.voluntary.enabled,
      legacy: ancestry.voluntary.legacy,
      buttons: ABILITY_KEYS.map((attribute) => {
        const numFlaws = ancestry.voluntary.flaws.filter((entry) => entry === attribute).length;
        const flawSelected = numFlaws > 0;
        const showSecondFlaw = ancestry.voluntary.legacy && ancestry.lockedBoosts.includes(attribute);
        const boostSelected = ancestry.voluntary.boost === attribute;

        return {
          attribute,
          label: this.#abilityLabel(attribute),
          flawSelected,
          flawDisabled: !ancestry.voluntary.enabled || (!flawSelected && ancestry.voluntary.legacy && flawsComplete),
          secondFlawSelected: numFlaws > 1,
          secondFlawDisabled: !ancestry.voluntary.enabled || !showSecondFlaw || !flawSelected || (numFlaws < 2 && flawsComplete),
          showSecondFlaw,
          boostSelected,
          boostDisabled: !ancestry.voluntary.enabled
            || !ancestry.voluntary.legacy
            || (!boostSelected && (!flawsComplete || !!ancestry.voluntary.boost || netBoosted.includes(attribute))),
          showBoost: ancestry.voluntary.legacy
        };
      })
    };
  }

  #buildBackgroundBoostSection(effectiveBuildState: EffectiveBuildState): BoostStepPane["backgroundSection"] {
    const background = effectiveBuildState.background;
    if (!background) {
      return null;
    }

    const selected = background.buildBoosts;
    const remaining = this.#requiredBoostSlots(background.document?.system?.boosts) - selected.length;
    return {
      remaining,
      buttons: ABILITY_KEYS.map((attribute) => ({
        attribute,
        label: this.#abilityLabel(attribute),
        selected: selected.includes(attribute),
        disabled: !selected.includes(attribute) && !this.#canChooseFromSlotRecord(background.document?.system?.boosts, background.selectedBoosts, attribute)
      }))
    };
  }

  #buildClassBoostSection(effectiveBuildState: EffectiveBuildState): BoostStepPane["classSection"] {
    const classState = effectiveBuildState.class;
    if (!classState) {
      return null;
    }

    return {
      options: classState.keyAbilityOptions.map((attribute) => ({
        attribute,
        label: this.#abilityLabel(attribute),
        selected: classState.selectedKeyAbility === attribute,
        disabled: false
      }))
    };
  }

  #buildLevelBoostSection(level: BoostLevel, effectiveBuildState: EffectiveBuildState): BoostStepPane["levelSection"] {
    const selected = effectiveBuildState.levelBoosts[level];
    const allowed = effectiveBuildState.allowedBoosts[level];
    return {
      level,
      remaining: Math.max(0, allowed - selected.length),
      buttons: ABILITY_KEYS.map((attribute) => ({
        attribute,
        label: this.#abilityLabel(attribute),
        selected: selected.includes(attribute),
        disabled: !selected.includes(attribute) && selected.length >= allowed,
        partial: effectiveBuildState.projectedAbilities[attribute].partial && selected.includes(attribute)
      }))
    };
  }

  async #toggleAncestryMode(): Promise<void> {
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
    } else {
      draft.boosts.ancestry.alternateBoosts = [];
    }
    this.render(false);
  }

  async #toggleVoluntaryEnabled(): Promise<void> {
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

  async #toggleVoluntaryLegacy(): Promise<void> {
    this.#statusNote = null;
    const voluntary = this.#requireDraft().boosts.ancestry.voluntary;
    voluntary.touched = true;
    voluntary.enabled = true;
    voluntary.legacy = !voluntary.legacy;
    if (!voluntary.legacy) {
      voluntary.boost = null;
      voluntary.flaws = Array.from(new Set(voluntary.flaws));
    } else {
      voluntary.flaws = voluntary.flaws.slice(0, 2);
    }
    this.render(false);
  }

  async #toggleBoostChoice(stepId: string, section: string, attribute: AbilityKey): Promise<void> {
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
        } else {
          this.#toggleSlotRecordChoice(draft.boosts.ancestry.selectedBoosts, effectiveBuildState.ancestry.document?.system?.boosts, attribute);
        }
        break;
      case "background":
        if (!effectiveBuildState.background) {
          return;
        }
        this.#toggleSlotRecordChoice(draft.boosts.background.selectedBoosts, effectiveBuildState.background.document?.system?.boosts, attribute);
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
        const selected = draft.boosts.levels[level] ?? [...effectiveBuildState.levelBoosts[Number(level) as BoostLevel]];
        draft.boosts.levels[level] = selected.includes(attribute)
          ? selected.filter((entry) => entry !== attribute)
          : [...selected, attribute].slice(0, effectiveBuildState.allowedBoosts[Number(level) as BoostLevel]);
        break;
      }
    }

    this.#recentlyInvalidatedStepIds.delete(stepId);
    this.render(false);
  }

  async #toggleVoluntaryChoice(stepId: string, attribute: AbilityKey, choiceKind: "flaw" | "second-flaw" | "boost"): Promise<void> {
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
      } else if (!voluntary.legacy || flaws.length < 2) {
        flaws.push(attribute);
      }
    } else if (choiceKind === "second-flaw") {
      if (!voluntary.legacy || !ancestry.lockedBoosts.includes(attribute) || numFlaws === 0) {
        return;
      }

      if (numFlaws > 1) {
        flaws.splice(flaws.lastIndexOf(attribute), 1);
      } else if (flaws.length < 2) {
        flaws.push(attribute);
      }
    } else if (choiceKind === "boost" && voluntary.legacy && flaws.length >= 2) {
      voluntary.boost = voluntary.boost === attribute ? null : attribute;
    }

    voluntary.flaws = flaws;
    this.#recentlyInvalidatedStepIds.delete(stepId);
    this.render(false);
  }

  #toggleSlotRecordChoice(
    selectedBoosts: Record<string, AbilityKey | null>,
    record: Record<string, { value: AbilityKey[]; selected: AbilityKey | null }> | undefined,
    attribute: AbilityKey
  ): void {
    const selectedEntry = Object.entries(selectedBoosts).find(([, value]) => value === attribute);
    if (selectedEntry) {
      selectedBoosts[selectedEntry[0]] = null;
      return;
    }

    const candidate = Object.entries(record ?? {}).find(([slot, boost]) =>
      !selectedBoosts[slot] && Array.isArray(boost?.value) && boost.value.includes(attribute)
    );
    if (candidate) {
      selectedBoosts[candidate[0]] = attribute;
    }
  }

  #requiredBoostSlots(record: Record<string, { value: AbilityKey[]; selected: AbilityKey | null }> | undefined): number {
    return Object.values(record ?? {}).filter((boost) => Array.isArray(boost?.value) && boost.value.length > 0).length;
  }

  #canChooseFromSlotRecord(
    record: Record<string, { value: AbilityKey[]; selected: AbilityKey | null }> | undefined,
    selectedBoosts: Record<string, AbilityKey | null>,
    attribute: AbilityKey
  ): boolean {
    return Object.entries(record ?? {}).some(([slot, boost]) =>
      (!selectedBoosts[slot] || selectedBoosts[slot] === attribute)
      && Array.isArray(boost?.value)
      && boost.value.includes(attribute)
    );
  }

  #abilityLabel(attribute: AbilityKey): string {
    return game.i18n.localize(globalThis.CONFIG?.PF2E?.abilities?.[attribute] ?? attribute.toUpperCase());
  }

  async #resolveDraftOrActorDocument(itemType: "ancestry" | "heritage" | "class"): Promise<any | null> {
    return getEffectiveSingletonDocument(this.actor, this.#requireDraft(), itemType);
  }

  #findDraftSelectionByType(itemType: "ancestry" | "heritage" | "class"): SelectionRef | null {
    return Object.values(this.#requireDraft().selections).find((selection) => selection.itemType === itemType) ?? null;
  }

  async #resolveSourceDocumentFromActorItem(actorItem: any, itemType: "ancestry" | "heritage" | "class"): Promise<any | null> {
    const sourceId = actorItem?.flags?.core?.sourceId;
    if (typeof sourceId !== "string" || !sourceId.startsWith("Compendium.")) {
      return null;
    }

    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(sourceId);
    const packId = match?.[1];
    const documentId = match?.[2];
    if (!packId || !documentId) {
      return null;
    }

    return fetchSelectionDocument({
      slotId: `${itemType}-level-1`,
      packId,
      documentId,
      uuid: sourceId,
      itemType,
      featType: null,
      name: actorItem.name ?? "",
      level: null
    });
  }

  #findActorItemByType(type: string): any | null {
    return listActorItems(this.actor).find((item: any) => item?.type === type) ?? null;
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

  #extractContextTraits(document: any, fallbackSlug?: string | null): string[] {
    const traits = Array.isArray(document?.system?.traits?.value)
      ? document.system.traits.value
      : [];
    const normalized = new Set<string>(
      traits
        .filter((entry: unknown): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    );

    const slug = fallbackSlug ?? this.#extractSlug(document);
    if (slug) {
      normalized.add(slug);
    }

    return Array.from(normalized);
  }

  async #resolveSelectionTraits(selection: SelectionRef | null): Promise<string[]> {
    if (!selection) {
      return [];
    }

    const document = await fetchSelectionDocument(selection);
    return this.#extractContextTraits(document);
  }

  async #resolveSelectionSlug(selection: SelectionRef | null): Promise<string | null> {
    if (!selection) {
      return null;
    }

    const document = await fetchSelectionDocument(selection);
    return this.#extractSlug(document);
  }

  async #hasDedicationFeatInContext(): Promise<boolean> {
    const actorHasDedication = listActorItems(this.actor).some((item: any) =>
      item?.type === "feat" && this.#extractContextTraits(item).includes("dedication")
    );
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

  #clearSelection(slotId: string): number {
    if (!this.#requireDraft().selections[slotId]) {
      this.#recentlyInvalidatedStepIds.delete(slotId);
      return 0;
    }

    delete this.#requireDraft().selections[slotId];
    if (slotId === "ancestry-level-1") {
      this.#resetAncestryBoostDraft();
      this.#recentlyInvalidatedStepIds.add("ability-boosts-level-1");
    } else if (slotId === "background-level-1") {
      this.#resetBackgroundBoostDraft();
      this.#recentlyInvalidatedStepIds.add("ability-boosts-level-1");
    } else if (slotId === "class-level-1") {
      this.#resetClassBoostDraft();
      this.#recentlyInvalidatedStepIds.add("ability-boosts-level-1");
    }
    this.#previewValueByStepId.delete(slotId);
    this.#listScrollByStepId.delete(slotId);
    this.#recentlyInvalidatedStepIds.delete(slotId);
    return 1;
  }

  #clearSelectionsByPrefix(prefix: string): number {
    let cleared = 0;
    for (const slotId of Object.keys(this.#requireDraft().selections)) {
      if (!slotId.startsWith(prefix)) {
        continue;
      }

      cleared += this.#clearSelection(slotId);
    }

    return cleared;
  }

  #invalidateSelection(slotId: string): string[] {
    if (this.#clearSelection(slotId) === 0) {
      return [];
    }

    this.#recentlyInvalidatedStepIds.add(slotId);
    return [slotId];
  }

  #invalidateSelectionsByPrefix(prefix: string): string[] {
    const invalidated: string[] = [];
    for (const slotId of Object.keys(this.#requireDraft().selections)) {
      if (!slotId.startsWith(prefix)) {
        continue;
      }

      invalidated.push(...this.#invalidateSelection(slotId));
    }

    return invalidated;
  }

  #resetAncestryBoostDraft(): boolean {
    const draft = this.#requireDraft().boosts.ancestry;
    const hadValues = draft.mode !== "standard"
      || draft.modeTouched
      || Object.values(draft.selectedBoosts).some((value) => value !== null)
      || draft.alternateBoosts.length > 0
      || draft.voluntary.touched
      || draft.voluntary.enabled
      || draft.voluntary.flaws.length > 0
      || !!draft.voluntary.boost;
    draft.modeTouched = false;
    draft.mode = "standard";
    draft.selectedBoosts = {};
    draft.alternateBoosts = [];
    draft.voluntary = {
      touched: false,
      enabled: false,
      legacy: false,
      boost: null,
      flaws: []
    };
    return hadValues;
  }

  #resetBackgroundBoostDraft(): boolean {
    const draft = this.#requireDraft().boosts.background;
    const hadValues = Object.values(draft.selectedBoosts).some((value) => value !== null);
    draft.selectedBoosts = {};
    return hadValues;
  }

  #resetClassBoostDraft(): boolean {
    const draft = this.#requireDraft().boosts.class;
    const hadValues = !!draft.keyAbility;
    draft.keyAbility = null;
    return hadValues;
  }

  async #isStepComplete(step: PendingStep, effectiveBuildState?: EffectiveBuildState): Promise<boolean> {
    const draft = this.#requireDraft();
    if (step.kind === "manual") {
      return draft.manual[step.slotId] === true;
    }

    if (step.kind === "pick-item") {
      return !!draft.selections[step.slotId];
    }

    const buildState = effectiveBuildState ?? await getEffectiveBuildState(this.actor, draft);
    if (step.level === 1) {
      return !!buildState.ancestry
        && !!buildState.background
        && !!buildState.class
        && this.#isAncestryBoostSectionComplete(buildState)
        && this.#isBackgroundBoostSectionComplete(buildState)
        && this.#isClassBoostSectionComplete(buildState)
        && buildState.levelBoosts[1].length === buildState.allowedBoosts[1];
    }

    const level = step.level as BoostLevel;
    return buildState.levelBoosts[level].length === buildState.allowedBoosts[level];
  }

  async #stepStatus(step: PendingStep, effectiveBuildState?: EffectiveBuildState): Promise<string> {
    const draft = this.#requireDraft();
    if (step.kind === "manual") {
      return draft.manual[step.slotId] === true ? "Ready to apply" : "Needs manual review";
    }

    if (step.kind === "pick-item") {
      if (this.#recentlyInvalidatedStepIds.has(step.slotId) && !draft.selections[step.slotId]) {
        return "Needs attention";
      }

      return draft.selections[step.slotId]?.name ?? "Choose one";
    }

    const buildState = effectiveBuildState ?? await getEffectiveBuildState(this.actor, draft);
    if (this.#recentlyInvalidatedStepIds.has(step.slotId) && !await this.#isStepComplete(step, buildState)) {
      return "Needs attention";
    }

    if (step.level === 1 && (!buildState.ancestry || !buildState.background || !buildState.class)) {
      return "Choose ancestry, background, and class first";
    }

    const remaining = step.level === 1
      ? this.#remainingCreationBoostChoices(buildState)
      : Math.max(0, buildState.allowedBoosts[step.level as BoostLevel] - buildState.levelBoosts[step.level as BoostLevel].length);
    return remaining === 0 ? "Ready to apply" : `${remaining} choice${remaining === 1 ? "" : "s"} remaining`;
  }

  #modeLabel(kind: StepKind): string {
    switch (kind) {
      case "pick-item":
        return "Selection";
      case "boost":
        return "Boosts";
      default:
        return "Manual";
    }
  }

  #isAncestryBoostSectionComplete(buildState: EffectiveBuildState): boolean {
    const ancestry = buildState.ancestry;
    if (!ancestry) {
      return false;
    }

    return ancestry.mode === "alternate"
      ? ancestry.alternateBoosts.length === 2
      : Object.values(ancestry.selectedBoosts).filter((value) => value !== null).length === this.#requiredBoostSlots(ancestry.document?.system?.boosts);
  }

  #isBackgroundBoostSectionComplete(buildState: EffectiveBuildState): boolean {
    const background = buildState.background;
    if (!background) {
      return false;
    }

    return background.buildBoosts.length === this.#requiredBoostSlots(background.document?.system?.boosts);
  }

  #isClassBoostSectionComplete(buildState: EffectiveBuildState): boolean {
    return !!buildState.class?.selectedKeyAbility;
  }

  #remainingCreationBoostChoices(buildState: EffectiveBuildState): number {
    const ancestryRemaining = buildState.ancestry
      ? buildState.ancestry.mode === "alternate"
        ? Math.max(0, 2 - buildState.ancestry.alternateBoosts.length)
        : Math.max(0, this.#requiredBoostSlots(buildState.ancestry.document?.system?.boosts) - Object.values(buildState.ancestry.selectedBoosts).filter((value) => value !== null).length)
      : 1;
    const backgroundRemaining = buildState.background
      ? Math.max(0, this.#requiredBoostSlots(buildState.background.document?.system?.boosts) - buildState.background.buildBoosts.length)
      : 1;
    const classRemaining = buildState.class?.selectedKeyAbility ? 0 : 1;
    const levelRemaining = Math.max(0, buildState.allowedBoosts[1] - buildState.levelBoosts[1].length);
    return ancestryRemaining + backgroundRemaining + classRemaining + levelRemaining;
  }

  async #adjustTargetLevel(delta: number): Promise<void> {
    this.#statusNote = null;
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
    this.#statusNote = null;
    const snapshot = inspectActor(this.actor);
    const draft = this.#requireDraft();
    const plan = buildProgressionPlan(snapshot, draft.targetLevel);
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
        completedStepIds: plan.steps.map((step) => step.id)
      }
    });

    this.#draft = normalizeDraft(null, snapshot.level);
    this.#recentlyInvalidatedStepIds.clear();
    ui.notifications.info(game.i18n.localize("PF2E-WAYFINDER.Notifications.Applied"));
    this.render(false);
  }

  async #clearDraft(): Promise<void> {
    this.#statusNote = null;
    const snapshot = inspectActor(this.actor);
    this.#draft = createEmptyDraft(snapshot.level);
    this.#searchByStepId.clear();
    this.#previewValueByStepId.clear();
    this.#recentlyInvalidatedStepIds.clear();
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

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
