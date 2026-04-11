import { BOOST_LEVELS, getEffectiveBuildState, listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import { fetchSelectionDocument } from "./pack-service.js";
import type { AbilityKey, DraftState, PendingStep, SelectionRef } from "./types.js";

const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);

export async function applyDraftToActor(actor: any, draft: DraftState, steps: PendingStep[]): Promise<void> {
  const selections = orderSelections(draft, steps);
  const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));

  for (const selection of selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType))) {
    await replaceSingletonItem(actor, selection);
  }

  const projectedTrainingRanks = await applyTrainingDraft(actor, draft, steps);
  await applyBranchDraft(actor, draft, steps);

  for (const selection of selections.filter((entry) => entry.itemType === "feat")) {
    if (hasSourceId(actor, selection.uuid)) {
      continue;
    }

    const step = stepsBySlotId.get(selection.slotId);
    await insertFeatSelection(actor, selection, step ?? null);
  }

  await applyBoostDraft(actor, draft);
  await applySkillIncreaseDraft(actor, draft, projectedTrainingRanks);

  const currentLevel = Number(actor?.system?.details?.level?.value ?? 1) || 1;
  if (draft.targetLevel > currentLevel) {
    await actor.update({
      "system.details.level.value": draft.targetLevel
    });
  }
}

async function applyBranchDraft(actor: any, draft: DraftState, steps: PendingStep[]): Promise<void> {
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

    const selectorItem = findItemBySourceId(actor, branch.selectorUuid);
    if (!selectorItem?.id) {
      continue;
    }

    const existingGranted = listActorItems(actor).find((item: any) =>
      item?.flags?.pf2e?.grantedBy?.id === selectorItem.id
    ) ?? null;
    const existingGrantedMatches = existingGranted && itemMatchesSourceId(existingGranted, selection.uuid);
    if (existingGranted && !existingGrantedMatches) {
      await actor.deleteEmbeddedDocuments("Item", [existingGranted.id]);
    }

    let grantedItem = existingGrantedMatches ? existingGranted : null;
    if (!grantedItem) {
      const source = await createEmbeddedSource(selection);
      if (!source) {
        continue;
      }

      source.flags ??= {};
      source.flags.pf2e ??= {};
      source.flags.pf2e.grantedBy = {
        id: selectorItem.id,
        onDelete: "cascade"
      };

      const created = await actor.createEmbeddedDocuments("Item", [source]);
      grantedItem = Array.isArray(created) ? created[0] ?? null : null;
      if (!grantedItem?.id) {
        continue;
      }
    }

    const selectorRules = Array.isArray(selectorItem.system?.rules)
      ? cloneData(selectorItem.system.rules)
      : [];
    const selectorRule = selectorRules[branch.selectorRuleIndex];
    if (selectorRule) {
      selectorRule.selection = selection.uuid;
    }

    await actor.updateEmbeddedDocuments("Item", [
      {
        _id: selectorItem.id,
        "system.rules": selectorRules,
        [`flags.pf2e.rulesSelections.${branch.flag}`]: selection.uuid,
        [`flags.pf2e.itemGrants.${branch.flag}`]: {
          id: grantedItem.id,
          onDelete: "detach",
          nested: null
        },
        [`flags.${MODULE_ID}.slotId`]: step.slotId
      },
      {
        _id: grantedItem.id,
        "flags.core.sourceId": selection.uuid,
        "flags.pf2e.grantedBy": {
          id: selectorItem.id,
          onDelete: "cascade"
        },
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: step.slotId
      }
    ]);
  }
}

async function applyTrainingDraft(actor: any, draft: DraftState, steps: PendingStep[]): Promise<Record<string, number>> {
  const projectedRanks: Record<string, number> = {};
  for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
    const rank = Number((data as any)?.rank ?? 0);
    projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
  }

  const stepMap = new Map(steps.map((step) => [step.slotId, step]));
  const classUpdates: Record<string, unknown>[] = [];

  for (const [slotId, training] of Object.entries(draft.skillTrainings)) {
    const step = stepMap.get(slotId);
    if (step?.kind !== "skill-training" || !step.training) {
      continue;
    }

    const classItem = listActorItems(actor).find((item: any) => item?.type === "class");
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

  if (classUpdates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", classUpdates);
  }

  const skillUpdates = Object.entries(projectedRanks)
    .filter(([slug, rank]) => {
      const current = Number(actor?.system?.skills?.[slug]?.rank ?? 0);
      return rank > current;
    })
    .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank] as const);

  if (skillUpdates.length > 0) {
    await actor.update(Object.fromEntries(skillUpdates));
  }

  return projectedRanks;
}

async function applySkillIncreaseDraft(actor: any, draft: DraftState, baseRanks?: Record<string, number>): Promise<void> {
  const projectedRanks: Record<string, number> = baseRanks ? { ...baseRanks } : {};
  if (!baseRanks) {
    for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
      const rank = Number((data as any)?.rank ?? 0);
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

  const updates = Object.entries(projectedRanks).map(([slug, rank]) =>
    [`system.skills.${slug}.rank`, rank] as const
  );

  if (updates.length > 0) {
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

async function replaceSingletonItem(actor: any, selection: SelectionRef): Promise<void> {
  const existing = Array.from(actor?.items ?? []).filter((item: any) => item.type === selection.itemType);
  if (existing.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", existing.map((item: any) => item.id));
  }

  const source = await createEmbeddedSource(selection);
  if (source) {
    await actor.createEmbeddedDocuments("Item", [source]);
  }
}

async function createEmbeddedSource(selection: SelectionRef): Promise<any | null> {
  const document = await fetchSelectionDocument(selection);
  if (!document) {
    return null;
  }

  const source = document.toObject();
  delete source._id;
  source.flags ??= {};
  source.flags.core ??= {};
  source.flags.core.sourceId = selection.uuid;
  source.flags[MODULE_ID] = {
    importedBy: MODULE_ID,
    slotId: selection.slotId
  };
  return source;
}

async function insertFeatSelection(actor: any, selection: SelectionRef, step: PendingStep | null): Promise<void> {
  const document = await fetchSelectionDocument(selection);
  if (!document) {
    return;
  }

  const slotData = resolveFeatSlotData(actor, selection, step);
  if (typeof actor?.feats?.insertFeat === "function") {
    const inserted = await actor.feats.insertFeat(document, slotData);
    await stampSelectionFlags(actor, inserted, selection);
    return;
  }

  const source = await createEmbeddedSource(selection);
  if (!source) {
    return;
  }

  if (slotData) {
    source.system ??= {};
    source.system.location = slotData.slotId ?? slotData.groupId;
    source.system.level ??= {};
    if (typeof step?.level === "number") {
      source.system.level.taken = step.level;
    }
  }
  await actor.createEmbeddedDocuments("Item", [source]);
}

function resolveFeatSlotData(
  actor: any,
  selection: SelectionRef,
  step: PendingStep | null
): { groupId: string; slotId: string | null } | null {
  const groupId = resolveFeatGroupId(selection, step);
  if (!groupId) {
    return null;
  }

  const group = typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId];
  const slots = Object.values(group?.slots ?? {}) as Array<{ id?: string; level?: number | null; feat?: unknown }>;
  if (slots.length === 0) {
    return { groupId, slotId: null };
  }

  const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
  const firstOpen = slots.find((slot) => !slot.feat);
  return {
    groupId,
    slotId: matchingLevel?.id ?? firstOpen?.id ?? null
  };
}

function resolveFeatGroupId(selection: SelectionRef, step: PendingStep | null): string | null {
  switch (step?.slotKind) {
    case "ancestry-feat":
      return "ancestry";
    case "class-feat":
      return "class";
    case "skill-feat":
      return "skill";
    case "general-feat":
      return "general";
    default:
      switch (selection.featType) {
        case "ancestry":
          return "ancestry";
        case "class":
        case "archetype":
          return "class";
        case "skill":
          return "skill";
        case "general":
          return "general";
        default:
          return null;
      }
  }
}

async function stampSelectionFlags(actor: any, items: any[], selection: SelectionRef): Promise<void> {
  if (!Array.isArray(items) || items.length === 0 || typeof actor?.updateEmbeddedDocuments !== "function") {
    return;
  }

  const updates: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item?.id) {
      continue;
    }

    updates.push({
      _id: item.id,
      "flags.core.sourceId": selection.uuid,
      [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
      [`flags.${MODULE_ID}.slotId`]: selection.slotId
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}

function orderSelections(draft: DraftState, steps: PendingStep[]): SelectionRef[] {
  const order = new Map<string, number>();
  steps.forEach((step, index) => order.set(step.slotId, index));

  return Object.values(draft.selections).sort((left, right) => {
    return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
  });
}

function hasSourceId(actor: any, sourceId: string): boolean {
  return listActorItems(actor).some((item: any) => itemMatchesSourceId(item, sourceId));
}

function findItemBySourceId(actor: any, sourceId: string): any | null {
  return listActorItems(actor).find((item: any) => itemMatchesSourceId(item, sourceId)) ?? null;
}

function itemMatchesSourceId(item: any, sourceId: string): boolean {
  return item?.sourceId === sourceId
    || item?.flags?.core?.sourceId === sourceId
    || item?._stats?.compendiumSource === sourceId;
}

function cloneData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

async function applyBoostDraft(actor: any, draft: DraftState): Promise<void> {
  const buildState = await getEffectiveBuildState(actor, draft);
  const updates: any[] = [];

  const ancestryItem = listActorItems(actor).find((item: any) => item?.type === "ancestry");
  if (ancestryItem && buildState.ancestry) {
    const ancestryUpdate: Record<string, unknown> = { _id: ancestryItem.id };
    if (buildState.ancestry.mode === "alternate") {
      ancestryUpdate["system.alternateAncestryBoosts"] = buildState.ancestry.alternateBoosts;
    } else {
      ancestryUpdate["system.-=alternateAncestryBoosts"] = null;
    }

    for (const [slot, value] of Object.entries(buildState.ancestry.selectedBoosts)) {
      ancestryUpdate[`system.boosts.${slot}.selected`] = value;
    }

    ancestryUpdate["system.voluntary.flaws"] = buildState.ancestry.voluntary.enabled
      ? buildState.ancestry.voluntary.flaws
      : [];
    if (buildState.ancestry.voluntary.enabled && buildState.ancestry.voluntary.legacy) {
      ancestryUpdate["system.voluntary.boost"] = buildState.ancestry.voluntary.boost;
    } else {
      ancestryUpdate["system.voluntary.-=boost"] = null;
    }

    updates.push(ancestryUpdate);
  }

  const backgroundItem = listActorItems(actor).find((item: any) => item?.type === "background");
  if (backgroundItem && buildState.background) {
    const backgroundUpdate: Record<string, unknown> = { _id: backgroundItem.id };
    for (const [slot, value] of Object.entries(buildState.background.selectedBoosts)) {
      backgroundUpdate[`system.boosts.${slot}.selected`] = value;
    }
    updates.push(backgroundUpdate);
  }

  const classItem = listActorItems(actor).find((item: any) => item?.type === "class");
  if (classItem && buildState.class) {
    updates.push({
      _id: classItem.id,
      "system.keyAbility.selected": buildState.class.selectedKeyAbility
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  const actorBoostUpdate = Object.fromEntries(
    BOOST_LEVELS.map((level) => [
      `system.build.attributes.boosts.${level}`,
      buildState.levelBoosts[level]
    ])
  );
  await actor.update(actorBoostUpdate);
}
