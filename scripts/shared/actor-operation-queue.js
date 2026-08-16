const queueByActor = new WeakMap();
/** Serialize document mutations for one actor without blocking unrelated actors. */
export function enqueueActorOperation(actor, operation) {
    const previous = queueByActor.get(actor) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(() => undefined, () => undefined);
    queueByActor.set(actor, settled);
    void settled.finally(() => {
        if (queueByActor.get(actor) === settled) {
            queueByActor.delete(actor);
        }
    });
    return result;
}
//# sourceMappingURL=actor-operation-queue.js.map