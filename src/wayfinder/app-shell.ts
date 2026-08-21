import { inspectActor } from "../actor-inspector.js";
import { applyDraftToActor, DraftApplyPhaseError, finalizeRecoveredDraftOnActor } from "../actor-updater.js";
import type {
  BuildStateActorItem,
  ResolvedBuildStateDocument,
  SingletonItemType,
} from "../build-state/document-types.js";
import type { EffectiveBuildState } from "../build-state.js";
import { getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems } from "../build-state.js";
import { MODULE_ID, MODULE_TITLE, STATE_FLAG } from "../constants.js";
import { createEmptyDraft, normalizeDraft, normalizeState } from "../draft-service.js";
import { FeedbackSupportApp } from "../feedback-support-app.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { getOptionQueryForStep, getOptionsForStep, resolveSelection } from "../pack/options.js";
import { getPickerInfoState } from "../pack/picker-state.js";
import { assertCanUseWayfinder, canUseWayfinder, WayfinderActorAuthorityError } from "../permissions.js";
import type { SelectorActorLike } from "../selector-application.js";
import {
  getEquipmentPolicyJudgmentStoreSetting,
  getEquipmentWorldPolicySetting,
  getSpellRarityCeilingSetting,
} from "../settings.js";
import { enqueueActorOperation } from "../shared/actor-operation-queue.js";
import { cloneData } from "../shared/cloning.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import { findSpellcastingEntryForChoice } from "../shared/spellcasting.js";
import type {
  AbilityKey,
  DraftState,
  PendingStep,
  PickerFilterKind,
  PickerFilterMenuKind,
  PickerFilterState,
  ProgressionPlan,
  SelectionRef,
  SpellRarityAttestationBasis,
} from "../types.js";
import {
  bindWayfinderInteractions,
  isDraftMutationAction,
  parseWayfinderAction,
  type WayfinderAction,
} from "./actions.js";
import {
  type AcquisitionLocalizationValues,
  localizeAcquisitionMessage,
} from "./application/acquisition-localization.js";
import {
  acquisitionSmokeApplyFailureHandledFor,
  acquisitionSmokeApplyFailureRenderedFor,
  acquisitionSmokeCheckpointHookFor,
} from "./application/acquisition-smoke-driver.js";
import {
  type ActorInventorySheetHost,
  openActorInventorySheet,
} from "./application/actor-inventory-navigation-service.js";
import {
  assertApplyCandidateCurrent,
  persistApplyCandidateIfCurrent,
  WayfinderApplyDriftError,
} from "./application/apply-candidate-service.js";
import { buildSelectionPane } from "./application/build-selection-pane-service.js";
import { buildSkillPane, projectSkillRanks } from "./application/build-skill-pane-service.js";
import { prepareCurrentClassGrantPlan } from "./application/class-grant-projection-service.js";
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
  buildApplyAttemptDraft,
  clearDraftLifecycle,
  hasApplyRecoveryState,
} from "./application/draft-lifecycle-service.js";
import { DraftPersistenceCoordinator, type DraftSaveState } from "./application/draft-persistence-service.js";
import {
  assertDraftSideEffectAllowed,
  assertFailedApplyRecoveryCandidateCurrent,
  captureDraftSideEffectPrecondition,
  capturePersistedDraftPrecondition,
  clearDraftWithWriteGuard,
  PersistedDraftWriteGuard,
  readPersistedDraftSnapshot,
  saveDraftWithWriteGuard,
  updateActorWithPersistedDraftPrecondition,
  WayfinderDraftWriteConflictError,
} from "./application/draft-write-guard.js";
import {
  equipmentItemFocusId,
  equipmentLineFocusId,
  restoreEquipmentFocus,
  STARTING_EQUIPMENT_REVIEW_FOCUS_ID,
  STARTING_EQUIPMENT_STATUS_FOCUS_ID,
} from "./application/equipment-accessibility.js";
import {
  ConfiguredItemHandoffRequiredError,
  commitTitanMaulerLineSynchronization,
  getFoundryEquipmentAcquisitionRuntime,
} from "./application/equipment-acquisition-runtime-service.js";
import { createEquipmentAcquisitionExecutionSession } from "./application/equipment-acquisition-session-service.js";
import { assertEquipmentApplyAuthority } from "./application/equipment-policy-service.js";
import {
  buildExistingCharacterHistory,
  withExistingCharacterHistory,
} from "./application/existing-character-history-service.js";
import { decideExternalDraftRefresh } from "./application/external-draft-refresh-service.js";
import {
  buildContextNote,
  buildOptionContext,
  resolveSelectionClassHasSpellcasting,
  resolveSelectionSlug,
  resolveSelectionTraits,
} from "./application/option-context-service.js";
import { derivePickerRenderSession, type PickerRenderSession } from "./application/picker-render-session.js";
import { type PickerSearchRequest, PickerSearchScheduler } from "./application/picker-search-scheduler.js";
import {
  chooseSelectionOption,
  type SelectionCommandResult,
  type SelectionCommandState,
  selectClassArchetypeValue,
  selectClassChoiceValue,
  selectSingletonChoiceValue,
  toggleLanguageChoiceValue,
  toggleSpellChoiceSelection,
} from "./application/selection-command-service.js";
import { createSelectionInvalidationService } from "./application/selection-invalidation-service.js";
import { SemanticCommandQueue } from "./application/semantic-command-queue.js";
import {
  executeStartingEquipmentCommand,
  type StartingEquipmentCommand,
} from "./application/starting-equipment-command-service.js";
import { localizeStartingEquipmentError } from "./application/starting-equipment-failure.js";
import {
  advanceStartingEquipmentRenderSession,
  canDeriveStartingEquipmentRender,
  canUseStartingEquipmentCommandPartial,
  createStartingEquipmentRenderSession,
  EQUIPMENT_CART_PART,
  EQUIPMENT_CATALOGUE_PART,
  EQUIPMENT_DETAIL_PART,
  EQUIPMENT_POLICY_PART,
  EQUIPMENT_STATUS_PART,
  type StartingEquipmentRenderIntent,
  type StartingEquipmentRenderPart,
  type StartingEquipmentRenderRequest,
  type StartingEquipmentRenderSession,
  startingEquipmentPartsForIntent,
  startingEquipmentRenderIdentity,
} from "./application/starting-equipment-render-session.js";
import {
  getStartingEquipmentUiAdapter,
  resolveStartingEquipmentRenderPlan,
} from "./application/starting-equipment-ui-adapter.js";
import {
  buildDraftSaveView,
  buildWayfinderContext,
  type WayfinderTemplateContext,
} from "./application/wayfinder-context-service.js";
import { buildWayfinderAppPlan, findPlanStepBySlotId } from "./application/wayfinder-plan-builder-service.js";
import {
  acquisitionPolicyMaterialMatches,
  recordAcquisitionCurrencyConvergenceWitness,
  recordClassGrantReconciliations,
} from "./domain/acquisition-draft.js";
import { manifestsDescribeSameOutcome } from "./domain/completed-acquisition-manifest.js";
import { physicalGrantCoverageIssues, withPhysicalGrantCoverageReadiness } from "./domain/physical-grant-coverage.js";
import {
  evaluateWayfinderDraftReadiness,
  isTrainingStepCompleteFromDraft,
  WayfinderDraftNotReadyError,
  type WayfinderStepEvaluation,
} from "./domain/step-evaluation.js";
import { hasDuplicateDraftSelection } from "./draft-decisions.js";
import { buildAcquisitionReceiptViewModel } from "./panes/acquisition-receipt.js";
import { buildBoostPane } from "./panes/boost-pane.js";
import { buildPreview, matchesSearch } from "./panes/pick-pane.js";
import { emptyPickerFilterState, normalizePickerFilterState, togglePickerFilterValue } from "./panes/picker-filters.js";
import { buildStartingEquipmentPane } from "./panes/starting-equipment-pane.js";
import { evaluateWayfinderStep, resolveActiveStep } from "./plan-service.js";
import { isWizardArcaneSchoolSlotId } from "./slot-ids.js";
import {
  canGrantRestrictedSpellRarityAccess,
  type SpellRarityCeiling,
  withRestrictedSpellRarityAccess,
} from "./spell-choice/rarity-access.js";
import {
  buildAppliedSpellRarityAttestations,
  buildSpellRarityAttestationReviewLines,
  createSpellRarityAttestation,
  evaluateSpellRarityAttestation,
  frozenSpellRarityAttestationForStep,
  listSpellRarityAttestationProblems,
  listSpellRarityRecoveryProblems,
} from "./spell-choice/rarity-attestation.js";
import { buildHistoricalSpellChoicePlanningNote } from "./spell-choice-service.js";
import type { ActivePane, ManualStepPane } from "./view-models.js";

interface Pf2eConfigLike {
  abilities?: Record<string, string>;
  skills?: Record<string, unknown>;
}

interface WayfinderActorLike extends SelectorActorLike, ActorInventorySheetHost {
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
type PickerSearchRenderContext = {
  wayfinderRenderScope: "picker-search";
  activePane: ReturnType<typeof derivePickerRenderSession> | null;
  pickerRequest: PickerSearchRequest;
};
type StartingEquipmentPartialRenderContext = {
  wayfinderRenderScope: "equipment";
  activePane: StartingEquipmentRenderSession["pane"] | null;
  statusNote: string | null;
  statusNoteIsError: boolean;
  equipmentRequest: StartingEquipmentRenderRequest;
  equipmentRenderSession: StartingEquipmentRenderSession | null;
};
type FullWayfinderRenderContext = WayfinderTemplateContext & {
  wayfinderRenderScope: "full";
  pickerRenderSession: PickerRenderSession | null;
  pickerSourceRevision: number;
  equipmentRenderSession: StartingEquipmentRenderSession | null;
  equipmentSourceRevision: number;
};
type WayfinderRenderContext =
  | FullWayfinderRenderContext
  | PickerSearchRenderContext
  | StartingEquipmentPartialRenderContext;
type WayfinderRenderOptions = Record<string, unknown> & {
  parts?: string[];
  wayfinderPickerRequest?: PickerSearchRequest;
  wayfinderPickerSourceRevision?: number;
  wayfinderPickerViewRevision?: number;
  wayfinderSkippedReplacement?: boolean;
  wayfinderEquipmentUpdate?: boolean;
  wayfinderEquipmentRequest?: StartingEquipmentRenderRequest;
  wayfinderEquipmentSourceRevision?: number;
  wayfinderEquipmentViewRevision?: number;
  wayfinderAcquisitionSmokeQuiescent?: boolean;
};
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
  input?: (config: {
    content: string;
    modal?: boolean;
    window?: { title: string };
    ok?: { icon?: string; label: string };
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

const PICKER_COUNT_PART = "picker-count";
const PICKER_RESULTS_PART = "picker-results";
const PICKER_SEARCH_PARTS = [PICKER_COUNT_PART, PICKER_RESULTS_PART] as const;
const PICKER_SEARCH_DELAY_MS = 40;

export class WayfinderApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static #openApps = new Set<WayfinderApp>();

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

  actor: WayfinderActorLike;
  #draft: DraftState | null = null;
  #activeStepId: string | null = null;
  #searchByStepId = new Map<string, string>();
  #pickerFiltersByStepId = new Map<string, PickerFilterState>();
  #openPickerFilterMenu: { stepId: string; filterKind: PickerFilterMenuKind } | null = null;
  #previewValueByStepId = new Map<string, string>();
  #scrollById = new Map<string, number>();
  #pendingSearchFocus: { stepId: string; cursor: number } | null = null;
  #pendingStepFocusId: string | null = null;
  #pendingControlFocusId: string | null = null;
  #pendingEquipmentFocusIds: string[] | null = null;
  #equipmentSearchByStepId = new Map<string, string>();
  #equipmentFiltersByStepId = new Map<string, Record<string, string[]>>();
  #equipmentPreviewByStepId = new Map<string, string>();
  #equipmentScheduledRenderIntent: Extract<StartingEquipmentRenderIntent, "search" | "facet"> = "search";
  #cachedRenderPlan: ProgressionPlan | null = null;
  #recentlyInvalidatedStepIds = new Set<string>();
  #statusNote: string | null = null;
  #statusErrorMessage: string | null = null;
  #draftPersistence: DraftPersistenceCoordinator;
  #draftWriteGuard: PersistedDraftWriteGuard;
  #semanticCommands = new SemanticCommandQueue();
  #closePromise: Promise<this> | null = null;
  #lastDraftSavePhase: DraftSaveState["phase"] = "idle";
  #pickerRenderSession: { sourceRevision: number; session: PickerRenderSession } | null = null;
  #equipmentRenderSession: StartingEquipmentRenderSession | null = null;
  #pickerSearchScheduler = new PickerSearchScheduler({
    delayMs: PICKER_SEARCH_DELAY_MS,
    render: (request) => this.#renderPickerSearch(request),
    onError: (error) => {
      console.error("PF2E Wayfinder picker search render failed", error);
      ui.notifications.error("Wayfinder could not update these search results. Reopen the window and try again.");
    },
  });
  #equipmentSearchScheduler = new PickerSearchScheduler({
    delayMs: PICKER_SEARCH_DELAY_MS,
    render: (request) => this.#renderStartingEquipmentSearch(request),
    onError: (error) => {
      console.error("PF2E Wayfinder equipment search render failed", error);
      ui.notifications.error(localizeAcquisition("wayfinder-pf2e.StartingEquipment.Errors.Search"));
    },
  });

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

  static rerenderOpenApps(): void {
    for (const app of this.#openApps) {
      app.render(false);
    }
  }

  static refreshDraftFromActorUpdate(actor: WayfinderActorLike): void {
    for (const app of this.#openApps) {
      if (app.actor.id === actor.id) {
        app.#queueExternalDraftRefresh();
      }
    }
  }

  constructor(options: { actor: WayfinderActorLike }) {
    super({
      uniqueId: `${MODULE_ID}-${options.actor.id}`,
    });
    this.actor = options.actor;
    const initialLevel = inspectActor(this.actor).level;
    this.#draftWriteGuard = new PersistedDraftWriteGuard(readPersistedDraftSnapshot(this.actor, initialLevel));
    this.#draftPersistence = new DraftPersistenceCoordinator({
      saveDraft: (draft) =>
        enqueueActorOperation(this.actor, async () => {
          const currentLevel = inspectActor(this.actor).level;
          await saveDraftWithWriteGuard(this.actor, draft, currentLevel, this.#draftWriteGuard);
        }),
      onStateChange: (state) => this.#onDraftSaveStateChange(state),
    });
    this.actor.apps[this.id] = this;
  }

  get id(): string {
    return `${MODULE_ID}-${this.actor.id}`;
  }

  get title(): string {
    return `${MODULE_TITLE}: ${this.actor.name}`;
  }

  _configureRenderOptions(options: WayfinderRenderOptions): void {
    if (!isPickerSearchRender(options)) {
      options.wayfinderPickerSourceRevision = this.#pickerSearchScheduler.invalidateSource();
      options.wayfinderPickerViewRevision = this.#pickerSearchScheduler.viewRevision;
    }
    if (!startingEquipmentRenderRequest(options)) {
      options.wayfinderEquipmentSourceRevision = this.#equipmentSearchScheduler.invalidateSource();
      options.wayfinderEquipmentViewRevision = this.#equipmentSearchScheduler.viewRevision;
    }
    super._configureRenderOptions(options);
  }

  _configureRenderParts(options: WayfinderRenderOptions): Record<string, unknown> {
    const parts = super._configureRenderParts(options) as Record<string, unknown>;
    if (isPickerSearchRender(options)) {
      const isSpellChoice = this.#pickerRenderSession?.session.basePane.kind === "spell-choice";
      parts[PICKER_COUNT_PART] = {
        template: `modules/${MODULE_ID}/templates/wayfinder/picker-result-count.hbs`,
      };
      parts[PICKER_RESULTS_PART] = {
        template: `modules/${MODULE_ID}/templates/wayfinder/${isSpellChoice ? "spell-choice-results" : "pick-results"}.hbs`,
      };
      return parts;
    }
    const equipmentRequest = startingEquipmentRenderRequest(options);
    if (!equipmentRequest) return parts;
    const templates: Record<StartingEquipmentRenderPart, string> = {
      [EQUIPMENT_POLICY_PART]: "starting-equipment-policy",
      [EQUIPMENT_CATALOGUE_PART]: "starting-equipment-catalogue",
      [EQUIPMENT_DETAIL_PART]: "starting-equipment-detail",
      [EQUIPMENT_CART_PART]: "starting-equipment-cart",
      [EQUIPMENT_STATUS_PART]: "starting-equipment-status",
    };
    for (const part of startingEquipmentPartsForIntent(equipmentRequest.intent)) {
      parts[part] = { template: `modules/${MODULE_ID}/templates/wayfinder/${templates[part]}.hbs` };
    }
    return parts;
  }

  _canRender(options: WayfinderRenderOptions): false | void {
    if (super._canRender(options) === false) {
      return false;
    }
    const request = pickerSearchRequest(options);
    if (request && !this.#canCommitPickerSearch(request)) {
      return false;
    }
    const equipmentRequest = startingEquipmentRenderRequest(options);
    if (equipmentRequest && !this.#canCommitStartingEquipmentRender(equipmentRequest)) {
      return false;
    }
  }

  async _prepareContext(options: WayfinderRenderOptions = {}): Promise<WayfinderRenderContext> {
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
          openFilterKind:
            this.#openPickerFilterMenu?.stepId === pickerRequest.stepId ? this.#openPickerFilterMenu.filterKind : null,
        }),
        pickerRequest,
      };
    }

    const equipmentRequest = startingEquipmentRenderRequest(options);
    if (equipmentRequest) {
      const session = this.#equipmentRenderSession;
      const draft = this.#requireDraft();
      const identity = startingEquipmentRenderIdentity(draft, equipmentRequest.stepId, equipmentRequest.sourceRevision);
      if (
        !session ||
        !this.#canCommitStartingEquipmentRender(equipmentRequest) ||
        !canDeriveStartingEquipmentRender(session, identity, equipmentRequest)
      ) {
        options.wayfinderSkippedReplacement = true;
        return {
          wayfinderRenderScope: "equipment",
          activePane: null,
          statusNote: this.#statusNote,
          statusNoteIsError: this.#statusNote !== null && this.#statusNote === this.#statusErrorMessage,
          equipmentRequest,
          equipmentRenderSession: null,
        };
      }
      const pane = buildStartingEquipmentPane(
        session.step,
        draft,
        session.evaluation,
        await getStartingEquipmentUiAdapter().project(this.#startingEquipmentUiRequest(session.step)),
        localizeAcquisition,
        {
          worldPolicy: getEquipmentWorldPolicySetting(),
          judgments: getEquipmentPolicyJudgmentStoreSetting().judgments,
          isGm: game.user?.isGM === true,
        }
      );
      if (!this.#canCommitStartingEquipmentRender(equipmentRequest)) {
        options.wayfinderSkippedReplacement = true;
        return {
          wayfinderRenderScope: "equipment",
          activePane: null,
          statusNote: this.#statusNote,
          statusNoteIsError: this.#statusNote !== null && this.#statusNote === this.#statusErrorMessage,
          equipmentRequest,
          equipmentRenderSession: null,
        };
      }
      return {
        wayfinderRenderScope: "equipment",
        activePane: pane,
        statusNote: this.#statusNote,
        statusNoteIsError: this.#statusNote !== null && this.#statusNote === this.#statusErrorMessage,
        equipmentRequest,
        equipmentRenderSession: advanceStartingEquipmentRenderSession(session, equipmentRequest, pane),
      };
    }

    const snapshot = inspectActor(this.actor);
    const draft = this.#ensureDraft(snapshot.level);
    const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
    const plan = await resolveStartingEquipmentRenderPlan({
      equipmentOnlyUpdate: options.wayfinderEquipmentUpdate === true,
      targetLevel: draft.targetLevel,
      cachedPlan: this.#cachedRenderPlan,
      buildPlan: () => this._buildRenderPlan(snapshot, draft),
    });
    this.#cachedRenderPlan = plan;
    if (!this.#semanticCommands.busy && !hasApplyRecoveryState(draft)) {
      const orphanedSpellChoices = this.#selectionInvalidationService(draft).invalidateOrphanedSpellChoicesForSteps(
        plan.steps
      );
      if (orphanedSpellChoices.length > 0) {
        this.#statusNote = "Wayfinder removed spell choices and player attestations from vanished steps.";
        this.#draftDidChange();
      }
    }
    const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
    const readiness = withPhysicalGrantCoverageReadiness(
      await evaluateWayfinderDraftReadiness(plan.steps, (step) =>
        this.#evaluateStep(step, effectiveBuildState, draft, plan.steps, snapshot.skillRanks)
      ),
      draft,
      plan.steps
    );
    const evaluationsByStepId = new Map(
      plan.steps.map((step, index) => [step.id, readiness.evaluations[index] as WayfinderStepEvaluation])
    );
    const activeStep = await this.#resolveActiveStep(plan.steps, evaluationsByStepId);
    const activeEvaluation = activeStep ? evaluationsByStepId.get(activeStep.id) : null;
    let pickerRenderSession: PickerRenderSession | null = null;
    const activePane =
      activeStep && activeEvaluation
        ? await this.#buildActivePane(activeStep, activeEvaluation, effectiveBuildState, plan.steps, (session) => {
            pickerRenderSession = session;
          })
        : null;
    const [effectiveAncestry, effectiveHeritage, effectiveBackground, effectiveClass, effectiveDeity] =
      await Promise.all([
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
    const actorItemsById = new Map(
      listActorItems(this.actor).flatMap((item) => (item.id ? [[item.id, item] as const] : []))
    );
    const acquisitionReceipt = state.completedAcquisitionManifest
      ? await buildAcquisitionReceiptViewModel(state.completedAcquisitionManifest, {
          resolveItemName: (_sourceUuid, actualItemId) => actorItemsById.get(actualItemId)?.name ?? null,
          resolveContainerName: (containerId) => actorItemsById.get(containerId)?.name ?? null,
          localize: localizeAcquisition,
        })
      : null;
    const equipmentSourceRevision = numericRenderOption(options.wayfinderEquipmentSourceRevision);
    const equipmentViewRevision = numericRenderOption(options.wayfinderEquipmentViewRevision);
    const equipmentRenderSession =
      activeStep?.kind === "starting-equipment" && activeEvaluation && activePane?.kind === "starting-equipment"
        ? createStartingEquipmentRenderSession({
            identity: startingEquipmentRenderIdentity(draft, activeStep.id, equipmentSourceRevision),
            viewRevision: equipmentViewRevision,
            step: activeStep,
            evaluation: activeEvaluation,
            pane: activePane,
          })
        : null;
    return Object.assign(
      await buildWayfinderContext({
        actorId: this.actor.id,
        actorName: this.actor.name,
        currentLevel: snapshot.level,
        targetLevel: plan.targetLevel,
        steps: plan.steps,
        activeStep,
        activePane,
        statusNote: this.#statusNote,
        statusNoteIsError: this.#statusNote !== null && this.#statusNote === this.#statusErrorMessage,
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
        acquisitionReceipt,
        draftSaveState: this.#draftPersistence.state,
        lifecycleBusy: this.#semanticCommands.barrierActive,
      }),
      {
        wayfinderRenderScope: "full" as const,
        pickerRenderSession,
        pickerSourceRevision: numericRenderOption(options.wayfinderPickerSourceRevision),
        equipmentRenderSession,
        equipmentSourceRevision,
      }
    );
  }

  _replaceHTML(result: Record<string, HTMLElement>, content: HTMLElement, options: WayfinderRenderOptions): void {
    const pickerRequest = pickerSearchRequest(options);
    if (pickerRequest) {
      if (!this.#canCommitPickerSearch(pickerRequest) || !hasPickerPartTargets(content, pickerRequest.stepId)) {
        options.wayfinderSkippedReplacement = true;
        return;
      }
      super._replaceHTML(result, content, options);
      return;
    }

    const equipmentRequest = startingEquipmentRenderRequest(options);
    if (equipmentRequest) {
      if (
        !this.#canCommitStartingEquipmentRender(equipmentRequest) ||
        !hasStartingEquipmentPartTargets(
          content,
          equipmentRequest.stepId,
          startingEquipmentPartsForIntent(equipmentRequest.intent)
        )
      ) {
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
          void this.render(false).catch((error: unknown) => {
            console.error("PF2E Wayfinder failed to refresh a stale full render", error);
          });
        }
      });
      return;
    }

    const startingEquipmentViewRevision = numericRenderOption(options.wayfinderEquipmentViewRevision);
    if (!options.isFirstRender && startingEquipmentViewRevision !== this.#equipmentSearchScheduler.viewRevision) {
      options.wayfinderSkippedReplacement = true;
      queueMicrotask(() => {
        if (this.actor.apps[this.id] === this) {
          void this.render(false).catch((error: unknown) => {
            console.error("PF2E Wayfinder failed to refresh a stale full equipment render", error);
          });
        }
      });
      return;
    }

    super._replaceHTML(result, content, options);
  }

  async _onRender(context: WayfinderRenderContext, options: WayfinderRenderOptions): Promise<void> {
    await super._onRender(context, options);
    if (options.wayfinderSkippedReplacement) {
      return;
    }
    const root = this.element;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    if (context.wayfinderRenderScope === "picker-search") {
      const results = root.querySelector<HTMLElement>(`[data-application-part="${PICKER_RESULTS_PART}"]`);
      if (results) {
        bindWayfinderInteractions(
          results,
          {
            onActionClick: this.#onActionClick,
            onSearchInput: this.#onSearchInput,
            onEquipmentSearchInput: this.#onEquipmentSearchInput,
            onScrollableScroll: this.#onScrollableScroll,
            onManualChange: this.#onManualChange,
            onLoreInputChange: this.#onLoreInputChange,
          },
          this.#scrollById,
          null
        );
      }
      this.#pendingSearchFocus = null;
      return;
    }

    if (context.wayfinderRenderScope === "equipment") {
      this.#equipmentRenderSession = context.equipmentRenderSession;
      for (const part of startingEquipmentPartsForIntent(context.equipmentRequest.intent)) {
        const target = root.querySelector<HTMLElement>(`[data-application-part="${part}"]`);
        if (!target) continue;
        bindWayfinderInteractions(
          target,
          {
            onActionClick: this.#onActionClick,
            onSearchInput: this.#onSearchInput,
            onEquipmentSearchInput: this.#onEquipmentSearchInput,
            onScrollableScroll: this.#onScrollableScroll,
            onManualChange: this.#onManualChange,
            onLoreInputChange: this.#onLoreInputChange,
          },
          this.#scrollById,
          null
        );
      }
      if (this.#pendingEquipmentFocusIds) {
        restoreEquipmentFocus(root, this.#pendingEquipmentFocusIds);
      }
      this.#pendingEquipmentFocusIds = null;
      this.#pendingSearchFocus = null;
      return;
    }

    this.#pickerRenderSession = context.pickerRenderSession
      ? { sourceRevision: context.pickerSourceRevision, session: context.pickerRenderSession }
      : null;
    this.#equipmentRenderSession = context.equipmentRenderSession;

    this.#pendingSearchFocus = bindWayfinderInteractions(
      root,
      {
        onActionClick: this.#onActionClick,
        onSearchInput: this.#onSearchInput,
        onEquipmentSearchInput: this.#onEquipmentSearchInput,
        onScrollableScroll: this.#onScrollableScroll,
        onManualChange: this.#onManualChange,
        onLoreInputChange: this.#onLoreInputChange,
      },
      this.#scrollById,
      this.#pendingSearchFocus
    ).pendingSearchFocus;
    const pendingStepFocusId = this.#pendingStepFocusId;
    const pendingControlFocusId = this.#pendingControlFocusId;
    const control = pendingControlFocusId
      ? root.querySelector<HTMLElement>(`[data-wayfinder-focus-id="${CSS.escape(pendingControlFocusId)}"]`)
      : null;
    const stepHeading = root.querySelector<HTMLElement>("[data-wayfinder-step-heading]");
    if (pendingControlFocusId && control) {
      control.focus();
    } else if (pendingStepFocusId && stepHeading?.dataset.wayfinderStepHeading === pendingStepFocusId) {
      stepHeading.focus();
    } else if (this.#pendingEquipmentFocusIds) {
      restoreEquipmentFocus(root, this.#pendingEquipmentFocusIds);
    }
    if (pendingStepFocusId || pendingControlFocusId) {
      this.#pendingStepFocusId = null;
      this.#pendingControlFocusId = null;
    }
    this.#pendingEquipmentFocusIds = null;
    WayfinderApp.#openApps.add(this);
    this.#patchDraftSaveStatus(this.#draftPersistence.state);
    if (options.wayfinderAcquisitionSmokeQuiescent) {
      acquisitionSmokeApplyFailureRenderedFor(this.actor);
    }
  }

  _tearDown(options: unknown): void {
    try {
      super._tearDown(options);
    } finally {
      this.#finalizeClosedState();
    }
  }

  _canDetach(): boolean {
    return false;
  }

  close(options: Record<string, unknown> = {}): Promise<this> {
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

  async #closeWithPersistence(options: Record<string, unknown>): Promise<this> {
    const barrier = await this.#semanticCommands.acquireBarrier();
    if (barrier === "acquired") {
      try {
        await this.#draftPersistence.pauseAndFlush();
      } catch (error) {
        this.#draftPersistence.resume();
        this.#semanticCommands.releaseBarrier();
        const saveView = buildDraftSaveView(this.#draftPersistence.state);
        this.#statusNote = saveView.message ?? "Wayfinder could not save the latest draft, so the window stayed open.";
        this.#patchDraftSaveStatus(this.#draftPersistence.state);
        ui.notifications.error(this.#statusNote);
        console.error("PF2E Wayfinder failed to save before close", error);
        this.render(false);
        return this;
      }
    }

    try {
      const closed = (await super.close(options)) as this;
      this.#finalizeClosedState();
      return closed;
    } catch (error) {
      if (barrier === "acquired") {
        this.#draftPersistence.resume();
        this.#semanticCommands.releaseBarrier();
      }
      throw error;
    }
  }

  #finalizeClosedState(): void {
    this.#pickerSearchScheduler.dispose();
    this.#equipmentSearchScheduler.dispose();
    this.#equipmentRenderSession = null;
    this.#semanticCommands.completeTerminalOperation();
    this.#draftPersistence.dispose();
    WayfinderApp.#openApps.delete(this);
    if (this.actor.apps[this.id] === this) {
      delete this.actor.apps[this.id];
    }
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
    if (!isStartingEquipmentViewOnlyAction(action)) {
      this.#statusErrorMessage = null;
    }
    this.#pendingEquipmentFocusIds = startingEquipmentFocusCandidates(target);
    if (
      action.type !== "toggle-picker-filter" &&
      action.type !== "toggle-picker-filter-menu" &&
      action.type !== "set-picker-level-range"
    ) {
      this.#openPickerFilterMenu = null;
    }

    if (
      (isDraftMutationAction(action) || action.type === "clear-draft" || action.type === "import-existing-history") &&
      !this.#allowDraftMutation()
    ) {
      return;
    }

    if (isDraftMutationAction(action)) {
      const queued = this.#semanticCommands.enqueue(async () => {
        const before = draftFingerprint(this.#draft);
        try {
          await this.#dispatchAction(action);
        } finally {
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
      const queued = this.#semanticCommands.enqueue(() =>
        action.type === "retry-draft-save" ? this.#retryDraftSave() : this.#saveDraft()
      );
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
        } else {
          this.render({ wayfinderAcquisitionSmokeQuiescent: true });
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

    if (action.type === "open-inventory") {
      try {
        await openActorInventorySheet(this.actor);
      } catch (error) {
        console.error("PF2E Wayfinder could not open the actor inventory", error);
        ui.notifications.warn(localizeAcquisition("wayfinder-pf2e.AcquisitionReceipt.OpenInventoryFailed"));
      }
      return;
    }

    await this.#dispatchAction(action);
  };

  async #dispatchAction(action: WayfinderAction): Promise<void> {
    switch (action.type) {
      case "select-step":
        this.#activeStepId = action.stepId;
        this.#pendingStepFocusId = action.stepId;
        this.#pendingControlFocusId = action.focusId ?? null;
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
      case "set-picker-level-range":
        this.#setPickerLevelRange(action.stepId, action.minimum, action.maximum);
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
      case "initialize-starting-equipment":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "initialize",
          ...(action.selectedRecipe ? { selectedRecipe: action.selectedRecipe } : {}),
        });
        break;
      case "select-equipment-recipe":
        await this.#executeStartingEquipmentCommand(
          action.stepId,
          {
            type: "select-recipe",
            selectedRecipe: action.selectedRecipe,
          },
          "recipe"
        );
        break;
      case "activate-equipment-policy":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "activate-policy",
          startKind: action.startKind,
          reason: `Confirmed ${action.startKind === "new-campaign" ? "a new campaign" : "a replacement character"} start at level ${this.#requireDraft().targetLevel}.`,
        });
        break;
      case "request-equipment-start":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "request-higher-level-start",
          startKind: action.startKind,
          reason: localizeAcquisition(
            action.startKind === "new-campaign"
              ? "wayfinder-pf2e.StartingEquipment.Request.HigherLevelNewCampaignReason"
              : "wayfinder-pf2e.StartingEquipment.Request.HigherLevelReplacementReason",
            { level: this.#requireDraft().targetLevel }
          ),
        });
        break;
      case "approve-equipment-policy-request":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "approve-policy-request",
          requestId: action.requestId,
          reason: "Approved the requested higher-level starting wealth.",
        });
        break;
      case "request-equipment-item-exception":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "request-item-exception",
          sourceUuid: action.sourceUuid,
          reason: localizeAcquisition("wayfinder-pf2e.StartingEquipment.Request.ItemExceptionReason"),
        });
        break;
      case "approve-equipment-item-exception":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "approve-item-exception",
          sourceUuid: action.sourceUuid,
          reason: "Approved an exact source and rarity exception for this item.",
        });
        break;
      case "revoke-equipment-policy-judgment":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "revoke-policy-judgment",
          judgmentId: action.judgmentId,
          reason: "Revoked starting-equipment authority from the current draft.",
        });
        break;
      case "set-custom-equipment-lump-sum": {
        const input = (this.element as HTMLElement).querySelector<HTMLInputElement>(
          `[data-wayfinder-custom-lump-sum][data-step-id="${action.stepId}"]`
        );
        const amountCopper = parseGoldToCopper(input?.value ?? "");
        if (amountCopper === null) {
          const message = localizeAcquisition("wayfinder-pf2e.StartingEquipment.Errors.CustomLumpSum");
          this.#setStartingEquipmentFailure(message);
          ui.notifications.warn(message);
          this.render({ wayfinderEquipmentUpdate: true });
          break;
        }
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "set-custom-lump-sum",
          amountCopper,
          reason: `Approved a custom ${input!.value.trim()} gp starting lump sum.`,
        });
        break;
      }
      case "grant-extra-equipment-allowance":
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "grant-extra-current-level-allowance",
          reason: `Approved one extra level ${this.#requireDraft().targetLevel} permanent-item allowance.`,
        });
        break;
      case "preview-equipment-item":
        this.#equipmentPreviewByStepId.set(action.stepId, action.sourceUuid);
        this.#renderStartingEquipmentPartial(action.stepId, "preview");
        break;
      case "add-equipment-item":
        await this.#addStartingEquipmentItem(
          action.stepId,
          action.sourceUuid,
          action.funding === "allowance"
            ? { lane: "allowance", allowanceId: action.allowanceId! }
            : { lane: "currency" }
        );
        break;
      case "choose-titan-mauler-equipment":
        await this.#chooseTitanMaulerEquipment(action.stepId, action.sourceUuid);
        break;
      case "remove-equipment-line":
        this.#pendingEquipmentFocusIds = this.#equipmentLineRelocationCandidates(action.lineId);
        await this.#executeStartingEquipmentCommand(action.stepId, {
          type: "remove-line",
          lineId: action.lineId,
        });
        break;
      case "change-equipment-quantity":
        if (
          action.delta === -1 &&
          this.#requireDraft().acquisition?.lines.find((line) => line.lineId === action.lineId)?.price
            .requestedQuantity === 1
        ) {
          this.#pendingEquipmentFocusIds = this.#equipmentLineRelocationCandidates(action.lineId);
        }
        await this.#changeStartingEquipmentQuantity(action.stepId, action.lineId, action.delta);
        break;
      case "toggle-equipment-filter":
        this.#toggleStartingEquipmentFilter(action.stepId, action.filterKey, action.value);
        break;
      case "clear-equipment-filters":
        this.#equipmentFiltersByStepId.delete(action.stepId);
        this.#equipmentScheduledRenderIntent = "facet";
        this.#equipmentSearchScheduler.schedule(action.stepId, this.#equipmentSearchByStepId.get(action.stepId) ?? "");
        break;
      case "review-equipment-purchases":
        await this.#executeStartingEquipmentCommand(action.stepId, { type: "review-purchases" });
        break;
      case "retain-all-equipment":
        await this.#executeStartingEquipmentCommand(action.stepId, { type: "retain-all" });
        break;
      case "acknowledge-equipment-handoff":
        await this.#executeStartingEquipmentCommand(action.stepId, { type: "acknowledge-handoff" });
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

  #onSearchInput = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    if (!stepId) {
      return;
    }

    this.#openPickerFilterMenu = null;
    this.#searchByStepId.set(stepId, input.value);
    this.#pickerSearchScheduler.schedule(stepId, input.value);
  };

  #onEquipmentSearchInput = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | null;
    const stepId = input?.dataset.stepId;
    if (!stepId) return;
    this.#equipmentSearchByStepId.set(stepId, input.value);
    this.#pendingSearchFocus = { stepId, cursor: input.selectionStart ?? input.value.length };
    this.#equipmentScheduledRenderIntent = "search";
    this.#equipmentSearchScheduler.schedule(stepId, input.value);
  };

  async #renderStartingEquipmentSearch(request: PickerSearchRequest): Promise<void> {
    const equipmentRequest: StartingEquipmentRenderRequest = {
      ...request,
      intent: this.#equipmentScheduledRenderIntent,
    };
    if (!this.#canCommitStartingEquipmentRender(equipmentRequest)) return;
    await this.render({
      parts: [...startingEquipmentPartsForIntent(equipmentRequest.intent)],
      wayfinderEquipmentUpdate: true,
      wayfinderEquipmentRequest: equipmentRequest,
    });
  }

  #renderStartingEquipmentPartial(
    stepId: string,
    intent: Exclude<StartingEquipmentRenderIntent, "search" | "facet">
  ): void {
    this.#equipmentSearchScheduler.invalidateView();
    const request: StartingEquipmentRenderRequest = {
      viewRevision: this.#equipmentSearchScheduler.viewRevision,
      sourceRevision: this.#equipmentSearchScheduler.sourceRevision,
      stepId,
      query: this.#equipmentSearchByStepId.get(stepId) ?? "",
      intent,
    };
    if (!this.#canCommitStartingEquipmentRender(request)) {
      this.render(false);
      return;
    }
    this.render({
      parts: [...startingEquipmentPartsForIntent(intent)],
      wayfinderEquipmentUpdate: true,
      wayfinderEquipmentRequest: request,
    });
  }

  #canCommitStartingEquipmentRender(request: StartingEquipmentRenderRequest): boolean {
    const session = this.#equipmentRenderSession;
    return (
      this.#equipmentSearchScheduler.isCurrent(request) &&
      session !== null &&
      canDeriveStartingEquipmentRender(
        session,
        startingEquipmentRenderIdentity(this.#requireDraft(), request.stepId, request.sourceRevision),
        request
      ) &&
      (this.#equipmentSearchByStepId.get(request.stepId) ?? "") === request.query
    );
  }

  async #renderPickerSearch(request: PickerSearchRequest): Promise<void> {
    if (!this.#canCommitPickerSearch(request)) {
      return;
    }
    await this.render({
      parts: [...PICKER_SEARCH_PARTS],
      wayfinderPickerRequest: request,
    });
  }

  #canCommitPickerSearch(request: PickerSearchRequest): boolean {
    const prepared = this.#pickerRenderSession;
    const root = this.element;
    return (
      this.#pickerSearchScheduler.isCurrent(request) &&
      prepared?.sourceRevision === request.sourceRevision &&
      prepared.session.basePane.stepId === request.stepId &&
      this.#searchByStepId.get(request.stepId) === request.query &&
      root instanceof HTMLElement &&
      hasPickerPartTargets(root, request.stepId)
    );
  }

  #onScrollableScroll = (event: Event): void => {
    const scrollable = event.currentTarget as HTMLElement | null;
    const scrollId = scrollable?.dataset.wayfinderScrollId;
    if (!scrollId || !scrollable) {
      return;
    }

    this.#scrollById.set(scrollId, scrollable.scrollTop);
  };

  #onManualChange = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement | null;
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
    } else {
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
    if (!this.#allowDraftMutation()) {
      return;
    }

    const queued = this.#semanticCommands.enqueue(async () => {
      const before = draftFingerprint(this.#draft);
      try {
        await this.#setTrainingLore(stepId, key, input.value);
      } finally {
        if (draftFingerprint(this.#draft) !== before) {
          this.#draftDidChange();
        }
      }
    });
    if (queued !== null) {
      await queued;
    } else {
      this.render(false);
    }
  };

  #ensureDraft(defaultTargetLevel: number): DraftState {
    if (!this.#draft) {
      this.#draft = normalizeDraft(this.actor.getFlag(MODULE_ID, "draft"), defaultTargetLevel);
      this.#draftPersistence.initialize(this.#draft);
    } else {
      this.#reconcileLiveRecoveryDraft(defaultTargetLevel);
    }
    return this.#draft;
  }

  #requireDraft(): DraftState {
    if (!this.#draft) {
      this.#draft = createEmptyDraft(1);
      this.#draftPersistence.initialize(this.#draft);
    }
    return this.#draft;
  }

  protected _buildRenderPlan(snapshot: ReturnType<typeof inspectActor>, draft: DraftState) {
    return this.#buildPlan(snapshot, draft);
  }

  protected _buildRenderPreview(...args: Parameters<typeof buildPreview>): ReturnType<typeof buildPreview> {
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

  async #findPlanStepBySlotId(slotId: string, snapshot = inspectActor(this.actor), draft = this.#requireDraft()) {
    return findPlanStepBySlotId(
      {
        actor: this.actor,
        snapshot,
        draft,
        resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType, draft),
        resolveArcaneSchoolDocument: () => this.#resolveDraftOrActorArcaneSchoolDocument(draft),
        localize: (value) => game.i18n.localize(value),
      },
      slotId
    );
  }

  async #resolveActiveStep(
    steps: PendingStep[],
    evaluationsByStepId: ReadonlyMap<string, WayfinderStepEvaluation>
  ): Promise<PendingStep | null> {
    const resolved = await resolveActiveStep(
      steps,
      this.#activeStepId,
      async (step) => evaluationsByStepId.get(step.id)?.complete === true
    );
    this.#activeStepId = resolved.activeStepId;
    return resolved.activeStep;
  }

  async #buildActivePane(
    step: PendingStep,
    stepEvaluation: WayfinderStepEvaluation,
    effectiveBuildState: EffectiveBuildState,
    planSteps: PendingStep[],
    onPickerRenderSession?: (session: PickerRenderSession) => void
  ): Promise<ActivePane> {
    if (step.kind === "manual") {
      const pane: ManualStepPane = {
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

    if (step.kind === "starting-equipment") {
      const request = this.#startingEquipmentUiRequest(step);
      return buildStartingEquipmentPane(
        step,
        this.#requireDraft(),
        stepEvaluation,
        await getStartingEquipmentUiAdapter().project(request),
        localizeAcquisition,
        {
          worldPolicy: getEquipmentWorldPolicySetting(),
          judgments: getEquipmentPolicyJudgmentStoreSetting().judgments,
          isGm: game.user?.isGM === true,
        }
      );
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
      resolveOptionContext: (paneStep) =>
        buildOptionContext({
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
      buildContextNote: (paneStep, context) =>
        buildContextNote(paneStep, context, {
          resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
        }),
      resolveStepStatus: async () => stepEvaluation.status,
      stepEvaluation,
      getOptionsForStep,
      getOptionQueryForStep,
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

  #startingEquipmentUiRequest(step: Extract<PendingStep, { kind: "starting-equipment" }>) {
    return {
      actor: this.actor,
      draft: this.#requireDraft(),
      step,
      query: this.#equipmentSearchByStepId.get(step.id) ?? "",
      filters: this.#equipmentFiltersByStepId.get(step.id) ?? {},
      previewSourceUuid: this.#equipmentPreviewByStepId.get(step.id) ?? null,
    };
  }

  async #executeStartingEquipmentCommand(
    stepId: string,
    command: StartingEquipmentCommand,
    partialIntent?: Extract<StartingEquipmentRenderIntent, "quantity" | "recipe">
  ): Promise<void> {
    const partialWasSafe = partialIntent
      ? canUseStartingEquipmentCommandPartial(this.#requireDraft(), partialIntent)
      : false;
    let succeeded = false;
    try {
      const plan = this.#cachedRenderPlan;
      if (!plan) throw new TypeError("The current Wayfinder plan is unavailable.");
      const step = plan.steps.find(
        (candidate): candidate is Extract<PendingStep, { kind: "starting-equipment" }> =>
          candidate.id === stepId && candidate.kind === "starting-equipment"
      );
      if (!step) throw new TypeError("The starting-equipment step is no longer in the current plan.");
      const userId = String(game.user?.id ?? "");
      const now = new Date().toISOString();
      const result = await executeStartingEquipmentCommand(command, {
        actor: this.actor,
        draft: this.#requireDraft(),
        moduleState: normalizeState(this.actor.getFlag(MODULE_ID, "state")),
        steps: plan.steps,
        userId,
        user: game.user,
        now: () => now,
      });
      this.#requireDraft().acquisition = result.acquisition;
      this.#requireDraft().acquisitionCorrupt = false;
      this.#requireDraft().equipmentPolicyRequests = [...result.policyRequests];
      this.#statusNote = localizeAcquisitionMessage(localizeAcquisition, result.status);
      this.#statusErrorMessage = null;
      succeeded = true;
    } catch (error) {
      const message = localizeStartingEquipmentError(
        localizeAcquisition,
        error,
        "wayfinder-pf2e.StartingEquipment.Errors.Update"
      );
      this.#setStartingEquipmentFailure(message);
      ui.notifications.warn(message);
    }
    if (
      succeeded &&
      partialIntent &&
      partialWasSafe &&
      canUseStartingEquipmentCommandPartial(this.#requireDraft(), partialIntent)
    ) {
      this.#renderStartingEquipmentPartial(stepId, partialIntent);
    } else {
      this.render({ wayfinderEquipmentUpdate: true });
    }
  }

  async #addStartingEquipmentItem(
    stepId: string,
    sourceUuid: string,
    funding: { readonly lane: "currency" } | { readonly lane: "allowance"; readonly allowanceId: string }
  ): Promise<void> {
    try {
      const plan = this.#cachedRenderPlan;
      if (!plan) throw new TypeError("The current Wayfinder plan is unavailable.");
      const step = plan.steps.find(
        (candidate): candidate is Extract<PendingStep, { kind: "starting-equipment" }> =>
          candidate.id === stepId && candidate.kind === "starting-equipment"
      );
      if (!step) throw new TypeError("The starting-equipment step is no longer in the current plan.");
      const line = await getStartingEquipmentUiAdapter().prepareLine({
        ...this.#startingEquipmentUiRequest(step),
        sourceUuid,
        funding,
      });
      this.#pendingEquipmentFocusIds = [
        equipmentLineFocusId(line.lineId),
        ...(this.#pendingEquipmentFocusIds ?? []),
        STARTING_EQUIPMENT_REVIEW_FOCUS_ID,
      ];
      await this.#executeStartingEquipmentCommand(stepId, { type: "add-line", line });
    } catch (error) {
      if (error instanceof ConfiguredItemHandoffRequiredError) {
        this.#pendingEquipmentFocusIds = ["starting-equipment-handoff"];
        await this.#executeStartingEquipmentCommand(stepId, {
          type: "enter-configured-item-handoff",
          reason: error.reason,
        });
        return;
      }
      const message = localizeStartingEquipmentError(
        localizeAcquisition,
        error,
        "wayfinder-pf2e.StartingEquipment.Errors.Add"
      );
      this.#setStartingEquipmentFailure(message);
      ui.notifications.warn(message);
      this.render({ wayfinderEquipmentUpdate: true });
    }
  }

  async #chooseTitanMaulerEquipment(stepId: string, sourceUuid: string): Promise<void> {
    try {
      const plan = this.#cachedRenderPlan;
      if (!plan) throw new TypeError("The current Wayfinder plan is unavailable.");
      const step = plan.steps.find(
        (candidate): candidate is Extract<PendingStep, { kind: "starting-equipment" }> =>
          candidate.id === stepId && candidate.kind === "starting-equipment"
      );
      if (!step) throw new TypeError("The starting-equipment step is no longer in the current plan.");
      const line = await getStartingEquipmentUiAdapter().prepareTitanMaulerLine({
        ...this.#startingEquipmentUiRequest(step),
        sourceUuid,
      });
      this.#pendingEquipmentFocusIds = [
        equipmentLineFocusId(line.lineId),
        ...(this.#pendingEquipmentFocusIds ?? []),
        STARTING_EQUIPMENT_REVIEW_FOCUS_ID,
      ];
      await this.#executeStartingEquipmentCommand(stepId, { type: "add-line", line });
    } catch (error) {
      const message = localizeStartingEquipmentError(
        localizeAcquisition,
        error,
        "wayfinder-pf2e.StartingEquipment.Errors.ChooseTitanMauler"
      );
      this.#setStartingEquipmentFailure(message);
      ui.notifications.warn(message);
      this.render({ wayfinderEquipmentUpdate: true });
    }
  }

  async #changeStartingEquipmentQuantity(stepId: string, lineId: string, delta: -1 | 1): Promise<void> {
    const line = this.#requireDraft().acquisition?.lines.find((candidate) => candidate.lineId === lineId);
    if (!line) return;
    const quantity = line.price.requestedQuantity + delta;
    if (quantity < 1) {
      await this.#executeStartingEquipmentCommand(stepId, { type: "remove-line", lineId });
      return;
    }
    await this.#executeStartingEquipmentCommand(stepId, { type: "set-quantity", lineId, quantity }, "quantity");
  }

  #equipmentLineRelocationCandidates(lineId: string): string[] {
    const lines = this.#requireDraft().acquisition?.lines ?? [];
    const index = lines.findIndex((line) => line.lineId === lineId);
    const next = index >= 0 ? lines[index + 1] : null;
    const previous = index > 0 ? lines[index - 1] : null;
    return [
      ...(next ? [equipmentLineFocusId(next.lineId)] : []),
      ...(previous ? [equipmentLineFocusId(previous.lineId)] : []),
      STARTING_EQUIPMENT_REVIEW_FOCUS_ID,
    ];
  }

  #setStartingEquipmentFailure(message: string): void {
    this.#statusNote = message;
    this.#statusErrorMessage = message;
    this.#pendingStepFocusId = null;
    this.#pendingControlFocusId = STARTING_EQUIPMENT_STATUS_FOCUS_ID;
    this.#pendingEquipmentFocusIds = null;
  }

  #toggleStartingEquipmentFilter(stepId: string, filterKey: string, value: string): void {
    const current = this.#equipmentFiltersByStepId.get(stepId) ?? {};
    const selected = new Set(current[filterKey] ?? []);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    this.#equipmentFiltersByStepId.set(stepId, {
      ...current,
      [filterKey]: [...selected].sort((left, right) => left.localeCompare(right)),
    });
    this.#equipmentScheduledRenderIntent = "facet";
    this.#equipmentSearchScheduler.schedule(stepId, this.#equipmentSearchByStepId.get(stepId) ?? "");
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
          excludedFeatSlotId: selectionStep.slotId,
          maximumFeatLevel: selectionStep.level,
          skillRanks: snapshot.skillRanks,
          resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
          listActorItems: () => listActorItems(this.actor),
          fetchSelectionDocument,
          extractDocumentSlug,
        });
        return resolveSelection(
          value,
          withRestrictedSpellRarityAccess(
            selectionStep,
            getSpellRarityCeilingSetting(),
            this.#spellRarityAccessGranted(draft, selectionStep)
          ),
          optionContext
        );
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
      resolveSelectionClassHasSpellcasting: (selection) =>
        resolveSelectionClassHasSpellcasting(selection, {
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
      invalidateClassChoicesBySourceChoice: invalidation.invalidateClassChoicesBySourceChoice,
      invalidateGrantSelectionsBySource: invalidation.invalidateGrantSelectionsBySource,
      invalidateFlagChoicesBySource: invalidation.invalidateFlagChoicesBySource,
      invalidateSpellChoicesByDependency: invalidation.invalidateSpellChoicesByDependency,
    });
    await this.#finalizeSelectionCommand(result);
  }

  async #selectClassArchetype(stepId: string, value: string): Promise<void> {
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
          excludedFeatSlotId: selectionStep.slotId,
          maximumFeatLevel: selectionStep.level,
          skillRanks: snapshot.skillRanks,
          resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
          listActorItems: () => listActorItems(this.actor),
          fetchSelectionDocument,
          extractDocumentSlug,
        });
        return resolveSelection(
          value,
          withRestrictedSpellRarityAccess(
            selectionStep,
            getSpellRarityCeilingSetting(),
            this.#spellRarityAccessGranted(draft, selectionStep)
          ),
          optionContext
        );
      },
      selectionExistsOnActor: (selection, selectionStep) => {
        if (selectionStep.kind !== "spell-choice") {
          return false;
        }

        const entry = findSpellcastingEntryForChoice(this.actor, selectionStep.spellChoice);
        const entryId = typeof entry?.id === "string" ? entry.id : null;
        const normalizedUuid = selection.uuid.trim().toLowerCase();
        return (
          !!entryId &&
          listActorItems(this.actor).some(
            (item) =>
              item?.type === "spell" &&
              sourceIdOf(item)?.trim().toLowerCase() === normalizedUuid &&
              actorItemLocationId(item) === entryId
          )
        );
      },
      destinationKeyForSlotId: (slotId) => {
        const spellStep = plan.steps.find((candidate) => candidate.slotId === slotId);
        return spellStep?.kind === "spell-choice" ? spellStep.spellChoice.destination.key : null;
      },
    });
    await this.#finalizeSelectionCommand(result);
  }

  async #toggleSpellRarityAccess(stepId: string): Promise<void> {
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
    if (!input) return;
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
    } catch (error) {
      console.error("PF2E Wayfinder could not record the restricted-spell player attestation", error);
      ui.notifications.warn("Write a reason before saving this note.");
      return;
    }
    this.#statusNote =
      "Restricted spell rarities are available through a player attestation. This is not GM authorization.";
    this.render(false);
  }

  async #removeSpellRarityAttestation(stepId: string): Promise<void> {
    this.#statusNote = null;
    const draft = this.#requireDraft();
    const step = (await this.#buildPlan(inspectActor(this.actor), draft)).steps.find((entry) => entry.id === stepId);
    if (!step) return;
    const attestation = draft.spellRarityAttestations[step.slotId];
    if (!attestation) return;
    const evaluation = evaluateSpellRarityAttestation(this.actor.id, draft, step, getSpellRarityCeilingSetting());
    if (evaluation.granted && (draft.spellChoices[step.slotId] ?? []).length > 0) {
      ui.notifications.warn("Clear the spells chosen for this step before removing its player attestation.");
      return;
    }
    delete draft.spellRarityAttestations[step.slotId];
    this.#statusNote = "The restricted-spell player attestation was removed.";
    this.render(false);
  }

  async #toggleTrainingSkill(stepId: string, slug: string): Promise<void> {
    this.#statusNote = null;
    const step = await this.#findPlanStepBySlotId(stepId);
    if (toggleTrainingSkillSelection(this.#draftAdjustmentState(), step ?? null, slug)) {
      await this.#syncDependentChoicesAfterBuildChange();
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
    const baseSkillRanks = inspectActor(this.actor).skillRanks;
    const projectedSkillRanksByStepId = Object.fromEntries(
      await Promise.all(
        plan.steps.flatMap((step) =>
          step.kind === "skill-training"
            ? [
                projectSkillRanks(this.#requireDraft(), step.slotId, {
                  baseSkillRanks,
                  resolveDocument: (itemType) => this.#resolveDraftOrActorDocument(itemType),
                  localize: (value) => game.i18n.localize(value),
                }).then((ranks) => [step.slotId, ranks] as const),
              ]
            : []
        )
      )
    );
    const trainingChanged = syncSkillTrainingSelections(
      this.#draftAdjustmentState(),
      plan.steps,
      projectedSkillRanksByStepId
    );
    const languageChanged = syncLanguageChoiceSelections(this.#draftAdjustmentState(), effectiveBuildState, plan.steps);
    const spellAttestationsChanged =
      (await this.#selectionInvalidationService().invalidateOrphanedSpellChoices()).length > 0;

    if (spellAttestationsChanged) {
      this.#statusNote =
        "Wayfinder removed a player spell attestation whose subject is no longer in the projected build.";
    } else if (trainingChanged && languageChanged) {
      this.#statusNote =
        "Wayfinder marked drafted skill training and language choices for review after the projected build changed.";
    } else if (trainingChanged) {
      this.#statusNote =
        "Wayfinder marked drafted skill training choices for review after the projected build changed.";
    } else if (languageChanged) {
      this.#statusNote = "Wayfinder marked drafted language choices for review after the projected build changed.";
    }
    this.#statusNote = (await this.#synchronizeTitanMaulerLine()) ?? this.#statusNote;
  }

  #abilityLabel(attribute: AbilityKey): string {
    const abilities = getPf2eConfig()?.abilities;
    return game.i18n.localize(abilities?.[attribute] ?? attribute.toUpperCase());
  }

  async #resolveDraftOrActorDocument(
    itemType: SingletonItemType,
    draft = this.#requireDraft()
  ): Promise<ResolvedBuildStateDocument | null> {
    return getEffectiveSingletonDocument(this.actor, draft, itemType);
  }

  async #resolveDraftOrActorArcaneSchoolDocument(draft = this.#requireDraft()): Promise<ArcaneSchoolSourceLike | null> {
    const draftSelection = Object.values(draft.branchSelections).find((selection) =>
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
      }
      return;
    }

    if (result.kind !== "changed") {
      return;
    }

    this.#statusNote = (await this.#synchronizeTitanMaulerLine()) ?? result.statusNote;
    if (result.shouldAdvance) {
      await this.#moveStep(1);
      return;
    }

    if (result.shouldRender) {
      this.render(false);
    }
  }

  async #synchronizeTitanMaulerLine(): Promise<string | null> {
    const draft = this.#requireDraft();
    const acquisition = draft.acquisition;
    if (!acquisition) return null;
    const expectedDraftFingerprint = draftFingerprint(draft);
    const result = await getFoundryEquipmentAcquisitionRuntime().synchronizeTitanMaulerLine({
      actor: this.actor,
      characterDraft: draft,
      acquisition,
    });
    if (
      this.#requireDraft() !== draft ||
      !commitTitanMaulerLineSynchronization({
        draft,
        expectedAcquisition: acquisition,
        expectedDraftFingerprint,
        currentDraftFingerprint: draftFingerprint(draft),
        result,
      })
    ) {
      return null;
    }
    switch (result.reason) {
      case "build-changed":
        return localizeAcquisition("wayfinder-pf2e.StartingEquipment.Status.TitanBuildChanged");
      case "size-changed":
        return localizeAcquisition("wayfinder-pf2e.StartingEquipment.Status.TitanSizeChanged");
      case "source-changed":
        return localizeAcquisition("wayfinder-pf2e.StartingEquipment.Status.TitanSourceChanged");
      case "verification-failed":
        return localizeAcquisition("wayfinder-pf2e.StartingEquipment.Status.TitanVerificationFailed");
      default:
        return null;
    }
  }

  async #evaluateStep(
    step: PendingStep,
    effectiveBuildState?: EffectiveBuildState,
    draft = this.#requireDraft(),
    steps?: PendingStep[],
    skillRanks?: Record<string, number>
  ): Promise<WayfinderStepEvaluation> {
    const buildState = effectiveBuildState ?? (await getEffectiveBuildState(this.actor, draft));
    const evaluation = await evaluateWayfinderStep(step, draft, this.#recentlyInvalidatedStepIds, buildState);
    if (step.kind !== "spell-choice") {
      return evaluation;
    }

    const attestation = evaluateSpellRarityAttestation(this.actor.id, draft, step, getSpellRarityCeilingSetting());
    if (attestation.state === "unresolved" || attestation.state === "stale") {
      const message =
        attestation.state === "unresolved"
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

  #isTrainingStepComplete(step: PendingStep): boolean {
    return step.kind === "skill-training" && isTrainingStepCompleteFromDraft(step, this.#requireDraft());
  }

  async #adjustTargetLevel(delta: number): Promise<void> {
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

  async #saveDraft(): Promise<void> {
    if (this.#reconcileLiveRecoveryDraft() === "conflict") {
      this.render(false);
      return;
    }
    try {
      this.#draftPersistence.schedule(this.#requireDraft(), { force: true });
      if (this.#draftPersistence.state.phase === "error") {
        await this.#draftPersistence.retry();
      } else {
        await this.#draftPersistence.flush();
      }
      ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.SavedDraft"));
    } catch (error) {
      console.error("PF2E Wayfinder failed to save draft", error);
      ui.notifications.error(
        buildDraftSaveView(this.#draftPersistence.state).message ??
          "Wayfinder could not save this draft. Review the save status."
      );
    }
    this.render(false);
  }

  async #retryDraftSave(): Promise<void> {
    if (this.#reconcileLiveRecoveryDraft() === "conflict") {
      this.render(false);
      return;
    }
    try {
      this.#draftPersistence.schedule(this.#requireDraft());
      await this.#draftPersistence.retry();
      ui.notifications.info(game.i18n.localize("wayfinder-pf2e.Notifications.SavedDraft"));
    } catch (error) {
      console.error("PF2E Wayfinder failed to retry draft save", error);
      ui.notifications.error(
        buildDraftSaveView(this.#draftPersistence.state).message ?? "Wayfinder still could not save this draft."
      );
    }
    this.render(false);
  }

  #draftDidChange(): void {
    const draft = this.#requireDraft();
    if (draft.acquisition?.currencyConvergenceWitness) {
      draft.acquisition = { ...draft.acquisition, currencyConvergenceWitness: null };
    }
    draft.applyAttemptStepIds = [];
    draft.applyCompletedStepIds = [];
    draft.applyRecoveryActorUpdate = {};
    draft.applySpellRarityAttestations = [];
    this.#draftPersistence.schedule(draft);
    this.#patchDraftSaveStatus(this.#draftPersistence.state);
  }

  #allowDraftMutation(): boolean {
    if (this.#reconcileLiveRecoveryDraft() === "conflict") {
      this.render(false);
      return false;
    }
    if (!hasApplyRecoveryState(this.#requireDraft())) {
      return true;
    }
    const message = localizeAcquisition("wayfinder-pf2e.StartingEquipment.Apply.RecoveryLocked");
    this.#setStartingEquipmentFailure(message);
    ui.notifications.warn(message);
    this.render(false);
    return false;
  }

  #reconcileLiveRecoveryDraft(
    defaultTargetLevel = inspectActor(this.actor).level
  ): "none" | "acknowledge" | "adopt" | "conflict" {
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
    this.#setStartingEquipmentFailure(localizeAcquisition("wayfinder-pf2e.StartingEquipment.Apply.RecoveryConflict"));
    return "conflict";
  }

  #queueExternalDraftRefresh(): void {
    const queued = this.#semanticCommands.enqueue(async () => this.#refreshPersistedDraft());
    if (queued !== null) {
      void queued.catch((error: unknown) => {
        console.error("PF2E Wayfinder failed to reconcile an externally updated draft", error);
      });
    }
  }

  async #refreshPersistedDraft(): Promise<void> {
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

  #onDraftSaveStateChange(state: DraftSaveState): void {
    if (state.phase === "error" && this.#lastDraftSavePhase !== "error") {
      ui.notifications.error(buildDraftSaveView(state).message ?? "Wayfinder could not autosave the latest draft.");
    }
    this.#lastDraftSavePhase = state.phase;
    this.#patchDraftSaveStatus(state);
  }

  #patchDraftSaveStatus(state: DraftSaveState): void {
    const root = this.element;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    const view = buildDraftSaveView(state);
    const status = root.querySelector<HTMLElement>("[data-wayfinder-save-status]");
    if (status) {
      status.hidden = !view.visible;
      status.dataset.phase = view.phase;
      status.classList.remove("idle", "saving", "saved", "error");
      status.classList.add(view.phase);
      status.setAttribute("role", view.error ? "alert" : "status");
      status.setAttribute("aria-live", view.live);
      const message = status.querySelector<HTMLElement>("[data-wayfinder-save-message]");
      if (message) {
        message.textContent = view.message ?? game.i18n.localize(view.labelKey);
      }
      const icon = status.querySelector<HTMLElement>("i");
      if (icon) {
        icon.className = view.saving
          ? "fa-solid fa-spinner fa-spin"
          : view.saved
            ? "fa-solid fa-circle-check"
            : "fa-solid fa-triangle-exclamation";
      }
      const retry = status.querySelector<HTMLButtonElement>("[data-wayfinder-action='retry-draft-save']");
      if (retry) {
        retry.hidden = !view.retryable;
      }
    }

    const apply = root.querySelector<HTMLButtonElement>("[data-wayfinder-action='apply-draft']");
    if (apply) {
      apply.disabled =
        apply.dataset.wayfinderReadinessReady !== "true" || view.error || this.#semanticCommands.barrierActive;
    }
  }

  async #applyDraft(): Promise<boolean> {
    this.#statusNote = null;
    this.#statusErrorMessage = null;
    if (this.#reconcileLiveRecoveryDraft() === "conflict") {
      ui.notifications.warn(localizeAcquisition("wayfinder-pf2e.StartingEquipment.Apply.RecoveryConflict"));
      return false;
    }
    const draft = cloneData(this.#requireDraft());
    const applyCandidate = { value: null as DraftState | null };
    let finalizedDespiteApplyError = false;
    let result: ApplyDraftLifecycleResult;
    try {
      const snapshot = inspectActor(this.actor);
      const acquisitionSmokeCheckpointHook = acquisitionSmokeCheckpointHookFor(this.actor, draft);
      const acquisitionSession = draft.acquisition ? this.#createAcquisitionExecutionSession(draft) : null;
      const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
      const plan = await this.#buildPlan(snapshot, draft);
      const steps = cloneData(plan.steps);
      const effectiveBuildState = await getEffectiveBuildState(this.actor, draft);
      const spellRarityCeiling = getSpellRarityCeilingSetting();
      const recovering = hasApplyRecoveryState(draft);
      const computedSpellRarityAttestations = buildAppliedSpellRarityAttestations(
        this.actor.id,
        draft,
        recovering ? undefined : steps,
        recovering ? undefined : spellRarityCeiling
      );
      const appliedSpellRarityAttestations = recovering
        ? cloneData(draft.applySpellRarityAttestations)
        : computedSpellRarityAttestations;
      const spellRarityBlockers = (
        recovering
          ? listSpellRarityRecoveryProblems(this.actor.id, draft)
          : listSpellRarityAttestationProblems(this.actor.id, draft, steps, spellRarityCeiling)
      ).map((problem) => ({
        code: "access-attestation" as const,
        stepId: problem.stepId,
        slotId: problem.slotId,
        title: problem.title,
        message: problem.message,
      }));
      const physicalGrantBlockers = physicalGrantCoverageIssues(draft, steps);
      result = await applyDraftLifecycle({
        actorName: this.actor.name,
        currentLevel: snapshot.level,
        draft,
        existingCompletedStepIds: state.completedStepIds,
        existingCharacterHistory: state.existingCharacterHistory,
        appliedSpellRarityAttestations,
        steps,
        evaluateStep: (step) => this.#evaluateStep(step, effectiveBuildState, draft, steps, snapshot.skillRanks),
        additionalBlockers: [...spellRarityBlockers, ...physicalGrantBlockers],
        acquisitionExecutionAvailable: acquisitionSession !== null,
        assertAcquisitionApplyAuthority: () => {
          if (!draft.acquisition) return;
          assertEquipmentApplyAuthority({ actor: this.actor, acquisition: draft.acquisition });
        },
        reviewLines: buildSpellRarityAttestationReviewLines(appliedSpellRarityAttestations),
        confirmApply: confirmWayfinderApply,
        beforeApply: (applyAttemptDraft) =>
          persistApplyCandidateIfCurrent(
            {
              actorSnapshot: snapshot,
              stateSnapshot: state,
              draftSnapshot: draft,
              stepSnapshots: steps,
              currentDraft: () => this.#draft,
              inspectCurrentActor: () => inspectActor(this.actor),
              readCurrentState: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
              buildCurrentSteps: async (currentSnapshot, currentDraft) =>
                (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
            },
            async () => {
              assertCanUseWayfinder(this.actor);
              this.#draftPersistence.schedule(applyAttemptDraft, { force: true });
              await this.#draftPersistence.pauseAndFlush();
              const persistedApplyCandidate = readPersistedDraftSnapshot(this.actor, inspectActor(this.actor).level);
              this.#draftWriteGuard.assertCurrent(persistedApplyCandidate);
              if (!persistedApplyCandidate) throw new WayfinderDraftWriteConflictError();
              applyCandidate.value = cloneData(persistedApplyCandidate);
            }
          ),
        applyDraftToActor: (buildFinalActorUpdate) => {
          return applyDraftToActor(this.actor, draft, steps, {
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
                buildCurrentSteps: async (currentSnapshot, currentDraft) =>
                  (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
              });
            },
            resolveFinalActorUpdate: (evidence) =>
              buildFinalActorUpdate(normalizeState(this.actor.getFlag(MODULE_ID, "state")), evidence),
            beforeFinalActorUpdate: () => this.#assertPersistedApplyCandidateCurrent(),
            persistFinalActorUpdate: (actorUpdate) =>
              updateActorWithPersistedDraftPrecondition(
                this.actor,
                actorUpdate,
                capturePersistedDraftPrecondition(this.actor, inspectActor(this.actor).level, this.#draftWriteGuard)
              ),
            validateActorAuthority: canUseWayfinder,
            assertAcquisitionApplyAuthority: (actor, currentDraft) => {
              if (!currentDraft.acquisition) return;
              assertEquipmentApplyAuthority({ actor, acquisition: currentDraft.acquisition });
              const reviewed = currentDraft.acquisition.policySnapshot;
              const current = getFoundryEquipmentAcquisitionRuntime().resolveCurrentPolicySnapshot(
                actor,
                currentDraft.acquisition
              );
              if (!reviewed || !acquisitionPolicyMaterialMatches(reviewed, current)) {
                throw new Error("Starting-equipment authority changed before Apply could begin.");
              }
            },
            persistAcquisitionCurrencyConvergenceWitness: async (witness) => {
              const lockedApplyCandidate = applyCandidate.value;
              if (!lockedApplyCandidate?.acquisition) {
                throw new Error("Currency convergence requires the persisted Apply candidate.");
              }
              const currentLevel = inspectActor(this.actor).level;
              const currentCandidate = readPersistedDraftSnapshot(this.actor, currentLevel);
              this.#draftWriteGuard.assertCurrent(currentCandidate);
              if (!currentCandidate || JSON.stringify(currentCandidate) !== JSON.stringify(lockedApplyCandidate)) {
                throw new WayfinderDraftWriteConflictError();
              }

              const enrichedCandidate = {
                ...cloneData(lockedApplyCandidate),
                acquisition: recordAcquisitionCurrencyConvergenceWitness(lockedApplyCandidate.acquisition, witness),
              };
              await saveDraftWithWriteGuard(this.actor, enrichedCandidate, currentLevel, this.#draftWriteGuard);
              const persistedEnrichedCandidate = readPersistedDraftSnapshot(this.actor, currentLevel);
              this.#draftWriteGuard.assertCurrent(persistedEnrichedCandidate);
              if (!persistedEnrichedCandidate) throw new WayfinderDraftWriteConflictError();
              applyCandidate.value = cloneData(persistedEnrichedCandidate);
            },
            spellRarityCeiling,
            validSkillSlugs: new Set(Object.keys(CONFIG.PF2E?.skills ?? {})),
            validateSelectionEligibility: (selection, step) =>
              this.#validateSelectionEligibility(
                selection,
                step,
                draft,
                steps,
                snapshot.skillRanks,
                this.#applySpellRarityCeiling(draft, step, recovering)
              ),
            prepareClassGrantPlan: (actor, currentDraft, currentSteps) =>
              prepareCurrentClassGrantPlan(
                actor,
                currentDraft,
                currentSteps,
                currentClassGrantProjectionOptions(actor, currentDraft)
              ),
            executeAcquisitionItems: acquisitionSession?.executeAcquisitionItems,
            executeAcquisitionCurrency: acquisitionSession?.executeAcquisitionCurrency,
            verifyAcquisitionOutcome: acquisitionSession?.verifyAcquisitionOutcome,
            readCurrentAcquisitionHistory: acquisitionSession?.readCurrentAcquisitionHistory,
            onCheckpoint: acquisitionSmokeCheckpointHook,
          }).then(() => undefined);
        },
        finalizeRecoveredDraft: (recoveryActorUpdate, buildFinalActorUpdate) => {
          return finalizeRecoveredDraftOnActor(this.actor, {
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
                buildCurrentSteps: async (currentSnapshot, currentDraft) =>
                  (await this.#buildPlan(currentSnapshot, currentDraft)).steps,
              });
            },
            resolveFinalActorUpdate: (evidence) =>
              buildFinalActorUpdate(normalizeState(this.actor.getFlag(MODULE_ID, "state")), evidence),
            beforeFinalActorUpdate: () => this.#assertPersistedApplyCandidateCurrent(),
            persistFinalActorUpdate: (actorUpdate) =>
              updateActorWithPersistedDraftPrecondition(
                this.actor,
                actorUpdate,
                capturePersistedDraftPrecondition(this.actor, inspectActor(this.actor).level, this.#draftWriteGuard)
              ),
            recoveryActorUpdate,
            validateActorAuthority: canUseWayfinder,
            assertAcquisitionApplyAuthority: (actor) => {
              if (!draft.acquisition) return;
              assertEquipmentApplyAuthority({ actor, acquisition: draft.acquisition });
            },
            classGrantRecovery: draft.acquisition
              ? {
                  kind: "required",
                  preparePlan: (actor) =>
                    prepareCurrentClassGrantPlan(actor, draft, steps, currentClassGrantProjectionOptions(actor, draft)),
                  verifyAcquisitionRecovery: ({ actor, plan, finalClassGrantReconciliation }) =>
                    acquisitionSession!.prepareRecoveredAcquisitionOutcome({
                      actor,
                      draft,
                      classGrantPlan: plan,
                      finalClassGrantReconciliation,
                    }),
                }
              : { kind: "none" },
            onCheckpoint: acquisitionSmokeCheckpointHook,
          }).then(() => undefined);
        },
      });
    } catch (error) {
      this.#draftPersistence.resume();
      const persistedApplyCandidate = applyCandidate.value;
      let draftWriteConflict =
        error instanceof WayfinderDraftWriteConflictError
          ? error
          : error instanceof DraftApplyPhaseError && error.cause instanceof WayfinderDraftWriteConflictError
            ? error.cause
            : null;
      if (!draftWriteConflict && persistedApplyCandidate) {
        const currentSnapshot = inspectActor(this.actor);
        const currentDraft = readPersistedDraftSnapshot(this.actor, currentSnapshot.level);
        try {
          assertFailedApplyRecoveryCandidateCurrent(
            this.#draftWriteGuard,
            currentDraft,
            error instanceof DraftApplyPhaseError ? error.phase : null
          );
        } catch (candidateConflict) {
          if (candidateConflict instanceof WayfinderDraftWriteConflictError) {
            draftWriteConflict = candidateConflict;
          } else {
            throw candidateConflict;
          }
        }
      }
      if (draftWriteConflict) {
        const currentSnapshot = inspectActor(this.actor);
        const currentDraft = readPersistedDraftSnapshot(this.actor, currentSnapshot.level);
        this.#draftWriteGuard.acceptCurrent(currentDraft);
        this.#draft = currentDraft ? cloneData(currentDraft) : createEmptyDraft(currentSnapshot.level);
        this.#setStartingEquipmentFailure(draftWriteConflict.message);
        ui.notifications.warn(draftWriteConflict.message);
        this.render(false);
        return false;
      }
      if (persistedApplyCandidate) {
        const currentSnapshot = inspectActor(this.actor);
        const currentState = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
        const confirmedAfterBoundary =
          error instanceof DraftApplyPhaseError &&
          (error.checkpoint?.checkpointId === "write:final-actor-update:after" ||
            error.checkpoint?.checkpointId === "phase:finalize-actor:after");
        const completedAcquisitionManifest = currentState.completedAcquisitionManifest;
        const intendedAcquisitionManifest =
          error instanceof DraftApplyPhaseError && error.intendedFinalActorUpdate
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
          [...persistedApplyCandidate.applyCompletedStepIds, ...persistedApplyCandidate.applyAttemptStepIds].every(
            (stepId) => currentState.completedStepIds.includes(stepId)
          );
        if (finalizedDespiteApplyError) {
          this.#draft = createEmptyDraft(currentSnapshot.level);
        } else {
          this.#draftWriteGuard.acceptCurrent(readPersistedDraftSnapshot(this.actor, currentSnapshot.level));
          let recoverableDraft = cloneData(persistedApplyCandidate);
          if (error instanceof DraftApplyPhaseError) {
            recoverableDraft.applyRecoveryActorUpdate = cloneData(error.recoveryActorUpdate);
            if (recoverableDraft.acquisition) {
              recoverableDraft.acquisition = recordClassGrantReconciliations(
                recoverableDraft.acquisition,
                error.completedClassGrantReconciliations
              );
              if (error.acquisitionCurrencyConvergenceWitness) {
                recoverableDraft.acquisition = recordAcquisitionCurrencyConvergenceWitness(
                  recoverableDraft.acquisition,
                  error.acquisitionCurrencyConvergenceWitness
                );
              }
            }
          }
          if (currentSnapshot.level < recoverableDraft.targetLevel) {
            try {
              const pendingPlan = await this.#buildPlan(currentSnapshot, recoverableDraft);
              recoverableDraft = buildApplyAttemptDraft(recoverableDraft, pendingPlan.steps);
            } catch (recoveryError) {
              console.error("PF2E Wayfinder could not classify the partial Apply draft", recoveryError);
            }
          }
          this.#draft = recoverableDraft;
          try {
            this.#draftPersistence.schedule(recoverableDraft, { force: true });
            await this.#draftPersistence.flush();
          } catch (persistenceError) {
            console.error("PF2E Wayfinder could not restore the failed Apply draft", persistenceError);
          }
        }
      }
      if (error instanceof WayfinderDraftNotReadyError) {
        const blocker = error.blockers[0];
        this.#activeStepId = blocker?.stepId ?? this.#activeStepId;
        this.#pendingStepFocusId = blocker?.stepId ?? null;
        const message =
          blocker?.code === "equipment-review"
            ? localizeAcquisition("wayfinder-pf2e.StartingEquipment.Apply.NotReady")
            : (blocker?.message ?? error.message);
        this.#setStartingEquipmentFailure(message);
        ui.notifications.warn(game.i18n.localize("wayfinder-pf2e.Notifications.MissingSelections"));
        this.render(false);
        return false;
      }
      if (error instanceof WayfinderActorAuthorityError) {
        this.#setStartingEquipmentFailure(error.message);
        ui.notifications.warn(error.message);
        this.render(false);
        return false;
      }
      if (error instanceof WayfinderApplyDriftError) {
        this.#setStartingEquipmentFailure(error.message);
        ui.notifications.warn(error.message);
        this.render(false);
        return false;
      }
      console.error("PF2E Wayfinder failed to apply draft", error);
      const failureMessage = draft.acquisition
        ? localizeStartingEquipmentError(
            localizeAcquisition,
            error,
            finalizedDespiteApplyError
              ? "wayfinder-pf2e.StartingEquipment.Apply.LateError"
              : hasApplyRecoveryState(this.#requireDraft())
                ? "wayfinder-pf2e.StartingEquipment.Apply.Partial"
                : "wayfinder-pf2e.StartingEquipment.Apply.Failed"
          )
        : finalizedDespiteApplyError
          ? "The actor reached the reviewed final state, but Foundry reported a late Apply error. Review the actor before closing."
          : hasApplyRecoveryState(this.#requireDraft())
            ? "Wayfinder partially applied this draft. Retry Apply without changing choices; details are in the console."
            : "Wayfinder could not apply this draft. The draft was kept for review; details are in the console.";
      this.#setStartingEquipmentFailure(failureMessage);
      ui.notifications.error(game.i18n.localize("wayfinder-pf2e.Notifications.ApplyFailed"));
      this.render(false);
      acquisitionSmokeApplyFailureHandledFor(this.actor, draft, error);
      return false;
    }

    if (result.kind === "warning") {
      this.#draftPersistence.resume();
      const warningMessage =
        result.blockers[0]?.code === "equipment-review"
          ? localizeAcquisition("wayfinder-pf2e.StartingEquipment.Apply.NotReady")
          : (result.blockers[0]?.message ?? null);
      if (warningMessage) {
        this.#setStartingEquipmentFailure(warningMessage);
      }
      const notificationKey =
        result.warning === "no-pending-steps"
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

  #createAcquisitionExecutionSession(characterDraft: DraftState) {
    const applyingUser = currentApplyingUser();
    const environment = currentAcquisitionEnvironment();
    return createEquipmentAcquisitionExecutionSession({
      characterDraft,
      runtime: getFoundryEquipmentAcquisitionRuntime(),
      readHistory: () => normalizeState(this.actor.getFlag(MODULE_ID, "state")),
      assertApplyAuthority: ({ actor, draft }) => assertEquipmentApplyAuthority({ actor, acquisition: draft }),
      readApplyingUser: () => applyingUser,
      readEnvironment: () => environment,
    });
  }

  #assertPersistedApplyCandidateCurrent(): void {
    const currentSnapshot = inspectActor(this.actor);
    this.#draftWriteGuard.assertCurrent(readPersistedDraftSnapshot(this.actor, currentSnapshot.level));
  }

  #spellRarityAccessGranted(draft: DraftState, step: PendingStep): boolean {
    return evaluateSpellRarityAttestation(this.actor.id, draft, step, getSpellRarityCeilingSetting()).granted;
  }

  #applySpellRarityCeiling(draft: DraftState, step: PendingStep, recovering: boolean): SpellRarityCeiling | null {
    if (recovering && step.kind === "spell-choice" && draft.spellRarityAttestations[step.slotId]) {
      const frozen = frozenSpellRarityAttestationForStep(this.actor.id, draft, step);
      if (frozen) return frozen.subject.worldRarityCeiling;
      return getSpellRarityCeilingSetting() === "unique" ? "unique" : null;
    }
    return getSpellRarityCeilingSetting();
  }

  async #validateSelectionEligibility(
    selection: SelectionRef,
    step: PendingStep,
    draft: DraftState,
    steps: PendingStep[],
    skillRanks: Record<string, number>,
    spellRarityCeiling: SpellRarityCeiling | null = getSpellRarityCeilingSetting()
  ): Promise<boolean> {
    if (spellRarityCeiling === null) return false;
    const normalizedUuid = selection.uuid.trim().toLowerCase();
    const alreadyApplied = listActorItems(this.actor).some((item) => {
      if (sourceIdOf(item)?.trim().toLowerCase() !== normalizedUuid) return false;
      const wayfinderFlags = (item?.flags as Record<string, { slotId?: unknown }> | undefined)?.[MODULE_ID];
      if (wayfinderFlags?.slotId === selection.slotId) return true;
      if (step.kind !== "spell-choice") return false;
      const entry = findSpellcastingEntryForChoice(this.actor, step.spellChoice);
      return typeof entry?.id === "string" && actorItemLocationId(item) === entry.id;
    });
    if (alreadyApplied) return true;

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
    const optionStep =
      step.kind === "spell-choice"
        ? withRestrictedSpellRarityAccess(
            step,
            spellRarityCeiling,
            evaluateSpellRarityAttestation(this.actor.id, draft, step, spellRarityCeiling).granted
          )
        : step;
    const options = await getOptionsForStep(optionStep, optionContext);
    return options.some((option) => option.uuid.trim().toLowerCase() === normalizedUuid);
  }

  async #importExistingHistory(): Promise<void> {
    const history = await buildExistingCharacterHistory(this.actor, {
      gradualBoostsEnabled: inspectActor(this.actor).gradualBoostsEnabled,
    });
    await enqueueActorOperation(this.actor, async () => {
      const currentLevel = inspectActor(this.actor).level;
      assertDraftSideEffectAllowed(this.actor, currentLevel, this.#draftWriteGuard);
      const state = normalizeState(this.actor.getFlag(MODULE_ID, "state"));
      await updateActorWithPersistedDraftPrecondition(
        this.actor,
        { [STATE_FLAG]: withExistingCharacterHistory(state, history) },
        captureDraftSideEffectPrecondition(this.actor, currentLevel, this.#draftWriteGuard)
      );
    });
    const mappedCount = history.entries.filter((entry) => entry.status === "mapped").length;
    const reviewCount = history.entries.length - mappedCount;
    this.#statusNote = `Mapped ${mappedCount} observable choices; ${reviewCount} historical decisions need review.`;
    ui.notifications.info("Wayfinder mapped the source-backed history it could verify from this actor.");
    this.render(false);
  }

  async #clearDraft(): Promise<void> {
    this.#statusNote = null;
    const snapshot = inspectActor(this.actor);
    const draft = this.#requireDraft();
    let result: Awaited<ReturnType<typeof clearDraftLifecycle>>;
    try {
      result = await clearDraftLifecycle({
        currentLevel: snapshot.level,
        draft,
        confirmClear: confirmWayfinderClear,
        clearPersistedDraft: () =>
          this.#draftPersistence.discardAndRun(() =>
            enqueueActorOperation(this.actor, async () => {
              await clearDraftWithWriteGuard(this.actor, snapshot.level, this.#draftWriteGuard);
            })
          ),
      });
    } catch (error) {
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

  #togglePickerFilterMenu(stepId: string, filterKind: PickerFilterMenuKind): void {
    this.#statusNote = null;
    if (this.#openPickerFilterMenu?.stepId === stepId && this.#openPickerFilterMenu.filterKind === filterKind) {
      this.#openPickerFilterMenu = null;
    } else {
      this.#openPickerFilterMenu = { stepId, filterKind };
    }
    this.render(false);
  }

  #togglePickerFilter(stepId: string, filterKind: PickerFilterKind, value: string): void {
    this.#statusNote = null;
    const next = togglePickerFilterValue(
      this.#pickerFiltersByStepId.get(stepId) ?? emptyPickerFilterState(),
      filterKind,
      value
    );
    if (!next.levelRange && next.rarity.length === 0 && next.source.length === 0) {
      this.#pickerFiltersByStepId.delete(stepId);
    } else {
      this.#pickerFiltersByStepId.set(stepId, next);
    }
    this.render(false);
  }

  #setPickerLevelRange(stepId: string, minimum: number, maximum: number): void {
    this.#statusNote = null;
    const current = normalizePickerFilterState(this.#pickerFiltersByStepId.get(stepId) ?? emptyPickerFilterState());
    this.#pickerFiltersByStepId.set(stepId, {
      ...current,
      levelRange: { minimum, maximum },
    });
    this.render(false);
  }

  #clearPickerFilters(stepId: string): void {
    this.#statusNote = null;
    if (this.#pickerFiltersByStepId.delete(stepId)) {
      this.render(false);
    }
  }
}

function isPickerSearchRender(options: WayfinderRenderOptions): boolean {
  return pickerSearchRequest(options) !== null;
}

function pickerSearchRequest(options: WayfinderRenderOptions): PickerSearchRequest | null {
  if (
    options.parts?.length !== PICKER_SEARCH_PARTS.length ||
    !PICKER_SEARCH_PARTS.every((partId, index) => options.parts?.[index] === partId)
  ) {
    return null;
  }

  const candidate = options.wayfinderPickerRequest;
  if (
    !candidate ||
    !Number.isInteger(candidate.viewRevision) ||
    !Number.isInteger(candidate.sourceRevision) ||
    typeof candidate.stepId !== "string" ||
    typeof candidate.query !== "string"
  ) {
    return null;
  }
  return candidate;
}

function startingEquipmentRenderRequest(options: WayfinderRenderOptions): StartingEquipmentRenderRequest | null {
  const candidate = options.wayfinderEquipmentRequest;
  if (
    !candidate ||
    !Number.isInteger(candidate.viewRevision) ||
    !Number.isInteger(candidate.sourceRevision) ||
    typeof candidate.stepId !== "string" ||
    typeof candidate.query !== "string" ||
    !isStartingEquipmentRenderIntent(candidate.intent)
  ) {
    return null;
  }
  const expectedParts = startingEquipmentPartsForIntent(candidate.intent);
  if (
    options.parts?.length !== expectedParts.length ||
    !expectedParts.every((partId, index) => options.parts?.[index] === partId)
  ) {
    return null;
  }
  return candidate;
}

function isStartingEquipmentRenderIntent(value: unknown): value is StartingEquipmentRenderIntent {
  return value === "search" || value === "facet" || value === "preview" || value === "quantity" || value === "recipe";
}

function numericRenderOption(value: unknown): number {
  return Number.isInteger(value) ? Number(value) : -1;
}

function hasPickerPartTargets(root: HTMLElement, stepId: string): boolean {
  const countTargets = [...root.querySelectorAll<HTMLElement>(`[data-application-part="${PICKER_COUNT_PART}"]`)];
  const resultTargets = [...root.querySelectorAll<HTMLElement>(`[data-application-part="${PICKER_RESULTS_PART}"]`)];
  return (
    countTargets.length === 1 &&
    resultTargets.length === 1 &&
    countTargets[0]?.dataset.stepId === stepId &&
    resultTargets[0]?.dataset.stepId === stepId
  );
}

function hasStartingEquipmentPartTargets(
  root: HTMLElement,
  stepId: string,
  parts: readonly StartingEquipmentRenderPart[]
): boolean {
  return parts.every((part) => {
    const targets = [...root.querySelectorAll<HTMLElement>(`[data-application-part="${part}"]`)];
    return targets.length === 1 && targets[0]?.dataset.stepId === stepId;
  });
}

function actorItemLocationId(item: BuildStateActorItem): string | null {
  const rawLocation = item?.system?.location;
  if (typeof rawLocation === "string") {
    return rawLocation;
  }
  if (rawLocation && typeof rawLocation === "object" && "value" in rawLocation) {
    return typeof rawLocation.value === "string" ? rawLocation.value : null;
  }
  return null;
}

function draftFingerprint(draft: DraftState | null): string {
  return draft ? JSON.stringify(draft) : "null";
}

function getPf2eConfig(): Pf2eConfigLike | null {
  return (globalThis as WayfinderGlobals).CONFIG?.PF2E ?? null;
}

function currentApplyingUser(): { readonly userId: string; readonly userName: string } {
  return {
    userId: requiredRuntimeLabel(game.user?.id, "applying user ID"),
    userName: requiredRuntimeLabel(game.user?.name, "applying user name"),
  };
}

function currentClassGrantProjectionOptions(actor: unknown, draft: DraftState) {
  const acquisition = draft.acquisition;
  if (!acquisition) return {};
  return {
    resolveCharacterAccessRef: (sourceUuid: string) =>
      getFoundryEquipmentAcquisitionRuntime().resolveCurrentCharacterAccessRef({
        actor,
        characterDraft: draft,
        acquisition,
        sourceUuid,
      }),
  };
}

function currentAcquisitionEnvironment(): {
  readonly foundryVersion: string;
  readonly pf2eVersion: string;
  readonly moduleVersion: string;
} {
  return {
    foundryVersion: requiredRuntimeLabel(game.version, "Foundry version"),
    pf2eVersion: requiredRuntimeLabel(game.system?.id === "pf2e" ? game.system.version : null, "PF2E version"),
    moduleVersion: requiredRuntimeLabel(game.modules?.get?.(MODULE_ID)?.version, "Wayfinder version"),
  };
}

function requiredRuntimeLabel(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Starting-equipment Apply requires the current ${label}.`);
  }
  return value.trim();
}

async function confirmWayfinderApply(message: string): Promise<boolean> {
  const foundryApi = foundry as unknown as FoundryDialogApiLike;
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

interface SpellRarityAttestationInput {
  claimedBasis: SpellRarityAttestationBasis;
  reason: string;
}

async function requestSpellRarityAttestationInput(): Promise<SpellRarityAttestationInput | null> {
  const foundryApi = foundry as unknown as FoundryDialogApiLike;
  const dialog = foundryApi.applications?.api?.DialogV2;
  if (dialog?.input) {
    const result = await dialog.input({
      window: { title: "Write an access note" },
      modal: true,
      content: `
        <fieldset class="wayfinder-attestation-input">
          <legend>Where does the access come from?</legend>
          <label><input type="radio" name="claimedBasis" value="rules-access" checked> A character or rules Access</label>
          <label><input type="radio" name="claimedBasis" value="reported-gm-permission"> My GM said yes</label>
        </fieldset>
        <label class="wayfinder-attestation-reason">
          Say a bit more
          <textarea name="reason" required maxlength="500" aria-describedby="wayfinder-attestation-disclaimer"></textarea>
        </label>
        <p id="wayfinder-attestation-disclaimer">This goes on the record as your word. Wayfinder does not check it.</p>
      `,
      ok: { label: "Save note", icon: "fa-solid fa-pen" },
    });
    if (!isRecord(result)) return null;
    return normalizeSpellRarityAttestationInput(result.claimedBasis, result.reason);
  }

  if (typeof globalThis.prompt !== "function") return null;
  const reason = globalThis.prompt(
    "Where does the access for this spell come from? This goes on the record as your word, not as GM approval."
  );
  return normalizeSpellRarityAttestationInput("rules-access", reason);
}

function normalizeSpellRarityAttestationInput(
  claimedBasis: unknown,
  reason: unknown
): SpellRarityAttestationInput | null {
  if (
    (claimedBasis !== "rules-access" && claimedBasis !== "reported-gm-permission") ||
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    reason.trim().length > 500
  ) {
    ui.notifications.warn("Write a reason before saving this note.");
    return null;
  }
  return { claimedBasis, reason: reason.trim() };
}

async function confirmWayfinderClear(message: string): Promise<boolean> {
  const foundryApi = foundry as unknown as FoundryDialogApiLike;
  const dialog = foundryApi.applications?.api?.DialogV2;
  if (dialog) {
    const escapeHTML = foundryApi.utils?.escapeHTML ?? fallbackEscapeHtml;
    const result = await dialog.confirm({
      window: { title: "Clear This Draft" },
      content: `<p>${escapeHTML(message)}</p>`,
      modal: true,
      yes: { label: "Clear Draft", icon: "fa-solid fa-trash" },
      no: { label: "Cancel", icon: "fa-solid fa-xmark", default: true },
    });
    return result === true;
  }

  return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false;
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

function localizeAcquisition(key: string, values?: AcquisitionLocalizationValues): string {
  return values ? String(game.i18n.format(key, values)) : String(game.i18n.localize(key));
}

function startingEquipmentFocusCandidates(target: HTMLElement | null): string[] | null {
  if (!target?.closest(".starting-equipment-pane")) return null;

  const candidates: string[] = [];
  const controlId = target.closest<HTMLElement>("[data-wayfinder-focus-id]")?.dataset.wayfinderFocusId;
  if (controlId) candidates.push(controlId);

  const sourceUuid = target.dataset.sourceUuid;
  if (sourceUuid) candidates.push(equipmentItemFocusId(sourceUuid, "preview"));

  const lineId = target.dataset.lineId;
  if (lineId) candidates.push(equipmentLineFocusId(lineId));

  switch (target.dataset.wayfinderAction) {
    case "initialize-starting-equipment":
      candidates.push("starting-equipment-authority", "starting-equipment-clear-filters");
      break;
    case "activate-equipment-policy":
    case "approve-equipment-policy-request":
    case "revoke-equipment-policy-judgment":
      candidates.push("starting-equipment-clear-filters", "starting-equipment-authority");
      break;
    case "request-equipment-start":
    case "select-equipment-recipe":
      candidates.push("starting-equipment-authority");
      break;
    case "acknowledge-equipment-handoff":
      candidates.push("starting-equipment-handoff");
      break;
  }

  candidates.push(STARTING_EQUIPMENT_REVIEW_FOCUS_ID);
  return [...new Set(candidates)];
}

function isStartingEquipmentViewOnlyAction(action: WayfinderAction): boolean {
  return (
    action.type === "preview-equipment-item" ||
    action.type === "toggle-equipment-filter" ||
    action.type === "clear-equipment-filters"
  );
}

function parseGoldToCopper(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [gold, fractional = ""] = normalized.split(".");
  const copper = Number(gold) * 100 + Number(fractional.padEnd(2, "0"));
  return Number.isSafeInteger(copper) && copper >= 0 ? copper : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
