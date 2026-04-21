import { listActorItems } from "../build-state.js";
import type { ActorItemLike, ActorLike, LooseRecord } from "../shared/actor-model.js";
import { cloneData } from "../shared/cloning.js";
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

    const update =
      updatesByItemId.get(item.id) ??
      ({
        _id: item.id,
        "system.rules": cloneData(Array.isArray(item.system?.rules) ? item.system.rules : []),
      } satisfies Record<string, unknown>);

    const rules = update["system.rules"] as LooseRecord[];
    if (rules[step.singletonChoice.sourceRuleIndex]) {
      rules[step.singletonChoice.sourceRuleIndex].selection = value;
    }
    update[`flags.pf2e.rulesSelections.${step.singletonChoice.flag}`] = value;
    updatesByItemId.set(item.id, update);
  }

  const updates = Array.from(updatesByItemId.values());
  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}
