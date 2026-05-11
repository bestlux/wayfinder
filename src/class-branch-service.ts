import {
  applySelectorApplication,
  buildSelectorSelection,
  type SelectorActorLike,
  type SelectorApplicationDependencies,
  type SelectorApplicationPlan,
  type SelectorClassSourceLike,
  stripSelectedSelectorEntries,
} from "./selector-application.js";
import type { ClassBranchMeta, ClassChoiceMeta, DraftState, PendingStep, SelectionRef } from "./types.js";

type ApplyClassBranchDraftDependencies = SelectorApplicationDependencies;

export async function applyClassBranchDraft(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassBranchDraftDependencies
): Promise<void> {
  const stepOrder = new Map(steps.map((step, index) => [step.slotId, index]));
  const orderedSteps = steps
    .filter((step): step is PendingStep & { branch: ClassBranchMeta } => step.kind === "class-branch" && !!step.branch)
    .sort((left, right) => (stepOrder.get(left.slotId) ?? 0) - (stepOrder.get(right.slotId) ?? 0));
  const stepsBySelector = groupBranchStepsBySelector(orderedSteps);

  for (const selectorSteps of stepsBySelector) {
    const selectedSteps = selectorSteps.filter((step) => !!draft.branchSelections[step.slotId]);
    if (selectedSteps.length === 0) {
      continue;
    }
    const firstBranch = selectedSteps[0]?.branch;
    if (!firstBranch) {
      continue;
    }
    const classChoiceSelections = collectClassChoiceSelectionsForSelector(draft, steps, firstBranch.selectorUuid);

    const plan: SelectorApplicationPlan = {
      selectorSelection: createBranchSelectorSelection(firstBranch, selectedSteps[0]?.slotId ?? firstBranch.slotId),
      slotId:
        selectedSteps.length === 1 && classChoiceSelections.length === 0
          ? (selectedSteps[0]?.slotId ?? firstBranch.slotId)
          : null,
      ruleSelections: [
        ...classChoiceSelections.map((entry) => ({
          flag: entry.meta.flag,
          ruleIndex: entry.meta.sourceRuleIndex,
          value: entry.value,
        })),
        ...selectedSteps.map((step) => ({
          flag: step.branch!.flag,
          ruleIndex: step.branch!.selectorRuleIndex,
          value: draft.branchSelections[step.slotId]!.uuid,
        })),
      ],
      omitSelectedRulesOnCreate: true,
      grantPlans: selectedSteps.map((step) => ({
        flag: step.branch!.flag,
        slotId: step.slotId,
        selection: draft.branchSelections[step.slotId]!,
        selectorRuleIndex: step.branch!.selectorRuleIndex,
        createRulePolicy: "remove-all-grant-items",
        updateCreatedGrant: selectedSteps.length === 1,
      })),
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

function groupBranchStepsBySelector(
  steps: Array<PendingStep & { branch: ClassBranchMeta }>
): Array<Array<PendingStep & { branch: ClassBranchMeta }>> {
  const groupsBySelector = new Map<string, Array<PendingStep & { branch: ClassBranchMeta }>>();
  for (const step of steps) {
    const key = step.branch.selectorUuid;
    const group = groupsBySelector.get(key) ?? [];
    group.push(step);
    groupsBySelector.set(key, group);
  }

  return Array.from(groupsBySelector.values());
}

function collectClassChoiceSelectionsForSelector(
  draft: DraftState,
  steps: PendingStep[],
  selectorUuid: string
): Array<{ meta: ClassChoiceMeta; value: string }> {
  return steps
    .filter(
      (step): step is PendingStep & { classChoice: ClassChoiceMeta } =>
        step.kind === "class-choice" && !!step.classChoice && step.classChoice.sourceUuid === selectorUuid
    )
    .map((step) => ({
      meta: step.classChoice,
      value: draft.classChoices[step.slotId] ?? "",
    }))
    .filter((entry) => entry.value.length > 0);
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
