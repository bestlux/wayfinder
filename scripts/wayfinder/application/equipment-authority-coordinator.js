import { MODULE_ID } from "../../constants.js";
import { WayfinderGmCommandAuthorityError } from "./gm-command-authority.js";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_QUEUE_DEADLINE_MS = 10_000;
const ACCEPTED_COMPLETION_TIMEOUT_MS = 120_000;
let authorityHandler = null;
let registered = false;
let localTail = Promise.resolve();
const pending = new Map();
export function setEquipmentAuthorityHandler(handler) {
    authorityHandler = handler;
}
export function registerEquipmentAuthorityCoordinator() {
    if (registered)
        return;
    const socket = game.socket;
    if (!socket || typeof socket.on !== "function") {
        throw new Error("Wayfinder equipment authority requires the Foundry module socket.");
    }
    socket.on(SOCKET_CHANNEL, receiveEquipmentAuthorityMessage);
    registered = true;
}
export async function coordinateEquipmentAuthorityOperation(operation, requester = game.user) {
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
        return enqueueLocal(operation, liveRequester);
    }
    if (requesterId !== currentUserId) {
        throw new Error("Equipment authority requests must originate from the current Foundry user.");
    }
    const authority = activeGm();
    if (!authority)
        throw new Error("No active GM is available to decide the starting-equipment request.");
    const authorityUserId = requiredId(authority.id, "Active GM identity is required.");
    if (authorityUserId === currentUserId)
        return enqueueLocal(operation, liveRequester);
    if (!registered)
        throw new Error("Wayfinder equipment authority socket is not ready.");
    const correlationId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pending.delete(correlationId);
            reject(new Error("The active GM did not answer the starting-equipment request in time."));
        }, REQUEST_TIMEOUT_MS);
        pending.set(correlationId, {
            authorityUserId,
            resolve: (value) => resolve(value),
            reject,
            timeout,
        });
        socket.emit(SOCKET_CHANNEL, {
            type: "equipment-authority-request",
            correlationId,
            operation,
            queueTtlMs: REMOTE_QUEUE_DEADLINE_MS,
        });
    });
}
async function receiveEquipmentAuthorityMessage(message, senderUserId) {
    if (!isRecord(message) || typeof senderUserId !== "string")
        return;
    if (message.type === "equipment-authority-response") {
        receiveResponse(message, senderUserId);
        return;
    }
    if (message.type !== "equipment-authority-request" || !isAuthorityRequest(message))
        return;
    if (!isCurrentActiveGm())
        return;
    const requester = liveUser(senderUserId);
    if (!requester || requester.isGM !== true)
        return;
    let response;
    try {
        const result = await enqueueLocal(message.operation, requester, {
            expiresAt: Date.now() + Math.min(message.queueTtlMs, REMOTE_QUEUE_DEADLINE_MS),
            onStart: () => game.socket.emit(SOCKET_CHANNEL, {
                type: "equipment-authority-response",
                correlationId: message.correlationId,
                targetUserId: senderUserId,
                phase: "accepted",
            }),
        });
        response = {
            type: "equipment-authority-response",
            correlationId: message.correlationId,
            targetUserId: senderUserId,
            phase: "completed",
            result,
        };
    }
    catch (error) {
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
function receiveResponse(message, senderUserId) {
    if (typeof message.correlationId !== "string" ||
        typeof message.targetUserId !== "string" ||
        !["accepted", "completed", "failed"].includes(String(message.phase)) ||
        message.targetUserId !== record(game.user).id) {
        return;
    }
    const request = pending.get(message.correlationId);
    if (!request || request.authorityUserId !== senderUserId)
        return;
    if (request.timeout)
        clearTimeout(request.timeout);
    request.timeout = null;
    if (message.phase === "accepted") {
        request.timeout = setTimeout(() => {
            pending.delete(message.correlationId);
            request.reject(new Error("The active GM began this equipment decision, but its final outcome is unknown. Reopen Wayfinder before trying again."));
        }, ACCEPTED_COMPLETION_TIMEOUT_MS);
        return;
    }
    pending.delete(message.correlationId);
    if (message.phase === "completed")
        request.resolve(message.result);
    else
        request.reject(new Error(typeof message.error === "string" ? message.error : "Equipment authority failed."));
}
function enqueueLocal(operation, requester, options = {}) {
    if (!authorityHandler)
        return Promise.reject(new Error("Wayfinder equipment authority is not initialized."));
    const run = async () => {
        assertCurrentEquipmentAuthorityWriter();
        if (typeof options.expiresAt === "number" && Date.now() >= options.expiresAt) {
            throw new Error("The equipment authority request expired before the active GM could start it.");
        }
        options.onStart?.();
        return authorityHandler(operation, requester);
    };
    const result = localTail.then(() => run(), () => run());
    localTail = result.then(() => undefined, () => undefined);
    return result;
}
export function assertCurrentEquipmentAuthorityWriter() {
    const socket = game.socket;
    if (socket && typeof socket.emit === "function" && !isCurrentActiveGm()) {
        throw new Error("The active GM changed before the equipment authority write completed. Try again.");
    }
}
function activeGm() {
    const active = record(game.users).activeGM;
    return isRecord(active) ? active : record(game.user).isActiveGM === true ? record(game.user) : null;
}
function isCurrentActiveGm() {
    const currentUserId = record(game.user).id;
    const authorityUserId = activeGm()?.id;
    return typeof currentUserId === "string" && currentUserId === authorityUserId;
}
function liveUser(userId) {
    const users = game.users;
    const user = typeof users?.get === "function" ? users.get(userId) : null;
    return isRecord(user) ? user : null;
}
function isAuthorityRequest(message) {
    if (typeof message.correlationId !== "string" ||
        typeof message.queueTtlMs !== "number" ||
        !Number.isFinite(message.queueTtlMs) ||
        message.queueTtlMs <= 0 ||
        !isRecord(message.operation)) {
        return false;
    }
    return ["approve-request", "decline-request", "revoke-judgment"].includes(String(message.operation.type));
}
function requiredId(value, message) {
    if (typeof value !== "string" || !value.trim())
        throw new TypeError(message);
    return value;
}
function record(value) {
    return typeof value === "object" && value !== null ? value : {};
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=equipment-authority-coordinator.js.map