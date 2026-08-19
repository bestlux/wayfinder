import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import { prepareAcquisitionIdentityPlan } from "../src/wayfinder/domain/acquisition-identity";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionLedger,
  reviewPurchaseLedger,
  reviewRetainAll,
} from "../src/wayfinder/domain/acquisition-ledger";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import {
  createPreparedClassGrantPlan,
  reconcilePreparedClassGrants,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createCompletedAcquisitionManifest } from "../src/wayfinder/domain/completed-acquisition-manifest";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";
import {
  acquisitionDefinitionFingerprint,
  acquisitionSmokeCases,
  LEVEL_ONE_DAGGER,
  validateAcquisitionSmokeCaseDefinition,
} from "../tools/foundry-smoke/acquisition-cases.mjs";
import {
  createExclusiveAcquisitionTracerArtifactDirectory,
  writeAcquisitionTracerArtifacts,
} from "../tools/foundry-smoke/acquisition-tracer-artifacts.mjs";
import {
  parseApplyCheckpointId,
  qualifySmokeResult,
  SMOKE_EVIDENCE_SCHEMA_VERSION,
} from "../tools/foundry-smoke/evidence-contract.mjs";

const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");
const runner = readFileSync(resolve("tools/foundry-smoke/run-acquisition-tracer.mjs"), "utf8");

describe("Foundry Wave-2 acquisition tracer", () => {
  it("pins purchase, retain-all, and retry cases to the current PF2E Dagger identity", () => {
    expect(acquisitionSmokeCases.map((smokeCase) => smokeCase.id)).toEqual([
      "equipment-l1-owner-common-purchase",
      "equipment-l1-owner-retain-all",
      "equipment-l1-owner-common-purchase-retry",
    ]);
    expect(LEVEL_ONE_DAGGER).toMatchObject({
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
      itemType: "weapon",
      level: 0,
      rarity: "common",
      publication: "Pathfinder Player Core",
      unitPriceCopper: 20,
      sourceQuantity: 1,
      rulesCount: 0,
    });
    for (const smokeCase of acquisitionSmokeCases) {
      expect(validateAcquisitionSmokeCaseDefinition(smokeCase)).toEqual([]);
      expect(smokeCase.definitionFingerprint).toBe(acquisitionDefinitionFingerprint(smokeCase));
      expect(smokeCase.acquisitionCase.policyReview).toEqual({ required: false, reviewerRole: "gm" });
    }
    const retry = acquisitionSmokeCases[2];
    expect(retry.acquisitionCase.expectedEntries[0]).toMatchObject({ quantity: 2, stackingIntent: "aggregate" });
    expect(retry.acquisitionCase.failure).toEqual({
      checkpointId: "write:embedded-item-create:after",
      occurrence: 1,
      expectedPoint: "item-after",
    });
  });

  it("maps acquisition write checkpoints only to their owning prepared-Apply phases", () => {
    expect(parseApplyCheckpointId("write:embedded-item-create:after")).toEqual({
      checkpointId: "write:embedded-item-create:after",
      kind: "write",
      phase: "acquisition-items",
      boundary: "after",
      operation: "embedded-item-create",
    });
    expect(parseApplyCheckpointId("write:currency-convergence:before")).toEqual({
      checkpointId: "write:currency-convergence:before",
      kind: "write",
      phase: "acquisition-currency",
      boundary: "before",
      operation: "currency-convergence",
    });
    expect(parseApplyCheckpointId("write:final-actor-update:after")?.phase).toBe("finalize-actor");
    expect(parseApplyCheckpointId("write:embedded-item-create:during")).toBeNull();
    expect(parseApplyCheckpointId("write:unknown:after")).toBeNull();
  });

  it("qualifies a simple Common purchase from a canonical production manifest", async () => {
    const definition = acquisitionSmokeCases[0];
    const result = qualifySmokeResult(await purchaseResult(definition), [definition]);

    expect(result.qualification).toMatchObject({ passed: true, unreviewedFindingCount: 0 });
    expect(findingCodes(result)).toEqual([]);
  });

  it("qualifies a real-manifest item failure followed by forward-idempotent retry", async () => {
    const definition = acquisitionSmokeCases[2];
    const result = qualifySmokeResult(await retryResult(definition), [definition]);

    expect(result.qualification).toMatchObject({ passed: true, unreviewedFindingCount: 0 });
    expect(findingCodes(result)).toEqual([]);
  });

  it("cross-links before-currency, after-currency, and final-write failures to retry semantics", async () => {
    const variants = [
      {
        checkpoint: writeCheckpoint("currency-convergence", "before", 1),
        point: "currency-before",
        observedCurrencyCopper: 0,
        manifestId: null,
        draftPresent: true,
        retryCheckpoints: [
          writeCheckpoint("currency-convergence", "before", 1),
          writeCheckpoint("currency-convergence", "after", 1),
          writeCheckpoint("final-actor-update", "before", 1),
          writeCheckpoint("final-actor-update", "after", 1),
        ],
      },
      {
        checkpoint: writeCheckpoint("currency-convergence", "after", 1),
        point: "currency-after",
        observedCurrencyCopper: 1460,
        manifestId: null,
        draftPresent: true,
        retryCheckpoints: [
          writeCheckpoint("final-actor-update", "before", 1),
          writeCheckpoint("final-actor-update", "after", 1),
        ],
      },
      {
        checkpoint: writeCheckpoint("final-actor-update", "after", 1),
        point: "final-state-after",
        observedCurrencyCopper: 1460,
        manifestId: "manifest-id",
        draftPresent: false,
        retryCheckpoints: [],
      },
    ];

    for (const variant of variants) {
      const definition = structuredClone(acquisitionSmokeCases[2]) as any;
      definition.acquisitionCase.failure = {
        checkpointId: variant.checkpoint.checkpointId,
        occurrence: 1,
        expectedPoint: variant.point,
      };
      definition.definitionFingerprint = acquisitionDefinitionFingerprint(definition);
      const input = await retryResult(definition);
      Object.assign(input.cases[0].evidence.acquisition.failureSnapshot, {
        checkpoint: variant.checkpoint,
        point: variant.point,
        afterItemIndex: null,
        currencyOperationIndex: variant.point === "currency-after" ? 1 : null,
        observedCurrencyCopper: variant.observedCurrencyCopper,
        manifestId: variant.manifestId,
        draftPresent: variant.draftPresent,
      });
      Object.assign(input.cases[0].evidence.acquisition.retry, {
        draftPresentBeforeRetry: variant.draftPresent,
        preRetryCurrencyCopper: variant.observedCurrencyCopper,
        checkpoints: variant.retryCheckpoints,
      });

      const result = qualifySmokeResult(input, [definition]);
      expect(findingCodes(result), variant.point).toEqual([]);
      expect(result.qualification.passed, variant.point).toBe(true);
    }
  });

  it("rejects duplicate retry writes, runtime drift, missing durability, and a second currency charge", async () => {
    const definition = acquisitionSmokeCases[2];
    const duplicateWrite = await retryResult(definition);
    duplicateWrite.cases[0].evidence.acquisition.retry.checkpoints.push(
      writeCheckpoint("currency-convergence", "after", 1)
    );
    const wrongRuntime = await retryResult(definition);
    wrongRuntime.cases[0].evidence.acquisition.binding.runtime.pf2eVersion = "8.3.0";
    const retainedDraft = await retryResult(definition);
    retainedDraft.cases[0].actor.moduleDraftAfterApply = { acquisition: { batchId: "batch-id" } };
    const secondCharge = await retryResult(definition);
    secondCharge.cases[0].actor.currencyCopper = 1420;
    secondCharge.cases[0].evidence.acquisition.currency.observedCopper = 1420;
    secondCharge.cases[0].evidence.acquisition.retry.postRetryCurrencyCopper = 1420;

    expect(findingCodes(qualifySmokeResult(duplicateWrite, [definition]))).toContain(
      "acquisition-retry-write-sequence-mismatch"
    );
    expect(findingCodes(qualifySmokeResult(wrongRuntime, [definition]))).toContain("acquisition-case-binding-mismatch");
    expect(findingCodes(qualifySmokeResult(retainedDraft, [definition]))).toEqual(
      expect.arrayContaining(["acquisition-manifest-not-durable", "acquisition-retry-state-mismatch"])
    );
    expect(findingCodes(qualifySmokeResult(secondCharge, [definition]))).toEqual(
      expect.arrayContaining(["currency-target-mismatch", "acquisition-case-currency-mismatch"])
    );
  });

  it("qualifies retain-all only with zero entries, exact budget, and a durable manifest", async () => {
    const definition = acquisitionSmokeCases[1];
    const valid = qualifySmokeResult(await retainAllResult(definition), [definition]);
    expect(valid.qualification.passed).toBe(true);

    const forged = await retainAllResult(definition);
    forged.cases[0].evidence.acquisition.manifest.entries.push(productionEntry());
    forged.cases[0].actor.moduleStateAfterApply.completedAcquisitionManifest =
      forged.cases[0].evidence.acquisition.manifest;
    const invalid = qualifySmokeResult(forged, [definition]);
    expect(findingCodes(invalid)).toContain("acquisition-case-entry-mismatch");
  });

  it("uses guarded GM setup, a distinct player context, actual actor collection, and GM cleanup", () => {
    expect(browserSuite).toContain("globalThis.__prepareWayfinderAcquisitionTracer");
    expect(browserSuite).toContain("globalThis.__runWayfinderAcquisitionTracer");
    expect(browserSuite).toContain("globalThis.__cleanupWayfinderAcquisitionTracer");
    expect(browserSuite).toContain("globalThis.__wayfinderAcquisitionSmokeDriver");
    expect(browserSuite).toContain("completedAcquisitionManifest");
    expect(browserSuite).toContain("onFailure: async (error) =>");
    expect(browserSuite).toContain("onRetryCheckpoint: (checkpoint) =>");
    expect(runner.match(/browser\.newContext\(/gu)).toHaveLength(2);
    expect(runner.indexOf("await playerContext.close();")).toBeLessThan(
      runner.indexOf("globalThis.__cleanupWayfinderAcquisitionTracer")
    );
    expect(runner).toContain("qualifySmokeResult(result, cases)");
    expect(runner).not.toContain("console.error(error)");
  });

  it("publishes one immutable hash-bound acquisition evidence directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "wayfinder-acquisition-tracer-"));
    try {
      const outDir = await createExclusiveAcquisitionTracerArtifactDirectory(temporaryRoot, "evidence", "evidence-id");
      await expect(
        createExclusiveAcquisitionTracerArtifactDirectory(temporaryRoot, "evidence", "other-id")
      ).rejects.toThrow();
      const result = {
        evidenceId: "evidence-id",
        qualification: { passed: true },
        caseDefinitionFingerprints: [
          { caseId: acquisitionSmokeCases[0].id, fingerprint: acquisitionSmokeCases[0].definitionFingerprint },
        ],
        foundryVersion: "14.366",
        pf2eVersion: "8.4.1",
        moduleVersion: "0.8.0",
      };
      const markdown = "# Acquisition tracer\n";
      const completion = await writeAcquisitionTracerArtifacts(outDir, result, markdown);
      const resultBytes = await readFile(join(outDir, "acquisition-tracer-results.json"), "utf8");
      const summaryBytes = await readFile(join(outDir, "acquisition-tracer-summary.md"), "utf8");
      expect(completion).toMatchObject({
        evidenceId: "evidence-id",
        qualified: true,
        foundryVersion: "14.366",
        pf2eVersion: "8.4.1",
        moduleVersion: "0.8.0",
        resultSha256: sha256(resultBytes),
        summarySha256: sha256(summaryBytes),
      });
      await expect(writeAcquisitionTracerArtifacts(outDir, result, markdown)).rejects.toThrow();
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

async function purchaseResult(definition: (typeof acquisitionSmokeCases)[number]): Promise<any> {
  const manifest = await productionManifest(definition);
  return baseResult(definition, manifest, [daggerItem(manifest)], manifest.currency.observedCopper);
}

async function retryResult(definition: (typeof acquisitionSmokeCases)[number]): Promise<any> {
  const manifest = await productionManifest(definition);
  const result = baseResult(definition, manifest, [daggerItem(manifest)], manifest.currency.observedCopper);
  result.cases[0].evidence.acquisition.failureSnapshot = {
    checkpoint: writeCheckpoint("embedded-item-create", "after", 1),
    point: "item-after",
    batchId: "batch-id",
    afterItemIndex: 1,
    currencyOperationIndex: null,
    message: "Intentional failure at write:embedded-item-create:after.",
    actualItemIds: ["dagger-item"],
    observedCurrencyCopper: 0,
    manifestId: null,
    draftPresent: true,
  };
  result.cases[0].evidence.acquisition.retry = {
    attempted: true,
    converged: true,
    batchId: "batch-id",
    manifestId: "manifest-id",
    draftPresentBeforeRetry: true,
    draftClearedAfterRetry: true,
    preRetryItemIds: ["dagger-item"],
    postRetryItemIds: ["dagger-item"],
    preRetryCurrencyCopper: 0,
    postRetryCurrencyCopper: 1460,
    checkpoints: [
      writeCheckpoint("currency-convergence", "before", 1),
      writeCheckpoint("currency-convergence", "after", 1),
      writeCheckpoint("final-actor-update", "before", 1),
      writeCheckpoint("final-actor-update", "after", 1),
    ],
  };
  return result;
}

async function retainAllResult(definition: (typeof acquisitionSmokeCases)[number]): Promise<any> {
  const manifest = await productionManifest(definition);
  return baseResult(definition, manifest, [], manifest.currency.observedCopper);
}

function baseResult(
  definition: (typeof acquisitionSmokeCases)[number],
  manifest: any,
  items: any[],
  currencyCopper: number
): any {
  const runtime = { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.8.0" };
  const durableItems = items.filter((item) => item.acquisition?.batchId === manifest.batchId);
  return {
    schemaVersion: SMOKE_EVIDENCE_SCHEMA_VERSION,
    foundryVersion: runtime.foundryVersion,
    pf2eVersion: runtime.pf2eVersion,
    moduleVersion: runtime.moduleVersion,
    user: { id: "owner-id", name: "Owner", role: 1, isGM: false },
    cases: [
      {
        id: definition.id,
        label: definition.label,
        status: "pass",
        actor: {
          id: "actor-id",
          authority: {
            canUpdate: true,
            defaultOwnershipLevel: 0,
            explicitOwnershipLevel: 3,
            isOwner: true,
            ownerPermission: true,
          },
          currencyCopper,
          items,
          itemCount: items.length,
          levelAfterApply: 1,
          moduleDraftAfterApply: null,
          moduleStateAfterApply: moduleState(manifest),
          skillRanks: {},
          abilityBoosts: {},
        },
        classifications: [],
        evidence: {
          acquisition: {
            binding: {
              schemaVersion: 1,
              caseId: definition.id,
              definitionFingerprint: definition.definitionFingerprint,
              executorRole: "non-gm-owner",
              runtime,
            },
            policy: {
              source: "completed-acquisition-manifest",
              version: 1,
              fingerprint: "policy-fingerprint",
              snapshot: manifest.policy,
            },
            currency: manifest.currency,
            durability: {
              schemaVersion: 1,
              source: "gm-context-page-reload",
              caseId: definition.id,
              definitionFingerprint: definition.definitionFingerprint,
              actorId: "actor-id",
              runtime: { ...runtime, guardedWorldMatched: true },
              draft: null,
              manifest,
              manifestCorrupt: false,
              currencyCopper,
              items: durableItems,
            },
            manifest,
            failureSnapshot: null,
            retry: null,
          },
          applyReview: { confirmationMessage: "", reviewLines: [] },
        },
        failures: [],
        warnings: [],
      },
    ],
    summary: { passed: 1, classified: 0, failed: 0 },
    cleanup: {
      exactFixturesMatched: true,
      actorsDeleted: 1,
      actorsMissingAfterCleanup: true,
    },
  };
}

async function productionManifest(definition: (typeof acquisitionSmokeCases)[number]) {
  const expected = definition.acquisitionCase;
  const entry = expected.expectedEntries[0];
  const price = entry
    ? createAcquisitionPriceSnapshot({
        basePrice: { kind: "priced", value: { sp: 2 } },
        size: "medium",
        sizeSensitive: true,
        preciousMaterial: false,
        adjustedBulkPriceCopper: null,
        configurationPriceCopper: 0,
        pricePer: 1,
        sourceQuantity: LEVEL_ONE_DAGGER.sourceQuantity,
        requestedQuantity: entry.quantity,
      })
    : null;
  if (price?.ok === false) throw new Error(price.message);
  const lines = entry
    ? [
        {
          schemaVersion: 1 as const,
          lineId: "line-id",
          sourceUuid: entry.sourceUuid,
          documentFingerprint: "dagger-document-fingerprint",
          priceFingerprint: "dagger-price-fingerprint",
          itemLevel: LEVEL_ONE_DAGGER.level,
          permanence: "permanent" as const,
          componentKind: "baseline-item" as const,
          policyDecision: {
            eligible: true,
            packId: "pf2e.equipment-srd",
            publicationSlug: "player-core",
            rarity: "common" as const,
            sourceBasis: "approved-pack",
            rarityBasis: "common",
            characterAccessRef: null,
            sourceExceptionJudgmentId: null,
            rarityExceptionJudgmentId: null,
            abpTreatment: "unchanged",
          },
          funding: { lane: "currency" as const },
          stackingIntent: "aggregate" as const,
          price: price!.value,
        },
      ]
    : [];
  const draft = {
    ...createAcquisitionDraft({
      draftId: "draft-id",
      batchId: "batch-id",
      manifestId: "manifest-id",
      targetLevel: 1,
      recipe: { kind: "lump-sum" },
    }),
    policySnapshot: {
      version: 1 as const,
      fingerprint: "policy-fingerprint",
      material: {
        subject: { actorId: "actor-id", draftId: "draft-id", targetLevel: 1 },
        numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
        semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
        resolvedRecipe: { kind: "lump-sum" as const },
        budgetCopper: 1500,
        allowances: [],
        worldRecipePolicy: {
          enabledRecipes: ["lump-sum", "permanent-items"] as const,
          defaultRecipe: "lump-sum" as const,
        },
        sourcePolicy: {
          configuredPackFamilies: ["pf2e"],
          effectivePackIds: ["pf2e.equipment-srd"],
          enabledSourceSlugs: ["player-core"],
          knownSourceSlugs: ["player-core"],
          showEmptySources: false,
          showUnknownSources: false,
        },
        rarityPolicy: { blanketCeiling: "common" as const },
        authorityPolicy: {
          recipeChoice: "actor-owner" as const,
          higherLevelStart: "actor-owner-attestation" as const,
          apply: "actor-owner" as const,
        },
        higherLevelStartEvidence: { kind: "not-required" as const },
        abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
        gmJudgments: [],
      },
    },
    baseline: createEconomicBaseline({
      actorId: "actor-id",
      capturedAt: "2026-08-19T14:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    }),
    plannedClassGrants: [],
    classGrantReconciliations: [],
    lines,
  };
  const classGrantPlan = createPreparedClassGrantPlan({
    actorId: "actor-id",
    draftId: draft.draftId,
    batchId: draft.batchId,
    targetLevel: draft.targetLevel,
    grants: [],
  });
  const ledger = evaluateAcquisitionLedger(draft, classGrantPlan);
  const reviewed =
    expected.disposition === "retain-all"
      ? reviewRetainAll(draft, ledger, {
          userId: "owner-id",
          reviewedAt: "2026-08-19T15:00:00.000Z",
        })
      : reviewPurchaseLedger(draft, ledger, {
          userId: "owner-id",
          reviewedAt: "2026-08-19T15:00:00.000Z",
        });
  const identityPlan = await prepareAcquisitionIdentityPlan({
    actorId: "actor-id",
    draft: reviewed,
    ledger,
    classGrantPlan,
  });
  const observedItems = identityPlan.entries.flatMap((manifestEntry) =>
    manifestEntry.plannedItems.map((planned) => ({
      plannedItemId: planned.plannedItemId,
      actualItemId: "dagger-item",
      actualSourceUuid: planned.sourceUuid,
      actualQuantity: planned.quantity,
      plannedContainerId: planned.plannedContainerId,
      actualContainerId: null,
    }))
  );
  const finalClassGrantReconciliation = reconcilePreparedClassGrants({
    plan: classGrantPlan,
    actorItems: [],
    phase: "final",
  });
  const currency = {
    preCopper: 0,
    budgetCopper: ledger.budgetCopper,
    targetCopper: ledger.remainingCopper,
    observedCopper: ledger.remainingCopper,
    spentCopper: ledger.spentCopper,
    remainingCopper: ledger.remainingCopper,
  };
  return createCompletedAcquisitionManifest({
    actorId: "actor-id",
    draft: reviewed,
    identityPlan,
    appliedBy: { userId: "owner-id", userName: "Owner" },
    appliedAt: "2026-08-19T16:00:00.000Z",
    currency,
    observedItems,
    finalClassGrantReconciliation,
    environment: { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.8.0" },
  });
}

function productionEntry() {
  return {
    entryId: "entry-id",
    preAggregationKey: "dagger-aggregate",
    lineIds: ["line-id"],
    sourceUuid: LEVEL_ONE_DAGGER.sourceUuid,
    documentFingerprint: "document-fingerprint",
    priceFingerprint: "price-fingerprint",
    quantity: 2,
    stackingIntent: "aggregate",
    funding: { lane: "currency" },
    resolvedAllowanceId: null,
    policyDecision: { eligible: true },
    price: { unitPriceCopper: 20, linePriceCopper: 40 },
    plannedItems: [
      {
        plannedItemId: "planned-item-id",
        sourceUuid: LEVEL_ONE_DAGGER.sourceUuid,
        quantity: 2,
        plannedContainerId: null,
      },
    ],
    observedItems: [
      {
        plannedItemId: "planned-item-id",
        actualItemId: "dagger-item",
        actualSourceUuid: LEVEL_ONE_DAGGER.sourceUuid,
        actualQuantity: 2,
        plannedContainerId: null,
        actualContainerId: null,
      },
    ],
  };
}

function daggerItem(manifest: Awaited<ReturnType<typeof productionManifest>>) {
  const entry = manifest.entries[0]!;
  const planned = entry.plannedItems[0]!;
  return {
    id: "dagger-item",
    name: "Dagger",
    type: "weapon",
    sourceId: LEVEL_ONE_DAGGER.sourceUuid,
    isPhysical: true,
    isCurrency: false,
    quantity: entry.quantity,
    containerId: null,
    grantedById: null,
    grantAncestryIds: [],
    slotId: null,
    trainingKey: null,
    destinationKey: null,
    location: null,
    acquisition: {
      version: 1,
      draftId: manifest.draftId,
      batchId: manifest.batchId,
      manifestId: manifest.id,
      lineId: entry.lineIds[0],
      entryId: entry.entryId,
      plannedItemId: planned.plannedItemId,
      plannedContainerId: planned.plannedContainerId,
      plannedGrantId: null,
      stackingIntent: "aggregate",
    },
  };
}

function writeCheckpoint(operation: string, boundary: string, ordinal: number) {
  const phases: Record<string, string> = {
    "embedded-item-create": "acquisition-items",
    "currency-convergence": "acquisition-currency",
    "final-actor-update": "finalize-actor",
  };
  return {
    checkpointId: `write:${operation}:${boundary}`,
    kind: "write",
    phase: phases[operation],
    operation,
    boundary,
    ordinal,
  };
}

function moduleState(manifest: any) {
  return {
    version: 4,
    lastAppliedAt: "2026-08-19T16:00:00.000Z",
    lastTargetLevel: 1,
    completedStepIds: ["starting-equipment"],
    existingCharacterHistory: null,
    lastAppliedSpellRarityAttestations: [],
    completedAcquisitionManifest: manifest,
    completedAcquisitionManifestCorrupt: false,
  };
}

function findingCodes(result: any): string[] {
  return result.cases[0].evidence.contract.findings.map((finding: { code: string }) => finding.code);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
