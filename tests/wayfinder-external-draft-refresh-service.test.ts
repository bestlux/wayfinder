import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  DraftPersistenceCoordinator,
  type DraftSaveState,
} from "../src/wayfinder/application/draft-persistence-service";
import {
  actorUpdateTouchesWayfinderDraft,
  decideExternalDraftRefresh,
} from "../src/wayfinder/application/external-draft-refresh-service";

describe("Wayfinder external draft refresh", () => {
  it("acknowledges the current draft and ignores timestamp-only changes", () => {
    const localDraft = createEmptyDraft(1);
    localDraft.manual.one = true;
    const liveDraft = structuredClone(localDraft);
    liveDraft.updatedAt = "2026-08-16T00:00:00.000Z";

    expect(decideExternalDraftRefresh(input(localDraft, liveDraft))).toBe("acknowledge");
    expect(decideExternalDraftRefresh(input(createEmptyDraft(1), null))).toBe("acknowledge");
  });

  it("adopts a semantically different remote draft only when local persistence is clean", () => {
    const localDraft = createEmptyDraft(1);
    const liveDraft = createEmptyDraft(1);
    liveDraft.manual.remote = true;

    expect(decideExternalDraftRefresh(input(localDraft, liveDraft))).toBe("adopt");
    expect(decideExternalDraftRefresh(input(localDraft, liveDraft, savedState()))).toBe("adopt");
  });

  it("defers an in-flight save so the latest scheduled revision can settle", () => {
    const localDraft = createEmptyDraft(1);
    const liveDraft = createEmptyDraft(1);
    liveDraft.manual.remote = true;

    expect(decideExternalDraftRefresh(input(localDraft, liveDraft, savingState()))).toBe("defer");
  });

  it("flushes through a stale in-flight update and then acknowledges the newest local revision", async () => {
    const firstSave = deferred<void>();
    let saveCount = 0;
    let liveDraft = createEmptyDraft(1);
    const coordinator = new DraftPersistenceCoordinator({
      saveDraft: async (draft) => {
        saveCount += 1;
        liveDraft = structuredClone(draft);
        if (saveCount === 1) {
          await firstSave.promise;
        }
      },
    });
    const localDraft = createEmptyDraft(1);
    coordinator.initialize(localDraft);
    localDraft.manual.a = true;
    coordinator.schedule(localDraft);
    const initialFlush = coordinator.flush();
    await vi.waitFor(() => expect(liveDraft.manual).toEqual({ a: true }));

    localDraft.manual.b = true;
    coordinator.schedule(localDraft);
    expect(input(localDraft, liveDraft, coordinator.state)).toMatchObject({
      saveState: { phase: "saving", revision: 2, durableRevision: 0 },
    });
    expect(decideExternalDraftRefresh(input(localDraft, liveDraft, coordinator.state))).toBe("defer");

    firstSave.resolve();
    await initialFlush;

    expect(saveCount).toBe(2);
    expect(liveDraft.manual).toEqual({ a: true, b: true });
    expect(decideExternalDraftRefresh(input(localDraft, liveDraft, coordinator.state))).toBe("acknowledge");
  });

  it.each([
    { ...savedState(), revision: 2, durableRevision: 1 },
    { ...savedState(), phase: "error" as const },
  ])("preserves a conflict while local persistence is not clean: $phase", (saveState) => {
    const localDraft = createEmptyDraft(1);
    const liveDraft = createEmptyDraft(1);
    liveDraft.manual.remote = true;

    expect(decideExternalDraftRefresh(input(localDraft, liveDraft, saveState))).toBe("conflict");
  });

  it("does not adopt while a lifecycle barrier owns the draft", () => {
    const localDraft = createEmptyDraft(1);
    const liveDraft = createEmptyDraft(1);
    liveDraft.manual.remote = true;

    expect(decideExternalDraftRefresh({ ...input(localDraft, liveDraft), lifecycleBusy: true })).toBe("conflict");
  });

  it("detects both flattened and nested Foundry draft flag changes", () => {
    const moduleId = "wayfinder-pf2e";
    expect(actorUpdateTouchesWayfinderDraft({ [`flags.${moduleId}.draft`]: null }, moduleId)).toBe(true);
    expect(actorUpdateTouchesWayfinderDraft({ flags: { [moduleId]: { draft: null } } }, moduleId)).toBe(true);
    expect(actorUpdateTouchesWayfinderDraft({ flags: { [moduleId]: { "-=draft": null } } }, moduleId)).toBe(true);
    expect(actorUpdateTouchesWayfinderDraft({ flags: { [moduleId]: { state: {} } } }, moduleId)).toBe(false);
    expect(actorUpdateTouchesWayfinderDraft(null, moduleId)).toBe(false);
  });
});

function input(
  localDraft: ReturnType<typeof createEmptyDraft>,
  liveDraft: ReturnType<typeof createEmptyDraft> | null,
  saveState: DraftSaveState = idleState()
) {
  return {
    localDraft,
    liveDraft,
    currentLevel: 1,
    saveState,
    lifecycleBusy: false,
  };
}

function idleState(): DraftSaveState {
  return {
    phase: "idle",
    revision: 0,
    durableRevision: 0,
    retryable: false,
    message: null,
    failureKind: null,
  };
}

function savedState(): DraftSaveState {
  return {
    ...idleState(),
    phase: "saved",
    revision: 1,
    durableRevision: 1,
  };
}

function savingState(): DraftSaveState {
  return {
    ...savedState(),
    phase: "saving",
    revision: 2,
    durableRevision: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
