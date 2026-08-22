import { MODULE_ID } from "../../constants.js";
import { WayfinderGmCommandAuthorityError } from "./gm-command-authority.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_QUEUE_DEADLINE_MS = 10_000;
const ACCEPTED_COMPLETION_TIMEOUT_MS = 120_000;

export type EquipmentAuthorityOperation =
  | { readonly type: "approve-request"; readonly input: Record<string, unknown> }
  | { readonly type: "decline-request"; readonly input: Record<string, unknown> }
  | { readonly type: "revoke-judgment"; readonly input: Record<string, unknown> };

type EquipmentAuthorityHandler = (operation: EquipmentAuthorityOperation, requester: unknown) => Promise<unknown>;

interface EquipmentAuthorityRequestMessage {
  readonly type: "equipment-authority-request";
  readonly correlationId: string;
  readonly operation: EquipmentAuthorityOperation;
  readonly queueTtlMs: number;
}

interface EquipmentAuthorityResponseMessage {
  readonly type: "equipment-authority-response";
  readonly correlationId: string;
  readonly targetUserId: string;
  readonly phase: "accepted" | "completed" | "failed";
  readonly result?: unknown;
  readonly error?: string;
}

interface PendingAuthorityRequest {
  readonly authorityUserId: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

let authorityHandler: EquipmentAuthorityHandler | null = null;
let registered = false;
let localTail: Promise<void> = Promise.resolve();
const pending = new Map<string, PendingAuthorityRequest>();

export function setEquipmentAuthorityHandler(handler: EquipmentAuthorityHandler): void {
  authorityHandler = handler;
}

export function registerEquipmentAuthorityCoordinator(): void {
  if (registered) return;
  const socket = game.socket;
  if (!socket || typeof socket.on !== "function") {
    throw new Error("Wayfinder equipment authority requires the Foundry module socket.");
  }
  socket.on(SOCKET_CHANNEL, receiveEquipmentAuthorityMessage);
  registered = true;
}

export async function coordinateEquipmentAuthorityOperation<T>(
  operation: EquipmentAuthorityOperation,
  requester: unknown = game.user
): Promise<T> {
  const requesterRecord = record(requester);
  const requesterId = requiredId(requesterRecord.id, "Equipment authority requester identity is required.");
  const liveRequester = liveUser(requesterId);
  if (!liveRequester || liveRequester.isGM !== true) {
    throw new WayfinderGmCommandAuthorityError();
  }

  const currentUser = record(game.user);
  const currentUserId = requiredId(currentUser.id, "Current Foundry user identity is required.");
  const socket = game.socket;
  if (!socket || typeof socket.emit !== "function") {
    return enqueueLocal<T>(operation, liveRequester);
  }
  if (requesterId !== currentUserId) {
    throw new Error("Equipment authority requests must originate from the current Foundry user.");
  }

  const authority = activeGm();
  if (!authority) throw new Error("No active GM is available to decide the starting-equipment request.");
  const authorityUserId = requiredId(authority.id, "Active GM identity is required.");
  if (authorityUserId === currentUserId) return enqueueLocal<T>(operation, liveRequester);
  if (!registered) throw new Error("Wayfinder equipment authority socket is not ready.");

  const correlationId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(correlationId);
      reject(new Error("The active GM did not answer the starting-equipment request in time."));
    }, REQUEST_TIMEOUT_MS);
    pending.set(correlationId, {
      authorityUserId,
      resolve: (value) => resolve(value as T),
      reject,
      timeout,
    });
    socket.emit(SOCKET_CHANNEL, {
      type: "equipment-authority-request",
      correlationId,
      operation,
      queueTtlMs: REMOTE_QUEUE_DEADLINE_MS,
    } satisfies EquipmentAuthorityRequestMessage);
  });
}

async function receiveEquipmentAuthorityMessage(message: unknown, senderUserId: unknown): Promise<void> {
  if (!isRecord(message) || typeof senderUserId !== "string") return;
  if (message.type === "equipment-authority-response") {
    receiveResponse(message, senderUserId);
    return;
  }
  if (message.type !== "equipment-authority-request" || !isAuthorityRequest(message)) return;

  if (!isCurrentActiveGm()) return;
  const requester = liveUser(senderUserId);
  if (!requester || requester.isGM !== true) return;

  let response: EquipmentAuthorityResponseMessage;
  try {
    const result = await enqueueLocal(message.operation, requester, {
      expiresAt: Date.now() + Math.min(message.queueTtlMs, REMOTE_QUEUE_DEADLINE_MS),
      onStart: () =>
        game.socket.emit(SOCKET_CHANNEL, {
          type: "equipment-authority-response",
          correlationId: message.correlationId,
          targetUserId: senderUserId,
          phase: "accepted",
        } satisfies EquipmentAuthorityResponseMessage),
    });
    response = {
      type: "equipment-authority-response",
      correlationId: message.correlationId,
      targetUserId: senderUserId,
      phase: "completed",
      result,
    };
  } catch (error) {
    response = {
      type: "equipment-authority-response",
      correlationId: message.correlationId,
      targetUserId: senderUserId,
      phase: "failed",
      error: error instanceof Error ? error.message : "The equipment authority request failed.",
    };
  }
  game.socket.emit(SOCKET_CHANNEL, response);
}

function receiveResponse(message: Record<string, unknown>, senderUserId: string): void {
  if (
    typeof message.correlationId !== "string" ||
    typeof message.targetUserId !== "string" ||
    !["accepted", "completed", "failed"].includes(String(message.phase)) ||
    message.targetUserId !== record(game.user).id
  ) {
    return;
  }
  const request = pending.get(message.correlationId);
  if (!request || request.authorityUserId !== senderUserId) return;
  if (request.timeout) clearTimeout(request.timeout);
  request.timeout = null;
  if (message.phase === "accepted") {
    request.timeout = setTimeout(() => {
      pending.delete(message.correlationId as string);
      request.reject(
        new Error(
          "The active GM began this equipment decision, but its final outcome is unknown. Reopen Wayfinder before trying again."
        )
      );
    }, ACCEPTED_COMPLETION_TIMEOUT_MS);
    return;
  }
  pending.delete(message.correlationId);
  if (message.phase === "completed") request.resolve(message.result);
  else request.reject(new Error(typeof message.error === "string" ? message.error : "Equipment authority failed."));
}

function enqueueLocal<T>(
  operation: EquipmentAuthorityOperation,
  requester: unknown,
  options: { readonly expiresAt?: number; readonly onStart?: () => void } = {}
): Promise<T> {
  if (!authorityHandler) return Promise.reject(new Error("Wayfinder equipment authority is not initialized."));
  const run = async () => {
    assertCurrentEquipmentAuthorityWriter();
    if (typeof options.expiresAt === "number" && Date.now() >= options.expiresAt) {
      throw new Error("The equipment authority request expired before the active GM could start it.");
    }
    options.onStart?.();
    return authorityHandler!(operation, requester);
  };
  const result = localTail.then(
    () => run(),
    () => run()
  );
  localTail = result.then(
    () => undefined,
    () => undefined
  );
  return result as Promise<T>;
}

export function assertCurrentEquipmentAuthorityWriter(): void {
  const socket = game.socket;
  if (socket && typeof socket.emit === "function" && !isCurrentActiveGm()) {
    throw new Error("The active GM changed before the equipment authority write completed. Try again.");
  }
}

function activeGm(): Record<string, unknown> | null {
  const active = record(game.users).activeGM;
  return isRecord(active) ? active : record(game.user).isActiveGM === true ? record(game.user) : null;
}

function isCurrentActiveGm(): boolean {
  const currentUserId = record(game.user).id;
  const authorityUserId = activeGm()?.id;
  return typeof currentUserId === "string" && currentUserId === authorityUserId;
}

function liveUser(userId: string): Record<string, unknown> | null {
  const users = game.users;
  const user = typeof users?.get === "function" ? users.get(userId) : null;
  return isRecord(user) ? user : null;
}

function isAuthorityRequest(
  message: Record<string, unknown>
): message is Record<string, unknown> & EquipmentAuthorityRequestMessage {
  if (
    typeof message.correlationId !== "string" ||
    typeof message.queueTtlMs !== "number" ||
    !Number.isFinite(message.queueTtlMs) ||
    message.queueTtlMs <= 0 ||
    !isRecord(message.operation)
  ) {
    return false;
  }
  return ["approve-request", "decline-request", "revoke-judgment"].includes(String(message.operation.type));
}

function requiredId(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(message);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
