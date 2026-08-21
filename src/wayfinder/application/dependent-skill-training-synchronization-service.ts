import type { PendingStep } from "../../types.js";
import { projectSkillRanks } from "./build-skill-pane-service.js";
import { type DraftAdjustmentState, syncSkillTrainingSelections } from "./draft-adjustment-service.js";

type SkillDocumentType = "ancestry" | "heritage" | "background" | "class";

export interface SynchronizeDependentSkillTrainingOptions {
  state: DraftAdjustmentState;
  steps: readonly PendingStep[];
  baseSkillRanks: Record<string, number>;
  resolveDocument: (itemType: SkillDocumentType) => Promise<unknown | null>;
  localize: (value: string) => string;
}

export async function synchronizeDependentSkillTrainingChoices(
  options: SynchronizeDependentSkillTrainingOptions
): Promise<boolean> {
  const projectedSkillRanksByStepId = Object.fromEntries(
    await Promise.all(
      options.steps.flatMap((step) =>
        step.kind === "skill-training"
          ? [
              projectSkillRanks(options.state.draft, step.slotId, {
                baseSkillRanks: options.baseSkillRanks,
                steps: options.steps,
                resolveDocument: options.resolveDocument,
                localize: options.localize,
              }).then((ranks) => [step.slotId, ranks] as const),
            ]
          : []
      )
    )
  );

  return syncSkillTrainingSelections(options.state, [...options.steps], projectedSkillRanksByStepId);
}
