globalThis.__cleanupWayfinderAcquisitionTracer = async function cleanupWayfinderAcquisitionTracer({
  allowDestructive = false,
  expectedWorldId = "",
  fixtures,
  moduleId,
  runId,
}) {
  if (!allowDestructive || !String(expectedWorldId ?? "").trim()) {
    throw new Error("Acquisition tracer cleanup requires destructive opt-in and an exact expected world id.");
  }
  const expected = String(expectedWorldId).trim();
  const actual = String(globalThis.game?.world?.id ?? "").trim();
  if (actual !== expected) {
    throw new Error(`Foundry smoke expected world ${expected}, but connected to ${actual || "<unknown>"}.`);
  }
  if (!globalThis.game?.user?.isGM) throw new Error("Acquisition tracer cleanup must run as a current GM.");
  const actors = (fixtures ?? []).map((fixture) => {
    const actor = globalThis.game.actors.get(fixture.actorId);
    const marker = actor?.getFlag(moduleId, "smokeAcquisitionTracer");
    if (
      !actor ||
      actor.name !== fixture.fixtureName ||
      marker?.runId !== runId ||
      marker?.caseId !== fixture.caseId ||
      marker?.definitionFingerprint !== fixture.definitionFingerprint ||
      marker?.executorRole !== fixture.executorRole ||
      marker?.executorUserId !== fixture.executorUserId
    ) {
      throw new Error("Acquisition tracer cleanup refused a fixture that did not match its exact guarded identity.");
    }
    return actor;
  });
  for (const actor of actors) await actor.delete();
  return {
    exactFixturesMatched: true,
    actorsDeleted: actors.length,
    actorsMissingAfterCleanup: actors.every((actor) => !globalThis.game.actors.has(actor.id)),
  };
};
