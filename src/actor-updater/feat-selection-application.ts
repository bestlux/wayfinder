import { fetchSelectionDocument } from "../pack-service.js";
import type { ActorLike, FeatSlotLike, LooseRecord } from "../shared/actor-model.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import type { InsertFeatSelectionDependencies } from "./selection-dependencies.js";
import { stampSelectionFlags } from "./selection-flags.js";
import { createEmbeddedSource } from "./selection-source-application.js";

const DEFAULT_INSERT_DEPS: InsertFeatSelectionDependencies = {
  fetchSelectionDocument,
  createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};

export async function insertFeatSelection(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null,
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS,
  draft?: DraftState,
  steps: PendingStep[] = []
): Promise<void> {
  const source = await deps.createEmbeddedSource(selection, draft, steps);
  if (!source) {
    return;
  }

  const slotData = resolveFeatSlotData(actor, selection, step);
  if (slotData) {
    applyFeatSlotData(source, slotData, step);
  }

  if (typeof actor.createEmbeddedDocuments === "function") {
    const inserted = await actor.createEmbeddedDocuments("Item", [source]);
    await stampSelectionFlags(actor, inserted, selection);
  }
}

function applyFeatSlotData(
  source: LooseRecord,
  slotData: { groupId: string; slotId: string | null },
  step: PendingStep | null
): void {
  source.system ??= {};
  const system = source.system as LooseRecord;
  system.location = slotData.slotId ?? slotData.groupId;
  system.level ??= {};
  if (typeof step?.level === "number") {
    (system.level as LooseRecord).taken = step.level;
  }
}

function resolveFeatSlotData(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null
): { groupId: string; slotId: string | null } | null {
  const groupId = resolveFeatGroupId(selection, step);
  if (!groupId) {
    return null;
  }

  const group = (typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId]) as
    | { slots?: Record<string, FeatSlotLike> }
    | null
    | undefined;
  const slots = Object.values(group?.slots ?? {});
  if (slots.length === 0) {
    return { groupId, slotId: null };
  }

  const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
  const firstOpen = slots.find((slot) => !slot.feat);
  return {
    groupId,
    slotId: matchingLevel?.id ?? firstOpen?.id ?? null,
  };
}

function resolveFeatGroupId(selection: SelectionRef, step: PendingStep | null): string | null {
  switch (step?.slotKind) {
    case "ancestry-feat":
      return "ancestry";
    case "class-feat":
      return "class";
    case "skill-feat":
      return "skill";
    case "general-feat":
      return "general";
    default:
      switch (selection.featType) {
        case "ancestry":
          return "ancestry";
        case "class":
        case "archetype":
          return "class";
        case "skill":
          return "skill";
        case "general":
          return "general";
        default:
          return null;
      }
  }
}
