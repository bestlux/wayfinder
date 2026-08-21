import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  validateWave3EquipmentCaseDefinition,
  wave3EquipmentCases,
} from "../tools/foundry-smoke/wave3-equipment-cases.mjs";
import { qualifyWave3EquipmentResult } from "../tools/foundry-smoke/wave3-equipment-evidence.mjs";

const runner = readFileSync(resolve("tools/foundry-smoke/run-wave3-equipment-smoke.mjs"), "utf8");
const browserSuite = readFileSync(resolve("tools/foundry-smoke/wave3-equipment-browser-suite.js"), "utf8");
const wave2Cases = readFileSync(resolve("tools/foundry-smoke/acquisition-cases.mjs"), "utf8");

describe("Foundry Wave 3 equipment live gate", () => {
  it("pins an exact, independently fingerprinted Wave 3 matrix", () => {
    expect(wave3EquipmentCases.map((entry: any) => entry.id)).toEqual([
      "level-5-lump-sum",
      "level-20-permanent-items",
      "level-5-custom-lump-sum",
      "level-5-extra-allowance",
      "configured-item-exception",
    ]);
    expect(wave3EquipmentCases.every((entry: any) => validateWave3EquipmentCaseDefinition(entry).length === 0)).toBe(
      true
    );
    expect(new Set(wave3EquipmentCases.map((entry: any) => entry.definitionFingerprint)).size).toBe(
      wave3EquipmentCases.length
    );
  });

  it("keeps the Wave 2 tracer frozen while providing a separate guarded two-role lane", () => {
    expect(runner).not.toContain("acquisition-cases.mjs");
    expect(browserSuite).not.toContain("__runWayfinderAcquisitionTracer");
    expect(browserSuite).toContain("__runWayfinderWave3PlayerStart");
    expect(browserSuite).toContain("__runWayfinderWave3GmApproval");
    expect(browserSuite).toContain("__runWayfinderWave3PlayerVerification");
    expect(browserSuite).toContain("expectedWorldId");
    expect(browserSuite).toContain("allowDestructive");
    expect(browserSuite).toContain("changed guarded identity");
    expect(wave2Cases).toContain("equipment-l1-owner-common-purchase-retry");
  });

  it("fails qualification without distinct roles and exact zero-write denial", () => {
    const result = passingResult();
    result.users.player = { ...result.users.gm };
    result.zeroWrite.unchanged = false;

    expect(qualifyWave3EquipmentResult(result as any).failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/non-GM/i),
        expect.stringMatching(/same user/i),
        expect.stringMatching(/zero actor/i),
      ])
    );
  });

  it("qualifies exact recipes, exception scope, configured components, ABP, and typed handoff", () => {
    const result = passingResult();
    expect(qualifyWave3EquipmentResult(result as any)).toEqual({ ok: true, failures: [] });

    const configured = result.cases.find((entry: any) => entry.id === "configured-item-exception");
    configured.configuredLine.price.configurationComponents.propertyRuneCopper += 1;
    configured.handoff.typedDisposition = null;
    const qualification = qualifyWave3EquipmentResult(result as any);
    expect(qualification.ok).toBe(false);
    expect(qualification.failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/component sum/i), expect.stringMatching(/typed/i)])
    );
  });
});

function passingResult(): any {
  const cases = wave3EquipmentCases.map((definition: any) => {
    const base = {
      id: definition.id,
      status: "pass",
      definitionFingerprint: definition.definitionFingerprint,
      actorId: `actor-${definition.id}`,
      targetLevel: definition.targetLevel,
      subject: {
        actorId: `actor-${definition.id}`,
        draftId: `draft-${definition.id}`,
        targetLevel: definition.targetLevel,
      },
      recipe: expectedRecipe(definition),
      startEvidence: { kind: "gm-confirmation" },
    };
    if (!definition.configuredItem) return base;
    return {
      ...base,
      abp: { mode: "noABP", enabled: false, actorOverrideDisabled: false },
      configuredLine: {
        sourceUuid: definition.configuredItem.sourceUuid,
        price: {
          unitPriceCopper: 445_600,
          configurationComponents: {
            version: 1,
            itemType: "weapon",
            baseItem: "elven-curve-blade",
            baselineAndFundamentalCopper: 200_000,
            propertyRuneCopper: 140_000,
            preciousMaterialCopper: 105_600,
            suppressedByAbp: [],
            prepared: { totalCopper: 445_600 },
          },
        },
      },
      approvedExceptionSourceUuids: [definition.configuredItem.sourceUuid],
      handoff: {
        sourceUuid: definition.handoffItem.sourceUuid,
        message: definition.handoffItem.message,
        persistedExceptionApproved: false,
        economicWritesUnchanged: true,
        typedDisposition: {
          kind: "handoff",
          handoff: {
            version: 1,
            kind: "pf2e-sheet",
            baselineFingerprint: "baseline-configured",
            reasons: [
              {
                code: "unsafe-configured-item",
                sourceUuid: definition.handoffItem.sourceUuid,
                itemName: definition.handoffItem.name,
                issue: "specific-magic-item",
              },
            ],
          },
          acknowledgedByUserId: null,
          acknowledgedAt: null,
        },
      },
    };
  });
  return {
    schemaVersion: 1,
    runtime: {
      foundryVersion: "14.366",
      pf2eVersion: "8.4.1",
      moduleVersion: "0.7.5",
      worldId: "testing-world",
    },
    users: {
      gm: { id: "gm-1", name: "smoke", isGM: true, role: 4 },
      player: { id: "player-1", name: "wf-smoke-player", isGM: false, role: 1 },
    },
    zeroWrite: { denied: true, unchanged: true },
    cases,
  };
}

function expectedRecipe(definition: any) {
  if (!definition.expected) {
    return {
      kind: "permanent-items",
      currencyCopper: 450_000,
      allowances: [{ allowanceId: "gm-extra:configured", itemLevel: definition.targetLevel }],
    };
  }
  if (definition.expected.kind !== "permanent-items") return { ...definition.expected };
  return {
    kind: "permanent-items",
    currencyCopper: definition.expected.currencyCopper,
    allowances: definition.expected.allowanceLevels.map((itemLevel: number, index: number) => ({
      allowanceId: `allowance-${index}`,
      itemLevel,
    })),
  };
}
