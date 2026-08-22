import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const globals = globalThis as typeof globalThis & { game: any };

describe("equipment authority coordinator", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes a remote GM decision and a competing active-GM decision through one writer", async () => {
    const users = new Map([
      ["gm-a", { id: "gm-a", name: "Authority GM", isGM: true, isActiveGM: true }],
      ["gm-b", { id: "gm-b", name: "Requesting GM", isGM: true, isActiveGM: false }],
    ]);
    let listener: ((message: unknown, senderUserId: string) => Promise<void>) | null = null;
    const emitted: unknown[] = [];
    const socket = {
      on: vi.fn((_channel: string, callback: typeof listener) => {
        listener = callback;
      }),
      emit: vi.fn((_channel: string, message: unknown) => {
        emitted.push(message);
      }),
    };
    const userCollection = {
      get: (id: string) => users.get(id),
      activeGM: users.get("gm-a"),
    };
    globals.game = { user: users.get("gm-b"), users: userCollection, socket };
    const coordinator = await import("../src/wayfinder/application/equipment-authority-coordinator");
    const entries: string[] = [];
    let releaseRemote: (() => void) | null = null;
    coordinator.setEquipmentAuthorityHandler(async (operation) => {
      entries.push(`start:${operation.type}`);
      if (operation.type === "decline-request") {
        await new Promise<void>((resolve) => {
          releaseRemote = resolve;
        });
      }
      entries.push(`finish:${operation.type}`);
      return { outcome: operation.type };
    });
    coordinator.registerEquipmentAuthorityCoordinator();

    const remote = coordinator.coordinateEquipmentAuthorityOperation(
      { type: "decline-request", input: { requestId: "request-1" } },
      users.get("gm-b")
    );
    const requestMessage = emitted.shift();
    expect(requestMessage).toMatchObject({ type: "equipment-authority-request" });

    globals.game.user = users.get("gm-a");
    const receivingRemote = listener!(requestMessage, "gm-b");
    await vi.waitFor(() => expect(entries).toEqual(["start:decline-request"]));
    expect(emitted).toEqual([expect.objectContaining({ type: "equipment-authority-response", phase: "accepted" })]);
    const local = coordinator.coordinateEquipmentAuthorityOperation(
      { type: "approve-request", input: { requestId: "request-1" } },
      users.get("gm-a")
    );
    await Promise.resolve();
    expect(entries).toEqual(["start:decline-request"]);

    releaseRemote!();
    await receivingRemote;
    await expect(local).resolves.toEqual({ outcome: "approve-request" });
    expect(entries).toEqual([
      "start:decline-request",
      "finish:decline-request",
      "start:approve-request",
      "finish:approve-request",
    ]);

    const responseMessage = emitted.pop();
    globals.game.user = users.get("gm-b");
    await listener!(responseMessage, "gm-a");
    await expect(remote).resolves.toEqual({ outcome: "decline-request" });
  });

  it("fails a queued operation after Foundry elects a different active GM", async () => {
    const gmA = { id: "gm-a", name: "First GM", isGM: true, isActiveGM: true };
    const gmB = { id: "gm-b", name: "Second GM", isGM: true, isActiveGM: false };
    const users = new Map([
      [gmA.id, gmA],
      [gmB.id, gmB],
    ]);
    const userCollection = {
      get: (id: string) => users.get(id),
      activeGM: gmA,
    };
    globals.game = {
      user: gmA,
      users: userCollection,
      socket: { on: vi.fn(), emit: vi.fn() },
    };
    const coordinator = await import("../src/wayfinder/application/equipment-authority-coordinator");
    let releaseFirst: (() => void) | null = null;
    coordinator.setEquipmentAuthorityHandler(async (operation) => {
      if (operation.type === "decline-request") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return operation.type;
    });

    const first = coordinator.coordinateEquipmentAuthorityOperation({ type: "decline-request", input: {} }, gmA);
    await vi.waitFor(() => expect(releaseFirst).not.toBeNull());
    const queued = coordinator.coordinateEquipmentAuthorityOperation({ type: "approve-request", input: {} }, gmA);
    userCollection.activeGM = gmB;
    gmA.isActiveGM = false;
    gmB.isActiveGM = true;
    releaseFirst!();

    await expect(first).resolves.toBe("decline-request");
    await expect(queued).rejects.toThrow(/active GM changed/i);
  });

  it("bounds an accepted operation whose final outcome never arrives", async () => {
    vi.useFakeTimers();
    const gmA = { id: "gm-a", name: "Authority GM", isGM: true, isActiveGM: true };
    const gmB = { id: "gm-b", name: "Requesting GM", isGM: true, isActiveGM: false };
    const users = new Map([
      [gmA.id, gmA],
      [gmB.id, gmB],
    ]);
    let listener: ((message: unknown, senderUserId: string) => Promise<void>) | null = null;
    const emitted: unknown[] = [];
    globals.game = {
      user: gmB,
      users: { get: (id: string) => users.get(id), activeGM: gmA },
      socket: {
        on: (_channel: string, callback: typeof listener) => {
          listener = callback;
        },
        emit: (_channel: string, message: unknown) => emitted.push(message),
      },
    };
    const coordinator = await import("../src/wayfinder/application/equipment-authority-coordinator");
    coordinator.registerEquipmentAuthorityCoordinator();
    const result = coordinator.coordinateEquipmentAuthorityOperation(
      { type: "approve-request", input: { requestId: "request-1" } },
      gmB
    );
    const request = emitted[0] as { correlationId: string };
    await listener!(
      {
        type: "equipment-authority-response",
        correlationId: request.correlationId,
        targetUserId: gmB.id,
        phase: "accepted",
      },
      gmA.id
    );

    const outcome = expect(result).rejects.toThrow(/final outcome is unknown/i);
    await vi.advanceTimersByTimeAsync(120_001);
    await outcome;
  });
});
