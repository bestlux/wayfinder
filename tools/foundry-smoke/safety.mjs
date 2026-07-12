export function validateSmokeSafety({
  allowDestructive,
  expectedWorldId,
  freeArchetypeMode = "unchanged",
  keepActors,
}) {
  if (freeArchetypeMode !== "unchanged") {
    if (!allowDestructive) {
      throw new Error("FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1 is required to change the Free Archetype world setting.");
    }

    const normalizedWorldId = normalizeWorldId(expectedWorldId);
    if (!normalizedWorldId) {
      throw new Error("FOUNDRY_SMOKE_WORLD_ID is required to change the Free Archetype world setting.");
    }
  }

  if (keepActors) {
    return {
      allowDestructive: Boolean(allowDestructive),
      expectedWorldId: normalizeWorldId(expectedWorldId),
    };
  }

  if (!allowDestructive) {
    throw new Error(
      "FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1 is required when smoke cleanup/deletion is enabled. Pass --keep-actors to leave fixtures in place.",
    );
  }

  const normalizedWorldId = normalizeWorldId(expectedWorldId);
  if (!normalizedWorldId) {
    throw new Error("FOUNDRY_SMOKE_WORLD_ID is required when smoke cleanup/deletion is enabled.");
  }

  return {
    allowDestructive: true,
    expectedWorldId: normalizedWorldId,
  };
}

export function assertExpectedWorldId({ actualWorldId, expectedWorldId }) {
  const expected = normalizeWorldId(expectedWorldId);
  if (!expected) {
    return;
  }

  const actual = normalizeWorldId(actualWorldId);
  if (actual !== expected) {
    throw new Error(`Foundry smoke expected world ${expected}, but connected to ${actual || "<unknown>"}.`);
  }
}

function normalizeWorldId(value) {
  return String(value ?? "").trim();
}
