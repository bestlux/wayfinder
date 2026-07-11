import { listActorItems } from "./build-state.js";
import {
  applySelectorApplication,
  buildSelectorSelection,
  type SelectorActorLike,
  type SelectorApplicationDependencies,
} from "./selector-application.js";
import type { DraftState, PendingStep } from "./types.js";
import {
  activeClassArchetypeProfile,
  type ClassArchetypeProfile,
  classArchetypeProfile,
  STANDARD_CLASS_PATH,
} from "./wayfinder/class-archetype/registry.js";

interface ClassArchetypeSelectorDescriptor {
  packId: string;
  documentId: string;
  uuid: string;
  name: string;
  flag: string;
  ruleIndex: number;
}

export async function applyClassArchetypeDraft(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: SelectorApplicationDependencies
): Promise<void> {
  const appliedProfiles = new Set<string>();
  for (const step of steps) {
    if (step.kind !== "class-archetype") {
      continue;
    }

    const value = draft.classArchetypeChoices[step.slotId];
    if (!value || value === STANDARD_CLASS_PATH) {
      continue;
    }

    const profile = classArchetypeProfile(value);
    if (!profile) {
      continue;
    }

    const selector = step.classArchetype.selector;
    await applyClassArchetypeProfile(actor, draft, steps, deps, profile, step.slotId, {
      packId: selector.selectorPackId,
      documentId: selector.selectorDocumentId,
      uuid: selector.selectorUuid,
      name: selector.selectorName,
      flag: selector.flag,
      ruleIndex: selector.selectorRuleIndex,
    });
    appliedProfiles.add(profile.value);
  }

  const activeProfile = activeClassArchetypeProfile(draft, listActorItems(actor));
  if (activeProfile && !appliedProfiles.has(activeProfile.value)) {
    await applyClassArchetypeProfile(actor, draft, steps, deps, activeProfile, activeProfile.decisionSlotId, {
      packId: activeProfile.selector.selection.packId,
      documentId: activeProfile.selector.selection.documentId,
      uuid: activeProfile.selector.selection.uuid,
      name: activeProfile.selector.selection.name,
      flag: activeProfile.selector.flag,
      ruleIndex: activeProfile.selector.ruleIndex,
    });
  }

  for (const internalChoice of activeProfile?.internalClassFeatureChoices ?? []) {
    const selection = {
      ...internalChoice.selection,
      slotId: `class-archetype-internal-${internalChoice.selection.slug ?? internalChoice.selection.documentId}`,
    };
    await applySelectorApplication(
      actor,
      {
        selectorSelection: selection,
        slotId: null,
        ruleSelections: [
          {
            flag: internalChoice.flag,
            ruleIndex: internalChoice.sourceRuleIndex,
            value: resolveInternalChoiceValue(actor, internalChoice.flag, internalChoice.value),
          },
        ],
        omitSelectedRulesOnCreate: true,
      },
      {
        ...deps,
        createEmbeddedSource: (sourceSelection, sourceDraft, sourceSteps) =>
          deps.createEmbeddedSource(sourceSelection, sourceDraft ?? draft, sourceSteps ?? steps),
      }
    );
  }
}

async function applyClassArchetypeProfile(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: SelectorApplicationDependencies,
  profile: ClassArchetypeProfile,
  slotId: string,
  selector: ClassArchetypeSelectorDescriptor
): Promise<void> {
  const selection = { ...profile.selection, slotId };
  await applySelectorApplication(
    actor,
    {
      selectorSelection: buildSelectorSelection(
        slotId,
        selector.packId,
        selector.documentId,
        selector.uuid,
        selector.name
      ),
      slotId: null,
      ruleSelections: [],
      omitSelectedRulesOnCreate: true,
      grantPlan: {
        flag: selector.flag,
        slotId,
        selection,
        selectorRuleIndex: selector.ruleIndex,
        createRulePolicy: "remove-all-grant-items",
        updateCreatedGrant: true,
        updateExistingGrantImmediately: true,
        adoptExistingSource: true,
      },
    },
    {
      ...deps,
      createEmbeddedSource: (sourceSelection, sourceDraft, sourceSteps) =>
        deps.createEmbeddedSource(sourceSelection, sourceDraft ?? draft, sourceSteps ?? steps),
    }
  );
}

function resolveInternalChoiceValue(actor: SelectorActorLike, flag: string, fallback: string): string {
  if (flag !== "divineFont") {
    return fallback;
  }

  const deity = listActorItems(actor).find((item) => item?.type === "deity");
  const fonts = Array.isArray(deity?.system?.font)
    ? deity.system.font.filter((value): value is string => typeof value === "string")
    : [];
  return fonts.find((value) => value === "heal" || value === "harm") ?? fallback;
}
