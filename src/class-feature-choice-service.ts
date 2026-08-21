import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import {
  applySelectorApplication,
  assertExistingSelectorGrantAuthority,
  assertManualStaticGrantReconciliation,
  assertManualStaticGrantSourcesAvailable,
  buildSelectorSelection,
  createManualStaticGrantedItems,
  readManualStaticItemGrants,
  type SelectorActorLike,
  type SelectorApplicationDependencies,
  type SelectorApplicationPlan,
  type SelectorClassSourceLike,
  stripSelectedSelectorEntries,
} from "./selector-application.js";
import type { ActorItemLike, EmbeddedItemSource } from "./shared/actor-model.js";
import { usesNativeGrantItemCreation } from "./shared/grant-creation-policy.js";
import { itemMatchesSourceId } from "./shared/source-id.js";
import type {
  ClassChoiceMeta,
  ClassGrantMeta,
  DraftState,
  PendingStep,
  SelectionRef,
  StaticGrantOwnerMeta,
} from "./types.js";
import { selectedClassArchetypeInternalChoices } from "./wayfinder/class-archetype/registry.js";
import { materializeClassChoiceSelection } from "./wayfinder/class-choice/selection-value.js";

type ApplyClassFeatureChoiceDependencies = SelectorApplicationDependencies;

interface PendingFeatureGroup {
  sourceSelection: SelectionRef;
  grantEntries: Array<{
    step: PendingStep;
    meta: ClassGrantMeta;
    selection: SelectionRef;
  }>;
  staticGrantOwner: StaticGrantOwnerMeta | null;
  choiceEntries: Array<{
    step: PendingStep;
    meta: ClassChoiceMeta;
    value: string;
  }>;
}

export async function applyClassFeatureChoiceDraft(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassFeatureChoiceDependencies
): Promise<void> {
  const groups = collectFeatureGroups(draft, steps);
  const staticGrantPreparations = await Promise.all(
    groups
      .filter((group) => group.staticGrantOwner)
      .map((group) => prepareStaticGrantOwner(actor, draft, steps, deps, group))
  );

  for (const group of groups) {
    if (group.staticGrantOwner) {
      continue;
    }
    await applyFeatureGroup(actor, draft, steps, deps, group);
  }

  for (const preparation of staticGrantPreparations) {
    await convergeExistingStaticGrantOwner(actor, deps, preparation);
    if (preparation.ownerItem && hasFeatureMutations(preparation.group)) {
      assertFeatureGroupRuleAuthority(actor, preparation.group, preparation.featureSource, false);
      await applyFeatureGroup(actor, draft, steps, deps, preparation.group);
    }
  }
}

async function applyFeatureGroup(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassFeatureChoiceDependencies,
  group: PendingFeatureGroup
): Promise<void> {
  const plan = buildFeatureGroupPlan(group);

  await applySelectorApplication(actor, plan, {
    ...deps,
    createEmbeddedSource: (selection, sourceDraft, sourceSteps) =>
      deps.createEmbeddedSource(selection, sourceDraft ?? draft, sourceSteps ?? steps),
  });
}

function buildFeatureGroupPlan(group: PendingFeatureGroup): SelectorApplicationPlan {
  const selectorSlotId = group.grantEntries[0]?.step.slotId ?? group.choiceEntries[0]?.step.slotId ?? null;
  return {
    selectorSelection: group.sourceSelection,
    slotId: selectorSlotId,
    ruleSelections: group.choiceEntries.map((entry) => ({
      flag: entry.meta.flag,
      ruleIndex: entry.meta.sourceRuleIndex,
      value: materializeClassChoiceSelection(entry.meta, entry.value),
    })),
    grantPlans: group.grantEntries.map((entry) => ({
      flag: entry.meta.flag,
      slotId: entry.step.slotId ?? entry.meta.slotId,
      selection: entry.selection,
      selectorRuleIndex: entry.meta.selectorRuleIndex,
      createRulePolicy: [entry.meta.grantRuleIndex],
      updateExistingGrantImmediately: true,
    })),
  };
}

interface PreparedStaticGrantOwner {
  group: PendingFeatureGroup;
  owner: StaticGrantOwnerMeta;
  ownerItem: ActorItemLike | null;
  ownerSource: EmbeddedItemSource;
  featureSource: EmbeddedItemSource | null;
}

async function prepareStaticGrantOwner(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassFeatureChoiceDependencies,
  group: PendingFeatureGroup
): Promise<PreparedStaticGrantOwner> {
  const owner = group.staticGrantOwner;
  if (!owner || owner.selection.uuid === group.sourceSelection.uuid) {
    throw new Error(`Cannot defer ${group.sourceSelection.name}: its static grant owner is invalid.`);
  }

  const draftedOwner = draft.selections[owner.selection.slotId];
  if (draftedOwner && draftedOwner.uuid !== owner.selection.uuid) {
    throw new Error(`Cannot defer ${group.sourceSelection.name}: its planned static grant owner has changed.`);
  }

  const ownerSource = await deps.createEmbeddedSource(owner.selection, draft, steps);
  if (!ownerSource) {
    throw new Error(`Cannot defer ${group.sourceSelection.name}: its planned static grant owner is unavailable.`);
  }
  const matchingGrants = readManualStaticItemGrants(ownerSource).filter(
    (grant) => grant.uuid === group.sourceSelection.uuid
  );
  if (matchingGrants.length !== 1) {
    throw new Error(`Cannot defer ${group.sourceSelection.name}: its planned static grant route is ambiguous.`);
  }

  const actorItems = listActorItems(actor) as ActorItemLike[];
  const ownerItems = actorItems.filter((item) => itemMatchesSourceId(item, owner.selection.uuid));
  if (ownerItems.length > 1) {
    throw new Error(`Cannot defer ${group.sourceSelection.name}: its planned static grant owner is ambiguous.`);
  }
  const ownerItem = ownerItems[0] ?? null;
  const featureSource =
    ownerItem && hasFeatureMutations(group)
      ? await deps.createEmbeddedSource(group.sourceSelection, draft, steps)
      : null;
  if (ownerItem && hasFeatureMutations(group) && !featureSource) {
    throw new Error(`Cannot defer ${group.sourceSelection.name}: its prepared child source is unavailable.`);
  }
  if (ownerItem) {
    assertStaticGrantOwnerAuthority(ownerItem, owner);
    assertManualStaticGrantReconciliation(actor, ownerItem, ownerSource, {
      parentName: owner.selection.name,
      replaceDescendantsOwnedById: null,
    });
    assertFeatureGroupRuleAuthority(actor, group, featureSource, true);
    assertExistingSelectorGrantAuthority(actor, buildFeatureGroupPlan(group));
  } else {
    assertManualStaticGrantSourcesAvailable(actor, ownerSource, owner.selection.name);
  }

  return { group, owner, ownerItem, ownerSource, featureSource };
}

function assertFeatureGroupRuleAuthority(
  actor: SelectorActorLike,
  group: PendingFeatureGroup,
  featureSource: EmbeddedItemSource | null,
  allowMissing: boolean
): void {
  if (!hasFeatureMutations(group)) return;
  if (!featureSource) {
    throw new Error(`Cannot reconcile ${group.sourceSelection.name}: its prepared child source is unavailable.`);
  }
  const matches = (listActorItems(actor) as ActorItemLike[]).filter((item) =>
    itemMatchesSourceId(item, group.sourceSelection.uuid)
  );
  if (matches.length === 0 && allowMissing) return;
  if (matches.length !== 1) {
    throw new Error(`Cannot reconcile ${group.sourceSelection.name}: its prepared child provenance is ambiguous.`);
  }
  const actorRules = Array.isArray(matches[0]?.system?.rules) ? matches[0].system.rules : [];
  const preparedRules = Array.isArray(featureSource.system?.rules) ? featureSource.system.rules : [];
  for (const entry of group.choiceEntries) {
    const actorRule = actorRules[entry.meta.sourceRuleIndex];
    const preparedRule = preparedRules[entry.meta.sourceRuleIndex];
    if (!sameChoiceRuleIdentity(actorRule, preparedRule)) {
      throw new Error(`Cannot reconcile ${group.sourceSelection.name}: its prepared ChoiceSet rules have changed.`);
    }
  }
  for (const entry of group.grantEntries) {
    const actorChoiceRule = actorRules[entry.meta.selectorRuleIndex];
    const preparedChoiceRule = preparedRules[entry.meta.selectorRuleIndex];
    const actorGrantRule = actorRules[entry.meta.grantRuleIndex];
    const preparedGrantRule = preparedRules[entry.meta.grantRuleIndex];
    if (
      !sameChoiceRuleIdentity(actorChoiceRule, preparedChoiceRule) ||
      !sameGrantRuleIdentity(actorGrantRule, preparedGrantRule)
    ) {
      throw new Error(`Cannot reconcile ${group.sourceSelection.name}: its prepared grant-choice rules have changed.`);
    }
  }
}

function sameChoiceRuleIdentity(actorRule: unknown, preparedRule: unknown): boolean {
  if (!isRecord(actorRule) || !isRecord(preparedRule)) return false;
  if (actorRule.key !== "ChoiceSet" || preparedRule.key !== "ChoiceSet") return false;
  return actorRule.flag === preparedRule.flag && actorRule.slug === preparedRule.slug;
}

function sameGrantRuleIdentity(actorRule: unknown, preparedRule: unknown): boolean {
  if (!isRecord(actorRule) || !isRecord(preparedRule)) return false;
  return (
    actorRule.key === "GrantItem" &&
    preparedRule.key === "GrantItem" &&
    actorRule.uuid === preparedRule.uuid &&
    actorRule.flag === preparedRule.flag
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function convergeExistingStaticGrantOwner(
  actor: SelectorActorLike,
  deps: ApplyClassFeatureChoiceDependencies,
  preparation: PreparedStaticGrantOwner
): Promise<void> {
  if (!preparation.ownerItem) {
    return;
  }

  const currentOwnerItems = (listActorItems(actor) as ActorItemLike[]).filter((item) =>
    itemMatchesSourceId(item, preparation.owner.selection.uuid)
  );
  if (
    currentOwnerItems.length !== 1 ||
    !currentOwnerItems[0]?.id ||
    currentOwnerItems[0].id !== preparation.ownerItem.id
  ) {
    throw new Error(
      `Cannot reconcile ${preparation.group.sourceSelection.name}: its planned static grant owner changed during Apply.`
    );
  }
  const currentOwner = currentOwnerItems[0];
  assertStaticGrantOwnerAuthority(currentOwner, preparation.owner);
  assertManualStaticGrantReconciliation(actor, currentOwner, preparation.ownerSource, {
    parentName: preparation.owner.selection.name,
    replaceDescendantsOwnedById: null,
  });

  const result = await createManualStaticGrantedItems(actor, currentOwner, preparation.ownerSource, {
    parentSlotId: preparation.owner.selection.slotId,
    parentName: preparation.owner.selection.name,
    createEmbeddedSource: deps.createEmbeddedSource,
    replaceDescendantsOwnedById: null,
  });
  if (result.updates.length === 0) {
    return;
  }

  try {
    await actor.updateEmbeddedDocuments("Item", result.updates);
  } catch (error) {
    if (result.createdItemIds.length === 0) {
      throw error;
    }
    try {
      await actor.deleteEmbeddedDocuments("Item", result.createdItemIds);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Failed to reconcile ${preparation.owner.selection.name} safely.`,
        {
          cause: rollbackError,
        }
      );
    }
    throw error;
  }
}

function assertStaticGrantOwnerAuthority(item: ActorItemLike, owner: StaticGrantOwnerMeta): void {
  const moduleSlotId = item.flags?.[MODULE_ID]?.slotId;
  if (typeof moduleSlotId === "string") {
    if (moduleSlotId !== owner.selection.slotId) {
      throw new Error(`Cannot reconcile ${owner.selection.name}: its planned static grant slot has changed.`);
    }
    return;
  }

  const expectedLocation = canonicalFeatLocation(owner.selection.slotId);
  const location = actorItemLocation(item);
  if (!expectedLocation || location !== expectedLocation) {
    throw new Error(`Cannot reconcile ${owner.selection.name}: its native feat-slot authority is unavailable.`);
  }
}

function canonicalFeatLocation(slotId: string): string | null {
  const match = /^(ancestry|archetype|class|general|skill)-feat-level-(\d+)$/u.exec(slotId);
  return match ? `${match[1]}-${match[2]}` : null;
}

function actorItemLocation(item: ActorItemLike): string | null {
  const location = item.system?.location;
  if (typeof location === "string") return location;
  if (location && typeof location === "object" && "value" in location && typeof location.value === "string") {
    return location.value;
  }
  return null;
}

export function stripPreselectedClassFeatureEntries(
  classSource: SelectorClassSourceLike,
  draft: DraftState,
  steps: PendingStep[]
): void {
  stripSelectedSelectorEntries(classSource, collectSelectedFeatureRefs(draft, steps));
}

function collectFeatureGroups(draft: DraftState, steps: PendingStep[]): PendingFeatureGroup[] {
  const groups = new Map<string, PendingFeatureGroup>();

  for (const step of steps) {
    if (step.kind === "pick-item" && step.grantSelection) {
      const usesNativeCreation = usesNativeGrantItemCreation(step);
      if (usesNativeCreation && !step.grantSelection.staticGrantOwner) {
        continue;
      }

      const selection = draft.selections[step.slotId];
      if (!selection) {
        continue;
      }

      const key = step.grantSelection.selectorUuid;
      const existingGroup = groups.get(key);
      const group = existingGroup ?? {
        sourceSelection: createSourceSelection(step.grantSelection, step.slotId),
        grantEntries: [],
        staticGrantOwner: step.grantSelection.staticGrantOwner ?? null,
        choiceEntries: [],
      };
      if (existingGroup) {
        group.staticGrantOwner = reconcileStaticGrantOwner(
          group.staticGrantOwner,
          step.grantSelection.staticGrantOwner ?? null,
          group.sourceSelection.name
        );
      }
      group.grantEntries.push({ step, meta: step.grantSelection, selection });
      groups.set(key, group);
      continue;
    }

    if (step.kind === "class-choice" && step.classChoice) {
      const value = draft.classChoices[step.slotId];
      if (!value) {
        continue;
      }

      const key = step.classChoice.sourceUuid;
      const existingGroup = groups.get(key);
      const group = existingGroup ?? {
        sourceSelection: createSourceSelection(step.classChoice, step.slotId),
        grantEntries: [],
        staticGrantOwner: step.classChoice.staticGrantOwner ?? null,
        choiceEntries: [],
      };
      if (existingGroup) {
        group.staticGrantOwner = reconcileStaticGrantOwner(
          group.staticGrantOwner,
          step.classChoice.staticGrantOwner ?? null,
          group.sourceSelection.name
        );
      }
      group.choiceEntries.push({ step, meta: step.classChoice, value });
      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

function hasFeatureMutations(group: PendingFeatureGroup): boolean {
  return group.choiceEntries.length > 0 || group.grantEntries.length > 0;
}

function reconcileStaticGrantOwner(
  current: StaticGrantOwnerMeta | null,
  candidate: StaticGrantOwnerMeta | null,
  sourceName: string
): StaticGrantOwnerMeta | null {
  if (!current && !candidate) return null;
  if (
    !current ||
    !candidate ||
    current.grantRuleIndex !== candidate.grantRuleIndex ||
    current.selection.uuid !== candidate.selection.uuid ||
    current.selection.slotId !== candidate.selection.slotId
  ) {
    throw new Error(`Cannot prepare ${sourceName}: its static grant ownership routes conflict.`);
  }
  return current;
}

function collectSelectedFeatureRefs(
  draft: DraftState,
  steps: PendingStep[]
): Array<{ uuid: string; documentId: string; name: string }> {
  const refs = new Map<string, { uuid: string; documentId: string; name: string }>();

  for (const step of steps) {
    if (step.kind === "pick-item" && step.grantSelection && draft.selections[step.slotId]) {
      if (usesNativeGrantItemCreation(step)) {
        continue;
      }

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

  for (const internalChoice of selectedClassArchetypeInternalChoices(draft)) {
    refs.set(internalChoice.selection.uuid, {
      uuid: internalChoice.selection.uuid,
      documentId: internalChoice.selection.documentId,
      name: internalChoice.selection.name,
    });
  }

  return Array.from(refs.values());
}

function createSourceSelection(meta: ClassGrantMeta | ClassChoiceMeta, slotId: string): SelectionRef {
  const itemType = "sourceItemType" in meta ? meta.sourceItemType : "feat";
  const featType = itemType === "feat" || itemType === "classfeature" ? "classfeature" : null;
  return buildSelectorSelection(
    slotId,
    "selectorPackId" in meta ? meta.selectorPackId : meta.sourcePackId,
    "selectorDocumentId" in meta ? meta.selectorDocumentId : meta.sourceDocumentId,
    "selectorUuid" in meta ? meta.selectorUuid : meta.sourceUuid,
    "selectorName" in meta ? meta.selectorName : meta.sourceName,
    itemType === "classfeature" ? "feat" : itemType,
    featType
  );
}
