import { listActorItems } from "../build-state.js";
import { stripPreselectedClassBranchEntries } from "../class-branch-service.js";
import { stripPreselectedClassFeatureEntries } from "../class-feature-choice-service.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack-service.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";

const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);

interface CreateEmbeddedSourceDependencies {
  fetchSelectionDocument: (selection: SelectionRef) => Promise<any | null>;
  stripPreselectedClassFeatureEntries: (source: Record<string, any>, draft: DraftState, steps: PendingStep[]) => void;
  stripPreselectedClassBranchEntries: (source: Record<string, any>, draft: DraftState, steps: PendingStep[]) => void;
}

interface InsertFeatSelectionDependencies {
  fetchSelectionDocument: (selection: SelectionRef) => Promise<any | null>;
  createEmbeddedSource: (
    selection: SelectionRef,
    draft?: DraftState,
    steps?: PendingStep[]
  ) => Promise<Record<string, any> | null>;
}

const DEFAULT_CREATE_DEPS: CreateEmbeddedSourceDependencies = {
  fetchSelectionDocument,
  stripPreselectedClassFeatureEntries,
  stripPreselectedClassBranchEntries,
};

const DEFAULT_INSERT_DEPS: InsertFeatSelectionDependencies = {
  fetchSelectionDocument,
  createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};

export async function replaceSingletonItem(
  actor: any,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies = DEFAULT_CREATE_DEPS
): Promise<void> {
  const existing = listActorItems(actor).filter((item: any) => item?.type === selection.itemType);
  if (existing.length > 0) {
    await actor.deleteEmbeddedDocuments(
      "Item",
      existing.map((item: any) => item.id)
    );
  }

  const source = await createEmbeddedSource(selection, draft, steps, deps);
  if (source) {
    await actor.createEmbeddedDocuments("Item", [source]);
  }
}

export async function createEmbeddedSource(
  selection: SelectionRef,
  draft?: DraftState,
  steps: PendingStep[] = [],
  deps: CreateEmbeddedSourceDependencies = DEFAULT_CREATE_DEPS
): Promise<Record<string, any> | null> {
  const document = await deps.fetchSelectionDocument(selection);
  if (!document) {
    return null;
  }

  const source = document.toObject();
  if (selection.itemType === "class" && draft) {
    deps.stripPreselectedClassFeatureEntries(source, draft, steps);
    deps.stripPreselectedClassBranchEntries(source, draft, steps);
  }

  delete source._id;
  source._stats ??= {};
  source._stats.compendiumSource = selection.uuid;
  source.flags ??= {};
  source.flags.core ??= {};
  source.flags.core.sourceId = selection.uuid;
  source.flags[MODULE_ID] = {
    importedBy: MODULE_ID,
    slotId: selection.slotId,
  };
  return source;
}

export async function insertFeatSelection(
  actor: any,
  selection: SelectionRef,
  step: PendingStep | null,
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS
): Promise<void> {
  const document = await deps.fetchSelectionDocument(selection);
  if (!document) {
    return;
  }

  const slotData = resolveFeatSlotData(actor, selection, step);
  if (typeof actor?.feats?.insertFeat === "function") {
    const inserted = await actor.feats.insertFeat(document, slotData);
    await stampSelectionFlags(actor, inserted, selection);
    return;
  }

  const source = await deps.createEmbeddedSource(selection);
  if (!source) {
    return;
  }

  if (slotData) {
    source.system ??= {};
    source.system.location = slotData.slotId ?? slotData.groupId;
    source.system.level ??= {};
    if (typeof step?.level === "number") {
      source.system.level.taken = step.level;
    }
  }

  await actor.createEmbeddedDocuments("Item", [source]);
}

function resolveFeatSlotData(
  actor: any,
  selection: SelectionRef,
  step: PendingStep | null
): { groupId: string; slotId: string | null } | null {
  const groupId = resolveFeatGroupId(selection, step);
  if (!groupId) {
    return null;
  }

  const group = typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId];
  const slots = Object.values(group?.slots ?? {}) as Array<{ id?: string; level?: number | null; feat?: unknown }>;
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

export async function stampSelectionFlags(actor: any, items: any[], selection: SelectionRef): Promise<void> {
  if (!Array.isArray(items) || items.length === 0 || typeof actor?.updateEmbeddedDocuments !== "function") {
    return;
  }

  const updates: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item?.id) {
      continue;
    }

    updates.push({
      _id: item.id,
      "flags.core.sourceId": selection.uuid,
      [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
      [`flags.${MODULE_ID}.slotId`]: selection.slotId,
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}

export function orderSelections(draft: DraftState, steps: PendingStep[]): SelectionRef[] {
  const order = new Map<string, number>();
  steps.forEach((step, index) => order.set(step.slotId, index));

  return Object.values(draft.selections).sort((left, right) => {
    return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
  });
}

export function singletonSelections(selections: SelectionRef[]): SelectionRef[] {
  return selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType));
}

export function featSelections(selections: SelectionRef[]): SelectionRef[] {
  return selections.filter((entry) => entry.itemType === "feat");
}

export function hasSourceId(actor: any, sourceId: string): boolean {
  return listActorItems(actor).some((item: any) => itemMatchesSourceId(item, sourceId));
}
