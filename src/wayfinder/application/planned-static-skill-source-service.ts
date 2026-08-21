import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import {
  type ClassArchetypeProfile,
  classArchetypeProfile,
  inspectRetainedClassArchetypeProfileDocuments,
} from "../class-archetype/registry.js";

const FOUNDATION_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);

export interface PlannedStaticSkillSource {
  readonly selection: SelectionRef;
  readonly requiredBeforeSkillPhase: boolean;
}

export function activePlannedClassArchetypeProfile(
  draft: DraftState,
  steps: readonly PendingStep[]
): ClassArchetypeProfile | null {
  for (const step of steps) {
    if (step.kind !== "class-archetype") continue;
    const value = draft.classArchetypeChoices[step.slotId];
    if (!step.classArchetype.options.some((option) => option.value === value)) continue;
    const profile = classArchetypeProfile(value);
    if (
      profile?.classSlug === step.classArchetype.selector.classSlug &&
      profile.selectorTag === step.classArchetype.selector.optionTag
    ) {
      return profile;
    }
  }

  if (!steps.some((step) => step.kind === "class-archetype")) {
    for (const [slotId, value] of Object.entries(draft.classArchetypeChoices)) {
      const profile = classArchetypeProfile(value);
      if (
        profile?.decisionSlotId === slotId &&
        activePlanReferencesProjectedProfileGrant(profile, draft.targetLevel, steps)
      ) {
        return profile;
      }
    }
  }
  return null;
}

export function resolveActiveClassArchetypeProfile(
  draft: DraftState,
  steps: readonly PendingStep[],
  actorDocuments: Iterable<unknown>
): ClassArchetypeProfile | null {
  const planned = activePlannedClassArchetypeProfile(draft, steps);
  if (planned) return planned;
  const hasActiveDecision = steps.some(
    (step) => step.kind === "class-archetype" && typeof draft.classArchetypeChoices[step.slotId] === "string"
  );
  if (hasActiveDecision) return null;
  return retainedClassArchetypeProfile(draft, steps, actorDocuments);
}

export function retainActiveClassArchetypeChoices(draft: DraftState, steps: readonly PendingStep[]): void {
  const activeSlotIds = new Set(steps.filter((step) => step.kind === "class-archetype").map((step) => step.slotId));
  draft.classArchetypeChoices = Object.fromEntries(
    Object.entries(draft.classArchetypeChoices).filter(([slotId]) => activeSlotIds.has(slotId))
  );
}

/**
 * Reconstructs completed class-archetype history only when the retained actor
 * documents and the active plan independently prove the same registered route.
 */
export function synchronizeRetainedClassArchetypeChoice(
  draft: DraftState,
  steps: readonly PendingStep[],
  actorDocuments: Iterable<unknown>
): void {
  retainActiveClassArchetypeChoices(draft, steps);
  if (activePlannedClassArchetypeProfile(draft, steps)) return;
  if (
    steps.some(
      (step) => step.kind === "class-archetype" && typeof draft.classArchetypeChoices[step.slotId] === "string"
    )
  ) {
    return;
  }

  const resolution = inspectRetainedClassArchetypeProfileDocuments(actorDocuments);
  if (resolution.kind === "resolved") {
    if (activePlanReferencesProjectedProfileGrant(resolution.profile, draft.targetLevel, steps)) {
      draft.classArchetypeChoices[resolution.profile.decisionSlotId] = resolution.profile.value;
    }
    return;
  }
  if (
    resolution.kind === "invalid" &&
    resolution.profiles.some((profile) => activePlanReferencesProjectedProfileGrant(profile, draft.targetLevel, steps))
  ) {
    throw new Error("Cannot apply retained class-archetype history: actor provenance is ambiguous or contradictory.");
  }
}

/**
 * Lists selected documents whose static skill grants are part of the active
 * progression, and records whether Apply guarantees that PF2E has prepared
 * each document before Wayfinder reaches its skill phase.
 */
export function listPlannedStaticSkillSources(
  draft: DraftState,
  steps: readonly PendingStep[]
): readonly Readonly<PlannedStaticSkillSource>[] {
  const activeSlotIds = new Set(steps.map((step) => step.slotId));
  const sources: PlannedStaticSkillSource[] = Object.values(draft.selections)
    .filter((selection) => activeSlotIds.has(selection.slotId) && FOUNDATION_ITEM_TYPES.has(selection.itemType))
    .map((selection) => ({ selection, requiredBeforeSkillPhase: true }));

  const profile = activePlannedClassArchetypeProfile(draft, steps);
  const profileStep = profile
    ? steps.find(
        (step) =>
          step.kind === "class-archetype" &&
          classArchetypeProfile(draft.classArchetypeChoices[step.slotId])?.value === profile.value
      )
    : null;
  if (profile) {
    sources.push({
      selection: { ...profile.selection, slotId: profileStep?.slotId ?? profile.decisionSlotId },
      // Singleton replacement batches the registered class-archetype source
      // with a drafted class. Without a class replacement, the source is
      // materialized later by the class-archetype phase.
      requiredBeforeSkillPhase: sources.some(({ selection }) => selection.itemType === "class"),
    });
  }

  return Object.freeze(
    sources.map((source) =>
      Object.freeze({
        selection: Object.freeze({ ...source.selection }),
        requiredBeforeSkillPhase: source.requiredBeforeSkillPhase,
      })
    )
  );
}

function retainedClassArchetypeProfile(
  draft: DraftState,
  steps: readonly PendingStep[],
  actorDocuments: Iterable<unknown>
): ClassArchetypeProfile | null {
  const resolution = inspectRetainedClassArchetypeProfileDocuments(actorDocuments);
  return resolution.kind === "resolved" &&
    activePlanReferencesProjectedProfileGrant(resolution.profile, draft.targetLevel, steps)
    ? resolution.profile
    : null;
}

function activePlanReferencesProjectedProfileGrant(
  profile: ClassArchetypeProfile,
  targetLevel: number,
  steps: readonly PendingStep[]
): boolean {
  const activeProfileSourceUuids = new Set([
    profile.selection.uuid,
    ...profile.projectedFeatGrants
      .filter((grant) => grant.minimumLevel <= targetLevel)
      .map((grant) => grant.selection.uuid),
  ]);
  return (
    activeProfileSourceUuids.size > 0 &&
    steps.some((step) => stepSourceUuids(step).some((uuid) => activeProfileSourceUuids.has(uuid)))
  );
}

function stepSourceUuids(step: PendingStep): string[] {
  if (step.kind === "skill-training") {
    return [...step.training.choiceRules, ...step.training.loreChoices].flatMap((choice) =>
      choice.persistence ? [choice.persistence.sourceUuid] : []
    );
  }
  if (step.kind === "singleton-choice") return [step.singletonChoice.sourceUuid];
  if (step.kind === "class-choice") return [step.classChoice.sourceUuid];
  if (step.kind === "spell-choice") return step.spellChoice.sourceUuid ? [step.spellChoice.sourceUuid] : [];
  if (step.kind !== "pick-item") return [];
  return [
    step.flagChoice?.sourceUuid,
    step.staticGrantReplacement?.sourceUuid,
    step.grantSelection?.selectorUuid,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}
