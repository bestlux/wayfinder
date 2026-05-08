import { listActorItems } from "../build-state.js";
import { queueRuleSelectionUpdate } from "../shared/pf2e-item-source.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
export async function applySingletonChoiceDraft(actor, draft, steps) {
    if (typeof actor?.updateEmbeddedDocuments !== "function") {
        return;
    }
    const stepMap = new Map(steps.map((step) => [step.slotId, step]));
    const actorItems = listActorItems(actor);
    const updatesByItemId = new Map();
    for (const [slotId, value] of Object.entries(draft.singletonChoices)) {
        const step = stepMap.get(slotId);
        if (step?.kind !== "singleton-choice" || !step.singletonChoice) {
            continue;
        }
        const item = actorItems.find((entry) => itemMatchesSourceId(entry, step.singletonChoice.sourceUuid));
        if (!item?.id) {
            continue;
        }
        queueRuleSelectionUpdate(updatesByItemId, item, step.singletonChoice.sourceRuleIndex, step.singletonChoice.flag, value);
    }
    const updates = Array.from(updatesByItemId.values());
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
}
//# sourceMappingURL=singleton-choice-application.js.map