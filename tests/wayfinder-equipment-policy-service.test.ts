import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";
import {
  assertEquipmentApplyAuthority,
  createOwnerStartAttestation,
  normalizePf2eEquipmentSources,
  resolveActorAbpSnapshot,
  resolveEquipmentPolicyForActor,
  saveEquipmentWorldPolicy,
  saveTrustedEquipmentPolicyJudgment,
} from "../src/wayfinder/application/equipment-policy-service";
import { WayfinderGmCommandAuthorityError } from "../src/wayfinder/application/gm-command-authority";
import { DEFAULT_EQUIPMENT_WORLD_POLICY } from "../src/wayfinder/domain/equipment-policy";
import { acquisitionFixture } from "./fixtures/acquisition-fixture";

const globals = globalThis as typeof globalThis & { game: any; CONST: any };

describe("equipment policy service", () => {
  beforeEach(() => {
    globals.game = {
      user: { id: "gm-1", name: "Game Master", isGM: true },
      system: { id: "pf2e" },
      settings: { set: vi.fn(), get: vi.fn() },
      packs: [],
      pf2e: {},
    };
    globals.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  });

  it("normalizes PF2E equipment packs and known publication sources without GM-only broadening", () => {
    expect(
      normalizePf2eEquipmentSources({
        availablePackIds: ["pf2e.equipment-srd", "battlezoo.items", "other.items"],
        allowedPackFamilies: ["pf2e", "battlezoo"],
        compendiumBrowserPacks: {
          equipment: { "battlezoo.items": { load: false }, "pf2e.equipment-srd": { load: true } },
        },
        compendiumBrowserSources: {
          sources: { "player-core": { load: true }, hidden: { load: false } },
          showEmptySources: true,
          showUnknownSources: false,
          ignoreAsGM: true,
        },
      })
    ).toEqual({
      effectivePackIds: ["pf2e.equipment-srd"],
      enabledSourceSlugs: ["player-core"],
      knownSourceSlugs: ["hidden", "player-core"],
      showEmptySources: true,
      showUnknownSources: false,
    });
  });

  it("uses PF2E's effective ABP API and preserves mode and actor override", () => {
    const actor = { flags: { pf2e: { disableABP: true } } };
    expect(
      resolveActorAbpSnapshot(actor, {
        settings: { variants: { abp: "ABPRulesAsWritten" } },
        variantRules: { AutomaticBonusProgression: { isEnabled: vi.fn(() => false) } },
      })
    ).toEqual({ enabled: false, mode: "ABPRulesAsWritten", actorOverrideDisabled: true });
  });

  it("persists GM judgments in the restricted authority store with exact facts", async () => {
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) => {
      if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments) return { version: 1, judgments: [] };
      return null;
    });
    await expect(
      saveTrustedEquipmentPolicyJudgment({
        id: "judgment-1",
        facts: { kind: "custom-lump-sum", actorId: "actor-1", draftId: "draft-1", targetLevel: 5, amountCopper: 1234 },
        reason: "Campaign replacement budget",
        recordedAt: "2026-08-18T20:00:00.000Z",
        user: { id: "owner-1", isGM: false },
      })
    ).rejects.toBeInstanceOf(WayfinderGmCommandAuthorityError);

    const saved = await saveTrustedEquipmentPolicyJudgment({
      id: "judgment-1",
      facts: { kind: "custom-lump-sum", actorId: "actor-1", draftId: "draft-1", targetLevel: 5, amountCopper: 1234 },
      reason: "Campaign replacement budget",
      recordedAt: "2026-08-18T20:00:00.000Z",
      user: { id: "gm-1", name: "Game Master", isGM: true },
    });
    expect(saved).toMatchObject({
      authorUserId: "gm-1",
      authorName: "Game Master",
      reason: "Campaign replacement budget",
    });
    expect(globals.game.settings.set).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.equipmentPolicyJudgments,
      expect.objectContaining({ judgments: [saved] })
    );
  });

  it("resolves only authority-store judgments and records owner attestations when delegated", async () => {
    const ownerUser = { id: "owner-1", name: "Owner", isGM: false };
    const actor = {
      id: "actor-1",
      type: "character",
      isOwner: true,
      flags: {},
      testUserPermission: vi.fn((user: unknown) => user === ownerUser),
    };
    const start = await trustedStart();
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) => {
      if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicy) return DEFAULT_EQUIPMENT_WORLD_POLICY;
      if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments) {
        return { version: 1, judgments: [start] };
      }
      if (moduleId === "pf2e" && key === "compendiumBrowserPacks") return {};
      if (moduleId === "pf2e" && key === "compendiumBrowserSources") return { sources: {} };
      return null;
    });
    expect(
      resolveEquipmentPolicyForActor({
        actor,
        draftId: "draft-1",
        targetLevel: 5,
        selectedRecipe: "permanent-items",
        higherLevelStartClaim: {
          kind: "gm-confirmation",
          judgmentId: start.id,
          startKind: "replacement-character",
        },
        availableEquipmentPackIds: ["pf2e.equipment-srd"],
      }).higherLevelStartEvidence
    ).toMatchObject({ kind: "gm-confirmation", judgment: { authorUserId: "gm-1" } });

    globals.game.user = { id: "owner-1", name: "Owner", isGM: false };
    const attestation = createOwnerStartAttestation({
      actor,
      draftId: "draft-1",
      targetLevel: 5,
      startKind: "replacement-character",
      reason: "Replacement character",
      recordedAt: "2026-08-18T21:00:00.000Z",
    });
    expect(attestation).toMatchObject({ authorUserId: "owner-1", reason: "Replacement character" });

    globals.game.user = { id: "gm-1", name: "Game Master", isGM: true };
    globals.game.users = { get: vi.fn(() => ownerUser) };
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) => {
      if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicy) {
        return { ...DEFAULT_EQUIPMENT_WORLD_POLICY, higherLevelStartAuthority: "actor-owner-attestation" };
      }
      if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments) return { version: 1, judgments: [] };
      if (moduleId === "pf2e" && key === "compendiumBrowserPacks") return {};
      if (moduleId === "pf2e" && key === "compendiumBrowserSources") return { sources: {} };
      return null;
    });
    expect(
      resolveEquipmentPolicyForActor({
        actor,
        draftId: "draft-1",
        targetLevel: 5,
        selectedRecipe: "permanent-items",
        higherLevelStartClaim: attestation,
        availableEquipmentPackIds: ["pf2e.equipment-srd"],
      }).higherLevelStartEvidence
    ).toEqual(attestation);
  });

  it("requires a current GM for policy writes", async () => {
    await expect(saveEquipmentWorldPolicy({}, { id: "owner-1", isGM: false })).rejects.toBeInstanceOf(
      WayfinderGmCommandAuthorityError
    );
    await saveEquipmentWorldPolicy({}, { id: "gm-1", isGM: true });
    expect(globals.game.settings.set).toHaveBeenCalledWith(MODULE_ID, SETTINGS.equipmentPolicy, expect.any(Object));
  });

  it("enforces the resolved Apply authority against the current actor and draft", () => {
    const actor = { id: "actor-1", type: "character", isOwner: true };
    const ownerDraft = acquisitionFixture().draft;
    globals.game.user = { id: "owner-1", isGM: false };
    expect(() => assertEquipmentApplyAuthority({ actor, acquisition: ownerDraft })).not.toThrow();

    const gmReview = structuredClone(ownerDraft) as any;
    gmReview.policySnapshot!.material.authorityPolicy.apply = "gm-review";
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicy
        ? { ...DEFAULT_EQUIPMENT_WORLD_POLICY, applyAuthority: "gm-review" }
        : null
    );
    expect(() => assertEquipmentApplyAuthority({ actor, acquisition: gmReview })).toThrow(
      WayfinderGmCommandAuthorityError
    );

    globals.game.user = { id: "gm-1", isGM: true };
    expect(() => assertEquipmentApplyAuthority({ actor, acquisition: gmReview })).not.toThrow();
    expect(() => assertEquipmentApplyAuthority({ actor: { ...actor, id: "actor-2" }, acquisition: gmReview })).toThrow(
      /does not match/i
    );

    const staleActorOwner = structuredClone(ownerDraft);
    expect(() => assertEquipmentApplyAuthority({ actor, acquisition: staleActorOwner })).toThrow(/changed/i);
  });
});

async function trustedStart() {
  globals.game.settings.get.mockReturnValue({ version: 1, judgments: [] });
  return saveTrustedEquipmentPolicyJudgment({
    id: "start-1",
    facts: {
      kind: "higher-level-start",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      startKind: "replacement-character",
    },
    reason: "Approved campaign start",
    recordedAt: "2026-08-18T20:00:00.000Z",
  });
}
