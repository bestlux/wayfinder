import { describe, expect, it, vi } from "vitest";
import {
  applyDraftToActor as applyDraftToActorWithAuthority,
  type DraftApplyCheckpointHook,
  type DraftApplyPhase,
  DraftApplyPhaseError,
  finalizeRecoveredDraftOnActor as finalizeRecoveredDraftOnActorWithAuthority,
} from "../src/actor-updater";
import {
  type DraftApplyWriteCheckpointEmitter,
  executePreparedDraftApplication,
  prepareDraftApplication as prepareDraftApplicationWithAuthority,
} from "../src/actor-updater/prepared-draft-application";
import { DRAFT_FLAG, MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { ActorItemLike, EmbeddedItemSource } from "../src/shared/actor-model";
import { enqueueActorOperation } from "../src/shared/actor-operation-queue";
import type { PendingStep, SpellChoiceStep } from "../src/types";
import {
  capturePersistedDraftPrecondition,
  evaluatePersistedDraftWriteGuardHook,
  PersistedDraftWriteGuard,
  updateActorWithPersistedDraftPrecondition,
  WayfinderDraftWriteConflictError,
} from "../src/wayfinder/application/draft-write-guard";
import { createAcquisitionCurrencyConvergenceWitness } from "../src/wayfinder/domain/acquisition-currency-convergence";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { WayfinderDraftNotReadyError } from "../src/wayfinder/domain/step-evaluation";
import { createLanguageChoiceStep } from "../src/wayfinder/domain/step-types";
import { buildActorHarness, classSelectionStep, selection, setGamePacks } from "./support/actor-updater-fixtures";

const TEST_ACTOR_AUTHORITY = () => true;
const TEST_ACQUISITION_AUTHORITY = () => undefined;
const TEST_SELECTION_ELIGIBILITY = () => true;
const TEST_CURRENCY_WITNESS_PERSISTENCE = async () => undefined;

function prepareDraftApplication(
  actor: Parameters<typeof prepareDraftApplicationWithAuthority>[0],
  draft: Parameters<typeof prepareDraftApplicationWithAuthority>[1],
  steps: Parameters<typeof prepareDraftApplicationWithAuthority>[2],
  options: Parameters<typeof prepareDraftApplicationWithAuthority>[3] = {}
) {
  return prepareDraftApplicationWithAuthority(actor, draft, steps, {
    validateActorAuthority: TEST_ACTOR_AUTHORITY,
    assertAcquisitionApplyAuthority: TEST_ACQUISITION_AUTHORITY,
    ...options,
  });
}

function applyDraftToActor(
  actor: Parameters<typeof applyDraftToActorWithAuthority>[0],
  draft: Parameters<typeof applyDraftToActorWithAuthority>[1],
  steps: Parameters<typeof applyDraftToActorWithAuthority>[2],
  options: Partial<Parameters<typeof applyDraftToActorWithAuthority>[3]> = {}
) {
  return applyDraftToActorWithAuthority(actor, draft, steps, {
    validateActorAuthority: TEST_ACTOR_AUTHORITY,
    assertAcquisitionApplyAuthority: TEST_ACQUISITION_AUTHORITY,
    spellRarityCeiling: "common",
    validateSelectionEligibility: TEST_SELECTION_ELIGIBILITY,
    ...options,
  });
}

function finalizeRecoveredDraftOnActor(
  actor: Parameters<typeof finalizeRecoveredDraftOnActorWithAuthority>[0],
  options: Omit<
    Parameters<typeof finalizeRecoveredDraftOnActorWithAuthority>[1],
    "validateActorAuthority" | "classGrantRecovery"
  >
) {
  return finalizeRecoveredDraftOnActorWithAuthority(actor, {
    validateActorAuthority: TEST_ACTOR_AUTHORITY,
    assertAcquisitionApplyAuthority: TEST_ACQUISITION_AUTHORITY,
    classGrantRecovery: { kind: "none" },
    ...options,
  });
}

const PHASE_IDS: DraftApplyPhase[] = [
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
  "class-grant-reconcile-before-acquisition",
  "acquisition-items",
  "class-grant-reconcile-after-acquisition",
  "class-grant-reconcile-final",
  "acquisition-currency",
  "verify-outcome",
  "finalize-actor",
];

describe("prepared draft application", () => {
  it("reconciles an authoritative class grant before, after, and at final verification", async () => {
    const u = CLASS_GRANT_PROFILE_UUIDS;
    const { actor } = buildActorHarness({
      items: [
        {
          id: "book",
          type: "equipment",
          sourceId: u.formulaBookItem,
          system: { quantity: 1 },
          flags: { pf2e: { grantedBy: { id: "formula" } } },
        },
        {
          id: "formula",
          type: "feat",
          sourceId: u.formulaBookFeature,
          system: { quantity: 1 },
          flags: { pf2e: { grantedBy: { id: "alchemy" } } },
        },
        {
          id: "alchemy",
          type: "feat",
          sourceId: u.alchemyFeature,
          system: { quantity: 1, location: "class" },
          flags: {},
        },
        {
          id: "class",
          type: "class",
          sourceId: u.alchemistClass,
          system: { quantity: 1 },
          flags: { [MODULE_ID]: { slotId: "class-level-1" } },
        },
      ],
    });
    Object.assign(actor, { id: "actor-1" });
    const grant = createPlannedClassGrant({
      grantId: "class-grant:alchemist-formula-book:class-level-1",
      profileId: "alchemist-formula-book",
      origin: { sourceSlotId: "class-level-1", sourceUuid: u.alchemistClass },
      granterSourceUuid: u.formulaBookFeature,
      expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [u.formulaBookFeature, u.alchemyFeature, u.alchemistClass],
    });
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [grant],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });

    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });
    const acquisitionEvidence = { kind: "completed", manifest: { id: "manifest-1" } } as never;
    let resolvedFinalEvidence: unknown = null;
    const resolveFinalActorUpdate = vi.fn((evidence: unknown) => {
      resolvedFinalEvidence = evidence;
      return {};
    });
    const result = await executePreparedDraftApplication(prepared, {
      persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
      readCurrentAcquisitionHistory: () => ({
        completedAcquisitionManifest: null,
        completedAcquisitionManifestCorrupt: false,
      }),
      executeAcquisitionItems: () => undefined,
      executeAcquisitionCurrency: () => undefined,
      verifyAcquisitionOutcome: () => acquisitionEvidence,
      resolveFinalActorUpdate,
    });

    expect(result.classGrantReconciliations.map((entry) => entry.phase)).toEqual([
      "before-acquisition",
      "after-acquisition",
      "final",
    ]);
    expect(result.classGrantReconciliations.every((entry) => entry.entries[0]?.status === "resolved")).toBe(true);
    expect(resolveFinalActorUpdate).toHaveBeenCalledWith({
      classGrantReconciliations: expect.any(Array),
      acquisition: acquisitionEvidence,
    });
    expect((resolvedFinalEvidence as { acquisition?: unknown }).acquisition).toBe(acquisitionEvidence);

    const secondBatchExecutor = vi.fn();
    await expect(
      executePreparedDraftApplication(prepared, {
        persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
        readCurrentAcquisitionHistory: () => ({
          completedAcquisitionManifest: { id: "prior-manifest" } as never,
          completedAcquisitionManifestCorrupt: false,
        }),
        executeAcquisitionItems: secondBatchExecutor,
        executeAcquisitionCurrency: () => undefined,
        verifyAcquisitionOutcome: () => acquisitionEvidence,
      })
    ).rejects.toThrow(/prior or malformed acquisition history/i);
    expect(secondBatchExecutor).not.toHaveBeenCalled();
  });

  it("materializes a Wayfinder class grant between before and after reconciliation", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const grant = titanGrant();
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [grant],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });

    const result = await executePreparedDraftApplication(prepared, {
      persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
      readCurrentAcquisitionHistory: () => ({
        completedAcquisitionManifest: null,
        completedAcquisitionManifestCorrupt: false,
      }),
      executeAcquisitionItems: () => {
        actor.items.contents.push({
          id: "titan-weapon",
          type: "weapon",
          sourceId: grant.expected.sourceUuid,
          system: { quantity: 1 },
          flags: {
            [MODULE_ID]: {
              acquisition: {
                version: 1,
                draftId: "draft-1",
                batchId: "batch-1",
                manifestId: "manifest-1",
                lineId: "line-titan",
                entryId: "entry-titan",
                plannedItemId: "planned-item-titan",
                plannedContainerId: null,
                plannedGrantId: grant.grantId,
                stackingIntent: "separate",
              },
            },
          },
        });
      },
      executeAcquisitionCurrency: () => undefined,
      verifyAcquisitionOutcome: () => ({ kind: "completed" }) as never,
    });

    expect(result.classGrantReconciliations.map((entry) => entry.entries[0]?.status)).toEqual([
      "pending",
      "resolved",
      "resolved",
    ]);
  });

  it.each([
    ["acquisition-items", "embedded-item-create", 2],
    ["acquisition-currency", "currency-convergence", 3],
  ] as const)("retains the %s operation checkpoint when the adapter throws after its before boundary", async (failedPhase, operation, ordinal) => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [],
    });
    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });
    const executeAcquisitionItems = async ({
      emitWriteCheckpoint,
    }: {
      emitWriteCheckpoint: DraftApplyWriteCheckpointEmitter;
    }) => {
      if (failedPhase !== "acquisition-items") return;
      await emitWriteCheckpoint("embedded-item-create", "before", ordinal);
      throw new Error("item adapter failed");
    };
    const executeAcquisitionCurrency = async ({
      emitWriteCheckpoint,
    }: {
      emitWriteCheckpoint: DraftApplyWriteCheckpointEmitter;
    }) => {
      if (failedPhase !== "acquisition-currency") return;
      await emitWriteCheckpoint("currency-convergence", "before", ordinal);
      throw new Error("currency adapter failed");
    };

    await expect(
      executePreparedDraftApplication(prepared, {
        persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
        readCurrentAcquisitionHistory: () => ({
          completedAcquisitionManifest: null,
          completedAcquisitionManifestCorrupt: false,
        }),
        executeAcquisitionItems,
        executeAcquisitionCurrency,
        verifyAcquisitionOutcome: () => ({ kind: "completed" }) as never,
      })
    ).rejects.toMatchObject({
      phase: failedPhase,
      failureKind: "operation",
      checkpoint: {
        checkpointId: `write:${operation}:before`,
        kind: "write",
        operation,
        boundary: "before",
        ordinal,
      },
    });
  });

  it("carries verified currency convergence through a failure at the after boundary", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [],
    });
    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });
    const witness = createAcquisitionCurrencyConvergenceWitness({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      ledgerDigest: "ledger-digest",
      baselineFingerprint: "baseline-fingerprint",
      preCopper: 0,
      targetCopper: 1500,
      observedCopper: 1500,
      verifiedAt: "2026-08-19T12:00:00.000Z",
    });
    let durablyRecordedWitness = null as typeof witness | null;

    await expect(
      executePreparedDraftApplication(prepared, {
        persistAcquisitionCurrencyConvergenceWitness: async (value) => {
          await Promise.resolve();
          durablyRecordedWitness = value;
        },
        readCurrentAcquisitionHistory: () => ({
          completedAcquisitionManifest: null,
          completedAcquisitionManifestCorrupt: false,
        }),
        executeAcquisitionItems: () => undefined,
        executeAcquisitionCurrency: async ({ emitWriteCheckpoint, persistCurrencyConvergenceWitness }) => {
          await emitWriteCheckpoint("currency-convergence", "before", 1);
          await persistCurrencyConvergenceWitness(witness);
          await emitWriteCheckpoint("currency-convergence", "after", 1);
        },
        verifyAcquisitionOutcome: () => ({ kind: "completed" }) as never,
        onCheckpoint: (checkpoint) => {
          if (checkpoint.checkpointId === "write:currency-convergence:after") {
            expect(durablyRecordedWitness).toEqual(witness);
            throw new Error("injected currency-after failure");
          }
        },
      })
    ).rejects.toMatchObject({
      phase: "acquisition-currency",
      failureKind: "checkpoint-hook",
      checkpoint: { checkpointId: "write:currency-convergence:after" },
      acquisitionCurrencyConvergenceWitness: witness,
    });
  });

  it("clears an acquisition operation checkpoint after its matching after boundary", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [],
    });
    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });

    await expect(
      executePreparedDraftApplication(prepared, {
        persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
        readCurrentAcquisitionHistory: () => ({
          completedAcquisitionManifest: null,
          completedAcquisitionManifestCorrupt: false,
        }),
        executeAcquisitionItems: async ({ emitWriteCheckpoint }) => {
          await emitWriteCheckpoint("embedded-item-create", "before", 4);
          await emitWriteCheckpoint("embedded-item-create", "after", 4);
          throw new Error("post-operation failure");
        },
        executeAcquisitionCurrency: () => undefined,
        verifyAcquisitionOutcome: () => ({ kind: "completed" }) as never,
      })
    ).rejects.toMatchObject({
      phase: "acquisition-items",
      failureKind: "operation",
      checkpoint: null,
    });
  });

  it("fails closed when an acquisition draft has no prepared item executor", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [],
    });
    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });

    await expect(
      executePreparedDraftApplication(prepared, {
        persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
        readCurrentAcquisitionHistory: () => ({
          completedAcquisitionManifest: null,
          completedAcquisitionManifestCorrupt: false,
        }),
      })
    ).rejects.toMatchObject({ phase: "acquisition-items" });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects a production-shaped acquisition Apply before any actor phase when its executor is absent", () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };

    expect(() => applyDraftToActor(actor as never, draft, [classSelectionStep()])).toThrow(
      /prepared acquisition execution and verification/i
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects acquisition authority before queueing or mutating the actor", () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };

    expect(() =>
      applyDraftToActor(actor as never, draft, [classSelectionStep()], {
        assertAcquisitionApplyAuthority: () => {
          throw new Error("GM review is required");
        },
      })
    ).toThrow(/GM review is required/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rechecks physical-grant coverage before any prepared acquisition callback or actor write", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const prepareClassGrantPlan = vi.fn(async () => {
      throw new Error("Unsupported physical grant route: clan-pistol");
    });
    const executeAcquisitionItems = vi.fn(async () => undefined);
    const executeAcquisitionCurrency = vi.fn(async () => undefined);
    const verifyAcquisitionOutcome = vi.fn(async () => ({ kind: "none" }) as never);
    const readCurrentAcquisitionHistory = vi.fn(async () => ({
      completedAcquisitionManifest: null,
      completedAcquisitionManifestCorrupt: false,
    }));
    const onCheckpoint = vi.fn();

    await expect(
      applyDraftToActor(actor as never, draft, [], {
        prepareClassGrantPlan,
        executeAcquisitionItems,
        executeAcquisitionCurrency,
        persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
        verifyAcquisitionOutcome,
        readCurrentAcquisitionHistory,
        onCheckpoint,
      })
    ).rejects.toThrow("Unsupported physical grant route: clan-pistol");

    expect(prepareClassGrantPlan).toHaveBeenCalledTimes(1);
    expect(executeAcquisitionItems).not.toHaveBeenCalled();
    expect(executeAcquisitionCurrency).not.toHaveBeenCalled();
    expect(verifyAcquisitionOutcome).not.toHaveBeenCalled();
    expect(readCurrentAcquisitionHistory).not.toHaveBeenCalled();
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("blocks finalization when prepared class equipment is never materialized", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    const grant = titanGrant();
    const draft = createEmptyDraft(1);
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [grant],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const prepared = await prepareDraftApplication(actor, draft, [], { prepareClassGrantPlan: () => plan });

    await expect(
      executePreparedDraftApplication(prepared, {
        persistAcquisitionCurrencyConvergenceWitness: TEST_CURRENCY_WITNESS_PERSISTENCE,
        readCurrentAcquisitionHistory: () => ({
          completedAcquisitionManifest: null,
          completedAcquisitionManifestCorrupt: false,
        }),
        executeAcquisitionItems: () => undefined,
      })
    ).rejects.toMatchObject({ phase: "class-grant-reconcile-final" });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("resolves selected sources before the first actor mutation", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({ "pf2e.classes": {} });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection(
      "class-level-1",
      "pf2e.classes",
      "missing-class",
      "class",
      "Missing Class"
    );

    await expect(prepareDraftApplication(actor as never, draft, [classSelectionStep()])).rejects.toThrow(
      "source document Compendium.pf2e.classes.Item.missing-class could not be resolved"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects an ineligible selected option before the first actor mutation", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");

    await expect(
      prepareDraftApplication(actor as never, draft, [classSelectionStep()], {
        validateSelectionEligibility: () => false,
      })
    ).rejects.toThrow("Wizard is no longer eligible");
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects a stale scalar choice before resolving or mutating actor documents", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "removed-doctrine";
    const step = {
      id: "class-archetype-doctrine-level-1",
      level: 1,
      kind: "class-archetype",
      slotKind: "class-archetype",
      title: "Cleric doctrine",
      description: "",
      required: true,
      slotId: "class-archetype-doctrine-level-1",
      classArchetype: {
        slotId: "class-archetype-doctrine-level-1",
        standardValue: "standard",
        sourceName: "Doctrine",
        options: [{ value: "standard", label: "Standard", img: null, detail: null }],
        selector: {
          slotId: "class-archetype-doctrine-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "doctrine",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.doctrine",
          selectorName: "Doctrine",
          selectorRuleIndex: 0,
          flag: "doctrine",
          optionTag: "doctrine",
          classSlug: "cleric",
          dependsOn: "class",
        },
      },
    } satisfies PendingStep;

    await expect(prepareDraftApplication(actor as never, draft, [step])).rejects.toThrow(
      "Cleric doctrine changed after this draft was prepared"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects invalid active skill increases and ignores inactive stale entries", async () => {
    const invalidHarness = buildActorHarness();
    const invalidDraft = createEmptyDraft(3);
    invalidDraft.skillIncreases["skill-increase-level-3"] = "not-a-pf2e-skill";
    await expect(
      prepareDraftApplication(invalidHarness.actor as never, invalidDraft, [skillIncreaseStep(3)])
    ).rejects.toThrow("Skill increase 3 changed after this draft was prepared");
    expect(invalidHarness.actor.update).not.toHaveBeenCalled();

    const inactiveHarness = buildActorHarness();
    await applyDraftToActor(inactiveHarness.actor as never, invalidDraft, []);
    expect(inactiveHarness.actor.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ "system.skills.not-a-pf2e-skill.rank": expect.anything() })
    );

    const cappedHarness = buildActorHarness();
    cappedHarness.actor.system = { ...cappedHarness.actor.system, skills: { arcana: { rank: 2 } } };
    const cappedDraft = createEmptyDraft(3);
    cappedDraft.skillIncreases["skill-increase-level-3"] = "arcana";
    await expect(
      prepareDraftApplication(cappedHarness.actor as never, cappedDraft, [skillIncreaseStep(3)])
    ).rejects.toThrow("Skill increase 3 changed after this draft was prepared");
    expect(cappedHarness.actor.update).not.toHaveBeenCalled();

    const configuredHarness = buildActorHarness();
    const configuredDraft = createEmptyDraft(3);
    configuredDraft.skillIncreases["skill-increase-level-3"] = "warfare-lore";
    await expect(
      prepareDraftApplication(configuredHarness.actor as never, configuredDraft, [skillIncreaseStep(3)], {
        validSkillSlugs: new Set(["warfare-lore"]),
      })
    ).resolves.toBeDefined();
  });

  it.each([
    { label: "preferred skill is available", ranks: { occultism: 0, arcana: 0 } },
    { label: "fallback skill is already trained", ranks: { occultism: 1, arcana: 1 } },
  ])("rejects a stale dedication fallback when the $label", async ({ ranks }) => {
    const { actor } = buildActorHarness();
    actor.system = {
      ...actor.system,
      skills: { occultism: { rank: ranks.occultism }, arcana: { rank: ranks.arcana } },
    };
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: { "feat:necromancer-dedication:dedication-skill-1": "arcana" },
      additional: ["athletics"],
      loreChoices: {},
    };

    await expect(prepareDraftApplication(actor as never, draft, [necromancerTrainingStep()])).rejects.toThrow(
      "Fighter skill training changed after this draft was prepared"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("accepts an exact skill choice that the same locked recovery draft already applied", async () => {
    const { actor } = buildActorHarness();
    actor.system = {
      ...actor.system,
      skills: { occultism: { rank: 1 }, arcana: { rank: 1 } },
    };
    const draft = createEmptyDraft(1);
    draft.applyAttemptStepIds = ["skill-training-fighter-level-1"];
    draft.skillTrainings["skill-training-fighter-level-1"] = {
      ruleChoices: { "feat:necromancer-dedication:dedication-skill-1": "arcana" },
      additional: ["athletics"],
      loreChoices: {},
    };

    await expect(prepareDraftApplication(actor as never, draft, [necromancerTrainingStep()])).resolves.toBeDefined();
  });

  it("prepares but does not expect a flag-choice value to become an actor item", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.feats-srd": {
        "multifarious-muse": {
          name: "Multifarious Muse",
          type: "feat",
          system: {
            rules: [{ key: "ChoiceSet", flag: "muse", choices: [{ value: "enigma", label: "Enigma" }] }],
          },
        },
      },
      "pf2e.classfeatures": {
        enigma: { name: "Enigma", type: "feat", system: { category: "classfeature" } },
      },
    });
    const draft = createEmptyDraft(2);
    const slotId = "flag-choice-none-feat-multifarious-muse-muse-level-2";
    draft.selections[slotId] = selection(slotId, "pf2e.classfeatures", "enigma", "feat", "Enigma");
    const step = flagChoiceStep();

    const prepared = await prepareDraftApplication(actor as never, draft, [step]);

    expect(prepared.sources.expectedSelections.map((entry) => entry.uuid)).not.toContain(
      "Compendium.pf2e.classfeatures.Item.enigma"
    );
    expect(prepared.sources.expectedSelections.map((entry) => entry.uuid)).toContain(
      "Compendium.pf2e.feats-srd.Item.multifarious-muse"
    );
  });

  it("rejects spell over-selection before resolving or mutating documents", async () => {
    const { actor } = buildActorHarness();
    const fetchSelectionDocument = vi.fn();
    const draft = createEmptyDraft(1);
    const step = spellChoiceStep(1);
    draft.spellChoices[step.slotId] = [
      selection(step.slotId, "pf2e.spells-srd", "detect-magic", "spell", "Detect Magic"),
      selection(step.slotId, "pf2e.spells-srd", "guidance", "spell", "Guidance"),
    ];

    await expect(
      prepareDraftApplication(actor as never, draft, [step], { fetchSelectionDocument })
    ).rejects.toMatchObject({
      name: "WayfinderDraftNotReadyError",
      blockers: [expect.objectContaining({ code: "too-many-choices", stepId: step.id })],
    });
    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects a missing scalar choice before resolving or mutating documents", async () => {
    const { actor } = buildActorHarness();
    const fetchSelectionDocument = vi.fn();

    await expect(
      prepareDraftApplication(actor as never, createEmptyDraft(1), [classSelectionStep()], {
        fetchSelectionDocument,
      })
    ).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);

    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects an underfilled language choice before resolving or mutating documents", async () => {
    const { actor } = buildActorHarness();
    const fetchSelectionDocument = vi.fn();
    const step = languageChoiceStep();
    const draft = createEmptyDraft(1);
    draft.languageChoices[step.slotId] = ["draconic"];

    await expect(
      prepareDraftApplication(actor as never, draft, [step], { fetchSelectionDocument })
    ).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: "missing-choice", stepId: step.id })],
    });

    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("accepts a reuse-only spell step when an earlier selected step prepares the destination", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.spells-srd": {
        guidance: { name: "Guidance", type: "spell", system: { level: { value: 0 } } },
        fear: { name: "Fear", type: "spell", system: { level: { value: 1 } } },
      },
    });
    const draft = createEmptyDraft(2);
    const initialStep = spellChoiceStep(1);
    const laterStep = {
      ...spellChoiceStep(1),
      id: "spell-choice-witch-familiar-level-2",
      level: 2,
      slotId: "spell-choice-witch-familiar-level-2",
      title: "Level 2 witch familiar spells",
      spellChoice: {
        ...spellChoiceStep(1).spellChoice,
        slotId: "spell-choice-witch-familiar-level-2",
        reuseExistingEntryOnly: true,
      },
    } satisfies PendingStep;
    draft.spellChoices[initialStep.slotId] = [
      selection(initialStep.slotId, "pf2e.spells-srd", "guidance", "spell", "Guidance"),
    ];
    draft.spellChoices[laterStep.slotId] = [selection(laterStep.slotId, "pf2e.spells-srd", "fear", "spell", "Fear")];

    await expect(prepareDraftApplication(actor as never, draft, [initialStep, laterStep])).resolves.toBeDefined();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("executes from retained prepared sources after the live pack changes", async () => {
    const { actor, createdItems } = buildActorHarness();
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    const prepared = await prepareDraftApplication(actor as never, draft, [classSelectionStep()]);
    setGamePacks({ "pf2e.classes": {} });

    await executePreparedDraftApplication(prepared);

    expect(createdItems).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Wizard", type: "class" })]));
  });

  it("does not finalize when PF2E vetoes an expected feat creation", async () => {
    const { actor } = buildActorHarness();
    actor.feats = {
      get: () => ({ slots: { "class-2": { id: "class-2", level: 2, feat: null } } }),
    };
    actor.createEmbeddedDocuments.mockResolvedValue([]);
    setGamePacks({
      "pf2e.feats-srd": {
        intimidating: { name: "Intimidating Strike", type: "feat", system: { category: "class", level: { value: 2 } } },
      },
    });
    const draft = createEmptyDraft(2);
    draft.selections["class-feat-level-2"] = selection(
      "class-feat-level-2",
      "pf2e.feats-srd",
      "intimidating",
      "feat",
      "Intimidating Strike",
      "class",
      2
    );
    const step: PendingStep = {
      id: "class-feat-level-2",
      level: 2,
      kind: "pick-item",
      slotKind: "class-feat",
      title: "Class feat",
      description: "",
      required: true,
      slotId: "class-feat-level-2",
      filters: { itemType: "feat", featTypes: ["class"] },
    };

    await expect(applyDraftToActor(actor as never, draft, [step])).rejects.toMatchObject({
      phase: "verify-outcome",
    });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("does not finalize when PF2E cannot create a selected spell destination", async () => {
    const { actor } = buildActorHarness();
    actor.createEmbeddedDocuments.mockResolvedValue([]);
    setGamePacks({
      "pf2e.spells-srd": {
        "detect-magic": { name: "Detect Magic", type: "spell", system: { level: { value: 0 } } },
      },
    });
    const draft = createEmptyDraft(1);
    const step = spellChoiceStep(1);
    draft.spellChoices[step.slotId] = [
      selection(step.slotId, "pf2e.spells-srd", "detect-magic", "spell", "Detect Magic"),
    ];

    await expect(applyDraftToActor(actor as never, draft, [step])).rejects.toMatchObject({
      phase: "verify-outcome",
    });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("exposes named phases and identifies the failed boundary", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    const prepared = await prepareDraftApplication(actor as never, draft, []);
    const observed: string[] = [];

    await expect(
      executePreparedDraftApplication(prepared, {
        onCheckpoint: atPhaseStart((phase) => {
          observed.push(phase);
          if (phase === "class-branches") throw new Error("injected failure");
        }),
      })
    ).rejects.toMatchObject({
      name: "DraftApplyPhaseError",
      phase: "class-branches",
      completedPhases: [
        "singleton-replacements",
        "singleton-system-grants",
        "singleton-explicit-grants",
        "singleton-choice-persistence-early",
        "skill-training-items",
        "class-archetype",
      ],
    });
    expect(observed.at(-1)).toBe("class-branches");
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("emits stable phase and final actor write checkpoints in execution order", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    const checkpointIds: string[] = [];

    await executePreparedDraftApplication(prepared, {
      finalActorUpdate: { "flags.test.applied": true },
      onCheckpoint: (checkpoint) => {
        checkpointIds.push(checkpoint.checkpointId);
      },
    });

    expect(checkpointIds.slice(0, 2)).toEqual([
      "phase:singleton-replacements:before",
      "phase:singleton-replacements:after",
    ]);
    expect(checkpointIds.slice(-4)).toEqual([
      "phase:finalize-actor:before",
      "write:final-actor-update:before",
      "write:final-actor-update:after",
      "phase:finalize-actor:after",
    ]);
  });

  it("preserves a final-boundary draft conflict as the phase-error cause without writing", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    const conflict = new WayfinderDraftWriteConflictError();

    await expect(
      executePreparedDraftApplication(prepared, {
        beforeFinalActorUpdate: () => {
          throw conflict;
        },
        resolveFinalActorUpdate: () => ({ "flags.test.applied": true }),
      })
    ).rejects.toMatchObject({
      phase: "finalize-actor",
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      cause: conflict,
      partialReceipt: { actorUpdatePaths: [] },
    });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rechecks selected spell eligibility immediately before the spell mutation phase", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.spells-srd": {
        "detect-magic": { name: "Detect Magic", type: "spell", system: { level: { value: 0 } } },
      },
    });
    const draft = createEmptyDraft(1);
    const step = spellChoiceStep(1);
    draft.spellChoices[step.slotId] = [
      selection(step.slotId, "pf2e.spells-srd", "detect-magic", "spell", "Detect Magic"),
    ];
    let eligible = true;
    const validateSelectionEligibility = vi.fn(() => eligible);
    const prepared = await prepareDraftApplication(actor as never, draft, [step], {
      validateSelectionEligibility,
    });
    expect(validateSelectionEligibility).toHaveBeenCalledTimes(1);

    await expect(
      executePreparedDraftApplication(prepared, {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.checkpointId === "phase:spell-choices:before") {
            eligible = false;
          }
        },
      })
    ).rejects.toMatchObject({
      phase: "spell-choices",
      failureKind: "operation",
      checkpoint: null,
    });
    expect(validateSelectionEligibility).toHaveBeenCalledTimes(2);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it.each([
    "before",
    "after",
  ] as const)("attaches the exact final actor write %s checkpoint to injected failures", async (boundary) => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    let failure: DraftApplyPhaseError | null = null;

    try {
      await executePreparedDraftApplication(prepared, {
        finalActorUpdate: { "flags.test.applied": true },
        onCheckpoint: (checkpoint) => {
          if (checkpoint.checkpointId === `write:final-actor-update:${boundary}`) {
            throw new Error("injected checkpoint failure");
          }
        },
      });
    } catch (error) {
      failure = error as DraftApplyPhaseError;
    }

    expect(failure).toMatchObject({
      phase: "finalize-actor",
      failureKind: "checkpoint-hook",
      checkpoint: {
        checkpointId: `write:final-actor-update:${boundary}`,
        kind: "write",
        operation: "final-actor-update",
        ordinal: 1,
        boundary,
      },
      partialReceipt: {
        actorUpdatePaths: boundary === "after" ? expect.arrayContaining(["flags.test.applied"]) : [],
      },
    });
    expect(actor.update).toHaveBeenCalledTimes(boundary === "after" ? 1 : 0);
  });

  it.each(PHASE_IDS)("stops at the injected %s boundary without finalizing", async (failedPhase) => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "old-class",
          type: "class",
          name: "Fighter",
          flags: { core: { sourceId: "Compendium.pf2e.classes.Item.fighter" } },
          system: {},
        },
      ],
    });
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    const prepared = await prepareDraftApplication(actor as never, draft, [classSelectionStep()]);
    const observed: DraftApplyPhase[] = [];

    let failure: DraftApplyPhaseError | null = null;
    try {
      await executePreparedDraftApplication(prepared, {
        onCheckpoint: atPhaseStart((phase) => {
          observed.push(phase);
          if (phase === failedPhase) throw new Error("injected failure");
        }),
      });
    } catch (error) {
      failure = error as DraftApplyPhaseError;
    }
    expect(failure).toMatchObject({
      phase: failedPhase,
      completedPhases: PHASE_IDS.slice(0, PHASE_IDS.indexOf(failedPhase)),
    });
    expect(observed).toEqual(PHASE_IDS.slice(0, PHASE_IDS.indexOf(failedPhase) + 1));
    expect(actor.update).not.toHaveBeenCalled();
    if (PHASE_IDS.indexOf(failedPhase) > 0) {
      expect(actor.createEmbeddedDocuments).toHaveBeenCalled();
      expect(failure?.completedReceipts[0]?.createdItemIds).not.toEqual([]);
    }
  });

  it("rechecks actor authority immediately before the first phase", async () => {
    const { actor } = buildActorHarness();
    let authorized = true;
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), [], {
      validateActorAuthority: () => authorized,
    });
    authorized = false;

    await expect(executePreparedDraftApplication(prepared)).rejects.toThrow(
      "current user can no longer modify this PF2E character"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("requires an authority validator at the actor-updater facade", () => {
    const { actor } = buildActorHarness();
    expect(() => applyDraftToActorWithAuthority(actor as never, createEmptyDraft(1), [], undefined as never)).toThrow(
      "current user can no longer modify this PF2E character"
    );
  });

  it("requires an authority validator at the prepared boundary", async () => {
    const { actor } = buildActorHarness();
    await expect(prepareDraftApplicationWithAuthority(actor as never, createEmptyDraft(1), [])).rejects.toThrow(
      "current user can no longer modify this PF2E character"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("records a completed phase receipt before emitting its after checkpoint", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);

    await expect(
      executePreparedDraftApplication(prepared, {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.checkpointId === "phase:singleton-replacements:after") {
            throw new Error("after-phase failure");
          }
        },
      })
    ).rejects.toMatchObject({
      phase: "singleton-replacements",
      failureKind: "checkpoint-hook",
      checkpoint: { checkpointId: "phase:singleton-replacements:after" },
      completedPhases: ["singleton-replacements"],
    });
  });

  it("shares the same mandatory readiness rejection for coalesced actor operations", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    const steps = [classSelectionStep()];

    const first = applyDraftToActor(actor as never, draft, steps);
    const second = applyDraftToActor(actor as never, draft, steps);

    expect(second).toBe(first);
    await expect(first).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);
    await expect(second).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("does not share concurrent applies with different operation options", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstPhase = vi.fn(async () => barrier);

    const first = applyDraftToActor(actor as never, draft, [], {
      onCheckpoint: atPhaseStart((phase) => (phase === "singleton-replacements" ? firstPhase() : undefined)),
    });
    const second = applyDraftToActor(actor as never, draft, [], {
      finalActorUpdate: { "flags.wayfinder-pf2e.state.lastAppliedAt": "different-timestamp" },
      validateSelectionEligibility: () => false,
    });

    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(firstPhase).toHaveBeenCalledTimes(1));
    release?.();
    await Promise.all([first, second]);
    expect(actor.update).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce otherwise-identical applies with distinct checkpoint hooks", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstStarted = vi.fn();
    const secondStarted = vi.fn();
    const first = applyDraftToActor(actor as never, draft, [], {
      onCheckpoint: atPhaseStart(async (phase) => {
        if (phase !== "singleton-replacements") return;
        firstStarted();
        await barrier;
      }),
    });
    const second = applyDraftToActor(actor as never, draft, [], {
      onCheckpoint: atPhaseStart((phase) => {
        if (phase === "singleton-replacements") secondStarted();
      }),
    });

    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledTimes(1));
    expect(secondStarted).not.toHaveBeenCalled();
    release?.();
    await Promise.all([first, second]);
    expect(secondStarted).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce otherwise-identical applies with distinct final persistence executors", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstPersistence = vi.fn(async (actorUpdate: Record<string, unknown>) => {
      await barrier;
      return actor.update(actorUpdate);
    });
    const secondPersistence = vi.fn((actorUpdate: Record<string, unknown>) => actor.update(actorUpdate));

    const first = applyDraftToActor(actor as never, draft, [], {
      persistFinalActorUpdate: firstPersistence,
    });
    const second = applyDraftToActor(actor as never, draft, [], {
      persistFinalActorUpdate: secondPersistence,
    });

    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(firstPersistence).toHaveBeenCalledOnce());
    expect(secondPersistence).not.toHaveBeenCalled();
    release?.();
    await Promise.all([first, second]);
    expect(secondPersistence).toHaveBeenCalledOnce();
  });

  it("serializes different drafts for the same actor", async () => {
    const { actor } = buildActorHarness();
    const firstDraft = createEmptyDraft(1);
    const secondDraft = createEmptyDraft(2);
    const order: string[] = [];
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = applyDraftToActor(actor as never, firstDraft, [], {
      onCheckpoint: atPhaseStart(async (phase) => {
        if (phase === "singleton-replacements") {
          order.push("first-start");
          await barrier;
          order.push("first-end");
        }
      }),
    });
    const second = applyDraftToActor(actor as never, secondDraft, [], {
      onCheckpoint: atPhaseStart((phase) => {
        if (phase === "singleton-replacements") order.push("second-start");
      }),
    });

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("shares the actor queue with generic draft persistence writes", async () => {
    const { actor } = buildActorHarness();
    const order: string[] = [];
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = enqueueActorOperation(actor, async () => {
      order.push("save-start");
      await barrier;
      order.push("save-end");
    });
    const apply = applyDraftToActor(actor as never, createEmptyDraft(1), [], {
      onCheckpoint: atPhaseStart((phase) => {
        if (phase === "singleton-replacements") order.push("apply-start");
      }),
    });

    await vi.waitFor(() => expect(order).toEqual(["save-start"]));
    release?.();
    await Promise.all([save, apply]);
    expect(order).toEqual(["save-start", "save-end", "apply-start"]);
  });

  it("revalidates and resolves the final update inside the actor queue after earlier writes", async () => {
    const { actor } = buildActorHarness();
    let queuedState = "before";
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const earlierWrite = enqueueActorOperation(actor, async () => {
      await barrier;
      queuedState = "after";
    });
    const beforePrepare = vi.fn(() => {
      expect(queuedState).toBe("after");
    });
    const apply = applyDraftToActor(actor as never, createEmptyDraft(1), [], {
      beforePrepare,
      resolveFinalActorUpdate: () => ({ "flags.test.queuedState": queuedState }),
    });

    release?.();
    await Promise.all([earlierWrite, apply]);

    expect(beforePrepare).toHaveBeenCalledTimes(1);
    expect(actor.update).toHaveBeenLastCalledWith(expect.objectContaining({ "flags.test.queuedState": "after" }));
  });

  it("performs no apply mutation when in-queue candidate validation fails", async () => {
    const { actor } = buildActorHarness();

    await expect(
      applyDraftToActor(actor as never, createEmptyDraft(1), [], {
        beforePrepare: () => {
          throw new Error("candidate drifted");
        },
        resolveFinalActorUpdate: () => ({ "flags.test.applied": true }),
      })
    ).rejects.toThrow("candidate drifted");

    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("uses invocation-time draft, steps, and final update for queued Apply", async () => {
    const { actor } = buildActorHarness();
    actor.system = { ...actor.system, skills: { arcana: { rank: 0 }, diplomacy: { rank: 0 } } };
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = applyDraftToActor(actor as never, createEmptyDraft(1), [], {
      onCheckpoint: atPhaseStart((phase) => (phase === "singleton-replacements" ? barrier : undefined)),
    });
    const draft = createEmptyDraft(3);
    draft.skillIncreases["skill-increase-level-3"] = "arcana";
    const steps = [skillIncreaseStep(3)];
    const finalActorUpdate = { "flags.test.snapshot": "original" };

    const queued = applyDraftToActor(actor as never, draft, steps, { finalActorUpdate });
    draft.skillIncreases["skill-increase-level-3"] = "diplomacy";
    steps.splice(0, 1);
    finalActorUpdate["flags.test.snapshot"] = "mutated";
    release?.();
    await Promise.all([first, queued]);

    expect(actor.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        "flags.test.snapshot": "original",
        "system.skills.arcana.rank": 1,
      })
    );
    expect(actor.update).not.toHaveBeenCalledWith(expect.objectContaining({ "system.skills.diplomacy.rank": 1 }));
  });

  it("keeps semantically different repeats distinct while another draft is queued", async () => {
    const { actor } = buildActorHarness();
    const firstDraft = createEmptyDraft(1);
    const secondDraft = createEmptyDraft(2);
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = applyDraftToActor(actor as never, firstDraft, [], {
      onCheckpoint: atPhaseStart((phase) => (phase === "singleton-replacements" ? barrier : undefined)),
    });
    const second = applyDraftToActor(actor as never, secondDraft, []);
    const repeatedFirst = applyDraftToActor(actor as never, firstDraft, [], {
      finalActorUpdate: { "flags.wayfinder-pf2e.state.lastAppliedAt": "later" },
    });

    expect(repeatedFirst).not.toBe(first);
    release?.();
    await Promise.all([first, second, repeatedFirst]);
  });

  it("allows different actors to prepare and execute concurrently", async () => {
    const firstHarness = buildActorHarness();
    const secondHarness = buildActorHarness();
    const started = new Set<string>();
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (name: string, actor: unknown) =>
      applyDraftToActor(actor as never, createEmptyDraft(1), [], {
        onCheckpoint: atPhaseStart(async (phase) => {
          if (phase !== "singleton-replacements") return;
          started.add(name);
          await barrier;
        }),
      });

    const first = run("first", firstHarness.actor);
    const second = run("second", secondHarness.actor);
    await vi.waitFor(() => expect(started).toEqual(new Set(["first", "second"])));
    release?.();
    await Promise.all([first, second]);
  });

  it("keeps lifecycle finalization inside the per-actor queue", async () => {
    const { actor } = buildActorHarness();
    const order: string[] = [];
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      order.push("first-finalize-start");
      await barrier;
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      const result = await persistUpdate(updates);
      order.push("first-finalize-end");
      return result;
    });

    const first = applyDraftToActor(actor as never, createEmptyDraft(1), [], {
      finalActorUpdate: { "flags.test.operation": "first" },
    });
    const second = applyDraftToActor(actor as never, createEmptyDraft(2), [], {
      onCheckpoint: atPhaseStart((phase) => {
        if (phase === "singleton-replacements") order.push("second-start");
      }),
      finalActorUpdate: { "flags.test.operation": "second" },
    });

    await vi.waitFor(() => expect(order).toEqual(["first-finalize-start"]));
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-finalize-start", "first-finalize-end", "second-start"]);
  });

  it("keeps phase errors typed through the facade", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);

    const apply = applyDraftToActor(actor as never, draft, [], {
      onCheckpoint: atPhaseStart((phase) => {
        if (phase === "singleton-replacements") throw new Error("stop");
      }),
    });

    await expect(apply).rejects.toBeInstanceOf(DraftApplyPhaseError);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("reports final actor update failure as a phase and permits retry", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    actor.update.mockRejectedValueOnce(new Error("final update failed"));

    await expect(
      applyDraftToActor(actor as never, draft, [], {
        finalActorUpdate: { "flags.wayfinder-pf2e.draft": null },
      })
    ).rejects.toMatchObject({
      phase: "finalize-actor",
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      partialReceipt: { actorUpdatePaths: [] },
    });

    await applyDraftToActor(actor as never, draft, [], {
      finalActorUpdate: { "flags.wayfinder-pf2e.draft": null },
    });
    expect(actor.update).toHaveBeenCalledTimes(2);
  });

  it("rejects a vetoed final actor update but accepts an already-converged no-op", async () => {
    const vetoed = buildActorHarness();
    vetoed.actor.update.mockResolvedValueOnce(undefined);
    const vetoedCheckpoints: string[] = [];

    await expect(
      applyDraftToActor(vetoed.actor as never, createEmptyDraft(1), [], {
        finalActorUpdate: { "flags.test.applied": true },
        onCheckpoint: (checkpoint) => {
          vetoedCheckpoints.push(checkpoint.checkpointId);
        },
      })
    ).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      partialReceipt: { actorUpdatePaths: [] },
    });
    expect(vetoedCheckpoints).not.toContain("write:final-actor-update:after");

    const converged = buildActorHarness();
    converged.actor.flags = { test: { applied: true } };
    converged.actor.update.mockResolvedValueOnce(undefined);
    const convergedCheckpoints: string[] = [];
    await expect(
      applyDraftToActor(converged.actor as never, createEmptyDraft(1), [], {
        finalActorUpdate: { "flags.test.applied": true },
        onCheckpoint: (checkpoint) => {
          convergedCheckpoints.push(checkpoint.checkpointId);
        },
      })
    ).resolves.toBeDefined();
    expect(convergedCheckpoints).toContain("write:final-actor-update:after");
  });

  it("rejects resolved updates that omit lifecycle state and reports only exactly converged paths", async () => {
    const stripped = buildActorHarness();
    stripped.actor.update.mockImplementationOnce(async () => stripped.actor);
    await expect(
      applyDraftToActor(stripped.actor as never, createEmptyDraft(1), [], {
        finalActorUpdate: { "flags.test.applied": true },
      })
    ).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      partialReceipt: { actorUpdatePaths: expect.not.arrayContaining(["flags.test.applied"]) },
    });

    const partial = buildActorHarness();
    partial.actor.update.mockImplementationOnce(async () => {
      partial.actor.flags = { test: { applied: true } };
      return partial.actor;
    });
    await expect(
      applyDraftToActor(partial.actor as never, createEmptyDraft(1), [], {
        finalActorUpdate: {
          "flags.test.applied": true,
          "flags.test.completed": true,
        },
      })
    ).rejects.toMatchObject({
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      partialReceipt: {
        actorUpdatePaths: expect.arrayContaining(["flags.test.applied"]),
      },
    });
  });

  it("classifies a mutate-then-reject update at the durable after boundary", async () => {
    const { actor } = buildActorHarness();
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      throw new Error("late Foundry update failure");
    });

    await expect(
      applyDraftToActor(actor as never, createEmptyDraft(1), [], {
        finalActorUpdate: { "flags.test.applied": true },
      })
    ).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:after" },
      partialReceipt: { actorUpdatePaths: expect.arrayContaining(["flags.test.applied"]) },
      intendedFinalActorUpdate: { "flags.test.applied": true },
    });
  });

  it.each([
    undefined,
    null,
    false,
    0,
    "",
  ])("preserves a falsy mutate-then-reject reason (%s) as an operation failure", async (reason) => {
    const { actor } = buildActorHarness();
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      throw reason;
    });

    await expect(
      applyDraftToActor(actor as never, createEmptyDraft(1), [], {
        finalActorUpdate: { "flags.test.applied": true },
      })
    ).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:after" },
    });
  });

  it("does not let a deferred-only no-op excuse an undefined actor update", async () => {
    const { actor } = buildActorHarness();
    actor.system = { ...actor.system, test: { value: 1 } };
    actor.update.mockResolvedValueOnce(undefined);
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.test.value"] = 1;

    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
    });
  });

  it("rejects a resolved update that persists lifecycle flags but strips deferred build state", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.details.level.value"] = 2;
    actor.update.mockImplementationOnce(async () => {
      actor.flags = { test: { applied: true } };
      return actor;
    });

    await expect(
      executePreparedDraftApplication(prepared, {
        finalActorUpdate: { "flags.test.applied": true },
      })
    ).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      partialReceipt: {
        actorUpdatePaths: ["flags.test.applied"],
      },
    });
  });

  it("fails finalization when an actor with a pending update loses its update method", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.details.level.value"] = 2;
    actor.update = undefined;

    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      failureKind: "operation",
      phase: "finalize-actor",
    });
  });

  it("accepts PF2E's set normalization for the complete language update", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.details.languages.value"] = ["common", "draconic"];
    actor.update.mockImplementationOnce(async () => {
      (actor.system.details as Record<string, unknown>).languages = {
        value: new Set(["draconic", "common"]),
      };
      return actor;
    });

    await expect(executePreparedDraftApplication(prepared)).resolves.toBeDefined();
  });

  it("checks language convergence against PF2E's raw source instead of granted prepared languages", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.details.languages.value"] = ["draconic"];
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      captureRawActorSource(actor);
      (actor.system.details as Record<string, unknown>).languages = {
        value: new Set(["common", "draconic"]),
      };
      return actor;
    });

    await expect(executePreparedDraftApplication(prepared)).resolves.toBeDefined();
  });

  it("rejects stale raw language source even when PF2E's prepared set contains the requested language", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.details.languages.value"] = ["draconic"];
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      const rawSource = captureRawActorSource(actor);
      ((rawSource.system as Record<string, unknown>).details as Record<string, unknown>).languages = {
        value: ["common"],
      };
      (actor.system.details as Record<string, unknown>).languages = {
        value: new Set(["common", "draconic"]),
      };
      return actor;
    });

    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
    });
  });

  it("checks skill convergence against raw source instead of a rule-upgraded prepared rank", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.skills.athletics.rank"] = 1;
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      captureRawActorSource(actor);
      actor.system = { ...actor.system, skills: { athletics: { rank: 2 } } };
      return actor;
    });

    await expect(executePreparedDraftApplication(prepared)).resolves.toBeDefined();
  });

  it("rejects a prepared skill rank that converged only through a rule effect", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.skills.athletics.rank"] = 2;
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      const rawSource = captureRawActorSource(actor);
      ((rawSource.system as Record<string, unknown>).skills as Record<string, unknown>).athletics = { rank: 0 };
      actor.system = { ...actor.system, skills: { athletics: { rank: 2 } } };
      return actor;
    });

    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      failureKind: "operation",
      checkpoint: { checkpointId: "write:final-actor-update:before" },
      partialReceipt: { actorUpdatePaths: [] },
    });
  });

  it("checks build-array convergence against raw source before PF2E preparation reshapes it", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);
    prepared.deferredActorUpdate["system.build"] = {
      attributes: { boosts: { 1: ["str"], 5: [], 10: [], 15: [], 20: [] } },
    };
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      await persistUpdate(updates);
      captureRawActorSource(actor);
      actor.system = { ...actor.system, build: { attributes: { boosts: { 1: [] } } } };
      return actor;
    });

    await expect(executePreparedDraftApplication(prepared)).resolves.toBeDefined();
  });

  it("does not report Foundry's injected document id as a confirmed update path", async () => {
    const { actor } = buildActorHarness();
    const persistUpdate = actor.update.getMockImplementation() as
      | ((updates: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    actor.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
      updates._id = "foundry-injected-id";
      if (!persistUpdate) throw new Error("Actor update harness is unavailable");
      return persistUpdate(updates);
    });
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), []);

    const result = await executePreparedDraftApplication(prepared, {
      finalActorUpdate: { "flags.test.applied": true },
    });
    const finalReceipt = result.receipts.at(-1);

    expect(finalReceipt?.actorUpdatePaths).toContain("flags.test.applied");
    expect(finalReceipt?.actorUpdatePaths).not.toContain("_id");
  });

  it("finalizes a recovered draft without running any prepared mutation phase", async () => {
    const { actor } = buildActorHarness();
    const checkpoints: string[] = [];

    await finalizeRecoveredDraftOnActor(actor as never, {
      recoveryActorUpdate: { "system.skills.arcana.rank": 1 },
      resolveFinalActorUpdate: () => ({ "flags.test.recovered": true }),
      onCheckpoint: (checkpoint) => {
        checkpoints.push(checkpoint.checkpointId);
      },
    });

    expect(actor.update).toHaveBeenCalledOnce();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.system.skills?.arcana?.rank).toBe(1);
    expect(checkpoints).toEqual([
      "phase:finalize-actor:before",
      "write:final-actor-update:before",
      "write:final-actor-update:after",
      "phase:finalize-actor:after",
    ]);
  });

  it("rechecks acquisition authority inside the recovery queue before reconciliation or writes", async () => {
    const { actor } = buildActorHarness();
    let authorized = true;
    const preparePlan = vi.fn();

    await expect(
      finalizeRecoveredDraftOnActorWithAuthority(actor as never, {
        recoveryActorUpdate: {},
        resolveFinalActorUpdate: () => ({ "flags.test.recovered": true }),
        validateActorAuthority: TEST_ACTOR_AUTHORITY,
        assertAcquisitionApplyAuthority: () => {
          if (!authorized) throw new Error("GM review is no longer authorized");
        },
        beforeFinalize: () => {
          authorized = false;
        },
        classGrantRecovery: {
          kind: "required",
          preparePlan,
          verifyAcquisitionRecovery: vi.fn(),
        },
      })
    ).rejects.toThrow(/no longer authorized/i);
    expect(preparePlan).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rechecks acquisition authority after recovery verification and immediately before final writes", async () => {
    const { actor } = buildActorHarness();
    Object.assign(actor, { id: "actor-1" });
    let authorized = true;
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [],
    });

    await expect(
      finalizeRecoveredDraftOnActorWithAuthority(actor as never, {
        recoveryActorUpdate: {},
        resolveFinalActorUpdate: () => ({ "flags.test.recovered": true }),
        validateActorAuthority: TEST_ACTOR_AUTHORITY,
        assertAcquisitionApplyAuthority: () => {
          if (!authorized) throw new Error("GM review is no longer authorized");
        },
        classGrantRecovery: {
          kind: "required",
          preparePlan: () => plan,
          verifyAcquisitionRecovery: () => {
            authorized = false;
            return { kind: "completed", manifest: { disposition: "purchase-ledger" } } as never;
          },
        },
      })
    ).rejects.toThrow(/no longer authorized/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("re-prepares and reconciles class grants before recovered finalization", async () => {
    const u = CLASS_GRANT_PROFILE_UUIDS;
    const grant = createPlannedClassGrant({
      grantId: "class-grant:alchemist-formula-book:class-level-1",
      profileId: "alchemist-formula-book",
      origin: { sourceSlotId: "class-level-1", sourceUuid: u.alchemistClass },
      granterSourceUuid: u.formulaBookFeature,
      expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [u.formulaBookFeature, u.alchemyFeature, u.alchemistClass],
    });
    const items = [
      {
        id: "book",
        type: "equipment",
        sourceId: u.formulaBookItem,
        system: { quantity: 1 },
        flags: { pf2e: { grantedBy: { id: "formula" } } },
      },
      {
        id: "formula",
        type: "feat",
        sourceId: u.formulaBookFeature,
        system: { quantity: 1 },
        flags: { pf2e: { grantedBy: { id: "alchemy" } } },
      },
      {
        id: "alchemy",
        type: "feat",
        sourceId: u.alchemyFeature,
        system: { quantity: 1, location: "class" },
        flags: {},
      },
      {
        id: "class",
        type: "class",
        sourceId: u.alchemistClass,
        system: { quantity: 1 },
        flags: { [MODULE_ID]: { slotId: "class-level-1" } },
      },
    ];
    const { actor } = buildActorHarness({ items });
    Object.assign(actor, { id: "actor-1" });
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const resolveFinalActorUpdate = vi.fn(() => ({ "flags.test.recovered": true }));

    await finalizeRecoveredDraftOnActorWithAuthority(actor as never, {
      recoveryActorUpdate: {},
      resolveFinalActorUpdate,
      validateActorAuthority: TEST_ACTOR_AUTHORITY,
      assertAcquisitionApplyAuthority: TEST_ACQUISITION_AUTHORITY,
      classGrantRecovery: {
        kind: "required",
        preparePlan: () => plan,
        verifyAcquisitionRecovery: () => ({ kind: "completed", manifest: { disposition: "purchase-ledger" } }) as never,
      },
    });

    expect(resolveFinalActorUpdate).toHaveBeenCalledWith({
      classGrantReconciliations: [expect.objectContaining({ phase: "final", ignoredItemIds: ["book"] })],
      acquisition: expect.objectContaining({ kind: "completed" }),
    });

    const missing = buildActorHarness({ items: items.filter((item) => item.id !== "book") }).actor;
    Object.assign(missing, { id: "actor-1" });
    await expect(
      finalizeRecoveredDraftOnActorWithAuthority(missing as never, {
        recoveryActorUpdate: {},
        resolveFinalActorUpdate: () => ({ "flags.test.recovered": true }),
        validateActorAuthority: TEST_ACTOR_AUTHORITY,
        assertAcquisitionApplyAuthority: TEST_ACQUISITION_AUTHORITY,
        classGrantRecovery: {
          kind: "required",
          preparePlan: () => plan,
          verifyAcquisitionRecovery: () =>
            ({ kind: "completed", manifest: { disposition: "purchase-ledger" } }) as never,
        },
      })
    ).rejects.toThrow(/missing or ambiguous/i);
    expect(missing.update).not.toHaveBeenCalled();
  });

  it("vetoes recovered finalization when another draft propagates at pre-update", async () => {
    const { actor } = buildActorHarness();
    const initial = createEmptyDraft(5);
    initial.applyAttemptStepIds = ["class-level-1"];
    const external = structuredClone(initial);
    external.applyAttemptStepIds = ["background-level-1"];
    let persisted: unknown = initial;
    const guard = new PersistedDraftWriteGuard(initial);
    Object.assign(actor, { getFlag: () => persisted });
    actor.update.mockImplementation(async (update: Record<string, unknown>, operation?: Record<string, unknown>) => {
      persisted = external;
      if (evaluatePersistedDraftWriteGuardHook(actor as never, update, operation) === false) {
        return undefined;
      }
      persisted = update[DRAFT_FLAG];
      return actor;
    });

    const apply = finalizeRecoveredDraftOnActor(actor as never, {
      recoveryActorUpdate: {},
      resolveFinalActorUpdate: () => ({ [DRAFT_FLAG]: null }),
      beforeFinalActorUpdate: () => guard.assertCurrent(initial),
      persistFinalActorUpdate: (actorUpdate) =>
        updateActorWithPersistedDraftPrecondition(
          actor as never,
          actorUpdate,
          capturePersistedDraftPrecondition(actor as never, 5, guard)
        ),
    });

    await expect(apply).rejects.toMatchObject({
      phase: "finalize-actor",
      checkpoint: expect.objectContaining({ checkpointId: "write:final-actor-update:before" }),
      cause: expect.any(WayfinderDraftWriteConflictError),
    });
    expect(persisted).toBe(external);
  });

  it("vetoes normal Apply when another draft propagates at pre-update", async () => {
    const { actor } = buildActorHarness();
    const initial = createEmptyDraft(5);
    initial.applyAttemptStepIds = ["class-level-1"];
    const external = structuredClone(initial);
    external.applyAttemptStepIds = ["background-level-1"];
    let persisted: unknown = initial;
    const guard = new PersistedDraftWriteGuard(initial);
    Object.assign(actor, { getFlag: () => persisted });
    actor.update.mockImplementation(async (update: Record<string, unknown>, operation?: Record<string, unknown>) => {
      persisted = external;
      if (evaluatePersistedDraftWriteGuardHook(actor as never, update, operation) === false) {
        return undefined;
      }
      persisted = update[DRAFT_FLAG];
      return actor;
    });

    const apply = applyDraftToActor(actor as never, initial, [], {
      finalActorUpdate: { [DRAFT_FLAG]: null },
      beforeFinalActorUpdate: () => guard.assertCurrent(initial),
      persistFinalActorUpdate: (actorUpdate) =>
        updateActorWithPersistedDraftPrecondition(
          actor as never,
          actorUpdate,
          capturePersistedDraftPrecondition(actor as never, 5, guard)
        ),
    });

    await expect(apply).rejects.toMatchObject({
      phase: "finalize-actor",
      checkpoint: expect.objectContaining({ checkpointId: "write:final-actor-update:before" }),
      cause: expect.any(WayfinderDraftWriteConflictError),
    });
    expect(persisted).toBe(external);
  });

  it("carries deferred actor paths from a partial Apply into recovery-only finalization", async () => {
    const { actor } = buildActorHarness();
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(5), []);
    prepared.deferredActorUpdate["system.skills.arcana.rank"] = 1;
    let failure: DraftApplyPhaseError | null = null;

    try {
      await executePreparedDraftApplication(prepared, {
        onCheckpoint: atPhaseStart((phase) => {
          if (phase === "source-flag-restoration") throw new Error("late failure");
        }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DraftApplyPhaseError);
      failure = error as DraftApplyPhaseError;
    }

    expect(failure?.recoveryActorUpdate).toEqual(
      expect.objectContaining({
        "system.details.level.value": 5,
        "system.skills.arcana.rank": 1,
        "system.build": expect.any(Object),
      })
    );
    prepared.deferredActorUpdate["system.skills.arcana.rank"] = 4;
    expect(failure?.recoveryActorUpdate).toEqual(
      expect.objectContaining({ "system.skills.arcana.rank": 1, "system.build": expect.any(Object) })
    );

    await finalizeRecoveredDraftOnActor(actor as never, {
      recoveryActorUpdate: { ...failure?.recoveryActorUpdate },
      resolveFinalActorUpdate: () => ({ "flags.test.recovered": true }),
    });

    expect(actor.system.skills?.arcana?.rank).toBe(1);
    expect(actor.system.details?.level?.value).toBe(5);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("retries a late failure without applying a skill increase twice", async () => {
    const { actor } = buildActorHarness();
    actor.system = { ...actor.system, skills: { arcana: { rank: 0 } } };
    const draft = createEmptyDraft(3);
    draft.skillIncreases["skill-increase-level-3"] = "arcana";

    await expect(
      applyDraftToActor(actor as never, draft, [], {
        onCheckpoint: atPhaseStart((phase) => {
          if (phase === "source-flag-restoration") throw new Error("late failure");
        }),
      })
    ).rejects.toBeInstanceOf(DraftApplyPhaseError);
    expect(actor.system.skills?.arcana?.rank).toBe(0);
    expect(actor.update).not.toHaveBeenCalled();

    await applyDraftToActor(actor as never, draft, [skillIncreaseStep(3)]);

    expect(actor.system.skills?.arcana?.rank).toBe(1);
    expect(actor.update).toHaveBeenCalledTimes(1);
  });

  it("retries after a completed singleton phase without duplicating the final selection", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "old-class",
          type: "class",
          name: "Fighter",
          flags: { core: { sourceId: "Compendium.pf2e.classes.Item.fighter" } },
          system: {},
        },
      ],
    });
    const createItems = actor.createEmbeddedDocuments.getMockImplementation() as (
      type: string,
      sources: EmbeddedItemSource[]
    ) => Promise<ActorItemLike[]>;
    actor.createEmbeddedDocuments.mockImplementation(async (type, sources) => {
      if (sources.some((source) => source.type === "class")) {
        actor.items.contents = actor.items.contents.filter((item) => item.type !== "class");
      }
      return createItems(type, sources);
    });
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");

    await expect(
      applyDraftToActor(actor as never, draft, [classSelectionStep()], {
        onCheckpoint: atPhaseStart((phase) => {
          if (phase === "source-flag-restoration") throw new Error("late failure");
        }),
      })
    ).rejects.toMatchObject({ phase: "source-flag-restoration" });

    await applyDraftToActor(actor as never, draft, [classSelectionStep()]);
    expect(actor.items.contents.filter((item) => item.type === "class")).toEqual([
      expect.objectContaining({ name: "Wizard" }),
    ]);
  });
});

function atPhaseStart(callback: (phase: DraftApplyPhase) => void | Promise<void>): DraftApplyCheckpointHook {
  return (checkpoint) => {
    if (checkpoint.kind === "phase" && checkpoint.boundary === "before") {
      return callback(checkpoint.phase);
    }
  };
}

function captureRawActorSource(actor: {
  system?: unknown;
  flags?: unknown;
  _source?: unknown;
}): Record<string, unknown> {
  const rawSource = {
    system: structuredClone(actor.system),
    flags: structuredClone(actor.flags ?? {}),
  };
  actor._source = rawSource;
  return rawSource;
}

function skillIncreaseStep(level: number): PendingStep {
  const slotId = `skill-increase-level-${level}`;
  return {
    id: slotId,
    level,
    kind: "skill-increase",
    slotKind: "skill-increase",
    title: `Skill increase ${level}`,
    description: "",
    required: true,
    slotId,
  };
}

function necromancerTrainingStep(): PendingStep {
  return {
    id: "skill-training-fighter-level-1",
    level: 1,
    kind: "skill-training",
    slotKind: "skill-training",
    title: "Fighter skill training",
    description: "",
    required: true,
    slotId: "skill-training-fighter-level-1",
    training: {
      classSlug: "fighter",
      className: "Fighter",
      fixedSkills: [],
      fixedLores: [],
      choiceRules: [
        {
          key: "feat:necromancer-dedication:dedication-skill-1",
          flag: "feat:necromancer-dedication:dedication-skill-1",
          prompt: "Choose Occultism",
          sourceLabel: "Necromancer Dedication",
          options: [{ slug: "occultism", label: "Occultism" }],
          fallbackPrompt: "Choose a skill",
          fallbackOptions: [
            { slug: "arcana", label: "Arcana" },
            { slug: "society", label: "Society" },
          ],
          persistence: null,
        },
      ],
      loreChoices: [],
      additionalCount: 1,
    },
  };
}

function spellChoiceStep(count: number): SpellChoiceStep {
  return {
    id: "spell-choice-wizard-cantrips-level-1",
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Wizard cantrips",
    description: "",
    required: true,
    slotId: "spell-choice-wizard-cantrips-level-1",
    filters: { itemType: "spell", packIds: ["pf2e.spells-srd"] },
    spellChoice: {
      slotId: "spell-choice-wizard-cantrips-level-1",
      sourcePackId: null,
      sourceDocumentId: null,
      sourceUuid: null,
      sourceName: "Wizard",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "spellbook",
        key: "wizard-spellbook",
        label: "Wizard spellbook",
        entryName: "Arcane Prepared Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

function languageChoiceStep() {
  return createLanguageChoiceStep(1, {
    slotId: "language-choice-level-1",
    sourceItemType: "ancestry",
    sourceName: "Human",
    grantedLanguages: ["common"],
    count: 2,
    options: [
      { value: "draconic", label: "Draconic", requiresGmApproval: false },
      { value: "dwarven", label: "Dwarven", requiresGmApproval: false },
    ],
  });
}

function flagChoiceStep(): PendingStep {
  const slotId = "flag-choice-none-feat-multifarious-muse-muse-level-2";
  return {
    id: slotId,
    level: 2,
    kind: "pick-item",
    slotKind: "flag-choice",
    title: "Choose a muse",
    description: "",
    required: true,
    slotId,
    filters: { itemType: "feat" },
    flagChoice: {
      slotId,
      sourceItemType: "feat",
      sourcePackId: "pf2e.feats-srd",
      sourceDocumentId: "multifarious-muse",
      sourceUuid: "Compendium.pf2e.feats-srd.Item.multifarious-muse",
      sourceName: "Multifarious Muse",
      sourceRuleIndex: 0,
      flag: "muse",
      prompt: "Choose a muse",
      itemType: "feat",
      selectionValue: "uuid",
      dependsOn: "class",
      filters: { itemType: "feat" },
    },
  };
}

function titanGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:titan-mauler:class-branch-instinct-level-1",
    profileId: "giant-instinct-titan-mauler",
    origin: { sourceSlotId: "class-branch-instinct-level-1", sourceUuid: u.giantInstinct },
    granterSourceUuid: u.giantInstinct,
    expected: {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
      quantity: 1,
      itemType: "weapon",
    },
    materializer: "wayfinder-acquisition",
    eligibilityKind: "catalogue-choice",
    resaleRule: "zero-until-rune-investment",
    eligibilityEvidence: {
      kind: "titan-mauler",
      documentFingerprint: "weapon-document",
      lineId: "line-titan",
      lineDocumentFingerprint: "line-document",
      linePriceFingerprint: "line-price",
      policyFingerprint: "policy",
      actorSize: "medium",
      targetSize: "large",
      basePriceCopper: 900,
      weaponCategory: "martial",
      rangeIncrement: null,
      rarity: "common",
      characterAccessRef: null,
      sourceAllowed: true,
      quantity: 1,
      permanence: "permanent",
      componentKind: "baseline-item",
    },
    nativeGrantChainSourceUuids: [],
  });
}
