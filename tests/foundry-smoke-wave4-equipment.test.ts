import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createWave4EquipmentArtifactDirectory } from "../tools/foundry-smoke/wave4-equipment-artifacts.mjs";
import {
  BATTLEZOO_ADJACENT_PACK_ID,
  BATTLEZOO_EQUIPMENT_PACK_ID,
  validateWave4EquipmentCaseDefinition,
  wave4EquipmentCases,
} from "../tools/foundry-smoke/wave4-equipment-cases.mjs";
import { qualifyWave4EquipmentResult } from "../tools/foundry-smoke/wave4-equipment-evidence.mjs";

const runner = readFileSync(resolve("tools/foundry-smoke/run-wave4-equipment-smoke.mjs"), "utf8");
const browserSuite = readFileSync(resolve("tools/foundry-smoke/wave4-equipment-browser-suite.js"), "utf8");
const wave2Cases = readFileSync(resolve("tools/foundry-smoke/acquisition-cases.mjs"), "utf8");

describe("Foundry Wave 4 equipment live gate", () => {
  it("pins the exact three-case/two-actor breadth matrix", () => {
    expect(wave4EquipmentCases.map((entry: any) => entry.id)).toEqual([
      "physical-prepared-boundaries",
      "adventurers-pack-retry",
      "supplemental-source-isolation",
    ]);
    expect(wave4EquipmentCases.every((entry: any) => validateWave4EquipmentCaseDefinition(entry).length === 0)).toBe(
      true
    );
    const physical = wave4EquipmentCases[0] as any;
    expect(physical.physicalItems.map((entry: any) => entry.itemType)).toEqual([
      "ammo",
      "armor",
      "backpack",
      "consumable",
      "equipment",
      "shield",
      "weapon",
    ]);
    expect((wave4EquipmentCases[1] as any).kit.children).toHaveLength(9);
    expect((wave4EquipmentCases[1] as any).kit.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Chalk", itemType: "consumable", quantity: 10 }),
        expect.objectContaining({ name: "Torch", itemType: "equipment", quantity: 5 }),
      ])
    );
    expect((wave4EquipmentCases[2] as any).supplemental).toMatchObject({
      name: "Salt Stake",
      expectedAvailable: true,
      expectedEligible: true,
      expectedPriceCopper: 0,
      expectedUnavailableReasonCodes: [],
    });
    expect(BATTLEZOO_EQUIPMENT_PACK_ID).not.toBe(BATTLEZOO_ADJACENT_PACK_ID);
  });

  it("keeps the frozen Wave 2 tracer separate and guards exact settings cleanup", () => {
    expect(runner).not.toContain("acquisition-cases.mjs");
    expect(browserSuite).not.toContain("__runWayfinderAcquisitionTracer");
    expect(browserSuite).toContain("__runWayfinderWave4PlayerInitial");
    expect(browserSuite).toContain("__runWayfinderWave4PlayerRetry");
    expect(browserSuite).toContain("__runWayfinderWave4GmProbe");
    expect(browserSuite).toContain("__runWayfinderWave4PlayerVerification");
    expect(browserSuite).toContain("compendiumBrowserPacks");
    expect(browserSuite).toContain("ignoreAsGM");
    expect(browserSuite).toContain("packsRestored");
    expect(browserSuite).toContain("sourcesRestored");
    expect(wave2Cases).toContain("equipment-l1-owner-common-purchase-retry");
  });

  it("qualifies exact physical, kit retry, containment, source isolation, and cleanup evidence", () => {
    const result = passingResult();
    expect(qualifyWave4EquipmentResult(result as any)).toEqual({ ok: true, failures: [] });

    result.cases[1].evidence.initial.currencyCopper = 1;
    result.cases[2].evidence.gmSources.effectivePackIds.push(BATTLEZOO_ADJACENT_PACK_ID);
    const qualification = qualifyWave4EquipmentResult(result as any);
    expect(qualification.ok).toBe(false);
    expect(qualification.failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/zero currency/i), expect.stringMatching(/GM and player/i)])
    );
  });

  it("rejects dead listed-magic data, unapplied physical breadth, generic kit faults, and denied source authority", () => {
    const listedMagic = passingResult();
    listedMagic.cases[0].evidence.listedMagic.price.linePriceCopper += 1;
    expect(qualifyWave4EquipmentResult(listedMagic).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/Candlecap/i)])
    );

    const unapplied = passingResult();
    unapplied.cases[0].evidence.execution.inventory.items.pop();
    expect(qualifyWave4EquipmentResult(unapplied).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/materialize/i)])
    );

    const genericFault = passingResult();
    genericFault.cases[1].evidence.initial.failure = "generic write checkpoint";
    expect(qualifyWave4EquipmentResult(genericFault).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/child drift|partial failure/i)])
    );

    const missingDriftProof = passingResult();
    missingDriftProof.cases[1].evidence.initial.childDrift.message = "";
    expect(qualifyWave4EquipmentResult(missingDriftProof).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/child drift/i)])
    );

    const deniedSource = passingResult();
    deniedSource.cases[2].evidence.saltAuthority.sourceBasis = "source-not-allowed";
    deniedSource.cases[2].evidence.saltAuthority.unavailableReasonCodes.push("source-not-allowed");
    expect(qualifyWave4EquipmentResult(deniedSource).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/allowed supplemental pack/i)])
    );

    const missingPriceInsteadOfExplicitZero = passingResult();
    missingPriceInsteadOfExplicitZero.cases[2].evidence.saltStake.available = false;
    missingPriceInsteadOfExplicitZero.cases[2].evidence.saltStake.priceCopper = null;
    missingPriceInsteadOfExplicitZero.cases[2].evidence.saltStake.unavailableReason =
      "This item has no indexed base Price.";
    missingPriceInsteadOfExplicitZero.cases[2].evidence.saltAuthority.eligible = false;
    missingPriceInsteadOfExplicitZero.cases[2].evidence.saltAuthority.unavailableReasonCodes = ["price-missing"];
    expect(qualifyWave4EquipmentResult(missingPriceInsteadOfExplicitZero).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/explicit-zero/i)])
    );
  });

  it("requires a fresh ignored artifact directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-wave4-artifacts-"));
    try {
      const directory = await createWave4EquipmentArtifactDirectory(root, "", "evidence-1");
      expect(directory).toBe(join(root, ".wayfinder-smoke", "wave4-equipment-evidence-1"));
      await expect(createWave4EquipmentArtifactDirectory(root, "", "evidence-1")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function passingResult(): any {
  const [physicalDefinition, kitDefinition, sourceDefinition] = wave4EquipmentCases as any;
  const backpackId = "actual-backpack";
  const observedItems = kitDefinition.kit.children.map((child: any, index: number) => ({
    plannedItemId: `planned-${index}`,
    actualItemId: index === 0 ? backpackId : `actual-${index}`,
    actualSourceUuid: child.sourceUuid,
    actualQuantity: child.quantity,
    plannedContainerId: index === 0 ? null : "planned-container",
    actualContainerId: index === 0 ? null : backpackId,
  }));
  const manifest = {
    id: "manifest-1",
    fingerprint: "manifest-fingerprint",
    entries: [{ kitExpansion: { profile: "adventurers-pack-v1" }, observedItems }],
  };
  const physicalLines = physicalDefinition.physicalItems.map((expected: any) => ({
    expected,
    line: {
      sourceUuid: expected.sourceUuid,
      price: {
        size: "large",
        unitPriceCopper: 20,
        linePriceCopper: 20,
        pricePer: expected.expectedPricePer ?? 1,
        sourceQuantity: expected.expectedSourceQuantity ?? 1,
        materializedQuantity: expected.expectedMaterializedQuantity ?? 1,
      },
    },
  }));
  const physicalObserved = physicalDefinition.physicalItems.map((expected: any, index: number) => ({
    plannedItemId: `physical-planned-${index}`,
    actualItemId: `physical-actual-${index}`,
    actualSourceUuid: expected.sourceUuid,
    actualQuantity:
      expected.sourceUuid === physicalDefinition.stackProbe.sourceUuid
        ? physicalDefinition.stackProbe.expectedMaterializedQuantity
        : (expected.expectedMaterializedQuantity ?? 1),
  }));
  const kitItems = kitDefinition.kit.children.map((child: any) => ({
    ...child,
    documentFingerprint: `doc-${child.expansionPath}`,
  }));
  const effectivePackIds = [sourceDefinition.supplemental.packId, "pf2e.equipment-srd"].sort();
  const sourceProjection = {
    effectivePackIds,
    enabledSourceSlugs: ["battlezoo-bestiary"],
    knownSourceSlugs: ["battlezoo-bestiary"],
    showEmptySources: false,
    showUnknownSources: false,
    ignoreAsGM: true,
    defaultLoadAbsent: true,
    equipmentDescriptors: [sourceDefinition.supplemental.packId, "pf2e.equipment-srd"],
  };
  return {
    schemaVersion: 1,
    runtime: { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.7.5", worldId: "testing-world" },
    users: {
      gm: { id: "gm-1", name: "smoke", isGM: true, role: 4 },
      player: { id: "player-1", name: "wf-smoke-player", isGM: false, role: 1 },
    },
    zeroWrite: { denied: true, unchanged: true },
    cases: [
      {
        id: physicalDefinition.id,
        status: "pass",
        definitionFingerprint: physicalDefinition.definitionFingerprint,
        evidence: {
          lines: physicalLines,
          stackLine: {
            sourceUuid: physicalDefinition.stackProbe.sourceUuid,
            stackingIntent: "aggregate",
            price: {
              requestedQuantity: physicalDefinition.stackProbe.requestedQuantity,
              materializedQuantity: physicalDefinition.stackProbe.expectedMaterializedQuantity,
            },
          },
          listedMagic: {
            sourceUuid: physicalDefinition.listedMagic.sourceUuid,
            price: {
              size: "large",
              sizeSensitive: physicalDefinition.listedMagic.expectedSizeSensitive,
              unitPriceCopper: physicalDefinition.listedMagic.expectedUnitPriceCopper,
              linePriceCopper: physicalDefinition.listedMagic.expectedUnitPriceCopper,
            },
          },
          treasure: {
            sourceUuid: physicalDefinition.treasure.sourceUuid,
            available: false,
            unavailableReason: physicalDefinition.treasure.expectedDiagnostic,
          },
          overlay: {
            definition: physicalDefinition.preciousMaterialOverlay,
            line: {
              sourceUuid: physicalDefinition.preciousMaterialOverlay.sourceUuid,
              price: {
                size: "large",
                preciousMaterial: true,
                adjustedBulkPriceCopper: 3_500,
                unitPriceCopper: 3_500,
                linePriceCopper: 3_500,
              },
            },
          },
          execution: {
            beforeCreateOrdinals: [1, 2, 3, 4, 5, 6, 7],
            inventory: {
              items: physicalDefinition.physicalItems.map((expected: any) => ({
                type: expected.itemType,
                sourceUuid: expected.sourceUuid,
                quantity:
                  expected.sourceUuid === physicalDefinition.stackProbe.sourceUuid
                    ? physicalDefinition.stackProbe.expectedMaterializedQuantity
                    : (expected.expectedMaterializedQuantity ?? 1),
                acquisition: { plannedItemId: `physical-${expected.itemType}` },
              })),
            },
            manifest: {
              entries: physicalObserved.map((observed: any) => ({ observedItems: [observed] })),
            },
          },
        },
      },
      {
        id: kitDefinition.id,
        status: "pass",
        definitionFingerprint: kitDefinition.definitionFingerprint,
        evidence: {
          spray: { sourceUuid: kitDefinition.smallDiagnostics.exact.sourceUuid, price: { linePriceCopper: 1 } },
          candleMessage: kitDefinition.smallDiagnostics.unavailable.expectedMessage,
          kitLine: {
            sourceUuid: kitDefinition.kit.sourceUuid,
            price: { linePriceCopper: 150 },
            kitExpansion: { items: kitItems },
          },
          initial: {
            childDrift: {
              message: `Acquisition kit child ${kitDefinition.kit.faultChildExpansionPath} drifted before Apply.`,
              sourceUuid: kitDefinition.kit.faultChildSourceUuid,
              replacementSourceUuid: kitDefinition.kit.faultChildReplacementSourceUuid,
              createdItemCount: 0,
              currencyCopper: 0,
            },
            beforeCreateOrdinals: [1, 2, 3, 4, 5],
            failure: `Wave 4 forced partial kit write failure before child ${kitDefinition.kit.faultChildSourceUuid} create ordinal ${kitDefinition.kit.failBeforeCreateOrdinal}.`,
            createdItemCount: 4,
            currencyCopper: 0,
            manifest: null,
          },
          retry: { beforeCreateOrdinals: [1, 2, 3, 4, 5], createdItemCount: 9, currencyCopper: 1_350, manifest },
          final: {
            inventory: {
              currencyCopper: 1_350,
              items: kitDefinition.kit.children.map((child: any, index: number) => ({
                id: index === 0 ? backpackId : `actual-${index}`,
                type: child.itemType,
                containerId: index === 0 ? null : backpackId,
                acquisition: { plannedItemId: `planned-${index}` },
              })),
            },
            noopUnchanged: true,
            durableManifest: manifest,
            recoveredManifest: manifest,
          },
        },
      },
      {
        id: sourceDefinition.id,
        status: "pass",
        definitionFingerprint: sourceDefinition.definitionFingerprint,
        evidence: {
          playerSources: structuredClone(sourceProjection),
          gmSources: structuredClone(sourceProjection),
          saltStake: {
            sourceUuid: sourceDefinition.supplemental.sourceUuid,
            itemType: sourceDefinition.supplemental.itemType,
            available: sourceDefinition.supplemental.expectedAvailable,
            priceCopper: sourceDefinition.supplemental.expectedPriceCopper,
            unavailableReason: null,
          },
          saltAuthority: {
            eligible: sourceDefinition.supplemental.expectedEligible,
            sourceBasis: sourceDefinition.supplemental.expectedSourceBasis,
            unavailableReasonCodes: sourceDefinition.supplemental.expectedUnavailableReasonCodes,
          },
        },
      },
    ],
    cleanup: {
      actorsDeleted: 2,
      actorsMissingAfterCleanup: true,
      policyRestored: true,
      packsRestored: true,
      sourcesRestored: true,
    },
  };
}
