import {
  applySelectorApplication,
  buildSelectorSelection,
  type SelectorApplicationDependencies,
  type SelectorApplicationPlan,
  stripSelectedSelectorEntries,
} from "./selector-application.js";
import type { ClassChoiceMeta, ClassGrantMeta, DraftState, PendingStep, SelectionRef } from "./types.js";

type ApplyClassFeatureChoiceDependencies = SelectorApplicationDependencies;

interface PendingFeatureGroup {
  sourceSelection: SelectionRef;
  grantStep: PendingStep | null;
  grantMeta: ClassGrantMeta | null;
  grantSelection: SelectionRef | null;
  choiceEntries: Array<{
    step: PendingStep;
    meta: ClassChoiceMeta;
    value: string;
  }>;
}

export async function applyClassFeatureChoiceDraft(
  actor: any,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassFeatureChoiceDependencies
): Promise<void> {
  const groups = collectFeatureGroups(draft, steps);

  for (const group of groups) {
    const selectorSlotId = group.grantStep?.slotId ?? group.choiceEntries[0]?.step.slotId ?? null;
    const plan: SelectorApplicationPlan = {
      selectorSelection: group.sourceSelection,
      slotId: selectorSlotId,
      ruleSelections: group.choiceEntries.map((entry) => ({
        flag: entry.meta.flag,
        ruleIndex: entry.meta.sourceRuleIndex,
        value: entry.value,
      })),
      grantPlan:
        group.grantMeta && group.grantSelection
          ? {
              flag: group.grantMeta.flag,
              slotId: group.grantStep?.slotId ?? group.grantMeta.slotId,
              selection: group.grantSelection,
              selectorRuleIndex: group.grantMeta.selectorRuleIndex,
              createRulePolicy: [group.grantMeta.grantRuleIndex],
              updateExistingGrantImmediately: true,
            }
          : null,
    };

    await applySelectorApplication(actor, plan, deps);
  }
}

export function stripPreselectedClassFeatureEntries(classSource: any, draft: DraftState, steps: PendingStep[]): void {
  stripSelectedSelectorEntries(classSource, collectSelectedFeatureRefs(draft, steps));
}

function collectFeatureGroups(draft: DraftState, steps: PendingStep[]): PendingFeatureGroup[] {
  const groups = new Map<string, PendingFeatureGroup>();

  for (const step of steps) {
    if (step.kind === "pick-item" && step.grantSelection) {
      const selection = draft.selections[step.slotId];
      if (!selection) {
        continue;
      }

      const key = step.grantSelection.selectorUuid;
      const group = groups.get(key) ?? {
        sourceSelection: createSourceSelection(step.grantSelection, step.slotId),
        grantStep: null,
        grantMeta: null,
        grantSelection: null,
        choiceEntries: [],
      };
      group.grantStep = step;
      group.grantMeta = step.grantSelection;
      group.grantSelection = selection;
      groups.set(key, group);
      continue;
    }

    if (step.kind === "class-choice" && step.classChoice) {
      const value = draft.classChoices[step.slotId];
      if (!value) {
        continue;
      }

      const key = step.classChoice.sourceUuid;
      const group = groups.get(key) ?? {
        sourceSelection: createSourceSelection(step.classChoice, step.slotId),
        grantStep: null,
        grantMeta: null,
        grantSelection: null,
        choiceEntries: [],
      };
      group.choiceEntries.push({ step, meta: step.classChoice, value });
      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

function collectSelectedFeatureRefs(
  draft: DraftState,
  steps: PendingStep[]
): Array<{ uuid: string; documentId: string; name: string }> {
  const refs = new Map<string, { uuid: string; documentId: string; name: string }>();

  for (const step of steps) {
    if (step.kind === "pick-item" && step.grantSelection && draft.selections[step.slotId]) {
      refs.set(step.grantSelection.selectorUuid, {
        uuid: step.grantSelection.selectorUuid,
        documentId: step.grantSelection.selectorDocumentId,
        name: step.grantSelection.selectorName,
      });
    }

    if (step.kind === "class-choice" && step.classChoice && draft.classChoices[step.slotId]) {
      refs.set(step.classChoice.sourceUuid, {
        uuid: step.classChoice.sourceUuid,
        documentId: step.classChoice.sourceDocumentId,
        name: step.classChoice.sourceName,
      });
    }
  }

  return Array.from(refs.values());
}

function createSourceSelection(meta: ClassGrantMeta | ClassChoiceMeta, slotId: string): SelectionRef {
  return buildSelectorSelection(
    slotId,
    "selectorPackId" in meta ? meta.selectorPackId : meta.sourcePackId,
    "selectorDocumentId" in meta ? meta.selectorDocumentId : meta.sourceDocumentId,
    "selectorUuid" in meta ? meta.selectorUuid : meta.sourceUuid,
    "selectorName" in meta ? meta.selectorName : meta.sourceName
  );
}
