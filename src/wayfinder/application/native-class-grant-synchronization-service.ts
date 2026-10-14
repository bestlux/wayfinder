import type { DraftState, PendingStep } from "../../types.js";
import {
  invalidateAcquisitionReview,
  normalizeAcquisitionDraft,
  recordPlannedClassGrants,
} from "../domain/acquisition-draft.js";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../domain/acquisition-types.js";
import type { PlannedClassGrantV1 } from "../domain/class-grant-reconciliation.js";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
} from "../domain/physical-grant-route-registry.js";
import { captureObservedClassGrantItems, prepareCurrentClassGrantPlan } from "./class-grant-projection-service.js";
import { hasApplyRecoveryState } from "./draft-lifecycle-service.js";
import {
  getFoundryEquipmentAcquisitionRuntime,
  type NativeClassGrantLineRequest,
} from "./equipment-acquisition-runtime-service.js";

interface NativeClassGrantSynchronizationContext {
  readonly actor: unknown;
  readonly draft: DraftState;
  readonly steps: readonly PendingStep[];
}
interface NativeClassGrantSynchronizationDependencies {
  readonly prepareClassGrantPlan: typeof prepareCurrentClassGrantPlan;
  readonly prepareNativeGrantLines: (request: NativeClassGrantLineRequest) => Promise<readonly AcquisitionLineDraft[]>;
}
export interface NativeClassGrantSynchronizationResult {
  readonly acquisition: AcquisitionDraftState | null;
  readonly changed: boolean;
  readonly reason: "build-changed" | "verification-failed" | null;
}

/** Refresh creation-time native authority before a changed build can retain an old review. */
export async function synchronizeNativeClassGrantAuthority(
  context: NativeClassGrantSynchronizationContext,
  overrides: Partial<NativeClassGrantSynchronizationDependencies> = {}
): Promise<NativeClassGrantSynchronizationResult> {
  const before = context.draft.acquisition;
  const unchanged = { acquisition: before, changed: false, reason: null } as const;
  if (
    !before ||
    context.draft.acquisitionCorrupt ||
    hasApplyRecoveryState(context.draft) ||
    before.classGrantReconciliations.length > 0 ||
    !needsThaumaturgeSynchronization(context, before)
  )
    return unchanged;
  const prepareClassGrantPlan = overrides.prepareClassGrantPlan ?? prepareCurrentClassGrantPlan;
  const prepareNativeGrantLines =
    overrides.prepareNativeGrantLines ??
    ((request: NativeClassGrantLineRequest) =>
      getFoundryEquipmentAcquisitionRuntime().prepareNativeClassGrantLines(request));
  let acquisition: AcquisitionDraftState;
  let reason: NativeClassGrantSynchronizationResult["reason"];
  try {
    if (!before.policySnapshot) throw new TypeError("The current equipment policy must be reviewed again.");
    const plan = await prepareClassGrantPlan(context.actor, context.draft, context.steps);
    acquisition = recordPlannedClassGrants(before, plan.grants);
    const lines = await prepareNativeGrantLines({
      actor: context.actor,
      characterDraft: { ...context.draft, acquisition },
      acquisition,
      classGrantPlan: plan,
    });
    acquisition = synchronizeNativeGrantLines(acquisition, before.plannedClassGrants, lines, true);
    // A missing or changed native line also requires review when the envelope itself stayed equal.
    acquisition = invalidateAcquisitionReview(acquisition, ["document"]);
    reason = "build-changed";
  } catch {
    // Retain cart intent and monetary identity while withdrawing obsolete native authority.
    const obsoleteIds = new Set(before.plannedClassGrants.filter(isThaumaturgeGrant).map((grant) => grant.grantId));
    acquisition = recordPlannedClassGrants(
      before,
      before.plannedClassGrants.filter((grant) => !isThaumaturgeGrant(grant))
    );
    acquisition = {
      ...acquisition,
      lines: acquisition.lines.filter(
        (line) => line.funding.lane !== "class-grant" || !obsoleteIds.has(line.funding.grant.plannedGrantId)
      ),
    };
    acquisition = invalidateAcquisitionReview(acquisition, ["document"]);
    reason = "verification-failed";
  }
  if (canonicalJson(acquisition) === canonicalJson(before)) return unchanged;
  return { acquisition, changed: true, reason };
}

function needsThaumaturgeSynchronization(
  context: NativeClassGrantSynchronizationContext,
  acquisition: AcquisitionDraftState
): boolean {
  const root = context.draft.selections["class-level-1"];
  const current = acquisition.plannedClassGrants.filter(isThaumaturgeGrant);
  if (current.length === 0 && root?.uuid !== CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass) return false;
  const activeSlots = new Set(context.steps.map((step) => step.slotId));
  const observed = captureObservedClassGrantItems(context.actor);
  const expected =
    root?.uuid === CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass && root.itemType === "class"
      ? THAUMATURGE_IMPLEMENT_ORIGINS.flatMap((origin) => {
          const selection = context.draft.branchSelections[origin.slotId];
          if (
            !selection ||
            selection.slotId !== origin.slotId ||
            !(
              activeSlots.has(origin.slotId) ||
              observed.some((item) => item.sourceUuid === selection.uuid && item.wayfinderSlotId === origin.slotId)
            ) ||
            origin.level > context.draft.targetLevel
          )
            return [];
          const implement = THAUMATURGE_FIXED_IMPLEMENTS.find(
            (entry) => selection.uuid === `Compendium.pf2e.classfeatures.Item.${entry.featureId}`
          );
          return implement ? [`thaumaturge-${implement.slug}-implement-${origin.key}`] : [];
        }).sort()
      : [];
  if (canonicalJson(current.map((grant) => grant.profileId).sort()) !== canonicalJson(expected)) return true;
  if (current.length === 0) return false;
  return current.some((grant) => {
    const lines = acquisition.lines.filter(
      (line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grant.grantId
    );
    return lines.length !== 1 || lines[0]?.sourceUuid !== grant.expected.sourceUuid;
  });
}

function isThaumaturgeGrant(grant: PlannedClassGrantV1): boolean {
  return grant.materializer === "pf2e-native" && grant.profileId.startsWith("thaumaturge-");
}

export function synchronizeNativeGrantLines(
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
    if (line.funding.lane !== "class-grant")
      throw new TypeError("Native class-grant preparation returned a non-grant acquisition line.");
    const grantId = line.funding.grant.plannedGrantId;
    if (!currentNativeGrantIds.has(grantId) || preparedByGrantId.has(grantId))
      throw new TypeError("Native class-grant preparation returned an invalid or duplicate grant line.");
    preparedByGrantId.set(grantId, line);
  }
  if (preparedByGrantId.size !== currentNativeGrantIds.size)
    throw new TypeError("Native class-grant preparation did not cover every current native grant.");
  const emitted = new Set<string>();
  const lines: AcquisitionLineDraft[] = [];
  for (const line of draft.lines) {
    const grantId = line.funding.lane === "class-grant" ? line.funding.grant.plannedGrantId : null;
    if (grantId && (priorNativeGrantIds.has(grantId) || currentNativeGrantIds.has(grantId))) {
      const replacement = preparedByGrantId.get(grantId);
      if (replacement && !emitted.has(grantId)) {
        lines.push(replacement.sourceUuid === line.sourceUuid ? { ...replacement, lineId: line.lineId } : replacement);
        emitted.add(grantId);
      }
      continue;
    }
    lines.push(line);
  }
  for (const [grantId, line] of preparedByGrantId) if (!emitted.has(grantId)) lines.push(line);
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
