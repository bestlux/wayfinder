import { describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import { WayfinderRecoveryDraftConflictError } from "../src/wayfinder/application/draft-lifecycle-service";
import {
  assertFailedApplyRecoveryCandidateCurrent,
  clearDraftWithWriteGuard,
  evaluatePersistedDraftWriteGuardHook,
  PersistedDraftWriteGuard,
  saveDraftWithWriteGuard,
  updateActorWithPersistedDraftPrecondition,
  WayfinderDraftRoundTripError,
  WayfinderDraftWriteConflictError,
} from "../src/wayfinder/application/draft-write-guard";

describe("Wayfinder persisted draft write guard", () => {
  it("rejects recovery over a candidate another client finalized before the final actor phase", () => {
    const candidate = createEmptyDraft(5);
    candidate.applyAttemptStepIds = ["class-level-1"];
    const guard = new PersistedDraftWriteGuard(candidate);

    expect(() => assertFailedApplyRecoveryCandidateCurrent(guard, null, "spell-choices")).toThrow(
      WayfinderDraftWriteConflictError
    );
    expect(() => assertFailedApplyRecoveryCandidateCurrent(guard, null, null)).toThrow(
      WayfinderDraftWriteConflictError
    );
  });

  it("leaves a finalize-phase partial draft clear to convergence-aware recovery", () => {
    const candidate = createEmptyDraft(5);
    candidate.applyAttemptStepIds = ["class-level-1"];
    const guard = new PersistedDraftWriteGuard(candidate);

    expect(() => assertFailedApplyRecoveryCandidateCurrent(guard, null, "finalize-actor")).not.toThrow();
  });

  it("requires an exact readback before acknowledging a save", async () => {
    const initial = createEmptyDraft(5);
    const persisted: unknown = initial;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async () => undefined),
    };
    const guard = new PersistedDraftWriteGuard(initial);
    const candidate = structuredClone(initial);
    candidate.targetLevel = 6;

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).rejects.toBeInstanceOf(
      WayfinderDraftRoundTripError
    );
    expect(persisted).toBe(initial);
  });

  it("acknowledges an already-durable semantic snapshot without issuing a Foundry no-op update", async () => {
    const initial = createEmptyDraft(5);
    initial.updatedAt = "2026-08-21T04:00:00.000Z";
    const actor = {
      getFlag: () => initial,
      update: vi.fn(async () => actor),
    };
    const candidate = structuredClone(initial);
    candidate.updatedAt = null;
    const guard = new PersistedDraftWriteGuard(initial);

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).resolves.toBeUndefined();
    expect(actor.update).not.toHaveBeenCalled();
    expect(() => guard.assertCurrent(initial)).not.toThrow();
  });

  it("restores the exact last durable draft when Foundry persists a malformed round trip", async () => {
    const initial = createEmptyDraft(5);
    initial.manual.durable = true;
    let persisted: unknown = initial;
    let updateCount = 0;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>) => {
        updateCount += 1;
        persisted = structuredClone(update[DRAFT_FLAG]);
        if (updateCount === 1) {
          (persisted as { targetLevel: number }).targetLevel = 20;
        }
        return actor;
      }),
    };
    const guard = new PersistedDraftWriteGuard(initial);
    const candidate = structuredClone(initial);
    candidate.manual.newest = true;

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).rejects.toMatchObject({
      name: "WayfinderDraftRoundTripError",
      message: expect.stringContaining("restored the last durable draft"),
    });
    expect(actor.update).toHaveBeenCalledTimes(2);
    expect(persisted).toEqual(initial);
    expect(() => guard.assertCurrent(initial)).not.toThrow();
  });

  it("keeps the last durable draft untouched when PF2E permanently rejects the update", async () => {
    const initial = createEmptyDraft(5);
    const persisted: unknown = initial;
    const validationError = new Error("Actor sheet validation rejected the draft");
    validationError.name = "DataModelValidationError";
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async () => {
        throw validationError;
      }),
    };
    const guard = new PersistedDraftWriteGuard(initial);
    const candidate = structuredClone(initial);
    candidate.manual.newest = true;

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).rejects.toBe(validationError);
    expect(persisted).toBe(initial);
    expect(actor.update).toHaveBeenCalledOnce();
  });

  it("accepts a lost acknowledgement only when the exact candidate converged", async () => {
    const initial = createEmptyDraft(5);
    let persisted: unknown = initial;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>) => {
        persisted = update[DRAFT_FLAG];
        throw new Error("lost acknowledgement");
      }),
    };
    const guard = new PersistedDraftWriteGuard(initial);
    const candidate = structuredClone(initial);
    candidate.targetLevel = 6;

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).resolves.toBeUndefined();
    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).resolves.toBeUndefined();
    expect(actor.update).toHaveBeenCalledOnce();
  });

  it("rejects a stale ordinary save after another window establishes recovery", async () => {
    const initial = createEmptyDraft(5);
    const recovery = structuredClone(initial);
    recovery.applyAttemptStepIds = ["class-level-1"];
    let persisted: unknown = initial;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>) => {
        persisted = update[DRAFT_FLAG];
      }),
    };
    const guard = new PersistedDraftWriteGuard(initial);
    persisted = recovery;

    await expect(saveDraftWithWriteGuard(actor, initial, 5, guard)).rejects.toBeInstanceOf(
      WayfinderDraftWriteConflictError
    );
    expect(actor.update).not.toHaveBeenCalled();
    expect(persisted).toBe(recovery);
  });

  it("vetoes a draft that propagates at Foundry's matching pre-update boundary", async () => {
    const initial = createEmptyDraft(5);
    const external = structuredClone(initial);
    external.selections["background-level-1"] = {
      packId: "pf2e.backgrounds",
      documentId: "barkeep",
      uuid: "Compendium.pf2e.backgrounds.Item.barkeep",
      name: "Barkeep",
      slotId: "background-level-1",
      itemType: "background",
      featType: null,
      level: 1,
    };
    let persisted: unknown = initial;
    const guard = new PersistedDraftWriteGuard(initial);
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>, operation?: Record<string, unknown>) => {
        persisted = external;
        guard.acceptCurrent(external);
        if (evaluatePersistedDraftWriteGuardHook(actor, update, operation) === false) {
          return undefined;
        }
        persisted = update[DRAFT_FLAG];
        return actor;
      }),
    };
    const candidate = structuredClone(initial);
    candidate.targetLevel = 6;

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).rejects.toBeInstanceOf(
      WayfinderDraftWriteConflictError
    );
    expect(persisted).toBe(external);
  });

  it("preserves a falsy failure from the matching pre-update assertion", async () => {
    let assertionCount = 0;
    const actor = {
      getFlag: () => null,
      update: vi.fn(async (update: Record<string, unknown>, operation?: Record<string, unknown>) => {
        if (evaluatePersistedDraftWriteGuardHook(actor, update, operation) === false) {
          return undefined;
        }
        return actor;
      }),
    };

    await expect(
      updateActorWithPersistedDraftPrecondition(actor, { [DRAFT_FLAG]: null }, () => {
        assertionCount += 1;
        if (assertionCount > 1) throw undefined;
      })
    ).rejects.toBeUndefined();
    expect(actor.update).toHaveBeenCalledOnce();
  });

  it("fails closed for a known token used on another actor and ignores unknown tokens", async () => {
    let capturedOperation: Record<string, unknown> | undefined;
    const actor = {
      getFlag: () => null,
      update: vi.fn(async (_update: Record<string, unknown>, operation?: Record<string, unknown>) => {
        capturedOperation = operation;
        const wrongActor = { getFlag: () => null, update: vi.fn() };
        expect(evaluatePersistedDraftWriteGuardHook(wrongActor, {}, operation)).toBe(false);
        return undefined;
      }),
    };

    await expect(updateActorWithPersistedDraftPrecondition(actor, {}, () => undefined)).rejects.toBeInstanceOf(
      WayfinderDraftWriteConflictError
    );
    expect(evaluatePersistedDraftWriteGuardHook(actor, {}, capturedOperation)).toBeUndefined();
    expect(
      evaluatePersistedDraftWriteGuardHook(actor, {}, { wayfinderPf2eDraftWriteGuardOperationId: "unknown" })
    ).toBeUndefined();
  });

  it("isolates concurrent pre-update tokens and assertions", async () => {
    const pending: Array<{
      operation: Record<string, unknown> | undefined;
      resolve: (value: unknown) => void;
    }> = [];
    const actor = {
      getFlag: () => null,
      update: vi.fn(
        (_update: Record<string, unknown>, operation?: Record<string, unknown>) =>
          new Promise<unknown>((resolve) => pending.push({ operation, resolve }))
      ),
    };
    const firstAssertion = vi.fn();
    const secondAssertion = vi.fn();

    const first = updateActorWithPersistedDraftPrecondition(actor, { first: true }, firstAssertion);
    const second = updateActorWithPersistedDraftPrecondition(actor, { second: true }, secondAssertion);

    expect(pending).toHaveLength(2);
    expect(pending[0]?.operation).not.toEqual(pending[1]?.operation);
    expect(evaluatePersistedDraftWriteGuardHook(actor, {}, pending[1]?.operation)).toBeUndefined();
    expect(evaluatePersistedDraftWriteGuardHook(actor, {}, pending[0]?.operation)).toBeUndefined();
    pending[0]?.resolve(actor);
    pending[1]?.resolve(actor);
    await expect(Promise.all([first, second])).resolves.toEqual([actor, actor]);
    expect(firstAssertion).toHaveBeenCalledTimes(2);
    expect(secondAssertion).toHaveBeenCalledTimes(2);
  });

  it("removes completed and rejected pre-update tokens", async () => {
    const completedOperations: Array<Record<string, unknown> | undefined> = [];
    const completedActor = {
      getFlag: () => null,
      update: vi.fn(async (_update: Record<string, unknown>, operation?: Record<string, unknown>) => {
        completedOperations.push(operation);
        evaluatePersistedDraftWriteGuardHook(completedActor, {}, operation);
        return completedActor;
      }),
    };
    await expect(updateActorWithPersistedDraftPrecondition(completedActor, {}, () => undefined)).resolves.toBe(
      completedActor
    );
    expect(evaluatePersistedDraftWriteGuardHook(completedActor, {}, completedOperations[0])).toBeUndefined();

    const rejectedOperations: Array<Record<string, unknown> | undefined> = [];
    const rejectedActor = {
      getFlag: () => null,
      update: vi.fn(async (_update: Record<string, unknown>, operation?: Record<string, unknown>) => {
        rejectedOperations.push(operation);
        evaluatePersistedDraftWriteGuardHook(rejectedActor, {}, operation);
        throw new Error("transport failed");
      }),
    };
    await expect(updateActorWithPersistedDraftPrecondition(rejectedActor, {}, () => undefined)).rejects.toThrow(
      "transport failed"
    );
    expect(evaluatePersistedDraftWriteGuardHook(rejectedActor, {}, rejectedOperations[0])).toBeUndefined();
  });

  it("rejects resurrection after another window finalizes a recovery draft", async () => {
    const recovery = createEmptyDraft(5);
    recovery.applyAttemptStepIds = ["class-level-1"];
    let persisted: unknown = recovery;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>) => {
        persisted = update[DRAFT_FLAG];
      }),
    };
    const guard = new PersistedDraftWriteGuard(recovery);
    persisted = null;

    await expect(saveDraftWithWriteGuard(actor, recovery, 5, guard)).rejects.toBeInstanceOf(
      WayfinderDraftWriteConflictError
    );
    expect(actor.update).not.toHaveBeenCalled();
    expect(persisted).toBeNull();
  });

  it("allows only monotonic recovery state when the guarded live draft is current", async () => {
    const recovery = createEmptyDraft(5);
    recovery.applyAttemptStepIds = ["class-level-1", "background-level-1"];
    recovery.applyRecoveryActorUpdate = { "system.skills.arcana.rank": 1 };
    let persisted: unknown = recovery;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>) => {
        persisted = update[DRAFT_FLAG];
        return actor;
      }),
    };
    const guard = new PersistedDraftWriteGuard(recovery);
    const candidate = structuredClone(recovery);
    candidate.applyAttemptStepIds = ["background-level-1"];
    candidate.applyCompletedStepIds = ["class-level-1"];

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).resolves.toBeUndefined();

    const truncated = structuredClone(candidate);
    truncated.applyRecoveryActorUpdate = {};
    await expect(saveDraftWithWriteGuard(actor, truncated, 5, guard)).rejects.toBeInstanceOf(
      WayfinderRecoveryDraftConflictError
    );
    expect(actor.update).toHaveBeenCalledOnce();
  });

  it("rechecks live recovery inside the queued Clear operation", async () => {
    const initial = createEmptyDraft(5);
    const recovery = structuredClone(initial);
    recovery.applyCompletedStepIds = ["ancestry-level-1"];
    let persisted: unknown = initial;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async (update: Record<string, unknown>) => {
        persisted = update[DRAFT_FLAG];
      }),
    };
    const guard = new PersistedDraftWriteGuard(initial);
    persisted = recovery;

    await expect(clearDraftWithWriteGuard(actor, 5, guard)).rejects.toBeInstanceOf(WayfinderDraftWriteConflictError);
    expect(actor.update).not.toHaveBeenCalled();
    expect(persisted).toBe(recovery);
  });

  it("accepts a lost Clear acknowledgement only after observing the null flag", async () => {
    const initial = createEmptyDraft(5);
    let persisted: unknown = initial;
    const actor = {
      getFlag: () => persisted,
      update: vi.fn(async () => {
        persisted = null;
        throw new Error("lost acknowledgement");
      }),
    };
    const guard = new PersistedDraftWriteGuard(initial);

    await expect(clearDraftWithWriteGuard(actor, 5, guard)).resolves.toBeUndefined();
    expect(persisted).toBeNull();
  });

  it("does not accept exact readback when Foundry skips the registered pre-update hook", async () => {
    vi.resetModules();
    const hookOn = vi.fn();
    vi.stubGlobal("Hooks", { on: hookOn });
    try {
      const guardModule = await import("../src/wayfinder/application/draft-write-guard");
      guardModule.registerPersistedDraftWriteGuardHook();
      expect(hookOn).toHaveBeenCalledWith("preUpdateActor", guardModule.evaluatePersistedDraftWriteGuardHook);

      const initial = createEmptyDraft(5);
      const candidate = structuredClone(initial);
      candidate.targetLevel = 6;
      let savedDraft: unknown = initial;
      const saveActor = {
        getFlag: () => savedDraft,
        update: vi.fn(async (update: Record<string, unknown>) => {
          savedDraft = update[DRAFT_FLAG];
          return saveActor;
        }),
      };
      await expect(
        guardModule.saveDraftWithWriteGuard(saveActor, candidate, 5, new guardModule.PersistedDraftWriteGuard(initial))
      ).rejects.toBeInstanceOf(guardModule.WayfinderDraftPreUpdateGuardUnavailableError);

      let clearedDraft: unknown = initial;
      const clearActor = {
        getFlag: () => clearedDraft,
        update: vi.fn(async () => {
          clearedDraft = null;
          return clearActor;
        }),
      };
      await expect(
        guardModule.clearDraftWithWriteGuard(clearActor, 5, new guardModule.PersistedDraftWriteGuard(initial))
      ).rejects.toBeInstanceOf(guardModule.WayfinderDraftPreUpdateGuardUnavailableError);

      const rejected = new Error("Network timeout before the Foundry update hook");
      const rejectedActor = {
        getFlag: () => initial,
        update: vi.fn(async () => {
          throw rejected;
        }),
      };
      const changed = structuredClone(initial);
      changed.targetLevel = 6;
      await expect(
        guardModule.saveDraftWithWriteGuard(
          rejectedActor,
          changed,
          5,
          new guardModule.PersistedDraftWriteGuard(initial)
        )
      ).rejects.toBe(rejected);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
