import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import type { ActorItemLike, ActorLike, EmbeddedItemSource, LooseRecord } from "./shared/actor-model.js";
import { cloneData } from "./shared/cloning.js";
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
}

export interface SelectorApplicationPlan {
  selectorSelection: SelectionRef;
  slotId: string | null;
  ruleSelections: SelectorRuleSelection[];
  grantPlan?: SelectorGrantPlan | null;
}

interface SelectorReference {
  uuid: string;
  documentId: string;
  name: string;
}

interface SelectorRuleDocumentLike {
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
  name: string
): SelectionRef {
  return {
    slotId,
    packId,
    documentId,
    uuid,
    itemType: "feat",
    featType: "classfeature",
    name,
    level: null,
  };
}

export async function applySelectorApplication(
  actor: SelectorActorLike,
  plan: SelectorApplicationPlan,
  deps: SelectorApplicationDependencies
): Promise<void> {
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
  if (plan.grantPlan) {
    applyRuleSelections(selectorRules, [
      {
        flag: plan.grantPlan.flag,
        ruleIndex: plan.grantPlan.selectorRuleIndex,
        value: plan.grantPlan.selection.uuid,
      },
    ]);
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

  let grantedItemUpdate: Record<string, unknown> | null = null;
  if (plan.grantPlan) {
    selectorUpdate[`flags.pf2e.rulesSelections.${plan.grantPlan.flag}`] = plan.grantPlan.selection.uuid;
    const grantedItemResult = await ensureGrantedItem(actor, selectorItem, plan.grantPlan, deps.createEmbeddedSource);
    if (grantedItemResult.item?.id) {
      selectorUpdate[`flags.pf2e.itemGrants.${plan.grantPlan.flag}`] = {
        id: grantedItemResult.item.id,
        onDelete: "detach",
        nested: null,
      };
    }
    if (
      grantedItemResult.reusedExistingItem &&
      grantedItemResult.update &&
      plan.grantPlan.updateExistingGrantImmediately
    ) {
      await actor.updateEmbeddedDocuments("Item", [grantedItemResult.update]);
    } else {
      grantedItemUpdate = grantedItemResult.update;
    }
  }

  const updates = grantedItemUpdate ? [selectorUpdate, grantedItemUpdate] : [selectorUpdate];
  await actor.updateEmbeddedDocuments("Item", updates);
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
        typeof uuid === "string"
          ? /^Compendium\.[^.]+\.[^.]+\.Item\.(.+)$/.exec(uuid)?.[1]?.trim().toLowerCase()
          : null;
      const normalizedName = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : null;

      return !(
        (uuid && selectedUuids.has(uuid)) ||
        (normalizedDocumentId && selectedDocumentIds.has(normalizedDocumentId)) ||
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
  selectorSource.system.rules = cloneData(
    Array.isArray(selectorSource.system.rules) ? selectorSource.system.rules : []
  );

  applyRuleSelections(selectorSource.system.rules, plan.ruleSelections);
  if (plan.grantPlan) {
    applyRuleSelections(selectorSource.system.rules, [
      {
        flag: plan.grantPlan.flag,
        ruleIndex: plan.grantPlan.selectorRuleIndex,
        value: plan.grantPlan.selection.uuid,
      },
    ]);
    selectorSource.system.rules = pruneGrantRules(selectorSource.system.rules, plan.grantPlan.createRulePolicy);
  }

  selectorSource.flags ??= {};
  selectorSource.flags.pf2e ??= {};
  selectorSource.flags.pf2e.rulesSelections ??= {};

  for (const selection of plan.ruleSelections) {
    selectorSource.flags.pf2e.rulesSelections[selection.flag] = selection.value;
  }
  if (plan.grantPlan) {
    selectorSource.flags.pf2e.rulesSelections[plan.grantPlan.flag] = plan.grantPlan.selection.uuid;
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

function pruneGrantRules(rules: LooseRecord[], policy: SelectorGrantPlan["createRulePolicy"]): LooseRecord[] {
  if (policy === "remove-all-grant-items") {
    return rules.filter((rule) => rule?.key !== "GrantItem");
  }
  if (Array.isArray(policy) && policy.length > 0) {
    const blockedIndexes = new Set(policy);
    return rules.filter((_rule, index) => !blockedIndexes.has(index));
  }
  return rules;
}

async function ensureGrantedItem(
  actor: SelectorActorLike,
  selectorItem: SelectorItemLike,
  grantPlan: SelectorGrantPlan,
  createEmbeddedSource: SelectorApplicationDependencies["createEmbeddedSource"]
): Promise<{ item: SelectorItemLike | null; update: Record<string, unknown> | null; reusedExistingItem: boolean }> {
  const selectorItemId = typeof selectorItem.id === "string" ? selectorItem.id : null;
  if (!selectorItemId) {
    return { item: null, update: null, reusedExistingItem: false };
  }

  const existingGranted =
    (listActorItems(actor) as SelectorItemLike[]).find((item) => item?.flags?.pf2e?.grantedBy?.id === selectorItemId) ??
    null;
  const existingGrantedId = typeof existingGranted?.id === "string" ? existingGranted.id : null;
  if (existingGranted && !existingGrantedId) {
    return { item: null, update: null, reusedExistingItem: false };
  }
  const existingMatches = existingGranted && itemMatchesSourceId(existingGranted, grantPlan.selection.uuid);
  if (existingGranted && !existingMatches) {
    if (!existingGrantedId) {
      return { item: null, update: null, reusedExistingItem: false };
    }
    await actor.deleteEmbeddedDocuments("Item", [existingGrantedId]);
  }

  if (existingMatches) {
    return {
      item: existingGranted,
      update: buildGrantedItemUpdate(existingGrantedId!, selectorItemId, grantPlan),
      reusedExistingItem: true,
    };
  }

  const source = await createEmbeddedSource(grantPlan.selection);
  if (!source) {
    return { item: null, update: null, reusedExistingItem: false };
  }

  source.flags ??= {};
  source.flags.core ??= {};
  source.flags.core.sourceId ??= grantPlan.selection.uuid;
  source.flags.pf2e ??= {};
  source.flags.pf2e.grantedBy = {
    id: selectorItemId,
    onDelete: "cascade",
  };
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    importedBy: MODULE_ID,
    slotId: grantPlan.slotId,
  };

  const created = await actor.createEmbeddedDocuments("Item", [source]);
  const createdItem = Array.isArray(created) ? ((created[0] as SelectorItemLike | undefined) ?? null) : null;
  if (!createdItem?.id) {
    return { item: createdItem, update: null, reusedExistingItem: false };
  }

  return {
    item: createdItem,
    update: grantPlan.updateCreatedGrant ? buildGrantedItemUpdate(createdItem.id, selectorItemId, grantPlan) : null,
    reusedExistingItem: false,
  };
}

function buildGrantedItemUpdate(
  itemId: string,
  selectorItemId: string,
  grantPlan: SelectorGrantPlan
): Record<string, unknown> {
  return {
    _id: itemId,
    "flags.core.sourceId": grantPlan.selection.uuid,
    "flags.pf2e.grantedBy": {
      id: selectorItemId,
      onDelete: "cascade",
    },
    [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
    [`flags.${MODULE_ID}.slotId`]: grantPlan.slotId,
  };
}
