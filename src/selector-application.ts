import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import type { ActorItemLike, ActorLike, EmbeddedItemSource, LooseRecord } from "./shared/actor-model.js";
import { cloneData } from "./shared/cloning.js";
import { parseCompendiumItemUuid } from "./shared/compendium.js";
import {
  applyRuleSelectionToSource,
  buildGrantedItemUpdate as buildGrantedItemSourceUpdate,
  buildItemGrantRecord,
  stampGrantedItemSource,
} from "./shared/pf2e-item-source.js";
import { itemMatchesSourceId } from "./shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "./types.js";

export interface SelectorApplicationDependencies {
  createEmbeddedSource: (
    selection: SelectionRef,
    draft?: DraftState,
    steps?: PendingStep[]
  ) => Promise<EmbeddedItemSource | null>;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<SelectorRuleDocumentLike | null>;
}

export interface SelectorRuleSelection {
  flag: string;
  ruleIndex: number;
  value: string;
}

export interface SelectorGrantPlan {
  flag: string;
  slotId: string;
  selection: SelectionRef;
  selectorRuleIndex: number;
  createRulePolicy: "remove-all-grant-items" | number[] | null;
  updateCreatedGrant?: boolean;
  updateExistingGrantImmediately?: boolean;
  adoptExistingSource?: boolean;
}

export interface SelectorApplicationPlan {
  selectorSelection: SelectionRef;
  slotId: string | null;
  ruleSelections: SelectorRuleSelection[];
  grantPlan?: SelectorGrantPlan | null;
  grantPlans?: SelectorGrantPlan[];
  omitSelectedRulesOnCreate?: boolean;
}

interface SelectorReference {
  uuid: string;
  documentId: string;
  name: string;
}

export interface SelectorRuleDocumentLike {
  system?: {
    rules?: LooseRecord[];
  };
}

interface SelectorClassSourceEntry {
  uuid?: unknown;
  name?: unknown;
}

export interface SelectorClassSourceLike extends EmbeddedItemSource {
  system?: EmbeddedItemSource["system"] & {
    items?: Record<string, SelectorClassSourceEntry>;
  };
}

type SelectorItemLike = ActorItemLike;
export type SelectorActorLike = ActorLike & {
  createEmbeddedDocuments: NonNullable<ActorLike["createEmbeddedDocuments"]>;
  deleteEmbeddedDocuments: NonNullable<ActorLike["deleteEmbeddedDocuments"]>;
  updateEmbeddedDocuments: NonNullable<ActorLike["updateEmbeddedDocuments"]>;
};

export function buildSelectorSelection(
  slotId: string,
  packId: string,
  documentId: string,
  uuid: string,
  name: string,
  itemType = "feat",
  featType: string | null = "classfeature"
): SelectionRef {
  return {
    slotId,
    packId,
    documentId,
    uuid,
    itemType,
    featType,
    name,
    level: null,
  };
}

export async function applySelectorApplication(
  actor: SelectorActorLike,
  plan: SelectorApplicationPlan,
  deps: SelectorApplicationDependencies
): Promise<void> {
  const grantPlans = normalizeGrantPlans(plan);
  let selectorItem = findSelectorItemBySourceId(actor, plan.selectorSelection.uuid);
  const createdSelector = !selectorItem?.id;
  if (!selectorItem?.id) {
    selectorItem = await createSelectorItem(actor, plan, deps.createEmbeddedSource);
  }

  if (!selectorItem?.id) {
    return;
  }

  const selectorRules = await loadSelectorRules(selectorItem, plan.selectorSelection, createdSelector, deps);
  applyRuleSelections(selectorRules, plan.ruleSelections);
  if (grantPlans.length > 0) {
    applyRuleSelections(
      selectorRules,
      grantPlans.map((grantPlan) => ({
        flag: grantPlan.flag,
        ruleIndex: grantPlan.selectorRuleIndex,
        value: grantPlan.selection.uuid,
      }))
    );
  }

  const selectorUpdate: Record<string, unknown> = {
    _id: selectorItem.id,
    "system.rules": selectorRules,
  };
  if (plan.slotId) {
    selectorUpdate[`flags.${MODULE_ID}.slotId`] = plan.slotId;
  }

  for (const selection of plan.ruleSelections) {
    selectorUpdate[`flags.pf2e.rulesSelections.${selection.flag}`] = selection.value;
  }

  for (const grantPlan of grantPlans) {
    selectorUpdate[`flags.pf2e.rulesSelections.${grantPlan.flag}`] = grantPlan.selection.uuid;
  }

  const grantedItemUpdates: Record<string, unknown>[] = [];
  const createdItemIds: string[] = [];
  const replacedItemIds: string[] = [];
  const selectorRollback = !createdSelector ? buildSelectorRollbackUpdate(selectorItem, plan, grantPlans) : null;
  let selectorWasUpdated = false;
  try {
    if (grantPlans.length > 0 && !createdSelector) {
      // Existing actor-owned ChoiceSet sources must persist their selection before any granted item is created,
      // otherwise PF2E can still surface the native prompt during the grant creation update.
      await actor.updateEmbeddedDocuments("Item", [cloneData(selectorUpdate)]);
      selectorWasUpdated = true;
    }

    for (const grantPlan of grantPlans) {
      const grantedItemResult = await ensureGrantedItem(actor, selectorItem, grantPlan, deps.createEmbeddedSource);
      createdItemIds.push(...grantedItemResult.createdItemIds);
      if (grantedItemResult.replacedItemId) {
        replacedItemIds.push(grantedItemResult.replacedItemId);
      }
      if (grantedItemResult.item?.id) {
        selectorUpdate[`flags.pf2e.itemGrants.${grantPlan.flag}`] = buildItemGrantRecord(grantedItemResult.item.id, {
          nested: null,
        });
      }
      if (grantedItemResult.update) {
        grantedItemUpdates.push(grantedItemResult.update);
      }
      grantedItemUpdates.push(...grantedItemResult.supplementalUpdates);
    }

    const updates = [selectorUpdate, ...grantedItemUpdates];
    await actor.updateEmbeddedDocuments("Item", updates);
    selectorWasUpdated = true;
    if (replacedItemIds.length > 0) {
      await actor.deleteEmbeddedDocuments("Item", Array.from(new Set(replacedItemIds)));
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (selectorWasUpdated && selectorRollback) {
      try {
        await actor.updateEmbeddedDocuments("Item", [selectorRollback]);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    const rollbackIds = Array.from(new Set([...createdItemIds, ...(createdSelector ? [selectorItem.id] : [])]));
    if (rollbackIds.length > 0) {
      try {
        await actor.deleteEmbeddedDocuments("Item", rollbackIds);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Failed to roll back selector application safely.", {
        cause: error,
      });
    }
    throw error;
  }
}

function buildSelectorRollbackUpdate(
  selectorItem: SelectorItemLike,
  plan: SelectorApplicationPlan,
  grantPlans: SelectorGrantPlan[]
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    _id: selectorItem.id,
    "system.rules": cloneData(Array.isArray(selectorItem.system?.rules) ? selectorItem.system.rules : []),
  };
  const rulesSelections = selectorItem.flags?.pf2e?.rulesSelections ?? {};
  const itemGrants = selectorItem.flags?.pf2e?.itemGrants ?? {};
  for (const flag of new Set([
    ...plan.ruleSelections.map((selection) => selection.flag),
    ...grantPlans.map((grant) => grant.flag),
  ])) {
    if (Object.hasOwn(rulesSelections, flag)) {
      update[`flags.pf2e.rulesSelections.${flag}`] = cloneData(rulesSelections[flag]);
    } else {
      update[`flags.pf2e.rulesSelections.-=${flag}`] = null;
    }
  }
  for (const grantPlan of grantPlans) {
    if (Object.hasOwn(itemGrants, grantPlan.flag)) {
      update[`flags.pf2e.itemGrants.${grantPlan.flag}`] = cloneData(itemGrants[grantPlan.flag]);
    } else {
      update[`flags.pf2e.itemGrants.-=${grantPlan.flag}`] = null;
    }
  }
  const previousSlotId = selectorItem.flags?.[MODULE_ID]?.slotId;
  if (typeof previousSlotId === "string") {
    update[`flags.${MODULE_ID}.slotId`] = previousSlotId;
  } else if (plan.slotId) {
    update[`flags.${MODULE_ID}.-=slotId`] = null;
  }
  return update;
}

export function stripSelectedSelectorEntries(
  classSource: SelectorClassSourceLike,
  selectedRefs: SelectorReference[]
): void {
  if (selectedRefs.length === 0 || !classSource?.system?.items || typeof classSource.system.items !== "object") {
    return;
  }

  const selectedUuids = new Set(
    selectedRefs
      .map((entry) => entry.uuid)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const selectedDocumentIds = new Set(
    selectedRefs
      .map((entry) => entry.documentId.trim().toLowerCase())
      .filter((value): value is string => value.length > 0)
  );
  const selectedNames = new Set(
    selectedRefs.map((entry) => entry.name.trim().toLowerCase()).filter((value): value is string => value.length > 0)
  );

  classSource.system.items = Object.fromEntries(
    Object.entries(classSource.system.items).filter(([, entry]: [string, SelectorClassSourceEntry]) => {
      const uuid = typeof entry?.uuid === "string" ? entry.uuid : null;
      const normalizedDocumentId =
        typeof uuid === "string" ? parseCompendiumItemUuid(uuid)?.documentId.trim().toLowerCase() : null;
      const normalizedName = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : null;

      return !(
        (uuid && selectedUuids.has(uuid)) ||
        (normalizedDocumentId && selectedDocumentIds.has(normalizedDocumentId)) ||
        (normalizedDocumentId && selectedNames.has(normalizedDocumentId)) ||
        (normalizedName && selectedNames.has(normalizedName))
      );
    })
  );
}

function findSelectorItemBySourceId(actor: SelectorActorLike, sourceId: string): SelectorItemLike | null {
  return (listActorItems(actor) as SelectorItemLike[]).find((item) => itemMatchesSourceId(item, sourceId)) ?? null;
}

async function createSelectorItem(
  actor: SelectorActorLike,
  plan: SelectorApplicationPlan,
  createEmbeddedSource: SelectorApplicationDependencies["createEmbeddedSource"]
): Promise<SelectorItemLike | null> {
  const selectorSource = await createEmbeddedSource(plan.selectorSelection);
  if (!selectorSource) {
    return null;
  }

  selectorSource.system ??= {};
  const selectorRules = cloneData(Array.isArray(selectorSource.system.rules) ? selectorSource.system.rules : []);

  const initialSelections = [...plan.ruleSelections];
  const grantPlans = normalizeGrantPlans(plan);
  for (const grantPlan of grantPlans) {
    initialSelections.push({
      flag: grantPlan.flag,
      ruleIndex: grantPlan.selectorRuleIndex,
      value: grantPlan.selection.uuid,
    });
  }
  applyRuleSelections(selectorRules, initialSelections);
  selectorSource.system.rules = pruneCreationRules(
    selectorRules,
    plan.omitSelectedRulesOnCreate ? new Set(initialSelections.map((selection) => selection.ruleIndex)) : new Set(),
    combineCreateRulePolicies(grantPlans)
  );

  selectorSource.flags ??= {};
  selectorSource.flags.pf2e ??= {};
  selectorSource.flags.pf2e.rulesSelections ??= {};

  for (const selection of plan.ruleSelections) {
    selectorSource.flags.pf2e.rulesSelections[selection.flag] = selection.value;
  }
  for (const grantPlan of grantPlans) {
    selectorSource.flags.pf2e.rulesSelections[grantPlan.flag] = grantPlan.selection.uuid;
  }

  selectorSource.flags[MODULE_ID] = {
    ...(selectorSource.flags[MODULE_ID] ?? {}),
    importedBy: MODULE_ID,
    ...(plan.slotId ? { slotId: plan.slotId } : {}),
  };

  const classItem = (listActorItems(actor) as SelectorItemLike[]).find((item) => item?.type === "class");
  if (classItem?.id) {
    selectorSource.system.location = classItem.id;
  }

  const created = await actor.createEmbeddedDocuments("Item", [selectorSource]);
  return Array.isArray(created) ? ((created[0] as SelectorItemLike | undefined) ?? null) : null;
}

function normalizeGrantPlans(plan: SelectorApplicationPlan): SelectorGrantPlan[] {
  return [...(plan.grantPlan ? [plan.grantPlan] : []), ...(plan.grantPlans ?? [])];
}

function combineCreateRulePolicies(grantPlans: SelectorGrantPlan[]): SelectorGrantPlan["createRulePolicy"] {
  if (grantPlans.some((grantPlan) => grantPlan.createRulePolicy === "remove-all-grant-items")) {
    return "remove-all-grant-items";
  }

  const blockedIndexes = grantPlans.flatMap((grantPlan) =>
    Array.isArray(grantPlan.createRulePolicy) ? grantPlan.createRulePolicy : []
  );
  return blockedIndexes.length > 0 ? blockedIndexes : null;
}

async function loadSelectorRules(
  selectorItem: SelectorItemLike,
  selectorSelection: SelectionRef,
  createdSelector: boolean,
  deps: SelectorApplicationDependencies
): Promise<LooseRecord[]> {
  const selectorDocument = createdSelector ? await deps.fetchSelectionDocument(selectorSelection) : null;
  if (Array.isArray(selectorDocument?.system?.rules)) {
    return cloneData(selectorDocument.system.rules);
  }
  if (Array.isArray(selectorItem.system?.rules)) {
    return cloneData(selectorItem.system.rules);
  }
  return [];
}

function applyRuleSelections(rules: LooseRecord[], selections: SelectorRuleSelection[]): void {
  for (const selection of selections) {
    const rule = rules[selection.ruleIndex];
    if (rule) {
      rule.selection = selection.value;
    }
  }
}

function pruneCreationRules(
  rules: LooseRecord[],
  selectedRuleIndexes: Set<number>,
  policy: SelectorGrantPlan["createRulePolicy"]
): LooseRecord[] {
  const blockedGrantIndexes = Array.isArray(policy) ? new Set(policy) : null;
  return rules.filter((rule, index) => {
    if (selectedRuleIndexes.has(index)) {
      return false;
    }
    if (policy === "remove-all-grant-items" && rule?.key === "GrantItem") {
      return false;
    }
    if (blockedGrantIndexes?.has(index)) {
      return false;
    }
    return true;
  });
}

async function ensureGrantedItem(
  actor: SelectorActorLike,
  selectorItem: SelectorItemLike,
  grantPlan: SelectorGrantPlan,
  createEmbeddedSource: SelectorApplicationDependencies["createEmbeddedSource"]
): Promise<{
  item: SelectorItemLike;
  update: Record<string, unknown> | null;
  createdItemIds: string[];
  replacedItemId: string | null;
  supplementalUpdates: Record<string, unknown>[];
}> {
  const selectorItemId = typeof selectorItem.id === "string" ? selectorItem.id : null;
  if (!selectorItemId) {
    throw new Error("Cannot create a selector grant without a persisted selector item.");
  }

  const existingGranted = findGrantedItemForPlan(actor, selectorItem, grantPlan);
  const existingGrantedId = typeof existingGranted?.id === "string" ? existingGranted.id : null;
  if (existingGranted && !existingGrantedId) {
    throw new Error(`Cannot replace ${grantPlan.selection.name}: the existing grant has no document ID.`);
  }
  const existingMatches = existingGranted && itemMatchesSourceId(existingGranted, grantPlan.selection.uuid);
  if (existingMatches) {
    let manualPreparation: ManualStaticGrantPreparation = { createdItemIds: [], updates: [] };
    if (grantPlan.adoptExistingSource) {
      const refreshedSource = await createEmbeddedSource(grantPlan.selection);
      manualPreparation = await createManualStaticGrantedItems(
        actor,
        existingGranted,
        refreshedSource ?? (existingGranted as EmbeddedItemSource),
        grantPlan,
        createEmbeddedSource,
        null
      );
    }
    return {
      item: existingGranted,
      update: buildGrantedItemUpdate(existingGrantedId!, selectorItemId, grantPlan),
      createdItemIds: manualPreparation.createdItemIds,
      replacedItemId: null,
      supplementalUpdates: manualPreparation.updates,
    };
  }

  const source = await createEmbeddedSource(grantPlan.selection);
  if (!source) {
    throw new Error(`Cannot create ${grantPlan.selection.name}: its source document is unavailable.`);
  }

  stampGrantedItemSource(source, {
    sourceId: grantPlan.selection.uuid,
    slotId: grantPlan.slotId,
    granterId: selectorItemId,
  });

  assertResolvedUnconditionalChoiceSets(source, grantPlan.selection.name);
  const created = await actor.createEmbeddedDocuments("Item", [source]);
  const createdItem = Array.isArray(created) ? ((created[0] as SelectorItemLike | undefined) ?? null) : null;
  if (!createdItem?.id) {
    throw new Error(`Cannot create ${grantPlan.selection.name}: Foundry returned no created item.`);
  }
  try {
    const manualPreparation = await createManualStaticGrantedItems(
      actor,
      createdItem,
      source,
      grantPlan,
      createEmbeddedSource,
      existingGrantedId
    );
    return {
      item: createdItem,
      update: grantPlan.updateCreatedGrant ? buildGrantedItemUpdate(createdItem.id, selectorItemId, grantPlan) : null,
      createdItemIds: [createdItem.id, ...manualPreparation.createdItemIds],
      replacedItemId: existingGrantedId,
      supplementalUpdates: manualPreparation.updates,
    };
  } catch (error) {
    try {
      await actor.deleteEmbeddedDocuments("Item", [createdItem.id]);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Failed to replace ${grantPlan.selection.name} safely.`, {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

function assertResolvedUnconditionalChoiceSets(source: EmbeddedItemSource, sourceName: string): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  const selections = source.flags?.pf2e?.rulesSelections ?? {};
  for (const [ruleIndex, rule] of rules.entries()) {
    if (rule?.key !== "ChoiceSet" || !isUnconditionalPredicate(rule.predicate)) {
      continue;
    }

    const flag = typeof rule.flag === "string" && rule.flag.length > 0 ? rule.flag : null;
    const resolvedByRule = typeof rule.selection === "string" && rule.selection.length > 0;
    const resolvedByFlag = flag && typeof selections[flag] === "string" && selections[flag].length > 0;
    if (!resolvedByRule && !resolvedByFlag) {
      throw new Error(
        `Cannot create ${sourceName}: unresolved unconditional ChoiceSet ${flag ? `"${flag}"` : `at rule ${ruleIndex}`}.`
      );
    }
  }
}

function isUnconditionalPredicate(predicate: unknown): boolean {
  return predicate === undefined || (Array.isArray(predicate) && predicate.length === 0);
}

async function createManualStaticGrantedItems(
  actor: SelectorActorLike,
  granter: SelectorItemLike,
  granterSource: EmbeddedItemSource,
  grantPlan: SelectorGrantPlan,
  createEmbeddedSource: SelectorApplicationDependencies["createEmbeddedSource"],
  replaceDescendantsOwnedById: string | null
): Promise<ManualStaticGrantPreparation> {
  const granterId = typeof granter.id === "string" ? granter.id : null;
  if (!granterId) {
    return { createdItemIds: [], updates: [] };
  }

  const grants = readManualStaticItemGrants(granterSource);
  if (grants.length === 0) {
    return { createdItemIds: [], updates: [] };
  }

  const actorItems = listActorItems(actor) as SelectorItemLike[];
  const granterUpdate: Record<string, unknown> = {
    _id: granterId,
  };
  const createdItemIds: string[] = [];

  try {
    for (const grant of grants) {
      if (
        actorItems.some(
          (item) =>
            itemMatchesSourceId(item, grant.uuid) && item.flags?.pf2e?.grantedBy?.id !== replaceDescendantsOwnedById
        )
      ) {
        continue;
      }

      const selection = selectionFromManualStaticGrant(grant, grantPlan.slotId);
      if (!selection) {
        throw new Error(`Cannot create a static child for ${grantPlan.selection.name}: invalid UUID ${grant.uuid}.`);
      }

      const source = await createEmbeddedSource(selection);
      if (!source) {
        throw new Error(`Cannot create a static child for ${grantPlan.selection.name}: ${grant.uuid} is unavailable.`);
      }

      applyManualChoiceSelections(source, grant.choices);
      stampGrantedItemSource(source, {
        sourceId: grant.uuid,
        slotId: selection.slotId,
        granterId,
      });

      const created = await actor.createEmbeddedDocuments("Item", [source]);
      const createdItem = Array.isArray(created) ? ((created[0] as SelectorItemLike | undefined) ?? null) : null;
      if (!createdItem?.id) {
        throw new Error(`Cannot create a static child for ${grantPlan.selection.name}: Foundry returned no item.`);
      }
      createdItemIds.push(createdItem.id);
      granterUpdate[`flags.pf2e.itemGrants.${grant.key}`] = buildItemGrantRecord(createdItem.id);
    }

    return {
      createdItemIds,
      updates: Object.keys(granterUpdate).length > 1 ? [granterUpdate] : [],
    };
  } catch (error) {
    if (createdItemIds.length > 0) {
      try {
        await actor.deleteEmbeddedDocuments("Item", createdItemIds);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Failed to create ${grantPlan.selection.name} safely.`, {
          cause: rollbackError,
        });
      }
    }
    throw error;
  }
}

interface ManualStaticGrantPreparation {
  createdItemIds: string[];
  updates: Record<string, unknown>[];
}

function applyManualChoiceSelections(source: EmbeddedItemSource, choices: Record<string, string>): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  for (const [flag, value] of Object.entries(choices)) {
    const ruleIndex = rules.findIndex(
      (rule) =>
        rule &&
        typeof rule === "object" &&
        !Array.isArray(rule) &&
        rule.key === "ChoiceSet" &&
        (rule.flag === flag || typeof rule.flag !== "string")
    );
    const rule = rules[ruleIndex];
    if (ruleIndex >= 0 && rule && typeof rule === "object" && !Array.isArray(rule)) {
      rule.flag = flag;
      applyRuleSelectionToSource(source, ruleIndex, flag, value);
    }
  }
}

export function readManualStaticItemGrants(source: EmbeddedItemSource): Array<{
  key: string;
  uuid: string;
  choices: Record<string, string>;
}> {
  const grants = source.flags?.[MODULE_ID]?.manualStaticItemGrants;
  if (!Array.isArray(grants)) {
    return [];
  }

  return grants.flatMap((grant) => {
    if (
      !grant ||
      typeof grant !== "object" ||
      Array.isArray(grant) ||
      typeof grant.key !== "string" ||
      typeof grant.uuid !== "string" ||
      !grant.choices ||
      typeof grant.choices !== "object" ||
      Array.isArray(grant.choices)
    ) {
      return [];
    }

    return [
      {
        key: grant.key,
        uuid: grant.uuid,
        choices: Object.fromEntries(
          Object.entries(grant.choices).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        ),
      },
    ];
  });
}

export function selectionFromManualStaticGrant(
  grant: { key: string; uuid: string },
  parentSlotId: string
): SelectionRef | null {
  const parsed = parseCompendiumItemUuid(grant.uuid);
  if (!parsed) {
    return null;
  }

  return {
    slotId: `${parentSlotId}-${grant.key}`,
    packId: parsed.packId,
    documentId: parsed.documentId,
    uuid: grant.uuid,
    itemType: itemTypeFromPackId(parsed.packId),
    featType: parsed.packId === "pf2e.classfeatures" ? "classfeature" : null,
    name: parsed.documentId,
    level: null,
  };
}

function itemTypeFromPackId(packId: string): string {
  switch (packId) {
    case "pf2e.actionspf2e":
      return "action";
    case "pf2e.equipment-srd":
      return "equipment";
    case "pf2e.deities":
      return "deity";
    default:
      return "feat";
  }
}

function findGrantedItemForPlan(
  actor: SelectorActorLike,
  selectorItem: SelectorItemLike,
  grantPlan: SelectorGrantPlan
): SelectorItemLike | null {
  const selectorItemId = typeof selectorItem.id === "string" ? selectorItem.id : null;
  if (!selectorItemId) {
    return null;
  }

  const items = listActorItems(actor) as SelectorItemLike[];
  const itemGrantId = itemGrantIdForFlag(selectorItem, grantPlan.flag);
  if (itemGrantId) {
    const linkedItem = items.find((item) => item?.id === itemGrantId) ?? null;
    if (linkedItem) {
      return linkedItem;
    }
  }

  const matchingSource = items.find(
    (item) => item?.flags?.pf2e?.grantedBy?.id === selectorItemId && itemMatchesSourceId(item, grantPlan.selection.uuid)
  );
  if (matchingSource) {
    return matchingSource;
  }

  if (grantPlan.adoptExistingSource) {
    const adoptableSource = items.find((item) => itemMatchesSourceId(item, grantPlan.selection.uuid));
    if (adoptableSource) {
      return adoptableSource;
    }
  }

  return (
    items.find(
      (item) =>
        item?.flags?.pf2e?.grantedBy?.id === selectorItemId && item?.flags?.[MODULE_ID]?.slotId === grantPlan.slotId
    ) ?? null
  );
}

function itemGrantIdForFlag(selectorItem: SelectorItemLike, flag: string): string | null {
  const grants = selectorItem.flags?.pf2e?.itemGrants;
  if (!grants || typeof grants !== "object") {
    return null;
  }

  const grant = (grants as Record<string, { id?: unknown }>)[flag];
  return typeof grant?.id === "string" && grant.id.length > 0 ? grant.id : null;
}

function buildGrantedItemUpdate(
  itemId: string,
  selectorItemId: string,
  grantPlan: SelectorGrantPlan
): Record<string, unknown> {
  return buildGrantedItemSourceUpdate(itemId, {
    sourceId: grantPlan.selection.uuid,
    slotId: grantPlan.slotId,
    granterId: selectorItemId,
  });
}
