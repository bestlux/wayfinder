import { describe, expect, it } from "vitest";
import { SemanticCommandQueue } from "../src/wayfinder/application/semantic-command-queue";

describe("Wayfinder semantic command queue", () => {
  it("preserves command order across asynchronous resolution", async () => {
    const queue = new SemanticCommandQueue();
    const firstBarrier = deferred<void>();
    const order: string[] = [];
    const first = queue.enqueue(async () => {
      order.push("first-start");
      await firstBarrier.promise;
      order.push("first-end");
    });
    const second = queue.enqueue(async () => {
      order.push("second");
    });

    await expect.poll(() => order).toEqual(["first-start"]);
    firstBarrier.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("stays busy until every queued semantic command settles", async () => {
    const queue = new SemanticCommandQueue();
    const firstBarrier = deferred<void>();
    const secondBarrier = deferred<void>();
    const first = queue.enqueue(async () => {
      await firstBarrier.promise;
    });
    const second = queue.enqueue(async () => {
      await secondBarrier.promise;
    });

    expect(queue.busy).toBe(true);
    firstBarrier.resolve();
    await first;
    expect(queue.busy).toBe(true);

    secondBarrier.resolve();
    await second;
    expect(queue.busy).toBe(false);
  });

  it("activates a barrier immediately but runs it after earlier commands", async () => {
    const queue = new SemanticCommandQueue();
    const firstBarrier = deferred<void>();
    const order: string[] = [];
    const first = queue.enqueue(async () => {
      order.push("choice-start");
      await firstBarrier.promise;
      order.push("choice-end");
    });
    const clear = queue.runBarrier(async () => {
      order.push("clear");
    });
    const staleChoice = queue.enqueue(async () => {
      order.push("stale");
    });

    expect(queue.barrierActive).toBe(true);
    expect(staleChoice).toBeNull();
    firstBarrier.resolve();
    await Promise.all([first, clear]);
    expect(order).toEqual(["choice-start", "choice-end", "clear"]);
    expect(queue.barrierActive).toBe(false);
  });

  it("lets close acquire the barrier after a cancelled operation", async () => {
    const queue = new SemanticCommandQueue();
    const barrier = deferred<void>();
    const apply = queue.runBarrier(async () => {
      await barrier.promise;
      return "cancelled";
    });
    const closeBarrier = queue.acquireBarrier();

    barrier.resolve();
    await apply;
    await expect(closeBarrier).resolves.toBe("acquired");
    expect(queue.barrierActive).toBe(true);
    queue.releaseBarrier();
    expect(queue.barrierActive).toBe(false);
  });

  it("keeps a terminal barrier closed and lets close observe it", async () => {
    const queue = new SemanticCommandQueue();
    const apply = queue.runBarrier(async () => {
      queue.completeTerminalOperation();
    });
    await apply;

    expect(queue.enqueue(async () => undefined)).toBeNull();
    await expect(queue.acquireBarrier()).resolves.toBe("terminal");
    queue.releaseBarrier();
    expect(queue.barrierActive).toBe(true);
  });

  it("lets a successful close terminalize an acquired barrier before a repeated close", async () => {
    const queue = new SemanticCommandQueue();

    await expect(queue.acquireBarrier()).resolves.toBe("acquired");
    queue.completeTerminalOperation();

    await expect(queue.acquireBarrier()).resolves.toBe("terminal");
    expect(queue.terminal).toBe(true);
  });

  it("continues after a failed command", async () => {
    const queue = new SemanticCommandQueue();
    const failed = queue.enqueue(async () => {
      throw new Error("failed");
    });
    const recovered = queue.enqueue(async () => "recovered");

    await expect(failed).rejects.toThrow("failed");
    await expect(recovered).resolves.toBe("recovered");
    expect(queue.busy).toBe(false);
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
