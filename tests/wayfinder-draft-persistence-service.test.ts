import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { DraftPersistenceCoordinator } from "../src/wayfinder/application/draft-persistence-service";

describe("Wayfinder draft persistence coordinator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid edits and persists an immutable newest snapshot", async () => {
    const payloads: unknown[] = [];
    const coordinator = new DraftPersistenceCoordinator({
      saveDraft: async (draft) => {
        payloads.push(draft);
      },
    });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);

    draft.manual.a = true;
    coordinator.schedule(draft);
    draft.manual.b = true;
    coordinator.schedule(draft);
    draft.manual.c = true;
    coordinator.schedule(draft);
    delete draft.manual.c;

    await vi.advanceTimersByTimeAsync(300);
    expect(payloads).toEqual([expect.objectContaining({ manual: { a: true, b: true, c: true } })]);
    expect(coordinator.state).toMatchObject({ phase: "saved", revision: 3, durableRevision: 3 });
  });

  it("never overlaps writes and drains the newest edit after an in-flight save", async () => {
    const firstBarrier = deferred<void>();
    const payloads: string[][] = [];
    const states: string[] = [];
    let active = 0;
    let maxActive = 0;
    const coordinator = new DraftPersistenceCoordinator({
      saveDraft: async (draft) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        payloads.push(Object.keys(draft.manual));
        if (payloads.length === 1) await firstBarrier.promise;
        active -= 1;
      },
      onStateChange: (state) => states.push(state.phase),
    });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);
    const flush = coordinator.flush();
    await expect.poll(() => payloads).toEqual([["a"]]);

    draft.manual.b = true;
    coordinator.schedule(draft);
    draft.manual.c = true;
    coordinator.schedule(draft);
    firstBarrier.resolve();
    await flush;

    expect(payloads).toEqual([["a"], ["a", "b", "c"]]);
    expect(maxActive).toBe(1);
    expect(states.slice(0, -1)).not.toContain("saved");
    expect(coordinator.state).toMatchObject({ phase: "saved", revision: 3, durableRevision: 3 });
  });

  it("retains a failed newest snapshot and retries the latest edit", async () => {
    const payloads: string[][] = [];
    let attempts = 0;
    const coordinator = new DraftPersistenceCoordinator({
      saveDraft: async (draft) => {
        attempts += 1;
        payloads.push(Object.keys(draft.manual));
        if (attempts === 1) throw new Error("disk full");
      },
    });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);

    await expect(coordinator.flush()).rejects.toThrow("disk full");
    expect(coordinator.state).toMatchObject({ phase: "error", retryable: true, message: "disk full" });

    draft.manual.b = true;
    coordinator.schedule(draft);
    await coordinator.retry();
    expect(payloads).toEqual([["a"], ["a", "b"]]);
    expect(coordinator.state).toMatchObject({ phase: "saved", retryable: false });
  });

  it("flushes immediately without leaving a delayed duplicate", async () => {
    const saveDraft = vi.fn(async () => undefined);
    const coordinator = new DraftPersistenceCoordinator({ saveDraft });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);

    await coordinator.flush();
    await vi.runAllTimersAsync();
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("pauses new scheduling until persistence is resumed", async () => {
    const coordinator = new DraftPersistenceCoordinator({ saveDraft: async () => undefined });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);
    await coordinator.pauseAndFlush();

    expect(() => coordinator.schedule(draft)).toThrow("persistence is paused");
    coordinator.resume();
    draft.manual.b = true;
    expect(() => coordinator.schedule(draft)).not.toThrow();
  });

  it("discards a pending debounce before a destructive operation", async () => {
    const order: string[] = [];
    const coordinator = new DraftPersistenceCoordinator({
      saveDraft: async () => {
        order.push("save");
      },
    });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);

    await coordinator.discardAndRun(async () => {
      order.push("clear");
    });
    coordinator.reset(createEmptyDraft(1));
    await vi.runAllTimersAsync();
    expect(order).toEqual(["clear"]);
    expect(coordinator.state.phase).toBe("idle");
  });

  it("places destructive work after an in-flight save and ignores its stale completion", async () => {
    const barrier = deferred<void>();
    const order: string[] = [];
    const phases: string[] = [];
    const coordinator = new DraftPersistenceCoordinator({
      saveDraft: async () => {
        order.push("save-start");
        await barrier.promise;
        order.push("save-end");
      },
      onStateChange: (state) => phases.push(state.phase),
    });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);
    void coordinator.flush();
    await expect.poll(() => order).toEqual(["save-start"]);

    const clear = coordinator.discardAndRun(async () => {
      order.push("clear");
    });
    barrier.resolve();
    await clear;
    coordinator.reset(createEmptyDraft(1));

    expect(order).toEqual(["save-start", "save-end", "clear"]);
    expect(coordinator.state.phase).toBe("idle");
    expect(phases.at(-1)).toBe("idle");
  });

  it("keeps the recoverable snapshot retryable when destructive work fails", async () => {
    const coordinator = new DraftPersistenceCoordinator({ saveDraft: async () => undefined });
    const draft = createEmptyDraft(1);
    coordinator.initialize(draft);
    draft.manual.a = true;
    coordinator.schedule(draft);

    await expect(
      coordinator.discardAndRun(async () => {
        throw new Error("clear failed");
      })
    ).rejects.toThrow("clear failed");
    expect(coordinator.state).toMatchObject({ phase: "error", retryable: true, message: "clear failed" });
    await coordinator.retry();
    expect(coordinator.state.phase).toBe("saved");
  });

  it("cancels delayed work when terminal or disposed", async () => {
    const saveDraft = vi.fn(async () => undefined);
    const draft = createEmptyDraft(1);
    const terminal = new DraftPersistenceCoordinator({ saveDraft });
    terminal.initialize(draft);
    draft.manual.a = true;
    terminal.schedule(draft);
    terminal.completeTerminalOperation();

    const disposed = new DraftPersistenceCoordinator({ saveDraft });
    const secondDraft = createEmptyDraft(1);
    disposed.initialize(secondDraft);
    secondDraft.manual.b = true;
    disposed.schedule(secondDraft);
    disposed.dispose();

    await vi.runAllTimersAsync();
    expect(saveDraft).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
