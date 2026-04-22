import type { ActorLike } from "../shared/actor-model.js";
import type { DraftState, PendingStep } from "../types.js";

export async function applyLanguageChoiceDraft(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[]
): Promise<void> {
  if (typeof actor?.update !== "function") {
    return;
  }

  const languageStep = steps.find((step) => step.kind === "language-choice");
  if (!languageStep) {
    return;
  }

  const selections = Array.from(new Set(draft.languageChoices[languageStep.slotId] ?? []));
  await actor.update({
    "system.details.languages.value": selections,
  });
}
