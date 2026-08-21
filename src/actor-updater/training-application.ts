import { listActorItems } from "../build-state.js";
import { MODULE_ID, SKILL_LABELS } from "../constants.js";
import type { ActorItemLike, ActorLike } from "../shared/actor-model.js";
import { queueRuleSelectionUpdate } from "../shared/pf2e-item-source.js";
import { resolveSingletonChoiceSkillGrant } from "../shared/singleton-choice-skill-grants.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep, SkillTrainingPersistenceMeta } from "../types.js";
import {
  compileSkillProgression,
  type SkillProgressionMode,
  type SkillSourceGrant,
} from "../wayfinder/domain/skill-progression.js";

export async function applyTrainingDraft(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[],
  options: {
    persistActorUpdate?: boolean;
    validSkillSlugs?: ReadonlySet<string>;
    mode?: SkillProgressionMode;
  } = {}
): Promise<Record<string, number>> {
  const actorItems = listActorItems(actor) as ActorItemLike[];
  const progression = compileSkillProgression({
    baselineRanks: readActorSkillRanks(actor),
    draft,
    steps,
    sourceGrants: collectAppliedSkillSourceGrants(actor, draft, steps),
    validSkillSlugs: options.validSkillSlugs ?? collectProgressionSkillSlugs(actor, draft, steps),
    mode: options.mode ?? "editing",
  });
  if (progression.issues.length > 0) {
    throw new Error("Skill progression changed during Apply; reopen Wayfinder and review the affected choices.");
  }
  const updatesByItemId = new Map<string, Record<string, unknown>>();
  const desiredTrainingLores = new Map<string, { slotId: string; key: string; name: string }>();

  for (const step of steps) {
    if (step.kind !== "skill-training") {
      continue;
    }
    const slotId = step.slotId;
    const training = progression.reconciliation.skillTrainings[slotId];

    if (training) {
      for (const choiceRule of step.training.choiceRules) {
        const selection = training.ruleChoices[choiceRule.key];
        if (!selection) {
          continue;
        }

        queueTrainingRuleSelectionUpdate(
          actorItems,
          updatesByItemId,
          choiceRule.persistence,
          choiceRule.flag,
          selection
        );
      }
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

    if (!training) {
      continue;
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

  const actorUpdate = buildTrainingActorUpdate(actor, progression.finalRanks);

  if (
    options.persistActorUpdate !== false &&
    Object.keys(actorUpdate).length > 0 &&
    typeof actor.update === "function"
  ) {
    await actor.update(actorUpdate);
  }

  await reconcileTrainingLore(actor, actorItems, Array.from(desiredTrainingLores.values()));

  return { ...progression.finalRanks };
}

export function collectAppliedSkillSourceGrants(
  actor: ActorLike,
  draft: DraftState,
  steps: readonly PendingStep[]
): readonly SkillSourceGrant[] {
  const actorItems = listActorItems(actor) as ActorItemLike[];
  const stepMap = new Map(steps.map((step) => [step.slotId, step]));
  return Object.entries(draft.singletonChoices).flatMap(([slotId, selection]) => {
    const step = stepMap.get(slotId);
    if (
      step?.kind !== "singleton-choice" ||
      typeof selection !== "string" ||
      selection.length === 0 ||
      !step.singletonChoice.options.some((option) => option.value === selection)
    ) {
      return [];
    }
    const grantedSkill = resolveSingletonChoiceGrantedSkill(actorItems, step, selection);
    return grantedSkill
      ? [{ slug: grantedSkill.skillSlug, rank: grantedSkill.rank, sourceId: step.singletonChoice.sourceUuid }]
      : [];
  });
}

export async function applySkillIncreaseDraft(
  actor: ActorLike,
  draft: DraftState,
  baseRanks?: Record<string, number>,
  options: {
    persistActorUpdate?: boolean;
    activeSlotIds?: ReadonlySet<string>;
    steps?: readonly PendingStep[];
  } = {}
): Promise<Record<string, unknown>> {
  let projectedRanks: Record<string, number> = baseRanks ? { ...baseRanks } : {};
  if (options.steps) {
    const activeIncreaseSlotIds = options.activeSlotIds ?? new Set(options.steps.map((step) => step.slotId));
    const activeDraft = {
      skillIncreases: Object.fromEntries(
        Object.entries(draft.skillIncreases).filter(([slotId]) => activeIncreaseSlotIds.has(slotId))
      ),
      skillTrainings: draft.skillTrainings,
    };
    projectedRanks = {
      ...compileSkillProgression({
        baselineRanks: projectedRanks,
        draft: activeDraft,
        steps: options.steps,
        validSkillSlugs: collectProgressionSkillSlugs(actor, draft, options.steps),
        mode: "editing",
      }).finalRanks,
    };
  } else if (!baseRanks) {
    for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
      const rank = Number((data as { rank?: unknown })?.rank ?? 0);
      projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
    }
  }

  const sortedEntries = Object.entries(draft.skillIncreases)
    .filter(([slotId]) => !options.activeSlotIds || options.activeSlotIds.has(slotId))
    .sort(([left], [right]) => compareSkillIncreaseSlotIds(left, right));
  const increasedSlugs = new Set<string>();

  for (const [, slug] of sortedEntries) {
    if (typeof slug !== "string" || !slug) {
      continue;
    }

    increasedSlugs.add(slug);
    if (!options.steps) {
      const currentRank = projectedRanks[slug] ?? 0;
      projectedRanks[slug] = Math.min(4, currentRank + 1);
    }
  }

  const updates = Object.entries(projectedRanks)
    .filter(([slug, rank]) => {
      const currentRank = readActorSkillRank(actor, slug);
      const baseline =
        baseRanks && !increasedSlugs.has(slug) ? Math.max(currentRank, baseRanks[slug] ?? currentRank) : currentRank;
      return rank > baseline;
    })
    .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank] as const);

  const actorUpdate = Object.fromEntries(updates);
  if (options.persistActorUpdate !== false && updates.length > 0 && typeof actor.update === "function") {
    await actor.update(actorUpdate);
  }

  return actorUpdate;
}

export function buildTrainingActorUpdate(
  actor: ActorLike,
  projectedRanks: Readonly<Record<string, number>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(projectedRanks)
      .filter(
        ([slug, rank]) =>
          (slug in (actor.system?.skills ?? {}) || slug in SKILL_LABELS) && rank > readActorSkillRank(actor, slug)
      )
      .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank])
  );
}

function collectProgressionSkillSlugs(
  actor: ActorLike,
  draft: DraftState,
  steps: readonly PendingStep[]
): ReadonlySet<string> {
  return new Set([
    ...Object.keys(actor.system?.skills ?? {}),
    ...Object.values(draft.skillIncreases),
    ...Object.values(draft.skillTrainings).flatMap((training) => [
      ...Object.values(training.ruleChoices),
      ...training.additional,
    ]),
    ...steps.flatMap((step) =>
      step.kind === "skill-training"
        ? [
            ...step.training.fixedSkills,
            ...step.training.choiceRules.flatMap((choice) => choice.options.map((option) => option.slug)),
          ]
        : []
    ),
  ]);
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

function readActorSkillRanks(actor: ActorLike): Record<string, number> {
  return Object.fromEntries(
    Object.keys(actor.system?.skills ?? {}).map((slug) => [slug, readActorSkillRank(actor, slug)])
  );
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
