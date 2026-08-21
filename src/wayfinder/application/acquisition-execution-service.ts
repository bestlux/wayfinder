import type {
  DraftApplyWriteCheckpointEmitter,
  ExecutePreparedDraftApplicationOptions,
} from "../../actor-updater/prepared-draft-application.js";
import { MODULE_ID } from "../../constants.js";
import type { EmbeddedItemSource } from "../../shared/actor-model.js";
import { cloneData } from "../../shared/cloning.js";
import type { DraftState, ModuleState } from "../../types.js";
import {
  type AcquisitionCurrencyConvergenceWitnessV1,
  acquisitionCurrencyConvergenceWitnessMatches,
  createAcquisitionCurrencyConvergenceWitness,
} from "../domain/acquisition-currency-convergence.js";
import { normalizeAcquisitionDraft, normalizeAcquisitionPolicySnapshot } from "../domain/acquisition-draft.js";
import {
  assertPreparedAcquisitionIdentityPlanMatches,
  type PreparedAcquisitionEntryV1,
  type PreparedAcquisitionIdentityPlanV1,
  prepareAcquisitionIdentityPlan,
} from "../domain/acquisition-identity.js";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionCompletion,
  evaluateAcquisitionLedger,
} from "../domain/acquisition-ledger.js";
import type {
  AcquisitionDraftState,
  AcquisitionLinePolicyDecision,
  AcquisitionPolicySnapshot,
  AcquisitionPriceSnapshot,
} from "../domain/acquisition-types.js";
import {
  type ClassGrantReconciliationResultV1,
  type PlannedClassGrantV1,
  type PreparedClassGrantPlanV1,
  reconcilePreparedClassGrants,
} from "../domain/class-grant-reconciliation.js";
import {
  assertCompletedAcquisitionManifestMatchesIdentityPlan,
  type CompletedAcquisitionManifestV1,
  type CompletedObservedItemV1,
  createCompletedAcquisitionManifest,
  manifestsMateriallyEqual,
  normalizeCompletedAcquisitionManifest,
  type VerifiedAcquisitionOutcomeV1,
} from "../domain/completed-acquisition-manifest.js";
import type {
  EconomicBaselineV1,
  EconomicHistoryFacts,
  EconomicRetryExpectation,
} from "../domain/economic-baseline.js";
import { captureObservedClassGrantItems } from "./class-grant-projection-service.js";
import {
  captureActorEconomicBaseline,
  type EconomicActorLike,
  evaluateActorEconomicAdmission,
} from "./economic-baseline-service.js";
import { fingerprintEquipmentDocument } from "./equipment-catalogue-service.js";
import { materializedPhysicalItemSize } from "./equipment-size-preparation-service.js";

type AcquisitionHistoryState = Pick<
  ModuleState,
  "lastAppliedAt" | "lastTargetLevel" | "completedAcquisitionManifest" | "completedAcquisitionManifestCorrupt"
>;

export interface ResolvedAcquisitionSource {
  readonly source: EmbeddedItemSource;
  readonly sourceUuid: string;
  readonly documentFingerprint: string;
  readonly priceFingerprint: string;
  /** Fresh base-source price facts; execution reapplies the reviewed target size and quantity. */
  readonly resolvedPrice: AcquisitionPriceSnapshot;
  readonly policyDecision: AcquisitionLinePolicyDecision;
}

export interface AcquisitionInventoryAdapter {
  readonly add: (
    actor: unknown,
    source: EmbeddedItemSource,
    options: { readonly stack: false; readonly render: false }
  ) => Promise<unknown>;
  readonly addCurrency: (actor: unknown, copper: number) => Promise<unknown>;
  readonly removeCurrency: (actor: unknown, copper: number) => Promise<unknown>;
}

export interface AcquisitionExecutionDependencies {
  readonly resolveSource: (args: {
    readonly actor: unknown;
    readonly draft: AcquisitionDraftState;
    readonly entry: PreparedAcquisitionEntryV1;
  }) => ResolvedAcquisitionSource | Promise<ResolvedAcquisitionSource>;
  readonly readHistory: () => AcquisitionHistoryState | Promise<AcquisitionHistoryState>;
  readonly resolveCurrentPolicySnapshot: (args: {
    readonly actor: unknown;
    readonly draft: AcquisitionDraftState;
  }) => AcquisitionPolicySnapshot | Promise<AcquisitionPolicySnapshot>;
  readonly assertApplyAuthority: (args: {
    readonly actor: unknown;
    readonly draft: AcquisitionDraftState;
  }) => void | Promise<void>;
  readonly readApplyingUser: () => { readonly userId: string; readonly userName: string };
  readonly readEnvironment: () => CompletedAcquisitionManifestV1["environment"];
  readonly now?: () => string;
  readonly inventory?: AcquisitionInventoryAdapter;
}

export interface AcquisitionExecutionSession {
  readonly executeAcquisitionItems: NonNullable<ExecutePreparedDraftApplicationOptions["executeAcquisitionItems"]>;
  readonly executeAcquisitionCurrency: NonNullable<
    ExecutePreparedDraftApplicationOptions["executeAcquisitionCurrency"]
  >;
  readonly verifyAcquisitionOutcome: NonNullable<ExecutePreparedDraftApplicationOptions["verifyAcquisitionOutcome"]>;
  readonly readCurrentAcquisitionHistory: NonNullable<
    ExecutePreparedDraftApplicationOptions["readCurrentAcquisitionHistory"]
  >;
  readonly prepareRecoveredAcquisitionOutcome: (args: {
    readonly actor: unknown;
    readonly draft: DraftState;
    readonly classGrantPlan: PreparedClassGrantPlanV1;
    readonly finalClassGrantReconciliation: ClassGrantReconciliationResultV1;
  }) => Promise<VerifiedAcquisitionOutcomeV1>;
}

interface PreparedExecution {
  readonly actorId: string;
  readonly draft: AcquisitionDraftState;
  readonly classGrantPlan: PreparedClassGrantPlanV1;
  readonly identityPlan: PreparedAcquisitionIdentityPlanV1;
  readonly initialBaseline: EconomicBaselineV1;
  readonly targetCopper: number;
  readonly handoff: boolean;
  readonly sources: ReadonlyMap<string, EmbeddedItemSource>;
  readonly persistedRecoveryManifest: CompletedAcquisitionManifestV1 | null;
  readonly persistedCurrencyConvergenceWitness: AcquisitionCurrencyConvergenceWitnessV1 | null;
}

interface AcquisitionItemObservation {
  readonly evidence: readonly CompletedObservedItemV1[];
  readonly observedEntryIds: ReadonlySet<string>;
}

export function createAcquisitionExecutionSession(
  dependencies: AcquisitionExecutionDependencies
): AcquisitionExecutionSession {
  const inventory = dependencies.inventory ?? createPf2eAcquisitionInventoryAdapter();
  const now = dependencies.now ?? (() => new Date().toISOString());
  let prepared: PreparedExecution | null = null;

  return {
    readCurrentAcquisitionHistory: async () => {
      const history = await dependencies.readHistory();
      return {
        completedAcquisitionManifest: history.completedAcquisitionManifest,
        completedAcquisitionManifestCorrupt: history.completedAcquisitionManifestCorrupt,
      };
    },
    executeAcquisitionItems: async ({ actor, draft, classGrantPlan, emitWriteCheckpoint }) => {
      prepared = await prepareExecution({
        actor,
        draft,
        classGrantPlan,
        dependencies,
        now,
      });
      if (prepared.handoff) return;

      let current = captureBaseline(actor, now);
      assertStableNonAcquisitionItems(prepared.initialBaseline, current, prepared.identityPlan);
      assertCurrencyUnchanged(prepared.initialBaseline, current);
      let observation = observePlannedItems(prepared.identityPlan, current);
      assertObservedWayfinderItemSizes(actor, prepared, observation);
      let ordinal = 0;
      for (const entry of prepared.identityPlan.entries) {
        const source = prepared.sources.get(entry.entryId);
        if (!source) throw new Error(`Prepared acquisition source ${entry.entryId} is unavailable.`);
        if (entryMaterializer(entry, prepared.classGrantPlan) === "pf2e-native") continue;
        for (const plannedItem of entry.plannedItems) {
          if (observation.evidence.some((item) => item.plannedItemId === plannedItem.plannedItemId)) continue;
          ordinal += 1;
          const stamped = stampAcquisitionSource(source, entry, plannedItem, prepared.identityPlan.subject);
          await executeItemWrite({
            actor,
            source: stamped,
            ordinal,
            emitWriteCheckpoint,
            inventory,
            expectedBaseline: current,
            now,
          });
          current = captureBaseline(actor, now);
          assertStableNonAcquisitionItems(prepared.initialBaseline, current, prepared.identityPlan);
          assertCurrencyUnchanged(prepared.initialBaseline, current);
          observation = observePlannedItems(prepared.identityPlan, current);
          if (!observation.evidence.some((item) => item.plannedItemId === plannedItem.plannedItemId)) {
            throw new Error(`PF2E did not create prepared acquisition item ${plannedItem.plannedItemId}.`);
          }
          assertObservedWayfinderItemSizes(actor, prepared, observation);
          await emitWriteCheckpoint("embedded-item-create", "after", ordinal);
        }
      }
      current = captureBaseline(actor, now);
      const completedObservation = observeCompletedItems(
        prepared,
        current,
        reconcileCurrentClassGrants(actor, prepared.classGrantPlan, "after-acquisition")
      );
      assertObservedWayfinderItemSizes(actor, prepared, completedObservation);
      assertAllPlannedItemsObserved(prepared.identityPlan, completedObservation);
    },
    executeAcquisitionCurrency: async ({
      actor,
      draft,
      classGrantPlan,
      emitWriteCheckpoint,
      persistCurrencyConvergenceWitness,
    }) => {
      const execution = requirePreparedExecution(prepared, actor, draft, classGrantPlan);
      let current = captureBaseline(actor, now);
      assertStableNonAcquisitionItems(execution.initialBaseline, current, execution.identityPlan);
      const observation = observeCompletedItems(
        execution,
        current,
        reconcileCurrentClassGrants(actor, execution.classGrantPlan, "final")
      );
      assertObservedWayfinderItemSizes(actor, execution, observation);
      if (execution.handoff) {
        if (current.fingerprint !== execution.initialBaseline.fingerprint) {
          throw new Error("Actor wealth changed after the starting-equipment handoff was admitted.");
        }
        return;
      }
      assertAllPlannedItemsObserved(execution.identityPlan, observation);

      const delta = execution.targetCopper - current.currencyCopper;
      if (!Number.isSafeInteger(delta)) throw new RangeError("Starting-equipment currency delta is unsafe.");
      if (delta !== 0) {
        let writeAttempted = false;
        let writeFailed = false;
        let writeError: unknown;
        try {
          await executeAfterBeforeWriteRevalidation({
            actor,
            expectedBaseline: current,
            now,
            operation: "currency-convergence",
            ordinal: 1,
            emitWriteCheckpoint,
            write: () => {
              writeAttempted = true;
              return delta > 0 ? inventory.addCurrency(actor, delta) : inventory.removeCurrency(actor, -delta);
            },
          });
        } catch (error) {
          if (!writeAttempted) throw error;
          writeFailed = true;
          writeError = error;
        }
        current = captureBaseline(actor, now);
        assertStableNonAcquisitionItems(execution.initialBaseline, current, execution.identityPlan);
        const completedObservation = observeCompletedItems(
          execution,
          current,
          reconcileCurrentClassGrants(actor, execution.classGrantPlan, "final")
        );
        assertObservedWayfinderItemSizes(actor, execution, completedObservation);
        assertAllPlannedItemsObserved(execution.identityPlan, completedObservation);
        if (current.currencyCopper !== execution.targetCopper) {
          throw new Error("PF2E did not converge actor currency to the reviewed absolute target.");
        }
        const witness = createCurrencyConvergenceWitness(execution, current);
        await persistCurrencyConvergenceWitness(witness);
        if (writeFailed) throw writeError;
        await emitWriteCheckpoint("currency-convergence", "after", 1);
      }
      if (current.currencyCopper !== execution.targetCopper) {
        throw new Error("Actor currency differs from the reviewed absolute target.");
      }
    },
    verifyAcquisitionOutcome: async ({
      actor,
      draft,
      classGrantPlan,
      finalClassGrantReconciliation,
    }): Promise<VerifiedAcquisitionOutcomeV1> => {
      const execution = requirePreparedExecution(prepared, actor, draft, classGrantPlan);
      return verifyPreparedExecution({
        actor,
        execution,
        finalClassGrantReconciliation,
        dependencies,
        now,
      });
    },
    prepareRecoveredAcquisitionOutcome: async ({ actor, draft, classGrantPlan, finalClassGrantReconciliation }) => {
      const execution = await prepareExecution({
        actor,
        draft,
        classGrantPlan,
        dependencies,
        now,
        recoveryFinalization: true,
      });
      return verifyPreparedExecution({
        actor,
        execution,
        finalClassGrantReconciliation,
        dependencies,
        now,
      });
    },
  };
}

export function createPf2eAcquisitionInventoryAdapter(): AcquisitionInventoryAdapter {
  return {
    add: async (actor, source, options) => {
      const inventory = actorInventory(actor);
      const add = inventory.add;
      if (typeof add !== "function") throw new Error("PF2E actor inventory item insertion is unavailable.");
      return Reflect.apply(add, inventory, [source, options]);
    },
    addCurrency: async (actor, copper) => callCurrencyMethod(actor, "addCurrency", copper),
    removeCurrency: async (actor, copper) => callCurrencyMethod(actor, "removeCurrency", copper),
  };
}

async function prepareExecution(args: {
  readonly actor: unknown;
  readonly draft: DraftState;
  readonly classGrantPlan: PreparedClassGrantPlanV1;
  readonly dependencies: AcquisitionExecutionDependencies;
  readonly now: () => string;
  readonly recoveryFinalization?: boolean;
}): Promise<PreparedExecution> {
  const actorId = actorIdentifier(args.actor);
  const acquisition = normalizeAcquisitionDraft(cloneData(args.draft.acquisition));
  if (!acquisition) throw new TypeError("Starting-equipment execution requires canonical acquisition state.");
  if (acquisition.targetLevel !== args.draft.targetLevel) {
    throw new Error("Starting-equipment execution target does not match the character draft.");
  }
  if (args.recoveryFinalization && !hasApplyRecoveryLock(args.draft)) {
    throw new Error("Starting-equipment recovery verification requires persisted Apply recovery evidence.");
  }
  const ledger = evaluateAcquisitionLedger(acquisition, args.classGrantPlan);
  const completion = evaluateAcquisitionCompletion(acquisition, ledger);
  if (!ledger.valid || !ledger.materialFacts || !completion.complete) {
    throw new Error(`Starting-equipment review is incomplete: ${completion.reasons.join(", ") || "invalid-ledger"}.`);
  }
  const identityPlan = await prepareAcquisitionIdentityPlan({
    actorId,
    draft: acquisition,
    ledger,
    classGrantPlan: args.classGrantPlan,
  });
  assertSupportedIdentityShape(identityPlan);
  const targetCopper =
    acquisition.disposition.kind === "handoff"
      ? acquisition.baseline!.currencyCopper
      : safeCopperAdd(acquisition.baseline!.currencyCopper, identityPlan.ledger.remainingCopper);
  const persistedCurrencyConvergenceWitness = resolvePersistedCurrencyConvergenceWitness({
    draft: args.draft,
    actorId,
    acquisition,
    identityPlan,
    targetCopper,
  });
  const history = await args.dependencies.readHistory();
  const persistedRecoveryManifest = resolvePersistedRecoveryManifest({
    history,
    recoveryFinalization: args.recoveryFinalization === true,
    actorId,
    acquisition,
    identityPlan,
  });
  const retryExpectation = buildRetryExpectation(
    identityPlan,
    targetCopper,
    args.classGrantPlan,
    persistedRecoveryManifest,
    persistedCurrencyConvergenceWitness
  );
  const initialBaseline = captureBaseline(args.actor, args.now);
  assertWitnessedCurrencyUnchanged(persistedCurrencyConvergenceWitness, initialBaseline);
  const admission = evaluateActorEconomicAdmission({
    actor: args.actor as EconomicActorLike,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    higherLevelStartEvidence: acquisition.policySnapshot!.material.higherLevelStartEvidence,
    history: economicHistory(history, args.recoveryFinalization === true, persistedRecoveryManifest !== null),
    retryExpectation,
    preparedClassGrantPlan: args.classGrantPlan,
    classGrantPhase: "before-acquisition",
    capturedAt: initialBaseline.capturedAt,
  });
  const handoff = acquisition.disposition.kind === "handoff";
  const initialClassGrants = reconcileCurrentClassGrants(args.actor, args.classGrantPlan, "before-acquisition");
  assertEconomicAdmission(
    admission,
    acquisition,
    initialBaseline,
    nativeResolvedItemIds(args.classGrantPlan, initialClassGrants)
  );

  const currentPolicy = normalizeAcquisitionPolicySnapshot(
    cloneData(await args.dependencies.resolveCurrentPolicySnapshot({ actor: args.actor, draft: acquisition }))
  );
  if (
    !currentPolicy ||
    !acquisition.policySnapshot ||
    stableJson(currentPolicy.material) !== stableJson(acquisition.policySnapshot.material)
  ) {
    throw new Error("Current starting-equipment policy differs from the reviewed authority.");
  }
  const sources = new Map<string, EmbeddedItemSource>();
  const preflightedLineIds = new Set<string>();
  if (!handoff) {
    for (const entry of identityPlan.entries) {
      const resolved = await args.dependencies.resolveSource({ actor: args.actor, draft: acquisition, entry });
      assertResolvedSourceMatches(entry, resolved);
      sources.set(entry.entryId, cloneData(resolved.source));
      for (const lineId of entry.lineIds) preflightedLineIds.add(lineId);
    }
    assertPreflightCoversEveryLine(acquisition, preflightedLineIds);
  }
  await args.dependencies.assertApplyAuthority({ actor: args.actor, draft: acquisition });
  const policyAfterPreflight = normalizeAcquisitionPolicySnapshot(
    cloneData(await args.dependencies.resolveCurrentPolicySnapshot({ actor: args.actor, draft: acquisition }))
  );
  if (
    !policyAfterPreflight ||
    !acquisition.policySnapshot ||
    stableJson(policyAfterPreflight.material) !== stableJson(acquisition.policySnapshot.material)
  ) {
    throw new Error("Starting-equipment policy changed during source preflight.");
  }
  const afterPreflight = captureBaseline(args.actor, args.now);
  if (afterPreflight.fingerprint !== initialBaseline.fingerprint) {
    throw new Error("Actor wealth changed during starting-equipment source preflight.");
  }
  const historyAfterPreflight = await args.dependencies.readHistory();
  const persistedRecoveryManifestAfterPreflight = resolvePersistedRecoveryManifest({
    history: historyAfterPreflight,
    recoveryFinalization: args.recoveryFinalization === true,
    actorId,
    acquisition,
    identityPlan,
  });
  if (stableJson(persistedRecoveryManifestAfterPreflight) !== stableJson(persistedRecoveryManifest)) {
    throw new Error("Completed acquisition history changed during source preflight.");
  }
  const admissionAfterPreflight = evaluateActorEconomicAdmission({
    actor: args.actor as EconomicActorLike,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    higherLevelStartEvidence: acquisition.policySnapshot!.material.higherLevelStartEvidence,
    history: economicHistory(
      historyAfterPreflight,
      args.recoveryFinalization === true,
      persistedRecoveryManifestAfterPreflight !== null
    ),
    retryExpectation,
    preparedClassGrantPlan: args.classGrantPlan,
    classGrantPhase: "before-acquisition",
    capturedAt: afterPreflight.capturedAt,
  });
  const classGrantsAfterPreflight = reconcileCurrentClassGrants(args.actor, args.classGrantPlan, "before-acquisition");
  assertEconomicAdmission(
    admissionAfterPreflight,
    acquisition,
    afterPreflight,
    nativeResolvedItemIds(args.classGrantPlan, classGrantsAfterPreflight)
  );
  const initialObservation = observePlannedItems(identityPlan, initialBaseline);
  if (!handoff && admission.kind === "eligible-retry") {
    const observed = [...initialObservation.observedEntryIds].sort();
    const admitted = [...admission.entryIds].sort();
    if (stableJson(observed) !== stableJson(admitted)) {
      throw new Error("Observed retry items differ from economic admission evidence.");
    }
  }
  if (handoff && initialObservation.evidence.length > 0) {
    throw new Error("A PF2E-sheet handoff cannot contain automated acquisition items.");
  }
  return {
    actorId,
    draft: acquisition,
    classGrantPlan: args.classGrantPlan,
    identityPlan,
    initialBaseline,
    targetCopper,
    handoff,
    sources,
    persistedRecoveryManifest,
    persistedCurrencyConvergenceWitness,
  };
}

function verifyPreparedExecution(args: {
  readonly actor: unknown;
  readonly execution: PreparedExecution;
  readonly finalClassGrantReconciliation: ClassGrantReconciliationResultV1;
  readonly dependencies: AcquisitionExecutionDependencies;
  readonly now: () => string;
}): VerifiedAcquisitionOutcomeV1 {
  const { execution } = args;
  const current = captureBaseline(args.actor, args.now);
  assertStableNonAcquisitionItems(execution.initialBaseline, current, execution.identityPlan);
  const freshFinalClassGrants = reconcileCurrentClassGrants(args.actor, execution.classGrantPlan, "final");
  if (stableJson(freshFinalClassGrants) !== stableJson(args.finalClassGrantReconciliation)) {
    throw new Error("Final class-grant evidence changed before acquisition verification.");
  }
  const observation = execution.handoff
    ? { evidence: [], observedEntryIds: new Set<string>() }
    : observeCompletedItems(execution, current, freshFinalClassGrants);
  assertObservedWayfinderItemSizes(args.actor, execution, observation);
  if (execution.handoff) {
    if (current.fingerprint !== execution.initialBaseline.fingerprint) {
      throw new Error("Actor wealth changed after the starting-equipment handoff was admitted.");
    }
  } else {
    assertAllPlannedItemsObserved(execution.identityPlan, observation);
  }
  if (current.currencyCopper !== execution.targetCopper) {
    throw new Error("Actor currency differs from the completed starting-equipment target.");
  }

  const baselineCopper = execution.draft.baseline?.currencyCopper;
  if (!Number.isSafeInteger(baselineCopper) || (baselineCopper as number) < 0) {
    throw new TypeError("The reviewed starting-equipment baseline is unavailable.");
  }
  const currency = execution.handoff
    ? {
        preCopper: baselineCopper as number,
        budgetCopper: execution.identityPlan.ledger.budgetCopper,
        spentCopper: 0,
        remainingCopper: execution.identityPlan.ledger.budgetCopper,
        targetCopper: baselineCopper as number,
        observedCopper: current.currencyCopper,
      }
    : {
        preCopper: baselineCopper as number,
        budgetCopper: execution.identityPlan.ledger.budgetCopper,
        spentCopper: execution.identityPlan.ledger.spentCopper,
        remainingCopper: execution.identityPlan.ledger.remainingCopper,
        targetCopper: execution.targetCopper,
        observedCopper: current.currencyCopper,
      };
  const persisted = execution.persistedRecoveryManifest;
  const manifest = createCompletedAcquisitionManifest({
    actorId: execution.actorId,
    draft: execution.draft,
    identityPlan: execution.identityPlan,
    appliedBy: persisted?.appliedBy ?? args.dependencies.readApplyingUser(),
    appliedAt: persisted?.appliedAt ?? args.now(),
    currency,
    observedItems: execution.handoff ? [] : observation.evidence,
    finalClassGrantReconciliation: freshFinalClassGrants,
    environment: persisted?.environment ?? args.dependencies.readEnvironment(),
  });
  if (persisted && !manifestsMateriallyEqual(manifest, persisted)) {
    throw new Error("Persisted acquisition outcome differs from freshly verified actor evidence.");
  }
  return { kind: "completed", identityPlan: execution.identityPlan, manifest: persisted ?? manifest };
}

function requirePreparedExecution(
  execution: PreparedExecution | null,
  actor: unknown,
  draft: DraftState,
  classGrantPlan: PreparedClassGrantPlanV1
): PreparedExecution {
  if (!execution) throw new Error("Starting-equipment items must be prepared before currency or verification.");
  const acquisition = normalizeAcquisitionDraft(cloneData(draft.acquisition));
  if (!acquisition || actorIdentifier(actor) !== execution.actorId) {
    throw new Error("Starting-equipment execution belongs to another actor or draft.");
  }
  assertPreparedAcquisitionIdentityPlanMatches({
    plan: execution.identityPlan,
    actorId: execution.actorId,
    draft: acquisition,
  });
  if (classGrantPlan.fingerprint !== execution.classGrantPlan.fingerprint) {
    throw new Error("Starting-equipment class-grant authority changed during Apply.");
  }
  return execution;
}

function assertResolvedSourceMatches(entry: PreparedAcquisitionEntryV1, resolved: ResolvedAcquisitionSource): void {
  if (resolved.sourceUuid !== entry.sourceUuid) {
    throw new Error(`Acquisition source drifted for ${entry.entryId}.`);
  }
  assertResolvedSourceIdentity(entry, resolved.source);
  if (resolved.documentFingerprint !== entry.documentFingerprint) {
    throw new Error(`Acquisition document drifted for ${entry.entryId}.`);
  }
  if (fingerprintEquipmentDocument(resolved.source) !== entry.documentFingerprint) {
    throw new Error(`Acquisition source document differs from the reviewed document for ${entry.entryId}.`);
  }
  if (resolved.priceFingerprint !== entry.priceFingerprint) {
    throw new Error(`Acquisition price drifted for ${entry.entryId}.`);
  }
  const rebuiltPrice = createAcquisitionPriceSnapshot({
    basePrice: cloneData(resolved.resolvedPrice.basePrice),
    size: entry.price.size,
    sizeSensitive: resolved.resolvedPrice.sizeSensitive,
    preciousMaterial: resolved.resolvedPrice.preciousMaterial,
    adjustedBulkPriceCopper: resolved.resolvedPrice.adjustedBulkPriceCopper,
    configurationPriceCopper: resolved.resolvedPrice.configurationPriceCopper,
    pricePer: resolved.resolvedPrice.pricePer,
    sourceQuantity: resolved.resolvedPrice.sourceQuantity,
    requestedQuantity: entry.price.requestedQuantity,
    ...(resolved.resolvedPrice.configurationComponents
      ? { configurationComponents: cloneData(resolved.resolvedPrice.configurationComponents) }
      : {}),
  });
  if (
    rebuiltPrice.ok === false ||
    stableJson(rebuiltPrice.value) !== stableJson(entry.price) ||
    rebuiltPrice.value.materializedQuantity !== entry.quantity
  ) {
    throw new Error(`Acquisition resolved-price or quantity drifted for ${entry.entryId}.`);
  }
  if (stableJson(resolved.policyDecision) !== stableJson(entry.policyDecision)) {
    throw new Error(`Acquisition policy drifted for ${entry.entryId}.`);
  }
  if (!resolved.source || typeof resolved.source !== "object") {
    throw new TypeError(`Acquisition source ${entry.entryId} has no embeddable item data.`);
  }
}

function assertResolvedSourceIdentity(entry: PreparedAcquisitionEntryV1, source: EmbeddedItemSource): void {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/.exec(entry.sourceUuid);
  if (!match || source._id !== match[2]) {
    throw new Error(`Acquisition source document identity differs for ${entry.entryId}.`);
  }
  const statsSourceId = source._stats?.compendiumSource;
  if (
    source._stats &&
    Object.prototype.hasOwnProperty.call(source._stats, "compendiumSource") &&
    statsSourceId !== entry.sourceUuid
  ) {
    throw new Error(`Acquisition source compendium identity differs for ${entry.entryId}.`);
  }
  const coreSourceId = source.flags?.core?.sourceId;
  if (
    source.flags?.core &&
    Object.prototype.hasOwnProperty.call(source.flags.core, "sourceId") &&
    coreSourceId !== entry.sourceUuid
  ) {
    throw new Error(`Acquisition source flag identity differs for ${entry.entryId}.`);
  }
}

function assertEconomicAdmission(
  admission: ReturnType<typeof evaluateActorEconomicAdmission>,
  acquisition: AcquisitionDraftState,
  baseline: EconomicBaselineV1,
  ignoredNativeItemIds: ReadonlySet<string>
): void {
  if (acquisition.disposition.kind === "handoff") {
    const configuredItemHandoff = acquisition.disposition.handoff.reasons.some(
      (reason) => reason.code === "unsafe-configured-item"
    );
    if (configuredItemHandoff) {
      if (
        acquisition.disposition.handoff.reasons.length !== 1 ||
        admission.kind !== "eligible-empty" ||
        !economicBaselinesMatchIgnoringItems(acquisition.baseline!, baseline, ignoredNativeItemIds)
      ) {
        throw new Error("The configured-item handoff no longer matches the reviewed actor baseline.");
      }
    } else if (
      admission.kind !== "handoff" ||
      stableJson(admission.handoff) !== stableJson(acquisition.disposition.handoff)
    ) {
      throw new Error("The acknowledged starting-equipment handoff no longer matches current actor wealth.");
    }
  } else if (admission.kind !== "eligible-empty" && admission.kind !== "eligible-retry") {
    const detail = admission.kind === "blocked" ? admission.message : "current wealth requires PF2E-sheet handoff";
    throw new Error(`Starting-equipment economic admission failed: ${detail}.`);
  }
  if (admission.baseline.fingerprint !== baseline.fingerprint) {
    throw new Error("Actor wealth changed while starting-equipment admission was evaluated.");
  }
  if (
    acquisition.disposition.kind !== "handoff" &&
    admission.kind === "eligible-empty" &&
    !economicBaselinesMatchIgnoringItems(acquisition.baseline!, baseline, ignoredNativeItemIds)
  ) {
    throw new Error("Current actor wealth differs from the reviewed economic baseline.");
  }
}

function stampAcquisitionSource(
  sourceInput: EmbeddedItemSource,
  entry: PreparedAcquisitionEntryV1,
  plannedItem: PreparedAcquisitionEntryV1["plannedItems"][number],
  subject: PreparedAcquisitionIdentityPlanV1["subject"]
): EmbeddedItemSource {
  const source = cloneData(sourceInput);
  delete source._id;
  source.system = {
    ...(source.system ?? {}),
    quantity: plannedItem.quantity,
    containerId: null,
    size: materializedPhysicalItemSize(entry.price.size),
  };
  source.flags = { ...(source.flags ?? {}) };
  source.flags.core = { ...(source.flags.core ?? {}), sourceId: plannedItem.sourceUuid };
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    acquisition: {
      version: 1,
      draftId: subject.draftId,
      batchId: subject.batchId,
      manifestId: subject.manifestId,
      lineId: entry.lineIds[0]!,
      entryId: entry.entryId,
      plannedItemId: plannedItem.plannedItemId,
      plannedContainerId: plannedItem.plannedContainerId,
      plannedGrantId: entry.funding.lane === "class-grant" ? entry.funding.grant.plannedGrantId : null,
      stackingIntent: entry.stackingIntent,
    },
  };
  return source;
}

async function executeItemWrite(args: {
  readonly actor: unknown;
  readonly source: EmbeddedItemSource;
  readonly ordinal: number;
  readonly emitWriteCheckpoint: DraftApplyWriteCheckpointEmitter;
  readonly inventory: AcquisitionInventoryAdapter;
  readonly expectedBaseline: EconomicBaselineV1;
  readonly now: () => string;
}): Promise<void> {
  await executeAfterBeforeWriteRevalidation({
    actor: args.actor,
    expectedBaseline: args.expectedBaseline,
    now: args.now,
    operation: "embedded-item-create",
    ordinal: args.ordinal,
    emitWriteCheckpoint: args.emitWriteCheckpoint,
    write: () => args.inventory.add(args.actor, args.source, { stack: false, render: false }),
  });
}

async function executeAfterBeforeWriteRevalidation(args: {
  readonly actor: unknown;
  readonly expectedBaseline: EconomicBaselineV1;
  readonly now: () => string;
  readonly operation: "embedded-item-create" | "currency-convergence";
  readonly ordinal: number;
  readonly emitWriteCheckpoint: DraftApplyWriteCheckpointEmitter;
  readonly write: () => unknown | Promise<unknown>;
}): Promise<void> {
  await args.emitWriteCheckpoint(args.operation, "before", args.ordinal);
  const current = captureBaseline(args.actor, args.now);
  if (current.fingerprint !== args.expectedBaseline.fingerprint) {
    throw new Error(`Actor wealth changed after the ${args.operation} before-write checkpoint.`);
  }
  await args.write();
}

function observeCompletedItems(
  execution: PreparedExecution,
  baseline: EconomicBaselineV1,
  classGrantReconciliation: ClassGrantReconciliationResultV1
): AcquisitionItemObservation {
  const stamped = observePlannedItems(execution.identityPlan, baseline);
  const native = observeNativeClassGrantItems(
    execution.identityPlan,
    execution.classGrantPlan,
    baseline,
    classGrantReconciliation
  );
  const byPlannedId = new Map<string, CompletedObservedItemV1>();
  const actualItemIds = new Set<string>();
  for (const observed of [...stamped.evidence, ...native.evidence]) {
    if (byPlannedId.has(observed.plannedItemId) || actualItemIds.has(observed.actualItemId)) {
      throw new Error("Acquisition item evidence is duplicated across materializers.");
    }
    byPlannedId.set(observed.plannedItemId, observed);
    actualItemIds.add(observed.actualItemId);
  }
  return {
    evidence: execution.identityPlan.entries.flatMap((entry) =>
      entry.plannedItems.flatMap((planned) => {
        const observed = byPlannedId.get(planned.plannedItemId);
        return observed ? [observed] : [];
      })
    ),
    observedEntryIds: new Set([...stamped.observedEntryIds, ...native.observedEntryIds]),
  };
}

function observeNativeClassGrantItems(
  plan: PreparedAcquisitionIdentityPlanV1,
  classGrantPlan: PreparedClassGrantPlanV1,
  baseline: EconomicBaselineV1,
  reconciliation: ClassGrantReconciliationResultV1
): AcquisitionItemObservation {
  const reconciledByGrantId = new Map(reconciliation.entries.map((entry) => [entry.grantId, entry]));
  const evidence: CompletedObservedItemV1[] = [];
  const observedEntryIds = new Set<string>();
  for (const entry of plan.entries) {
    const grant = classGrantForEntry(entry, classGrantPlan);
    if (!grant || grant.materializer !== "pf2e-native") continue;
    const reconciled = reconciledByGrantId.get(grant.grantId);
    if (!reconciled || reconciled.status !== "resolved" || reconciled.itemIds.length !== 1) {
      throw new Error(`PF2E-native class grant ${grant.grantId} is not resolved exactly once.`);
    }
    const planned = entry.plannedItems[0]!;
    const actual = baseline.physicalItems.find((item) => item.itemId === reconciled.itemIds[0]);
    if (
      !actual ||
      actual.sourceUuid !== planned.sourceUuid ||
      actual.quantity !== planned.quantity ||
      actual.containerId !== planned.plannedContainerId
    ) {
      throw new Error(`PF2E-native class grant ${grant.grantId} differs from the prepared acquisition entry.`);
    }
    evidence.push({
      plannedItemId: planned.plannedItemId,
      actualItemId: actual.itemId,
      actualSourceUuid: planned.sourceUuid,
      actualQuantity: actual.quantity,
      plannedContainerId: planned.plannedContainerId,
      actualContainerId: actual.containerId,
    });
    observedEntryIds.add(entry.entryId);
  }
  return { evidence, observedEntryIds };
}

function assertObservedWayfinderItemSizes(
  actor: unknown,
  execution: PreparedExecution,
  observation: AcquisitionItemObservation
): void {
  const actualSizes = actorItemSizes(actor);
  const evidenceByPlannedId = new Map(observation.evidence.map((observed) => [observed.plannedItemId, observed]));
  for (const entry of execution.identityPlan.entries) {
    if (entryMaterializer(entry, execution.classGrantPlan) === "pf2e-native") continue;
    const expectedSize = materializedPhysicalItemSize(entry.price.size);
    for (const planned of entry.plannedItems) {
      const observed = evidenceByPlannedId.get(planned.plannedItemId);
      if (!observed) continue;
      const actual = actualSizes.get(observed.actualItemId);
      if (!actual || actual.prepared !== expectedSize || actual.raw !== expectedSize) {
        throw new Error(`PF2E acquisition item ${observed.actualItemId} has the wrong prepared or raw size.`);
      }
    }
  }
}

function actorItemSizes(actor: unknown): ReadonlyMap<string, { readonly prepared: unknown; readonly raw: unknown }> {
  if (!isRecord(actor)) throw new TypeError("PF2E acquisition size verification requires an actor.");
  const sizes = new Map<string, { readonly prepared: unknown; readonly raw: unknown }>();
  const visit = (item: unknown): void => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) {
      throw new TypeError("PF2E acquisition size verification found an item without a stable ID.");
    }
    if (sizes.has(item.id)) throw new TypeError("PF2E acquisition size verification found duplicate item IDs.");
    const system = isRecord(item.system) ? item.system : {};
    const source = isRecord(item._source) ? item._source : {};
    const rawSystem = isRecord(source.system) ? source.system : {};
    sizes.set(item.id, { prepared: system.size, raw: rawSystem.size });
    for (const child of collectionContents(item.subitems)) visit(child);
  };
  for (const item of collectionContents(actor.items)) visit(item);
  return sizes;
}

function collectionContents(value: unknown): readonly unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.contents)) return value.contents;
  throw new TypeError("PF2E acquisition size verification found a malformed item collection.");
}

function observePlannedItems(
  plan: PreparedAcquisitionIdentityPlanV1,
  baseline: EconomicBaselineV1
): AcquisitionItemObservation {
  const expectedByPlannedId = new Map(
    plan.entries.flatMap((entry) =>
      entry.plannedItems.map((planned) => [planned.plannedItemId, { entry, planned }] as const)
    )
  );
  const observedByPlannedId = new Map<string, CompletedObservedItemV1>();
  const observedEntryIds = new Set<string>();
  for (const item of baseline.physicalItems) {
    const identity = item.acquisitionIdentity;
    if (!identity || identity.draftId !== plan.subject.draftId || identity.batchId !== plan.subject.batchId) continue;
    const expected = expectedByPlannedId.get(identity.plannedItemId);
    if (
      !expected ||
      identity.manifestId !== plan.subject.manifestId ||
      identity.entryId !== expected.entry.entryId ||
      identity.lineId !== expected.entry.lineIds[0] ||
      identity.plannedContainerId !== expected.planned.plannedContainerId ||
      identity.plannedGrantId !==
        (expected.entry.funding.lane === "class-grant" ? expected.entry.funding.grant.plannedGrantId : null) ||
      identity.stackingIntent !== expected.entry.stackingIntent ||
      item.sourceUuid !== expected.planned.sourceUuid ||
      item.quantity !== expected.planned.quantity ||
      item.containerId !== expected.planned.plannedContainerId
    ) {
      throw new Error(`Actor item ${item.itemId} has mismatched acquisition identity or material facts.`);
    }
    if (observedByPlannedId.has(identity.plannedItemId)) {
      throw new Error(`Prepared acquisition item ${identity.plannedItemId} exists more than once.`);
    }
    observedByPlannedId.set(identity.plannedItemId, {
      plannedItemId: identity.plannedItemId,
      actualItemId: item.itemId,
      actualSourceUuid: expected.planned.sourceUuid,
      actualQuantity: item.quantity,
      plannedContainerId: expected.planned.plannedContainerId,
      actualContainerId: item.containerId,
    });
    observedEntryIds.add(expected.entry.entryId);
  }
  return {
    evidence: plan.entries.flatMap((entry) =>
      entry.plannedItems.flatMap((planned) => {
        const observed = observedByPlannedId.get(planned.plannedItemId);
        return observed ? [observed] : [];
      })
    ),
    observedEntryIds,
  };
}

function assertAllPlannedItemsObserved(
  plan: PreparedAcquisitionIdentityPlanV1,
  observation: AcquisitionItemObservation
): void {
  const expected = plan.entries.reduce((count, entry) => count + entry.plannedItems.length, 0);
  if (observation.evidence.length !== expected) {
    throw new Error("Completed acquisition evidence is missing one or more prepared items.");
  }
}

function classGrantForEntry(
  entry: PreparedAcquisitionEntryV1,
  classGrantPlan: PreparedClassGrantPlanV1
): PlannedClassGrantV1 | null {
  if (entry.funding.lane !== "class-grant") return null;
  const grantId = entry.funding.grant.plannedGrantId;
  const grant = classGrantPlan.grants.find((candidate) => candidate.grantId === grantId);
  if (!grant || grant.expected.sourceUuid !== entry.sourceUuid || entry.plannedItems.length !== 1) {
    throw new Error(`Prepared acquisition entry ${entry.entryId} has invalid class-grant authority.`);
  }
  return grant;
}

function entryMaterializer(
  entry: PreparedAcquisitionEntryV1,
  classGrantPlan: PreparedClassGrantPlanV1
): PlannedClassGrantV1["materializer"] {
  return classGrantForEntry(entry, classGrantPlan)?.materializer ?? "wayfinder-acquisition";
}

function reconcileCurrentClassGrants(
  actor: unknown,
  plan: PreparedClassGrantPlanV1,
  phase: ClassGrantReconciliationResultV1["phase"]
): ClassGrantReconciliationResultV1 {
  return reconcilePreparedClassGrants({
    plan,
    actorItems: captureObservedClassGrantItems(actor),
    phase,
  });
}

function nativeResolvedItemIds(
  plan: PreparedClassGrantPlanV1,
  reconciliation: ClassGrantReconciliationResultV1
): ReadonlySet<string> {
  const nativeGrantIds = new Set(
    plan.grants.filter((grant) => grant.materializer === "pf2e-native").map((grant) => grant.grantId)
  );
  return new Set(
    reconciliation.entries.flatMap((entry) =>
      entry.status === "resolved" && nativeGrantIds.has(entry.grantId) ? entry.itemIds : []
    )
  );
}

function economicBaselinesMatchIgnoringItems(
  reviewed: EconomicBaselineV1,
  current: EconomicBaselineV1,
  ignoredItemIds: ReadonlySet<string>
): boolean {
  const material = (baseline: EconomicBaselineV1) => ({
    actorId: baseline.actorId,
    currencyCopper: baseline.currencyCopper,
    physicalItems: baseline.physicalItems.filter((item) => !ignoredItemIds.has(item.itemId)),
  });
  return stableJson(material(reviewed)) === stableJson(material(current));
}

function assertPreflightCoversEveryLine(
  acquisition: AcquisitionDraftState,
  preflightedLineIds: ReadonlySet<string>
): void {
  const expectedLineIds = acquisition.lines.map((line) => line.lineId).sort();
  const actualLineIds = [...preflightedLineIds].sort();
  if (stableJson(actualLineIds) !== stableJson(expectedLineIds)) {
    throw new Error("Acquisition source preflight did not cover every reviewed line exactly once.");
  }
}

function assertStableNonAcquisitionItems(
  initial: EconomicBaselineV1,
  current: EconomicBaselineV1,
  plan: PreparedAcquisitionIdentityPlanV1
): void {
  const stableItems = (baseline: EconomicBaselineV1) =>
    baseline.physicalItems.filter(
      (item) =>
        item.acquisitionIdentity?.draftId !== plan.subject.draftId ||
        item.acquisitionIdentity.batchId !== plan.subject.batchId
    );
  if (stableJson(stableItems(initial)) !== stableJson(stableItems(current))) {
    throw new Error("Actor physical inventory changed outside the prepared acquisition batch.");
  }
}

function assertCurrencyUnchanged(initial: EconomicBaselineV1, current: EconomicBaselineV1): void {
  if (initial.currencyCopper !== current.currencyCopper) {
    throw new Error("Actor currency changed before absolute acquisition convergence.");
  }
}

function buildRetryExpectation(
  plan: PreparedAcquisitionIdentityPlanV1,
  expectedCurrencyCopper: number,
  classGrantPlan: PreparedClassGrantPlanV1,
  persistedRecoveryManifest: CompletedAcquisitionManifestV1 | null,
  persistedCurrencyConvergenceWitness: AcquisitionCurrencyConvergenceWitnessV1 | null
): EconomicRetryExpectation {
  const currencyOnlyConvergenceEvidence =
    plan.disposition.kind !== "retain-all"
      ? null
      : persistedRecoveryManifest
        ? {
            kind: "completed-manifest" as const,
            manifestId: persistedRecoveryManifest.id,
            manifestFingerprint: persistedRecoveryManifest.fingerprint,
          }
        : persistedCurrencyConvergenceWitness
          ? {
              kind: "acquisition-currency-witness" as const,
              witness: persistedCurrencyConvergenceWitness,
            }
          : null;
  return {
    draftId: plan.subject.draftId,
    batchId: plan.subject.batchId,
    manifestId: plan.subject.manifestId,
    expectedCurrencyCopper,
    expectedEntries: plan.entries
      .filter((entry) => entryMaterializer(entry, classGrantPlan) !== "pf2e-native")
      .map((entry) => {
        const planned = entry.plannedItems[0]!;
        return {
          entryId: entry.entryId,
          plannedItemId: planned.plannedItemId,
          plannedContainerId: planned.plannedContainerId,
          lineId: entry.lineIds[0]!,
          sourceUuid: planned.sourceUuid,
          quantity: planned.quantity,
          containerId: planned.plannedContainerId,
          stackingIntent: entry.stackingIntent,
        };
      }),
    currencyOnlyConvergenceEvidence,
  };
}

function createCurrencyConvergenceWitness(
  execution: PreparedExecution,
  observed: EconomicBaselineV1
): AcquisitionCurrencyConvergenceWitnessV1 {
  const reviewedBaseline = execution.draft.baseline;
  if (
    !reviewedBaseline ||
    !Number.isSafeInteger(reviewedBaseline.currencyCopper) ||
    reviewedBaseline.currencyCopper < 0
  ) {
    throw new TypeError("Currency convergence evidence requires the reviewed starting wealth baseline.");
  }
  return createAcquisitionCurrencyConvergenceWitness({
    actorId: execution.actorId,
    draftId: execution.identityPlan.subject.draftId,
    batchId: execution.identityPlan.subject.batchId,
    manifestId: execution.identityPlan.subject.manifestId,
    ledgerDigest: execution.identityPlan.ledgerDigest,
    baselineFingerprint: reviewedBaseline.fingerprint,
    preCopper: reviewedBaseline.currencyCopper,
    targetCopper: execution.targetCopper,
    observedCopper: observed.currencyCopper,
    verifiedAt: observed.capturedAt,
  });
}

function resolvePersistedCurrencyConvergenceWitness(args: {
  readonly draft: DraftState;
  readonly actorId: string;
  readonly acquisition: AcquisitionDraftState;
  readonly identityPlan: PreparedAcquisitionIdentityPlanV1;
  readonly targetCopper: number;
}): AcquisitionCurrencyConvergenceWitnessV1 | null {
  const witness = args.acquisition.currencyConvergenceWitness ?? null;
  if (!witness) return null;
  const preCopper = args.acquisition.baseline?.currencyCopper;
  if (
    !Number.isSafeInteger(preCopper) ||
    !hasApplyRecoveryLock(args.draft) ||
    !acquisitionCurrencyConvergenceWitnessMatches(witness, {
      actorId: args.actorId,
      draftId: args.acquisition.draftId,
      batchId: args.acquisition.batchId,
      manifestId: args.acquisition.manifestId,
      ledgerDigest: args.identityPlan.ledgerDigest,
      baselineFingerprint: args.acquisition.baseline!.fingerprint,
      preCopper: preCopper as number,
      targetCopper: args.targetCopper,
    })
  ) {
    throw new Error("Persisted currency convergence evidence differs from the prepared acquisition.");
  }
  return witness;
}

function assertWitnessedCurrencyUnchanged(
  witness: AcquisitionCurrencyConvergenceWitnessV1 | null,
  baseline: EconomicBaselineV1
): void {
  if (witness && baseline.currencyCopper !== witness.observedCopper) {
    throw new Error("Actor currency changed after the persisted acquisition convergence evidence was recorded.");
  }
}

function assertSupportedIdentityShape(plan: PreparedAcquisitionIdentityPlanV1): void {
  for (const entry of plan.entries) {
    if (
      entry.plannedItems.length !== 1 ||
      entry.lineIds.length === 0 ||
      entry.plannedItems[0]!.ownedContainerId !== null ||
      entry.plannedItems[0]!.plannedContainerId !== null
    ) {
      throw new Error("Starting equipment currently supports one non-container root item per prepared entry.");
    }
  }
}

function economicHistory(
  history: AcquisitionHistoryState,
  recoveringFinalization: boolean,
  exactPersistedManifestRecovery: boolean
): EconomicHistoryFacts {
  return {
    previousCharacterAppliedAt: recoveringFinalization ? null : history.lastAppliedAt,
    previousTargetLevel: recoveringFinalization ? null : history.lastTargetLevel,
    completedAcquisitionManifestId: exactPersistedManifestRecovery
      ? null
      : (history.completedAcquisitionManifest?.id ?? null),
    completedAcquisitionManifestCorrupt: history.completedAcquisitionManifestCorrupt,
  };
}

function resolvePersistedRecoveryManifest(args: {
  readonly history: AcquisitionHistoryState;
  readonly recoveryFinalization: boolean;
  readonly actorId: string;
  readonly acquisition: AcquisitionDraftState;
  readonly identityPlan: PreparedAcquisitionIdentityPlanV1;
}): CompletedAcquisitionManifestV1 | null {
  if (!args.recoveryFinalization) return null;
  if (args.history.completedAcquisitionManifestCorrupt) {
    throw new Error("Starting-equipment recovery found corrupt completed acquisition evidence.");
  }
  if (!args.history.completedAcquisitionManifest) return null;
  const manifest = normalizeCompletedAcquisitionManifest(args.history.completedAcquisitionManifest);
  if (!manifest) throw new Error("Starting-equipment recovery found malformed completed acquisition evidence.");
  if (
    manifest.actorId !== args.actorId ||
    manifest.draftId !== args.acquisition.draftId ||
    manifest.batchId !== args.acquisition.batchId ||
    manifest.id !== args.acquisition.manifestId
  ) {
    throw new Error("Completed acquisition evidence belongs to another actor, draft, batch, or manifest.");
  }
  assertCompletedAcquisitionManifestMatchesIdentityPlan(manifest, args.identityPlan);
  return manifest;
}

function hasApplyRecoveryLock(draft: DraftState): boolean {
  return (
    draft.applyAttemptStepIds.length > 0 ||
    draft.applyCompletedStepIds.length > 0 ||
    Object.keys(draft.applyRecoveryActorUpdate).length > 0
  );
}

function captureBaseline(actor: unknown, now: () => string): EconomicBaselineV1 {
  return captureActorEconomicBaseline(actor as EconomicActorLike, { capturedAt: now() });
}

function actorIdentifier(actor: unknown): string {
  const id = isRecord(actor) ? actor.id : null;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new TypeError("Starting-equipment execution requires an actor ID.");
  }
  return id;
}

function actorInventory(actor: unknown): Record<string, unknown> {
  if (!isRecord(actor) || !isRecord(actor.inventory)) {
    throw new Error("PF2E actor inventory is unavailable.");
  }
  return actor.inventory;
}

async function callCurrencyMethod(
  actor: unknown,
  methodName: "addCurrency" | "removeCurrency",
  copper: number
): Promise<unknown> {
  if (!Number.isSafeInteger(copper) || copper <= 0) throw new RangeError("Currency convergence requires copper.");
  const inventory = actorInventory(actor);
  const method = inventory[methodName];
  if (typeof method !== "function") {
    throw new Error(`PF2E actor inventory ${methodName} is unavailable.`);
  }
  return Reflect.apply(method, inventory, [{ cp: copper }]);
}

function safeCopperAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("Starting-equipment absolute currency target is unsafe.");
  }
  return total;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Acquisition comparison cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    if (Object.values(value).some((entry) => entry === undefined)) {
      throw new TypeError("Acquisition comparison cannot contain undefined values.");
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Acquisition comparison contains unsupported data.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
