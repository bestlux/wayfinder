import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  reconcilePreparedClassGrants,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createCompletedAcquisitionManifest } from "../src/wayfinder/domain/completed-acquisition-manifest";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";
import {
  cleanupAcquisitionFixtures,
  createAcquisitionDurabilityPage,
  loadAcquisitionBrowserSuite,
  reloadAcquisitionBrowserSuite,
} from "../tools/foundry-smoke/acquisition-browser-lifecycle.mjs";
import {
  ACQUISITION_CASE_SCHEMA_VERSION,
  acquisitionDefinitionFingerprint,
  acquisitionSmokeCases,
  LEVEL_ONE_DAGGER,
  LEVEL_ONE_NATIVE_GRANTS,
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
  it("pins purchase, retain-all, retry, lost-ack, and fixed-native cases to exact PF2E identities", () => {
    expect(acquisitionSmokeCases.map((smokeCase) => smokeCase.id)).toEqual([
      "equipment-l1-owner-common-purchase",
      "equipment-l1-owner-retain-all",
      "equipment-l1-owner-common-purchase-retry",
      "equipment-l1-owner-common-purchase-currency-before-retry",
      "equipment-l1-owner-common-purchase-currency-after-retry",
      "equipment-l1-owner-common-purchase-final-before-retry",
      "equipment-l1-owner-common-purchase-final-after-ack",
      "equipment-l1-owner-dwarf-clan-dagger-native-retry",
      "equipment-l1-owner-sarangay-head-gem-native-retry",
      "equipment-l1-gm-review-common-purchase",
    ]);
    expect(ACQUISITION_CASE_SCHEMA_VERSION).toBe(2);
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
      expect(smokeCase.definitionFingerprint).toMatch(/^wf-acquisition-case-v2-[a-f0-9]{64}$/u);
      expect(smokeCase.acquisitionCase.policyReview).toEqual({
        required: smokeCase.acquisitionCase.executorRole === "gm-reviewer",
        reviewerRole: "gm",
      });
    }
    const retry = acquisitionSmokeCases[2];
    expect(retry.acquisitionCase.expectedEntries[0]).toMatchObject({ quantity: 2, stackingIntent: "aggregate" });
    expect(retry.acquisitionCase.failure).toEqual({
      checkpointId: "write:embedded-item-create:after",
      occurrence: 1,
      expectedPoint: "item-after",
    });
  });

  it("defines exactly two source-backed non-GM retain-all native grants with zero acquisition creates", () => {
    const nativeCases = acquisitionSmokeCases.filter((smokeCase) => smokeCase.acquisitionCase.nativeGrant !== null);

    expect(nativeCases).toHaveLength(2);
    expect(LEVEL_ONE_NATIVE_GRANTS).toEqual({
      dwarfClanDagger: expect.objectContaining({
        kind: "fixed-native-grant",
        profileId: "dwarf-clan-dagger",
        grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
        materializer: "pf2e-native",
        fundingLane: "class-grant",
        originSlotId: "ancestry-level-1",
        ancestry: {
          name: "Dwarf",
          sourceUuid: "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
        },
        heritage: {
          name: "Forge Dwarf",
          sourceUuid: "Compendium.pf2e.heritages.Item.5CqsBKCZuGON53Hk",
        },
        ancestryFeat: {
          name: "Dwarven Doughtiness",
          sourceUuid: "Compendium.pf2e.feats-srd.Item.UJ8AqzkkDqRCMNFW",
        },
        granter: {
          name: "Clan Dagger",
          sourceUuid: "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
        },
        target: {
          name: "Clan Dagger",
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.kJJvKm80KwWXPukV",
          itemType: "weapon",
          level: 0,
          rarity: "uncommon",
          publication: "Pathfinder Player Core",
          quantity: 1,
          sourceQuantity: 1,
          rulesCount: 0,
          containerId: null,
          unitPriceCopper: 200,
        },
        nativeGrantChainSourceUuids: [
          "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
          "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
        ],
        requiredRuleSelection: { key: "clanWeapon", value: "clan-dagger" },
      }),
      sarangayHeadGem: expect.objectContaining({
        kind: "fixed-native-grant",
        profileId: "sarangay-head-gem",
        grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
        materializer: "pf2e-native",
        fundingLane: "class-grant",
        originSlotId: "ancestry-level-1",
        ancestry: {
          name: "Sarangay",
          sourceUuid: "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
        },
        heritage: {
          name: "Waxing Moon Sarangay",
          sourceUuid: "Compendium.pf2e.heritages.Item.BHiOV3ETYSv6k7kF",
        },
        ancestryFeat: {
          name: "Crown of Bone",
          sourceUuid: "Compendium.pf2e.feats-srd.Item.pC9sGxKBOGWQLOuw",
        },
        granter: {
          name: "Head Gem",
          sourceUuid: "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
        },
        target: {
          name: "Head Gem",
          sourceUuid: "Compendium.pf2e.equipment-srd.Item.FA1mAc7rEyC9vzZa",
          itemType: "equipment",
          level: 0,
          rarity: "common",
          publication: "Pathfinder Lost Omens Tian Xia Character Guide",
          quantity: 1,
          sourceQuantity: 1,
          rulesCount: 1,
          containerId: null,
          unitPriceCopper: 0,
        },
        nativeGrantChainSourceUuids: [
          "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
          "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
        ],
        requiredRuleSelection: null,
      }),
    });
    expect(LEVEL_ONE_NATIVE_GRANTS.dwarfClanDagger.fixture).toMatchObject({
      ancestryBoosts: { 0: "con", 1: "wis", 2: "dex" },
      backgroundBoosts: { 0: "wis", 1: "cha" },
    });
    expect(LEVEL_ONE_NATIVE_GRANTS.sarangayHeadGem.fixture).toMatchObject({
      ancestryBoosts: { 0: "str", 1: "cha", 2: "dex" },
      backgroundBoosts: { 0: "wis", 1: "con" },
    });

    for (const definition of nativeCases) {
      const expected = definition.acquisitionCase;
      expect(expected).toMatchObject({
        schemaVersion: 2,
        executorRole: "non-gm-owner",
        disposition: "retain-all",
        expectedBudgetCopper: 1500,
        expectedSpentCopper: 0,
        expectedRemainingCopper: 1500,
        expectedAcquisitionItemCreateCheckpoints: 0,
        policyReview: { required: false, reviewerRole: "gm" },
        failure: {
          checkpointId: "write:currency-convergence:before",
          occurrence: 1,
          expectedPoint: "currency-before",
        },
      });
      expect(expected.expectedEntries).toEqual([
        expect.objectContaining({
          sourceUuid: expected.nativeGrant.target.sourceUuid,
          name: expected.nativeGrant.target.name,
          quantity: 1,
          sourceQuantity: 1,
          stackingIntent: "separate",
          fundingLane: "class-grant",
          plannedGrantId: expected.nativeGrant.grantId,
          materializer: "pf2e-native",
        }),
      ]);
      expect(expected.nativeGrant.fixture).toMatchObject({
        kind: "complete-draft",
        background: {
          name: "Acolyte",
          sourceUuid: "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy",
        },
        class: {
          name: "Fighter",
          sourceUuid: "Compendium.pf2e.classes.Item.8zn3cD6GSmoo1LW4",
        },
        classFeat: {
          name: "Sudden Charge",
          sourceUuid: "Compendium.pf2e.feats-srd.Item.qQt3CMrhLkUV1wCv",
        },
        keyAbility: "str",
        levelOneBoosts: ["str", "dex", "con", "wis"],
        preferredSkills: ["athletics", "crafting", "medicine", "stealth"],
        ruleSelections: { fighterSkill: "athletics" },
      });
    }
  });

  it("rejects native profile, source, currency, and item-create expectation drift", () => {
    const mutations = [
      (definition: any) => {
        definition.acquisitionCase.nativeGrant.kind = "catalogue-item";
      },
      (definition: any) => {
        definition.acquisitionCase.nativeGrant.target.sourceUuid = LEVEL_ONE_DAGGER.sourceUuid;
        definition.acquisitionCase.expectedEntries[0].sourceUuid = LEVEL_ONE_DAGGER.sourceUuid;
      },
      (definition: any) => {
        definition.acquisitionCase.expectedRemainingCopper = 1499;
      },
      (definition: any) => {
        definition.acquisitionCase.expectedAcquisitionItemCreateCheckpoints = 1;
      },
    ];

    for (const mutate of mutations) {
      const definition = structuredClone(
        acquisitionSmokeCases.find((smokeCase) => smokeCase.id === "equipment-l1-owner-dwarf-clan-dagger-native-retry")
      ) as any;
      mutate(definition);
      definition.definitionFingerprint = acquisitionDefinitionFingerprint(definition);
      expect(validateAcquisitionSmokeCaseDefinition(definition)).toContain(
        "Native-grant smoke cases require one exact fixed profile, locked zero-cost grant line, and before-currency retry."
      );
    }
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

  it("qualifies exact zero-write PF2E-native evidence and rejects stamps, chain drift, and claimed creates", async () => {
    const definition = acquisitionSmokeCases.find(
      (smokeCase) => smokeCase.id === "equipment-l1-owner-dwarf-clan-dagger-native-retry"
    )!;
    const valid = await nativeRetryResult(definition);
    expect(findingCodes(qualifySmokeResult(valid, [definition]))).toEqual([]);

    const stamped = structuredClone(valid);
    stamped.cases[0].actor.items[0].acquisition = { batchId: "batch-id" };
    stamped.cases[0].evidence.acquisition.durability.items[0].acquisition = { batchId: "batch-id" };
    expect(findingCodes(qualifySmokeResult(stamped, [definition]))).toContain("manifest-item-identity-mismatch");

    const wrongChain = structuredClone(valid);
    wrongChain.cases[0].actor.items[1].sourceId = LEVEL_ONE_DAGGER.sourceUuid;
    expect(findingCodes(qualifySmokeResult(wrongChain, [definition]))).toContain("manifest-item-identity-mismatch");

    const claimedCreate = structuredClone(valid);
    claimedCreate.cases[0].evidence.acquisitionUi.acquisitionItemCreateCheckpoints = 1;
    expect(findingCodes(qualifySmokeResult(claimedCreate, [definition]))).toContain(
      "acquisition-item-create-checkpoint-mismatch"
    );
  });

  it("qualifies a GM-review purchase only from its exact separate executor session and policy", async () => {
    const definition = acquisitionSmokeCases.at(-1)!;
    const valid = qualifySmokeResult(await purchaseResult(definition), [definition]);
    expect(findingCodes(valid)).toEqual([]);
    expect(valid.qualification.passed).toBe(true);

    const missingSession = await purchaseResult(definition);
    delete missingSession.reviewSession;
    expect(findingCodes(qualifySmokeResult(missingSession, [definition]))).toEqual(
      expect.arrayContaining(["acquisition-case-binding-mismatch", "missing-gm-policy-review-session"])
    );

    const wrongExecutor = await purchaseResult(definition);
    wrongExecutor.cases[0].evidence.acquisition.binding.executorUserId = "another-gm";
    expect(findingCodes(qualifySmokeResult(wrongExecutor, [definition]))).toContain(
      "acquisition-case-binding-mismatch"
    );

    const wrongPrincipalManifest = await productionManifest(definition, "another-gm");
    const wrongPrincipal = baseResult(
      definition,
      wrongPrincipalManifest,
      [daggerItem(wrongPrincipalManifest)],
      wrongPrincipalManifest.currency.observedCopper
    );
    expect(findingCodes(qualifySmokeResult(wrongPrincipal, [definition]))).toContain(
      "acquisition-case-manifest-mismatch"
    );

    const ownerPolicy = await purchaseResult(definition);
    ownerPolicy.cases[0].evidence.acquisition.manifest.policy.material.authorityPolicy.apply = "actor-owner";
    ownerPolicy.cases[0].actor.moduleStateAfterApply.completedAcquisitionManifest =
      ownerPolicy.cases[0].evidence.acquisition.manifest;
    ownerPolicy.cases[0].evidence.acquisition.policy.snapshot =
      ownerPolicy.cases[0].evidence.acquisition.manifest.policy;
    ownerPolicy.cases[0].evidence.acquisition.durability.manifest = ownerPolicy.cases[0].evidence.acquisition.manifest;
    expect(findingCodes(qualifySmokeResult(ownerPolicy, [definition]))).toContain(
      "acquisition-case-authority-policy-mismatch"
    );
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
        attempted: variant.point !== "final-state-after",
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
    expect(browserSuite).toContain("driver?.revoke?.()");
    expect(browserSuite).toContain("prepareAcquisitionBaseBuild");
    expect(runner).toContain("playerContext.addInitScript");
    expect(runner).toContain("gmReviewContext.addInitScript");
    expect(runner).toContain('expectedExecutorRole: "gm-reviewer"');
    expect(runner).toContain('setEquipmentApplyAuthority(setupPage, MODULE_ID, "gm-review")');
    expect(runner).toContain("restoreEquipmentSettings(setupPage, MODULE_ID, equipmentSettingsSnapshot)");
    expect(runner).toContain("__wayfinderAcquisitionSmokeBootstrap");
    expect(runner.match(/browser\.newContext\(/gu)).toHaveLength(3);
    expect(runner.indexOf("await playerContext.close();")).toBeLessThan(
      runner.indexOf("cleanup = await cleanupAcquisitionFixtures(")
    );
    expect(runner.indexOf("await gmReviewContext.close();")).toBeLessThan(
      runner.indexOf("cleanup = await cleanupAcquisitionFixtures(")
    );
    expect(runner).toContain("qualifySmokeResult(result, cases)");
    expect(runner).not.toContain("console.error(error)");
  });

  it("loads the skill-selection policy before the suite in every acquisition browser context", async () => {
    const calls: string[] = [];
    const page = {
      addScriptTag: async ({ path }: { path: string }) => {
        calls.push(path);
      },
    };

    await loadAcquisitionBrowserSuite(page);

    expect(calls.map((scriptPath) => scriptPath.replaceAll("\\", "/").split("/").at(-1))).toEqual([
      "skill-selection-policy.js",
      "browser-suite.js",
    ]);
    expect(runner).toMatch(
      /GM setup session ready\."\);\s+await loadAcquisitionBrowserSuite\(setupPage\);\s+equipmentSettingsSnapshot/u
    );
    expect(runner).toMatch(
      /non-GM owner session ready[^;]+;\s+await loadAcquisitionBrowserSuite\(playerPage\);\s+ownerResult/u
    );
    expect(runner).toMatch(
      /GM review session ready[^;]+;\s+await loadAcquisitionBrowserSuite\(gmReviewPage\);\s+gmReviewResult/u
    );
    expect(runner).toMatch(
      /durabilityPage = await createAcquisitionDurabilityPage\(setupContext, foundryUrl\);\s+const durability = await durabilityPage\.evaluate/u
    );
    expect(runner).toContain("[setupPage, durabilityPage]");
    expect(runner).not.toContain(".addScriptTag(");
  });

  it("reloads to a ready Foundry page before restoring policy-bound acquisition globals", async () => {
    const calls: string[] = [];
    const page = {
      reload: async (options: { waitUntil: string }) => {
        calls.push(`reload:${options.waitUntil}`);
      },
      waitForFunction: async (_predicate: () => boolean, value: unknown, options: { timeout: number }) => {
        calls.push(`ready:${String(value)}:${options.timeout}`);
      },
      addScriptTag: async ({ path }: { path: string }) => {
        calls.push(`script:${path.replaceAll("\\", "/").split("/").at(-1)}`);
      },
    };

    await reloadAcquisitionBrowserSuite(page);

    expect(calls).toEqual([
      "reload:domcontentloaded",
      "ready:null:60000",
      "script:skill-selection-policy.js",
      "script:browser-suite.js",
    ]);
  });

  it("keeps setup cleanup authority when durability bootstrap fails before returning a page", async () => {
    const cleanupPayload = { runId: "run-id" };
    const close = vi.fn().mockResolvedValue(undefined);
    const failedDurabilityPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      addScriptTag: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Injected browser-suite load failure.")),
      close,
    };
    const context = { newPage: async () => failedDurabilityPage };
    const durabilityPage = null;

    await expect(createAcquisitionDurabilityPage(context, "http://localhost:30000")).rejects.toThrow(
      "Injected browser-suite load failure."
    );
    expect(close).toHaveBeenCalledOnce();

    const cleanup = vi.fn().mockResolvedValue({ actorsDeleted: 1 });
    const retainedSetupPage = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(async (_callback, payload) => cleanup(payload)),
    };

    await expect(cleanupAcquisitionFixtures([retainedSetupPage, durabilityPage], cleanupPayload)).resolves.toEqual({
      actorsDeleted: 1,
    });
    expect(cleanup).toHaveBeenCalledWith(cleanupPayload);
  });

  it("creates a separately reloaded durability page with the same policy-before-suite contract", async () => {
    const calls: string[] = [];
    const page = {
      goto: async (url: string, options: { waitUntil: string }) => calls.push(`goto:${url}:${options.waitUntil}`),
      reload: async (options: { waitUntil: string }) => calls.push(`reload:${options.waitUntil}`),
      waitForFunction: async (_predicate: () => boolean, value: unknown, options: { timeout: number }) => {
        calls.push(`ready:${String(value)}:${options.timeout}`);
      },
      addScriptTag: async ({ path }: { path: string }) => {
        calls.push(`script:${path.replaceAll("\\", "/").split("/").at(-1)}`);
      },
      close: vi.fn(),
    };
    const context = { newPage: async () => page };

    await expect(createAcquisitionDurabilityPage(context, "http://localhost:30000")).resolves.toBe(page);
    expect(calls).toEqual([
      "goto:http://localhost:30000:domcontentloaded",
      "ready:null:60000",
      "reload:domcontentloaded",
      "ready:null:60000",
      "script:skill-selection-policy.js",
      "script:browser-suite.js",
    ]);
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

async function nativeRetryResult(definition: (typeof acquisitionSmokeCases)[number]): Promise<any> {
  const manifest = await productionManifest(definition);
  const native = definition.acquisitionCase.nativeGrant!;
  const items = [
    {
      id: "native-item",
      name: native.target.name,
      type: native.target.itemType,
      sourceId: native.target.sourceUuid,
      quantity: 1,
      containerId: null,
      isPhysical: true,
      isCurrency: false,
      acquisition: null,
      grantedById: "native-granter",
      grantAncestryIds: ["native-granter", "native-ancestry"],
      location: null,
      slotId: null,
      trainingKey: null,
      destinationKey: null,
      grantRules: [],
      ruleSelections: {},
      traits: [],
      spellcasting: null,
    },
    {
      id: "native-granter",
      name: native.granter.name,
      type: "feat",
      sourceId: native.granter.sourceUuid,
      quantity: null,
      containerId: null,
      isPhysical: false,
      isCurrency: false,
      acquisition: null,
      grantedById: "native-ancestry",
      grantAncestryIds: ["native-ancestry"],
      location: "native-ancestry",
      slotId: "system-grant-native",
      trainingKey: null,
      destinationKey: null,
      grantRules: [],
      ruleSelections: {},
      traits: [],
      spellcasting: null,
    },
    {
      id: "native-ancestry",
      name: native.ancestry.name,
      type: "ancestry",
      sourceId: native.ancestry.sourceUuid,
      quantity: null,
      containerId: null,
      isPhysical: false,
      isCurrency: false,
      acquisition: null,
      grantedById: null,
      grantAncestryIds: [],
      location: null,
      slotId: "ancestry-level-1",
      trainingKey: null,
      destinationKey: null,
      grantRules: [],
      ruleSelections: {},
      traits: [],
      spellcasting: null,
    },
  ];
  const result = baseResult(definition, manifest, items, manifest.currency.observedCopper);
  result.cases[0].evidence.acquisition.failureSnapshot = {
    checkpoint: writeCheckpoint("currency-convergence", "before", 1),
    point: "currency-before",
    batchId: "batch-id",
    afterItemIndex: null,
    currencyOperationIndex: null,
    message: "Intentional failure at write:currency-convergence:before.",
    actualItemIds: [],
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
    preRetryItemIds: [],
    postRetryItemIds: [],
    preRetryCurrencyCopper: 0,
    postRetryCurrencyCopper: 1500,
    checkpoints: [
      writeCheckpoint("currency-convergence", "before", 1),
      writeCheckpoint("currency-convergence", "after", 1),
      writeCheckpoint("final-actor-update", "before", 1),
      writeCheckpoint("final-actor-update", "after", 1),
    ],
  };
  return result;
}

function baseResult(
  definition: (typeof acquisitionSmokeCases)[number],
  manifest: any,
  items: any[],
  currencyCopper: number
): any {
  const runtime = { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.8.0" };
  const gmReview = definition.acquisitionCase.executorRole === "gm-reviewer";
  const executorUserId = gmReview ? "gm-id" : "owner-id";
  const durableItemIds = new Set([
    ...manifest.entries.flatMap((entry: any) => entry.observedItems.map((observed: any) => observed.actualItemId)),
    ...manifest.classGrants.flatMap((classGrant: any) => classGrant.observedItemIds),
  ]);
  const durableItems = items.filter((item) => durableItemIds.has(item.id));
  return {
    schemaVersion: SMOKE_EVIDENCE_SCHEMA_VERSION,
    foundryVersion: runtime.foundryVersion,
    pf2eVersion: runtime.pf2eVersion,
    moduleVersion: runtime.moduleVersion,
    user: { id: "owner-id", name: "Owner", role: 1, isGM: false },
    ...(gmReview
      ? {
          reviewSession: {
            source: "separate-gm-browser-context",
            userId: "gm-id",
            role: 4,
            isGM: true,
            runtime: { ...runtime, guardedWorldMatched: true },
            reviewedCaseIds: [definition.id],
          },
        }
      : {}),
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
              executorRole: definition.acquisitionCase.executorRole,
              executorUserId,
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
          acquisitionUi: {
            actorSheetOpened: true,
            launchControlClicked: true,
            equipmentPaneOpened: true,
            dispositionReviewed: true,
            applyClicked: true,
            completed: true,
            retryClicked: definition.acquisitionCase.failure !== null,
            failureVisible: definition.acquisitionCase.failure !== null,
            partialStateVisible: definition.acquisitionCase.failure !== null,
            draftRecoveryVisible: definition.acquisitionCase.failure !== null,
            lateAcknowledgementConverged: false,
            acquisitionItemCreateCheckpoints: definition.acquisitionCase.expectedAcquisitionItemCreateCheckpoints ?? 0,
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

async function productionManifest(definition: (typeof acquisitionSmokeCases)[number], executorUserIdOverride?: string) {
  const expected = definition.acquisitionCase;
  const gmReview = expected.executorRole === "gm-reviewer";
  const executorUserId = executorUserIdOverride ?? (gmReview ? "gm-id" : "owner-id");
  const entry = expected.expectedEntries[0];
  const native = expected.nativeGrant;
  const plannedGrant = native
    ? createPlannedClassGrant({
        grantId: native.grantId,
        profileId: native.profileId,
        origin: { sourceSlotId: native.originSlotId, sourceUuid: native.ancestry.sourceUuid },
        granterSourceUuid: native.granter.sourceUuid,
        expected: {
          sourceUuid: native.target.sourceUuid,
          quantity: native.target.quantity,
          itemType: native.target.itemType,
        },
        materializer: "pf2e-native",
        eligibilityKind: "fixed-class-grant",
        resaleRule: "normal",
        eligibilityEvidence: { kind: "fixed-native-profile" },
        nativeGrantChainSourceUuids: native.nativeGrantChainSourceUuids,
      })
    : null;
  const price = entry
    ? createAcquisitionPriceSnapshot({
        basePrice: { kind: "priced", value: { cp: entry.unitPriceCopper } },
        size: "medium",
        sizeSensitive: true,
        preciousMaterial: false,
        adjustedBulkPriceCopper: null,
        configurationPriceCopper: 0,
        pricePer: 1,
        sourceQuantity: entry.sourceQuantity,
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
          documentFingerprint: "document-fingerprint",
          priceFingerprint: "price-fingerprint",
          itemLevel: entry.level,
          permanence: "permanent" as const,
          componentKind: "baseline-item" as const,
          policyDecision: {
            eligible: native === null,
            packId: "pf2e.equipment-srd",
            publicationSlug: "player-core",
            rarity: entry.rarity,
            sourceBasis: "approved-pack",
            rarityBasis: native ? "blanket-common" : "common",
            characterAccessRef: null,
            sourceExceptionJudgmentId: null,
            rarityExceptionJudgmentId: null,
            abpTreatment: "unchanged",
          },
          funding: native
            ? { lane: "class-grant" as const, grant: { plannedGrantId: native.grantId } }
            : { lane: "currency" as const },
          stackingIntent: entry.stackingIntent,
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
      recipe: { kind: native ? "permanent-items" : "lump-sum" },
    }),
    policySnapshot: {
      version: 1 as const,
      fingerprint: "policy-fingerprint",
      material: {
        subject: { actorId: "actor-id", draftId: "draft-id", targetLevel: 1 },
        numericPolicyRef: CHARACTER_WEALTH_POLICY_REF,
        semanticPolicyRef: SEMANTIC_WEALTH_POLICY_REF,
        resolvedRecipe: { kind: native ? ("permanent-items" as const) : ("lump-sum" as const) },
        budgetCopper: 1500,
        allowances: [],
        worldRecipePolicy: {
          enabledRecipes: ["lump-sum", "permanent-items"] as const,
          defaultRecipe: native ? ("permanent-items" as const) : ("lump-sum" as const),
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
          apply: gmReview ? ("gm-review" as const) : ("actor-owner" as const),
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
      physicalItems: native
        ? [
            {
              itemId: "native-item",
              type: native.target.itemType,
              sourceUuid: native.target.sourceUuid,
              quantity: 1,
              containerId: null,
              acquisitionIdentity: null,
            },
          ]
        : [],
    }),
    plannedClassGrants: plannedGrant ? [plannedGrant] : [],
    classGrantReconciliations: [],
    lines,
  };
  const classGrantPlan = createPreparedClassGrantPlan({
    actorId: "actor-id",
    draftId: draft.draftId,
    batchId: draft.batchId,
    targetLevel: draft.targetLevel,
    grants: plannedGrant ? [plannedGrant] : [],
  });
  const ledger = evaluateAcquisitionLedger(draft, classGrantPlan);
  const reviewed =
    expected.disposition === "retain-all"
      ? reviewRetainAll(draft, ledger, {
          userId: executorUserId,
          reviewedAt: "2026-08-19T15:00:00.000Z",
        })
      : reviewPurchaseLedger(draft, ledger, {
          userId: executorUserId,
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
      actualItemId: native ? "native-item" : "dagger-item",
      actualSourceUuid: planned.sourceUuid,
      actualQuantity: planned.quantity,
      plannedContainerId: planned.plannedContainerId,
      actualContainerId: null,
    }))
  );
  const finalClassGrantReconciliation = reconcilePreparedClassGrants({
    plan: classGrantPlan,
    actorItems: native
      ? [
          {
            itemId: "native-item",
            sourceUuid: native.target.sourceUuid,
            itemType: native.target.itemType,
            quantity: 1,
            grantedByItemId: "native-granter",
            locationItemId: null,
            wayfinderSlotId: null,
            acquisitionIdentity: null,
          },
          {
            itemId: "native-granter",
            sourceUuid: native.granter.sourceUuid,
            itemType: "feat",
            quantity: 1,
            grantedByItemId: "native-ancestry",
            locationItemId: "native-ancestry",
            wayfinderSlotId: null,
            acquisitionIdentity: null,
          },
          {
            itemId: "native-ancestry",
            sourceUuid: native.ancestry.sourceUuid,
            itemType: "ancestry",
            quantity: 1,
            grantedByItemId: null,
            locationItemId: null,
            wayfinderSlotId: "ancestry-level-1",
            acquisitionIdentity: null,
          },
        ]
      : [],
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
    appliedBy: { userId: executorUserId, userName: gmReview ? "GM" : "Owner" },
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
