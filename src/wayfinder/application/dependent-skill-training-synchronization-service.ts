import type { PendingStep, SelectionRef } from "../../types.js";
import { compileSkillPaneProgression } from "./build-skill-pane-service.js";
import { applySkillProgressionReconciliation, type DraftAdjustmentState } from "./draft-adjustment-service.js";

type SkillDocumentType = "ancestry" | "heritage" | "background" | "class";

export interface SynchronizeDependentSkillTrainingOptions {
  state: DraftAdjustmentState;
  steps: readonly PendingStep[];
  baseSkillRanks: Record<string, number>;
  resolveDocument: (itemType: SkillDocumentType) => Promise<unknown | null>;
  resolveSelectionDocument?: (selection: SelectionRef) => Promise<unknown | null>;
  localize: (value: string) => string;
}

export async function synchronizeDependentSkillTrainingChoices(
  options: SynchronizeDependentSkillTrainingOptions
): Promise<boolean> {
  const progression = await compileSkillPaneProgression(options.state.draft, {
    baseSkillRanks: options.baseSkillRanks,
    steps: options.steps,
    resolveDocument: options.resolveDocument,
    resolveSelectionDocument: options.resolveSelectionDocument,
    localize: options.localize,
  });
  return applySkillProgressionReconciliation(options.state, progression);
}
