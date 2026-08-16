import { describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import { WayfinderRecoveryDraftConflictError } from "../src/wayfinder/application/draft-lifecycle-service";
import {
  clearDraftWithWriteGuard,
  PersistedDraftWriteGuard,
  saveDraftWithWriteGuard,
  WayfinderDraftWriteConflictError,
} from "../src/wayfinder/application/draft-write-guard";

describe("Wayfinder persisted draft write guard", () => {
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

    await expect(saveDraftWithWriteGuard(actor, candidate, 5, guard)).rejects.toThrow(
      "did not persist Wayfinder's complete draft candidate"
    );
    expect(persisted).toBe(initial);
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
    expect(actor.update).toHaveBeenCalledTimes(2);
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
});
