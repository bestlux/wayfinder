const queueByActor = new WeakMap<object, Promise<void>>();

/** Serialize document mutations for one actor without blocking unrelated actors. */
export function enqueueActorOperation<T>(actor: object, operation: () => Promise<T>): Promise<T> {
  const previous = queueByActor.get(actor) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined
  );

  queueByActor.set(actor, settled);
  void settled.finally(() => {
    if (queueByActor.get(actor) === settled) {
      queueByActor.delete(actor);
    }
  });

  return result;
}
