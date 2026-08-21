import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import type { ActorItemLike, ActorLike, EmbeddedItemSource } from "../shared/actor-model.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import { listPlannedStaticSkillSources } from "../wayfinder/application/planned-static-skill-source-service.js";
import { SINGLETON_ITEM_TYPES } from "./selection-constants.js";
import type { CreateEmbeddedSourceDependencies } from "./selection-dependencies.js";
import { createEmbeddedSource } from "./selection-source-application.js";

export async function replaceSingletonItem(
  actor: ActorLike,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps?: CreateEmbeddedSourceDependencies
): Promise<void> {
  const source = await createEmbeddedSource(selection, draft, steps, deps);
  if (!source) {
    throw unresolvedSingletonSourceError(selection);
  }

  const existing = (listActorItems(actor) as ActorItemLike[]).filter((item) => item?.type === selection.itemType);
  if (typeof actor.createEmbeddedDocuments === "function") {
    await createSingletonReplacements(actor, [source], existing, selection.name);
  }
}

export async function replaceSingletonItems(
  actor: ActorLike,
  selections: SelectionRef[],
  draft: DraftState,
  steps: PendingStep[],
  deps?: CreateEmbeddedSourceDependencies
): Promise<void> {
  const singletonSelections = selections.filter((selection) => SINGLETON_ITEM_TYPES.has(selection.itemType));
  if (singletonSelections.length === 0) {
    return;
  }

  const replacesClass = singletonSelections.some((selection) => selection.itemType === "class");
  const classArchetypeSelection = replacesClass
    ? (listPlannedStaticSkillSources(draft, steps).find(
        ({ selection }) => !SINGLETON_ITEM_TYPES.has(selection.itemType)
      )?.selection ?? null)
    : null;
  const batchedSelections = [...singletonSelections, ...(classArchetypeSelection ? [classArchetypeSelection] : [])];

  const selectedTypes = new Set(singletonSelections.map((selection) => selection.itemType));
  const preparedSources = await Promise.all(
    batchedSelections.map(async (selection) => ({
      selection,
      source: await createEmbeddedSource(selection, draft, steps, deps),
    }))
  );
  const unresolvedSelection = preparedSources.find(({ source }) => !source)?.selection;
  if (unresolvedSelection) {
    throw unresolvedSingletonSourceError(unresolvedSelection);
  }
  const sources = preparedSources.map(({ source }) => source as EmbeddedItemSource);

  const existing = (listActorItems(actor) as ActorItemLike[]).filter(
    (item) =>
      selectedTypes.has(item?.type ?? "") ||
      (replacesClass &&
        typeof item?.flags?.[MODULE_ID]?.slotId === "string" &&
        item.flags[MODULE_ID].slotId.startsWith("class-archetype-"))
  );
  if (sources.length > 0 && typeof actor.createEmbeddedDocuments === "function") {
    await createSingletonReplacements(actor, sources, existing, singletonSelections.map(({ name }) => name).join(", "));
  }
}

async function createSingletonReplacements(
  actor: ActorLike,
  sources: EmbeddedItemSource[],
  existing: ActorItemLike[],
  replacementName: string
): Promise<void> {
  const existingSources = existing.map(snapshotEmbeddedItemSource);
  const requestedSourceIds = new Set(sources.map(embeddedSourceId).filter((id): id is string => !!id));
  const obsoleteNonSingletonIds = existing
    .filter((item) => !SINGLETON_ITEM_TYPES.has(item.type ?? ""))
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string");
  let createdItems: ActorItemLike[] = [];
  try {
    const created = await actor.createEmbeddedDocuments?.("Item", sources);
    createdItems = created ?? [];
    const createdSourceIds = new Set((created ?? []).map(embeddedSourceId).filter((id): id is string => !!id));
    const missingSourceId = sources.map(embeddedSourceId).find((id) => !id || !createdSourceIds.has(id));
    if (missingSourceId !== undefined) {
      throw new Error(
        `Cannot replace ${replacementName}: PF2E did not create every selected item${missingSourceId ? ` (${missingSourceId})` : ""}.`
      );
    }
    if (obsoleteNonSingletonIds.length > 0) {
      if (typeof actor.deleteEmbeddedDocuments !== "function") {
        throw new Error(`Cannot replace ${replacementName}: actor cannot remove the previous class archetype.`);
      }
      await actor.deleteEmbeddedDocuments("Item", obsoleteNonSingletonIds);
    }
  } catch (creationError) {
    try {
      await compensateSingletonReplacement(actor, requestedSourceIds, createdItems, existing, existingSources);
    } catch (compensationError) {
      throw new AggregateError(
        [creationError, compensationError],
        `Cannot replace ${replacementName}, and restoring the actor's previous selections also failed.`,
        { cause: compensationError }
      );
    }
    throw creationError;
  }
}

async function compensateSingletonReplacement(
  actor: ActorLike,
  requestedSourceIds: ReadonlySet<string>,
  createdItems: ActorItemLike[],
  existingItems: ActorItemLike[],
  existingSources: EmbeddedItemSource[]
): Promise<void> {
  const originalIds = new Set(
    existingItems.map((item) => item.id).filter((id): id is string => typeof id === "string")
  );
  const currentItems = listActorItems(actor) as ActorItemLike[];
  const currentIds = new Set(currentItems.map((item) => item.id).filter((id): id is string => typeof id === "string"));
  const originalStateIsIntact = [...originalIds].every((id) => currentIds.has(id));
  const replacementIds = new Set(
    [...createdItems, ...currentItems]
      .filter((item) => {
        const sourceId = embeddedSourceId(item);
        return (
          (typeof item.id === "string" && originalIds.has(item.id)) || (!!sourceId && requestedSourceIds.has(sourceId))
        );
      })
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string")
  );
  const createdReplacementIds = [...replacementIds].filter((id) => !originalIds.has(id));
  if (originalStateIsIntact && createdReplacementIds.length === 0) {
    return;
  }

  let cleanupError: unknown = null;
  if (replacementIds.size > 0) {
    try {
      if (typeof actor.deleteEmbeddedDocuments !== "function") {
        throw new Error("Actor cannot remove partially created singleton replacements.");
      }
      await actor.deleteEmbeddedDocuments("Item", [...replacementIds]);
    } catch (error) {
      cleanupError = error;
    }
  }

  if (existingSources.length > 0) {
    try {
      await actor.createEmbeddedDocuments?.("Item", existingSources);
    } catch (restoreError) {
      throw new AggregateError(
        [...(cleanupError ? [cleanupError] : []), restoreError],
        "Could not fully restore the actor's previous singleton selections.",
        { cause: restoreError }
      );
    }
  }

  if (cleanupError) {
    throw new Error("Could not remove partially created singleton replacements.", { cause: cleanupError });
  }
}

function snapshotEmbeddedItemSource(item: ActorItemLike): EmbeddedItemSource {
  const toObject = (item as ActorItemLike & { toObject?: () => EmbeddedItemSource }).toObject;
  if (typeof toObject === "function") {
    return toObject.call(item);
  }

  const source: EmbeddedItemSource = { ...item, _id: item.id };
  delete source.id;
  return source;
}

function embeddedSourceId(source: ActorItemLike | EmbeddedItemSource): string | null {
  if (typeof (source as ActorItemLike).sourceId === "string") {
    return (source as ActorItemLike).sourceId ?? null;
  }

  const coreSourceId = source.flags?.core?.sourceId;
  if (typeof coreSourceId === "string") {
    return coreSourceId;
  }

  const compendiumSource = source._stats?.compendiumSource;
  return typeof compendiumSource === "string" ? compendiumSource : null;
}

function unresolvedSingletonSourceError(selection: SelectionRef): Error {
  return new Error(`Cannot replace ${selection.name}: source document ${selection.uuid} could not be resolved.`);
}
