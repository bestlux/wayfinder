import { MODULE_ID, SETTINGS } from "../../constants.js";
import { assertCanUseWayfinder } from "../../permissions.js";
import { getEquipmentPolicyJudgmentStoreSetting, getEquipmentWorldPolicySetting } from "../../settings.js";
import type { AcquisitionDraftState } from "../domain/acquisition-types.js";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyRequest,
  createEquipmentPolicyResolver,
  type EffectiveEquipmentPolicySnapshotV1,
  type EquipmentHigherLevelStartClaim,
  type EquipmentOwnerStartAttestation,
  type EquipmentPolicyJudgmentFacts,
  type EquipmentPolicyJudgmentRecord,
  type EquipmentPolicyRequestV1,
  type EquipmentPolicyResolutionInput,
  type EquipmentWorldPolicyV1,
  equipmentPolicyJudgmentFactsEqual,
  type HigherLevelStartKind,
  normalizeEquipmentPolicyRequest,
  normalizeEquipmentWorldPolicy,
  type OfficialEquipmentRecipe,
} from "../domain/equipment-policy.js";
import {
  discoverInstalledEquipmentPackDescriptors,
  type EquipmentSourceDiagnostic,
  type InstalledEquipmentPackDescriptor,
  normalizePf2eEquipmentSources,
} from "./equipment-source-policy.js";
import { requireCurrentGmPrincipal } from "./gm-command-authority.js";

export { normalizePf2eEquipmentSources } from "./equipment-source-policy.js";

/**
 * Read-only health projection for the current PF2E equipment sources.
 * Diagnostics deliberately remain outside reviewed policy material: pack
 * availability is re-evaluated whenever the catalogue is projected.
 */
export function resolveCurrentEquipmentSourceDiagnostics(input: {
  readonly policy: Pick<EffectiveEquipmentPolicySnapshotV1, "sourcePolicy">;
  readonly installedEquipmentPacks?: readonly InstalledEquipmentPackDescriptor[];
}): readonly EquipmentSourceDiagnostic[] {
  return normalizePf2eEquipmentSources({
    installedEquipmentPacks: input.installedEquipmentPacks ?? discoverCurrentEquipmentPacks(),
    allowedPackFamilies: input.policy.sourcePolicy.configuredPackFamilies,
    compendiumBrowserPacks: game.settings.get("pf2e", "compendiumBrowserPacks"),
    compendiumBrowserSources: game.settings.get("pf2e", "compendiumBrowserSources"),
  }).diagnostics;
}

export function resolveActorAbpSnapshot(
  actor: unknown,
  pf2e: unknown = game.pf2e
): EffectiveEquipmentPolicySnapshotV1["abp"] {
  const system = record(pf2e);
  const settings = record(record(system.settings).variants);
  const mode = typeof settings.abp === "string" ? settings.abp : null;
  const variantRules = record(system.variantRules);
  const abp = record(variantRules.AutomaticBonusProgression);
  const isEnabled = abp.isEnabled;
  const enabled =
    typeof isEnabled === "function"
      ? (isEnabled as (actor: unknown) => unknown)(actor) === true
      : mode !== null && mode !== "noABP";
  const actorRecord = record(actor);
  const flags = record(record(actorRecord.flags).pf2e);
  return { enabled, mode, actorOverrideDisabled: flags.disableABP === true };
}

export function resolveEquipmentPolicyForActor(input: {
  readonly actor: unknown;
  readonly draftId: string;
  readonly targetLevel: number;
  readonly selectedRecipe: OfficialEquipmentRecipe | null;
  readonly higherLevelStartClaim?: EquipmentHigherLevelStartClaim | null;
  readonly customLumpSum?: EquipmentPolicyResolutionInput["customLumpSum"];
  readonly extraCurrentLevelAllowanceIds?: readonly string[];
  readonly exceptionJudgmentIds?: readonly string[];
  readonly installedEquipmentPacks?: readonly InstalledEquipmentPackDescriptor[];
}): EffectiveEquipmentPolicySnapshotV1 {
  const actorId = actorIdentity(input.actor);
  const worldPolicy = getEquipmentWorldPolicySetting();
  const sources = normalizePf2eEquipmentSources({
    installedEquipmentPacks: input.installedEquipmentPacks ?? discoverCurrentEquipmentPacks(),
    allowedPackFamilies: worldPolicy.allowedEquipmentPackFamilies,
    compendiumBrowserPacks: game.settings.get("pf2e", "compendiumBrowserPacks"),
    compendiumBrowserSources: game.settings.get("pf2e", "compendiumBrowserSources"),
  });
  const store = getEquipmentPolicyJudgmentStoreSetting();
  const byId = new Map(store.judgments.map((judgment) => [judgment.id, judgment]));
  const resolver = createEquipmentPolicyResolver({
    resolveGmJudgment: (id) => {
      const judgment = byId.get(id);
      return judgment && judgment.revocation === null && isCurrentGmUser(judgment.authorUserId) ? judgment : null;
    },
    verifyOwnerStartAttestation: (attestation) => verifyCurrentOwnerAttestation(input.actor, attestation),
  });
  return resolver.resolve({
    actorId,
    draftId: input.draftId,
    targetLevel: input.targetLevel,
    worldPolicy,
    selectedRecipe: input.selectedRecipe,
    ...sources,
    abp: resolveActorAbpSnapshot(input.actor),
    higherLevelStartClaim: input.higherLevelStartClaim,
    customLumpSum: input.customLumpSum,
    extraCurrentLevelAllowanceIds: input.extraCurrentLevelAllowanceIds,
    exceptionJudgmentIds: input.exceptionJudgmentIds,
  });
}

function isCurrentGmUser(userId: string): boolean {
  const users = game.users;
  const user = typeof users?.get === "function" ? users.get(userId) : null;
  return record(user).isGM === true;
}

export function assertEquipmentApplyAuthority(input: {
  readonly actor: unknown;
  readonly acquisition: AcquisitionDraftState;
  readonly user?: unknown;
}): void {
  const policy = input.acquisition.policySnapshot?.material;
  if (
    !policy ||
    policy.subject.actorId !== actorIdentity(input.actor) ||
    policy.subject.draftId !== input.acquisition.draftId ||
    policy.subject.targetLevel !== input.acquisition.targetLevel
  ) {
    throw new TypeError("Starting-equipment Apply authority does not match the current actor and draft.");
  }
  const currentApplyAuthority = getEquipmentWorldPolicySetting().applyAuthority;
  if (policy.authorityPolicy.apply !== currentApplyAuthority) {
    throw new TypeError("Starting-equipment Apply authority changed after this draft was reviewed.");
  }
  if (policy.authorityPolicy.apply === "gm-review") {
    requireCurrentGmPrincipal(input.user ?? game.user);
    return;
  }
  assertCanUseWayfinder(input.actor);
}

export async function saveEquipmentWorldPolicy(
  raw: unknown,
  user: unknown = game.user,
  now: () => string = () => new Date().toISOString()
): Promise<EquipmentWorldPolicyV1> {
  const principal = requireLiveGmPrincipal(record(user));
  const liveUser = record(typeof game.users?.get === "function" ? game.users.get(principal.userId) : user);
  const configuredAt = now();
  if (!nonEmpty(liveUser.name) || !validTimestamp(configuredAt)) {
    throw new TypeError("Equipment policy configuration requires current GM identity and time evidence.");
  }
  const normalized = normalizeEquipmentWorldPolicy(raw);
  const attributed: EquipmentWorldPolicyV1 = {
    ...normalized,
    recipeDecision: {
      version: 1,
      configuredBy: { userId: principal.userId, userName: liveUser.name },
      configuredAt,
    },
  };
  await game.settings.set(MODULE_ID, SETTINGS.equipmentPolicy, attributed);
  return attributed;
}

export async function saveTrustedEquipmentPolicyJudgment(input: {
  readonly id: string;
  readonly facts: EquipmentPolicyJudgmentFacts;
  readonly reason: string;
  readonly recordedAt: string;
  readonly request?: EquipmentPolicyRequestV1;
  readonly user?: unknown;
}): Promise<EquipmentPolicyJudgmentRecord> {
  const user = record(input.user ?? game.user);
  const principal = requireLiveGmPrincipal(user);
  if (!nonEmpty(input.id) || !nonEmpty(input.reason) || !validTimestamp(input.recordedAt)) {
    throw new TypeError("Equipment judgment identity, time, and reason are required.");
  }
  const request = normalizeEquipmentPolicyRequest(
    input.request ??
      createEquipmentPolicyRequest({
        requestId: `direct:${input.id}`,
        facts: input.facts,
        requesterUserId: principal.userId,
        requesterName: nonEmpty(user.name) ? user.name : principal.userId,
        requestedAt: input.recordedAt,
        reason: input.reason,
      })
  );
  if (
    !request ||
    request.withdrawnAt !== null ||
    request.factsFingerprint !== buildEquipmentPolicyJudgmentFactsFingerprint(input.facts) ||
    !equipmentPolicyJudgmentFactsEqual(request.facts, input.facts) ||
    Date.parse(input.recordedAt) < Date.parse(request.requestedAt)
  ) {
    throw new TypeError("Equipment approval requires a current request for the exact approved facts.");
  }
  const judgment: EquipmentPolicyJudgmentRecord = {
    id: input.id,
    kind: input.facts.kind,
    actorId: input.facts.actorId,
    draftId: input.facts.draftId,
    targetLevel: input.facts.targetLevel,
    factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(input.facts),
    authorUserId: principal.userId,
    authorName: nonEmpty(user.name) ? user.name : principal.userId,
    recordedAt: input.recordedAt,
    reason: input.reason.trim(),
    request: {
      requestId: request.requestId,
      requesterUserId: request.requesterUserId,
      requesterName: request.requesterName,
      requestedAt: request.requestedAt,
      reason: request.reason,
      facts: structuredClone(request.facts),
    },
    revocation: null,
  };
  return convergeJudgmentStore((current) => {
    const existing = current.find((candidate) => candidate.id === judgment.id);
    if (existing) {
      if (JSON.stringify({ ...existing, revocation: null }) !== JSON.stringify(judgment)) {
        throw new TypeError("Equipment judgment ID already belongs to different facts.");
      }
      if (existing.revocation) throw new TypeError("A revoked equipment judgment cannot be restored.");
      return { judgments: current, result: existing };
    }
    return { judgments: [...current, judgment], result: judgment };
  });
}

export async function revokeTrustedEquipmentPolicyJudgment(input: {
  readonly judgmentId: string;
  readonly reason: string;
  readonly revokedAt: string;
  readonly user?: unknown;
}): Promise<EquipmentPolicyJudgmentRecord> {
  const user = record(input.user ?? game.user);
  const principal = requireLiveGmPrincipal(user);
  if (!nonEmpty(input.judgmentId) || !nonEmpty(input.reason) || !validTimestamp(input.revokedAt)) {
    throw new TypeError("Equipment judgment revocation identity, time, and reason are required.");
  }
  const current = getEquipmentPolicyJudgmentStoreSetting();
  const index = current.judgments.findIndex((candidate) => candidate.id === input.judgmentId);
  if (index < 0) throw new TypeError("The equipment judgment no longer exists.");
  const existing = current.judgments[index]!;
  if (existing.revocation) return existing;
  if (Date.parse(input.revokedAt) < Date.parse(existing.recordedAt)) {
    throw new TypeError("Equipment judgment revocation cannot predate its approval.");
  }
  const revoked: EquipmentPolicyJudgmentRecord = {
    ...existing,
    revocation: {
      revokedByUserId: principal.userId,
      revokedByName: nonEmpty(user.name) ? user.name : principal.userId,
      revokedAt: input.revokedAt,
      reason: input.reason.trim(),
    },
  };
  return convergeJudgmentStore((latest) => {
    const candidate = latest.find((entry) => entry.id === input.judgmentId);
    if (!candidate) throw new TypeError("The equipment judgment no longer exists.");
    if (candidate.revocation) return { judgments: latest, result: candidate };
    const next = latest.map((entry) => (entry.id === revoked.id ? revoked : entry));
    return { judgments: next, result: revoked };
  });
}

async function convergeJudgmentStore(
  mutate: (current: readonly EquipmentPolicyJudgmentRecord[]) => {
    readonly judgments: readonly EquipmentPolicyJudgmentRecord[];
    readonly result: EquipmentPolicyJudgmentRecord;
  }
): Promise<EquipmentPolicyJudgmentRecord> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = getEquipmentPolicyJudgmentStoreSetting().judgments;
    const mutation = mutate(current);
    if (mutation.judgments === current) return mutation.result;
    const intended = mergeJudgmentRecords(current, mutation.judgments);
    await game.settings.set(MODULE_ID, SETTINGS.equipmentPolicyJudgments, { version: 1, judgments: intended });
    const persisted = getEquipmentPolicyJudgmentStoreSetting().judgments;
    if (judgmentStoreContains(persisted, intended)) {
      return persisted.find((candidate) => candidate.id === mutation.result.id)!;
    }
  }
  throw new Error("Equipment authority store did not converge without losing a newer decision.");
}

function mergeJudgmentRecords(
  base: readonly EquipmentPolicyJudgmentRecord[],
  next: readonly EquipmentPolicyJudgmentRecord[]
): EquipmentPolicyJudgmentRecord[] {
  const merged = new Map(base.map((judgment) => [judgment.id, judgment]));
  for (const judgment of next) {
    const existing = merged.get(judgment.id);
    if (!existing) {
      merged.set(judgment.id, judgment);
      continue;
    }
    if (JSON.stringify({ ...existing, revocation: null }) !== JSON.stringify({ ...judgment, revocation: null })) {
      throw new TypeError("Equipment judgment ID already belongs to different facts.");
    }
    merged.set(judgment.id, existing.revocation ? existing : judgment);
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function judgmentStoreContains(
  persisted: readonly EquipmentPolicyJudgmentRecord[],
  intended: readonly EquipmentPolicyJudgmentRecord[]
): boolean {
  const byId = new Map(persisted.map((judgment) => [judgment.id, judgment]));
  return intended.every((judgment) => {
    const actual = byId.get(judgment.id);
    if (!actual) return false;
    if (judgment.revocation && !actual.revocation) return false;
    return JSON.stringify({ ...actual, revocation: null }) === JSON.stringify({ ...judgment, revocation: null });
  });
}

function requireLiveGmPrincipal(user: Record<string, unknown>): ReturnType<typeof requireCurrentGmPrincipal> {
  const claimed = requireCurrentGmPrincipal(user);
  const live = typeof game.users?.get === "function" ? game.users.get(claimed.userId) : null;
  return requireCurrentGmPrincipal(live);
}

export function createOwnerStartAttestation(input: {
  readonly actor: unknown;
  readonly draftId: string;
  readonly targetLevel: number;
  readonly startKind: HigherLevelStartKind;
  readonly reason: string;
  readonly recordedAt: string;
  readonly user?: unknown;
}): EquipmentOwnerStartAttestation {
  assertCanUseWayfinder(input.actor);
  const user = record(input.user ?? game.user);
  if (
    !nonEmpty(user.id) ||
    !nonEmpty(input.draftId) ||
    !Number.isSafeInteger(input.targetLevel) ||
    input.targetLevel < 2 ||
    input.targetLevel > 20 ||
    !["new-campaign", "replacement-character"].includes(input.startKind) ||
    !nonEmpty(input.reason) ||
    !validTimestamp(input.recordedAt)
  ) {
    throw new TypeError("Owner start attestation facts, time, and reason are required.");
  }
  return {
    kind: "actor-owner-attestation",
    startKind: input.startKind,
    actorId: actorIdentity(input.actor),
    draftId: input.draftId,
    targetLevel: input.targetLevel,
    authorUserId: user.id,
    authorName: nonEmpty(user.name) ? user.name : user.id,
    recordedAt: input.recordedAt,
    reason: input.reason.trim(),
  };
}

function verifyCurrentOwnerAttestation(actor: unknown, attestation: EquipmentOwnerStartAttestation): boolean {
  const user = record(game.user);
  if (!nonEmpty(user.id) || attestation.actorId !== actorIdentity(actor)) return false;
  if (attestation.authorUserId === user.id) {
    try {
      assertCanUseWayfinder(actor);
      return true;
    } catch {
      return false;
    }
  }
  if (user.isGM !== true) return false;
  const users = game.users;
  const author = typeof users?.get === "function" ? users.get(attestation.authorUserId) : null;
  const actorRecord = record(actor);
  const testUserPermission = actorRecord.testUserPermission;
  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return (
    author != null &&
    typeof testUserPermission === "function" &&
    (testUserPermission as (user: unknown, level: number) => unknown).call(actor, author, ownerLevel) === true
  );
}

function actorIdentity(actor: unknown): string {
  const id = record(actor).id;
  if (!nonEmpty(id)) throw new TypeError("Equipment policy requires a bound actor ID.");
  return id;
}

function discoverCurrentEquipmentPacks(): InstalledEquipmentPackDescriptor[] {
  return discoverInstalledEquipmentPackDescriptors({ packs: game.packs });
}

function validTimestamp(value: unknown): value is string {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
