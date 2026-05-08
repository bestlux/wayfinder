import { listActorItems } from "../build-state.js";
import type { ActorItemLike, ActorLike } from "../shared/actor-model.js";
import { queueRuleSelectionUpdate } from "../shared/pf2e-item-source.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep } from "../types.js";

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

  const updates = Array.from(updatesByItemId.values());
  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}
