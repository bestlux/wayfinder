import { describe, expect, it } from "vitest";
import { enqueueActorOperation } from "../src/shared/actor-operation-queue";

describe("actor operation queue", () => {
  it("runs operations for one actor in FIFO order", async () => {
    const actor = {};
    const order: string[] = [];
    const firstBarrier = deferred<void>();

    const first = enqueueActorOperation(actor, async () => {
      order.push("first-start");
      await firstBarrier.promise;
      order.push("first-end");
      return 1;
    });
    const second = enqueueActorOperation(actor, async () => {
      order.push("second");
      return 2;
    });

    await expect.poll(() => order).toEqual(["first-start"]);
    firstBarrier.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("does not let a rejection poison later operations", async () => {
    const actor = {};
    const first = enqueueActorOperation(actor, async () => {
      throw new Error("injected failure");
    });
    const second = enqueueActorOperation(actor, async () => "recovered");

    await expect(first).rejects.toThrow("injected failure");
    await expect(second).resolves.toBe("recovered");
  });

  it("allows different actors to run concurrently", async () => {
    const barrier = deferred<void>();
    const started = new Set<string>();
    const run = (actor: object, name: string) =>
      enqueueActorOperation(actor, async () => {
        started.add(name);
        await barrier.promise;
      });

    const first = run({}, "first");
    const second = run({}, "second");
    await expect.poll(() => started).toEqual(new Set(["first", "second"]));
    barrier.resolve();
    await Promise.all([first, second]);
  });

  it("accepts new work after a settled queue is cleaned up", async () => {
    const actor = {};
    await enqueueActorOperation(actor, async () => "first");
    await expect(enqueueActorOperation(actor, async () => "second")).resolves.toBe("second");
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
