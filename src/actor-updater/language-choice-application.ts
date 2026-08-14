import type { ActorLike } from "../shared/actor-model.js";
import type { DraftState, PendingStep } from "../types.js";

export async function applyLanguageChoiceDraft(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[]
): Promise<void> {
  const update = buildLanguageChoiceUpdate(draft, steps);
  if (Object.keys(update).length > 0 && typeof actor?.update === "function") {
    await actor.update(update);
  }
}

export function buildLanguageChoiceUpdate(draft: DraftState, steps: PendingStep[]): Record<string, unknown> {
  const languageStep = steps.find((step) => step.kind === "language-choice");
  if (!languageStep) {
    return {};
  }

  const selections = Array.from(new Set(draft.languageChoices[languageStep.slotId] ?? []));
  return {
    "system.details.languages.value": selections,
  };
}
