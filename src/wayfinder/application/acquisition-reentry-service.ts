import type { DraftState } from "../../types.js";
import { createAcquisitionDraft, normalizeAcquisitionDraft } from "../domain/acquisition-draft.js";
import { createAcquisitionPriceSnapshot } from "../domain/acquisition-ledger.js";
import type {
  AcquisitionDraftState,
  AcquisitionLineDraft,
  AcquisitionRecipeSelectionProvenanceV1,
} from "../domain/acquisition-types.js";
import type { OfficialEquipmentRecipe } from "../domain/equipment-policy.js";
import { hasApplyRecoveryState } from "./draft-lifecycle-service.js";

export function isAcquisitionTargetLevelReentry(acquisition: AcquisitionDraftState | null): boolean {
  return (
    acquisition?.policySnapshot === null &&
    acquisition.disposition.kind === "unreviewed" &&
    acquisition.disposition.reasons.includes("target-level")
  );
}

export function assertAcquisitionPolicyEntryAllowed(draft: DraftState): void {
  const acquisition = draft.acquisition;
  if (hasApplyRecoveryState(draft) || (acquisition?.classGrantReconciliations.length ?? 0) > 0) {
    throw new TypeError("Starting-equipment Apply recovery must finish before changing its policy.");
  }
  if (
    acquisition &&
    !acquisition.policySnapshot &&
    (acquisition.baseline || acquisition.lines.length > 0) &&
    !isAcquisitionTargetLevelReentry(acquisition)
  ) {
    throw new TypeError("Starting-equipment policy is already active for this draft.");
  }
}

export function stageAcquisitionTargetLevelReentry(
  acquisition: AcquisitionDraftState,
  recipe: OfficialEquipmentRecipe,
  recipeSelection: AcquisitionRecipeSelectionProvenanceV1
): AcquisitionDraftState {
  const staged = createAcquisitionDraft({
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    manifestId: acquisition.manifestId,
    targetLevel: acquisition.targetLevel,
    recipe: { kind: recipe },
    recipeSelection,
  });
  return { ...staged, disposition: acquisition.disposition };
}

export async function restoreAcquisitionCartIntent(args: {
  readonly acquisition: AcquisitionDraftState;
  readonly previousLines: readonly AcquisitionLineDraft[];
  readonly prepareLine: (line: AcquisitionLineDraft) => Promise<AcquisitionLineDraft>;
}): Promise<{ readonly acquisition: AcquisitionDraftState; readonly discardedCount: number }> {
  const nativeLines = args.acquisition.lines.map((line) => {
    if (line.funding.lane !== "class-grant") return line;
    const grantId = line.funding.grant.plannedGrantId;
    const previous = args.previousLines.find(
      (candidate) =>
        candidate.funding.lane === "class-grant" &&
        candidate.funding.grant.plannedGrantId === grantId &&
        candidate.sourceUuid === line.sourceUuid
    );
    return previous ? { ...line, lineId: previous.lineId } : line;
  });
  const lines: AcquisitionLineDraft[] = [...nativeLines];
  let discardedCount = args.previousLines.filter((line) => {
    if (line.funding.lane !== "class-grant") return false;
    const grantId = line.funding.grant.plannedGrantId;
    return !nativeLines.some(
      (candidate) =>
        candidate.funding.lane === "class-grant" &&
        candidate.funding.grant.plannedGrantId === grantId &&
        candidate.sourceUuid === line.sourceUuid
    );
  }).length;
  for (const previous of args.previousLines) {
    if (previous.funding.lane === "class-grant") continue;
    if (args.acquisition.disposition.kind === "handoff") {
      discardedCount += 1;
      continue;
    }
    let refreshed: AcquisitionLineDraft;
    try {
      refreshed = await args.prepareLine(previous);
    } catch {
      discardedCount += 1;
      continue;
    }
    const price = createAcquisitionPriceSnapshot({
      ...refreshed.price,
      requestedQuantity: previous.price.requestedQuantity,
    });
    if (!price.ok) {
      discardedCount += 1;
      continue;
    }
    lines.push({
      ...refreshed,
      lineId: previous.lineId,
      stackingIntent: previous.stackingIntent,
      funding:
        refreshed.funding.lane === "allowance"
          ? { lane: "allowance", assignment: { mode: "automatic" } }
          : refreshed.funding,
      price: price.value,
    });
  }
  const acquisition = normalizeAcquisitionDraft({ ...args.acquisition, lines });
  if (!acquisition) throw new TypeError("Equipment re-entry produced an invalid acquisition cart.");
  return { acquisition, discardedCount };
}
