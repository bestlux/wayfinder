import { listActorItems } from "../build-state.js";
import { stripPreselectedClassBranchEntries } from "../class-branch-service.js";
import { stripPreselectedClassFeatureEntries } from "../class-feature-choice-service.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack-service.js";
import type {
  ActorItemLike,
  ActorLike,
  EmbeddedItemSource,
  FeatSlotLike,
  LooseRecord,
  SelectionDocumentLike,
} from "../shared/actor-model.js";
import { extractDocumentSlug, slugifyName } from "../shared/slug.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";

const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);

interface CreateEmbeddedSourceDependencies {
  fetchSelectionDocument: (selection: SelectionRef) => Promise<SelectionDocumentLike | null>;
  stripPreselectedClassFeatureEntries: (source: EmbeddedItemSource, draft: DraftState, steps: PendingStep[]) => void;
  stripPreselectedClassBranchEntries: (source: EmbeddedItemSource, draft: DraftState, steps: PendingStep[]) => void;
}

interface InsertFeatSelectionDependencies {
  fetchSelectionDocument: (selection: SelectionRef) => Promise<SelectionDocumentLike | null>;
  createEmbeddedSource: (
    selection: SelectionRef,
    draft?: DraftState,
    steps?: PendingStep[]
  ) => Promise<EmbeddedItemSource | null>;
}

const DEFAULT_CREATE_DEPS: CreateEmbeddedSourceDependencies = {
  fetchSelectionDocument,
  stripPreselectedClassFeatureEntries,
  stripPreselectedClassBranchEntries,
};

const DEFAULT_INSERT_DEPS: InsertFeatSelectionDependencies = {
  fetchSelectionDocument,
  createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};

export async function replaceSingletonItem(
  actor: ActorLike,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies = DEFAULT_CREATE_DEPS
): Promise<void> {
  const existing = (listActorItems(actor) as ActorItemLike[]).filter((item) => item?.type === selection.itemType);
  const existingIds = existing.map((item) => item.id).filter((id): id is string => typeof id === "string");
  if (existingIds.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
    await actor.deleteEmbeddedDocuments("Item", existingIds);
  }

  const source = await createEmbeddedSource(selection, draft, steps, deps);
  if (source && typeof actor.createEmbeddedDocuments === "function") {
    await actor.createEmbeddedDocuments("Item", [source]);
  }
}

export async function createEmbeddedSource(
  selection: SelectionRef,
  draft?: DraftState,
  steps: PendingStep[] = [],
  deps: CreateEmbeddedSourceDependencies = DEFAULT_CREATE_DEPS
): Promise<EmbeddedItemSource | null> {
  const document = await deps.fetchSelectionDocument(selection);
  if (!document) {
    return null;
  }

  const source = document.toObject();
  if (selection.itemType === "class" && draft) {
    deps.stripPreselectedClassFeatureEntries(source, draft, steps);
    deps.stripPreselectedClassBranchEntries(source, draft, steps);
  }
  if (draft && SINGLETON_ITEM_TYPES.has(selection.itemType)) {
    applyPendingSingletonChoices(source, selection, draft, steps);
    applyPendingGrantChoiceSelections(source, selection, draft, steps);
    applyPendingTrainingSelections(source, selection, draft, steps);
  }
  if (draft && selection.itemType === "feat") {
    await applyPendingFeatSpellChoices(source, selection, draft, steps, deps);
  }

  delete source._id;
  source._stats ??= {};
  source._stats.compendiumSource = selection.uuid;
  source.flags ??= {};
  source.flags.core ??= {};
  source.flags.core.sourceId = selection.uuid;
  source.flags[MODULE_ID] = {
    importedBy: MODULE_ID,
    slotId: selection.slotId,
  };
  return source;
}

function applyPendingSingletonChoices(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[]
): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  for (const step of steps) {
    if (
      step.kind !== "singleton-choice" ||
      !step.singletonChoice ||
      step.singletonChoice.sourceUuid !== selection.uuid
    ) {
      continue;
    }

    const value = draft.singletonChoices[step.slotId];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    applyRuleSelection(source, step.singletonChoice.sourceRuleIndex, step.singletonChoice.flag, value);
  }
}

function applyPendingTrainingSelections(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[]
): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  for (const step of steps) {
    if (step.kind !== "skill-training" || !step.training) {
      continue;
    }

    const training = draft.skillTrainings[step.slotId];
    if (!training) {
      continue;
    }

    for (const choiceRule of step.training.choiceRules) {
      const choice = training.ruleChoices[choiceRule.key];
      if (choice) {
        applyTrainingRuleSelection(source, selection, choiceRule.persistence, choiceRule.flag, choice);
      }
    }

    for (const loreChoice of step.training.loreChoices) {
      const choice = training.loreChoices[loreChoice.key];
      if (choice) {
        applyTrainingRuleSelection(source, selection, loreChoice.persistence, loreChoice.flag, choice);
      }
    }
  }
}

function applyTrainingRuleSelection(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  persistence: { sourceUuid: string; sourceRuleIndex: number } | null,
  flag: string,
  value: string
): void {
  if (!persistence || persistence.sourceUuid !== selection.uuid) {
    return;
  }

  applyRuleSelection(source, persistence.sourceRuleIndex, flag, value);
}

function applyRuleSelection(source: EmbeddedItemSource, sourceRuleIndex: number, flag: string, value: string): void {
  const rules = Array.isArray(source.system?.rules) ? (source.system.rules as LooseRecord[]) : [];
  if (rules[sourceRuleIndex]) {
    rules[sourceRuleIndex].selection = value;
  }

  source.flags ??= {};
  source.flags.pf2e ??= {};
  source.flags.pf2e.rulesSelections ??= {};
  source.flags.pf2e.rulesSelections[flag] = value;
}

function applyPendingGrantChoiceSelections(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[]
): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  source.flags ??= {};
  source.flags.pf2e ??= {};
  source.flags.pf2e.rulesSelections ??= {};

  for (const step of steps) {
    if (step.kind !== "pick-item" || !step.grantSelection || step.grantSelection.selectorUuid !== selection.uuid) {
      continue;
    }

    const grantedSelection = draft.selections[step.slotId];
    if (!grantedSelection) {
      continue;
    }

    const rule = rules[step.grantSelection.selectorRuleIndex];
    if (rule && typeof rule === "object") {
      (rule as Record<string, unknown>).selection = grantedSelection.uuid;
    }

    source.flags.pf2e.rulesSelections[step.grantSelection.flag] = grantedSelection.uuid;
  }
}

export async function insertFeatSelection(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null,
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS,
  draft?: DraftState,
  steps: PendingStep[] = []
): Promise<void> {
  const document = await deps.fetchSelectionDocument(selection);
  if (!document) {
    return;
  }

  const slotData = resolveFeatSlotData(actor, selection, step);
  const source = await deps.createEmbeddedSource(selection, draft, steps);
  if (typeof actor?.feats?.insertFeat === "function") {
    const inserted = await actor.feats.insertFeat(source ? withEmbeddedSource(document, source) : document, slotData);
    await stampSelectionFlags(actor, inserted, selection);
    return;
  }

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

  if (typeof actor.createEmbeddedDocuments === "function") {
    await actor.createEmbeddedDocuments("Item", [source]);
  }
}

async function applyPendingFeatSpellChoices(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies
): Promise<void> {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  for (const step of steps) {
    if (step.kind !== "spell-choice" || !step.spellChoice || step.spellChoice.sourceUuid !== selection.uuid) {
      continue;
    }

    const spellSelection = draft.spellChoices[step.slotId]?.[0];
    if (!spellSelection) {
      continue;
    }

    const spellDocument = await deps.fetchSelectionDocument(spellSelection);
    const spellSlug =
      extractDocumentSlug(spellDocument) ??
      extractDocumentSlug(spellDocument?.toObject()) ??
      slugifyName(spellSelection.name) ??
      spellSelection.documentId;
    const ruleIndex = rules.findIndex((rule) => isSpellChoiceRule(rule));
    const rule = ruleIndex >= 0 ? rules[ruleIndex] : null;
    const flag = typeof rule?.flag === "string" ? rule.flag : null;
    if (!flag) {
      continue;
    }

    applyRuleSelection(source, ruleIndex, flag, spellSlug);
  }
}

function isSpellChoiceRule(rule: LooseRecord): boolean {
  const choices = rule.choices as { itemType?: unknown; slugsAsValues?: unknown } | null | undefined;
  return rule.key === "ChoiceSet" && typeof rule.flag === "string" && choices?.itemType === "spell";
}

function withEmbeddedSource(document: SelectionDocumentLike, source: EmbeddedItemSource): SelectionDocumentLike {
  return Object.assign(Object.create(document), document, {
    toObject: () => source,
  });
}

function resolveFeatSlotData(
  actor: ActorLike,
  selection: SelectionRef,
  step: PendingStep | null
): { groupId: string; slotId: string | null } | null {
  const groupId = resolveFeatGroupId(selection, step);
  if (!groupId) {
    return null;
  }

  const group = (typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId]) as
    | { slots?: Record<string, FeatSlotLike> }
    | null
    | undefined;
  const slots = Object.values(group?.slots ?? {});
  if (slots.length === 0) {
    return { groupId, slotId: null };
  }

  const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
  const firstOpen = slots.find((slot) => !slot.feat);
  return {
    groupId,
    slotId: matchingLevel?.id ?? firstOpen?.id ?? null,
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

export async function stampSelectionFlags(
  actor: ActorLike,
  items: ActorItemLike[],
  selection: SelectionRef
): Promise<void> {
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
      [`flags.${MODULE_ID}.slotId`]: selection.slotId,
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}

export function orderSelections(draft: DraftState, steps: PendingStep[]): SelectionRef[] {
  const order = new Map<string, number>();
  steps.forEach((step, index) => order.set(step.slotId, index));

  return Object.values(draft.selections).sort((left, right) => {
    return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
  });
}

export function singletonSelections(selections: SelectionRef[]): SelectionRef[] {
  return selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType));
}

export function featSelections(selections: SelectionRef[]): SelectionRef[] {
  return selections.filter((entry) => entry.itemType === "feat");
}

export function hasSourceId(actor: ActorLike, sourceId: string): boolean {
  return (listActorItems(actor) as ActorItemLike[]).some((item) => itemMatchesSourceId(item, sourceId));
}
