import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PickerSearchRequest,
  PickerSearchScheduler,
} from "../src/wayfinder/application/picker-search-scheduler.js";

describe("PickerSearchScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid input into the latest query", async () => {
    const rendered: PickerSearchRequest[] = [];
    const scheduler = createScheduler(async (request) => {
      rendered.push(request);
    });

    scheduler.schedule("spell-step", "f");
    scheduler.schedule("spell-step", "fa");
    scheduler.schedule("spell-step", "fal");
    const latest = scheduler.schedule("spell-step", "false");

    await vi.advanceTimersByTimeAsync(39);
    expect(rendered).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(rendered).toEqual([latest]);
  });

  it("invalidates in-flight work immediately and runs only the latest settled request next", async () => {
    const firstRender = deferred<void>();
    const rendered: PickerSearchRequest[] = [];
    const scheduler = createScheduler(async (request) => {
      rendered.push(request);
      if (rendered.length === 1) {
        await firstRender.promise;
      }
    });

    const first = scheduler.schedule("spell-step", "f");
    await vi.advanceTimersByTimeAsync(40);
    expect(rendered).toEqual([first]);
    expect(first && scheduler.isCurrent(first)).toBe(true);

    scheduler.schedule("spell-step", "fa");
    const latest = scheduler.schedule("spell-step", "false");
    expect(first && scheduler.isCurrent(first)).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(rendered).toEqual([first]);

    firstRender.resolve();
    await vi.runAllTimersAsync();
    expect(rendered).toEqual([first, latest]);
  });

  it("distinguishes repeated query text by view revision", () => {
    const scheduler = createScheduler(async () => undefined);

    const first = scheduler.schedule("spell-step", "f");
    scheduler.schedule("spell-step", "fo");
    const second = scheduler.schedule("spell-step", "f");

    expect(first?.query).toBe(second?.query);
    expect(first?.viewRevision).not.toBe(second?.viewRevision);
    expect(scheduler.viewRevision).toBe(second?.viewRevision);
    expect(first && scheduler.isCurrent(first)).toBe(false);
    expect(second && scheduler.isCurrent(second)).toBe(true);
  });

  it("invalidates pending and in-flight requests when the source changes", async () => {
    const inFlight = deferred<void>();
    const rendered: PickerSearchRequest[] = [];
    const scheduler = createScheduler(async (request) => {
      rendered.push(request);
      await inFlight.promise;
    });

    const request = scheduler.schedule("spell-step", "false");
    await vi.advanceTimersByTimeAsync(40);
    const sourceRevision = scheduler.invalidateSource();

    expect(sourceRevision).toBe(1);
    expect(request && scheduler.isCurrent(request)).toBe(false);
    inFlight.resolve();
    await vi.runAllTimersAsync();
    expect(rendered).toEqual([request]);
  });

  it("cancels delayed work and ignores new work after disposal", async () => {
    const render = vi.fn(async () => undefined);
    const scheduler = createScheduler(render);

    scheduler.schedule("spell-step", "false");
    scheduler.invalidateView();
    await vi.runAllTimersAsync();
    expect(render).not.toHaveBeenCalled();

    scheduler.schedule("spell-step", "false");
    scheduler.dispose();
    expect(scheduler.schedule("spell-step", "again")).toBeNull();
    await vi.runAllTimersAsync();
    expect(render).not.toHaveBeenCalled();
  });

  it("recovers after a current render rejects and suppresses obsolete errors", async () => {
    const errors: Array<{ error: unknown; request: PickerSearchRequest }> = [];
    const firstRender = deferred<void>();
    let calls = 0;
    const scheduler = createScheduler(
      async () => {
        calls += 1;
        if (calls === 1) {
          await firstRender.promise;
        } else if (calls === 3) {
          throw new Error("current");
        }
      },
      (error, request) => errors.push({ error, request })
    );

    scheduler.schedule("spell-step", "f");
    await vi.advanceTimersByTimeAsync(40);
    scheduler.schedule("spell-step", "false");
    firstRender.reject(new Error("obsolete"));
    await vi.advanceTimersByTimeAsync(40);
    expect(errors).toEqual([]);
    expect(calls).toBe(2);

    scheduler.schedule("spell-step", "failure");
    await vi.advanceTimersByTimeAsync(40);
    expect(calls).toBe(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.error).toEqual(new Error("current"));

    scheduler.schedule("spell-step", "retry");
    await vi.advanceTimersByTimeAsync(40);
    expect(calls).toBe(4);
  });
});

function createScheduler(
  render: (request: PickerSearchRequest) => Promise<void>,
  onError?: (error: unknown, request: PickerSearchRequest) => void
) {
  return new PickerSearchScheduler({ delayMs: 40, render, onError });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
