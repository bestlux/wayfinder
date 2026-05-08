import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import type { ActorItemLike, ActorLike } from "../shared/actor-model.js";
import { queueRuleSelectionUpdate } from "../shared/pf2e-item-source.js";
import { resolveSingletonChoiceSkillGrant } from "../shared/singleton-choice-skill-grants.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep, SkillTrainingPersistenceMeta } from "../types.js";

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
  const actorItems = listActorItems(actor) as ActorItemLike[];
  const updatesByItemId = new Map<string, Record<string, unknown>>();
  const desiredTrainingLores = new Map<string, { slotId: string; key: string; name: string }>();

  for (const [slotId, selection] of Object.entries(draft.singletonChoices)) {
    const step = stepMap.get(slotId);
    if (step?.kind !== "singleton-choice" || typeof selection !== "string" || selection.length === 0) {
      continue;
    }

    if (!step.singletonChoice.options.some((option) => option.value === selection)) {
      continue;
    }

    const grantedSkill = resolveSingletonChoiceGrantedSkill(actorItems, step, selection);
    if (!grantedSkill) {
      continue;
    }

    projectedRanks[grantedSkill.skillSlug] = Math.max(projectedRanks[grantedSkill.skillSlug] ?? 0, grantedSkill.rank);
  }

  for (const [slotId, training] of Object.entries(draft.skillTrainings)) {
    const step = stepMap.get(slotId);
    if (step?.kind !== "skill-training" || !step.training) {
      continue;
    }

    for (const choiceRule of step.training.choiceRules) {
      const selection = training.ruleChoices[choiceRule.key];
      if (!selection) {
        continue;
      }

      queueTrainingRuleSelectionUpdate(actorItems, updatesByItemId, choiceRule.persistence, choiceRule.flag, selection);
      projectedRanks[selection] = Math.max(projectedRanks[selection] ?? 0, 1);
    }

    for (const slug of training.additional) {
      projectedRanks[slug] = Math.max(projectedRanks[slug] ?? 0, 1);
    }

    for (const [index, loreName] of step.training.fixedLores.entries()) {
      const normalizedLore = normalizeLoreName(loreName);
      if (!normalizedLore) {
        continue;
      }

      desiredTrainingLores.set(`${slotId}:fixed:${index}`, {
        slotId,
        key: `fixed:${index}`,
        name: normalizedLore,
      });
    }

    for (const loreChoice of step.training.loreChoices) {
      const selection = normalizeLoreName(training.loreChoices[loreChoice.key] ?? "");
      if (!selection) {
        continue;
      }

      queueTrainingRuleSelectionUpdate(actorItems, updatesByItemId, loreChoice.persistence, loreChoice.flag, selection);
      desiredTrainingLores.set(`${slotId}:${loreChoice.key}`, {
        slotId,
        key: loreChoice.key,
        name: selection,
      });
    }
  }

  const itemUpdates = Array.from(updatesByItemId.values());
  if (itemUpdates.length > 0 && typeof actor.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", itemUpdates);
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

  await reconcileTrainingLore(actor, actorItems, Array.from(desiredTrainingLores.values()));

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
  const increasedSlugs = new Set<string>();

  for (const [, slug] of sortedEntries) {
    if (typeof slug !== "string" || !slug) {
      continue;
    }

    increasedSlugs.add(slug);
    const currentRank = projectedRanks[slug] ?? 0;
    projectedRanks[slug] = Math.min(4, currentRank + 1);
  }

  const updates = Object.entries(projectedRanks)
    .filter(([slug, rank]) => {
      const currentRank = readActorSkillRank(actor, slug);
      const baseline =
        baseRanks && !increasedSlugs.has(slug) ? Math.max(currentRank, baseRanks[slug] ?? currentRank) : currentRank;
      return rank > baseline;
    })
    .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank] as const);

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

function resolveSingletonChoiceGrantedSkill(
  actorItems: ActorItemLike[],
  step: PendingStep,
  selection: string
): { skillSlug: string; rank: number } | null {
  if (step.kind !== "singleton-choice" || !step.singletonChoice?.sourceUuid) {
    return null;
  }

  const sourceItem = actorItems.find((item) => itemMatchesSourceId(item, step.singletonChoice.sourceUuid));
  return resolveSingletonChoiceSkillGrant({
    rules: sourceItem?.system?.rules,
    flag: step.singletonChoice.flag,
    selection,
  });
}

function readActorSkillRank(actor: ActorLike, slug: string): number {
  const rank = Number(actor?.system?.skills?.[slug]?.rank ?? 0);
  return Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
}

function queueTrainingRuleSelectionUpdate(
  actorItems: ActorItemLike[],
  updatesByItemId: Map<string, Record<string, unknown>>,
  persistence: SkillTrainingPersistenceMeta | null,
  flag: string,
  selection: string
): void {
  if (!persistence) {
    return;
  }

  const item =
    actorItems.find((entry) => itemMatchesSourceId(entry, persistence.sourceUuid)) ??
    (persistence.sourceItemType === "class" ? actorItems.find((entry) => entry?.type === "class") : undefined);
  if (!item?.id) {
    return;
  }

  queueRuleSelectionUpdate(updatesByItemId, item, persistence.sourceRuleIndex, flag, selection);
}

async function reconcileTrainingLore(
  actor: ActorLike,
  actorItems: ActorItemLike[],
  desiredEntries: Array<{ slotId: string; key: string; name: string }>
): Promise<void> {
  const desiredByName = new Map<string, { slotId: string; key: string; name: string }>();
  for (const entry of desiredEntries) {
    const normalizedName = normalizeLoreName(entry.name);
    if (!normalizedName) {
      continue;
    }

    desiredByName.set(normalizedName.toLowerCase(), { ...entry, name: normalizedName });
  }

  const desiredBySlotKey = new Map(
    Array.from(desiredByName.values()).map((entry) => [`${entry.slotId}:${entry.key}`, entry] as const)
  );
  const loreItems = actorItems.filter((item) => item?.type === "lore");
  const keyedLoreItems = loreItems.filter((item) => {
    const moduleFlags = item?.flags?.[MODULE_ID];
    return !!moduleFlags && typeof moduleFlags.slotId === "string" && typeof moduleFlags.trainingKey === "string";
  });

  const deleteIds = keyedLoreItems
    .filter((item) => {
      const moduleFlags = item.flags?.[MODULE_ID] as { slotId?: unknown; trainingKey?: unknown } | undefined;
      return !desiredBySlotKey.has(`${String(moduleFlags?.slotId ?? "")}:${String(moduleFlags?.trainingKey ?? "")}`);
    })
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string");

  const updates: Record<string, unknown>[] = [];
  const matchedDesiredNames = new Set<string>();

  for (const item of loreItems) {
    const itemName = normalizeLoreName(item?.name ?? "");
    if (!item?.id || !itemName) {
      continue;
    }

    const desired = desiredByName.get(itemName.toLowerCase());
    if (!desired) {
      continue;
    }

    matchedDesiredNames.add(itemName.toLowerCase());
    const currentRank = Number(
      (item.system as { proficient?: { value?: unknown } } | undefined)?.proficient?.value ?? 0
    );
    const moduleFlags = item.flags?.[MODULE_ID] as
      | { slotId?: unknown; trainingKey?: unknown; importedBy?: unknown }
      | undefined;

    if (
      currentRank < 1 ||
      moduleFlags?.slotId !== desired.slotId ||
      moduleFlags?.trainingKey !== desired.key ||
      moduleFlags?.importedBy !== MODULE_ID
    ) {
      updates.push({
        _id: item.id,
        name: desired.name,
        "system.proficient.value": 1,
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: desired.slotId,
        [`flags.${MODULE_ID}.trainingKey`]: desired.key,
      });
    }
  }

  const createSources = Array.from(desiredByName.values())
    .filter((entry) => !matchedDesiredNames.has(entry.name.toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      type: "lore",
      system: {
        mod: { value: 0 },
        proficient: { value: 1 },
      },
      flags: {
        [MODULE_ID]: {
          importedBy: MODULE_ID,
          slotId: entry.slotId,
          trainingKey: entry.key,
        },
      },
    }));

  if (deleteIds.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
    await actor.deleteEmbeddedDocuments("Item", deleteIds);
  }

  if (updates.length > 0 && typeof actor.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  if (createSources.length > 0 && typeof actor.createEmbeddedDocuments === "function") {
    await actor.createEmbeddedDocuments("Item", createSources);
  }
}

function normalizeLoreName(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return null;
  }

  return /\blore\b$/i.test(trimmed) ? trimmed : `${trimmed} Lore`;
}
