import {
  applySelectorApplication,
  buildSelectorSelection,
  type SelectorActorLike,
  type SelectorApplicationDependencies,
  type SelectorApplicationPlan,
  type SelectorClassSourceLike,
  stripSelectedSelectorEntries,
} from "./selector-application.js";
import type { ClassBranchMeta, DraftState, PendingStep, SelectionRef } from "./types.js";

type ApplyClassBranchDraftDependencies = SelectorApplicationDependencies;

export async function applyClassBranchDraft(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassBranchDraftDependencies
): Promise<void> {
  const stepOrder = new Map(steps.map((step, index) => [step.slotId, index]));
  const orderedSteps = steps
    .filter((step) => step.kind === "class-branch" && step.branch)
    .sort((left, right) => (stepOrder.get(left.slotId) ?? 0) - (stepOrder.get(right.slotId) ?? 0));

  for (const step of orderedSteps) {
    const selection = draft.branchSelections[step.slotId];
    const branch = step.branch;
    if (!selection || !branch) {
      continue;
    }
    const plan: SelectorApplicationPlan = {
      selectorSelection: createBranchSelectorSelection(branch, step.slotId),
      slotId: step.slotId,
      ruleSelections: [
        {
          flag: branch.flag,
          ruleIndex: branch.selectorRuleIndex,
          value: selection.uuid,
        },
      ],
      omitSelectedRulesOnCreate: true,
      grantPlan: {
        flag: branch.flag,
        slotId: step.slotId,
        selection,
        selectorRuleIndex: branch.selectorRuleIndex,
        createRulePolicy: "remove-all-grant-items",
        updateCreatedGrant: true,
      },
    };

    await applySelectorApplication(actor, plan, {
      ...deps,
      createEmbeddedSource: (selection, sourceDraft, sourceSteps) =>
        deps.createEmbeddedSource(selection, sourceDraft ?? draft, sourceSteps ?? steps),
    });
  }
}

export function stripPreselectedClassBranchEntries(
  classSource: SelectorClassSourceLike,
  draft: DraftState,
  steps: PendingStep[]
): void {
  stripSelectedSelectorEntries(
    classSource,
    getSelectedBranchSteps(draft, steps).map((step) => ({
      uuid: step.branch.selectorUuid,
      documentId: step.branch.selectorDocumentId,
      name: step.branch.selectorName,
    }))
  );
}

export function createBranchSelectorSelection(branch: ClassBranchMeta, slotId: string): SelectionRef {
  return buildSelectorSelection(
    slotId,
    branch.selectorPackId,
    branch.selectorDocumentId,
    branch.selectorUuid,
    branch.selectorName
  );
}

function getSelectedBranchSteps(
  draft: DraftState,
  steps: PendingStep[]
): Array<PendingStep & { branch: ClassBranchMeta }> {
  return steps.filter(
    (step): step is PendingStep & { branch: ClassBranchMeta } =>
      step.kind === "class-branch" && !!step.branch && !!draft.branchSelections[step.slotId]
  );
}
