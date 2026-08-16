export const OWNER_PROBE_SCHEMA_VERSION = 1;

export const OWNER_PROBE_FAILURE_STAGES = Object.freeze([
  "setup-session",
  "player-session",
  "player-context-close",
  "cleanup",
  "browser-close",
  "invalid-execution-stage",
]);

export function validateOwnerProbeOptions(options) {
  const failures = [];
  if (!nonEmptyString(options?.setupUser)) failures.push("A GM setup user is required.");
  if (!nonEmptyString(options?.playerUser)) failures.push("A non-GM player user is required.");
  if (
    nonEmptyString(options?.setupUser) &&
    nonEmptyString(options?.playerUser) &&
    options.setupUser.trim().toLocaleLowerCase() === options.playerUser.trim().toLocaleLowerCase()
  ) {
    failures.push("The setup and player users must be distinct.");
  }
  if (options?.allowDestructive !== true) failures.push("Owner probe cleanup requires destructive opt-in.");
  if (!nonEmptyString(options?.expectedWorldId)) failures.push("Owner probe cleanup requires an expected world id.");
  if (failures.length > 0) throw new Error(failures.join(" "));
  return {
    allowDestructive: true,
    expectedWorldId: options.expectedWorldId.trim(),
    playerUser: options.playerUser,
    setupUser: options.setupUser,
  };
}

export function buildOwnerProbeEvidence({ evidenceId, startedAt, finishedAt, setup, player, cleanup, execution }) {
  const failureStages = normalizeFailureStages(execution?.failureStages);
  const evidence = {
    schemaVersion: OWNER_PROBE_SCHEMA_VERSION,
    evidenceId,
    storyId: "WF-080-03A",
    caseKind: "owner-probe",
    startedAt,
    finishedAt,
    runtime: {
      foundryVersion: setup?.runtime?.foundryVersion ?? null,
      moduleVersion: setup?.runtime?.moduleVersion ?? null,
      pf2eVersion: setup?.runtime?.pf2eVersion ?? null,
      guardedWorldMatched: setup?.runtime?.guardedWorldMatched === true,
      playerRuntimeMatched:
        setup?.runtime?.foundryVersion === player?.runtime?.foundryVersion &&
        setup?.runtime?.moduleVersion === player?.runtime?.moduleVersion &&
        setup?.runtime?.pf2eVersion === player?.runtime?.pf2eVersion &&
        player?.runtime?.guardedWorldMatched === true,
    },
    setupSession: {
      role: setup?.session?.role ?? null,
      isGM: setup?.session?.isGM ?? null,
      distinctPlayerResolved: setup?.session?.distinctPlayerResolved === true,
    },
    playerSession: {
      role: player?.session?.role ?? null,
      isGM: player?.session?.isGM ?? null,
    },
    actorAuthority: {
      noneLevel: player?.authority?.noneLevel ?? null,
      ownerLevel: player?.authority?.ownerLevel ?? null,
      defaultOwnershipLevel: player?.authority?.defaultOwnershipLevel ?? null,
      explicitOwnershipLevel: player?.authority?.explicitOwnershipLevel ?? null,
      isOwner: player?.authority?.isOwner === true,
      ownerPermission: player?.authority?.ownerPermission === true,
      canUpdate: player?.authority?.canUpdate === true,
    },
    ui: {
      actorSheetOpened: player?.ui?.actorSheetOpened === true,
      launchControlFound: player?.ui?.launchControlFound === true,
      launchControlClicked: player?.ui?.launchControlClicked === true,
      actorBoundAppOpened: player?.ui?.actorBoundAppOpened === true,
      renderLifecycleCompleted: player?.ui?.renderLifecycleCompleted === true,
      appClosed: player?.ui?.appClosed === true,
      actorSheetClosed: player?.ui?.actorSheetClosed === true,
    },
    cleanup: {
      exactFixtureMatched: cleanup?.exactFixtureMatched === true,
      actorDeleted: cleanup?.actorDeleted === true,
      actorMissingAfterCleanup: cleanup?.actorMissingAfterCleanup === true,
    },
    execution: {
      completed: execution?.completed === true && failureStages.length === 0,
      failureStages,
    },
  };
  const failures = ownerProbeFailures(evidence);
  return {
    ...evidence,
    failures,
    qualification: { passed: failures.length === 0 },
  };
}

function normalizeFailureStages(value) {
  if (!Array.isArray(value)) return ["invalid-execution-stage"];
  const allowed = new Set(OWNER_PROBE_FAILURE_STAGES.filter((stage) => stage !== "invalid-execution-stage"));
  const stages = [];
  let invalid = false;
  for (const stage of value) {
    if (typeof stage !== "string" || !allowed.has(stage)) invalid = true;
    else if (!stages.includes(stage)) stages.push(stage);
  }
  if (invalid) stages.push("invalid-execution-stage");
  return stages;
}

export function ownerProbeFailures(evidence) {
  const failures = [];
  if (evidence?.schemaVersion !== OWNER_PROBE_SCHEMA_VERSION) failures.push("Wrong owner-probe schema version.");
  if (!nonEmptyString(evidence?.evidenceId)) failures.push("Owner probe is missing its evidence id.");
  if (evidence?.execution?.completed !== true || evidence?.execution?.failureStages?.length !== 0) {
    failures.push("Owner probe execution did not complete without errors.");
  }
  if (!validRole(evidence?.setupSession?.role) || evidence?.setupSession?.isGM !== true) {
    failures.push("Setup session is not a current GM.");
  }
  if (evidence?.setupSession?.distinctPlayerResolved !== true) {
    failures.push("Setup session did not resolve a distinct player.");
  }
  if (!validRole(evidence?.playerSession?.role) || evidence?.playerSession?.isGM !== false) {
    failures.push("Player session is not a current non-GM.");
  }
  const authority = evidence?.actorAuthority;
  if (!Number.isInteger(authority?.noneLevel) || !Number.isInteger(authority?.ownerLevel)) {
    failures.push("Foundry ownership constants were not captured.");
  } else {
    if (authority.defaultOwnershipLevel !== authority.noneLevel) {
      failures.push("Fixture default ownership is not NONE.");
    }
    if (authority.explicitOwnershipLevel !== authority.ownerLevel) {
      failures.push("Player explicit ownership is not OWNER.");
    }
  }
  for (const [field, label] of [
    ["isOwner", "actor.isOwner"],
    ["ownerPermission", "OWNER permission"],
    ["canUpdate", "actor update permission"],
  ]) {
    if (authority?.[field] !== true) failures.push(`Player lacks ${label}.`);
  }
  for (const [field, label] of [
    ["actorSheetOpened", "actor sheet open"],
    ["launchControlFound", "Wayfinder launch control"],
    ["launchControlClicked", "Wayfinder launch click"],
    ["actorBoundAppOpened", "actor-bound Wayfinder app"],
    ["renderLifecycleCompleted", "Wayfinder render lifecycle"],
    ["appClosed", "Wayfinder app close"],
    ["actorSheetClosed", "actor sheet close"],
  ]) {
    if (evidence?.ui?.[field] !== true) failures.push(`Owner UI probe did not prove ${label}.`);
  }
  if (evidence?.runtime?.guardedWorldMatched !== true || evidence?.runtime?.playerRuntimeMatched !== true) {
    failures.push("GM and player sessions did not prove one guarded runtime.");
  }
  for (const field of ["foundryVersion", "moduleVersion", "pf2eVersion"]) {
    if (!nonEmptyString(evidence?.runtime?.[field])) failures.push(`Owner probe is missing ${field}.`);
  }
  for (const [field, label] of [
    ["exactFixtureMatched", "exact fixture guard"],
    ["actorDeleted", "actor deletion"],
    ["actorMissingAfterCleanup", "post-cleanup absence"],
  ]) {
    if (evidence?.cleanup?.[field] !== true) failures.push(`Owner probe cleanup did not prove ${label}.`);
  }
  return failures;
}

function validRole(value) {
  return Number.isInteger(value) && value >= 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
