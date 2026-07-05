import { listActorItems } from "../build-state.js";
import type { ActorItemLike, ActorLike } from "../shared/actor-model.js";
import { queueRuleSelectionUpdate } from "../shared/pf2e-item-source.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, FlagChoiceMeta, PendingStep, SelectionRef } from "../types.js";

export async function applySingletonChoiceDraft(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[]
): Promise<void> {
  if (typeof actor?.updateEmbeddedDocuments !== "function") {
    return;
  }

  const stepMap = new Map(steps.map((step) => [step.slotId, step]));
  const actorItems = listActorItems(actor) as ActorItemLike[];
  const updatesByItemId = new Map<string, Record<string, unknown>>();

  for (const [slotId, value] of Object.entries(draft.singletonChoices)) {
    const step = stepMap.get(slotId);
    if (step?.kind !== "singleton-choice" || !step.singletonChoice) {
      continue;
    }

    const item = actorItems.find((entry) => itemMatchesSourceId(entry, step.singletonChoice.sourceUuid));
    if (!item?.id) {
      continue;
    }

    queueRuleSelectionUpdate(
      updatesByItemId,
      item,
      step.singletonChoice.sourceRuleIndex,
      step.singletonChoice.flag,
      value
    );
  }

  for (const [slotId, selection] of Object.entries(draft.selections)) {
    const step = stepMap.get(slotId);
    if (step?.kind !== "pick-item" || !step.flagChoice) {
      continue;
    }

    const flagChoice = step.flagChoice;
    const value = flagChoiceSelectionValue(flagChoice, selection);
    if (!value) {
      continue;
    }

    const item = actorItems.find((entry) => itemMatchesSourceId(entry, flagChoice.sourceUuid));
    if (!item?.id) {
      continue;
    }

    queueRuleSelectionUpdate(updatesByItemId, item, flagChoice.sourceRuleIndex, flagChoice.flag, value);
  }

  const updates = Array.from(updatesByItemId.values());
  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}

function flagChoiceSelectionValue(choice: FlagChoiceMeta, selection: SelectionRef): string | null {
  if (choice.selectionValue === "uuid") {
    return selection.uuid;
  }

  return selection.slug ?? slugifySelectionName(selection.name) ?? selection.documentId;
}

function slugifySelectionName(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : null;
}
