import { getEffectiveBuildState, listActorItems } from "../build-state.js";
import { type CampaignFeatSlotAuthority, resolveCampaignFeatSlotSetting } from "../campaign-feat-sections.js";
import { applyClassArchetypeDraft } from "../class-archetype-service.js";
import { applyClassBranchDraft, createBranchSelectorSelection } from "../class-branch-service.js";
import { applyClassFeatureChoiceDraft } from "../class-feature-choice-service.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack/access.js";
import {
  readManualStaticItemGrants,
  type SelectorActorLike,
  type SelectorRuleDocumentLike,
  selectionFromManualStaticGrant,
} from "../selector-application.js";
import type { ActorItemLike, EmbeddedItemSource, SelectionDocumentLike } from "../shared/actor-model.js";
import { cloneData } from "../shared/cloning.js";
import { usesNativeGrantItemCreation } from "../shared/grant-creation-policy.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import { findSpellcastingEntryForChoice } from "../shared/spellcasting.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import { activeClassArchetypeProfile } from "../wayfinder/class-archetype/registry.js";
import { maxProficiencyRank, projectDraftSkillRanks } from "../wayfinder/domain/skill-rank-projection.js";
import {
  assertDraftBackedStepsReady,
  evaluateWayfinderDraftReadiness,
  evaluateWayfinderStep,
  WayfinderDraftNotReadyError,
} from "../wayfinder/domain/step-evaluation.js";
import type { SpellRarityCeiling } from "../wayfinder/spell-choice/rarity-access.js";
import {
  listSpellRarityAttestationProblems,
  listSpellRarityRecoveryProblems,
} from "../wayfinder/spell-choice/rarity-attestation.js";
import { applyBoostDraft } from "./boost-application.js";
import { createSingletonGrantItems } from "./explicit-grant-application.js";
import { buildLanguageChoiceUpdate } from "./language-choice-application.js";
import { readManualSystemItemGrants, selectionFromSystemGrant } from "./manual-system-item-grants.js";
import { nativeSpellcastingSourceSelections, syncNativeClassSpellcasting } from "./native-spellcasting-application.js";
import {
  createEmbeddedSource,
  createSingletonSystemGrantItems,
  hasSourceId,
  insertFeatSelection,
  orderSelections,
  preflightFeatSelection,
  replaceSingletonItems,
  restoreSingletonSourceSlotFlags,
  singletonSelections,
} from "./selection-application.js";
import type { CreateEmbeddedSourceDependencies, InsertFeatSelectionDependencies } from "./selection-dependencies.js";
import { DEFAULT_CREATE_DEPS } from "./selection-source-application.js";
import { applySingletonChoiceDraft } from "./singleton-choice-application.js";
import { applySpellChoiceDraft } from "./spell-choice-application.js";
import { spellLocationId } from "./spellcasting-entry-support.js";
import { applySkillIncreaseDraft, applyTrainingDraft, buildTrainingActorUpdate } from "./training-application.js";

export type DraftApplyPhase =
  | "singleton-replacements"
  | "singleton-system-grants"
  | "singleton-explicit-grants"
  | "singleton-choice-persistence-early"
  | "skill-training-items"
  | "class-archetype"
  | "class-branches"
  | "class-feature-choices"
  | "native-spellcasting-before-feats"
  | "feat-selections"
  | "singleton-choice-persistence-late"
  | "spell-choices"
  | "native-spellcasting-after-spells"
  | "boost-item-updates"
  | "source-flag-restoration"
  | "verify-outcome"
  | "finalize-actor";

export type DraftApplyWriteOperation = "embedded-item-create" | "currency-convergence" | "final-actor-update";

export type DraftApplyCheckpoint = Readonly<
  | {
      checkpointId: `phase:${DraftApplyPhase}:${"before" | "after"}`;
      kind: "phase";
      phase: DraftApplyPhase;
      boundary: "before" | "after";
    }
  | {
      checkpointId: `write:${DraftApplyWriteOperation}:${"before" | "after"}`;
      kind: "write";
      phase: DraftApplyPhase;
      operation: DraftApplyWriteOperation;
      boundary: "before" | "after";
      ordinal: number;
    }
>;

export type DraftApplyCheckpointHook = (checkpoint: DraftApplyCheckpoint) => void | Promise<void>;

export interface DraftApplyPhaseReceipt {
  phase: DraftApplyPhase;
  createdItemIds: string[];
  deletedItemIds: string[];
  updatedItemIds: string[];
  actorUpdatePaths: string[];
}

export interface PreparedDraftApplication {
  actor: DraftMutationActor;
  draft: DraftState;
  steps: PendingStep[];
  phaseIds: readonly DraftApplyPhase[];
  selections: SelectionRef[];
  pendingFeatSelections: SelectionRef[];
  stepsBySlotId: ReadonlyMap<string, PendingStep>;
  deferredActorUpdate: Record<string, unknown>;
  validateActorAuthority?: (actor: DraftMutationActor) => boolean;
  validateSelectionEligibility?: (selection: SelectionRef, step: PendingStep) => boolean | Promise<boolean>;
  sources: PreparedSourceCatalog;
}

interface PreparedSourceCatalog {
  createEmbeddedSource: (
    selection: SelectionRef,
    draft?: DraftState,
    steps?: PendingStep[]
  ) => Promise<EmbeddedItemSource | null>;
  createDependencies: CreateEmbeddedSourceDependencies;
  insertDependencies: InsertFeatSelectionDependencies;
  fetchSelectionDocument: (
    selection: SelectionRef
  ) => Promise<(SelectionDocumentLike & SelectorRuleDocumentLike) | null>;
  expectedSelections: SelectionRef[];
}

export interface PrepareDraftApplicationDependencies {
  createEmbeddedSource: (
    selection: SelectionRef,
    draft?: DraftState,
    steps?: PendingStep[]
  ) => Promise<EmbeddedItemSource | null>;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<SelectionDocumentLike | null>;
  preflightFeatSelection: (
    actor: DraftMutationActor,
    selection: SelectionRef,
    step: PendingStep | null,
    deps?: InsertFeatSelectionDependencies
  ) => Promise<void>;
  validateSelectionEligibility?: (selection: SelectionRef, step: PendingStep) => boolean | Promise<boolean>;
  validateActorAuthority?: (actor: DraftMutationActor) => boolean;
  spellRarityCeiling?: SpellRarityCeiling;
  validSkillSlugs?: ReadonlySet<string>;
  resolveCampaignFeatSlot: (sectionId: string, slotId: string) => CampaignFeatSlotAuthority | null;
}

export interface ExecutePreparedDraftApplicationOptions {
  onCheckpoint?: DraftApplyCheckpointHook;
  finalActorUpdate?: Record<string, unknown>;
  resolveFinalActorUpdate?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  beforeFinalActorUpdate?: () => void | Promise<void>;
  persistFinalActorUpdate?: (actorUpdate: Record<string, unknown>) => Promise<unknown>;
}

export interface ExecuteRecoveredDraftFinalizationOptions extends ExecutePreparedDraftApplicationOptions {
  recoveryActorUpdate: Record<string, unknown>;
  validateActorAuthority?: (actor: DraftMutationActor) => boolean;
}

export interface ExecutePreparedDraftApplicationResult {
  actorUpdate: Record<string, unknown>;
  receipts: DraftApplyPhaseReceipt[];
}

export class DraftApplyPhaseError extends Error {
  readonly phase: DraftApplyPhase;
  readonly checkpoint: DraftApplyCheckpoint | null;
  readonly failureKind: "checkpoint-hook" | "operation";
  readonly completedPhases: readonly DraftApplyPhase[];
  readonly completedReceipts: readonly DraftApplyPhaseReceipt[];
  readonly partialReceipt: DraftApplyPhaseReceipt;
  readonly recoveryActorUpdate: Readonly<Record<string, unknown>>;

  constructor(
    phase: DraftApplyPhase,
    completedReceipts: readonly DraftApplyPhaseReceipt[],
    partialReceipt: DraftApplyPhaseReceipt,
    checkpoint: DraftApplyCheckpoint | null,
    failureKind: "checkpoint-hook" | "operation",
    cause: unknown,
    recoveryActorUpdate: Record<string, unknown> = {}
  ) {
    const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : "";
    const checkpointDetail = checkpoint ? ` at ${checkpoint.checkpointId}` : "";
    super(`Wayfinder apply failed during ${phase}${checkpointDetail}.${detail}`, { cause });
    this.name = "DraftApplyPhaseError";
    this.phase = phase;
    this.completedReceipts = cloneData(completedReceipts);
    this.completedPhases = this.completedReceipts.map((receipt) => receipt.phase);
    this.partialReceipt = partialReceipt;
    this.recoveryActorUpdate = Object.freeze(cloneData(recoveryActorUpdate));
    this.checkpoint = checkpoint ? cloneData(checkpoint) : null;
    this.failureKind = failureKind;
  }
}

type DraftMutationActor = SelectorActorLike & {
  update?: (updates: Record<string, unknown>, operation?: Record<string, unknown>) => Promise<unknown>;
};

const PHASE_IDS: readonly DraftApplyPhase[] = [
  "singleton-replacements",
  "singleton-system-grants",
  "singleton-explicit-grants",
  "singleton-choice-persistence-early",
  "skill-training-items",
  "class-archetype",
  "class-branches",
  "class-feature-choices",
  "native-spellcasting-before-feats",
  "feat-selections",
  "singleton-choice-persistence-late",
  "spell-choices",
  "native-spellcasting-after-spells",
  "boost-item-updates",
  "source-flag-restoration",
  "verify-outcome",
  "finalize-actor",
];

const PF2E_SKILL_SLUGS = new Set([
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
]);

const DEFAULT_PREPARE_DEPS: PrepareDraftApplicationDependencies = {
  createEmbeddedSource,
  fetchSelectionDocument,
  preflightFeatSelection,
  resolveCampaignFeatSlot: resolveCampaignFeatSlotSetting,
};

export async function prepareDraftApplication(
  actor: DraftMutationActor,
  draftInput: DraftState,
  stepsInput: PendingStep[],
  depsInput: Partial<PrepareDraftApplicationDependencies> = {}
): Promise<PreparedDraftApplication> {
  const deps: PrepareDraftApplicationDependencies = { ...DEFAULT_PREPARE_DEPS, ...depsInput };
  assertActorAuthority(actor, deps.validateActorAuthority);

  const draft = cloneData(draftInput);
  const steps = cloneData(stepsInput);
  const spellRarityProblems = hasDraftRecoveryState(draft)
    ? listSpellRarityRecoveryProblems(typeof actor.id === "string" ? actor.id : "", draft)
    : listSpellRarityAttestationProblems(
        typeof actor.id === "string" ? actor.id : "",
        draft,
        steps,
        deps.spellRarityCeiling ?? "common"
      );
  if (spellRarityProblems.length > 0) {
    throw new WayfinderDraftNotReadyError(
      spellRarityProblems.map((problem) => ({
        code: "access-attestation",
        stepId: problem.stepId,
        slotId: problem.slotId,
        title: problem.title,
        message: problem.message,
      }))
    );
  }
  await assertDraftBackedStepsReady(steps, draft);
  const boostSteps = steps.filter((step) => step.kind === "boost");
  if (boostSteps.length > 0) {
    const effectiveBuildState = await getEffectiveBuildState(actor, draft);
    const boostReadiness = await evaluateWayfinderDraftReadiness(boostSteps, (step) =>
      evaluateWayfinderStep(step, draft, new Set(), effectiveBuildState)
    );
    if (!boostReadiness.ready) {
      throw new WayfinderDraftNotReadyError(boostReadiness.blockers);
    }
  }
  const activeSlotIds = new Set(steps.map((step) => step.slotId));
  const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));
  const selections = orderSelections(draft, steps).filter((selection) => activeSlotIds.has(selection.slotId));
  const pendingFeatSelections = selections.filter((selection) => {
    const step = stepsBySlotId.get(selection.slotId);
    return (
      !!step &&
      selection.itemType === "feat" &&
      !(step.kind === "pick-item" && step.slotKind === "flag-choice") &&
      !usesNativeGrantItemCreation(step)
    );
  });

  await validateMutationCapabilities(actor, selections, steps);
  validateDraftChoiceValues(actor, draft, steps, deps.validSkillSlugs);
  await validateSelectedEligibility(draft, steps, selections, deps.validateSelectionEligibility);
  const sources = await prepareSourceCatalog(actor, draft, steps, selections, deps);
  await validatePersistenceTargets(actor, draft, steps, deps);
  validateSpellDestinations(actor, draft, steps);

  for (const selection of pendingFeatSelections) {
    await deps.preflightFeatSelection(
      actor,
      selection,
      stepsBySlotId.get(selection.slotId) ?? null,
      sources.insertDependencies
    );
  }

  return {
    actor,
    draft,
    steps,
    phaseIds: PHASE_IDS,
    selections,
    pendingFeatSelections,
    stepsBySlotId,
    deferredActorUpdate: {
      ...cloneData(draft.applyRecoveryActorUpdate),
      ...buildLanguageChoiceUpdate(draft, steps),
    },
    validateActorAuthority: deps.validateActorAuthority,
    validateSelectionEligibility: deps.validateSelectionEligibility,
    sources,
  };
}

function validateDraftChoiceValues(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  configuredSkillSlugs?: ReadonlySet<string>
): void {
  const activeSlotIds = new Set(steps.map((step) => step.slotId));
  const validSkillSlugs = new Set([
    ...PF2E_SKILL_SLUGS,
    ...Object.keys(actor.system?.skills ?? {}),
    ...(configuredSkillSlugs ?? []),
  ]);
  const activeRankDraft = {
    skillIncreases: Object.fromEntries(
      Object.entries(draft.skillIncreases).filter(([slotId]) => activeSlotIds.has(slotId))
    ),
    skillTrainings: Object.fromEntries(
      Object.entries(draft.skillTrainings).filter(([slotId]) => activeSlotIds.has(slotId))
    ),
  };
  for (const step of steps) {
    if (step.kind === "singleton-choice") {
      assertListedChoice(step, draft.singletonChoices[step.slotId], step.singletonChoice.options);
    } else if (step.kind === "class-choice") {
      assertListedChoice(step, draft.classChoices[step.slotId], step.classChoice.options);
    } else if (step.kind === "class-archetype") {
      assertListedChoice(step, draft.classArchetypeChoices[step.slotId], step.classArchetype.options);
    } else if (step.kind === "language-choice") {
      const selected = draft.languageChoices[step.slotId] ?? [];
      const allowed = new Set(step.languageChoice.options.map((option) => option.value));
      if (selected.some((value) => !allowed.has(value))) {
        throw staleChoiceError(step);
      }
    } else if (step.kind === "skill-training") {
      validateTrainingChoices(draft, step, validSkillSlugs);
    } else if (step.kind === "skill-increase") {
      const selected = draft.skillIncreases[step.slotId];
      if (selected && !validSkillSlugs.has(selected)) throw staleChoiceError(step);
      if (selected) {
        const ranks = projectDraftSkillRanks({
          baseSkillRanks: Object.fromEntries(
            Object.entries(actor.system?.skills ?? {}).map(([slug, data]) => [
              slug,
              Number((data as { rank?: unknown })?.rank ?? 0),
            ])
          ),
          draft: activeRankDraft,
          beforeSlotId: step.slotId,
        });
        if ((ranks[selected] ?? 0) >= maxProficiencyRank(step.level)) throw staleChoiceError(step);
      }
    }
  }
}

function assertListedChoice(step: PendingStep, selected: string | undefined, options: Array<{ value: string }>): void {
  if (selected && !options.some((option) => option.value === selected)) {
    throw staleChoiceError(step);
  }
}

function validateTrainingChoices(
  draft: DraftState,
  step: PendingStep & { kind: "skill-training" },
  validSkillSlugs: ReadonlySet<string>
): void {
  const training = draft.skillTrainings[step.slotId];
  if (!training) return;
  if (training.additional.some((slug) => !validSkillSlugs.has(slug))) {
    throw staleChoiceError(step);
  }
  for (const choice of step.training.choiceRules) {
    const selected = training.ruleChoices[choice.key];
    if (!selected) continue;
    const allowed = [...choice.options, ...(choice.fallbackOptions ?? [])].some((option) => option.slug === selected);
    if (!allowed) throw staleChoiceError(step);
  }
  for (const choice of step.training.loreChoices) {
    const selected = training.loreChoices[choice.key];
    if (selected && !choice.allowCustom && !choice.suggestions.includes(selected)) {
      throw staleChoiceError(step);
    }
  }
}

function staleChoiceError(step: PendingStep): Error {
  return new Error(`${step.title} changed after this draft was prepared; review that choice before applying.`);
}

async function validateSelectedEligibility(
  draft: DraftState,
  steps: PendingStep[],
  activeSelections: SelectionRef[],
  validateSelectionEligibility?: (selection: SelectionRef, step: PendingStep) => boolean | Promise<boolean>
): Promise<void> {
  if (!validateSelectionEligibility) return;
  const selectionsBySlot = new Map<string, SelectionRef[]>();
  for (const selection of activeSelections) {
    selectionsBySlot.set(selection.slotId, [...(selectionsBySlot.get(selection.slotId) ?? []), selection]);
  }
  for (const selection of Object.values(draft.branchSelections)) {
    selectionsBySlot.set(selection.slotId, [...(selectionsBySlot.get(selection.slotId) ?? []), selection]);
  }
  for (const [slotId, selections] of Object.entries(draft.spellChoices)) {
    selectionsBySlot.set(slotId, selections);
  }

  for (const step of steps) {
    for (const selection of selectionsBySlot.get(step.slotId) ?? []) {
      if (!(await validateSelectionEligibility(selection, step))) {
        throw new Error(
          `${selection.name} is no longer eligible for ${step.title}; the draft cannot be applied safely.`
        );
      }
    }
  }
}

export async function executePreparedDraftApplication(
  prepared: PreparedDraftApplication,
  options: ExecutePreparedDraftApplicationOptions = {}
): Promise<ExecutePreparedDraftApplicationResult> {
  assertActorAuthority(prepared.actor, prepared.validateActorAuthority);
  // The target level is part of the final actor transaction even though it is
  // intentionally persisted only by the finalize phase. Seed it before any
  // phase can fail so recovery-only finalization can replay the complete
  // deferred update after an otherwise-empty rebuilt plan.
  addLevelUpdate(prepared);
  const receipts: DraftApplyPhaseReceipt[] = [];
  let projectedTrainingRanks: Record<string, number> = {};

  for (const phase of prepared.phaseIds) {
    if (phase === "finalize-actor") {
      const receipt = await executeFinalActorPhase(prepared.actor, prepared.deferredActorUpdate, options, receipts);
      receipts.push(receipt);
      continue;
    }
    const beforeItems = snapshotPhaseItems(prepared.actor);
    let failedCheckpoint: DraftApplyCheckpoint | null = null;
    const operationFailureCheckpoint: DraftApplyCheckpoint | null = null;
    const confirmedActorUpdatePaths: string[] = [];
    const emitCheckpoint = async (checkpoint: DraftApplyCheckpoint): Promise<void> => {
      try {
        await options.onCheckpoint?.(checkpoint);
      } catch (error) {
        failedCheckpoint = checkpoint;
        throw error;
      }
    };
    try {
      await emitCheckpoint(buildPhaseCheckpoint(phase, "before"));
      switch (phase) {
        case "singleton-replacements":
          await replaceSingletonItems(
            prepared.actor,
            singletonSelections(prepared.selections),
            prepared.draft,
            prepared.steps,
            prepared.sources.createDependencies
          );
          break;
        case "singleton-system-grants":
          await createSingletonSystemGrantItems(
            prepared.actor,
            prepared.draft,
            prepared.steps,
            prepared.sources.insertDependencies
          );
          break;
        case "singleton-explicit-grants":
          await createSingletonGrantItems(
            prepared.actor,
            prepared.draft,
            prepared.steps,
            prepared.sources.insertDependencies
          );
          refreshActorData(prepared.actor);
          break;
        case "singleton-choice-persistence-early":
          await applySingletonChoiceDraft(prepared.actor, prepared.draft, prepared.steps);
          break;
        case "skill-training-items":
          projectedTrainingRanks = await applyTrainingDraft(prepared.actor, prepared.draft, prepared.steps, {
            persistActorUpdate: false,
          });
          Object.assign(prepared.deferredActorUpdate, buildTrainingActorUpdate(prepared.actor, projectedTrainingRanks));
          break;
        case "class-archetype":
          await applyClassArchetypeDraft(prepared.actor, prepared.draft, prepared.steps, {
            createEmbeddedSource: prepared.sources.createEmbeddedSource,
            fetchSelectionDocument: prepared.sources.fetchSelectionDocument,
          });
          break;
        case "class-branches":
          await applyClassBranchDraft(prepared.actor, prepared.draft, prepared.steps, {
            createEmbeddedSource: prepared.sources.createEmbeddedSource,
            fetchSelectionDocument: prepared.sources.fetchSelectionDocument,
          });
          break;
        case "class-feature-choices":
          await applyClassFeatureChoiceDraft(prepared.actor, prepared.draft, prepared.steps, {
            createEmbeddedSource: prepared.sources.createEmbeddedSource,
            fetchSelectionDocument: prepared.sources.fetchSelectionDocument,
          });
          break;
        case "native-spellcasting-before-feats":
          await syncNativeClassSpellcasting(prepared.actor, prepared.draft, prepared.sources.createEmbeddedSource);
          break;
        case "feat-selections":
          for (const selection of prepared.pendingFeatSelections) {
            const step = prepared.stepsBySlotId.get(selection.slotId);
            if (!step || hasSourceId(prepared.actor, selection.uuid)) {
              continue;
            }
            await insertFeatSelection(
              prepared.actor,
              selection,
              step,
              prepared.sources.insertDependencies,
              prepared.draft,
              prepared.steps
            );
          }
          break;
        case "singleton-choice-persistence-late":
          await applySingletonChoiceDraft(prepared.actor, prepared.draft, prepared.steps);
          break;
        case "spell-choices":
          await validateSpellSelections(prepared);
          await applySpellChoiceDraft(
            prepared.actor,
            prepared.draft,
            prepared.steps,
            prepared.sources.createEmbeddedSource
          );
          break;
        case "native-spellcasting-after-spells":
          await syncNativeClassSpellcasting(prepared.actor, prepared.draft, prepared.sources.createEmbeddedSource);
          break;
        case "boost-item-updates": {
          const boostResult = await applyBoostDraft(prepared.actor, prepared.draft, undefined, {
            persistActorUpdate: false,
          });
          Object.assign(prepared.deferredActorUpdate, boostResult.actorUpdate);
          const skillIncreaseUpdate = await applySkillIncreaseDraft(
            prepared.actor,
            prepared.draft,
            projectedTrainingRanks,
            {
              persistActorUpdate: false,
              activeSlotIds: new Set(
                prepared.steps.filter((step) => step.kind === "skill-increase").map((step) => step.slotId)
              ),
            }
          );
          Object.assign(prepared.deferredActorUpdate, skillIncreaseUpdate);
          break;
        }
        case "source-flag-restoration":
          await restoreSingletonSourceSlotFlags(prepared.actor, prepared.draft);
          break;
        case "verify-outcome":
          verifyPreparedOutcome(prepared);
          break;
      }
      receipts.push(buildPhaseReceipt(phase, beforeItems, prepared.actor, confirmedActorUpdatePaths));
      await emitCheckpoint(buildPhaseCheckpoint(phase, "after"));
    } catch (error) {
      throw new DraftApplyPhaseError(
        phase,
        receipts,
        buildPhaseReceipt(phase, beforeItems, prepared.actor, confirmedActorUpdatePaths),
        failedCheckpoint ?? operationFailureCheckpoint,
        failedCheckpoint ? "checkpoint-hook" : "operation",
        error,
        prepared.deferredActorUpdate
      );
    }
  }

  return {
    actorUpdate: { ...prepared.deferredActorUpdate },
    receipts,
  };
}

export async function executeRecoveredDraftFinalization(
  actor: DraftMutationActor,
  options: ExecuteRecoveredDraftFinalizationOptions
): Promise<ExecutePreparedDraftApplicationResult> {
  assertActorAuthority(actor, options.validateActorAuthority);
  const recoveryActorUpdate = cloneData(options.recoveryActorUpdate);
  const receipt = await executeFinalActorPhase(actor, recoveryActorUpdate, options, []);
  return {
    actorUpdate: recoveryActorUpdate,
    receipts: [receipt],
  };
}

async function executeFinalActorPhase(
  actor: DraftMutationActor,
  deferredActorUpdate: Record<string, unknown>,
  options: ExecutePreparedDraftApplicationOptions,
  completedReceipts: readonly DraftApplyPhaseReceipt[]
): Promise<DraftApplyPhaseReceipt> {
  const phase = "finalize-actor" as const;
  const beforeItems = snapshotPhaseItems(actor);
  let failedCheckpoint: DraftApplyCheckpoint | null = null;
  let operationFailureCheckpoint: DraftApplyCheckpoint | null = null;
  let confirmedActorUpdatePaths: string[] = [];
  const emitCheckpoint = async (checkpoint: DraftApplyCheckpoint): Promise<void> => {
    try {
      await options.onCheckpoint?.(checkpoint);
    } catch (error) {
      failedCheckpoint = checkpoint;
      throw error;
    }
  };

  try {
    await emitCheckpoint(buildPhaseCheckpoint(phase, "before"));
    const beforeWrite = buildWriteCheckpoint(phase, "final-actor-update", "before", 1);
    await emitCheckpoint(beforeWrite);
    operationFailureCheckpoint = beforeWrite;
    await options.beforeFinalActorUpdate?.();
    const finalActorUpdate = options.resolveFinalActorUpdate
      ? cloneData(await options.resolveFinalActorUpdate())
      : cloneData(options.finalActorUpdate ?? {});
    const actorUpdate = {
      ...deferredActorUpdate,
      ...finalActorUpdate,
    };
    const intendedActorUpdate = cloneData(actorUpdate);
    const intendedActorUpdatePaths = Object.keys(intendedActorUpdate);
    const finalActorUpdatePaths = Object.keys(finalActorUpdate);
    if (!actor.update) {
      if (intendedActorUpdatePaths.length > 0) {
        throw new Error("The actor cannot persist Wayfinder's final update.");
      }
    } else {
      const preexistingConvergedPaths = convergedActorUpdatePaths(actor, intendedActorUpdate, intendedActorUpdatePaths);
      let updatedActor: unknown;
      let updateRejected = false;
      let updateFailure: unknown;
      try {
        updatedActor = options.persistFinalActorUpdate
          ? await options.persistFinalActorUpdate(actorUpdate)
          : await actor.update(actorUpdate);
      } catch (error) {
        updateRejected = true;
        updateFailure = error;
      }
      const observedConvergedPaths = convergedActorUpdatePaths(actor, intendedActorUpdate, intendedActorUpdatePaths);
      const newlyConvergedPaths = observedConvergedPaths.filter((path) => !preexistingConvergedPaths.includes(path));
      const intendedUpdateConverged =
        intendedActorUpdatePaths.length > 0 &&
        intendedActorUpdatePaths.every((path) => observedConvergedPaths.includes(path));
      const finalUpdateConverged =
        finalActorUpdatePaths.length > 0 &&
        finalActorUpdatePaths.every((path) => observedConvergedPaths.includes(path));
      if (updateRejected) {
        if (intendedUpdateConverged) {
          confirmedActorUpdatePaths = observedConvergedPaths;
          operationFailureCheckpoint = buildWriteCheckpoint(phase, "final-actor-update", "after", 1);
        } else {
          confirmedActorUpdatePaths = newlyConvergedPaths;
        }
        throw updateFailure;
      }
      if (!intendedUpdateConverged) {
        confirmedActorUpdatePaths = newlyConvergedPaths;
        throw new Error("PF2E did not persist Wayfinder's complete final actor update.");
      }
      if (updatedActor === undefined && (finalActorUpdatePaths.length === 0 || !finalUpdateConverged)) {
        confirmedActorUpdatePaths = newlyConvergedPaths;
        throw new Error("PF2E vetoed Wayfinder's final actor update.");
      }
      confirmedActorUpdatePaths = observedConvergedPaths;
      operationFailureCheckpoint = null;
      await emitCheckpoint(buildWriteCheckpoint(phase, "final-actor-update", "after", 1));
    }

    const receipt = buildPhaseReceipt(phase, beforeItems, actor, confirmedActorUpdatePaths);
    await emitCheckpoint(buildPhaseCheckpoint(phase, "after"));
    return receipt;
  } catch (error) {
    const partialReceipt = buildPhaseReceipt(phase, beforeItems, actor, confirmedActorUpdatePaths);
    const checkpointFailure = failedCheckpoint as DraftApplyCheckpoint | null;
    const receiptCompletedBeforeFailure = checkpointFailure?.kind === "phase" && checkpointFailure.boundary === "after";
    throw new DraftApplyPhaseError(
      phase,
      receiptCompletedBeforeFailure ? [...completedReceipts, partialReceipt] : completedReceipts,
      partialReceipt,
      checkpointFailure ?? operationFailureCheckpoint,
      checkpointFailure ? "checkpoint-hook" : "operation",
      error,
      deferredActorUpdate
    );
  }
}

async function validateSpellSelections(prepared: PreparedDraftApplication): Promise<void> {
  const validateSelectionEligibility = prepared.validateSelectionEligibility;
  if (!validateSelectionEligibility) return;
  for (const step of prepared.steps) {
    if (step.kind !== "spell-choice") continue;
    for (const selection of prepared.draft.spellChoices[step.slotId] ?? []) {
      if (!(await validateSelectionEligibility(selection, step))) {
        throw new Error(
          `${selection.name} is no longer eligible for ${step.title}; the draft cannot be applied safely.`
        );
      }
    }
  }
}

function hasDraftRecoveryState(draft: DraftState): boolean {
  return (
    draft.applyAttemptStepIds.length > 0 ||
    draft.applyCompletedStepIds.length > 0 ||
    Object.keys(draft.applyRecoveryActorUpdate).length > 0 ||
    draft.applySpellRarityAttestations.length > 0
  );
}

function buildPhaseCheckpoint(phase: DraftApplyPhase, boundary: "before" | "after"): DraftApplyCheckpoint {
  return Object.freeze({
    checkpointId: `phase:${phase}:${boundary}`,
    kind: "phase",
    phase,
    boundary,
  });
}

function buildWriteCheckpoint(
  phase: DraftApplyPhase,
  operation: DraftApplyWriteOperation,
  boundary: "before" | "after",
  ordinal: number
): DraftApplyCheckpoint {
  return Object.freeze({
    checkpointId: `write:${operation}:${boundary}`,
    kind: "write",
    phase,
    operation,
    boundary,
    ordinal,
  });
}

function snapshotPhaseItems(actor: DraftMutationActor): Map<string, string> {
  return new Map(
    (listActorItems(actor) as ActorItemLike[]).flatMap((item): Array<[string, string]> => {
      if (!item.id) return [];
      return [
        [
          item.id,
          JSON.stringify({
            type: item.type,
            name: item.name,
            sourceId: item.flags?.core?.sourceId ?? item.sourceId ?? null,
            system: item.system,
            wayfinder: item.flags?.[MODULE_ID],
            pf2e: item.flags?.pf2e,
          }),
        ],
      ];
    })
  );
}

function convergedActorUpdatePaths(
  actor: DraftMutationActor,
  actorUpdate: Record<string, unknown>,
  intendedPaths: readonly string[]
): string[] {
  return intendedPaths.filter((path) => {
    const expected = actorUpdate[path];
    const convergenceSource =
      actor && typeof actor === "object" && "_source" in actor && actor._source && typeof actor._source === "object"
        ? actor._source
        : actor;
    const { actual, forcedDeletion } = readActorUpdatePath(convergenceSource, path);
    return forcedDeletion ? actual === undefined : actorUpdatePathConverged(path, actual, expected);
  });
}

function actorUpdatePathConverged(path: string, actual: unknown, expected: unknown): boolean {
  if (path === "system.details.languages.value" && Array.isArray(expected)) {
    const actualValues = actual instanceof Set ? [...actual] : actual;
    return (
      Array.isArray(actualValues) && JSON.stringify([...actualValues].sort()) === JSON.stringify([...expected].sort())
    );
  }

  return containsExpectedValue(actual, expected);
}

function readActorUpdatePath(source: unknown, path: string): { actual: unknown; forcedDeletion: boolean } {
  const segments = path.split(".");
  let cursor = source;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object") return { actual: undefined, forcedDeletion: false };
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  const leaf = segments.at(-1) ?? "";
  const forcedDeletion = leaf.startsWith("-=");
  const key = forcedDeletion ? leaf.slice(2) : leaf;
  const actual = cursor && typeof cursor === "object" ? (cursor as Record<string, unknown>)[key] : undefined;
  return { actual, forcedDeletion };
}

function containsExpectedValue(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, index) => containsExpectedValue(actual[index], entry))
    );
  }
  if (!expected || typeof expected !== "object" || !actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) =>
    containsExpectedValue((actual as Record<string, unknown>)[key], value)
  );
}

function buildPhaseReceipt(
  phase: DraftApplyPhase,
  before: ReadonlyMap<string, string>,
  actor: DraftMutationActor,
  confirmedActorUpdatePaths: readonly string[]
): DraftApplyPhaseReceipt {
  const after = snapshotPhaseItems(actor);
  return {
    phase,
    createdItemIds: [...after.keys()].filter((id) => !before.has(id)),
    deletedItemIds: [...before.keys()].filter((id) => !after.has(id)),
    updatedItemIds: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
    actorUpdatePaths: phase === "finalize-actor" ? [...confirmedActorUpdatePaths] : [],
  };
}

function verifyPreparedOutcome(prepared: PreparedDraftApplication): void {
  const actorItems = listActorItems(prepared.actor) as ActorItemLike[];
  for (const selection of prepared.sources.expectedSelections) {
    if (!actorItems.some((item) => itemMatchesSourceId(item, selection.uuid))) {
      throw new Error(`${selection.name} was not created or retained by PF2E; the draft was not finalized.`);
    }
  }

  for (const selection of prepared.pendingFeatSelections) {
    const step = prepared.stepsBySlotId.get(selection.slotId);
    const expectedLocation = step ? expectedFeatLocation(step) : null;
    if (!expectedLocation) continue;
    const item = actorItems.find((candidate) => itemMatchesSourceId(candidate, selection.uuid));
    if (!item || actorItemLocation(item) !== expectedLocation) {
      throw new Error(`${selection.name} was not placed in PF2E's expected ${expectedLocation} feat slot.`);
    }
  }

  for (const step of prepared.steps) {
    if (step.kind !== "spell-choice") continue;
    const selections = prepared.draft.spellChoices[step.slotId] ?? [];
    if (selections.length === 0) continue;
    const entry = findSpellcastingEntryForChoice(prepared.actor, step.spellChoice);
    if (!entry?.id) {
      throw new Error(`${step.title} has no prepared PF2E spellcasting destination.`);
    }
    const actualCounts = new Map<string, number>();
    for (const item of actorItems) {
      if (item.type !== "spell" || spellLocationId(item) !== entry.id) continue;
      const match = selections.find((selection) => itemMatchesSourceId(item, selection.uuid));
      if (match) actualCounts.set(match.uuid, (actualCounts.get(match.uuid) ?? 0) + 1);
    }
    const expectedCounts = new Map<string, number>();
    for (const selection of selections) {
      expectedCounts.set(selection.uuid, (expectedCounts.get(selection.uuid) ?? 0) + 1);
    }
    for (const [uuid, count] of expectedCounts) {
      if ((actualCounts.get(uuid) ?? 0) < count) {
        throw new Error(`${step.title} did not create every selected spell; the draft was not finalized.`);
      }
    }
  }

  verifyTrainingLoreOutcomes(prepared, actorItems);
}

function verifyTrainingLoreOutcomes(prepared: PreparedDraftApplication, actorItems: ActorItemLike[]): void {
  const expectedByName = new Map<string, { name: string; slotId: string; key: string }>();
  for (const step of prepared.steps) {
    if (step.kind !== "skill-training") continue;
    const training = prepared.draft.skillTrainings[step.slotId];
    if (!training) continue;
    for (const entry of [
      ...step.training.fixedLores.map((name, index) => ({ name, key: `fixed:${index}` })),
      ...step.training.loreChoices.flatMap((choice) => {
        const name = training.loreChoices[choice.key];
        return name ? [{ name, key: choice.key }] : [];
      }),
    ]) {
      const normalizedName = normalizeLoreName(entry.name);
      expectedByName.set(normalizedName.toLowerCase(), {
        name: normalizedName,
        slotId: step.slotId,
        key: entry.key,
      });
    }
  }
  for (const [normalizedKey, entry] of expectedByName) {
    const item = actorItems.find(
      (candidate) =>
        candidate.type === "lore" && normalizeLoreName(candidate.name ?? "").toLowerCase() === normalizedKey
    );
    const flags = item?.flags?.[MODULE_ID] as { slotId?: unknown; trainingKey?: unknown } | undefined;
    const rank = Number((item?.system?.proficient as { value?: unknown } | undefined)?.value ?? 0);
    if (!item || rank < 1 || flags?.slotId !== entry.slotId || flags.trainingKey !== entry.key) {
      throw new Error(`${entry.name} was not created or updated by PF2E; the draft was not finalized.`);
    }
  }
}

function normalizeLoreName(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  return /\blore\b$/iu.test(trimmed) ? trimmed : `${trimmed} Lore`;
}

function expectedFeatLocation(step: PendingStep): string | null {
  switch (step.slotKind) {
    case "ancestry-feat":
      return `ancestry-${step.level}`;
    case "class-feat":
      return `class-${step.level}`;
    case "skill-feat":
      return `skill-${step.level}`;
    case "general-feat":
      return `general-${step.level}`;
    case "archetype-feat":
      return `archetype-${step.level}`;
    case "campaign-feat":
      return step.campaignFeat?.groupSlotId ?? null;
    default:
      return null;
  }
}

function actorItemLocation(item: ActorItemLike): string | null {
  const location = item.system?.location;
  if (typeof location === "string") return location;
  if (location && typeof location === "object" && "value" in location && typeof location.value === "string") {
    return location.value;
  }
  return null;
}

function assertActorAuthority(
  actor: DraftMutationActor,
  validateActorAuthority?: (actor: DraftMutationActor) => boolean
): void {
  if (!validateActorAuthority || !validateActorAuthority(actor)) {
    throw new Error("The current user can no longer modify this PF2E character.");
  }
}

async function prepareSourceCatalog(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  activeSelections: SelectionRef[],
  deps: PrepareDraftApplicationDependencies
): Promise<PreparedSourceCatalog> {
  const refs = collectSourceRefs(actor, draft, steps, activeSelections);
  const sourcesByKey = new Map<string, EmbeddedItemSource>();
  const sourcesByUuid = new Map<string, EmbeddedItemSource>();
  const documentsByUuid = new Map<string, EmbeddedItemSource>();
  const expectedSelections: SelectionRef[] = [];
  const nonMaterializedSelectionKeys = new Set(
    steps.flatMap((step) => {
      const selection = step.kind === "pick-item" && step.flagChoice ? draft.selections[step.slotId] : null;
      return selection ? [sourceCatalogKey(selection)] : [];
    })
  );
  const campaignAuthorities = new Map<string, CampaignFeatSlotAuthority | null>();
  for (const step of steps) {
    if (step.slotKind === "campaign-feat" && step.campaignFeat) {
      const key = `${step.campaignFeat.sectionId}#${step.campaignFeat.groupSlotId}`;
      if (!campaignAuthorities.has(key)) {
        const authority = deps.resolveCampaignFeatSlot(step.campaignFeat.sectionId, step.campaignFeat.groupSlotId);
        campaignAuthorities.set(key, authority ? cloneData(authority) : null);
      }
    }
  }
  const pending = [...refs.values()];
  for (let index = 0; index < pending.length; index += 1) {
    const selection = pending[index];
    if (!selection || sourcesByKey.has(sourceCatalogKey(selection))) continue;
    if (!nonMaterializedSelectionKeys.has(sourceCatalogKey(selection))) {
      expectedSelections.push(selection);
    }
    const existing = (listActorItems(actor) as ActorItemLike[]).find((item) =>
      itemMatchesSourceId(item, selection.uuid)
    );
    const document = await deps.fetchSelectionDocument(selection);
    const existingSource = existing ? snapshotActorItemSource(existing) : null;
    const resolvedSource = await deps.createEmbeddedSource(selection, draft, steps);
    const source = resolvedSource ?? existingSource;
    if (!source) {
      throw new Error(`Cannot prepare ${selection.name}: source document ${selection.uuid} could not be resolved.`);
    }
    sourcesByKey.set(sourceCatalogKey(selection), cloneData(source));
    if (!sourcesByUuid.has(selection.uuid)) sourcesByUuid.set(selection.uuid, cloneData(source));
    if (!documentsByUuid.has(selection.uuid)) {
      documentsByUuid.set(selection.uuid, cloneData(existingSource ?? document?.toObject() ?? source));
    }
    for (const grant of readManualSystemItemGrants(source as ActorItemLike)) {
      pending.push(selectionFromSystemGrant(grant));
    }
    for (const grant of readManualStaticItemGrants(source)) {
      const childSelection = selectionFromManualStaticGrant(grant, selection.slotId);
      if (childSelection) pending.push(childSelection);
    }
  }

  const resolvePreparedSource = (selection: SelectionRef): EmbeddedItemSource => {
    const prepared = sourcesByKey.get(sourceCatalogKey(selection)) ?? sourcesByUuid.get(selection.uuid);
    if (!prepared) {
      throw new Error(`Cannot execute ${selection.name}: its source was not included in the prepared application.`);
    }
    return prepareCachedSource(prepared, selection);
  };
  const createDependencies: CreateEmbeddedSourceDependencies = {
    ...DEFAULT_CREATE_DEPS,
    resolvePreparedSource,
  };
  const fetchFromCatalog = async (
    selection: SelectionRef
  ): Promise<SelectionDocumentLike & SelectorRuleDocumentLike> => {
    const documentSource = documentsByUuid.get(selection.uuid);
    if (!documentSource) {
      throw new Error(`Cannot execute ${selection.name}: its source document was not prepared.`);
    }
    const source = cloneData(documentSource);
    return {
      ...source,
      toObject: () => cloneData(source),
    };
  };
  const createFromCatalog = async (selection: SelectionRef): Promise<EmbeddedItemSource> =>
    resolvePreparedSource(selection);
  return {
    createEmbeddedSource: createFromCatalog,
    createDependencies,
    insertDependencies: {
      fetchSelectionDocument: fetchFromCatalog,
      createEmbeddedSource: createFromCatalog,
      resolveCampaignFeatSlot: (sectionId, slotId) => campaignAuthorities.get(`${sectionId}#${slotId}`) ?? null,
    },
    fetchSelectionDocument: fetchFromCatalog,
    expectedSelections,
  };
}

function sourceCatalogKey(selection: SelectionRef): string {
  return `${selection.uuid}#${selection.slotId}`;
}

function snapshotActorItemSource(item: ActorItemLike): EmbeddedItemSource {
  const toObject = (item as ActorItemLike & { toObject?: () => EmbeddedItemSource }).toObject;
  const source = cloneData(typeof toObject === "function" ? toObject.call(item) : ({ ...item } as EmbeddedItemSource));
  delete source.id;
  delete source._id;
  return source;
}

function prepareCachedSource(sourceInput: EmbeddedItemSource, selection: SelectionRef): EmbeddedItemSource {
  const source = cloneData(sourceInput);
  delete source.id;
  delete source._id;
  source.flags ??= {};
  source.flags.core = { ...(source.flags.core ?? {}), sourceId: selection.uuid };
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    importedBy: MODULE_ID,
    slotId: selection.slotId,
  };
  return source;
}

function collectSourceRefs(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  activeSelections: SelectionRef[]
): Map<string, SelectionRef> {
  const refs = new Map<string, SelectionRef>();
  const add = (selection: SelectionRef): void => {
    refs.set(`${selection.uuid}#${selection.slotId}`, selection);
  };
  activeSelections.forEach(add);
  const activeSlotIds = new Set(steps.map((step) => step.slotId));
  Object.values(draft.branchSelections)
    .filter((selection) => activeSlotIds.has(selection.slotId))
    .forEach(add);
  for (const [slotId, selections] of Object.entries(draft.spellChoices)) {
    if (activeSlotIds.has(slotId)) selections.forEach(add);
  }

  const activeProfile = activeClassArchetypeProfile(draft, listActorItems(actor));
  if (activeProfile) {
    add({ ...activeProfile.selection, slotId: activeProfile.decisionSlotId });
    add({ ...activeProfile.selector.selection, slotId: activeProfile.decisionSlotId });
  }
  for (const internalChoice of activeProfile?.internalClassFeatureChoices ?? []) {
    add({
      ...internalChoice.selection,
      slotId: `class-archetype-internal-${internalChoice.selection.slug ?? internalChoice.selection.documentId}`,
    });
  }
  nativeSpellcastingSourceSelections(actor, draft).forEach(add);

  for (const step of steps) {
    if (step.kind === "class-branch" && step.branch && draft.branchSelections[step.slotId]) {
      add(createBranchSelectorSelection(step.branch, step.slotId));
    } else if (step.kind === "class-choice" && step.classChoice && draft.classChoices[step.slotId]) {
      add(sourceSelection(step.slotId, step.classChoice));
    } else if (step.kind === "singleton-choice" && step.singletonChoice && draft.singletonChoices[step.slotId]) {
      add(sourceSelection(step.slotId, step.singletonChoice));
    } else if (step.kind === "pick-item" && step.flagChoice && draft.selections[step.slotId]) {
      add(sourceSelection(step.slotId, step.flagChoice));
    } else if (step.kind === "pick-item" && step.grantSelection && draft.selections[step.slotId]) {
      add({
        slotId: step.slotId,
        packId: step.grantSelection.selectorPackId,
        documentId: step.grantSelection.selectorDocumentId,
        uuid: step.grantSelection.selectorUuid,
        itemType: step.grantSelection.sourceItemType === "classfeature" ? "feat" : step.grantSelection.sourceItemType,
        featType: step.grantSelection.sourceItemType === "classfeature" ? "classfeature" : null,
        name: step.grantSelection.selectorName,
        level: step.level,
      });
    } else if (step.kind === "class-archetype") {
      const value = draft.classArchetypeChoices[step.slotId];
      if (value && value !== step.classArchetype.standardValue) {
        add({
          slotId: step.slotId,
          packId: step.classArchetype.selector.selectorPackId,
          documentId: step.classArchetype.selector.selectorDocumentId,
          uuid: step.classArchetype.selector.selectorUuid,
          itemType: "feat",
          featType: "classfeature",
          name: step.classArchetype.selector.selectorName,
          level: step.level,
        });
      }
    }
  }
  return refs;
}

async function validatePersistenceTargets(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  deps: PrepareDraftApplicationDependencies
): Promise<void> {
  const activeProfile = activeClassArchetypeProfile(draft, listActorItems(actor));
  for (const internalChoice of activeProfile?.internalClassFeatureChoices ?? []) {
    await validateRuleTarget(
      actor,
      {
        ...internalChoice.selection,
        slotId: `class-archetype-internal-${internalChoice.selection.slug ?? internalChoice.selection.documentId}`,
      },
      { sourceRuleIndex: internalChoice.sourceRuleIndex, flag: internalChoice.flag },
      deps
    );
  }
  for (const step of steps) {
    if (step.kind === "singleton-choice" && step.singletonChoice && draft.singletonChoices[step.slotId]) {
      await validateRuleTarget(actor, sourceSelection(step.slotId, step.singletonChoice), step.singletonChoice, deps);
    }
    if (step.kind === "class-choice" && step.classChoice && draft.classChoices[step.slotId]) {
      await validateRuleTarget(actor, sourceSelection(step.slotId, step.classChoice), step.classChoice, deps);
    }
    if (step.kind === "pick-item" && step.flagChoice && draft.selections[step.slotId]) {
      await validateRuleTarget(actor, sourceSelection(step.slotId, step.flagChoice), step.flagChoice, deps);
    }
    if (step.kind === "skill-training" && step.training) {
      const training = draft.skillTrainings[step.slotId];
      if (!training) continue;
      for (const choice of step.training.choiceRules) {
        if (training.ruleChoices[choice.key] && choice.persistence) {
          await validateRuleTarget(
            actor,
            sourceSelection(step.slotId, choice.persistence),
            { sourceRuleIndex: choice.persistence.sourceRuleIndex, flag: choice.flag },
            deps
          );
        }
      }
      for (const choice of step.training.loreChoices) {
        if (training.loreChoices[choice.key] && choice.persistence) {
          await validateRuleTarget(
            actor,
            sourceSelection(step.slotId, choice.persistence),
            { sourceRuleIndex: choice.persistence.sourceRuleIndex, flag: choice.flag },
            deps
          );
        }
      }
    }
  }
}

async function validateRuleTarget(
  actor: DraftMutationActor,
  selection: SelectionRef,
  target: { sourceRuleIndex: number; flag: string },
  deps: PrepareDraftApplicationDependencies
): Promise<void> {
  const actorItem = (listActorItems(actor) as ActorItemLike[]).find((item) =>
    itemMatchesSourceId(item, selection.uuid)
  );
  const document = actorItem ? null : await deps.fetchSelectionDocument(selection);
  const source = actorItem ?? document?.toObject();
  const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
  const rule = rules[target.sourceRuleIndex];
  if (
    !rule ||
    typeof rule !== "object" ||
    rule.key !== "ChoiceSet" ||
    effectiveChoiceFlag(rule, source) !== target.flag
  ) {
    throw new Error(`Cannot persist ${target.flag}: its PF2E choice target changed or is unavailable.`);
  }
}

function effectiveChoiceFlag(
  rule: Record<string, unknown>,
  source: ActorItemLike | EmbeddedItemSource | undefined
): string | null {
  for (const value of [rule.flag, rule.slug]) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.replace(/[^-a-z0-9]/giu, "");
    }
  }
  const sourceSlug = source?.system?.slug;
  if (typeof sourceSlug !== "string") return null;
  const parts = sourceSlug
    .trim()
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts
    .map((part, index) => (index === 0 ? part.toLowerCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join("");
}

function validateSpellDestinations(actor: DraftMutationActor, draft: DraftState, steps: PendingStep[]): void {
  const plannedDestinationKeys = new Set<string>();
  for (const step of steps) {
    if (step.kind !== "spell-choice" || (draft.spellChoices[step.slotId]?.length ?? 0) === 0) {
      continue;
    }
    if (!step.spellChoice.reuseExistingEntryOnly) {
      plannedDestinationKeys.add(step.spellChoice.destination.key);
      continue;
    }
    const entry = findSpellcastingEntryForChoice(actor, step.spellChoice);
    if (!entry?.id && !plannedDestinationKeys.has(step.spellChoice.destination.key)) {
      throw new Error(`Cannot place ${step.title}: its PF2E spellcasting destination is unavailable.`);
    }
  }
}

async function validateMutationCapabilities(
  actor: DraftMutationActor,
  selections: SelectionRef[],
  steps: PendingStep[]
): Promise<void> {
  if (selections.length > 0 && typeof actor.createEmbeddedDocuments !== "function") {
    throw new Error("This actor cannot create the selected PF2E items.");
  }
  if (
    steps.some((step) =>
      ["singleton-choice", "class-choice", "class-branch", "spell-choice", "skill-training"].includes(step.kind)
    ) &&
    typeof actor.updateEmbeddedDocuments !== "function"
  ) {
    throw new Error("This actor cannot persist the selected PF2E item choices.");
  }
  if (typeof actor.update !== "function") {
    throw new Error("This actor cannot finalize the Wayfinder draft.");
  }
}

function sourceSelection(
  slotId: string,
  meta: {
    sourcePackId: string;
    sourceDocumentId: string;
    sourceUuid: string;
    sourceName?: string;
    sourceItemType?: string;
  }
): SelectionRef {
  const sourceItemType = meta.sourceItemType ?? "feat";
  return {
    slotId,
    packId: meta.sourcePackId,
    documentId: meta.sourceDocumentId,
    uuid: meta.sourceUuid,
    itemType: sourceItemType === "classfeature" ? "feat" : sourceItemType,
    featType: sourceItemType === "classfeature" || sourceItemType === "feat" ? "classfeature" : null,
    name: meta.sourceName ?? meta.sourceUuid,
    level: null,
  };
}

function addLevelUpdate(prepared: PreparedDraftApplication): void {
  const currentLevel = Number(prepared.actor?.system?.details?.level?.value ?? 1) || 1;
  if (prepared.draft.targetLevel > currentLevel) {
    prepared.deferredActorUpdate["system.details.level.value"] = prepared.draft.targetLevel;
  }
}

function refreshActorData(actor: DraftMutationActor): void {
  if (hasPreparedPf2eFlagAlias(actor)) return;
  actor.prepareData?.();
}

function hasPreparedPf2eFlagAlias(actor: DraftMutationActor): boolean {
  const flags = actor.flags;
  if (!flags || typeof flags !== "object") return false;
  const descriptor = Object.getOwnPropertyDescriptor(flags, "system");
  return !!descriptor && descriptor.configurable === false;
}
