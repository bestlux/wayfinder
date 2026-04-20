import { listActorItems } from "../build-state.js";
import type { ActorItemLike, ActorLike } from "../shared/actor-model.js";
import { cloneData } from "../shared/cloning.js";
import type { DraftState, PendingStep } from "../types.js";

export async function applyTrainingDraft(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[]
): Promise<Record<string, number>> {
  const projectedRanks: Record<string, number> = {};
  for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
    const rank = Number((data as { rank?: unknown })?.rank ?? 0);
    projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
  }

  const stepMap = new Map(steps.map((step) => [step.slotId, step]));
  const classUpdates: Record<string, unknown>[] = [];
  const actorItems = listActorItems(actor) as ActorItemLike[];

  for (const [slotId, training] of Object.entries(draft.skillTrainings)) {
    const step = stepMap.get(slotId);
    if (step?.kind !== "skill-training" || !step.training) {
      continue;
    }

    const classItem = actorItems.find((item) => item?.type === "class");
    if (classItem?.id && step.training.choiceRules.length > 0) {
      const classRules = cloneData(Array.isArray(classItem.system?.rules) ? classItem.system.rules : []);
      const classUpdate: Record<string, unknown> = { _id: classItem.id };

      for (const choiceRule of step.training.choiceRules) {
        const selection = training.ruleChoices[choiceRule.flag];
        if (!selection) {
          continue;
        }

        if (classRules[choiceRule.ruleIndex]) {
          classRules[choiceRule.ruleIndex].selection = selection;
        }
        classUpdate[`flags.pf2e.rulesSelections.${choiceRule.flag}`] = selection;
        projectedRanks[selection] = Math.max(projectedRanks[selection] ?? 0, 1);
      }

      classUpdate["system.rules"] = classRules;
      classUpdates.push(classUpdate);
    }

    for (const slug of training.additional) {
      projectedRanks[slug] = Math.max(projectedRanks[slug] ?? 0, 1);
    }
  }

  if (classUpdates.length > 0 && typeof actor.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", classUpdates);
  }

  const skillUpdates = Object.entries(projectedRanks)
    .filter(([slug, rank]) => {
      const current = Number(actor?.system?.skills?.[slug]?.rank ?? 0);
      return rank > current;
    })
    .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank] as const);

  if (skillUpdates.length > 0 && typeof actor.update === "function") {
    await actor.update(Object.fromEntries(skillUpdates));
  }

  return projectedRanks;
}

export async function applySkillIncreaseDraft(
  actor: ActorLike,
  draft: DraftState,
  baseRanks?: Record<string, number>
): Promise<void> {
  const projectedRanks: Record<string, number> = baseRanks ? { ...baseRanks } : {};
  if (!baseRanks) {
    for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
      const rank = Number((data as { rank?: unknown })?.rank ?? 0);
      projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
    }
  }

  const sortedEntries = Object.entries(draft.skillIncreases).sort(([left], [right]) =>
    compareSkillIncreaseSlotIds(left, right)
  );

  for (const [, slug] of sortedEntries) {
    if (typeof slug !== "string" || !slug) {
      continue;
    }

    const currentRank = projectedRanks[slug] ?? 0;
    projectedRanks[slug] = Math.min(4, currentRank + 1);
  }

  const updates = Object.entries(projectedRanks).map(([slug, rank]) => [`system.skills.${slug}.rank`, rank] as const);

  if (updates.length > 0 && typeof actor.update === "function") {
    await actor.update(Object.fromEntries(updates));
  }
}

function compareSkillIncreaseSlotIds(left: string, right: string): number {
  const leftLevel = skillIncreaseLevelFromSlotId(left);
  const rightLevel = skillIncreaseLevelFromSlotId(right);
  if (leftLevel !== rightLevel) {
    return leftLevel - rightLevel;
  }

  return left.localeCompare(right);
}

function skillIncreaseLevelFromSlotId(slotId: string): number {
  const match = /skill-increase-level-(\d+)/.exec(slotId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
