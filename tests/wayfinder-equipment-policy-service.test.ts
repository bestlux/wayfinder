import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";
import {
  assertEquipmentApplyAuthority,
  createOwnerStartAttestation,
  normalizePf2eEquipmentSources,
  resolveActorAbpSnapshot,
  resolveCurrentEquipmentSourceDiagnostics,
  resolveEquipmentPolicyForActor,
  revokeTrustedEquipmentPolicyJudgment,
  saveEquipmentWorldPolicy,
  saveTrustedEquipmentPolicyJudgment,
  saveTrustedEquipmentPolicyRequestDecline,
} from "../src/wayfinder/application/equipment-policy-service";
import { WayfinderGmCommandAuthorityError } from "../src/wayfinder/application/gm-command-authority";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyRequest,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
  type EquipmentPolicyJudgmentFacts,
  type EquipmentPolicyJudgmentRecord,
} from "../src/wayfinder/domain/equipment-policy";
import { acquisitionFixture } from "./fixtures/acquisition-fixture";

const globals = globalThis as typeof globalThis & { game: any; CONST: any };

describe("equipment policy service", () => {
  beforeEach(() => {
    globals.game = {
      user: { id: "gm-1", name: "Game Master", isGM: true },
      users: {
        get: vi.fn((id: string) =>
          id === "gm-1" ? { id: "gm-1", name: "Game Master", isGM: true } : { id, isGM: false }
        ),
      },
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
        installedEquipmentPacks: equipmentDescriptors(["pf2e.equipment-srd", "battlezoo.items", "other.items"]),
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
      diagnostics: [],
    });
  });

  it("defaults to the core equipment pack instead of treating every Item pack as equipment", () => {
    expect(
      normalizePf2eEquipmentSources({
        installedEquipmentPacks: equipmentDescriptors(["pf2e.equipment-srd"]),
        allowedPackFamilies: ["pf2e", "battlezoo"],
        compendiumBrowserPacks: {},
        compendiumBrowserSources: { sources: {} },
      }).effectivePackIds
    ).toEqual(["pf2e.equipment-srd"]);
  });

  it("adds only explicitly enabled equipment-tab packs and honors an explicit core disable", () => {
    expect(
      normalizePf2eEquipmentSources({
        installedEquipmentPacks: equipmentDescriptors(["pf2e.equipment-srd", "battlezoo.items"]),
        allowedPackFamilies: ["pf2e", "battlezoo"],
        compendiumBrowserPacks: {
          equipment: {
            "pf2e.equipment-srd": { load: false },
            "battlezoo.items": { load: true },
            "battlezoo.feats": { load: false },
          },
        },
        compendiumBrowserSources: { sources: {} },
      }).effectivePackIds
    ).toEqual(["battlezoo.items"]);
  });

  it("projects current source health without adding diagnostics to durable policy material", () => {
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) => {
      if (moduleId === "pf2e" && key === "compendiumBrowserPacks") {
        return { equipment: { "supplemental.missing-equipment": { load: true } } };
      }
      if (moduleId === "pf2e" && key === "compendiumBrowserSources") return { sources: {} };
      return null;
    });

    expect(
      resolveCurrentEquipmentSourceDiagnostics({
        policy: {
          sourcePolicy: {
            configuredPackFamilies: ["pf2e", "supplemental"],
            effectivePackIds: ["pf2e.equipment-srd"],
            enabledSourceSlugs: [],
            knownSourceSlugs: [],
            showEmptySources: false,
            showUnknownSources: false,
          },
        },
        installedEquipmentPacks: equipmentDescriptors(["pf2e.equipment-srd"]),
      })
    ).toEqual([
      {
        code: "equipment-pack-missing",
        packId: "supplemental.missing-equipment",
        sourceIdentity: null,
        message:
          "Enabled equipment pack supplemental.missing-equipment is not installed or is unavailable to the current user.",
      },
    ]);
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

  it("uses PF2E's class-shaped static ABP API with its receiver intact", () => {
    const actor = { flags: { pf2e: { disableABP: true } } };
    class AutomaticBonusProgression {
      static expectedActor = actor;

      static isEnabled(candidate: unknown): boolean {
        return this.expectedActor === candidate && !(candidate as typeof actor).flags.pf2e.disableABP;
      }
    }

    expect(
      resolveActorAbpSnapshot(actor, {
        settings: { variants: { abp: "ABPRulesAsWritten" } },
        variantRules: { AutomaticBonusProgression },
      })
    ).toEqual({ enabled: false, mode: "ABPRulesAsWritten", actorOverrideDisabled: true });
  });

  it("persists GM judgments in the restricted authority store with exact facts", async () => {
    let store: unknown = { version: 1, judgments: [] };
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) => {
      if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments) return store;
      return null;
    });
    globals.game.settings.set.mockImplementation(async (_moduleId: string, key: string, value: unknown) => {
      if (key === SETTINGS.equipmentPolicyJudgments) store = structuredClone(value);
      return value;
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
    const recovered = await saveTrustedEquipmentPolicyJudgment({
      id: "a-new-random-id-after-timeout",
      facts: { kind: "custom-lump-sum", actorId: "actor-1", draftId: "draft-1", targetLevel: 5, amountCopper: 1234 },
      reason: "Retry after an outcome-unknown response",
      recordedAt: "2026-08-18T20:05:00.000Z",
      user: { id: "gm-1", name: "Game Master", isGM: true },
    });
    expect(recovered).toEqual(saved);
    expect(globals.game.settings.set).toHaveBeenCalledWith(
      MODULE_ID,
      SETTINGS.equipmentPolicyJudgments,
      expect.objectContaining({ judgments: [saved] })
    );
  });

  it("refuses to approve a request after a GM has declined it", async () => {
    let store: unknown = { version: 1, judgments: [] };
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      store = structuredClone(value);
      return value;
    });
    const facts = {
      kind: "higher-level-start" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      startKind: "replacement-character" as const,
    };
    const request = createEquipmentPolicyRequest({
      requestId: "request-1",
      facts,
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-18T19:00:00.000Z",
      reason: "Replacement character",
    });
    const declined = await saveTrustedEquipmentPolicyRequestDecline({
      request,
      declinedAt: "2026-08-18T20:00:00.000Z",
      reason: "Use a new character start",
    });
    const retried = await saveTrustedEquipmentPolicyRequestDecline({
      request,
      declinedAt: "2026-08-18T20:02:00.000Z",
      reason: "Retry after the actor draft write failed",
    });
    expect(retried.decline).toEqual(declined.decline);

    await expect(
      saveTrustedEquipmentPolicyJudgment({
        id: "approval:request-1",
        facts,
        request,
        reason: "Late approval",
        recordedAt: "2026-08-18T20:01:00.000Z",
      })
    ).rejects.toThrow(/different authoritative decision/i);
    expect((store as { requestDecisions: { outcome: string }[] }).requestDecisions).toMatchObject([
      { outcome: "declined" },
    ]);
    expect((store as { requestDecisions: unknown[] }).requestDecisions).toHaveLength(1);
  });

  it("refuses to decline a request after a GM has approved it", async () => {
    let store: unknown = { version: 1, judgments: [] };
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      store = structuredClone(value);
      return value;
    });
    const facts = {
      kind: "higher-level-start" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      startKind: "replacement-character" as const,
    };
    const request = createEquipmentPolicyRequest({
      requestId: "request-1",
      facts,
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-18T19:00:00.000Z",
      reason: "Replacement character",
    });
    const approved = await saveTrustedEquipmentPolicyJudgment({
      id: "approval:request-1",
      facts,
      request,
      reason: "Approved",
      recordedAt: "2026-08-18T20:00:00.000Z",
    });
    const recovered = await saveTrustedEquipmentPolicyJudgment({
      id: "approval:request-1",
      facts,
      request,
      reason: "Retry after the actor draft write failed",
      recordedAt: "2026-08-18T20:02:00.000Z",
    });
    expect(recovered).toEqual(approved);
    expect((store as { judgments: unknown[] }).judgments).toHaveLength(1);

    await expect(
      saveTrustedEquipmentPolicyRequestDecline({
        request,
        declinedAt: "2026-08-18T20:01:00.000Z",
        reason: "Late decline",
      })
    ).rejects.toThrow(/different authoritative decision/i);
    expect((store as { requestDecisions: { outcome: string }[] }).requestDecisions).toMatchObject([
      { outcome: "approved" },
    ]);
  });

  it("revokes an approval with current GM provenance and read-back verification", async () => {
    let store: unknown = { version: 1, judgments: [] };
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      store = structuredClone(value);
      return value;
    });
    const approved = await saveTrustedEquipmentPolicyJudgment({
      id: "start-1",
      facts: {
        kind: "higher-level-start",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
        startKind: "replacement-character",
      },
      reason: "Approved replacement",
      recordedAt: "2026-08-18T20:00:00.000Z",
    });
    const revoked = await revokeTrustedEquipmentPolicyJudgment({
      judgmentId: approved.id,
      reason: "Replacement facts changed",
      revokedAt: "2026-08-18T21:00:00.000Z",
    });

    expect(revoked).toMatchObject({
      id: approved.id,
      request: { requesterUserId: "gm-1", requestedAt: "2026-08-18T20:00:00.000Z" },
      revocation: {
        revokedByUserId: "gm-1",
        revokedAt: "2026-08-18T21:00:00.000Z",
        reason: "Replacement facts changed",
      },
    });
    const reapproved = await saveTrustedEquipmentPolicyJudgment({
      id: "another-random-client-id",
      facts: approved.request.facts,
      reason: "Approved again after revocation",
      recordedAt: "2026-08-18T22:00:00.000Z",
    });
    expect(reapproved.id).not.toBe(approved.id);
    expect(reapproved.id).toMatch(/:2$/);
  });

  it("returns success when a delayed setting write committed before active-GM authority changed", async () => {
    let store: unknown = { version: 1, judgments: [] };
    let releaseWrite: (() => void) | null = null;
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const gm1 = { id: "gm-1", name: "Game Master", isGM: true, isActiveGM: true };
    const gm2 = { id: "gm-2", name: "Other GM", isGM: true, isActiveGM: false };
    const active = { current: gm1 };
    globals.game.user = gm1;
    globals.game.socket = { emit: vi.fn(), on: vi.fn() };
    globals.game.users = {
      get: vi.fn((id: string) => (id === gm1.id ? gm1 : id === gm2.id ? gm2 : null)),
      get activeGM() {
        return active.current;
      },
    };
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      store = structuredClone(value);
      await writeBlocked;
      return value;
    });

    const saving = saveTrustedEquipmentPolicyJudgment({
      id: "client-random-id",
      facts: {
        kind: "custom-lump-sum",
        actorId: "actor-1",
        draftId: "draft-delayed",
        targetLevel: 5,
        amountCopper: 5000,
      },
      reason: "Delayed committed write",
      recordedAt: "2026-08-18T20:00:00.000Z",
    });
    await vi.waitFor(() => expect(globals.game.settings.set).toHaveBeenCalledTimes(1));
    active.current = gm2;
    gm1.isActiveGM = false;
    gm2.isActiveGM = true;
    releaseWrite!();

    await expect(saving).resolves.toMatchObject({ reason: "Delayed committed write" });
  });

  it("serializes concurrent GM decisions before writing the full authority array", async () => {
    let store: unknown = { version: 1, judgments: [] };
    const firstWriteEntered = deferred<void>();
    const releaseFirstWrite = deferred<void>();
    let writeCount = 0;
    globals.game.users.get.mockImplementation((id: string) =>
      id === "gm-1" || id === "gm-2" ? { id, name: id === "gm-1" ? "First GM" : "Second GM", isGM: true } : null
    );
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteEntered.resolve();
        await releaseFirstWrite.promise;
      }
      store = structuredClone(value);
      return value;
    });

    const first = saveTrustedEquipmentPolicyJudgment({
      id: "decision-a",
      facts: customLumpSumFacts(1_000),
      reason: "First decision",
      recordedAt: "2026-08-18T20:00:00.000Z",
      user: { id: "gm-1", name: "First GM", isGM: true },
    });
    await firstWriteEntered.promise;
    const second = saveTrustedEquipmentPolicyJudgment({
      id: "decision-b",
      facts: customLumpSumFacts(2_000),
      reason: "Second decision",
      recordedAt: "2026-08-18T20:01:00.000Z",
      user: { id: "gm-2", name: "Second GM", isGM: true },
    });
    await Promise.resolve();
    releaseFirstWrite.resolve();
    await Promise.all([first, second]);

    expect(
      (store as { judgments: EquipmentPolicyJudgmentRecord[] }).judgments.map(
        (entry) => (entry.request.facts as { amountCopper: number }).amountCopper
      )
    ).toEqual([1_000, 2_000]);
  });

  it("rechecks live GM authority after a queued decision waits for the broker", async () => {
    let store: unknown = { version: 1, judgments: [] };
    const firstWriteEntered = deferred<void>();
    const releaseFirstWrite = deferred<void>();
    let secondUserIsGm = true;
    globals.game.users.get.mockImplementation((id: string) => {
      if (id === "gm-1") return { id, name: "First GM", isGM: true };
      if (id === "gm-2") return { id, name: "Second GM", isGM: secondUserIsGm };
      return null;
    });
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      firstWriteEntered.resolve();
      await releaseFirstWrite.promise;
      store = structuredClone(value);
      return value;
    });

    const first = saveTrustedEquipmentPolicyJudgment({
      id: "decision-a",
      facts: customLumpSumFacts(1_000),
      reason: "First decision",
      recordedAt: "2026-08-18T20:00:00.000Z",
      user: { id: "gm-1", name: "First GM", isGM: true },
    });
    await firstWriteEntered.promise;
    const second = saveTrustedEquipmentPolicyJudgment({
      id: "decision-b",
      facts: customLumpSumFacts(2_000),
      reason: "Second decision",
      recordedAt: "2026-08-18T20:01:00.000Z",
      user: { id: "gm-2", name: "Second GM", isGM: true },
    });
    secondUserIsGm = false;
    const denied = expect(second).rejects.toBeInstanceOf(WayfinderGmCommandAuthorityError);
    releaseFirstWrite.resolve();

    await first;
    await denied;
    expect(
      (store as { judgments: EquipmentPolicyJudgmentRecord[] }).judgments.map(
        (entry) => (entry.request.facts as { amountCopper: number }).amountCopper
      )
    ).toEqual([1_000]);
  });

  it("carries prior and newly observed decisions across a stale writer retry", async () => {
    const prior = directJudgment("decision-a", customLumpSumFacts(1_000));
    const external = directJudgment("decision-c", customLumpSumFacts(3_000));
    let store: unknown = { version: 1, judgments: [prior] };
    let writeCount = 0;
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
    );
    globals.game.settings.set.mockImplementation(async (_moduleId: string, _key: string, value: unknown) => {
      writeCount += 1;
      store = writeCount === 1 ? { version: 1, judgments: [external] } : structuredClone(value);
      return value;
    });

    await saveTrustedEquipmentPolicyJudgment({
      id: "decision-b",
      facts: customLumpSumFacts(2_000),
      reason: "Local decision",
      recordedAt: "2026-08-18T20:01:00.000Z",
      user: { id: "gm-1", name: "Game Master", isGM: true },
    });

    expect(writeCount).toBe(2);
    const persisted = (store as { judgments: EquipmentPolicyJudgmentRecord[] }).judgments;
    expect(persisted.map((entry) => entry.id)).toEqual(["decision-a", "decision-c", expect.stringMatching(/^direct:/)]);
    expect(persisted.map((entry) => (entry.request.facts as { amountCopper: number }).amountCopper)).toEqual([
      1_000, 3_000, 2_000,
    ]);
  });

  it("denies a non-GM revocation without writing the authority store", async () => {
    const approved = directJudgment("decision-a", customLumpSumFacts(1_000));
    globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
      moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? { version: 1, judgments: [approved] } : null
    );

    await expect(
      revokeTrustedEquipmentPolicyJudgment({
        judgmentId: approved.id,
        reason: "Unauthorized",
        revokedAt: "2026-08-18T21:00:00.000Z",
        user: { id: "owner-1", name: "Owner", isGM: false },
      })
    ).rejects.toBeInstanceOf(WayfinderGmCommandAuthorityError);
    expect(globals.game.settings.set).not.toHaveBeenCalled();
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
    globals.game.users = {
      get: vi.fn((id: string) => (id === "gm-1" ? { id: "gm-1", name: "Game Master", isGM: true } : null)),
    };
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
        installedEquipmentPacks: equipmentDescriptors(["pf2e.equipment-srd"]),
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
        installedEquipmentPacks: equipmentDescriptors(["pf2e.equipment-srd"]),
      }).higherLevelStartEvidence
    ).toEqual(attestation);
  });

  it("requires a current GM for policy writes", async () => {
    await expect(saveEquipmentWorldPolicy({}, { id: "owner-1", isGM: false })).rejects.toBeInstanceOf(
      WayfinderGmCommandAuthorityError
    );
    const saved = await saveEquipmentWorldPolicy({}, { id: "gm-1", isGM: true }, () => "2026-08-20T01:02:03.000Z");
    expect(saved.recipeDecision).toEqual({
      version: 1,
      configuredBy: { userId: "gm-1", userName: "Game Master" },
      configuredAt: "2026-08-20T01:02:03.000Z",
    });
    expect(globals.game.settings.set).toHaveBeenCalledWith(MODULE_ID, SETTINGS.equipmentPolicy, saved);
  });

  it("rejects a stale GM client after the live user has been demoted", async () => {
    globals.game.users.get.mockReturnValue({ id: "gm-1", name: "Former GM", isGM: false });
    await expect(
      saveTrustedEquipmentPolicyJudgment({
        id: "judgment-demoted",
        facts: {
          kind: "custom-lump-sum",
          actorId: "actor-1",
          draftId: "draft-1",
          targetLevel: 5,
          amountCopper: 1234,
        },
        reason: "Stale client approval",
        recordedAt: "2026-08-18T20:00:00.000Z",
        user: { id: "gm-1", name: "Former GM", isGM: true },
      })
    ).rejects.toBeInstanceOf(WayfinderGmCommandAuthorityError);
    expect(globals.game.settings.set).not.toHaveBeenCalled();
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
  let store: unknown = { version: 1, judgments: [] };
  globals.game.settings.get.mockImplementation((moduleId: string, key: string) =>
    moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments ? store : null
  );
  globals.game.settings.set.mockImplementation(async (_moduleId: string, key: string, value: unknown) => {
    if (key === SETTINGS.equipmentPolicyJudgments) store = structuredClone(value);
    return value;
  });
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

function equipmentDescriptors(ids: readonly string[]) {
  return ids.map((id) => ({
    id,
    family: id.split(".")[0]!,
    label: id,
    packageName: id.split(".")[0]!,
    documentName: "Item",
    equipmentTab: true,
  }));
}

function customLumpSumFacts(amountCopper: number): EquipmentPolicyJudgmentFacts {
  return { kind: "custom-lump-sum", actorId: "actor-1", draftId: "draft-1", targetLevel: 5, amountCopper };
}

function directJudgment(id: string, facts: EquipmentPolicyJudgmentFacts): EquipmentPolicyJudgmentRecord {
  return {
    id,
    kind: facts.kind,
    actorId: facts.actorId,
    draftId: facts.draftId,
    targetLevel: facts.targetLevel,
    factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
    authorUserId: "gm-1",
    authorName: "Game Master",
    recordedAt: "2026-08-18T20:00:00.000Z",
    reason: `Approved ${id}`,
    request: {
      requestId: `request:${id}`,
      requesterUserId: "gm-1",
      requesterName: "Game Master",
      requestedAt: "2026-08-18T20:00:00.000Z",
      reason: `Requested ${id}`,
      facts,
    },
    revocation: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
