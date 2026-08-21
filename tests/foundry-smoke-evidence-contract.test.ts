import { describe, expect, it } from "vitest";
import { physicalGrantRouteById } from "../src/wayfinder/domain/physical-grant-route-registry";

import {
  assertIncrementalSmokeCasesSupported,
  buildActorSourceEvidence,
  qualifySmokeResult,
  SMOKE_EVIDENCE_SCHEMA_VERSION,
  validateAcquisitionEvidence,
} from "../tools/foundry-smoke/evidence-contract.mjs";

describe("Foundry smoke evidence contract", () => {
  it("rejects Apply safety cases in the unsupported incremental lane", () => {
    expect(() =>
      assertIncrementalSmokeCasesSupported([
        {
          id: "safety-case",
          applySafetyFailureCheckpoint: {
            checkpointId: "phase:source-flag-restoration:before",
            occurrence: 1,
          },
        },
      ])
    ).toThrow(/cannot run through --incremental-case/u);
    expect(() => assertIncrementalSmokeCasesSupported([{ id: "ordinary-case" }])).not.toThrow();
  });
  it("accepts one physical stack with an exact aggregate quantity", () => {
    const result = qualifySmokeResult(resultFixture({ items: [physicalItem({ quantity: 12 })] }), [
      {
        id: "case",
        sourceGroupExpectations: [
          { sourceId: "Compendium.pf2e.equipment-srd.Item.rope", documentCount: 1, totalQuantity: 12 },
        ],
      },
    ]);

    expect(result.qualification).toMatchObject({ passed: true, unreviewedFindingCount: 0 });
    expect(result.cases[0].actor.sourceGroups).toEqual([
      expect.objectContaining({
        documentCount: 1,
        sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
        totalQuantity: 12,
      }),
    ]);
  });

  it("rejects same-source documents without distinct semantic identity", () => {
    const result = qualifySmokeResult(
      resultFixture({ items: [physicalItem({ id: "item-a" }), physicalItem({ id: "item-b" })] })
    );

    expect(result.qualification.passed).toBe(false);
    expect(findingCodes(result)).toContain("ambiguous-source-identity");
  });

  it("distinguishes grant ancestry and rejects a repeated grant identity", () => {
    const distinct = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({
            id: "parent-a",
            name: "Parent A",
            sourceId: "Compendium.pf2e.equipment-srd.Item.parent-a",
          }),
          physicalItem({
            id: "parent-b",
            name: "Parent B",
            sourceId: "Compendium.pf2e.equipment-srd.Item.parent-b",
          }),
          physicalItem({ id: "child-a", grantedById: "parent-a", grantAncestryIds: ["parent-a"] }),
          physicalItem({ id: "child-b", grantedById: "parent-b", grantAncestryIds: ["parent-b"] }),
        ],
      })
    );
    const repeated = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({
            id: "parent-a",
            name: "Parent A",
            sourceId: "Compendium.pf2e.equipment-srd.Item.parent-a",
          }),
          physicalItem({ id: "child-a", grantedById: "parent-a", grantAncestryIds: ["parent-a"] }),
          physicalItem({ id: "child-b", grantedById: "parent-a", grantAncestryIds: ["parent-a"] }),
        ],
      })
    );

    expect(distinct.qualification.passed).toBe(true);
    expect(findingCodes(repeated)).toContain("ambiguous-source-identity");
  });

  it("allows intentionally separate acquisition entries and rejects repeated entry identity", () => {
    const first = acquisitionIdentity({ entryId: "entry-a", stackingIntent: "separate" });
    const second = acquisitionIdentity({ entryId: "entry-b", stackingIntent: "separate" });
    const distinct = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({ id: "item-a", acquisition: first }),
          physicalItem({ id: "item-b", acquisition: second }),
        ],
      })
    );
    const repeated = qualifySmokeResult(
      resultFixture({
        items: [physicalItem({ id: "item-a", acquisition: first }), physicalItem({ id: "item-b", acquisition: first })],
      })
    );

    expect(distinct.qualification.passed).toBe(true);
    expect(findingCodes(repeated)).toEqual(
      expect.arrayContaining(["ambiguous-source-identity", "duplicate-acquisition-entry"])
    );
  });

  it("rejects a split aggregate line and enforces source totals", () => {
    const result = qualifySmokeResult(
      resultFixture({
        items: [
          physicalItem({ id: "item-a", acquisition: acquisitionIdentity({ entryId: "entry-a" }), quantity: 2 }),
          physicalItem({ id: "item-b", acquisition: acquisitionIdentity({ entryId: "entry-b" }), quantity: 3 }),
        ],
      }),
      [
        {
          id: "case",
          sourceGroupExpectations: [
            {
              sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
              documentCount: 1,
              totalQuantity: 6,
              stackingIntent: "aggregate",
            },
          ],
        },
      ]
    );

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining([
        "aggregate-stack-split",
        "source-document-count-mismatch",
        "source-quantity-mismatch",
        "source-stacking-mismatch",
      ])
    );
  });

  it("preserves container and source identity while excluding currency documents from conflicts", () => {
    const container = physicalItem({ id: "pack", sourceId: "Compendium.pf2e.equipment-srd.Item.pack" });
    const child = physicalItem({ id: "rope", containerId: "pack" });
    const coins = physicalItem({ id: "coins", isCurrency: true, quantity: 100 });
    const evidence = buildActorSourceEvidence({ items: [container, child, coins] });

    expect(evidence.findings).toEqual([]);
    expect(evidence.sourceGroups.map((group: { sourceId: string }) => group.sourceId)).toEqual([
      "Compendium.pf2e.equipment-srd.Item.pack",
      "Compendium.pf2e.equipment-srd.Item.rope",
    ]);
  });

  it("fails closed on invalid quantities, currency, containers, and runtime IDs", () => {
    const result = qualifySmokeResult(
      resultFixture({
        currencyCopper: Number.NaN,
        items: [physicalItem({ id: "", quantity: Number.NaN, containerId: "missing" })],
      })
    );

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining([
        "invalid-actor-currency",
        "invalid-container-id",
        "invalid-item-quantity",
        "missing-item-id",
      ])
    );
  });

  it("keeps the complete nullable acquisition envelope on character-build evidence", () => {
    const input = resultFixture();
    const result = qualifySmokeResult(input);

    expect(result.cases[0].evidence.acquisition).toEqual(emptyAcquisitionEvidence());
    expect(result.qualification.passed).toBe(true);
  });

  it("fails closed on an unknown case-kind contract", () => {
    const result = qualifySmokeResult(resultFixture(), [{ id: "case", caseKind: "skip-evidence" }]);
    expect(result.qualification.passed).toBe(false);
    expect(findingCodes(result)).toContain("invalid-case-kind");
  });

  it("qualifies only an exact registry-bound pre-review physical-grant rejection with zero actor writes", () => {
    const input = resultFixture() as any;
    const actor = {
      ...input.cases[0].actor,
      levelAfterApply: 1,
      moduleDraftAfterApply: { version: 5, targetLevel: 5 },
      moduleStateAfterApply: emptyModuleState(),
    };
    const registryBlocker = {
      code: "unsupported-physical-grant",
      routeId: "inventor-armor-innovation",
      reasonCode: "unprofiled-native-grant",
      sourceSlotId: "class-branch-innovation-level-1",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.fpwtpm8pdwO1I6MO",
      message: "Inventor Armor Innovation is not supported by Wayfinder starting equipment.",
    };
    const activeRoute = {
      routeId: registryBlocker.routeId,
      classification: "unsupported-handoff",
      preReview: true,
      reasonCode: registryBlocker.reasonCode,
      sourceUuid: registryBlocker.sourceUuid,
      sourceSlotId: registryBlocker.sourceSlotId,
    };
    const expectedOutcome = {
      kind: "registered-physical-grant-rejection",
      ...activeRoute,
      activeRoutes: [activeRoute],
    };
    input.cases[0].actor = actor;
    input.cases[0].evidence.applyReview = { confirmationMessage: null, reviewLines: [] };
    input.cases[0].evidence.expectedRejection = {
      kind: "registered-physical-grant-rejection",
      expectedOutcome,
      registryRoute: structuredClone(physicalGrantRouteById(expectedOutcome.routeId)),
      registryRoutes: [structuredClone(physicalGrantRouteById(expectedOutcome.routeId))],
      registryBlockers: [registryBlocker],
      rejection: {
        errorName: "StartingEquipmentPhysicalGrantCoverageError",
        isTypedProductRejection: true,
        blocker: structuredClone(registryBlocker),
        message: registryBlocker.message,
      },
      confirmationMessage: null,
      actorBefore: structuredClone(actor),
      actorAfter: structuredClone(actor),
      actorSourceFingerprintBefore: "a".repeat(64),
      actorSourceFingerprintAfter: "a".repeat(64),
    };
    const definition = {
      id: "case",
      caseKind: "expected-rejection",
      expectedOutcome,
    };

    expect(qualifySmokeResult(input, [definition]).qualification.passed).toBe(true);

    for (const mutate of [
      (value: any) => (value.cases[0].evidence.expectedRejection.confirmationMessage = "Review?"),
      (value: any) => (value.cases[0].evidence.expectedRejection.registryBlockers[0].routeId = ""),
      (value: any) => (value.cases[0].evidence.expectedRejection.registryRoute.routeId = "different-route"),
      (value: any) => (value.cases[0].evidence.expectedRejection.actorAfter.currencyCopper += 1),
      (value: any) => (value.cases[0].evidence.expectedRejection.actorSourceFingerprintAfter = "b".repeat(64)),
      (value: any) => (value.cases[0].evidence.acquisition.manifest = { id: "forged" }),
    ]) {
      const drifted = structuredClone(input);
      mutate(drifted);
      expect(qualifySmokeResult(drifted, [definition]).qualification.passed).toBe(false);
      expect(findingCodes(qualifySmokeResult(drifted, [definition]))).toEqual(
        expect.arrayContaining([expect.stringMatching(/expected-rejection|expected-physical-grant/u)])
      );
    }
  });

  it("binds a character-build retain-all manifest to the exact durable module state", () => {
    const input = resultFixture() as any;
    const manifest = {
      id: "manifest-id",
      actorId: "actor-id",
      disposition: "retain-all",
      fingerprint: "manifest-fingerprint",
    };
    input.cases[0].actor.moduleStateAfterApply.completedAcquisitionManifest = structuredClone(manifest);
    input.cases[0].evidence.acquisition = {
      ...emptyAcquisitionEvidence(),
      policy: { source: "completed-acquisition-manifest" },
      currency: {
        preCopper: 0,
        budgetCopper: 1500,
        targetCopper: 1500,
        observedCopper: 1500,
        spentCopper: 0,
        remainingCopper: 1500,
      },
      manifest: structuredClone(manifest),
    };

    const matched = qualifySmokeResult(input);
    expect(matched.qualification).toMatchObject({ passed: true, unreviewedFindingCount: 0 });

    const mismatched = structuredClone(input);
    mismatched.cases[0].evidence.acquisition.manifest.id = "foreign-manifest-id";
    const rejected = qualifySmokeResult(mismatched);
    expect(rejected.qualification.passed).toBe(false);
    expect(findingCodes(rejected)).toContain("character-build-state-mismatch");
  });

  it("fails closed when any character-build acquisition envelope field is absent", () => {
    for (const mutate of [
      (input: any) => delete input.cases[0].evidence.acquisition,
      (input: any) => {
        input.cases[0].evidence.acquisition = null;
      },
      (input: any) => delete input.cases[0].evidence.acquisition.currency.preCopper,
      (input: any) => {
        input.cases[0].evidence.acquisition = {
          mode: "retain-all",
          disposition: "retain-all",
          draftCleared: true,
          manifestCorrupt: false,
          manifest: null,
          initialManifestId: null,
          finalManifestId: null,
          secondAcquisitionPrevented: null,
        };
      },
    ]) {
      const input = resultFixture() as any;
      mutate(input);

      const result = qualifySmokeResult(input);

      expect(result.qualification.passed).toBe(false);
      expect(findingCodes(result)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^invalid-acquisition-(?:currency-)?envelope$/u)])
      );
    }
  });

  it("qualifies an exact nonempty spell-attestation receipt and captured Apply review", () => {
    const result = qualifySmokeResult(spellAttestationResult(), [spellAttestationDefinition()]);

    expect(result.qualification).toMatchObject({ passed: true, unreviewedFindingCount: 0 });
  });

  it("rejects malformed or contextually foreign spell-attestation receipts", () => {
    const mutations = [
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.version = 2;
      },
      (input: any) => {
        delete input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations;
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.unexpected = true;
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].subject.actorId =
          "copied-actor";
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].subject.targetLevel = 4;
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].subject.stepLevel = 4;
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].subject.destinationKey =
          "different-destination";
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].unexpected = true;
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].subject.unexpected = true;
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].selectedSpells[0].unexpected = true;
      },
      (input: any) => {
        const selected =
          input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].selectedSpells;
        selected.push(structuredClone(selected[0]));
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].selectedSpells[0].itemType =
          "feat";
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].selectedSpells[0].name =
          "Wrong Spell";
      },
      (input: any) => {
        input.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations[0].selectedSpells[0].packId =
          "wrong.pack";
      },
    ];
    for (const mutate of mutations) {
      const input = spellAttestationResult() as any;
      mutate(input);

      const result = qualifySmokeResult(input, [spellAttestationDefinition()]);

      expect(result.qualification.passed).toBe(false);
      expect(findingCodes(result)).toContain("character-build-state-mismatch");
    }
  });

  it("binds spell-attestation expectations to basis, reason, ceilings, and selected spell UUIDs", () => {
    for (const mutate of [
      (definition: any) => {
        definition.expectedAppliedSpellRarityAttestations[0].claimedBasis = "reported-gm-permission";
      },
      (definition: any) => {
        definition.expectedAppliedSpellRarityAttestations[0].reason = "Different reason";
      },
      (definition: any) => {
        definition.expectedAppliedSpellRarityAttestations[0].stepRarityCeiling = "uncommon";
      },
      (definition: any) => {
        definition.expectedAppliedSpellRarityAttestations[0].selectedSpells[0].uuid = "different-uuid";
      },
    ]) {
      const definition = spellAttestationDefinition() as any;
      mutate(definition);

      const result = qualifySmokeResult(spellAttestationResult(), [definition]);

      expect(result.qualification.passed).toBe(false);
      expect(findingCodes(result)).toContain("character-build-state-mismatch");
    }
  });

  it("rejects retained drafts and incomplete Apply confirmation disclosure", () => {
    const retained = spellAttestationResult() as any;
    retained.cases[0].actor.moduleDraftAfterApply = { version: 13 };
    const missingDisclosure = spellAttestationResult() as any;
    missingDisclosure.cases[0].evidence.applyReview.confirmationMessage = "Apply to actor?";

    const retainedResult = qualifySmokeResult(retained, [spellAttestationDefinition()]);
    const disclosureResult = qualifySmokeResult(missingDisclosure, [spellAttestationDefinition()]);

    expect(findingCodes(retainedResult)).toContain("character-build-state-mismatch");
    expect(findingCodes(disclosureResult)).toContain("apply-review-evidence-mismatch");
  });

  it("requires complete policy, currency, and manifest evidence for an acquisition success", () => {
    const smokeCase = resultFixture().cases[0];
    expect(validateAcquisitionEvidence(smokeCase).map((finding: { code: string }) => finding.code)).toEqual(
      expect.arrayContaining([
        "missing-policy-provenance",
        "invalid-acquisition-currency",
        "missing-manifest-identity",
        "invalid-manifest-version",
      ])
    );
    const result = qualifySmokeResult(resultFixture(), [{ id: "case", caseKind: "acquisition" }]);
    expect(result.qualification.passed).toBe(false);
  });

  it("reconciles acquisition currency and canonical manifest entries to the actor snapshot", () => {
    const valid = qualifySmokeResult(successfulAcquisitionResult(), [{ id: "case", caseKind: "acquisition" }]);
    const invalidInput = successfulAcquisitionResult();
    invalidInput.cases[0].actor.currencyCopper = 500;
    invalidInput.cases[0].evidence.acquisition.currency = {
      preCopper: 1000,
      budgetCopper: 1001,
      targetCopper: 1,
      observedCopper: 999,
      spentCopper: 1,
      remainingCopper: 777,
    };
    invalidInput.cases[0].evidence.acquisition.manifest.entries[0].quantity = 2;
    const invalid = qualifySmokeResult(invalidInput, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(valid)).toEqual([]);
    expect(valid.qualification.passed).toBe(true);
    expect(findingCodes(invalid)).toEqual(
      expect.arrayContaining([
        "actor-currency-mismatch",
        "currency-absolute-target-mismatch",
        "currency-ledger-mismatch",
        "currency-target-mismatch",
        "manifest-quantity-mismatch",
      ])
    );
  });

  it("accepts a truthful before-currency failure and rejects arbitrary boundary evidence", () => {
    const input = successfulAcquisitionResult();
    input.cases[0].actor.currencyCopper = 0;
    input.cases[0].evidence.acquisition.currency.observedCopper = 0;
    input.cases[0].evidence.acquisition.failureSnapshot = {
      point: "currency-before",
      batchId: "batch-id",
      afterItemIndex: null,
      currencyOperationIndex: null,
      message: "Intentional failure before the first currency operation.",
      actualItemIds: ["acquired-item"],
      observedCurrencyCopper: 0,
      manifestId: null,
      draftPresent: true,
    };
    input.cases[0].evidence.acquisition.manifest = null;
    const valid = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);
    const invalidInput = structuredClone(input);
    invalidInput.cases[0].evidence.acquisition.failureSnapshot.point = "arbitrary-point";
    const invalid = qualifySmokeResult(invalidInput, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(valid)).toEqual([]);
    expect(valid.qualification.passed).toBe(true);
    expect(findingCodes(invalid)).toContain("invalid-failure-point");
  });

  it("rejects failure item ids that do not exactly match the observed partial batch", () => {
    const input = successfulAcquisitionResult();
    input.cases[0].actor.items = [];
    input.cases[0].actor.currencyCopper = 0;
    input.cases[0].evidence.acquisition.currency.observedCopper = 0;
    input.cases[0].evidence.acquisition.failureSnapshot = {
      point: "item-after",
      batchId: "batch-id",
      afterItemIndex: 1,
      currencyOperationIndex: null,
      message: "Intentional failure after the first item.",
      actualItemIds: ["ghost-item"],
      observedCurrencyCopper: 0,
      manifestId: null,
      draftPresent: true,
    };
    input.cases[0].evidence.acquisition.manifest = null;
    const result = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(["failure-batch-item-set-mismatch", "missing-failure-item"])
    );
    expect(result.qualification.passed).toBe(false);
  });

  it("rejects nonphysical or currency documents stamped as acquisition outputs", () => {
    const input = successfulAcquisitionResult();
    Object.assign(input.cases[0].actor.items[0], {
      type: "action",
      isPhysical: false,
      quantity: null,
    });
    input.cases[0].actor.currencyCopper = 0;
    input.cases[0].evidence.acquisition.currency.observedCopper = 0;
    input.cases[0].evidence.acquisition.failureSnapshot = {
      point: "item-after",
      batchId: "batch-id",
      afterItemIndex: 1,
      currencyOperationIndex: null,
      message: "Intentional failure after the first item.",
      actualItemIds: ["acquired-item"],
      observedCurrencyCopper: 0,
      manifestId: null,
      draftPresent: true,
    };
    input.cases[0].evidence.acquisition.manifest = null;
    const result = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(["failure-item-identity-mismatch", "invalid-acquisition-item-kind"])
    );
    expect(result.qualification.passed).toBe(false);
  });

  it("requires requested and observed case ids to match exactly", () => {
    const empty = resultFixture();
    (empty as { cases: unknown[] }).cases = [];
    expect(() => qualifySmokeResult(empty, [{ id: "case" }])).toThrow(/coverage mismatch/u);

    const incremental = resultFixture();
    incremental.cases[0].id = "case-incremental-existing";
    expect(() => qualifySmokeResult(incremental, [{ id: "case" }])).toThrow(/coverage mismatch/u);
    expect(qualifySmokeResult(incremental, [{ id: "case-incremental-existing" }]).qualification.passed).toBe(true);
  });

  it("requires exact structured evidence for every requested Apply safety checkpoint", () => {
    const definition = applySafetyDefinition("phase:singleton-replacements:before");
    const missing = qualifySmokeResult(resultFixture(), [definition]);
    const validInput = resultFixture() as any;
    validInput.cases[0].evidence.applySafety = applySafetyEvidence();
    const valid = qualifySmokeResult(validInput, [definition]);

    expect(findingCodes(missing)).toContain("missing-apply-safety-evidence");
    expect(missing.qualification.passed).toBe(false);
    expect(findingCodes(valid)).toEqual([]);
    expect(valid.qualification.passed).toBe(true);
  });

  it("qualifies a post-final lost acknowledgement only with exact ordinal, state, receipts, and retry", () => {
    const definition = applySafetyDefinition("write:final-actor-update:after");
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = finalAfterApplySafetyEvidence();
    const valid = qualifySmokeResult(input, [definition]);

    expect(findingCodes(valid)).toEqual([]);
    expect(valid.qualification.passed).toBe(true);

    const forged = resultFixture() as any;
    forged.cases[0].evidence.applySafety = finalAfterApplySafetyEvidence();
    forged.cases[0].evidence.applySafety.injectedCheckpoint.ordinal = 7;
    forged.cases[0].evidence.applySafety.observedCheckpoint.ordinal = 7;
    forged.cases[0].evidence.applySafety.partialReceipt.actorUpdatePaths = ["forged.path"];
    const rejected = qualifySmokeResult(forged, [definition]);

    expect(findingCodes(rejected)).toEqual(
      expect.arrayContaining([
        "invalid-apply-safety-injected-checkpoint",
        "invalid-apply-safety-observed-checkpoint",
        "apply-safety-final-write-receipt-mismatch",
      ])
    );
    expect(rejected.qualification.passed).toBe(false);
  });

  it("accepts an after-currency checkpoint with a surviving PF2E currency-document delta", () => {
    const definition = applySafetyDefinition("write:currency-convergence:after");
    const coin = physicalItem({
      id: "currency-item",
      name: "Gold Pieces",
      type: "treasure",
      sourceId: "Compendium.pf2e.equipment-srd.Item.gold-pieces",
      isCurrency: true,
      quantity: 14,
    });
    const expectedIdentity = "treasure||Compendium.pf2e.equipment-srd.Item.gold-pieces|Gold Pieces";
    Object.assign(definition, {
      expectedItemCount: 1,
      expectedItemIdentities: [expectedIdentity],
      expectedItemSemanticIdentities: [
        `${expectedIdentity}::destination=::location=::training=::grant=::container=::quantity=14::physical=true::currency=true`,
      ],
    });
    const input = resultFixture({ items: [coin], currencyCopper: 1400 }) as any;
    input.cases[0].actor.itemCount = 1;
    input.cases[0].evidence.applySafety = currencyAfterApplySafetyEvidence();

    const result = qualifySmokeResult(input, [definition]);
    expect(findingCodes(result)).toEqual([]);
    expect(result.qualification.passed).toBe(true);
  });

  it("rejects surplus final actor update paths", () => {
    const definition = applySafetyDefinition("write:final-actor-update:after");
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = finalAfterApplySafetyEvidence();
    input.cases[0].evidence.applySafety.partialReceipt.actorUpdatePaths.push("system.details.level.value");

    const result = qualifySmokeResult(input, [definition]);

    expect(findingCodes(result)).toContain("apply-safety-final-write-receipt-mismatch");
    expect(result.qualification.passed).toBe(false);
  });

  it("accepts an exact case-pinned final actor update path set", () => {
    const definition = applySafetyDefinition("write:final-actor-update:after");
    definition.expectedFinalActorUpdatePaths.push("system.details.level.value");
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = finalAfterApplySafetyEvidence();
    input.cases[0].evidence.applySafety.partialReceipt.actorUpdatePaths.push("system.details.level.value");

    const result = qualifySmokeResult(input, [definition]);

    expect(findingCodes(result)).toEqual([]);
    expect(result.qualification.passed).toBe(true);
  });

  it("rejects impossible repeated final actor write occurrences", () => {
    const definition = applySafetyDefinition("write:final-actor-update:after");
    definition.applySafetyFailureCheckpoint.occurrence = 2;
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = finalAfterApplySafetyEvidence();
    input.cases[0].evidence.applySafety.target.occurrence = 2;
    input.cases[0].evidence.applySafety.matchingOccurrence = 2;
    input.cases[0].evidence.applySafety.injectedCheckpoint.ordinal = 2;
    input.cases[0].evidence.applySafety.observedCheckpoint.ordinal = 2;

    const result = qualifySmokeResult(input, [definition]);

    expect(findingCodes(result)).toContain("invalid-apply-safety-definition");
    expect(result.qualification.passed).toBe(false);
  });

  it("pins the complete skill-rank and ability-boost outcomes", () => {
    const definition = {
      ...applySafetyDefinition("phase:singleton-replacements:before"),
      expectedExactSkillRanks: { acrobatics: 2, athletics: 2, intimidation: 1 },
      expectedAbilityBoosts: {
        1: ["str", "dex", "con", "wis"],
        5: ["str", "dex", "con", "wis"],
        class: "str",
      },
    };
    const validInput = resultFixture() as any;
    validInput.cases[0].actor.skillRanks = { acrobatics: 2, athletics: 2, intimidation: 1 };
    validInput.cases[0].actor.abilityBoosts = {
      1: ["wis", "con", "dex", "str"],
      5: ["str", "dex", "con", "wis"],
      class: "str",
    };
    validInput.cases[0].evidence.applySafety = applySafetyEvidence();
    expect(qualifySmokeResult(validInput, [definition]).qualification.passed).toBe(true);

    const changed = structuredClone(validInput);
    changed.cases[0].actor.skillRanks.intimidation = 4;
    changed.cases[0].actor.abilityBoosts.class = "cha";
    const changedResult = qualifySmokeResult(changed, [definition]);
    expect(findingCodes(changedResult)).toEqual(
      expect.arrayContaining(["defined-exact-skill-ranks-mismatch", "defined-ability-boosts-mismatch"])
    );
    expect(changedResult.qualification.passed).toBe(false);

    const surplus = structuredClone(validInput);
    surplus.cases[0].actor.skillRanks.religion = 1;
    const surplusResult = qualifySmokeResult(surplus, [definition]);
    expect(findingCodes(surplusResult)).toContain("defined-exact-skill-ranks-mismatch");
    expect(surplusResult.qualification.passed).toBe(false);
  });

  it("rejects stale, malformed, or incomplete Apply safety evidence", () => {
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = applySafetyEvidence();
    Object.assign(input.cases[0].evidence.applySafety, {
      matchingOccurrence: 2,
      completedReceipts: [phaseReceipt("singleton-replacements")],
      partialReceipt: phaseReceipt("class-branches"),
    });
    input.cases[0].evidence.applySafety.failureState.draftMatchesAttempt = false;
    input.cases[0].evidence.applySafety.target.checkpointId = "phase:class-branches:before";
    input.cases[0].evidence.applySafety.observedCheckpoint.operation = "forged-operation";
    const result = qualifySmokeResult(input, [applySafetyDefinition("phase:singleton-replacements:before")]);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining([
        "apply-safety-target-mismatch",
        "apply-safety-occurrence-mismatch",
        "invalid-apply-safety-observed-checkpoint",
        "apply-safety-state-mismatch",
        "apply-safety-completed-receipt-mismatch",
        "apply-safety-partial-phase-mismatch",
      ])
    );
    expect(result.qualification.passed).toBe(false);
  });

  it("rejects unrequested Apply safety evidence", () => {
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = applySafetyEvidence();
    const result = qualifySmokeResult(input);

    expect(findingCodes(result)).toContain("unexpected-apply-safety-evidence");
    expect(result.qualification.passed).toBe(false);
  });

  it("never lets a GM review waive missing structural Apply safety evidence", () => {
    const definition = applySafetyDefinition("phase:source-flag-restoration:before");
    const unreviewed = qualifySmokeResult(resultFixture(), [definition]);
    const findingId = unreviewed.cases[0].evidence.contract.findings.find(
      (entry: { code: string }) => entry.code === "missing-apply-safety-evidence"
    ).id;
    const reviewed = qualifySmokeResult(resultFixture(), [
      {
        ...definition,
        reviewedFindings: [
          {
            findingId,
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "A review cannot replace required failure and retry evidence.",
          },
        ],
      },
    ]);

    expect(findingCodes(reviewed)).toEqual(
      expect.arrayContaining(["missing-apply-safety-evidence", "non-reviewable-review-record"])
    );
    expect(reviewed.qualification.passed).toBe(false);
  });

  it("reconciles Apply receipts and retry claims against observed actor state", () => {
    const definition = applySafetyDefinition("phase:singleton-replacements:before");
    const impossibleReceipt = resultFixture() as any;
    impossibleReceipt.cases[0].evidence.applySafety = applySafetyEvidence();
    impossibleReceipt.cases[0].evidence.applySafety.partialReceipt.createdItemIds = ["ghost-item"];
    const receiptResult = qualifySmokeResult(impossibleReceipt, [definition]);
    expect(findingCodes(receiptResult)).toEqual(expect.arrayContaining(["apply-safety-item-reconciliation-mismatch"]));

    const contradictoryRetry = resultFixture() as any;
    contradictoryRetry.cases[0].evidence.applySafety = applySafetyEvidence();
    contradictoryRetry.cases[0].actor.levelAfterApply = 1;
    contradictoryRetry.cases[0].actor.moduleDraftAfterApply = { targetLevel: 5 };
    contradictoryRetry.cases[0].actor.moduleStateAfterApply = emptyModuleState();
    const retryResult = qualifySmokeResult(contradictoryRetry, [definition]);
    expect(findingCodes(retryResult)).toContain("apply-safety-retry-mismatch");
    expect(retryResult.qualification.passed).toBe(false);
  });

  it("binds the original and rebuilt retry plans to the checked case definition", () => {
    for (const forgedStepIds of [[], ["forged-step"]]) {
      const input = resultFixture() as any;
      input.cases[0].evidence.applySafety = applySafetyEvidence();
      input.cases[0].evidence.applySafety.failureState.recoveredPlanStepIds = forgedStepIds;
      input.cases[0].evidence.applySafety.retryPlan.stepIds = forgedStepIds;
      input.cases[0].actor.moduleStateAfterApply.completedStepIds = ["step", ...forgedStepIds];

      const result = qualifySmokeResult(input, [applySafetyDefinition("phase:singleton-replacements:before")]);
      expect(findingCodes(result)).toContain("apply-safety-retry-mismatch");
      expect(result.qualification.passed).toBe(false);
    }
  });

  it("pins the safety fixture to a fresh level-one actor with empty module history", () => {
    const definition = applySafetyDefinition("phase:singleton-replacements:before");
    const mutations = [
      (input: any) => {
        input.cases[0].evidence.applySafety.failureState.preApplyLevel = 2;
        input.cases[0].evidence.applySafety.failureState.observedLevel = 2;
      },
      (input: any) => {
        input.cases[0].evidence.applySafety.failureState.preApplyItemIds = ["forged-item"];
        input.cases[0].evidence.applySafety.failureState.observedItemIds = ["forged-item"];
        input.cases[0].evidence.applySafety.retry.preRetryItemIds = ["forged-item"];
      },
      (input: any) => {
        input.cases[0].evidence.applySafety.failureState.preApplyModuleState.completedStepIds = ["forged-step"];
        input.cases[0].evidence.applySafety.failureState.observedModuleState.completedStepIds = ["forged-step"];
        input.cases[0].actor.moduleStateAfterApply.completedStepIds = ["forged-step", "step"];
      },
      (input: any) => {
        const history = {
          version: 1,
          importedAt: "2026-08-16T11:00:00.000Z",
          actorLevel: 1,
          entries: [],
        };
        input.cases[0].evidence.applySafety.failureState.preApplyModuleState.existingCharacterHistory = history;
        input.cases[0].evidence.applySafety.failureState.observedModuleState.existingCharacterHistory = history;
        input.cases[0].actor.moduleStateAfterApply.existingCharacterHistory = history;
      },
    ];

    for (const mutate of mutations) {
      const input = resultFixture() as any;
      input.cases[0].evidence.applySafety = applySafetyEvidence();
      mutate(input);

      const result = qualifySmokeResult(input, [definition]);
      expect(findingCodes(result)).toContain("apply-safety-state-mismatch");
      expect(result.qualification.passed).toBe(false);
    }
  });

  it("rejects unknown fields in exact ModuleState snapshots", () => {
    const definition = applySafetyDefinition("phase:singleton-replacements:before");
    const input = resultFixture() as any;
    input.cases[0].evidence.applySafety = applySafetyEvidence();
    input.cases[0].evidence.applySafety.failureState.preApplyModuleState.unexpected = "retained";
    input.cases[0].evidence.applySafety.failureState.observedModuleState.unexpected = "retained";

    const result = qualifySmokeResult(input, [definition]);

    expect(findingCodes(result)).toContain("apply-safety-state-mismatch");
    expect(result.qualification.passed).toBe(false);
  });

  it("rejects impossible receipt boundaries, overlapping buckets, and unreported item updates", () => {
    const boundary = resultFixture() as any;
    boundary.cases[0].evidence.applySafety = applySafetyEvidence();
    boundary.cases[0].evidence.applySafety.partialReceipt.createdItemIds = ["ghost-item"];
    const boundaryResult = qualifySmokeResult(boundary, [applySafetyDefinition("phase:singleton-replacements:before")]);
    expect(findingCodes(boundaryResult)).toContain("apply-safety-partial-item-boundary-mismatch");

    const overlap = resultFixture() as any;
    overlap.cases[0].evidence.applySafety = finalAfterApplySafetyEvidence();
    overlap.cases[0].evidence.applySafety.completedReceipts[0].createdItemIds = ["item-a"];
    overlap.cases[0].evidence.applySafety.completedReceipts[0].updatedItemIds = ["item-a"];
    overlap.cases[0].evidence.applySafety.completedReceipts[0].actorUpdatePaths = ["forged.path"];
    const overlapResult = qualifySmokeResult(overlap, [applySafetyDefinition("write:final-actor-update:after")]);
    expect(findingCodes(overlapResult)).toEqual(
      expect.arrayContaining([
        "apply-safety-overlapping-receipt-items",
        "apply-safety-unexpected-actor-update-paths",
        "apply-safety-receipt-count-mismatch",
      ])
    );

    const missingUpdate = resultFixture({ items: [physicalItem({ id: "item-a" })] }) as any;
    missingUpdate.cases[0].actor.itemCount = 1;
    missingUpdate.cases[0].evidence.applySafety = applySafetyEvidence();
    Object.assign(missingUpdate.cases[0].evidence.applySafety.failureState, {
      preApplyItemIds: ["item-a"],
      observedItemIds: ["item-a"],
      changedItemIds: ["item-a"],
    });
    Object.assign(missingUpdate.cases[0].evidence.applySafety.retry, {
      preRetryItemIds: ["item-a"],
      postRetryItemIds: ["item-a"],
    });
    const missingUpdateResult = qualifySmokeResult(missingUpdate, [
      applySafetyDefinition("phase:singleton-replacements:before"),
    ]);
    expect(findingCodes(missingUpdateResult)).toContain("apply-safety-missing-updated-item-receipt");
  });

  it("recomputes pinned actor item outcomes instead of trusting browser failures", () => {
    const input = resultFixture({ items: [physicalItem({ id: "unexpected-item", name: "Forager" })] }) as any;
    input.cases[0].actor.itemCount = 1;
    const result = qualifySmokeResult(input, [
      {
        id: "case",
        expectedItemCount: 0,
        expectedItemNameCounts: { Forager: 0 },
      },
    ]);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(["defined-item-count-mismatch", "defined-item-name-count-mismatch"])
    );
    expect(result.qualification.passed).toBe(false);
  });

  it("pins the complete final semantic item identity instead of names alone", () => {
    const expectedIdentity = "equipment||Compendium.pf2e.equipment-srd.Item.rope|Rope";
    const expectedSemanticIdentity = `${expectedIdentity}::destination=::location=::training=::grant=::container=::quantity=1::physical=true::currency=false`;
    const definition = {
      id: "case",
      expectedItemCount: 1,
      expectedItemNameCounts: { Rope: 1 },
      expectedItemIdentities: [expectedIdentity],
      expectedItemSemanticIdentities: [expectedSemanticIdentity],
    };
    const valid = resultFixture({ items: [physicalItem()] }) as any;
    valid.cases[0].actor.itemCount = 1;
    expect(qualifySmokeResult(valid, [definition]).qualification.passed).toBe(true);

    const forged = structuredClone(valid);
    forged.cases[0].actor.items[0].sourceId = "Compendium.pf2e.equipment-srd.Item.unrelated";
    const result = qualifySmokeResult(forged, [definition]);
    expect(findingCodes(result)).toContain("defined-item-identity-mismatch");
    expect(result.qualification.passed).toBe(false);

    const misplaced = structuredClone(valid);
    misplaced.cases[0].actor.items[0].trainingKey = "wrong-training";
    const misplacedResult = qualifySmokeResult(misplaced, [definition]);
    expect(findingCodes(misplacedResult)).toContain("defined-item-semantic-identity-mismatch");
    expect(misplacedResult.qualification.passed).toBe(false);

    const falseCurrency = structuredClone(valid);
    falseCurrency.cases[0].actor.items[0].isCurrency = true;
    const falseCurrencyResult = qualifySmokeResult(falseCurrency, [definition]);
    expect(findingCodes(falseCurrencyResult)).toContain("defined-item-semantic-identity-mismatch");
    expect(falseCurrencyResult.qualification.passed).toBe(false);
  });

  it("requires complete actor authority evidence and a writable owner", () => {
    for (const mutate of [
      (input: any) => delete input.cases[0].actor.id,
      (input: any) => delete input.cases[0].actor.authority,
      (input: any) => {
        input.cases[0].actor.authority.canUpdate = false;
        input.cases[0].actor.authority.isOwner = false;
        input.cases[0].actor.authority.ownerPermission = false;
      },
    ]) {
      const input = resultFixture() as any;
      mutate(input);
      const result = qualifySmokeResult(input);
      expect(result.qualification.passed).toBe(false);
      expect(findingCodes(result)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^(?:missing-actor-id|invalid-actor-authority|insufficient-actor-authority)$/u),
        ])
      );
    }
  });

  it("requires every nullable item fact and a real, consistent grant-parent chain", () => {
    const incomplete = resultFixture({ items: [physicalItem()] }) as any;
    delete incomplete.cases[0].actor.items[0].location;
    const incompleteResult = qualifySmokeResult(incomplete);
    expect(findingCodes(incompleteResult)).toContain("incomplete-item-evidence");

    const ghost = resultFixture({
      items: [physicalItem({ id: "child", grantedById: "ghost-parent", grantAncestryIds: ["ghost-parent"] })],
    });
    const ghostResult = qualifySmokeResult(ghost);
    expect(findingCodes(ghostResult)).toContain("missing-grant-ancestor");

    const parent = physicalItem({
      id: "parent",
      name: "Parent",
      sourceId: "Compendium.pf2e.equipment-srd.Item.parent",
    });
    const inconsistent = resultFixture({
      items: [parent, physicalItem({ id: "child", grantedById: "parent", grantAncestryIds: [] })],
    });
    const inconsistentResult = qualifySmokeResult(inconsistent);
    expect(findingCodes(inconsistentResult)).toContain("grant-parent-mismatch");
  });

  it("rejects duplicate item IDs within one manifest entry", () => {
    const input = successfulAcquisitionResult();
    input.cases[0].evidence.acquisition.manifest.entries[0].actualItemIds = ["acquired-item", "acquired-item"];
    input.cases[0].evidence.acquisition.manifest.entries[0].quantity = 2;

    const result = qualifySmokeResult(input, [{ id: "case", caseKind: "acquisition" }]);

    expect(findingCodes(result)).toContain("missing-manifest-item-ids");
    expect(result.qualification.passed).toBe(false);
  });

  it("never converts malformed failed browser evidence into a passing case", () => {
    const input = resultFixture();
    input.cases[0].status = "fail";
    (input.cases[0] as { actor: unknown }).actor = null;
    (input.cases[0] as { failures: unknown }).failures = "fatal failure";
    const result = qualifySmokeResult(input);

    expect(result.qualification.passed).toBe(false);
    expect(findingCodes(result)).toEqual(expect.arrayContaining(["malformed-case-failures", "missing-actor-evidence"]));
  });

  it("fails an unreviewed classification and records a valid GM review by exact digest", () => {
    const input = resultFixture({ classifications: ["manual PF2E-native checkpoint"] });
    const unreviewed = qualifySmokeResult(input);
    const findingId = unreviewed.cases[0].evidence.contract.findings[0].id;
    const reviewed = qualifySmokeResult(input, [
      {
        id: "case",
        reviewedFindings: [
          {
            findingId,
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "The native checkpoint was inspected in the recorded Foundry run.",
          },
        ],
      },
    ]);

    expect(unreviewed.qualification).toMatchObject({ passed: false, unreviewedFindingCount: 1 });
    expect(reviewed.qualification).toMatchObject({ passed: true, reviewedFindingCount: 1 });
    expect(reviewed.cases[0].evidence.contract.findings[0].review).toMatchObject({ reviewerRole: "gm" });
  });

  it("rejects invalid and unused review records", () => {
    const result = qualifySmokeResult(resultFixture(), [
      {
        id: "case",
        reviewedFindings: [
          {
            findingId: "wf-smoke:manual-classification:not-observed",
            reviewerRole: "player",
            reviewedAt: "not-a-date",
            reason: "",
          },
          {
            findingId: "wf-smoke:manual-classification:also-not-observed",
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "This digest does not correspond to evidence from this run.",
          },
        ],
      },
    ]);

    expect(findingCodes(result)).toEqual(expect.arrayContaining(["invalid-review-record", "unused-review-record"]));
    expect(result.qualification.passed).toBe(false);
  });

  it("binds reviews to exact finding content and a current GM execution session", () => {
    const firstInput = resultFixture({ classifications: ["first observed fact"] });
    const first = qualifySmokeResult(firstInput);
    const firstFindingId = first.cases[0].evidence.contract.findings[0].id;
    const changed = qualifySmokeResult(resultFixture({ classifications: ["materially changed fact"] }));
    expect(changed.cases[0].evidence.contract.findings[0].id).not.toBe(firstFindingId);

    const nonGmInput = resultFixture({ classifications: ["first observed fact"] });
    nonGmInput.user = { id: "player-id", name: "Player", role: 1, isGM: false };
    const nonGm = qualifySmokeResult(nonGmInput, [
      {
        id: "case",
        reviewedFindings: [
          {
            findingId: firstFindingId,
            reviewerRole: "gm",
            reviewedAt: "2026-08-16T12:00:00.000Z",
            reason: "A prior GM record cannot authorize a player-executed evidence run.",
          },
        ],
      },
    ]);
    expect(findingCodes(nonGm)).toContain("non-gm-review-session");
    expect(nonGm.qualification.passed).toBe(false);
  });

  it("rejects evidence without the current-schema user role record", () => {
    const input = resultFixture();
    (input as { user: unknown }).user = "GM";
    expect(() => qualifySmokeResult(input)).toThrow(/complete user role record/u);
  });

  it("requires Foundry user role and isGM evidence to agree", () => {
    for (const user of [
      { id: "player-id", name: "Player", role: 1, isGM: true },
      { id: "gm-id", name: "GM", role: 4, isGM: false },
    ]) {
      const input = resultFixture();
      input.user = user;
      expect(() => qualifySmokeResult(input)).toThrow(/complete user role record/u);
    }
  });
});

const TEST_APPLY_PHASES = [
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

function applySafetyDefinition(checkpointId: string) {
  const [kind, operationOrPhase, boundary] = checkpointId.split(":");
  const phase =
    kind === "write"
      ? (
          {
            "embedded-item-create": "acquisition-items",
            "currency-convergence": "acquisition-currency",
            "final-actor-update": "finalize-actor",
          } as Record<string, string>
        )[operationOrPhase]
      : operationOrPhase;
  const completedCount =
    TEST_APPLY_PHASES.indexOf(phase) + (checkpointId.startsWith("phase:") && boundary === "after" ? 1 : 0);
  return {
    id: "case",
    targetLevel: 5,
    expectedPreApply: {
      level: 1,
      itemCount: 0,
      moduleState: emptyModuleState(),
    },
    expectedItemCount: 0,
    expectedItemIdentities: [],
    expectedItemSemanticIdentities: [],
    expectedExactSkillRanks: {},
    expectedAbilityBoosts: {},
    expectedFinalActorUpdatePaths: ["flags.wayfinder-pf2e.draft", "flags.wayfinder-pf2e.state"],
    expectedPreStepIds: ["step"],
    expectedRetryStepIds: ["step"],
    expectedCompletedReceiptCounts: Object.fromEntries(
      TEST_APPLY_PHASES.slice(0, completedCount).map((completedPhase) => [
        completedPhase,
        { created: 0, deleted: 0, updated: 0 },
      ])
    ),
    expectedCompletedReceiptIdentities: {},
    applySafetyFailureCheckpoint: {
      checkpointId,
      occurrence: 1,
    },
  };
}

function resultFixture(
  overrides: { classifications?: string[]; currencyCopper?: number; items?: Array<Record<string, unknown>> } = {}
) {
  return {
    schemaVersion: SMOKE_EVIDENCE_SCHEMA_VERSION,
    user: { id: "user-id", name: "User", role: 4, isGM: true },
    cases: [
      {
        id: "case",
        label: "Case",
        status: overrides.classifications?.length ? "classified" : "pass",
        actor: {
          id: "actor-id",
          authority: {
            canUpdate: true,
            defaultOwnershipLevel: 0,
            explicitOwnershipLevel: 3,
            isOwner: true,
            ownerPermission: true,
          },
          currencyCopper: overrides.currencyCopper ?? 1500,
          items: overrides.items ?? [],
          itemCount: overrides.items?.length ?? 0,
          levelAfterApply: 5,
          moduleDraftAfterApply: null,
          moduleStateAfterApply: appliedModuleState(),
          skillRanks: {},
          abilityBoosts: {},
        },
        classifications: overrides.classifications ?? [],
        evidence: {
          acquisition: emptyAcquisitionEvidence(),
          applyReview: {
            confirmationMessage: "Apply 1 step to Actor?",
            reviewLines: [],
          },
          preStepIds: ["step"],
          rerunStepIds: [],
        },
        failures: [],
        warnings: [],
      },
    ],
    summary: { passed: 1, classified: 0, failed: 0 },
  };
}

function physicalItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-id",
    name: "Rope",
    type: "equipment",
    sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
    isPhysical: true,
    isCurrency: false,
    quantity: 1,
    containerId: null,
    grantedById: null,
    grantAncestryIds: [],
    slotId: null,
    trainingKey: null,
    destinationKey: null,
    location: null,
    acquisition: null,
    ...overrides,
  };
}

function acquisitionIdentity(overrides: Record<string, unknown> = {}) {
  return {
    draftId: "draft-id",
    batchId: "batch-id",
    lineId: "line-id",
    entryId: "entry-id",
    stackingIntent: "aggregate",
    ...overrides,
  };
}

function successfulAcquisitionResult() {
  const item = physicalItem({
    id: "acquired-item",
    acquisition: acquisitionIdentity({ stackingIntent: "aggregate" }),
  });
  const result = resultFixture({ currencyCopper: 500, items: [item] });
  result.cases[0].evidence.acquisition = {
    binding: null,
    policy: { source: "world", version: "1", fingerprint: "policy-sha256" },
    currency: {
      preCopper: 0,
      budgetCopper: 1500,
      targetCopper: 500,
      observedCopper: 500,
      spentCopper: 1000,
      remainingCopper: 500,
    },
    durability: null,
    manifest: {
      id: "manifest-id",
      schemaVersion: 1,
      batchId: "batch-id",
      entries: [
        {
          lineId: "line-id",
          entryId: "entry-id",
          sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
          quantity: 1,
          actualItemIds: ["acquired-item"],
          containerId: null,
          grantAncestryIds: [],
        },
      ],
    },
    failureSnapshot: null,
    retry: null,
  };
  return result;
}

function emptyAcquisitionEvidence() {
  return {
    binding: null,
    policy: null,
    currency: {
      preCopper: null,
      budgetCopper: null,
      targetCopper: null,
      observedCopper: null,
      spentCopper: null,
      remainingCopper: null,
    },
    durability: null,
    manifest: null,
    failureSnapshot: null,
    retry: null,
  };
}

function applySafetyEvidence() {
  const checkpoint = {
    checkpointId: "phase:singleton-replacements:before",
    kind: "phase",
    phase: "singleton-replacements",
    boundary: "before",
    operation: null,
    ordinal: null,
  };
  return {
    target: { checkpointId: checkpoint.checkpointId, occurrence: 1 },
    matchingOccurrence: 1,
    injectedCheckpoint: { ...checkpoint },
    observedCheckpoint: { ...checkpoint },
    failureKind: "checkpoint-hook",
    completedReceipts: [],
    partialReceipt: phaseReceipt("singleton-replacements"),
    failureState: {
      expected: "pre-final",
      preApplyLevel: 1,
      observedLevel: 1,
      draftPresent: true,
      draftMatchesAttempt: true,
      preApplyItemIds: [],
      observedItemIds: [],
      changedItemIds: [],
      preApplyModuleState: emptyModuleState(),
      observedModuleState: emptyModuleState(),
      stateLastTargetLevel: null,
      recoveredPlanStepIds: ["step"],
    },
    retryPlan: {
      strategy: "rebuild-from-recovered-draft",
      stepIds: ["step"],
    },
    retry: {
      lifecycleKind: "applied",
      draftCleared: true,
      targetLevelReached: true,
      rerunStepCount: 0,
      preRetryItemIds: [],
      postRetryItemIds: [],
    },
    message: `Wayfinder apply failed during singleton-replacements at ${checkpoint.checkpointId}. Intentional failure.`,
  };
}

function currencyAfterApplySafetyEvidence() {
  const checkpoint = {
    checkpointId: "write:currency-convergence:after",
    kind: "write",
    phase: "acquisition-currency",
    boundary: "after",
    operation: "currency-convergence",
    ordinal: 1,
  };
  const completedPhases = TEST_APPLY_PHASES.slice(0, TEST_APPLY_PHASES.indexOf("acquisition-currency"));
  return {
    target: { checkpointId: checkpoint.checkpointId, occurrence: 1 },
    matchingOccurrence: 1,
    injectedCheckpoint: { ...checkpoint },
    observedCheckpoint: { ...checkpoint },
    failureKind: "checkpoint-hook",
    completedReceipts: completedPhases.map(phaseReceipt),
    partialReceipt: {
      ...phaseReceipt("acquisition-currency"),
      createdItemIds: ["currency-item"],
    },
    failureState: {
      expected: "pre-final",
      preApplyLevel: 1,
      observedLevel: 1,
      draftPresent: true,
      draftMatchesAttempt: true,
      preApplyItemIds: [],
      observedItemIds: ["currency-item"],
      changedItemIds: [],
      preApplyModuleState: emptyModuleState(),
      observedModuleState: emptyModuleState(),
      stateLastTargetLevel: null,
      recoveredPlanStepIds: ["step"],
    },
    retryPlan: {
      strategy: "rebuild-from-recovered-draft",
      stepIds: ["step"],
    },
    retry: {
      lifecycleKind: "applied",
      draftCleared: true,
      targetLevelReached: true,
      rerunStepCount: 0,
      preRetryItemIds: ["currency-item"],
      postRetryItemIds: ["currency-item"],
    },
    message: `Wayfinder apply failed during acquisition-currency at ${checkpoint.checkpointId}. Intentional failure.`,
  };
}

function finalAfterApplySafetyEvidence() {
  const checkpoint = {
    checkpointId: "write:final-actor-update:after",
    kind: "write",
    phase: "finalize-actor",
    boundary: "after",
    operation: "final-actor-update",
    ordinal: 1,
  };
  const completedPhases = [
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
  ];
  return {
    target: { checkpointId: checkpoint.checkpointId, occurrence: 1 },
    matchingOccurrence: 1,
    injectedCheckpoint: { ...checkpoint },
    observedCheckpoint: { ...checkpoint },
    failureKind: "checkpoint-hook",
    completedReceipts: completedPhases.map(phaseReceipt),
    partialReceipt: {
      ...phaseReceipt("finalize-actor"),
      actorUpdatePaths: ["flags.wayfinder-pf2e.draft", "flags.wayfinder-pf2e.state"],
    },
    failureState: {
      expected: "post-final",
      preApplyLevel: 1,
      observedLevel: 5,
      draftPresent: false,
      draftMatchesAttempt: false,
      preApplyItemIds: [],
      observedItemIds: [],
      changedItemIds: [],
      preApplyModuleState: emptyModuleState(),
      observedModuleState: appliedModuleState(),
      stateLastTargetLevel: 5,
    },
    retryPlan: {
      strategy: "lost-ack-replay",
      stepIds: ["step"],
    },
    retry: {
      lifecycleKind: "applied",
      draftCleared: true,
      targetLevelReached: true,
      rerunStepCount: 0,
      preRetryItemIds: [],
      postRetryItemIds: [],
    },
    message: `Wayfinder apply failed during finalize-actor at ${checkpoint.checkpointId}. Intentional failure.`,
  };
}

function phaseReceipt(phase: string) {
  return {
    phase,
    createdItemIds: [],
    deletedItemIds: [],
    updatedItemIds: [],
    actorUpdatePaths: [],
  };
}

function emptyModuleState() {
  return {
    version: 4,
    lastAppliedAt: null,
    lastTargetLevel: null,
    completedStepIds: [],
    existingCharacterHistory: null,
    lastAppliedSpellRarityAttestations: [],
    completedAcquisitionManifest: null,
    completedAcquisitionManifestCorrupt: false,
  };
}

function appliedModuleState() {
  return {
    version: 4,
    lastAppliedAt: "2026-08-16T12:00:00.000Z",
    lastTargetLevel: 5,
    completedStepIds: ["step"],
    existingCharacterHistory: null,
    lastAppliedSpellRarityAttestations: [],
    completedAcquisitionManifest: null,
    completedAcquisitionManifestCorrupt: false,
  };
}

function spellAttestationDefinition() {
  return {
    id: "case",
    targetLevel: 5,
    expectedAppliedSpellRarityAttestations: [
      {
        slotId: "step",
        stepId: "step",
        stepLevel: 5,
        destinationKey: "wizard-spellbook",
        stepRarityCeiling: "common",
        worldRarityCeiling: "common",
        claimedBasis: "rules-access",
        reason: "The character has rules Access.",
        selectedSpells: [
          {
            uuid: "Compendium.pf2e.spells-srd.Item.restricted",
            name: "Restricted Spell",
            level: 3,
          },
        ],
      },
    ],
  };
}

function spellAttestationResult() {
  const result = resultFixture();
  const attestation = {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "attested",
    subject: {
      actorId: "actor-id",
      slotId: "step",
      stepId: "step",
      targetLevel: 5,
      stepLevel: 5,
      destinationKey: "wizard-spellbook",
      stepRarityCeiling: "common",
      worldRarityCeiling: "common",
    },
    claimedBasis: "rules-access",
    reason: "The character has rules Access.",
    authorUserId: "user-id",
    authorName: "User",
    attestedAt: "2026-08-16T11:59:00.000Z",
    subjectLabel: "Level 5 spellbook additions",
    selectedSpells: [
      {
        slotId: "step",
        packId: "pf2e.spells-srd",
        documentId: "restricted",
        uuid: "Compendium.pf2e.spells-srd.Item.restricted",
        itemType: "spell",
        featType: null,
        name: "Restricted Spell",
        level: 3,
        slug: "restricted-spell",
      },
    ],
  };
  result.cases[0].actor.moduleStateAfterApply.lastAppliedSpellRarityAttestations = [attestation];
  const reviewLine =
    "Access note, the player's word and not a Wayfinder check: Level 5 spellbook additions; A character or rules Access; Restricted Spell; written by User at 2026-08-16T11:59:00.000Z; reason: The character has rules Access.";
  result.cases[0].evidence.applyReview = {
    confirmationMessage: `Apply 1 step to Actor?\n\n${reviewLine}`,
    reviewLines: [reviewLine],
  };
  return result;
}

function findingCodes(result: any): string[] {
  return result.cases[0].evidence.contract.findings.map((finding: { code: string }) => finding.code);
}
