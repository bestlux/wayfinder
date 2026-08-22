import { MODULE_ID, SETTINGS } from "../../constants.js";
import { assertCanUseWayfinder } from "../../permissions.js";
import { getEquipmentPolicyJudgmentStoreSetting, getEquipmentWorldPolicySetting } from "../../settings.js";
import type { AcquisitionDraftState } from "../domain/acquisition-types.js";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyRequest,
  createEquipmentPolicyResolver,
  declineEquipmentPolicyRequest,
  type EffectiveEquipmentPolicySnapshotV1,
  type EquipmentHigherLevelStartClaim,
  type EquipmentOwnerStartAttestation,
  type EquipmentPolicyJudgmentFacts,
  type EquipmentPolicyJudgmentRecord,
  type EquipmentPolicyJudgmentStoreV1,
  type EquipmentPolicyRequestDecisionV1,
  type EquipmentPolicyRequestV1,
  type EquipmentPolicyResolutionInput,
  type EquipmentWorldPolicyV1,
  equipmentPolicyJudgmentFactsEqual,
  equipmentPolicyRequestEvidence,
  type HigherLevelStartKind,
  normalizeEquipmentPolicyRequest,
  normalizeEquipmentWorldPolicy,
  type OfficialEquipmentRecipe,
} from "../domain/equipment-policy.js";
import {
  assertCurrentEquipmentAuthorityWriter,
  coordinateEquipmentAuthorityOperation,
  type EquipmentAuthorityOperation,
  setEquipmentAuthorityHandler,
} from "./equipment-authority-coordinator.js";
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
  const abp = variantRules.AutomaticBonusProgression;
  const isEnabled = property(abp, "isEnabled");
  const enabled =
    typeof isEnabled === "function"
      ? Reflect.apply(isEnabled, abp, [actor]) === true
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

export interface SaveTrustedEquipmentPolicyJudgmentInput {
  readonly id: string;
  readonly facts: EquipmentPolicyJudgmentFacts;
  readonly reason: string;
  readonly recordedAt: string;
  readonly request?: EquipmentPolicyRequestV1;
  readonly user?: unknown;
}

export async function saveTrustedEquipmentPolicyJudgment(
  input: SaveTrustedEquipmentPolicyJudgmentInput
): Promise<EquipmentPolicyJudgmentRecord> {
  const { user = game.user, ...operationInput } = input;
  return coordinateEquipmentAuthorityOperation<EquipmentPolicyJudgmentRecord>(
    { type: "approve-request", input: operationInput },
    user
  );
}

async function saveTrustedEquipmentPolicyJudgmentLocally(
  input: SaveTrustedEquipmentPolicyJudgmentInput
): Promise<EquipmentPolicyJudgmentRecord> {
  const user = record(input.user ?? game.user);
  requireLiveGmPrincipal(user);
  if (!nonEmpty(input.id) || !nonEmpty(input.reason) || !validTimestamp(input.recordedAt)) {
    throw new TypeError("Equipment judgment identity, time, and reason are required.");
  }
  return brokerJudgmentStoreWrite(async () => {
    const principal = requireLiveGmPrincipal(user);
    const factsFingerprint = buildEquipmentPolicyJudgmentFactsFingerprint(input.facts);
    if (!input.request) {
      return convergeAuthorityStore((current) => {
        const directPrefix = `direct:${factsFingerprint}:`;
        const matching = current.judgments.filter(
          (candidate) =>
            candidate.request.requestId.startsWith(directPrefix) &&
            equipmentPolicyJudgmentFactsEqual(candidate.request.facts, input.facts)
        );
        const active = matching.find(
          (candidate) => candidate.revocation === null && isCurrentGmUser(candidate.authorUserId)
        );
        if (active) return { store: current, result: active };

        const directId = `${directPrefix}${matching.length + 1}`;
        const request = createEquipmentPolicyRequest({
          requestId: directId,
          facts: input.facts,
          requesterUserId: principal.userId,
          requesterName: nonEmpty(user.name) ? user.name : principal.userId,
          requestedAt: input.recordedAt,
          reason: input.reason,
        });
        const judgment = createJudgmentRecord(directId, request, principal, user, input.recordedAt, input.reason);
        const decision = createRequestDecision(request, "approved", principal, user, input.recordedAt, input.reason);
        return {
          store: {
            ...current,
            judgments: [...current.judgments, judgment],
            requestDecisions: mergeRequestDecisionRecords(current.requestDecisions, [decision]),
          },
          result: judgment,
        };
      });
    }

    const request = normalizeEquipmentPolicyRequest(input.request);
    if (
      !request ||
      request.withdrawnAt !== null ||
      request.decline !== null ||
      request.factsFingerprint !== factsFingerprint ||
      !equipmentPolicyJudgmentFactsEqual(request.facts, input.facts) ||
      Date.parse(input.recordedAt) < Date.parse(request.requestedAt)
    ) {
      throw new TypeError("Equipment approval requires a current request for the exact approved facts.");
    }
    const judgment = createJudgmentRecord(input.id, request, principal, user, input.recordedAt, input.reason);
    const decision = createRequestDecision(request, "approved", principal, user, input.recordedAt, input.reason);
    return convergeAuthorityStore((current) => {
      const requestDecisions = mergeRequestDecisionRecords(current.requestDecisions, [decision]);
      const existing = current.judgments.find((candidate) => candidate.id === judgment.id);
      if (existing) {
        if (JSON.stringify(judgmentIdentity(existing)) !== JSON.stringify(judgmentIdentity(judgment))) {
          throw new TypeError("Equipment judgment ID already belongs to different facts.");
        }
        if (existing.revocation) throw new TypeError("A revoked equipment judgment cannot be restored.");
        return { store: { ...current, requestDecisions }, result: existing };
      }
      return {
        store: { ...current, judgments: [...current.judgments, judgment], requestDecisions },
        result: judgment,
      };
    });
  });
}

export interface SaveTrustedEquipmentPolicyRequestDeclineInput {
  readonly request: EquipmentPolicyRequestV1;
  readonly reason: string;
  readonly declinedAt: string;
  readonly user?: unknown;
}

export async function saveTrustedEquipmentPolicyRequestDecline(
  input: SaveTrustedEquipmentPolicyRequestDeclineInput
): Promise<EquipmentPolicyRequestV1> {
  const { user = game.user, ...operationInput } = input;
  return coordinateEquipmentAuthorityOperation<EquipmentPolicyRequestV1>(
    { type: "decline-request", input: operationInput },
    user
  );
}

async function saveTrustedEquipmentPolicyRequestDeclineLocally(
  input: SaveTrustedEquipmentPolicyRequestDeclineInput
): Promise<EquipmentPolicyRequestV1> {
  const user = record(input.user ?? game.user);
  requireLiveGmPrincipal(user);
  if (!nonEmpty(input.reason) || !validTimestamp(input.declinedAt)) {
    throw new TypeError("Equipment request decline time and reason are required.");
  }
  return brokerJudgmentStoreWrite(async () => {
    const principal = requireLiveGmPrincipal(user);
    const request = normalizeEquipmentPolicyRequest(input.request);
    if (
      !request ||
      request.withdrawnAt !== null ||
      request.decline !== null ||
      Date.parse(input.declinedAt) < Date.parse(request.requestedAt)
    ) {
      throw new TypeError("Equipment decline requires a current request for the exact requested facts.");
    }
    const decision = createRequestDecision(request, "declined", principal, user, input.declinedAt, input.reason);
    const persisted = await convergeAuthorityStore((current) => {
      const requestDecisions = mergeRequestDecisionRecords(current.requestDecisions, [decision]);
      return {
        store: { ...current, requestDecisions },
        result: requestDecisions.find((candidate) => candidate.request.requestId === request.requestId)!,
      };
    });
    return declineEquipmentPolicyRequest(request, {
      declinedByUserId: persisted.decidedByUserId,
      declinedByName: persisted.decidedByName,
      declinedAt: persisted.decidedAt,
      reason: persisted.reason,
    });
  });
}

export interface RevokeTrustedEquipmentPolicyJudgmentInput {
  readonly judgmentId: string;
  readonly reason: string;
  readonly revokedAt: string;
  readonly user?: unknown;
}

export async function revokeTrustedEquipmentPolicyJudgment(
  input: RevokeTrustedEquipmentPolicyJudgmentInput
): Promise<EquipmentPolicyJudgmentRecord> {
  const { user = game.user, ...operationInput } = input;
  return coordinateEquipmentAuthorityOperation<EquipmentPolicyJudgmentRecord>(
    { type: "revoke-judgment", input: operationInput },
    user
  );
}

async function revokeTrustedEquipmentPolicyJudgmentLocally(
  input: RevokeTrustedEquipmentPolicyJudgmentInput
): Promise<EquipmentPolicyJudgmentRecord> {
  const user = record(input.user ?? game.user);
  requireLiveGmPrincipal(user);
  if (!nonEmpty(input.judgmentId) || !nonEmpty(input.reason) || !validTimestamp(input.revokedAt)) {
    throw new TypeError("Equipment judgment revocation identity, time, and reason are required.");
  }
  return brokerJudgmentStoreWrite(async () => {
    const principal = requireLiveGmPrincipal(user);
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
    return convergeAuthorityStore((latest) => {
      const candidate = latest.judgments.find((entry) => entry.id === input.judgmentId);
      if (!candidate) throw new TypeError("The equipment judgment no longer exists.");
      if (candidate.revocation) return { store: latest, result: candidate };
      const judgments = latest.judgments.map((entry) => (entry.id === revoked.id ? revoked : entry));
      return { store: { ...latest, judgments }, result: revoked };
    });
  });
}

setEquipmentAuthorityHandler(async (operation: EquipmentAuthorityOperation, requester: unknown) => {
  switch (operation.type) {
    case "approve-request":
      return saveTrustedEquipmentPolicyJudgmentLocally({
        ...(operation.input as unknown as Omit<SaveTrustedEquipmentPolicyJudgmentInput, "user">),
        user: requester,
      });
    case "decline-request":
      return saveTrustedEquipmentPolicyRequestDeclineLocally({
        ...(operation.input as unknown as Omit<SaveTrustedEquipmentPolicyRequestDeclineInput, "user">),
        user: requester,
      });
    case "revoke-judgment":
      return revokeTrustedEquipmentPolicyJudgmentLocally({
        ...(operation.input as unknown as Omit<RevokeTrustedEquipmentPolicyJudgmentInput, "user">),
        user: requester,
      });
  }
});

// The socket coordinator routes every public decision through Foundry's one active GM. This
// module-local broker is the second serialization boundary for authority operations already
// accepted by that client; convergence below preserves independently added store facts.
let judgmentStoreWriteTail: Promise<void> = Promise.resolve();

function brokerJudgmentStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = judgmentStoreWriteTail.then(operation, operation);
  judgmentStoreWriteTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function convergeAuthorityStore<T>(
  mutate: (current: EquipmentPolicyJudgmentStoreV1) => {
    readonly store: EquipmentPolicyJudgmentStoreV1;
    readonly result: T;
  }
): Promise<T> {
  let carried: EquipmentPolicyJudgmentStoreV1 = { version: 1, judgments: [], requestDecisions: [] };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = getEquipmentPolicyJudgmentStoreSetting();
    const current = mergeAuthorityStores(carried, observed);
    const mutation = mutate(current);
    const intended = mergeAuthorityStores(current, mutation.store);
    if (authorityStoreContains(observed, intended)) return mutation.result;
    assertCurrentEquipmentAuthorityWriter();
    await game.settings.set(MODULE_ID, SETTINGS.equipmentPolicyJudgments, intended);
    const persisted = getEquipmentPolicyJudgmentStoreSetting();
    if (authorityStoreContains(persisted, intended)) return mutation.result;
    assertCurrentEquipmentAuthorityWriter();
    carried = mergeAuthorityStores(intended, persisted);
  }
  throw new Error("Equipment authority store did not converge without losing a newer decision.");
}

function mergeAuthorityStores(
  base: EquipmentPolicyJudgmentStoreV1,
  next: EquipmentPolicyJudgmentStoreV1
): EquipmentPolicyJudgmentStoreV1 {
  return {
    version: 1,
    judgments: mergeJudgmentRecords(base.judgments, next.judgments),
    requestDecisions: mergeRequestDecisionRecords(base.requestDecisions, next.requestDecisions),
  };
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

function authorityStoreContains(
  persisted: EquipmentPolicyJudgmentStoreV1,
  intended: EquipmentPolicyJudgmentStoreV1
): boolean {
  const byId = new Map(persisted.judgments.map((judgment) => [judgment.id, judgment]));
  const judgmentsPresent = intended.judgments.every((judgment) => {
    const actual = byId.get(judgment.id);
    if (!actual) return false;
    if (judgment.revocation && !actual.revocation) return false;
    return JSON.stringify({ ...actual, revocation: null }) === JSON.stringify({ ...judgment, revocation: null });
  });
  if (!judgmentsPresent) return false;
  const decisionsByRequestId = new Map(
    persisted.requestDecisions.map((decision) => [decision.request.requestId, decision])
  );
  return intended.requestDecisions.every(
    (decision) => JSON.stringify(decisionsByRequestId.get(decision.request.requestId)) === JSON.stringify(decision)
  );
}

function mergeRequestDecisionRecords(
  base: readonly EquipmentPolicyRequestDecisionV1[],
  next: readonly EquipmentPolicyRequestDecisionV1[]
): EquipmentPolicyRequestDecisionV1[] {
  const merged = new Map(base.map((decision) => [decision.request.requestId, decision]));
  for (const decision of next) {
    const existing = merged.get(decision.request.requestId);
    if (
      existing &&
      JSON.stringify(requestDecisionIdentity(existing)) !== JSON.stringify(requestDecisionIdentity(decision))
    ) {
      throw new TypeError("Equipment request already has a different authoritative decision.");
    }
    merged.set(decision.request.requestId, existing ?? decision);
  }
  return [...merged.values()].sort((left, right) => left.request.requestId.localeCompare(right.request.requestId));
}

function requestDecisionIdentity(decision: EquipmentPolicyRequestDecisionV1): Record<string, unknown> {
  return {
    outcome: decision.outcome,
    factsFingerprint: decision.factsFingerprint,
    request: decision.request,
  };
}

function judgmentIdentity(judgment: EquipmentPolicyJudgmentRecord): Record<string, unknown> {
  return {
    id: judgment.id,
    kind: judgment.kind,
    actorId: judgment.actorId,
    draftId: judgment.draftId,
    targetLevel: judgment.targetLevel,
    factsFingerprint: judgment.factsFingerprint,
    request: judgment.request,
  };
}

function createJudgmentRecord(
  id: string,
  request: EquipmentPolicyRequestV1,
  principal: ReturnType<typeof requireCurrentGmPrincipal>,
  user: Record<string, unknown>,
  recordedAt: string,
  reason: string
): EquipmentPolicyJudgmentRecord {
  return {
    id,
    kind: request.facts.kind,
    actorId: request.facts.actorId,
    draftId: request.facts.draftId,
    targetLevel: request.facts.targetLevel,
    factsFingerprint: request.factsFingerprint,
    authorUserId: principal.userId,
    authorName: nonEmpty(user.name) ? user.name : principal.userId,
    recordedAt,
    reason: reason.trim(),
    request: equipmentPolicyRequestEvidence(request),
    revocation: null,
  };
}

function createRequestDecision(
  request: EquipmentPolicyRequestV1,
  outcome: EquipmentPolicyRequestDecisionV1["outcome"],
  principal: ReturnType<typeof requireCurrentGmPrincipal>,
  user: Record<string, unknown>,
  decidedAt: string,
  reason: string
): EquipmentPolicyRequestDecisionV1 {
  return {
    version: 1,
    outcome,
    factsFingerprint: request.factsFingerprint,
    request: equipmentPolicyRequestEvidence(request),
    decidedByUserId: principal.userId,
    decidedByName: nonEmpty(user.name) ? user.name : principal.userId,
    decidedAt,
    reason: reason.trim(),
  };
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

function property(value: unknown, key: string): unknown {
  return (typeof value === "object" && value !== null) || typeof value === "function"
    ? Reflect.get(value, key)
    : undefined;
}
