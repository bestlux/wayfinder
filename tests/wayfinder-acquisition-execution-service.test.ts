import { describe, expect, it } from "vitest";
import { finalizeRecoveredDraftOnActor } from "../src/actor-updater";
import {
  DraftApplyPhaseError,
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "../src/actor-updater/prepared-draft-application";
import { DRAFT_FLAG, MODULE_ID, STATE_FLAG } from "../src/constants";
import { createEmptyDraft, createEmptyState } from "../src/draft-service";
import type { ActorItemFlags, ActorItemLike, EmbeddedItemSource, ItemSystemLike } from "../src/shared/actor-model";
import type { DraftState, ModuleState } from "../src/types";
import {
  type AcquisitionExecutionDependencies,
  createAcquisitionExecutionSession,
} from "../src/wayfinder/application/acquisition-execution-service";
import { captureObservedClassGrantItems } from "../src/wayfinder/application/class-grant-projection-service";
import {
  PersistedDraftWriteGuard,
  readPersistedDraftSnapshot,
  saveDraftWithWriteGuard,
} from "../src/wayfinder/application/draft-write-guard";
import { fingerprintEquipmentDocument } from "../src/wayfinder/application/equipment-catalogue-service";
import {
  type AcquisitionCurrencyConvergenceWitnessV1,
  createAcquisitionCurrencyConvergenceWitness,
} from "../src/wayfinder/domain/acquisition-currency-convergence";
import {
  createAcquisitionDraft,
  recordAcquisitionCurrencyConvergenceWitness,
} from "../src/wayfinder/domain/acquisition-draft";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionLedger,
  reviewPurchaseLedger,
  reviewRetainAll,
} from "../src/wayfinder/domain/acquisition-ledger";
import type {
  AcquisitionDraftState,
  AcquisitionLineDraft,
  AcquisitionPolicySnapshot,
} from "../src/wayfinder/domain/acquisition-types";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  type PlannedClassGrantV1,
  type PreparedClassGrantPlanV1,
  reconcilePreparedClassGrants,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import {
  type CompletedAcquisitionManifestV1,
  computeCompletedAcquisitionManifestFingerprint,
  normalizeCompletedAcquisitionManifest,
} from "../src/wayfinder/domain/completed-acquisition-manifest";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

const NOW = "2026-08-19T12:00:00.000Z";
const ENVIRONMENT = { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.8.0" };
const PERSISTED_RELOAD_CASES = [
  {
    id: "item-after-n",
    checkpointId: "write:embedded-item-create:after",
    currencyMode: "normal",
    intermediate: { items: 1, copper: 0, witnessed: false, completed: false },
  },
  {
    id: "currency-before",
    checkpointId: "write:currency-convergence:before",
    currencyMode: "normal",
    intermediate: { items: 2, copper: 0, witnessed: false, completed: false },
  },
  {
    id: "currency-mutate-then-throw",
    checkpointId: null,
    currencyMode: "mutate-then-throw",
    intermediate: { items: 2, copper: 1_300, witnessed: true, completed: false },
  },
  {
    id: "final-state-before",
    checkpointId: "write:final-actor-update:before",
    currencyMode: "normal",
    intermediate: { items: 2, copper: 1_300, witnessed: true, completed: false },
  },
  {
    id: "final-state-after",
    checkpointId: "write:final-actor-update:after",
    currencyMode: "normal",
    intermediate: { items: 2, copper: 1_300, witnessed: false, completed: true },
  },
] as const;

describe("Wave 2 acquisition execution", () => {
  it("aggregates reviewed purchase lines, inserts one non-stacking item, and records real manifest evidence", async () => {
    const first = line({ lineId: "line-a" });
    const second = line({ lineId: "line-b" });
    const fixture = reviewedFixture([first, second]);
    const actor = new FakeActor();
    const checkpoints: string[] = [];
    const session = sessionFor(fixture.acquisition);

    await session.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: checkpointRecorder(checkpoints),
    });
    await session.executeAcquisitionCurrency({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: checkpointRecorder(checkpoints),
      persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
    });
    const outcome = await session.verifyAcquisitionOutcome({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(actor.acquisitionItems()).toHaveLength(1);
    expect(actor.acquisitionItems()[0]?.quantity).toBe(2);
    expect(actor.addOptions).toEqual([{ stack: false, render: false }]);
    expect(actor.addedSources[0]).not.toHaveProperty("_id");
    expect(actor.addedSources[0]?.system).toMatchObject({ quantity: 2, containerId: null, size: "med" });
    expect(acquisitionIdentity(actor.acquisitionItems()[0]!)).toMatchObject({
      version: 1,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      lineId: "line-a",
      entryId: outcome.identityPlan.entries[0]?.entryId,
      plannedItemId: outcome.identityPlan.entries[0]?.plannedItems[0]?.plannedItemId,
      plannedContainerId: null,
      plannedGrantId: null,
      stackingIntent: "aggregate",
    });
    expect(actor.currencyCopper).toBe(1_300);
    expect(actor.currencyAdds).toEqual([1_300]);
    expect(checkpoints).toEqual([
      "embedded-item-create:before:1",
      "embedded-item-create:after:1",
      "currency-convergence:before:1",
      "currency-convergence:after:1",
    ]);
    expect(outcome.manifest.disposition).toBe("purchase-ledger");
    expect(outcome.manifest.currency).toEqual({
      preCopper: 0,
      budgetCopper: 1_500,
      spentCopper: 200,
      remainingCopper: 1_300,
      targetCopper: 1_300,
      observedCopper: 1_300,
    });
    expect(outcome.manifest.logicalLines.map((entry) => entry.lineId)).toEqual(["line-a", "line-b"]);
    expect(outcome.manifest.entries).toHaveLength(1);
    expect(outcome.manifest.entries[0]?.observedItems[0]).toMatchObject({
      actualItemId: actor.acquisitionItems()[0]?.id,
      actualQuantity: 2,
      actualContainerId: null,
    });
    expect(outcome.manifest.appliedBy).toEqual({ userId: "owner-1", userName: "Owner" });
    expect(outcome.manifest.environment).toEqual(ENVIRONMENT);
  });

  it("materializes Small-character equipment at PF2E's Medium physical-item size", async () => {
    const fixture = reviewedFixture([line({ lineId: "line-small", price: acquisitionPrice("small") })]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition);

    await session.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });

    expect(actor.addedSources[0]?.system?.size).toBe("med");
    expect(actor.acquisitionItems()[0]?.system?.size).toBe("med");
  });

  it("retains the full budget without creating an item", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition);

    await runItemsAndCurrency(session, actor, fixture);
    const outcome = await verify(session, actor, fixture);

    expect(actor.acquisitionItems()).toEqual([]);
    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([1_500]);
    expect(outcome.manifest.disposition).toBe("retain-all");
    expect(outcome.manifest.currency).toMatchObject({
      spentCopper: 0,
      remainingCopper: 1_500,
      targetCopper: 1_500,
      observedCopper: 1_500,
    });
  });

  it("rejects unhealthy equipment sources before a retain-all currency or manifest write", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition, {
      sourceHealthError: new Error("Approved equipment sources are unavailable or inconsistent."),
    });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/equipment sources/i);
    await expect(
      session.executeAcquisitionCurrency({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
        persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
      })
    ).rejects.toThrow(/must be prepared/i);
    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
    expect(actor.currencyRemovals).toEqual([]);
  });

  it("acknowledges handoff with durable evidence and zero economic writes", async () => {
    const actor = new FakeActor(25);
    const fixture = handoffFixture(actor);
    const session = sessionFor(fixture.acquisition);

    await runItemsAndCurrency(session, actor, fixture);
    const outcome = await verify(session, actor, fixture);

    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
    expect(actor.currencyRemovals).toEqual([]);
    expect(actor.currencyCopper).toBe(25);
    expect(outcome.manifest.disposition).toBe("handoff");
    expect(outcome.manifest.entries).toEqual([]);
    expect(outcome.manifest.currency).toEqual({
      preCopper: 25,
      budgetCopper: 1_500,
      spentCopper: 0,
      remainingCopper: 1_500,
      targetCopper: 25,
      observedCopper: 25,
    });
  });

  it("completes an acknowledged configured-item handoff with zero economic writes", async () => {
    const actor = new FakeActor();
    const fixture = configuredHandoffFixture(actor);
    const session = sessionFor(fixture.acquisition);

    await runItemsAndCurrency(session, actor, fixture);
    const outcome = await verify(session, actor, fixture);

    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
    expect(actor.currencyRemovals).toEqual([]);
    expect(outcome.manifest).toMatchObject({ disposition: "handoff", entries: [] });
  });

  it.each([
    "source",
    "document",
    "price",
    "resolved-price",
    "policy",
  ] as const)("rejects %s drift before the first item write", async (drift) => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition, { drift });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(new RegExp(drift, "i"));
    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
  });

  it("rejects a relabeled wrong Compendium source before the first item write", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition, { drift: "relabeled-source" });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/source document identity differs/i);
    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
  });

  it("rechecks completed acquisition history after asynchronous source preflight", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition, { manifestAppearsAfterFirstHistoryRead: true });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/already has a completed starting-equipment manifest/i);
    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
  });

  it("rejects effective policy drift before the first item write", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const reviewedPolicy = fixture.acquisition.policySnapshot!;
    const changedPolicy: AcquisitionPolicySnapshot = {
      ...structuredClone(reviewedPolicy),
      material: { ...structuredClone(reviewedPolicy.material), budgetCopper: 1_499 },
    };
    const session = sessionFor(fixture.acquisition, { currentPolicy: changedPolicy });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/policy differs/i);
    expect(actor.addOptions).toEqual([]);
  });

  it("reasserts apply authority immediately after asynchronous source preflight", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const events: string[] = [];
    const session = sessionFor(fixture.acquisition, { events, authorityError: new Error("Owner changed.") });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/owner changed/i);
    expect(events).toEqual(["policy", "source", "authority"]);
    expect(actor.addOptions).toEqual([]);
  });

  it.each(["veto", "merged"] as const)("rejects a %s item insertion after rereading actor state", async (mode) => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    actor.itemWriteMode = mode;
    const session = sessionFor(fixture.acquisition);

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/did not create|outside the prepared acquisition batch/i);
    expect(actor.addOptions).toEqual([{ stack: false, render: false }]);
  });

  it("retries after a forced partial failure without duplicating an exact stamped item", async () => {
    const fixture = reviewedFixture([
      line({
        lineId: "line-a",
        sourceUuid: sourceUuid("a"),
        priceFingerprint: "price-a",
      }),
      line({
        lineId: "line-b",
        sourceUuid: sourceUuid("b"),
        priceFingerprint: "price-b",
      }),
    ]);
    const actor = new FakeActor();
    actor.failBeforeAddOrdinal = 2;
    const firstSession = sessionFor(fixture.acquisition);

    await expect(
      firstSession.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/forced item failure/i);
    expect(actor.acquisitionItems()).toHaveLength(1);

    actor.failBeforeAddOrdinal = null;
    const recoveryDraft = {
      ...fixture.draft,
      applyAttemptStepIds: ["starting-equipment-level-1"],
    };
    const retrySession = sessionFor(fixture.acquisition);
    await retrySession.executeAcquisitionItems({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await retrySession.executeAcquisitionCurrency({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
      persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
    });
    const outcome = await retrySession.verifyAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(actor.acquisitionItems()).toHaveLength(2);
    expect(new Set(actor.acquisitionItems().map((item) => acquisitionIdentity(item)?.plannedItemId)).size).toBe(2);
    expect(actor.addOptions).toHaveLength(2);
    expect(outcome.manifest.entries).toHaveLength(2);
    expect(outcome.manifest.entries.flatMap((entry) => entry.observedItems)).toHaveLength(2);
  });

  it("preflights, topologically materializes, and retry-converges an Adventurer's Pack graph", async () => {
    const fixture = reviewedFixture([kitLine()]);
    const actor = new FakeActor();
    actor.failBeforeAddOrdinal = 5;
    const first = sessionFor(fixture.acquisition);

    await expect(
      first.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/forced item failure/i);
    expect(actor.acquisitionItems()).toHaveLength(4);
    expect(actor.currencyCopper).toBe(0);

    actor.failBeforeAddOrdinal = null;
    const recoveryDraft = { ...fixture.draft, applyAttemptStepIds: ["starting-equipment-level-1"] };
    const retry = sessionFor(fixture.acquisition);
    await retry.executeAcquisitionItems({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await retry.executeAcquisitionCurrency({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
      persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
    });
    const outcome = await retry.verifyAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(actor.acquisitionItems()).toHaveLength(9);
    expect(actor.addOptions).toHaveLength(9);
    expect(actor.currencyCopper).toBe(1_350);
    const backpack = actor.acquisitionItems().find((item) => item.type === "backpack")!;
    expect(actor.addContainerIds).toEqual([null, ...Array(8).fill(backpack.id)]);
    expect(
      actor
        .acquisitionItems()
        .filter((item) => item.type !== "backpack")
        .every((item) => item.system.containerId === backpack.id)
    ).toBe(true);
    expect(outcome.manifest.entries[0]?.kitExpansion?.profile).toBe("adventurers-pack-v1");
    expect(outcome.manifest.entries[0]?.observedItems).toHaveLength(9);
    expect(normalizeCompletedAcquisitionManifest(outcome.manifest)).not.toBeNull();
    const wrongEntries = outcome.manifest.entries.map((entry, entryIndex) => ({
      ...entry,
      observedItems: entry.observedItems.map((item, itemIndex) =>
        entryIndex === 0 && itemIndex === 1 ? { ...item, actualContainerId: null } : item
      ),
    }));
    const { fingerprint: _fingerprint, ...manifestWithoutFingerprint } = outcome.manifest;
    const wrongMaterial = { ...manifestWithoutFingerprint, entries: wrongEntries };
    const wrongContainer: CompletedAcquisitionManifestV1 = {
      ...wrongMaterial,
      fingerprint: computeCompletedAcquisitionManifestFingerprint(wrongMaterial),
    };
    expect(normalizeCompletedAcquisitionManifest(wrongContainer)).toBeNull();
  });

  it("rejects malformed Adventurer's Pack retries before another write", async () => {
    const fixture = reviewedFixture([kitLine()]);
    const actor = new FakeActor();
    actor.failBeforeAddOrdinal = 3;
    const first = sessionFor(fixture.acquisition);
    await expect(
      first.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/forced item failure/i);
    expect(actor.acquisitionItems()).toHaveLength(2);

    const rootIndex = actor.items.contents.findIndex((item) => item.type === "backpack");
    actor.items.contents.splice(rootIndex, 1);
    const orphan = actor.acquisitionItems()[0]!;
    const orphanIndex = actor.items.contents.indexOf(orphan);
    const orphanedItem: FakeItem = {
      ...orphan,
      system: { ...orphan.system, containerId: null },
      _source: { system: { ...orphan._source.system, containerId: null } },
      container: null,
    };
    actor.items.contents[orphanIndex] = orphanedItem;
    actor.failBeforeAddOrdinal = null;
    const recoveryDraft = { ...fixture.draft, applyAttemptStepIds: ["starting-equipment-level-1"] };
    const writesBeforeRetry = actor.addOptions.length;
    await expect(
      sessionFor(fixture.acquisition).executeAcquisitionItems({
        actor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/foreign physical items|observed owner|economic admission/i);
    expect(actor.addOptions).toHaveLength(writesBeforeRetry);

    const relabeledActor = new FakeActor();
    relabeledActor.failBeforeAddOrdinal = 3;
    await expect(
      sessionFor(fixture.acquisition).executeAcquisitionItems({
        actor: relabeledActor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/forced item failure/i);
    const relabeledChild = relabeledActor.acquisitionItems().find((item) => item.type !== "backpack")!;
    acquisitionIdentity(relabeledChild)!.entryId = "wrong-entry";
    relabeledActor.failBeforeAddOrdinal = null;
    const relabeledWrites = relabeledActor.addOptions.length;
    await expect(
      sessionFor(fixture.acquisition).executeAcquisitionItems({
        actor: relabeledActor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/foreign physical items|economic admission/i);
    expect(relabeledActor.addOptions).toHaveLength(relabeledWrites);

    const duplicateOwnerActor = new FakeActor();
    duplicateOwnerActor.failBeforeAddOrdinal = 3;
    await expect(
      sessionFor(fixture.acquisition).executeAcquisitionItems({
        actor: duplicateOwnerActor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/forced item failure/i);
    const duplicateOwner = duplicateOwnerActor.acquisitionItems().find((item) => item.type === "backpack")!;
    duplicateOwnerActor.items.contents.push({ ...duplicateOwner, id: "duplicate-container-owner" });
    duplicateOwnerActor.failBeforeAddOrdinal = null;
    const duplicateOwnerWrites = duplicateOwnerActor.addOptions.length;
    await expect(
      sessionFor(fixture.acquisition).executeAcquisitionItems({
        actor: duplicateOwnerActor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/foreign physical items|economic admission/i);
    expect(duplicateOwnerActor.addOptions).toHaveLength(duplicateOwnerWrites);
  });

  it("rejects Adventurer's Pack child drift before any acquisition write", async () => {
    const fixture = reviewedFixture([kitLine()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition, { drift: "kit-child" });

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/kit child .* drifted/i);
    expect(actor.acquisitionItems()).toHaveLength(0);
    expect(actor.currencyCopper).toBe(0);
  });

  it("observes a PF2E-native formula book without duplicating it and records its exact manifest ID", async () => {
    const grant = formulaGrant();
    const fixture = reviewedFixture(
      [
        line({
          lineId: "line-formula-book",
          sourceUuid: grant.expected.sourceUuid,
          priceFingerprint: "formula-price",
          funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
        }),
      ],
      "retain-all",
      [grant]
    );
    const actor = new FakeActor();
    const nativeBook = seedFormulaBookGrant(actor);
    const events: string[] = [];
    const session = sessionFor(fixture.acquisition, { events });

    await runItemsAndCurrency(session, actor, fixture);
    const outcome = await verify(session, actor, fixture);

    expect(actor.addOptions).toEqual([]);
    expect(actor.acquisitionItems()).toEqual([nativeBook]);
    expect(acquisitionIdentity(nativeBook)).toBeNull();
    expect(events.filter((event) => event === "source")).toHaveLength(1);
    expect(outcome.manifest.entries[0]?.observedItems).toEqual([
      {
        plannedItemId: outcome.identityPlan.entries[0]?.plannedItems[0]?.plannedItemId,
        actualItemId: "native-formula-book",
        actualSourceUuid: grant.expected.sourceUuid,
        actualQuantity: 1,
        plannedContainerId: null,
        actualContainerId: null,
      },
    ]);
    expect(outcome.manifest.classGrants[0]?.observedItemIds).toEqual(["native-formula-book"]);
  });

  it("recognizes a partial Titan Mauler retry, preserves one item, and stamps the reviewed large size", async () => {
    const grant = titanGrant();
    const fixture = reviewedFixture(
      [
        line({
          lineId: "line-titan",
          sourceUuid: grant.expected.sourceUuid,
          priceFingerprint: "titan-price",
          funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
          price: acquisitionPrice("large"),
        }),
      ],
      "retain-all",
      [grant]
    );
    const actor = new FakeActor();
    const firstSession = sessionFor(fixture.acquisition);
    await firstSession.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    expect(actor.addedSources[0]?.system?.size).toBe("lg");

    const recoveryDraft = { ...fixture.draft, applyAttemptStepIds: ["starting-equipment-level-1"] };
    const retrySession = sessionFor(fixture.acquisition);
    await retrySession.executeAcquisitionItems({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await retrySession.executeAcquisitionCurrency({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
      persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
    });
    const outcome = await retrySession.verifyAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(actor.addOptions).toHaveLength(1);
    expect(actor.acquisitionItems()).toHaveLength(1);
    expect(acquisitionIdentity(actor.acquisitionItems()[0]!)).toMatchObject({ plannedGrantId: grant.grantId });
    expect(outcome.manifest.entries[0]?.price).toMatchObject({
      size: "large",
      unitPriceCopper: 200,
      linePriceCopper: 200,
    });
    expect(outcome.manifest.entries[0]?.observedItems[0]?.actualItemId).toBe(actor.acquisitionItems()[0]?.id);
  });

  it("rejects a Titan Mauler insert whose reread size differs from the reviewed target", async () => {
    const grant = titanGrant();
    const fixture = reviewedFixture(
      [
        line({
          lineId: "line-titan",
          sourceUuid: grant.expected.sourceUuid,
          priceFingerprint: "titan-price",
          funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
          price: acquisitionPrice("large"),
        }),
      ],
      "retain-all",
      [grant]
    );
    const actor = new FakeActor();
    actor.itemWriteMode = "wrong-size";
    const session = sessionFor(fixture.acquisition);

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/wrong prepared or raw size/i);
    expect(actor.addOptions).toHaveLength(1);
  });

  it("does not attribute target retain-all currency from generic Apply recovery state", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const firstSession = sessionFor(fixture.acquisition);
    await runItemsAndCurrency(firstSession, actor, fixture);

    const recoveryDraft = { ...fixture.draft, applyAttemptStepIds: ["starting-equipment-level-1"] };
    const retrySession = sessionFor(fixture.acquisition);
    await expect(
      retrySession.executeAcquisitionItems({
        actor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/economic admission failed: current wealth requires PF2E-sheet handoff:.*nonzero-currency/i);

    expect(actor.currencyAdds).toEqual([1_500]);
    expect(actor.currencyCopper).toBe(1_500);
  });

  it("reopens after process loss at currency-after and never repeats witnessed retain-all convergence", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const lockedDraft = {
      ...fixture.draft,
      applyAttemptStepIds: ["starting-equipment-level-1"],
    };
    let persistedDraft: unknown = structuredClone(lockedDraft);
    const persistedDraftActor = {
      getFlag: () => persistedDraft,
      update: async (update: Record<string, unknown>) => {
        persistedDraft = update[DRAFT_FLAG];
        return persistedDraftActor;
      },
    };
    const draftWriteGuard = new PersistedDraftWriteGuard(readPersistedDraftSnapshot(persistedDraftActor, 1));
    const firstSession = sessionFor(fixture.acquisition);
    await firstSession.executeAcquisitionItems({
      actor,
      draft: lockedDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await expect(
      firstSession.executeAcquisitionCurrency({
        actor,
        draft: lockedDraft,
        classGrantPlan: fixture.classGrantPlan,
        persistCurrencyConvergenceWitness: async (witness) => {
          const currentDraft = readPersistedDraftSnapshot(persistedDraftActor, 1);
          if (!currentDraft?.acquisition) throw new Error("Expected the locked Apply draft.");
          currentDraft.acquisition = recordAcquisitionCurrencyConvergenceWitness(currentDraft.acquisition, witness);
          await saveDraftWithWriteGuard(persistedDraftActor, currentDraft, 1, draftWriteGuard);
        },
        emitWriteCheckpoint: async (operation, boundary) => {
          if (operation !== "currency-convergence" || boundary !== "after") return;
          const reopened = readPersistedDraftSnapshot(persistedDraftActor, 1);
          expect(reopened?.acquisition?.currencyConvergenceWitness).toBeTruthy();
          throw new Error("simulated process stop before finalization");
        },
      })
    ).rejects.toThrow(/process stop/i);

    const recoveryDraft = readPersistedDraftSnapshot(persistedDraftActor, 1);
    if (!recoveryDraft) throw new Error("Expected the witnessed recovery draft to survive reopen.");
    const recoveryAcquisition = recoveryDraft.acquisition!;
    const retrySession = sessionFor(recoveryAcquisition);
    const retryWitnesses: AcquisitionCurrencyConvergenceWitnessV1[] = [];

    await retrySession.executeAcquisitionItems({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await retrySession.executeAcquisitionCurrency({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
      persistCurrencyConvergenceWitness: async (value) => {
        retryWitnesses.push(value);
      },
    });
    const outcome = await retrySession.verifyAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(actor.currencyAdds).toEqual([1_500]);
    expect(actor.currencyCopper).toBe(1_500);
    expect(retryWitnesses).toEqual([]);
    expect(outcome.manifest.disposition).toBe("retain-all");
  });

  it("rejects canonical-looking target currency evidence with a different ledger", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const witness = await runItemsAndCurrency(sessionFor(fixture.acquisition), actor, fixture);
    if (!witness) throw new Error("Expected the first currency convergence to produce evidence.");
    const forged = createAcquisitionCurrencyConvergenceWitness({
      ...witness,
      ledgerDigest: "forged-ledger-digest",
    });
    const forgedAcquisition = recordAcquisitionCurrencyConvergenceWitness(fixture.acquisition, forged);
    const recoveryDraft = {
      ...fixture.draft,
      acquisition: forgedAcquisition,
      applyAttemptStepIds: ["starting-equipment-level-1"],
    };

    await expect(
      sessionFor(forgedAcquisition).executeAcquisitionItems({
        actor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/differs from the prepared acquisition/i);
    expect(actor.currencyAdds).toEqual([1_500]);
  });

  it("does not repeat a witnessed currency mutation after the actor total changes", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const witness = await runItemsAndCurrency(sessionFor(fixture.acquisition), actor, fixture);
    if (!witness) throw new Error("Expected the first currency convergence to produce evidence.");
    const recoveryAcquisition = recordAcquisitionCurrencyConvergenceWitness(fixture.acquisition, witness);
    const recoveryDraft = {
      ...fixture.draft,
      acquisition: recoveryAcquisition,
      applyAttemptStepIds: ["starting-equipment-level-1"],
    };
    actor.setExternalCurrency(1_400);

    await expect(
      sessionFor(recoveryAcquisition).executeAcquisitionItems({
        actor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
      })
    ).rejects.toThrow(/currency changed after the persisted acquisition convergence evidence/i);

    expect(actor.currencyAdds).toEqual([1_500]);
    expect(actor.currencyCopper).toBe(1_400);
  });

  it("converges currency to the absolute target and rejects a veto after rereading the aggregate", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition);
    await session.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await session.executeAcquisitionCurrency({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
      persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
    });
    expect(actor.currencyAdds).toEqual([1_400]);
    expect(actor.currencyCopper).toBe(1_400);

    const vetoActor = new FakeActor();
    vetoActor.currencyWriteMode = "veto";
    const vetoSession = sessionFor(fixture.acquisition);
    await vetoSession.executeAcquisitionItems({
      actor: vetoActor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    await expect(
      vetoSession.executeAcquisitionCurrency({
        actor: vetoActor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
        persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
      })
    ).rejects.toThrow(/did not converge/i);
    expect(vetoActor.currencyAdds).toEqual([1_400]);
    expect(vetoActor.currencyCopper).toBe(0);
  });

  it("captures exact convergence when PF2E mutates currency and then rejects", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    actor.currencyWriteMode = "mutate-then-throw";
    const session = sessionFor(fixture.acquisition);
    await session.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    const witnesses: AcquisitionCurrencyConvergenceWitnessV1[] = [];

    await expect(
      session.executeAcquisitionCurrency({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
        persistCurrencyConvergenceWitness: async (value) => {
          witnesses.push(value);
        },
      })
    ).rejects.toThrow(/mutated currency/i);

    expect(actor.currencyCopper).toBe(1_500);
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0]).toMatchObject({
      phase: "acquisition-currency",
      operation: "currency-convergence",
      boundary: "after",
      observedCopper: 1_500,
      targetCopper: 1_500,
      verifiedAt: NOW,
    });
  });

  it("does not capture convergence when PF2E rejects before mutating currency", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    actor.currencyWriteMode = "throw-before";
    const session = sessionFor(fixture.acquisition);
    await session.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });
    const witnesses: AcquisitionCurrencyConvergenceWitnessV1[] = [];

    await expect(
      session.executeAcquisitionCurrency({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: noCheckpoint,
        persistCurrencyConvergenceWitness: async (value) => {
          witnesses.push(value);
        },
      })
    ).rejects.toThrow(/did not converge/i);

    expect(actor.currencyCopper).toBe(0);
    expect(witnesses).toEqual([]);
  });

  it("aborts an item write when actor wealth changes during its before checkpoint", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition);

    await expect(
      session.executeAcquisitionItems({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: async (operation, boundary) => {
          if (operation === "embedded-item-create" && boundary === "before") actor.setExternalCurrency(25);
        },
      })
    ).rejects.toThrow(/changed after the embedded-item-create before-write checkpoint/i);

    expect(actor.addOptions).toEqual([]);
    expect(actor.currencyAdds).toEqual([]);
    expect(actor.currencyCopper).toBe(25);
  });

  it("aborts a relative currency write when actor wealth changes during its before checkpoint", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const session = sessionFor(fixture.acquisition);
    await session.executeAcquisitionItems({
      actor,
      draft: fixture.draft,
      classGrantPlan: fixture.classGrantPlan,
      emitWriteCheckpoint: noCheckpoint,
    });

    await expect(
      session.executeAcquisitionCurrency({
        actor,
        draft: fixture.draft,
        classGrantPlan: fixture.classGrantPlan,
        emitWriteCheckpoint: async (operation, boundary) => {
          if (operation === "currency-convergence" && boundary === "before") actor.setExternalCurrency(25);
        },
        persistCurrencyConvergenceWitness: ignoreCurrencyWitness,
      })
    ).rejects.toThrow(/changed after the currency-convergence before-write checkpoint/i);

    expect(actor.currencyAdds).toEqual([]);
    expect(actor.currencyCopper).toBe(25);
  });

  it("freshly rebuilds completed evidence for final-state recovery", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const applySession = sessionFor(fixture.acquisition);
    await runItemsAndCurrency(applySession, actor, fixture);
    const recoveryDraft = { ...fixture.draft, applyRecoveryActorUpdate: { "system.details.level.value": 1 } };
    const recoverySession = sessionFor(fixture.acquisition, { lastAppliedAt: NOW, lastTargetLevel: 1 });

    const outcome = await recoverySession.prepareRecoveredAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(outcome.manifest.currency.observedCopper).toBe(1_400);
    expect(outcome.manifest.entries[0]?.observedItems).toHaveLength(1);
    expect(actor.addOptions).toHaveLength(1);
  });

  it("returns an exact persisted manifest only after freshly verifying its actor outcome", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const applySession = sessionFor(fixture.acquisition);
    await runItemsAndCurrency(applySession, actor, fixture);
    const applied = await verify(applySession, actor, fixture);
    const persisted = refingerprintManifest(applied.manifest, {
      appliedBy: { userId: "original-owner", userName: "Original Owner" },
      appliedAt: "2026-08-19T11:00:00.000Z",
      environment: { ...ENVIRONMENT, moduleVersion: "0.7.5" },
    });
    const recoveryDraft = { ...fixture.draft, applyRecoveryActorUpdate: { "system.details.level.value": 1 } };
    const recoverySession = sessionFor(fixture.acquisition, {
      lastAppliedAt: NOW,
      lastTargetLevel: 1,
      completedManifest: persisted,
    });

    const outcome = await recoverySession.prepareRecoveredAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(outcome.manifest).toEqual(persisted);
  });

  it("accepts already-converged retain-all currency only with its exact persisted manifest", async () => {
    const fixture = reviewedFixture([], "retain-all");
    const actor = new FakeActor();
    const applySession = sessionFor(fixture.acquisition);
    await runItemsAndCurrency(applySession, actor, fixture);
    const applied = await verify(applySession, actor, fixture);
    const recoveryDraft = { ...fixture.draft, applyRecoveryActorUpdate: { "system.details.level.value": 1 } };
    const recoverySession = sessionFor(fixture.acquisition, {
      lastAppliedAt: NOW,
      lastTargetLevel: 1,
      completedManifest: applied.manifest,
    });

    const outcome = await recoverySession.prepareRecoveredAcquisitionOutcome({
      actor,
      draft: recoveryDraft,
      classGrantPlan: fixture.classGrantPlan,
      finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
    });

    expect(actor.currencyAdds).toEqual([1_500]);
    expect(outcome.manifest).toEqual(applied.manifest);
  });

  it("rejects a different completed manifest during recovery", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const applySession = sessionFor(fixture.acquisition);
    await runItemsAndCurrency(applySession, actor, fixture);
    const applied = await verify(applySession, actor, fixture);
    const different = refingerprintManifest(applied.manifest, { id: "manifest-other" });
    const recoveryDraft = { ...fixture.draft, applyAttemptStepIds: ["starting-equipment-level-1"] };
    const recoverySession = sessionFor(fixture.acquisition, { completedManifest: different });

    await expect(
      recoverySession.prepareRecoveredAcquisitionOutcome({
        actor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
      })
    ).rejects.toThrow(/another actor, draft, batch, or manifest/i);
  });

  it("rejects corrupt completed acquisition evidence during recovery", async () => {
    const fixture = reviewedFixture([line()]);
    const actor = new FakeActor();
    const applySession = sessionFor(fixture.acquisition);
    await runItemsAndCurrency(applySession, actor, fixture);
    const applied = await verify(applySession, actor, fixture);
    const recoveryDraft = { ...fixture.draft, applyAttemptStepIds: ["starting-equipment-level-1"] };
    const recoverySession = sessionFor(fixture.acquisition, {
      completedManifest: applied.manifest,
      completedManifestCorrupt: true,
    });

    await expect(
      recoverySession.prepareRecoveredAcquisitionOutcome({
        actor,
        draft: recoveryDraft,
        classGrantPlan: fixture.classGrantPlan,
        finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
      })
    ).rejects.toThrow(/corrupt completed acquisition evidence/i);
  });

  it.each(PERSISTED_RELOAD_CASES)("reload-converges the persisted $id boundary without duplicate wealth", async ({
    id,
    checkpointId,
    currencyMode,
    intermediate,
  }) => {
    const fixture = reviewedFixture([
      line({ lineId: "line-a", sourceUuid: sourceUuid("a"), priceFingerprint: "price-a" }),
      line({ lineId: "line-b", sourceUuid: sourceUuid("b"), priceFingerprint: "price-b" }),
    ]);
    const lockedDraft = structuredClone(fixture.draft);
    lockedDraft.applyAttemptStepIds = ["starting-equipment-level-1"];
    const firstActor = new FakeActor();
    firstActor.seedWayfinderFlags(lockedDraft, createEmptyState());
    firstActor.currencyWriteMode = currencyMode;
    let failure: DraftApplyPhaseError | null = null;

    try {
      await executePersistedAcquisitionAttempt(firstActor, lockedDraft, fixture.classGrantPlan, checkpointId);
    } catch (error) {
      expect(error).toBeInstanceOf(DraftApplyPhaseError);
      failure = error as DraftApplyPhaseError;
    }
    expect(failure).not.toBeNull();
    expect(failure?.checkpoint?.checkpointId).toBe(
      id === "currency-mutate-then-throw" ? "write:currency-convergence:before" : checkpointId
    );
    expect(firstActor.acquisitionItems()).toHaveLength(intermediate.items);
    expect(firstActor.currencyCopper).toBe(intermediate.copper);
    expect(!!firstActor.getPersistedDraft()?.acquisition?.currencyConvergenceWitness).toBe(intermediate.witnessed);
    expect(firstActor.getWayfinderState().completedAcquisitionManifest !== null).toBe(intermediate.completed);

    const reopenedActor = firstActor.reopen();
    expect(reopenedActor).not.toBe(firstActor);
    expect(reopenedActor.items.contents).not.toBe(firstActor.items.contents);
    const reopenedDraft = reopenedActor.getPersistedDraft();
    if (id === "final-state-after") {
      expect(reopenedDraft).toBeNull();
    } else {
      expect(reopenedDraft).not.toBeNull();
      if (id === "final-state-before") {
        await finalizePersistedAcquisitionRecovery(
          reopenedActor,
          structuredClone(reopenedDraft!),
          fixture.classGrantPlan
        );
      } else {
        await executePersistedAcquisitionAttempt(
          reopenedActor,
          structuredClone(reopenedDraft!),
          fixture.classGrantPlan,
          null
        );
      }
    }

    const durableActor = reopenedActor.reopen();
    const durableState = durableActor.getWayfinderState();
    const manifest = durableState.completedAcquisitionManifest;
    expect(durableActor.getPersistedDraft()).toBeNull();
    expect(manifest).not.toBeNull();
    expect(manifest?.entries.flatMap((entry) => entry.observedItems)).toHaveLength(2);
    expect(durableActor.acquisitionItems()).toHaveLength(2);
    expect(new Set(durableActor.acquisitionItems().map((item) => acquisitionIdentity(item)?.plannedItemId)).size).toBe(
      2
    );
    expect(durableActor.currencyCopper).toBe(1_300);

    const totalWrites = addWriteCounts(writeCounts(firstActor), writeCounts(reopenedActor));
    expect(totalWrites).toEqual({
      itemWrites: 2,
      currencyWrites: 1,
      witnessWrites: 1,
      actorUpdateWrites: 1,
    });

    const secondFixture = reviewedFixture([line()], "purchase-ledger", [], {
      draftId: "draft-2",
      batchId: "batch-2",
      manifestId: "manifest-2",
    });
    const secondDraft = structuredClone(secondFixture.draft);
    secondDraft.applyAttemptStepIds = ["starting-equipment-level-1"];
    const writesBeforeSecond = writeCounts(durableActor);
    await expect(
      executePersistedAcquisitionAttempt(durableActor, secondDraft, secondFixture.classGrantPlan, null)
    ).rejects.toThrow(/prior or malformed acquisition history|completed acquisition/i);
    expect(writeCounts(durableActor)).toEqual(writesBeforeSecond);
    expect(durableActor.getWayfinderState().completedAcquisitionManifest).toEqual(manifest);
  });

  it.each([
    "foreign-item",
    "foreign-currency",
  ] as const)("keeps a persisted partial retry at zero writes after %s drift", async (drift) => {
    const fixture = reviewedFixture([
      line({ lineId: "line-a", sourceUuid: sourceUuid("a"), priceFingerprint: "price-a" }),
      line({ lineId: "line-b", sourceUuid: sourceUuid("b"), priceFingerprint: "price-b" }),
    ]);
    const lockedDraft = structuredClone(fixture.draft);
    lockedDraft.applyAttemptStepIds = ["starting-equipment-level-1"];
    const firstActor = new FakeActor();
    firstActor.seedWayfinderFlags(lockedDraft, createEmptyState());

    await expect(
      executePersistedAcquisitionAttempt(
        firstActor,
        lockedDraft,
        fixture.classGrantPlan,
        "write:embedded-item-create:after"
      )
    ).rejects.toBeInstanceOf(DraftApplyPhaseError);
    const reopenedActor = firstActor.reopen();
    if (drift === "foreign-item") {
      reopenedActor.addObservedItem({
        id: "foreign-item",
        type: "equipment",
        sourceId: sourceUuid("foreign"),
        physical: true,
      });
    } else {
      reopenedActor.setExternalCurrency(25);
    }
    const writesBeforeRetry = writeCounts(reopenedActor);
    const persistedDraft = reopenedActor.getPersistedDraft();
    if (!persistedDraft) throw new Error("The partial retry draft did not survive reload.");

    await expect(
      executePersistedAcquisitionAttempt(reopenedActor, persistedDraft, fixture.classGrantPlan, null)
    ).rejects.toThrow(/foreign physical items|nonzero currency|economic admission/i);
    expect(writeCounts(reopenedActor)).toEqual(writesBeforeRetry);
    expect(reopenedActor.getPersistedDraft()).toEqual(persistedDraft);
    expect(reopenedActor.getWayfinderState().completedAcquisitionManifest).toBeNull();
  });
});

type ReviewedFixture = ReturnType<typeof reviewedFixture>;

function reviewedFixture(
  lines: readonly AcquisitionLineDraft[],
  disposition: "purchase-ledger" | "retain-all" = "purchase-ledger",
  plannedClassGrants: readonly PlannedClassGrantV1[] = [],
  identity: { readonly draftId: string; readonly batchId: string; readonly manifestId: string } = {
    draftId: "draft-1",
    batchId: "batch-1",
    manifestId: "manifest-1",
  }
) {
  const baseline = createEconomicBaseline({
    actorId: "actor-1",
    capturedAt: NOW,
    currencyCopper: 0,
    physicalItems: [],
  });
  const policySnapshot = policy(baseline, identity.draftId);
  const draftBase = createAcquisitionDraft({
    ...identity,
    targetLevel: 1,
    recipe: { kind: "permanent-items" },
  });
  const unreviewed: AcquisitionDraftState = {
    ...draftBase,
    policySnapshot,
    baseline,
    plannedClassGrants: [...plannedClassGrants],
    lines: [...lines],
  };
  const classGrantPlan = createPreparedClassGrantPlan({
    actorId: "actor-1",
    draftId: unreviewed.draftId,
    batchId: unreviewed.batchId,
    targetLevel: 1,
    grants: plannedClassGrants,
  });
  const ledger = evaluateAcquisitionLedger(unreviewed, classGrantPlan);
  if (!ledger.valid) throw new Error(ledger.blockers.map((entry) => entry.message).join("; "));
  const acquisition =
    disposition === "retain-all"
      ? reviewRetainAll(unreviewed, ledger, { userId: "owner-1", reviewedAt: NOW })
      : reviewPurchaseLedger(unreviewed, ledger, { userId: "owner-1", reviewedAt: NOW });
  return {
    acquisition,
    classGrantPlan,
    draft: { ...createEmptyDraft(1), acquisition },
  };
}

function handoffFixture(actor: FakeActor) {
  const baseline = actorBaseline(actor);
  const policySnapshot = policy(baseline);
  const draftBase = createAcquisitionDraft({
    draftId: "draft-1",
    batchId: "batch-1",
    manifestId: "manifest-1",
    targetLevel: 1,
    recipe: { kind: "permanent-items" },
  });
  const acquisition: AcquisitionDraftState = {
    ...draftBase,
    policySnapshot,
    baseline,
    lines: [],
    disposition: {
      kind: "handoff",
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: baseline.fingerprint,
        reasons: [{ code: "nonzero-currency", copper: baseline.currencyCopper }],
      },
      acknowledgedByUserId: "owner-1",
      acknowledgedAt: NOW,
    },
  };
  const classGrantPlan = createPreparedClassGrantPlan({
    actorId: "actor-1",
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: 1,
    grants: [],
  });
  return { acquisition, classGrantPlan, draft: { ...createEmptyDraft(1), acquisition } };
}

function configuredHandoffFixture(actor: FakeActor) {
  const inherited = handoffFixture(actor);
  const acquisition: AcquisitionDraftState = {
    ...inherited.acquisition,
    disposition: {
      kind: "handoff",
      handoff: {
        version: 1,
        kind: "pf2e-sheet",
        baselineFingerprint: inherited.acquisition.baseline!.fingerprint,
        reasons: [
          {
            code: "unsafe-configured-item",
            sourceUuid: "Compendium.pf2e.equipment-srd.Item.specific",
            itemName: "Chained Mist",
            issue: "specific-magic-item",
          },
        ],
      },
      acknowledgedByUserId: "owner-1",
      acknowledgedAt: NOW,
    },
  };
  return { ...inherited, acquisition, draft: { ...inherited.draft, acquisition } };
}

function policy(_baseline: ReturnType<typeof createEconomicBaseline>, draftId = "draft-1"): AcquisitionPolicySnapshot {
  return {
    version: 1,
    fingerprint: "policy-level-1",
    material: {
      subject: { actorId: "actor-1", draftId, targetLevel: 1 },
      numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
      semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
      resolvedRecipe: { kind: "permanent-items" },
      budgetCopper: 1_500,
      allowances: [],
      worldRecipePolicy: {
        enabledRecipes: ["permanent-items", "lump-sum"],
        defaultRecipe: "permanent-items",
      },
      sourcePolicy: {
        configuredPackFamilies: ["pf2e"],
        effectivePackIds: ["pf2e.equipment-srd"],
        enabledSourceSlugs: ["player-core"],
        knownSourceSlugs: ["player-core"],
        showEmptySources: false,
        showUnknownSources: false,
      },
      rarityPolicy: { blanketCeiling: "common" },
      authorityPolicy: {
        recipeChoice: "actor-owner",
        higherLevelStart: "gm-confirmation",
        apply: "actor-owner",
      },
      higherLevelStartEvidence: { kind: "not-required" },
      abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
      gmJudgments: [],
    },
  };
}

function line(overrides: Partial<AcquisitionLineDraft> = {}): AcquisitionLineDraft {
  const selectedSourceUuid = overrides.sourceUuid ?? sourceUuid("item");
  return {
    schemaVersion: 1,
    lineId: "line-1",
    sourceUuid: selectedSourceUuid,
    documentFingerprint: fingerprintEquipmentDocument(freshEmbeddedSource(selectedSourceUuid)),
    priceFingerprint: "price-1",
    itemLevel: 0,
    permanence: "permanent",
    componentKind: "baseline-item",
    policyDecision: {
      eligible: true,
      packId: "pf2e.equipment-srd",
      publicationSlug: "player-core",
      rarity: "common",
      sourceBasis: "approved-pack",
      rarityBasis: "common",
      characterAccessRef: null,
      sourceExceptionJudgmentId: null,
      rarityExceptionJudgmentId: null,
      abpTreatment: "unchanged",
    },
    funding: { lane: "currency" },
    stackingIntent: "aggregate",
    price: acquisitionPrice(),
    ...overrides,
  };
}

function kitLine(): AcquisitionLineDraft {
  const kitUuid = "Compendium.pf2e.equipment-srd.Item.2req0jGaxz8hScdB";
  const childUuids = [
    "Compendium.pf2e.equipment-srd.Item.3lgwjrFEsQVKzhh7",
    "Compendium.pf2e.equipment-srd.Item.fyYnQf1NAx9fWFaS",
    "Compendium.pf2e.equipment-srd.Item.VnPh324pKwd2ZB66",
    "Compendium.pf2e.equipment-srd.Item.xShIDyydOMkGvGNb",
    "Compendium.pf2e.equipment-srd.Item.UlIxxLm71UdRgCFE",
    "Compendium.pf2e.equipment-srd.Item.L9ZV076913otGtiB",
    "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS",
    "Compendium.pf2e.equipment-srd.Item.fagzYdmfYyMQ6J77",
    "Compendium.pf2e.equipment-srd.Item.81aHsD27HFGnq1Nt",
  ];
  const quantities = [1, 1, 1, 10, 1, 2, 5, 1, 1];
  const price = createAcquisitionPriceSnapshot({
    basePrice: { kind: "priced", value: { sp: 15 } },
    size: "small",
    sizeSensitive: false,
    preciousMaterial: false,
    adjustedBulkPriceCopper: null,
    configurationPriceCopper: 0,
    pricePer: 1,
    sourceQuantity: 1,
    requestedQuantity: 1,
  });
  if (price.ok === false) throw new Error(price.message);
  return line({
    sourceUuid: kitUuid,
    documentFingerprint: fingerprintEquipmentDocument(freshEmbeddedSource(kitUuid)),
    priceFingerprint: "adventurers-pack-price",
    stackingIntent: "separate",
    price: price.value,
    kitExpansion: {
      version: 1,
      profile: "adventurers-pack-v1",
      requestedQuantity: 1,
      items: childUuids.map((sourceUuid, index) => ({
        expansionPath: index === 0 ? "mca3x" : `mca3x/child-${index}`,
        parentPath: index === 0 ? null : "mca3x",
        sourceUuid,
        documentFingerprint: fingerprintEquipmentDocument({
          ...freshEmbeddedSource(sourceUuid),
          type: index === 0 ? "backpack" : "equipment",
        }),
        name: index === 0 ? "Backpack" : `Pack child ${index}`,
        itemType: index === 0 ? ("backpack" as const) : ("equipment" as const),
        quantity: quantities[index]!,
        size: "medium",
      })),
    },
  });
}

function acquisitionPrice(size: AcquisitionLineDraft["price"]["size"] = "medium") {
  const resolved = createAcquisitionPriceSnapshot({
    basePrice: { kind: "priced", value: { gp: 1 } },
    size,
    sizeSensitive: true,
    preciousMaterial: false,
    adjustedBulkPriceCopper: null,
    configurationPriceCopper: 0,
    pricePer: 1,
    sourceQuantity: 1,
    requestedQuantity: 1,
  });
  if (resolved.ok === false) throw new Error(resolved.message);
  return resolved.value;
}

function formulaGrant(): PlannedClassGrantV1 {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
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
}

function titanGrant(): PlannedClassGrantV1 {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:titan-mauler:class-branch-instinct-level-1",
    profileId: "giant-instinct-titan-mauler",
    origin: { sourceSlotId: "class-branch-instinct-level-1", sourceUuid: u.giantInstinct },
    granterSourceUuid: u.giantInstinct,
    expected: { sourceUuid: sourceUuid("weapon"), quantity: 1, itemType: "weapon" },
    materializer: "wayfinder-acquisition",
    eligibilityKind: "catalogue-choice",
    resaleRule: "zero-until-rune-investment",
    eligibilityEvidence: {
      kind: "titan-mauler",
      documentFingerprint: "titan-candidate-document",
      lineId: "line-titan",
      lineDocumentFingerprint: fingerprintEquipmentDocument(freshEmbeddedSource(sourceUuid("weapon"))),
      linePriceFingerprint: "titan-price",
      policyFingerprint: "policy-level-1",
      actorSize: "medium",
      targetSize: "large",
      basePriceCopper: 100,
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

function sessionFor(
  acquisition: AcquisitionDraftState,
  options: {
    readonly drift?: "source" | "document" | "price" | "resolved-price" | "policy" | "relabeled-source" | "kit-child";
    readonly currentPolicy?: AcquisitionPolicySnapshot;
    readonly events?: string[];
    readonly authorityError?: Error;
    readonly sourceHealthError?: Error;
    readonly lastAppliedAt?: string | null;
    readonly lastTargetLevel?: number | null;
    readonly completedManifest?: CompletedAcquisitionManifestV1 | null;
    readonly completedManifestCorrupt?: boolean;
    readonly manifestAppearsAfterFirstHistoryRead?: boolean;
    readonly readHistory?: AcquisitionExecutionDependencies["readHistory"];
  } = {}
) {
  let historyReads = 0;
  const dependencies: AcquisitionExecutionDependencies = {
    resolveSource: ({ entry }) => {
      options.events?.push("source");
      const policyDecision =
        options.drift === "policy" ? { ...entry.policyDecision, rarityBasis: "changed-policy" } : entry.policyDecision;
      const expandedSources = entry.kitExpansion?.items.map((item, index) => ({
        expansionPath: item.expansionPath,
        source:
          options.drift === "kit-child" && index === 1
            ? { ...freshEmbeddedSource(item.sourceUuid), type: item.itemType, name: "Drifted child" }
            : { ...freshEmbeddedSource(item.sourceUuid), type: item.itemType },
      }));
      return {
        source: freshEmbeddedSource(entry.sourceUuid, options.drift === "relabeled-source"),
        sourceUuid: options.drift === "source" ? `${entry.sourceUuid}.changed` : entry.sourceUuid,
        documentFingerprint:
          options.drift === "document" ? `${entry.documentFingerprint}-changed` : entry.documentFingerprint,
        priceFingerprint: options.drift === "price" ? `${entry.priceFingerprint}-changed` : entry.priceFingerprint,
        resolvedPrice: freshSourcePrice(entry, options.drift === "resolved-price"),
        policyDecision,
        ...(expandedSources ? { expandedSources } : {}),
      };
    },
    readHistory:
      options.readHistory ??
      (() => {
        historyReads += 1;
        return {
          lastAppliedAt: options.lastAppliedAt ?? null,
          lastTargetLevel: options.lastTargetLevel ?? null,
          completedAcquisitionManifest:
            options.manifestAppearsAfterFirstHistoryRead && historyReads > 1
              ? ({ id: "manifest-race" } as never)
              : (options.completedManifest ?? null),
          completedAcquisitionManifestCorrupt: options.completedManifestCorrupt ?? false,
        };
      }),
    resolveCurrentPolicySnapshot: () => {
      options.events?.push("policy");
      return options.currentPolicy ?? acquisition.policySnapshot!;
    },
    assertSourceHealth: () => {
      if (options.sourceHealthError) throw options.sourceHealthError;
    },
    assertApplyAuthority: () => {
      options.events?.push("authority");
      if (options.authorityError) throw options.authorityError;
    },
    readApplyingUser: () => ({ userId: "owner-1", userName: "Owner" }),
    readEnvironment: () => ENVIRONMENT,
    now: () => NOW,
  };
  return createAcquisitionExecutionSession(dependencies);
}

async function executePersistedAcquisitionAttempt(
  actor: FakeActor,
  draft: DraftState,
  classGrantPlan: PreparedClassGrantPlanV1,
  checkpointId: (typeof PERSISTED_RELOAD_CASES)[number]["checkpointId"]
): Promise<void> {
  const acquisition = draft.acquisition;
  if (!acquisition) throw new Error("The persisted acquisition attempt requires a draft.");
  const session = sessionFor(acquisition, {
    readHistory: () => {
      const state = actor.getWayfinderState();
      return {
        lastAppliedAt: state.lastAppliedAt,
        lastTargetLevel: state.lastTargetLevel,
        completedAcquisitionManifest: state.completedAcquisitionManifest,
        completedAcquisitionManifestCorrupt: state.completedAcquisitionManifestCorrupt,
      };
    },
  });
  const prepared = await prepareDraftApplication(actor as never, draft, [], {
    validateActorAuthority: () => true,
    assertAcquisitionApplyAuthority: () => undefined,
    prepareClassGrantPlan: () => recreatePreparedClassGrantPlan(classGrantPlan),
  });
  let injected = false;

  await executePreparedDraftApplication(prepared, {
    executeAcquisitionItems: session.executeAcquisitionItems,
    executeAcquisitionCurrency: session.executeAcquisitionCurrency,
    verifyAcquisitionOutcome: session.verifyAcquisitionOutcome,
    readCurrentAcquisitionHistory: session.readCurrentAcquisitionHistory,
    persistAcquisitionCurrencyConvergenceWitness: async (witness) => {
      actor.persistCurrencyConvergenceWitness(witness);
    },
    resolveFinalActorUpdate: (evidence) => {
      return completedActorUpdate(draft, evidence.acquisition);
    },
    persistFinalActorUpdate: (update) => actor.update(update),
    onCheckpoint: (checkpoint) => {
      if (!injected && checkpointId !== null && checkpoint.checkpointId === checkpointId) {
        injected = true;
        throw new Error(`Injected persisted reload at ${checkpointId}.`);
      }
    },
  });
}

async function finalizePersistedAcquisitionRecovery(
  actor: FakeActor,
  draft: DraftState,
  classGrantPlan: PreparedClassGrantPlanV1
): Promise<void> {
  const acquisition = draft.acquisition;
  if (!acquisition) throw new Error("The persisted acquisition recovery requires a draft.");
  const session = sessionFor(acquisition, {
    readHistory: () => {
      const state = actor.getWayfinderState();
      return {
        lastAppliedAt: state.lastAppliedAt,
        lastTargetLevel: state.lastTargetLevel,
        completedAcquisitionManifest: state.completedAcquisitionManifest,
        completedAcquisitionManifestCorrupt: state.completedAcquisitionManifestCorrupt,
      };
    },
  });
  await finalizeRecoveredDraftOnActor(actor as never, {
    recoveryActorUpdate: structuredClone(draft.applyRecoveryActorUpdate),
    validateActorAuthority: () => true,
    assertAcquisitionApplyAuthority: () => undefined,
    resolveFinalActorUpdate: (evidence) => completedActorUpdate(draft, evidence.acquisition),
    persistFinalActorUpdate: (update) => actor.update(update),
    classGrantRecovery: {
      kind: "required",
      preparePlan: () => recreatePreparedClassGrantPlan(classGrantPlan),
      verifyAcquisitionRecovery: ({ actor: recoveryActor, plan, finalClassGrantReconciliation }) =>
        session.prepareRecoveredAcquisitionOutcome({
          actor: recoveryActor,
          draft,
          classGrantPlan: plan,
          finalClassGrantReconciliation,
        }),
    },
  });
}

function recreatePreparedClassGrantPlan(plan: PreparedClassGrantPlanV1): PreparedClassGrantPlanV1 {
  return createPreparedClassGrantPlan({
    ...plan.subject,
    grants: plan.grants,
  });
}

function completedActorUpdate(
  draft: DraftState,
  evidence: Parameters<
    NonNullable<Parameters<typeof executePreparedDraftApplication>[1]["resolveFinalActorUpdate"]>
  >[0]["acquisition"]
): Record<string, unknown> {
  if (evidence.kind !== "completed") {
    throw new Error("The final acquisition update requires a completed manifest.");
  }
  return {
    [DRAFT_FLAG]: null,
    [STATE_FLAG]: {
      ...createEmptyState(),
      lastAppliedAt: evidence.manifest.appliedAt,
      lastTargetLevel: draft.targetLevel,
      completedStepIds: ["starting-equipment-level-1"],
      completedAcquisitionManifest: evidence.manifest,
    },
  };
}

interface AcquisitionWriteCounts {
  readonly itemWrites: number;
  readonly currencyWrites: number;
  readonly witnessWrites: number;
  readonly actorUpdateWrites: number;
}

function writeCounts(actor: FakeActor): AcquisitionWriteCounts {
  return {
    itemWrites: actor.addOptions.length,
    currencyWrites: actor.currencyAdds.length + actor.currencyRemovals.length,
    witnessWrites: actor.witnessWrites,
    actorUpdateWrites: actor.actorUpdateWrites,
  };
}

function addWriteCounts(...counts: readonly AcquisitionWriteCounts[]): AcquisitionWriteCounts {
  return counts.reduce(
    (total, current) => ({
      itemWrites: total.itemWrites + current.itemWrites,
      currencyWrites: total.currencyWrites + current.currencyWrites,
      witnessWrites: total.witnessWrites + current.witnessWrites,
      actorUpdateWrites: total.actorUpdateWrites + current.actorUpdateWrites,
    }),
    { itemWrites: 0, currencyWrites: 0, witnessWrites: 0, actorUpdateWrites: 0 }
  );
}

function refingerprintManifest(
  manifest: CompletedAcquisitionManifestV1,
  overrides: Partial<CompletedAcquisitionManifestV1>
): CompletedAcquisitionManifestV1 {
  const { fingerprint: _fingerprint, ...material } = {
    ...structuredClone(manifest),
    ...structuredClone(overrides),
  };
  return {
    ...material,
    fingerprint: computeCompletedAcquisitionManifestFingerprint(material),
  };
}

function freshEmbeddedSource(sourceId: string, relabeled = false): EmbeddedItemSource {
  const documentId = sourceId.split(".").at(-1)!;
  return {
    _id: relabeled ? `${documentId}-wrong` : documentId,
    name: `Item ${sourceId}`,
    type: sourceId === sourceUuid("weapon") ? "weapon" : "equipment",
    flags: { core: { sourceId: relabeled ? sourceUuid("wrong") : sourceId } },
    _stats: { compendiumSource: relabeled ? sourceUuid("wrong") : sourceId },
    system: { quantity: 1, containerId: null, size: "med" },
  };
}

function freshSourcePrice(
  entry: Parameters<AcquisitionExecutionDependencies["resolveSource"]>[0]["entry"],
  drift: boolean
) {
  const resolved = createAcquisitionPriceSnapshot({
    basePrice: structuredClone(entry.price.basePrice),
    size: "medium",
    sizeSensitive: entry.price.sizeSensitive,
    preciousMaterial: entry.price.preciousMaterial,
    adjustedBulkPriceCopper: entry.price.adjustedBulkPriceCopper,
    configurationPriceCopper: entry.price.configurationPriceCopper + (drift ? 1 : 0),
    pricePer: entry.price.pricePer,
    sourceQuantity: entry.price.sourceQuantity,
    requestedQuantity: entry.price.requestedQuantity,
  });
  if (resolved.ok === false) throw new Error(resolved.message);
  return resolved.value;
}

async function runItemsAndCurrency(
  session: ReturnType<typeof createAcquisitionExecutionSession>,
  actor: FakeActor,
  fixture: ReviewedFixture | ReturnType<typeof handoffFixture>
) {
  let witness: AcquisitionCurrencyConvergenceWitnessV1 | null = null;
  await session.executeAcquisitionItems({
    actor,
    draft: fixture.draft,
    classGrantPlan: fixture.classGrantPlan,
    emitWriteCheckpoint: noCheckpoint,
  });
  await session.executeAcquisitionCurrency({
    actor,
    draft: fixture.draft,
    classGrantPlan: fixture.classGrantPlan,
    emitWriteCheckpoint: noCheckpoint,
    persistCurrencyConvergenceWitness: async (value) => {
      witness = value;
    },
  });
  return witness;
}

function verify(
  session: ReturnType<typeof createAcquisitionExecutionSession>,
  actor: FakeActor,
  fixture: ReviewedFixture | ReturnType<typeof handoffFixture>
) {
  return session.verifyAcquisitionOutcome({
    actor,
    draft: fixture.draft,
    classGrantPlan: fixture.classGrantPlan,
    finalClassGrantReconciliation: finalReconciliation(actor, fixture.classGrantPlan),
  });
}

function finalReconciliation(actor: FakeActor, plan: ReviewedFixture["classGrantPlan"]) {
  return reconcilePreparedClassGrants({
    plan,
    actorItems: captureObservedClassGrantItems(actor),
    phase: "final",
  });
}

function checkpointRecorder(target: string[]) {
  return async (
    operation: "embedded-item-create" | "currency-convergence",
    boundary: "before" | "after",
    ordinal: number
  ) => {
    target.push(`${operation}:${boundary}:${ordinal}`);
  };
}

async function noCheckpoint(): Promise<void> {}

async function ignoreCurrencyWitness(_witness: AcquisitionCurrencyConvergenceWitnessV1): Promise<void> {}

function sourceUuid(id: string): string {
  return `Compendium.pf2e.equipment-srd.Item.${id}`;
}

function seedFormulaBookGrant(actor: FakeActor): FakeItem {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  actor.addObservedItem({
    id: "native-class",
    type: "class",
    sourceId: u.alchemistClass,
    wayfinderSlotId: "class-level-1",
  });
  actor.addObservedItem({
    id: "native-alchemy-feature",
    type: "feat",
    sourceId: u.alchemyFeature,
    locationItemId: "native-class",
  });
  actor.addObservedItem({
    id: "native-formula-feature",
    type: "feat",
    sourceId: u.formulaBookFeature,
    grantedByItemId: "native-alchemy-feature",
  });
  return actor.addObservedItem({
    id: "native-formula-book",
    type: "equipment",
    sourceId: u.formulaBookItem,
    physical: true,
    grantedByItemId: "native-formula-feature",
  });
}

function actorBaseline(actor: FakeActor) {
  if (actor.acquisitionItems().length > 0) throw new Error("The handoff fixture expects no physical items.");
  return createEconomicBaseline({
    actorId: actor.id,
    capturedAt: NOW,
    currencyCopper: actor.currencyCopper,
    physicalItems: [],
  });
}

interface FakeItem extends ActorItemLike {
  readonly id: string;
  readonly type: string;
  readonly sourceId: string | null;
  readonly quantity: number;
  readonly isCurrency: boolean;
  readonly assetValue?: { readonly copperValue: number };
  readonly flags: ActorItemFlags & Record<string, unknown>;
  readonly system: ItemSystemLike & {
    readonly quantity: number;
    readonly containerId: string | null;
    readonly category?: string;
    readonly size?: unknown;
  };
  readonly _source: {
    readonly system: {
      readonly quantity: number;
      readonly containerId: string | null;
      readonly size?: unknown;
      readonly price?: { readonly value: Record<string, number>; readonly per: number };
    };
  };
  readonly container: { readonly id: string } | null;
  readonly isOfType: (...types: string[]) => boolean;
}

class FakeActor {
  [key: string]: unknown;
  readonly id = "actor-1";
  readonly flags: Record<string, Record<string, unknown>> = {};
  readonly system: Record<string, unknown> = { details: { level: { value: 1 } } };
  readonly items: { contents: FakeItem[] } = { contents: [] };
  readonly addOptions: Array<{ stack: boolean; render: boolean }> = [];
  readonly addContainerIds: Array<string | null> = [];
  readonly addedSources: EmbeddedItemSource[] = [];
  readonly currencyAdds: number[] = [];
  readonly currencyRemovals: number[] = [];
  witnessWrites = 0;
  actorUpdateWrites = 0;
  readonly inventory: {
    currency: { copperValue: number };
    add: (source: EmbeddedItemSource, options: { stack: boolean; render: boolean }) => Promise<FakeItem[]>;
    get: (id: string) => FakeItem | undefined;
    addCurrency: (coins: { cp?: number }) => Promise<void>;
    removeCurrency: (coins: { cp?: number }) => Promise<void>;
  };
  itemWriteMode: "normal" | "veto" | "merged" | "wrong-size" = "normal";
  currencyWriteMode: "normal" | "veto" | "throw-before" | "mutate-then-throw" = "normal";
  failBeforeAddOrdinal: number | null = null;
  private addOrdinal = 0;
  private nextItemId = 1;

  constructor(currencyCopper = 0) {
    this.inventory = {
      currency: { copperValue: currencyCopper },
      add: async (source, options) => this.addItem(source, options),
      get: (id) => this.items.contents.find((item) => item.id === id),
      addCurrency: async (coins) => this.changeCurrency(coins.cp ?? 0),
      removeCurrency: async (coins) => this.changeCurrency(-(coins.cp ?? 0)),
    };
    this.syncCurrencyItem();
  }

  get currencyCopper(): number {
    return this.inventory.currency.copperValue;
  }

  setExternalCurrency(copper: number): void {
    this.inventory.currency.copperValue = copper;
    this.syncCurrencyItem();
  }

  acquisitionItems(): FakeItem[] {
    return this.items.contents.filter((item) => !item.isCurrency && item.isOfType("physical"));
  }

  seedWayfinderFlags(draft: DraftState | null, state: ModuleState): void {
    this.flags[MODULE_ID] = { draft: structuredClone(draft), state: structuredClone(state) };
  }

  getFlag(moduleId: string, key: string): unknown {
    return this.flags[moduleId]?.[key];
  }

  getPersistedDraft(): DraftState | null {
    const draft = this.getFlag(MODULE_ID, "draft");
    return draft ? structuredClone(draft as DraftState) : null;
  }

  getWayfinderState(): ModuleState {
    return structuredClone((this.getFlag(MODULE_ID, "state") as ModuleState | null) ?? createEmptyState());
  }

  persistCurrencyConvergenceWitness(witness: AcquisitionCurrencyConvergenceWitnessV1): void {
    this.witnessWrites += 1;
    const draft = this.getPersistedDraft();
    if (!draft?.acquisition) throw new Error("The currency witness requires a persisted acquisition draft.");
    draft.acquisition = recordAcquisitionCurrencyConvergenceWitness(draft.acquisition, witness);
    this.flags[MODULE_ID] = { ...(this.flags[MODULE_ID] ?? {}), draft };
  }

  reopen(): FakeActor {
    const reopened = new FakeActor(this.currencyCopper);
    reopened.items.contents.push(...this.acquisitionItems().map(cloneFakeItem));
    Object.assign(reopened.flags, structuredClone(this.flags));
    Object.assign(reopened.system, structuredClone(this.system));
    reopened.nextItemId = this.nextItemId;
    return reopened;
  }

  addObservedItem(args: {
    readonly id: string;
    readonly type: string;
    readonly sourceId: string;
    readonly physical?: boolean;
    readonly grantedByItemId?: string | null;
    readonly locationItemId?: string | null;
    readonly wayfinderSlotId?: string | null;
  }): FakeItem {
    const flags: ActorItemFlags & Record<string, unknown> = {
      core: { sourceId: args.sourceId },
    };
    if (args.grantedByItemId) flags.pf2e = { grantedBy: { id: args.grantedByItemId } };
    if (args.wayfinderSlotId) flags["wayfinder-pf2e"] = { slotId: args.wayfinderSlotId };
    const item: FakeItem = {
      id: args.id,
      type: args.type,
      sourceId: args.sourceId,
      quantity: 1,
      isCurrency: false,
      flags,
      system: { quantity: 1, containerId: null, location: args.locationItemId ?? null },
      _source: { system: { quantity: 1, containerId: null } },
      container: null,
      isOfType: (...types) => (args.physical === true && types.includes("physical")) || types.includes(args.type),
    };
    this.items.contents.push(item);
    return item;
  }

  async createEmbeddedDocuments(): Promise<never[]> {
    return [];
  }

  async deleteEmbeddedDocuments(): Promise<void> {}

  async updateEmbeddedDocuments(): Promise<void> {}

  async update(update: Record<string, unknown>): Promise<FakeActor> {
    this.actorUpdateWrites += 1;
    for (const [path, value] of Object.entries(update)) setPath(this, path, structuredClone(value));
    return this;
  }

  private async addItem(
    source: EmbeddedItemSource,
    options: { stack: boolean; render: boolean; container?: FakeItem }
  ): Promise<FakeItem[]> {
    this.addOrdinal += 1;
    if (this.failBeforeAddOrdinal === this.addOrdinal) throw new Error("Forced item failure.");
    this.addOptions.push({ stack: options.stack, render: options.render });
    this.addContainerIds.push(options.container?.id ?? null);
    this.addedSources.push(structuredClone(source));
    if (this.itemWriteMode === "veto") return [];
    const quantity = Number(source.system?.quantity ?? 0);
    const sourceId = String(source.flags?.core?.sourceId ?? "");
    const flags = structuredClone(source.flags ?? {});
    if (this.itemWriteMode === "merged") delete flags["wayfinder-pf2e"];
    const size = this.itemWriteMode === "wrong-size" ? "med" : source.system?.size;
    const containerId = options.container?.id ?? null;
    const item: FakeItem = {
      id: `item-${this.nextItemId++}`,
      type: String(source.type ?? "equipment"),
      sourceId,
      quantity,
      isCurrency: false,
      flags,
      system: { quantity, containerId, size },
      _source: { system: { quantity, containerId, size } },
      container: containerId ? { id: containerId } : null,
      isOfType: (...types) => types.includes("physical") || types.includes(String(source.type ?? "equipment")),
    };
    this.items.contents.push(item);
    return [item];
  }

  private async changeCurrency(delta: number): Promise<void> {
    if (delta >= 0) this.currencyAdds.push(delta);
    else this.currencyRemovals.push(-delta);
    if (this.currencyWriteMode === "throw-before") throw new Error("PF2E rejected before currency mutation.");
    if (this.currencyWriteMode === "veto") return;
    const next = this.currencyCopper + delta;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error("Invalid test currency.");
    this.inventory.currency.copperValue = next;
    this.syncCurrencyItem();
    if (this.currencyWriteMode === "mutate-then-throw") throw new Error("PF2E mutated currency and then rejected.");
  }

  private syncCurrencyItem(): void {
    this.items.contents = this.items.contents.filter((item) => !item.isCurrency);
    if (this.currencyCopper === 0) return;
    const quantity = this.currencyCopper;
    this.items.contents.push({
      id: "currency-cp",
      type: "treasure",
      sourceId: null,
      quantity,
      isCurrency: true,
      assetValue: { copperValue: quantity },
      flags: {},
      system: { quantity, containerId: null, category: "coin" },
      _source: {
        system: {
          quantity,
          containerId: null,
          price: { value: { cp: 1 }, per: 1 },
        },
      },
      container: null,
      isOfType: (...types) => types.includes("physical") || types.includes("treasure"),
    });
  }
}

function cloneFakeItem(item: FakeItem): FakeItem {
  const type = item.type;
  return {
    ...item,
    flags: structuredClone(item.flags),
    system: structuredClone(item.system),
    _source: structuredClone(item._source),
    container: item.container ? { id: item.container.id } : null,
    isOfType: (...types) => types.includes("physical") || types.includes(type),
  };
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

function acquisitionIdentity(item: FakeItem): Record<string, unknown> | null {
  const moduleFlags = item.flags["wayfinder-pf2e"];
  if (!moduleFlags || typeof moduleFlags !== "object" || Array.isArray(moduleFlags)) return null;
  const acquisition = (moduleFlags as { acquisition?: unknown }).acquisition;
  return acquisition && typeof acquisition === "object" && !Array.isArray(acquisition)
    ? (acquisition as Record<string, unknown>)
    : null;
}
