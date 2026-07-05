import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor } from "../actor-updater.js";
import type {
  BuildStateActorItem,
  ResolvedBuildStateDocument,
  SingletonItemType,
} from "../build-state/document-types.js";
import type { EffectiveBuildState } from "../build-state.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { MODULE_ID, MODULE_TITLE } from "../constants.js";
import { createEmptyDraft, normalizeDraft } from "../draft-service.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { getOptionsForStep, resolveSelection } from "../pack/options.js";
import { getPickerInfoState } from "../pack/picker-state.js";
import { canUseWayfinder } from "../permissions.js";
import type { SelectorActorLike } from "../selector-application.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import type { AbilityKey, DraftState, PendingStep, PickerFilterKind } from "../types.js";
import { bindWayfinderInteractions, parseWayfinderAction } from "./actions.js";
import { buildSelectionPane } from "./application/build-selection-pane-service.js";
import { buildSkillPane } from "./application/build-skill-pane-service.js";
import {
  adjustDraftTargetLevel,
  type DraftAdjustmentState,
  setManualStepComplete,
  setTrainingLoreSelection,
  setTrainingRuleSelection,
  syncLanguageChoiceSelections,
  syncSkillTrainingSelections,
  toggleAncestryMode,
  toggleBoostChoice,
  toggleSkillIncreaseSelection,
  toggleTrainingSkillSelection,
  toggleVoluntaryChoice,
  toggleVoluntaryEnabled,
  toggleVoluntaryLegacy,
} from "./application/draft-adjustment-service.js";
import {
  type ApplyDraftLifecycleResult,
  applyDraftLifecycle,
  buildSaveDraftUpdate,
  createClearedDraftResult,
} from "./application/draft-lifecycle-service.js";
import {
  buildContextNote,
  buildOptionContext,
  resolveSelectionSlug,
  resolveSelectionTraits,
} from "./application/option-context-service.js";
import {
  chooseSelectionOption,
  type SelectionCommandResult,
  type SelectionCommandState,
  selectClassChoiceValue,
  selectSingletonChoiceValue,
  toggleLanguageChoiceValue,
  toggleSpellChoiceSelection,
} from "./application/selection-command-service.js";
import { createSelectionInvalidationService } from "./application/selection-invalidation-service.js";
import { buildWayfinderContext, type WayfinderTemplateContext } from "./application/wayfinder-context-service.js";
import { buildWayfinderAppPlan, findPlanStepBySlotId } from "./application/wayfinder-plan-builder-service.js";
import { hasDuplicateDraftSelection } from "./draft-decisions.js";
import { buildBoostPane } from "./panes/boost-pane.js";
import { buildPreview, matchesSearch } from "./panes/pick-pane.js";
import { emptyPickerFilterState, togglePickerFilterValue } from "./panes/picker-filters.js";
import { getWayfinderStepStatus, isWayfinderStepComplete, resolveActiveStep } from "./plan-service.js";
import { isWizardArcaneSchoolSlotId } from "./slot-ids.js";
import type { ActivePane, ManualStepPane } from "./view-models.js";

interface Pf2eConfigLike {
  abilities?: Record<string, string>;
  skills?: Record<string, unknown>;
}

interface WayfinderActorLike extends SelectorActorLike {
  id: string;
  name: string;
  apps: Record<string, unknown>;
  getFlag: (scope: string, key: string) => unknown;
  update: (updates: Record<string, unknown>) => Promise<unknown>;
}

interface ArcaneSchoolDocumentLike {
  type?: unknown;
  system?: Record<string, unknown> & {
    category?: unknown;
    traits?: {
      otherTags?: unknown;
    };
  };
}

type FetchedSelectionDocument = NonNullable<Awaited<ReturnType<typeof fetchSelectionDocument>>>;
type ArcaneSchoolActorItemLike = BuildStateActorItem & ArcaneSchoolDocumentLike;
type ArcaneSchoolSourceLike = FetchedSelectionDocument | ArcaneSchoolActorItemLike;
type WayfinderGlobals = typeof globalThis & {
  CONFIG?: {
    PF2E?: Pf2eConfigLike;
  };
};

interface DialogV2Like {
  confirm: (config: {
    content: string;
    modal?: boolean;
    window?: { title: string };
    yes?: { default?: boolean; icon?: string; label: string };
    no?: { default?: boolean; icon?: string; label: string };
  }) => Promise<unknown>;
}

interface FoundryDialogApiLike {
  applications?: {
    api?: {
      DialogV2?: DialogV2Like;
    };
  };
  utils?: {
    escapeHTML?: (value: string) => string;
  };
}

export class WayfinderApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
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
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/wayfinder-app.hbs`,
      root: true,
    },
  };

  actor: WayfinderActorLike;
  #draft: DraftState | null = null;
  #activeStepId: string | null = null;
  #searchByStepId = new Map<string, string>();
  #pickerFiltersByStepId = new Map<string, { rarity: string[]; source: string[] }>();
  #openPickerFilterMenu: { stepId: string; filterKind: PickerFilterKind } | null = null;
  #previewValueByStepId = new Map<string, string>();
  #scrollById = new Map<string, number>();
  #pendingSearchFocus: { stepId: string; cursor: number } | null = null;
  #recentlyInvalidatedStepIds = new Set<string>();
  #statusNote: string | null = null;

  static open(actor: WayfinderActorLike): void {
    if (!canUseWayfinder(actor)) {
      ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.OwnerOnly"));
      return;
    }

    const existing = Object.values(actor.apps).find((app): app is WayfinderApp => app instanceof WayfinderApp);
    if (existing) {
      existing.render(true);
      return;
    }

    new WayfinderApp({ actor }).render(true);
  }

  constructor(options: { actor: WayfinderActorLike }) {
    super({
      uniqueId: `${MODULE_ID}-${options.actor.id}`,
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

  async _prepareContext(): Promise<WayfinderTemplateContext> {
    const snapshot = inspectActor(this.actor);
    const draft = this.#ensureDraft(snapshot.level);
    const plan = await this.#buildPlan(snapshot, draft);
    const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
    const activeStep = await this.#resolveActiveStep(plan.steps, effectiveBuildState);
    const activePane = activeStep ? await this.#buildActivePane(activeStep, effectiveBuildState, plan.steps) : null;
    const [effectiveAncestry, effectiveHeritage, effectiveBackground, effectiveClass, effectiveDeity] =
      await Promise.all([
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

  async _onRender(context: unknown, options: unknown): Promise<void> {
    await super._onRender(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    this.#pendingSearchFocus = bindWayfinderInteractions(
      root,
      {
        onActionClick: this.#onActionClick,
        onSearchInput: this.#onSearchInput,
        onScrollableScroll: this.#onScrollableScroll,
        onManualChange: this.#onManualChange,
        onLoreInputChange: this.#onLoreInputChange,
      },
      this.#scrollById,
      this.#pendingSearchFocus
    ).pendingSearchFocus;
  }

  _tearDown(options: unknown): void {
    super._tearDown(options);
    delete this.actor.apps[this.id];
  }

  #onActionClick = async (event: Event): Promise<void> => {
    const target = event.currentTarget as HTMLElement | null;
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

  #onSearchInput = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    if (!stepId) {
      return;
    }

    this.#rememberInteractiveState(input);
    this.#openPickerFilterMenu = null;
    this.#searchByStepId.set(stepId, input.value);
    this.render(false);
  };

  #onScrollableScroll = (event: Event): void => {
    const scrollable = event.currentTarget as HTMLElement | null;
    const scrollId = scrollable?.dataset.wayfinderScrollId;
    if (!scrollId || !scrollable) {
      return;
    }

    this.#scrollById.set(scrollId, scrollable.scrollTop);
  };

  #onManualChange = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    if (!stepId) {
      return;
    }

    this.#statusNote = null;
    this.#openPickerFilterMenu = null;
    if (setManualStepComplete(this.#draftAdjustmentState(), stepId, input.checked)) {
      this.render(false);
    }
  };

  #onLoreInputChange = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    const key = input?.dataset.key;
    if (!stepId || !key) {
      return;
    }

    await this.#setTrainingLore(stepId, key, input.value);
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

  async #findPlanStepBySlotId(slotId: string, snapshot = inspectActor(this.actor), draft = this.#requireDraft()) {
    return findPlanStepBySlotId(
      {
        actor: this.actor,
        snapshot,
        draft,
        resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
        resolveArcaneSchoolDocument: () => this.#resolveDraftOrActorArcaneSchoolDocument(),
        localize: (value) => game.i18n.localize(value),
      },
      slotId
    );
  }

  async #resolveActiveStep(
    steps: PendingStep[],
    effectiveBuildState: EffectiveBuildState
  ): Promise<PendingStep | null> {
    const resolved = await resolveActiveStep(steps, this.#activeStepId, (step) =>
      this.#isStepComplete(step, effectiveBuildState)
    );
    this.#activeStepId = resolved.activeStepId;
    return resolved.activeStep;
  }

  async #buildActivePane(
    step: PendingStep,
    effectiveBuildState: EffectiveBuildState,
    planSteps: PendingStep[]
  ): Promise<ActivePane> {
    if (step.kind === "manual") {
      const pane: ManualStepPane = {
        kind: "manual",
        isPickItem: false,
        isManual: true,
        isBoost: false,
        isSkillIncrease: false,
        isSkillTraining: false,
        isSingletonChoice: false,
        isLanguageChoice: false,
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
      pickerFiltersByStepId: this.#pickerFiltersByStepId,
      openPickerFilterMenu: this.#openPickerFilterMenu,
      previewValueByStepId: this.#previewValueByStepId,
      resolveOptionContext: () =>
        buildOptionContext({
          draft: this.#requireDraft(),
          steps: planSteps,
          skillRanks: inspectActor(this.actor).skillRanks,
          resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
          listActorItems: () => listActorItems(this.actor),
          fetchSelectionDocument,
          extractDocumentSlug,
        }),
      resolveDeityDocument: () => this.#resolveDraftOrActorDocument("deity"),
      buildContextNote: (paneStep, context) =>
        buildContextNote(paneStep, context, {
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

  async #chooseOption(stepId: string, rawValue: string): Promise<void> {
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
          skillRanks: snapshot.skillRanks,
          resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
          listActorItems: () => listActorItems(this.actor),
          fetchSelectionDocument,
          extractDocumentSlug,
        });
        return resolveSelection(value, selectionStep, optionContext);
      },
      hasDuplicateDraftSelection: (selection) => hasDuplicateDraftSelection(draft, selection),
      resolveSelectionTraits: (selection) =>
        resolveSelectionTraits(selection, {
          fetchSelectionDocument,
          extractDocumentSlug,
        }),
      resolveSelectionSlug: (selection) =>
        resolveSelectionSlug(selection, {
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
      invalidateClassChoicesByDependency: invalidation.invalidateClassChoicesByDependency,
      invalidateBranchSelectionsByDependency: invalidation.invalidateBranchSelectionsByDependency,
      invalidateSpellChoicesByDependency: invalidation.invalidateSpellChoicesByDependency,
      resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
      resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
      resetClassBoostDraft: () => this.#resetClassBoostDraft(),
    });
    await this.#finalizeSelectionCommand(result);
  }

  #rememberInteractiveState(searchInput?: HTMLInputElement | null): void {
    const root = this.element;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    for (const scrollable of root.querySelectorAll<HTMLElement>("[data-wayfinder-scroll-id]")) {
      const scrollId = scrollable.dataset.wayfinderScrollId;
      if (!scrollId) {
        continue;
      }
      this.#scrollById.set(scrollId, scrollable.scrollTop);
    }

    const activeSearch = searchInput ?? root.querySelector<HTMLInputElement>("[data-wayfinder-search]:focus");
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

  #selectSkillIncrease(stepId: string, slug: string): void {
    this.#statusNote = null;
    if (toggleSkillIncreaseSelection(this.#draftAdjustmentState(), stepId, slug)) {
      this.render(false);
    }
  }

  async #selectTrainingRule(stepId: string, key: string, slug: string): Promise<void> {
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

  async #invalidateGrantChoicesForTrainingRule(step: PendingStep | null, key: string): Promise<string[]> {
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

  async #setTrainingLore(stepId: string, key: string, value: string): Promise<void> {
    this.#statusNote = null;
    const step = await this.#findPlanStepBySlotId(stepId);
    if (setTrainingLoreSelection(this.#draftAdjustmentState(), step ?? null, key, value)) {
      this.render(false);
    }
  }

  async #selectSingletonChoice(stepId: string, value: string): Promise<void> {
    this.#statusNote = null;
    const step = await this.#findPlanStepBySlotId(stepId);
    const result = await selectSingletonChoiceValue(this.#selectionCommandState(), step ?? null, value, {
      buildPlan: () => this.#buildPlan(),
    });
    await this.#finalizeSelectionCommand(result);
  }

  async #toggleLanguageChoice(stepId: string, value: string): Promise<void> {
    this.#statusNote = null;
    const step = await this.#findPlanStepBySlotId(stepId);
    const result = await toggleLanguageChoiceValue(this.#selectionCommandState(), step ?? null, value);
    await this.#finalizeSelectionCommand(result);
  }

  async #selectClassChoice(stepId: string, value: string): Promise<void> {
    this.#statusNote = null;
    const invalidation = this.#selectionInvalidationService();
    const step = await this.#findPlanStepBySlotId(stepId);
    const result = await selectClassChoiceValue(this.#selectionCommandState(), step ?? null, value, {
      invalidateSelectionsByPrefix: invalidation.invalidateSelectionsByPrefix,
      invalidateBranchSelectionsByDependency: invalidation.invalidateBranchSelectionsByDependency,
      invalidateGrantSelectionsBySource: invalidation.invalidateGrantSelectionsBySource,
      invalidateFlagChoicesBySource: invalidation.invalidateFlagChoicesBySource,
      invalidateSpellChoicesByDependency: invalidation.invalidateSpellChoicesByDependency,
    });
    await this.#finalizeSelectionCommand(result);
  }

  async #toggleSpellChoice(stepId: string, rawValue: string): Promise<void> {
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
          skillRanks: snapshot.skillRanks,
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

  async #toggleTrainingSkill(stepId: string, slug: string): Promise<void> {
    this.#statusNote = null;
    const step = await this.#findPlanStepBySlotId(stepId);
    if (toggleTrainingSkillSelection(this.#draftAdjustmentState(), step ?? null, slug)) {
      this.render(false);
    }
  }

  async #toggleAncestryMode(): Promise<void> {
    const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
    this.#statusNote = null;
    if (toggleAncestryMode(this.#draftAdjustmentState(), effectiveBuildState.ancestry?.mode ?? null)) {
      await this.#syncDependentChoicesAfterBuildChange();
      this.render(false);
    }
  }

  async #toggleVoluntaryEnabled(): Promise<void> {
    this.#statusNote = null;
    if (toggleVoluntaryEnabled(this.#draftAdjustmentState())) {
      await this.#syncDependentChoicesAfterBuildChange();
      this.render(false);
    }
  }

  async #toggleVoluntaryLegacy(): Promise<void> {
    this.#statusNote = null;
    if (toggleVoluntaryLegacy(this.#draftAdjustmentState())) {
      await this.#syncDependentChoicesAfterBuildChange();
      this.render(false);
    }
  }

  async #toggleBoostChoice(stepId: string, section: string, attribute: AbilityKey): Promise<void> {
    this.#statusNote = null;
    const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
    if (toggleBoostChoice(this.#draftAdjustmentState(), effectiveBuildState, stepId, section, attribute)) {
      await this.#syncDependentChoicesAfterBuildChange();
      this.render(false);
    }
  }

  async #toggleVoluntaryChoice(
    stepId: string,
    attribute: AbilityKey,
    choiceKind: "flaw" | "second-flaw" | "boost"
  ): Promise<void> {
    this.#statusNote = null;
    const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
    if (
      toggleVoluntaryChoice(this.#draftAdjustmentState(), effectiveBuildState.ancestry, stepId, attribute, choiceKind)
    ) {
      await this.#syncDependentChoicesAfterBuildChange();
      this.render(false);
    }
  }

  async #syncDependentChoicesAfterBuildChange(): Promise<void> {
    const effectiveBuildState = await getEffectiveBuildState(this.actor, this.#requireDraft());
    const plan = await this.#buildPlan();
    const trainingChanged = syncSkillTrainingSelections(this.#draftAdjustmentState(), plan.steps);
    const languageChanged = syncLanguageChoiceSelections(this.#draftAdjustmentState(), effectiveBuildState);

    if (trainingChanged && languageChanged) {
      this.#statusNote =
        "Wayfinder marked drafted skill training and language choices for review after the projected build changed.";
    } else if (trainingChanged) {
      this.#statusNote =
        "Wayfinder marked drafted skill training choices for review after the projected build changed.";
    } else if (languageChanged) {
      this.#statusNote = "Wayfinder marked drafted language choices for review after the projected build changed.";
    }
  }

  #abilityLabel(attribute: AbilityKey): string {
    const abilities = getPf2eConfig()?.abilities;
    return game.i18n.localize(abilities?.[attribute] ?? attribute.toUpperCase());
  }

  async #resolveDraftOrActorDocument(itemType: SingletonItemType): Promise<ResolvedBuildStateDocument | null> {
    return getEffectiveSingletonDocument(this.actor, this.#requireDraft(), itemType);
  }

  async #resolveDraftOrActorArcaneSchoolDocument(): Promise<ArcaneSchoolSourceLike | null> {
    const draftSelection = Object.values(this.#requireDraft().branchSelections).find((selection) =>
      isWizardArcaneSchoolSlotId(selection.slotId)
    );
    if (draftSelection) {
      return fetchSelectionDocument(draftSelection);
    }

    return listActorItems(this.actor).find(isWizardArcaneSchoolItem) ?? null;
  }

  async #moveStep(delta: number): Promise<void> {
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
    return createSelectionInvalidationService(
      {
        draft,
        previewValueByStepId: this.#previewValueByStepId,
        pickerFiltersByStepId: this.#pickerFiltersByStepId,
        recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
        scrollById: this.#scrollById,
      },
      {
        buildPlan: () => this.#buildPlan(inspectActor(this.actor), draft),
        resetAncestryBoostDraft: () => this.#resetAncestryBoostDraft(),
        resetBackgroundBoostDraft: () => this.#resetBackgroundBoostDraft(),
        resetClassBoostDraft: () => this.#resetClassBoostDraft(),
      }
    );
  }

  #resetAncestryBoostDraft(): boolean {
    const draft = this.#requireDraft().boosts.ancestry;
    const hadValues =
      draft.mode !== "standard" ||
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

  #selectionCommandState(draft = this.#requireDraft()): SelectionCommandState {
    return {
      draft,
      previewValueByStepId: this.#previewValueByStepId,
      recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
    };
  }

  #draftAdjustmentState(draft = this.#requireDraft()): DraftAdjustmentState {
    return {
      draft,
      recentlyInvalidatedStepIds: this.#recentlyInvalidatedStepIds,
    };
  }

  async #finalizeSelectionCommand(result: SelectionCommandResult): Promise<void> {
    if (result.kind === "warning") {
      if (result.warning === "duplicate-selection") {
        ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.DuplicateSelections"));
      } else if (result.warning === "language-choice-full") {
        ui.notifications.warn("This language step is already full. Remove one before adding another.");
      } else if (result.warning === "spell-choice-full") {
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

  async #isStepComplete(step: PendingStep, effectiveBuildState?: EffectiveBuildState): Promise<boolean> {
    const draft = this.#requireDraft();
    const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
    return isWayfinderStepComplete(step, draft, buildState, {
      isTrainingStepComplete: (trainingStep) => this.#isTrainingStepComplete(trainingStep),
    });
  }

  async #stepStatus(step: PendingStep, effectiveBuildState?: EffectiveBuildState): Promise<string> {
    const draft = this.#requireDraft();
    const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
    return getWayfinderStepStatus(step, draft, this.#recentlyInvalidatedStepIds, buildState, {
      isTrainingStepComplete: (trainingStep) => this.#isTrainingStepComplete(trainingStep),
    });
  }

  #isTrainingStepComplete(step: PendingStep): boolean {
    const training = step.training;
    if (!training) {
      return false;
    }

    const draftTraining = this.#requireDraft().skillTrainings[step.slotId];
    if (!draftTraining) {
      return false;
    }

    const choiceComplete = training.choiceRules.every((rule) => {
      const selection = draftTraining.ruleChoices[rule.key];
      return typeof selection === "string" && selection.length > 0;
    });

    const additionalComplete = draftTraining.additional.length === training.additionalCount;
    const loreComplete = training.loreChoices.every((choice) => {
      const selection = draftTraining.loreChoices[choice.key];
      return typeof selection === "string" && selection.trim().length > 0;
    });
    return choiceComplete && additionalComplete && loreComplete;
  }

  async #adjustTargetLevel(delta: number): Promise<void> {
    this.#statusNote = null;
    const snapshot = inspectActor(this.actor);
    const draft = this.#requireDraft();
    if (!adjustDraftTargetLevel(draft, snapshot.level, delta)) {
      return;
    }
    await this.#saveDraft(false);
    this.render(false);
  }

  async #saveDraft(notify = true): Promise<void> {
    await this.actor.update(buildSaveDraftUpdate(this.#requireDraft()));

    if (notify) {
      ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.SavedDraft"));
    }
  }

  async #applyDraft(): Promise<void> {
    this.#statusNote = null;
    const snapshot = inspectActor(this.actor);
    const draft = this.#requireDraft();
    const plan = await this.#buildPlan(snapshot, draft);
    const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
    let result: ApplyDraftLifecycleResult;
    try {
      result = await applyDraftLifecycle({
        actorName: this.actor.name,
        currentLevel: snapshot.level,
        draft,
        existingCompletedStepIds: readActorCompletedStepIds(this.actor),
        steps: plan.steps,
        isStepComplete: (step) => this.#isStepComplete(step, effectiveBuildState),
        confirmApply: confirmWayfinderApply,
        applyDraftToActor: () =>
          applyDraftToActor(this.actor, draft, plan.steps, {
            deferActorUpdate: true,
          }),
        updateActor: async (update) => {
          await this.actor.update(update);
        },
      });
    } catch (error) {
      console.error("PF2E Wayfinder failed to apply draft", error);
      this.#statusNote =
        "Wayfinder could not apply this draft. The draft was kept for review; details are in the console.";
      ui.notifications.error(game.i18n.localize("wayfinder-pf2e.Notifications.ApplyFailed"));
      this.render(false);
      return;
    }

    if (result.kind === "warning") {
      const notificationKey =
        result.warning === "no-pending-steps"
          ? "wayfinder-pf2e.Notifications.NoPendingSteps"
          : "wayfinder-pf2e.Notifications.MissingSelections";
      ui.notifications.warn(game.i18n.localize(notificationKey));
      this.render(false);
      return;
    }

    if (result.kind === "cancelled") {
      ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.ApplyCancelled"));
      return;
    }

    this.#draft = result.nextDraft;
    this.#recentlyInvalidatedStepIds.clear();
    ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.Applied"));
    await this.close({ animate: false });
  }

  async #clearDraft(): Promise<void> {
    this.#statusNote = null;
    const snapshot = inspectActor(this.actor);
    const cleared = createClearedDraftResult(snapshot.level);
    this.#draft = cleared.nextDraft;
    this.#searchByStepId.clear();
    this.#pickerFiltersByStepId.clear();
    this.#openPickerFilterMenu = null;
    this.#previewValueByStepId.clear();
    this.#recentlyInvalidatedStepIds.clear();
    await this.actor.update(cleared.actorUpdate);
    ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.ClearedDraft"));
    this.render(false);
  }

  #togglePickerFilterMenu(stepId: string, filterKind: PickerFilterKind): void {
    this.#statusNote = null;
    if (this.#openPickerFilterMenu?.stepId === stepId && this.#openPickerFilterMenu.filterKind === filterKind) {
      this.#openPickerFilterMenu = null;
    } else {
      this.#openPickerFilterMenu = { stepId, filterKind };
    }
    this.render(false);
  }

  #togglePickerFilter(stepId: string, filterKind: "rarity" | "source", value: string): void {
    this.#statusNote = null;
    const next = togglePickerFilterValue(
      this.#pickerFiltersByStepId.get(stepId) ?? emptyPickerFilterState(),
      filterKind,
      value
    );
    if (next.rarity.length === 0 && next.source.length === 0) {
      this.#pickerFiltersByStepId.delete(stepId);
    } else {
      this.#pickerFiltersByStepId.set(stepId, next);
    }
    this.render(false);
  }

  #clearPickerFilters(stepId: string): void {
    this.#statusNote = null;
    if (this.#pickerFiltersByStepId.delete(stepId)) {
      this.render(false);
    }
  }
}

function readActorCompletedStepIds(actor: unknown): string[] {
  const completedStepIds = (actor as { flags?: { [MODULE_ID]?: { state?: { completedStepIds?: unknown } } } } | null)
    ?.flags?.[MODULE_ID]?.state?.completedStepIds;
  return Array.isArray(completedStepIds)
    ? completedStepIds.filter((stepId): stepId is string => typeof stepId === "string")
    : [];
}

function getPf2eConfig(): Pf2eConfigLike | null {
  return (globalThis as WayfinderGlobals).CONFIG?.PF2E ?? null;
}

async function confirmWayfinderApply(message: string): Promise<boolean> {
  const foundryApi = foundry as unknown as FoundryDialogApiLike;
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

function fallbackEscapeHtml(value: string): string {
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

function isWizardArcaneSchoolItem(item: BuildStateActorItem | null | undefined): item is ArcaneSchoolActorItemLike {
  const candidate = item as ArcaneSchoolActorItemLike | null | undefined;
  if (candidate?.type !== "feat" || candidate.system?.category !== "classfeature") {
    return false;
  }

  const otherTags = Array.isArray(candidate.system?.traits?.otherTags) ? candidate.system.traits.otherTags : [];
  return otherTags.some(
    (tag: unknown) => typeof tag === "string" && tag.trim().toLowerCase() === "wizard-arcane-school"
  );
}
