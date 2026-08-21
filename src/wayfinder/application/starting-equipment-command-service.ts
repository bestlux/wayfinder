import { getEquipmentWorldPolicySetting } from "../../settings.js";
import type { DraftState, ModuleState, PendingStep } from "../../types.js";
import {
  acknowledgeAcquisitionHandoff,
  createAcquisitionDraft,
  createAcquisitionPolicySnapshot,
  invalidateAcquisitionReview,
  normalizeAcquisitionDraft,
  recordConfiguredItemHandoff,
  recordEconomicAdmission,
  recordPlannedClassGrants,
} from "../domain/acquisition-draft.js";
import { mintAcquisitionIdentitySeed } from "../domain/acquisition-identity.js";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionLedger,
  reviewPurchaseLedger,
  reviewRetainAll,
} from "../domain/acquisition-ledger.js";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../domain/acquisition-types.js";
import { createPreparedClassGrantPlan, type PlannedClassGrantV1 } from "../domain/class-grant-reconciliation.js";
import type {
  EquipmentHigherLevelStartClaim,
  EquipmentHigherLevelStartEvidence,
  EquipmentPolicyRequestV1,
  HigherLevelStartKind,
  OfficialEquipmentRecipe,
} from "../domain/equipment-policy.js";
import { createEquipmentPolicyRequest, equipmentPolicyJudgmentFactsEqual } from "../domain/equipment-policy.js";
import { prepareCurrentClassGrantPlan, projectCurrentClassGrants } from "./class-grant-projection-service.js";
import type { EconomicActorLike } from "./economic-baseline-service.js";
import { evaluateActorEconomicAdmission } from "./economic-baseline-service.js";
import {
  type ConfiguredItemHandoffReason,
  type CurrentEquipmentAccessRequest,
  type CurrentEquipmentExceptionRequest,
  getFoundryEquipmentAcquisitionRuntime,
  type NativeClassGrantLineRequest,
} from "./equipment-acquisition-runtime-service.js";
import {
  createOwnerStartAttestation,
  resolveEquipmentPolicyForActor,
  revokeTrustedEquipmentPolicyJudgment,
  saveTrustedEquipmentPolicyJudgment,
} from "./equipment-policy-service.js";

export type StartingEquipmentCommand =
  | { readonly type: "initialize"; readonly selectedRecipe?: OfficialEquipmentRecipe }
  | { readonly type: "select-recipe"; readonly selectedRecipe: OfficialEquipmentRecipe }
  | {
      readonly type: "activate-policy";
      readonly startKind: HigherLevelStartKind;
      readonly reason: string;
    }
  | {
      readonly type: "request-higher-level-start";
      readonly startKind: HigherLevelStartKind;
      readonly reason: string;
    }
  | { readonly type: "approve-policy-request"; readonly requestId: string; readonly reason: string }
  | { readonly type: "request-item-exception"; readonly sourceUuid: string; readonly reason: string }
  | { readonly type: "approve-item-exception"; readonly sourceUuid: string; readonly reason: string }
  | { readonly type: "revoke-policy-judgment"; readonly judgmentId: string; readonly reason: string }
  | { readonly type: "set-custom-lump-sum"; readonly amountCopper: number; readonly reason: string }
  | { readonly type: "grant-extra-current-level-allowance"; readonly reason: string }
  | { readonly type: "add-line"; readonly line: AcquisitionLineDraft }
  | { readonly type: "enter-configured-item-handoff"; readonly reason: ConfiguredItemHandoffReason }
  | { readonly type: "remove-line"; readonly lineId: string }
  | { readonly type: "set-quantity"; readonly lineId: string; readonly quantity: number }
  | { readonly type: "review-purchases" }
  | { readonly type: "retain-all" }
  | { readonly type: "acknowledge-handoff" };

export interface StartingEquipmentCommandContext {
  readonly actor: unknown;
  readonly draft: DraftState;
  readonly moduleState: ModuleState;
  readonly steps: readonly PendingStep[];
  readonly userId: string;
  readonly user?: unknown;
  readonly now: () => string;
}

export interface StartingEquipmentCommandResult {
  readonly acquisition: AcquisitionDraftState;
  readonly changed: boolean;
  readonly statusNote: string;
  readonly policyRequests: readonly EquipmentPolicyRequestV1[];
}

interface StartingEquipmentCommandDependencies {
  readonly mintIdentity: typeof mintAcquisitionIdentitySeed;
  readonly resolvePolicy: typeof resolveEquipmentPolicyForActor;
  readonly getWorldPolicy: typeof getEquipmentWorldPolicySetting;
  readonly createOwnerStartAttestation: typeof createOwnerStartAttestation;
  readonly saveJudgment: typeof saveTrustedEquipmentPolicyJudgment;
  readonly revokeJudgment: typeof revokeTrustedEquipmentPolicyJudgment;
  readonly createRequest: typeof createEquipmentPolicyRequest;
  readonly mintRequestId: () => string;
  readonly mintJudgmentId: () => string;
  readonly projectClassGrants: typeof projectCurrentClassGrants;
  readonly prepareClassGrantPlan: typeof prepareCurrentClassGrantPlan;
  readonly prepareNativeGrantLines: (request: NativeClassGrantLineRequest) => Promise<readonly AcquisitionLineDraft[]>;
  readonly resolveCharacterAccessRef: (request: CurrentEquipmentAccessRequest) => Promise<string | null>;
  readonly resolveItemExceptionFacts: (
    request: CurrentEquipmentExceptionRequest
  ) => ReturnType<ReturnType<typeof getFoundryEquipmentAcquisitionRuntime>["resolveItemExceptionFacts"]>;
  readonly evaluateAdmission: typeof evaluateActorEconomicAdmission;
  readonly evaluateLedger: typeof evaluateAcquisitionLedger;
}

const DEFAULT_DEPS: StartingEquipmentCommandDependencies = {
  mintIdentity: mintAcquisitionIdentitySeed,
  resolvePolicy: resolveEquipmentPolicyForActor,
  getWorldPolicy: getEquipmentWorldPolicySetting,
  createOwnerStartAttestation,
  saveJudgment: saveTrustedEquipmentPolicyJudgment,
  revokeJudgment: revokeTrustedEquipmentPolicyJudgment,
  createRequest: createEquipmentPolicyRequest,
  mintRequestId: () => crypto.randomUUID(),
  mintJudgmentId: () => crypto.randomUUID(),
  projectClassGrants: projectCurrentClassGrants,
  prepareClassGrantPlan: prepareCurrentClassGrantPlan,
  prepareNativeGrantLines: (request) => getFoundryEquipmentAcquisitionRuntime().prepareNativeClassGrantLines(request),
  resolveCharacterAccessRef: (request) =>
    getFoundryEquipmentAcquisitionRuntime().resolveCurrentCharacterAccessRef(request),
  resolveItemExceptionFacts: (request) => getFoundryEquipmentAcquisitionRuntime().resolveItemExceptionFacts(request),
  evaluateAdmission: evaluateActorEconomicAdmission,
  evaluateLedger: evaluateAcquisitionLedger,
};

export async function executeStartingEquipmentCommand(
  command: StartingEquipmentCommand,
  context: StartingEquipmentCommandContext,
  dependencyOverrides: Partial<StartingEquipmentCommandDependencies> = {}
): Promise<StartingEquipmentCommandResult> {
  const deps: StartingEquipmentCommandDependencies = { ...DEFAULT_DEPS, ...dependencyOverrides };
  assertCommandContext(context);
  if (context.draft.acquisitionCorrupt) {
    throw new TypeError("The starting-equipment draft is malformed and cannot be changed.");
  }
  const before = context.draft.acquisition;
  let acquisition: AcquisitionDraftState;
  let policyRequests: readonly EquipmentPolicyRequestV1[] = context.draft.equipmentPolicyRequests;
  let statusNote: string;

  switch (command.type) {
    case "initialize": {
      const initialized = before ? null : await initializeAcquisition(context, deps, command.selectedRecipe);
      acquisition = before ?? initialized!.acquisition;
      statusNote = before
        ? "Your equipment step is already open."
        : initialized!.awaitingAuthority
          ? "Starting-equipment setup is ready. Confirm this higher-level start before shopping."
          : initialized!.pendingTitanSelection
            ? "Ready to shop. Pick your Titan Mauler weapon before you finish."
            : "Ready to shop.";
      break;
    }
    case "select-recipe":
      acquisition = selectStagedRecipe(requireAcquisition(context.draft), command.selectedRecipe, deps);
      statusNote = `Using ${command.selectedRecipe === "permanent-items" ? "permanent items and coin" : "a lump sum"}.`;
      break;
    case "activate-policy": {
      const staged = requireAcquisition(context.draft);
      const claim = await createHigherLevelStartClaim(staged, command.startKind, command.reason, context, deps);
      if (staged.policySnapshot) {
        const policy = resolveExistingPolicy(staged, context, deps, { higherLevelStartClaim: claim });
        acquisition = invalidateAcquisitionReview(
          { ...staged, policySnapshot: createAcquisitionPolicySnapshot(policy, staged.recipe) },
          ["policy"]
        );
        statusNote = "Higher-level starting wealth reapproved. Review the current cart before Apply.";
      } else {
        const activated = await activateAcquisition(staged, context, deps, claim);
        acquisition = activated.acquisition;
        statusNote = activated.pendingTitanSelection
          ? "Ready to shop. Pick your Titan Mauler weapon before you finish."
          : "Higher-level starting wealth confirmed. Ready to shop.";
      }
      break;
    }
    case "request-higher-level-start": {
      acquisition = requireAcquisition(context.draft);
      if (acquisition.targetLevel === 1) {
        throw new TypeError("A higher-level start request requires a higher-level equipment draft.");
      }
      const request = deps.createRequest({
        requestId: deps.mintRequestId(),
        facts: {
          kind: "higher-level-start",
          actorId: actorId(context.actor),
          draftId: acquisition.draftId,
          targetLevel: acquisition.targetLevel,
          startKind: command.startKind,
        },
        requesterUserId: context.userId,
        requesterName: userName(context.user, context.userId),
        requestedAt: context.now(),
        reason: command.reason,
      });
      policyRequests = replacePolicyRequest(policyRequests, request);
      statusNote = "Higher-level start approval requested from a GM.";
      break;
    }
    case "approve-policy-request": {
      const current = requireAcquisition(context.draft);
      const request = requireCurrentPolicyRequest(policyRequests, command.requestId, current, actorId(context.actor));
      if (request.facts.kind === "rarity-source-exception") {
        if (!current.policySnapshot) {
          throw new TypeError("Activate starting-equipment policy before approving an item exception.");
        }
        const currentFacts = await deps.resolveItemExceptionFacts({
          actor: context.actor,
          characterDraft: context.draft,
          acquisition: current,
          sourceUuid: request.facts.sourceUuid,
        });
        if (!equipmentPolicyJudgmentFactsEqual(currentFacts, request.facts)) {
          throw new TypeError("Equipment exception request facts changed before approval.");
        }
        const judgment = await deps.saveJudgment({
          id: `approval:${request.requestId}`,
          facts: request.facts,
          request,
          reason: command.reason,
          recordedAt: context.now(),
          user: context.user,
        });
        const exceptionJudgmentIds = [
          ...current.policySnapshot.material.gmJudgments
            .filter((candidate) => candidate.kind === "rarity-source-exception")
            .map((candidate) => candidate.id),
          judgment.id,
        ];
        const policy = resolveExistingPolicy(current, context, deps, { exceptionJudgmentIds });
        acquisition = invalidateAcquisitionReview(
          { ...current, policySnapshot: createAcquisitionPolicySnapshot(policy, current.recipe) },
          ["policy"]
        );
        statusNote = "Exact item source and rarity exception approved. The item can now be added normally.";
        break;
      }
      if (request.facts.kind !== "higher-level-start") {
        throw new TypeError("This equipment request requires its dedicated GM command.");
      }
      const judgment = await deps.saveJudgment({
        id: `approval:${request.requestId}`,
        facts: request.facts,
        request,
        reason: command.reason,
        recordedAt: context.now(),
        user: context.user,
      });
      const claim = {
        kind: "gm-confirmation",
        judgmentId: judgment.id,
        startKind: request.facts.startKind,
      } as const;
      if (current.policySnapshot) {
        const policy = resolveExistingPolicy(current, context, deps, { higherLevelStartClaim: claim });
        acquisition = invalidateAcquisitionReview(
          { ...current, policySnapshot: createAcquisitionPolicySnapshot(policy, current.recipe) },
          ["policy"]
        );
        statusNote = "Higher-level start reapproved. Review the current cart before Apply.";
      } else {
        const activated = await activateAcquisition(current, context, deps, claim);
        acquisition = activated.acquisition;
        statusNote = "Higher-level start approved. Ready to shop.";
      }
      break;
    }
    case "request-item-exception": {
      acquisition = requireActiveAcquisition(context.draft);
      const facts = await deps.resolveItemExceptionFacts({
        actor: context.actor,
        characterDraft: context.draft,
        acquisition,
        sourceUuid: command.sourceUuid,
      });
      const request = deps.createRequest({
        requestId: deps.mintRequestId(),
        facts,
        requesterUserId: context.userId,
        requesterName: userName(context.user, context.userId),
        requestedAt: context.now(),
        reason: command.reason,
      });
      policyRequests = replacePolicyRequest(policyRequests, request);
      statusNote = "Exact item exception requested from a GM.";
      break;
    }
    case "approve-item-exception": {
      const current = requireActiveAcquisition(context.draft);
      const facts = await deps.resolveItemExceptionFacts({
        actor: context.actor,
        characterDraft: context.draft,
        acquisition: current,
        sourceUuid: command.sourceUuid,
      });
      const judgment = await deps.saveJudgment({
        id: deps.mintJudgmentId(),
        facts,
        reason: command.reason,
        recordedAt: context.now(),
        user: context.user,
      });
      const exceptionJudgmentIds = [
        ...current
          .policySnapshot!.material.gmJudgments.filter((candidate) => candidate.kind === "rarity-source-exception")
          .map((candidate) => candidate.id),
        judgment.id,
      ];
      const policy = resolveExistingPolicy(current, context, deps, { exceptionJudgmentIds });
      acquisition = invalidateAcquisitionReview(
        { ...current, policySnapshot: createAcquisitionPolicySnapshot(policy, current.recipe) },
        ["policy"]
      );
      statusNote = "Exact item source and rarity exception approved. The item can now be added normally.";
      break;
    }
    case "revoke-policy-judgment": {
      acquisition = requireAcquisition(context.draft);
      const reviewedJudgment = acquisition.policySnapshot?.material.gmJudgments.find(
        (judgment) => judgment.id === command.judgmentId
      );
      if (
        !reviewedJudgment ||
        reviewedJudgment.actorId !== actorId(context.actor) ||
        reviewedJudgment.draftId !== acquisition.draftId ||
        reviewedJudgment.targetLevel !== acquisition.targetLevel
      ) {
        throw new TypeError("Only an approval bound to this equipment draft can be revoked here.");
      }
      await deps.revokeJudgment({
        judgmentId: command.judgmentId,
        reason: command.reason,
        revokedAt: context.now(),
        user: context.user,
      });
      acquisition = invalidateAcquisitionReview(acquisition, ["policy"]);
      statusNote = "Equipment authority revoked. Apply is blocked until current approval is recorded.";
      break;
    }
    case "set-custom-lump-sum": {
      const current = requireActiveAcquisition(context.draft);
      if (current.lines.some((line) => line.funding.lane === "allowance")) {
        throw new TypeError("Remove allowance-funded items before replacing the recipe with a custom lump sum.");
      }
      const judgmentId = deps.mintJudgmentId();
      await deps.saveJudgment({
        id: judgmentId,
        facts: {
          kind: "custom-lump-sum",
          actorId: actorId(context.actor),
          draftId: current.draftId,
          targetLevel: current.targetLevel,
          amountCopper: command.amountCopper,
        },
        reason: command.reason,
        recordedAt: context.now(),
        user: context.user,
      });
      const policy = resolveExistingPolicy(current, context, deps, {
        selectedRecipe: "lump-sum",
        customLumpSum: { amountCopper: command.amountCopper, judgmentId },
        extraCurrentLevelAllowanceIds: [],
      });
      const recipe = { kind: "custom-lump-sum", judgmentRef: judgmentId, amountCopper: command.amountCopper } as const;
      acquisition = invalidateAcquisitionReview(
        { ...current, recipe, policySnapshot: createAcquisitionPolicySnapshot(policy, recipe) },
        ["recipe", "policy", "budget"]
      );
      statusNote = "Custom lump sum approved for this draft.";
      break;
    }
    case "grant-extra-current-level-allowance": {
      const current = requireActiveAcquisition(context.draft);
      if (current.recipe.kind !== "permanent-items") {
        throw new TypeError("An extra current-level allowance requires the permanent-items recipe.");
      }
      if (
        current.policySnapshot!.material.allowances.some((allowance) => allowance.allowanceId.startsWith("gm-extra:"))
      ) {
        throw new TypeError("This draft already has its one extra current-level allowance.");
      }
      const judgmentId = deps.mintJudgmentId();
      await deps.saveJudgment({
        id: judgmentId,
        facts: {
          kind: "extra-current-level-allowance",
          actorId: actorId(context.actor),
          draftId: current.draftId,
          targetLevel: current.targetLevel,
        },
        reason: command.reason,
        recordedAt: context.now(),
        user: context.user,
      });
      const policy = resolveExistingPolicy(current, context, deps, {
        selectedRecipe: "permanent-items",
        extraCurrentLevelAllowanceIds: [judgmentId],
      });
      acquisition = invalidateAcquisitionReview(
        { ...current, policySnapshot: createAcquisitionPolicySnapshot(policy, current.recipe) },
        ["policy", "allowance"]
      );
      statusNote = "One extra current-level permanent-item allowance approved.";
      break;
    }
    case "add-line":
      acquisition = addPreparedLine(requireAcquisition(context.draft), command.line);
      statusNote = "Added to your cart.";
      break;
    case "enter-configured-item-handoff":
      acquisition = recordConfiguredItemHandoff(requireAcquisition(context.draft), command.reason);
      statusNote = `${command.reason.itemName} will be handled on the PF2E inventory sheet.`;
      break;
    case "remove-line":
      acquisition = removeLine(requireAcquisition(context.draft), command.lineId);
      statusNote = "Taken out of your cart.";
      break;
    case "set-quantity":
      acquisition = setLineQuantity(requireAcquisition(context.draft), command.lineId, command.quantity);
      statusNote = "Quantity updated.";
      break;
    case "review-purchases": {
      const prepared = await prepareLedger(context, deps);
      acquisition = reviewPurchaseLedger(prepared.acquisition, prepared.ledger, reviewer(context));
      statusNote = "Kit confirmed.";
      break;
    }
    case "retain-all": {
      const prepared = await prepareLedger(context, deps);
      acquisition = reviewRetainAll(prepared.acquisition, prepared.ledger, reviewer(context));
      statusNote = "You are keeping the rest of your coin.";
      break;
    }
    case "acknowledge-handoff":
      acquisition = acknowledgeAcquisitionHandoff(requireAcquisition(context.draft), {
        userId: context.userId,
        acknowledgedAt: context.now(),
      });
      statusNote = "PF2E inventory-sheet handoff acknowledged.";
      break;
  }

  return {
    acquisition,
    changed: acquisition !== before || policyRequests !== context.draft.equipmentPolicyRequests,
    statusNote,
    policyRequests,
  };
}

function resolveExistingPolicy(
  acquisition: AcquisitionDraftState,
  context: StartingEquipmentCommandContext,
  deps: StartingEquipmentCommandDependencies,
  overrides: Partial<Parameters<typeof resolveEquipmentPolicyForActor>[0]> = {}
) {
  const reviewed = acquisition.policySnapshot?.material;
  if (!reviewed) throw new TypeError("Starting-equipment policy is not active for this draft.");
  return deps.resolvePolicy({
    actor: context.actor,
    draftId: acquisition.draftId,
    targetLevel: acquisition.targetLevel,
    selectedRecipe: acquisition.recipe.kind === "permanent-items" ? "permanent-items" : "lump-sum",
    higherLevelStartClaim: higherLevelStartClaim(reviewed.higherLevelStartEvidence),
    customLumpSum:
      acquisition.recipe.kind === "custom-lump-sum"
        ? { amountCopper: acquisition.recipe.amountCopper, judgmentId: acquisition.recipe.judgmentRef }
        : null,
    extraCurrentLevelAllowanceIds: reviewed.gmJudgments
      .filter((judgment) => judgment.kind === "extra-current-level-allowance")
      .map((judgment) => judgment.id),
    exceptionJudgmentIds: reviewed.gmJudgments
      .filter((judgment) => judgment.kind === "rarity-source-exception")
      .map((judgment) => judgment.id),
    ...overrides,
  });
}

async function initializeAcquisition(
  context: StartingEquipmentCommandContext,
  deps: StartingEquipmentCommandDependencies,
  selectedRecipe?: OfficialEquipmentRecipe
): Promise<{
  readonly acquisition: AcquisitionDraftState;
  readonly pendingTitanSelection: boolean;
  readonly awaitingAuthority: boolean;
}> {
  const identity = deps.mintIdentity();
  const worldPolicy = context.draft.targetLevel > 1 ? deps.getWorldPolicy() : null;
  const recipe = worldPolicy
    ? worldPolicy.recipeChoiceAuthority === "actor-owner" && selectedRecipe
      ? selectedRecipe
      : worldPolicy.defaultRecipe
    : (selectedRecipe ?? "permanent-items");
  const staged = createAcquisitionDraft({
    ...identity,
    targetLevel: context.draft.targetLevel,
    recipe: { kind: recipe },
  });
  if (context.draft.targetLevel > 1) {
    return { acquisition: staged, pendingTitanSelection: false, awaitingAuthority: true };
  }
  const activated = await activateAcquisition(staged, context, deps, null);
  return { ...activated, awaitingAuthority: false };
}

async function activateAcquisition(
  staged: AcquisitionDraftState,
  context: StartingEquipmentCommandContext,
  deps: StartingEquipmentCommandDependencies,
  higherLevelStartClaim: EquipmentHigherLevelStartClaim | null
): Promise<{ readonly acquisition: AcquisitionDraftState; readonly pendingTitanSelection: boolean }> {
  if (staged.policySnapshot || staged.baseline || staged.lines.length > 0) {
    throw new TypeError("Starting-equipment policy is already active for this draft.");
  }
  const policy = deps.resolvePolicy({
    actor: context.actor,
    draftId: staged.draftId,
    targetLevel: staged.targetLevel,
    selectedRecipe: staged.recipe.kind === "permanent-items" ? "permanent-items" : "lump-sum",
    higherLevelStartClaim,
  });
  let acquisition: AcquisitionDraftState = {
    ...staged,
    policySnapshot: createAcquisitionPolicySnapshot(policy, staged.recipe),
  };
  const projectionDraft = { ...context.draft, acquisition };
  const classGrantProjection = await deps.projectClassGrants(context.actor, projectionDraft, context.steps);
  const unexpectedBlocker = classGrantProjection.blockers.find(
    (blocker) => blocker.code !== "titan-selection-required"
  );
  if (unexpectedBlocker) throw new Error(unexpectedBlocker.message);
  const pendingTitanSelection = classGrantProjection.blockers.some(
    (blocker) => blocker.code === "titan-selection-required"
  );
  acquisition = recordPlannedClassGrants(acquisition, classGrantProjection.grants);
  const subject = acquisition.policySnapshot!.material.subject;
  const classGrantPlan =
    classGrantProjection.preparedPlan ??
    createPreparedClassGrantPlan({
      actorId: subject.actorId,
      draftId: acquisition.draftId,
      batchId: acquisition.batchId,
      targetLevel: acquisition.targetLevel,
      grants: classGrantProjection.grants,
    });
  const nativeGrantLines = await deps.prepareNativeGrantLines({
    actor: context.actor,
    characterDraft: { ...context.draft, acquisition },
    acquisition,
    classGrantPlan,
  });
  acquisition = synchronizeNativeGrantLines(acquisition, [], nativeGrantLines, false);
  const admission = deps.evaluateAdmission({
    actor: context.actor as EconomicActorLike,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    higherLevelStartEvidence: acquisition.policySnapshot!.material.higherLevelStartEvidence,
    history: {
      previousCharacterAppliedAt: context.moduleState.lastAppliedAt,
      previousTargetLevel: context.moduleState.lastTargetLevel,
      completedAcquisitionManifestId: context.moduleState.completedAcquisitionManifest?.id ?? null,
      completedAcquisitionManifestCorrupt: context.moduleState.completedAcquisitionManifestCorrupt,
    },
    preparedClassGrantPlan: classGrantPlan,
    classGrantPhase: "before-acquisition",
    capturedAt: context.now(),
  });
  if (admission.kind === "blocked") throw new Error(admission.message);
  return { acquisition: recordEconomicAdmission(acquisition, admission), pendingTitanSelection };
}

function selectStagedRecipe(
  acquisition: AcquisitionDraftState,
  selectedRecipe: OfficialEquipmentRecipe,
  deps: StartingEquipmentCommandDependencies
): AcquisitionDraftState {
  if (acquisition.policySnapshot || acquisition.baseline || acquisition.lines.length > 0) {
    throw new TypeError("Starting-equipment funding cannot change after shopping begins.");
  }
  const policy = deps.getWorldPolicy();
  if (policy.recipeChoiceAuthority !== "actor-owner") {
    throw new TypeError("The GM fixed the starting-equipment funding recipe for this world.");
  }
  if (!policy.enabledRecipes.includes(selectedRecipe)) {
    throw new TypeError("That starting-equipment funding recipe is disabled in this world.");
  }
  if (acquisition.recipe.kind === selectedRecipe) return acquisition;
  return { ...acquisition, recipe: { kind: selectedRecipe } };
}

async function createHigherLevelStartClaim(
  acquisition: AcquisitionDraftState,
  startKind: HigherLevelStartKind,
  reason: string,
  context: StartingEquipmentCommandContext,
  deps: StartingEquipmentCommandDependencies
): Promise<EquipmentHigherLevelStartClaim> {
  if (acquisition.targetLevel === 1) {
    throw new TypeError("Level 1 starting equipment does not require higher-level start authority.");
  }
  const worldPolicy = deps.getWorldPolicy();
  if (worldPolicy.higherLevelStartAuthority === "actor-owner-attestation") {
    return deps.createOwnerStartAttestation({
      actor: context.actor,
      draftId: acquisition.draftId,
      targetLevel: acquisition.targetLevel,
      startKind,
      reason,
      recordedAt: context.now(),
      user: context.user,
    });
  }
  const judgmentId = deps.mintJudgmentId();
  await deps.saveJudgment({
    id: judgmentId,
    facts: {
      kind: "higher-level-start",
      actorId: actorId(context.actor),
      draftId: acquisition.draftId,
      targetLevel: acquisition.targetLevel,
      startKind,
    },
    reason,
    recordedAt: context.now(),
    user: context.user,
  });
  return { kind: "gm-confirmation", judgmentId, startKind };
}

function actorId(actor: unknown): string {
  const id = actor && typeof actor === "object" ? (actor as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id.trim()) throw new TypeError("Starting equipment requires a bound actor.");
  return id;
}

function userName(user: unknown, fallback: string): string {
  const name = user && typeof user === "object" ? (user as { name?: unknown }).name : null;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

function replacePolicyRequest(
  requests: readonly EquipmentPolicyRequestV1[],
  request: EquipmentPolicyRequestV1
): readonly EquipmentPolicyRequestV1[] {
  const current = requests.find((candidate) => candidate.requestId === request.requestId);
  if (current && JSON.stringify(current) !== JSON.stringify(request)) {
    throw new TypeError("Equipment request ID already belongs to different facts.");
  }
  return current
    ? requests
    : [...requests, request].sort(
        (left, right) =>
          left.requestedAt.localeCompare(right.requestedAt) || left.requestId.localeCompare(right.requestId)
      );
}

function requireCurrentPolicyRequest(
  requests: readonly EquipmentPolicyRequestV1[],
  requestId: string,
  acquisition: AcquisitionDraftState,
  currentActorId: string
): EquipmentPolicyRequestV1 {
  const request = requests.find((candidate) => candidate.requestId === requestId);
  if (
    !request ||
    request.withdrawnAt !== null ||
    request.facts.actorId !== currentActorId ||
    request.facts.draftId !== acquisition.draftId ||
    request.facts.targetLevel !== acquisition.targetLevel
  ) {
    throw new TypeError("Equipment approval request is stale or belongs to different facts.");
  }
  return request;
}

async function prepareLedger(context: StartingEquipmentCommandContext, deps: StartingEquipmentCommandDependencies) {
  let acquisition = requireAcquisition(context.draft);
  const priorPlannedClassGrants = acquisition.plannedClassGrants;
  const projectionDraft = { ...context.draft, acquisition };
  const classGrantPlan = await deps.prepareClassGrantPlan(context.actor, projectionDraft, context.steps, {
    resolveCharacterAccessRef: (sourceUuid) =>
      deps.resolveCharacterAccessRef({
        actor: context.actor,
        characterDraft: projectionDraft,
        acquisition,
        sourceUuid,
      }),
  });
  acquisition = recordPlannedClassGrants(acquisition, classGrantPlan.grants);
  const nativeGrantLines = await deps.prepareNativeGrantLines({
    actor: context.actor,
    characterDraft: { ...context.draft, acquisition },
    acquisition,
    classGrantPlan,
  });
  acquisition = synchronizeNativeGrantLines(acquisition, priorPlannedClassGrants, nativeGrantLines, true);
  const ledger = deps.evaluateLedger(acquisition, classGrantPlan);
  return { acquisition, ledger };
}

function reviewer(context: StartingEquipmentCommandContext): { readonly userId: string; readonly reviewedAt: string } {
  return { userId: context.userId, reviewedAt: context.now() };
}

function addPreparedLine(draft: AcquisitionDraftState, line: AcquisitionLineDraft): AcquisitionDraftState {
  if (draft.disposition.kind === "handoff") throw new TypeError("A PF2E-sheet handoff cannot accept cart items.");
  if (draft.lines.some((candidate) => candidate.lineId === line.lineId)) {
    throw new TypeError("The starting-equipment line already exists.");
  }
  const candidate = normalizeAcquisitionDraft({ ...draft, lines: [...draft.lines, line] });
  if (!candidate) throw new TypeError("The prepared starting-equipment line is malformed.");
  return invalidateAcquisitionReview(candidate, ["document"]);
}

function removeLine(draft: AcquisitionDraftState, lineId: string): AcquisitionDraftState {
  if (draft.disposition.kind === "handoff") throw new TypeError("A PF2E-sheet handoff cannot change cart items.");
  if (!lineId.trim()) throw new TypeError("Removing equipment requires a line ID.");
  const current = draft.lines.find((line) => line.lineId === lineId);
  if (!current) throw new TypeError("The starting-equipment line no longer exists.");
  const plannedGrantId = current.funding.lane === "class-grant" ? current.funding.grant.plannedGrantId : null;
  const plannedGrant = plannedGrantId
    ? draft.plannedClassGrants.find((grant) => grant.grantId === plannedGrantId)
    : null;
  if (plannedGrant?.materializer === "pf2e-native") {
    throw new TypeError("Automatic build-granted equipment cannot be removed from the starting-equipment plan.");
  }
  const lines = draft.lines.filter((line) => line.lineId !== lineId);
  return invalidateAcquisitionReview({ ...draft, lines }, ["document"]);
}

function setLineQuantity(draft: AcquisitionDraftState, lineId: string, quantity: number): AcquisitionDraftState {
  if (draft.disposition.kind === "handoff") throw new TypeError("A PF2E-sheet handoff cannot change cart items.");
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new TypeError("Starting-equipment quantity must be a positive integer.");
  }
  const index = draft.lines.findIndex((line) => line.lineId === lineId);
  if (index < 0) throw new TypeError("The starting-equipment line no longer exists.");
  const current = draft.lines[index]!;
  if (current.funding.lane === "class-grant") {
    throw new TypeError("Automatic build-granted equipment quantity is fixed by its authoritative grant.");
  }
  if (current.price.configurationComponents) {
    throw new TypeError("Configured equipment is prepared as one exact PF2E item and has a fixed quantity.");
  }
  const price = createAcquisitionPriceSnapshot({
    basePrice: current.price.basePrice,
    size: current.price.size,
    sizeSensitive: current.price.sizeSensitive,
    preciousMaterial: current.price.preciousMaterial,
    adjustedBulkPriceCopper: current.price.adjustedBulkPriceCopper,
    configurationPriceCopper: current.price.configurationPriceCopper,
    pricePer: current.price.pricePer,
    sourceQuantity: current.price.sourceQuantity,
    requestedQuantity: quantity,
    ...(current.price.configurationComponents
      ? { configurationComponents: structuredClone(current.price.configurationComponents) }
      : {}),
  });
  if (price.ok === false) throw new TypeError(price.message);
  const lines = [...draft.lines];
  lines[index] = { ...current, price: price.value };
  return invalidateAcquisitionReview({ ...draft, lines }, ["quantity"]);
}

function synchronizeNativeGrantLines(
  draft: AcquisitionDraftState,
  priorPlannedClassGrants: readonly PlannedClassGrantV1[],
  preparedLines: readonly AcquisitionLineDraft[],
  invalidateReview: boolean
): AcquisitionDraftState {
  const priorNativeGrantIds = new Set(
    priorPlannedClassGrants.filter((grant) => grant.materializer === "pf2e-native").map((grant) => grant.grantId)
  );
  const currentNativeGrantIds = new Set(
    draft.plannedClassGrants.filter((grant) => grant.materializer === "pf2e-native").map((grant) => grant.grantId)
  );
  const preparedByGrantId = new Map<string, AcquisitionLineDraft>();
  for (const line of preparedLines) {
    if (line.funding.lane !== "class-grant") {
      throw new TypeError("Native class-grant preparation returned a non-grant acquisition line.");
    }
    const grantId = line.funding.grant.plannedGrantId;
    if (!currentNativeGrantIds.has(grantId) || preparedByGrantId.has(grantId)) {
      throw new TypeError("Native class-grant preparation returned an invalid or duplicate grant line.");
    }
    preparedByGrantId.set(grantId, line);
  }
  if (preparedByGrantId.size !== currentNativeGrantIds.size) {
    throw new TypeError("Native class-grant preparation did not cover every current native grant.");
  }

  const emitted = new Set<string>();
  const lines: AcquisitionLineDraft[] = [];
  for (const line of draft.lines) {
    const grantId = line.funding.lane === "class-grant" ? line.funding.grant.plannedGrantId : null;
    if (grantId && (priorNativeGrantIds.has(grantId) || currentNativeGrantIds.has(grantId))) {
      const replacement = preparedByGrantId.get(grantId);
      if (replacement && !emitted.has(grantId)) {
        lines.push(replacement);
        emitted.add(grantId);
      }
      continue;
    }
    lines.push(line);
  }
  for (const [grantId, line] of preparedByGrantId) {
    if (!emitted.has(grantId)) lines.push(line);
  }
  if (canonicalJson(draft.lines) === canonicalJson(lines)) return draft;
  const acquisition = normalizeAcquisitionDraft({ ...draft, lines });
  if (!acquisition) throw new TypeError("Native class-grant preparation returned malformed acquisition lines.");
  return invalidateReview ? invalidateAcquisitionReview(acquisition, ["document"]) : acquisition;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${Object.keys(input)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireAcquisition(draft: DraftState): AcquisitionDraftState {
  if (draft.acquisitionCorrupt) throw new TypeError("The starting-equipment draft is malformed and cannot be changed.");
  if (!draft.acquisition) throw new TypeError("Set up starting equipment before changing its review state.");
  return draft.acquisition;
}

function requireActiveAcquisition(draft: DraftState): AcquisitionDraftState {
  const acquisition = requireAcquisition(draft);
  if (!acquisition.policySnapshot || !acquisition.baseline) {
    throw new TypeError("Confirm higher-level starting wealth before adding GM equipment overrides.");
  }
  return acquisition;
}

function higherLevelStartClaim(evidence: EquipmentHigherLevelStartEvidence): EquipmentHigherLevelStartClaim | null {
  if (evidence.kind === "not-required") return null;
  if (evidence.kind === "gm-confirmation") {
    return { kind: "gm-confirmation", judgmentId: evidence.judgment.id, startKind: evidence.startKind };
  }
  return { ...evidence };
}

function assertCommandContext(context: StartingEquipmentCommandContext): void {
  if (!context.steps.some((step) => step.kind === "starting-equipment" && step.level === context.draft.targetLevel)) {
    throw new TypeError("The current plan does not contain starting equipment for this target level.");
  }
  if (!context.userId.trim() || !Number.isFinite(Date.parse(context.now()))) {
    throw new TypeError("Starting-equipment commands require a current user and valid timestamp.");
  }
}
