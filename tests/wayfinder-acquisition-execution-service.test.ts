import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { ActorItemFlags, ActorItemLike, EmbeddedItemSource, ItemSystemLike } from "../src/shared/actor-model";
import {
  type AcquisitionExecutionDependencies,
  createAcquisitionExecutionSession,
} from "../src/wayfinder/application/acquisition-execution-service";
import { captureObservedClassGrantItems } from "../src/wayfinder/application/class-grant-projection-service";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
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
  createPreparedClassGrantPlan,
  reconcilePreparedClassGrants,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

const NOW = "2026-08-19T12:00:00.000Z";
const ENVIRONMENT = { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.8.0" };

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
    expect(actor.addedSources[0]?.system).toMatchObject({ quantity: 2, containerId: null });
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

  it.each([
    "source",
    "document",
    "price",
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
        documentFingerprint: "doc-a",
        priceFingerprint: "price-a",
      }),
      line({
        lineId: "line-b",
        sourceUuid: sourceUuid("b"),
        documentFingerprint: "doc-b",
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
      })
    ).rejects.toThrow(/did not converge/i);
    expect(vetoActor.currencyAdds).toEqual([1_400]);
    expect(vetoActor.currencyCopper).toBe(0);
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
});

type ReviewedFixture = ReturnType<typeof reviewedFixture>;

function reviewedFixture(
  lines: readonly AcquisitionLineDraft[],
  disposition: "purchase-ledger" | "retain-all" = "purchase-ledger"
) {
  const baseline = createEconomicBaseline({
    actorId: "actor-1",
    capturedAt: NOW,
    currencyCopper: 0,
    physicalItems: [],
  });
  const policySnapshot = policy(baseline);
  const draftBase = createAcquisitionDraft({
    draftId: "draft-1",
    batchId: "batch-1",
    manifestId: "manifest-1",
    targetLevel: 1,
    recipe: { kind: "permanent-items" },
  });
  const unreviewed: AcquisitionDraftState = {
    ...draftBase,
    policySnapshot,
    baseline,
    lines: [...lines],
  };
  const classGrantPlan = createPreparedClassGrantPlan({
    actorId: "actor-1",
    draftId: unreviewed.draftId,
    batchId: unreviewed.batchId,
    targetLevel: 1,
    grants: [],
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

function policy(_baseline: ReturnType<typeof createEconomicBaseline>): AcquisitionPolicySnapshot {
  return {
    version: 1,
    fingerprint: "policy-level-1",
    material: {
      subject: { actorId: "actor-1", draftId: "draft-1", targetLevel: 1 },
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
  const resolved = createAcquisitionPriceSnapshot({
    basePrice: { kind: "priced", value: { gp: 1 } },
    size: "medium",
    sizeSensitive: true,
    preciousMaterial: false,
    adjustedBulkPriceCopper: null,
    configurationPriceCopper: 0,
    pricePer: 1,
    sourceQuantity: 1,
    requestedQuantity: 1,
  });
  if (resolved.ok === false) throw new Error(resolved.message);
  return {
    schemaVersion: 1,
    lineId: "line-1",
    sourceUuid: sourceUuid("item"),
    documentFingerprint: "document-1",
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
    price: resolved.value,
    ...overrides,
  };
}

function sessionFor(
  acquisition: AcquisitionDraftState,
  options: {
    readonly drift?: "source" | "document" | "price" | "policy";
    readonly currentPolicy?: AcquisitionPolicySnapshot;
    readonly events?: string[];
    readonly authorityError?: Error;
    readonly lastAppliedAt?: string | null;
    readonly lastTargetLevel?: number | null;
  } = {}
) {
  const dependencies: AcquisitionExecutionDependencies = {
    resolveSource: ({ entry }) => {
      options.events?.push("source");
      const policyDecision =
        options.drift === "policy" ? { ...entry.policyDecision, rarityBasis: "changed-policy" } : entry.policyDecision;
      return {
        source: {
          _id: "compendium-id",
          name: `Item ${entry.sourceUuid}`,
          type: "equipment",
          flags: { core: { sourceId: entry.sourceUuid } },
          system: { quantity: 1, containerId: null },
        },
        sourceUuid: options.drift === "source" ? `${entry.sourceUuid}.changed` : entry.sourceUuid,
        documentFingerprint:
          options.drift === "document" ? `${entry.documentFingerprint}-changed` : entry.documentFingerprint,
        priceFingerprint: options.drift === "price" ? `${entry.priceFingerprint}-changed` : entry.priceFingerprint,
        policyDecision,
      };
    },
    readHistory: () => ({
      lastAppliedAt: options.lastAppliedAt ?? null,
      lastTargetLevel: options.lastTargetLevel ?? null,
      completedAcquisitionManifest: null,
      completedAcquisitionManifestCorrupt: false,
    }),
    resolveCurrentPolicySnapshot: () => {
      options.events?.push("policy");
      return options.currentPolicy ?? acquisition.policySnapshot!;
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

async function runItemsAndCurrency(
  session: ReturnType<typeof createAcquisitionExecutionSession>,
  actor: FakeActor,
  fixture: ReviewedFixture | ReturnType<typeof handoffFixture>
) {
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
  });
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

function sourceUuid(id: string): string {
  return `Compendium.pf2e.equipment-srd.Item.${id}`;
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
  };
  readonly _source: {
    readonly system: {
      readonly quantity: number;
      readonly containerId: string | null;
      readonly price?: { readonly value: Record<string, number>; readonly per: number };
    };
  };
  readonly container: null;
  readonly isOfType: (...types: string[]) => boolean;
}

class FakeActor {
  [key: string]: unknown;
  readonly id = "actor-1";
  readonly items: { contents: FakeItem[] } = { contents: [] };
  readonly addOptions: Array<{ stack: boolean; render: boolean }> = [];
  readonly addedSources: EmbeddedItemSource[] = [];
  readonly currencyAdds: number[] = [];
  readonly currencyRemovals: number[] = [];
  readonly inventory: {
    currency: { copperValue: number };
    add: (source: EmbeddedItemSource, options: { stack: boolean; render: boolean }) => Promise<FakeItem[]>;
    addCurrency: (coins: { cp?: number }) => Promise<void>;
    removeCurrency: (coins: { cp?: number }) => Promise<void>;
  };
  itemWriteMode: "normal" | "veto" | "merged" = "normal";
  currencyWriteMode: "normal" | "veto" = "normal";
  failBeforeAddOrdinal: number | null = null;
  private addOrdinal = 0;
  private nextItemId = 1;

  constructor(currencyCopper = 0) {
    this.inventory = {
      currency: { copperValue: currencyCopper },
      add: async (source, options) => this.addItem(source, options),
      addCurrency: async (coins) => this.changeCurrency(coins.cp ?? 0),
      removeCurrency: async (coins) => this.changeCurrency(-(coins.cp ?? 0)),
    };
    this.syncCurrencyItem();
  }

  get currencyCopper(): number {
    return this.inventory.currency.copperValue;
  }

  acquisitionItems(): FakeItem[] {
    return this.items.contents.filter((item) => !item.isCurrency);
  }

  async createEmbeddedDocuments(): Promise<never[]> {
    return [];
  }

  async deleteEmbeddedDocuments(): Promise<void> {}

  async updateEmbeddedDocuments(): Promise<void> {}

  private async addItem(source: EmbeddedItemSource, options: { stack: boolean; render: boolean }): Promise<FakeItem[]> {
    this.addOrdinal += 1;
    if (this.failBeforeAddOrdinal === this.addOrdinal) throw new Error("Forced item failure.");
    this.addOptions.push({ ...options });
    this.addedSources.push(structuredClone(source));
    if (this.itemWriteMode === "veto") return [];
    const quantity = Number(source.system?.quantity ?? 0);
    const sourceId = String(source.flags?.core?.sourceId ?? "");
    const flags = structuredClone(source.flags ?? {});
    if (this.itemWriteMode === "merged") delete flags["wayfinder-pf2e"];
    const item: FakeItem = {
      id: `item-${this.nextItemId++}`,
      type: String(source.type ?? "equipment"),
      sourceId,
      quantity,
      isCurrency: false,
      flags,
      system: { quantity, containerId: null },
      _source: { system: { quantity, containerId: null } },
      container: null,
      isOfType: (...types) => types.includes("physical") || types.includes(String(source.type ?? "equipment")),
    };
    this.items.contents.push(item);
    return [item];
  }

  private async changeCurrency(delta: number): Promise<void> {
    if (delta >= 0) this.currencyAdds.push(delta);
    else this.currencyRemovals.push(-delta);
    if (this.currencyWriteMode === "veto") return;
    const next = this.currencyCopper + delta;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error("Invalid test currency.");
    this.inventory.currency.copperValue = next;
    this.syncCurrencyItem();
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

function acquisitionIdentity(item: FakeItem): Record<string, unknown> | null {
  const moduleFlags = item.flags["wayfinder-pf2e"];
  if (!moduleFlags || typeof moduleFlags !== "object" || Array.isArray(moduleFlags)) return null;
  const acquisition = (moduleFlags as { acquisition?: unknown }).acquisition;
  return acquisition && typeof acquisition === "object" && !Array.isArray(acquisition)
    ? (acquisition as Record<string, unknown>)
    : null;
}
