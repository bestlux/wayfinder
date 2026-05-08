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
import { usesNativeGrantItemCreation } from "../shared/grant-creation-policy.js";
import { extractDocumentSlug, slugifyName } from "../shared/slug.js";
import { itemMatchesSourceId, sourceIdOf } from "../shared/source-id.js";
import type { AbilityKey, DraftState, PendingStep, SelectionRef } from "../types.js";

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

const EXPLICIT_GRANT_SOURCE_ITEM_TYPES = new Set(["ancestry", "heritage", "background"]);
const CLAN_DAGGER_FEATURE_UUID = "Compendium.pf2e.ancestryfeatures.Item.Clan Dagger";
const CLAN_DAGGER_FEATURE_SOURCE_IDS = new Set([
  CLAN_DAGGER_FEATURE_UUID,
  "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
]);

interface ManualSystemItemGrant {
  key: string;
  uuid: string;
  name: string;
  defaultChoices: Record<string, string>;
}

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

export async function replaceSingletonItems(
  actor: ActorLike,
  selections: SelectionRef[],
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies = DEFAULT_CREATE_DEPS
): Promise<void> {
  const singletonSelections = selections.filter((selection) => SINGLETON_ITEM_TYPES.has(selection.itemType));
  if (singletonSelections.length === 0) {
    return;
  }

  const selectedTypes = new Set(singletonSelections.map((selection) => selection.itemType));
  const sources = (
    await Promise.all(singletonSelections.map((selection) => createEmbeddedSource(selection, draft, steps, deps)))
  ).filter((source): source is EmbeddedItemSource => !!source);

  const existing = (listActorItems(actor) as ActorItemLike[]).filter((item) => selectedTypes.has(item?.type ?? ""));
  const existingIds = existing.map((item) => item.id).filter((id): id is string => typeof id === "string");
  if (existingIds.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
    await actor.deleteEmbeddedDocuments("Item", existingIds);
  }

  if (sources.length > 0 && typeof actor.createEmbeddedDocuments === "function") {
    await actor.createEmbeddedDocuments("Item", sources);
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
  if (draft) {
    stripManualSystemItemGrants(source);
    applyPendingSingletonChoices(source, selection, draft, steps);
    applyPendingBoostSelections(source, selection, draft);
    await applyPendingGrantChoiceSelections(source, selection, draft, steps, deps);
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
    ...(source.flags[MODULE_ID] ?? {}),
    importedBy: MODULE_ID,
    slotId: selection.slotId,
  };
  return source;
}

function applyPendingBoostSelections(source: EmbeddedItemSource, selection: SelectionRef, draft: DraftState): void {
  if (!["ancestry", "background", "class"].includes(selection.itemType)) {
    return;
  }

  if (selection.itemType === "ancestry") {
    const ancestryBoosts = draft.boosts.ancestry;
    if (
      !ancestryBoosts.modeTouched &&
      Object.keys(ancestryBoosts.selectedBoosts).length === 0 &&
      !ancestryBoosts.voluntary.touched &&
      !ancestryBoosts.voluntary.enabled
    ) {
      return;
    }

    source.system ??= {};
    if (ancestryBoosts.mode === "alternate") {
      source.system.alternateAncestryBoosts = [...ancestryBoosts.alternateBoosts];
    } else if (ancestryBoosts.modeTouched) {
      delete source.system.alternateAncestryBoosts;
    }

    applySelectedBoosts(source, ancestryBoosts.selectedBoosts);

    source.system.voluntary ??= {};
    source.system.voluntary.flaws = ancestryBoosts.voluntary.enabled ? [...ancestryBoosts.voluntary.flaws] : [];
    if (ancestryBoosts.voluntary.enabled && ancestryBoosts.voluntary.legacy) {
      source.system.voluntary.boost = ancestryBoosts.voluntary.boost;
    } else {
      delete source.system.voluntary.boost;
    }
    return;
  }

  if (selection.itemType === "background") {
    if (Object.keys(draft.boosts.background.selectedBoosts).length === 0) {
      return;
    }
    source.system ??= {};
    applySelectedBoosts(source, draft.boosts.background.selectedBoosts);
    return;
  }

  if (selection.itemType === "class") {
    if (!draft.boosts.class.keyAbility) {
      return;
    }
    source.system ??= {};
    source.system.keyAbility ??= {};
    source.system.keyAbility.selected = draft.boosts.class.keyAbility;
  }
}

function applySelectedBoosts(source: EmbeddedItemSource, selectedBoosts: Record<string, AbilityKey | null>): void {
  source.system ??= {};
  source.system.boosts ??= {};
  for (const [slot, selected] of Object.entries(selectedBoosts)) {
    const boost = source.system.boosts[slot];
    if (boost && typeof boost === "object") {
      boost.selected = selected;
    }
  }
}

export async function createSingletonSystemGrantItems(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS
): Promise<void> {
  if (typeof actor.createEmbeddedDocuments !== "function") {
    return;
  }

  const actorItems = listActorItems(actor) as ActorItemLike[];
  for (const granter of actorItems) {
    const grants = readManualSystemItemGrants(granter);
    if (!grants.length || !granter.id) {
      continue;
    }

    for (const grant of grants) {
      if (actorItems.some((item) => grantSourceMatches(item, grant.uuid))) {
        continue;
      }

      const selection = selectionFromSystemGrant(grant);
      const source = await deps.createEmbeddedSource(selection, draft, steps);
      if (!source) {
        continue;
      }

      source.system ??= {};
      source.system.location = granter.id;
      source.flags ??= {};
      source.flags.core ??= {};
      source.flags.core.sourceId = grant.uuid;
      source.flags.pf2e ??= {};
      source.flags.pf2e.grantedBy = {
        id: granter.id,
        onDelete: "cascade",
      };
      source.flags[MODULE_ID] = {
        ...(source.flags[MODULE_ID] ?? {}),
        importedBy: MODULE_ID,
        slotId: selection.slotId,
      };
      applyManualGrantChoices(source, grant.defaultChoices);
      const created = await actor.createEmbeddedDocuments("Item", [source]);
      const createdItem = Array.isArray(created) ? ((created[0] as ActorItemLike | undefined) ?? null) : null;
      if (!createdItem?.id || typeof actor.updateEmbeddedDocuments !== "function") {
        continue;
      }

      await actor.updateEmbeddedDocuments("Item", [
        {
          _id: granter.id,
          [`flags.pf2e.itemGrants.${grant.key}`]: {
            id: createdItem.id,
            onDelete: "detach",
          },
        },
      ]);
    }
  }
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

function stripManualSystemItemGrants(source: EmbeddedItemSource): void {
  const systemItems = source.system?.items;
  if (!isLooseRecord(systemItems)) {
    return;
  }

  const manualGrants: ManualSystemItemGrant[] = [];
  for (const [key, value] of Object.entries(systemItems)) {
    if (!isLooseRecord(value) || !isClanDaggerSystemItemGrant(value)) {
      continue;
    }

    const uuid = typeof value.uuid === "string" ? value.uuid : CLAN_DAGGER_FEATURE_UUID;
    manualGrants.push({
      key,
      uuid,
      name: typeof value.name === "string" && value.name.trim().length > 0 ? value.name : "Clan Dagger",
      defaultChoices: {
        clanWeapon: "clan-dagger",
      },
    });
    delete systemItems[key];
  }

  if (manualGrants.length === 0) {
    return;
  }

  source.flags ??= {};
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    manualSystemItemGrants: manualGrants,
  };
}

function isClanDaggerSystemItemGrant(value: LooseRecord): boolean {
  const name = typeof value.name === "string" ? value.name.trim().toLowerCase() : "";
  const uuid = typeof value.uuid === "string" ? value.uuid.trim() : "";
  return name === "clan dagger" || CLAN_DAGGER_FEATURE_SOURCE_IDS.has(uuid);
}

function readManualSystemItemGrants(item: ActorItemLike): ManualSystemItemGrant[] {
  const grants = item.flags?.[MODULE_ID]?.manualSystemItemGrants;
  if (!Array.isArray(grants)) {
    return [];
  }

  return grants.flatMap((grant): ManualSystemItemGrant[] => {
    if (!isLooseRecord(grant) || typeof grant.uuid !== "string" || typeof grant.name !== "string") {
      return [];
    }

    return [
      {
        key:
          typeof grant.key === "string" && grant.key.trim().length > 0
            ? grant.key.trim()
            : (slugifyName(grant.name) ?? "grant"),
        uuid: grant.uuid,
        name: grant.name,
        defaultChoices: isLooseRecord(grant.defaultChoices)
          ? Object.fromEntries(
              Object.entries(grant.defaultChoices).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string"
              )
            )
          : {},
      },
    ];
  });
}

function selectionFromSystemGrant(grant: ManualSystemItemGrant): SelectionRef {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(grant.uuid);
  return {
    slotId: `system-grant-${slugifyName(grant.name) ?? "item"}`,
    packId: match?.[1] ?? "pf2e.feats-srd",
    documentId: match?.[2] ?? grant.name,
    uuid: grant.uuid,
    itemType: "feat",
    featType: "ancestryfeature",
    name: grant.name,
    level: null,
  };
}

function grantSourceMatches(item: ActorItemLike, uuid: string): boolean {
  return itemMatchesSourceId(item, uuid) || (CLAN_DAGGER_FEATURE_SOURCE_IDS.has(uuid) && item.name === "Clan Dagger");
}

function applyManualGrantChoices(source: EmbeddedItemSource, choices: Record<string, string>): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  for (const [flag, value] of Object.entries(choices)) {
    const ruleIndex = rules.findIndex((rule) => isLooseRecord(rule) && rule.key === "ChoiceSet" && rule.flag === flag);
    if (ruleIndex >= 0) {
      applyRuleSelection(source, ruleIndex, flag, value);
    }
  }
}

async function applyPendingGrantChoiceSelections(
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

  source.flags ??= {};
  source.flags.pf2e ??= {};
  source.flags.pf2e.rulesSelections ??= {};

  const grantRuleIndexesToRemove = new Set<number>();
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

    const grantRule = rules[step.grantSelection.grantRuleIndex];
    if (grantRule && typeof grantRule === "object") {
      const preselectChoices = await collectGrantedItemPreselectChoices(grantedSelection, draft, steps, deps);
      if (Object.keys(preselectChoices).length > 0) {
        const ruleRecord = grantRule as LooseRecord;
        ruleRecord.preselectChoices = {
          ...(isLooseRecord(ruleRecord.preselectChoices) ? ruleRecord.preselectChoices : {}),
          ...preselectChoices,
        };
      }
    }

    if (
      EXPLICIT_GRANT_SOURCE_ITEM_TYPES.has(step.grantSelection.sourceItemType) &&
      !usesNativeGrantItemCreation(step)
    ) {
      grantRuleIndexesToRemove.add(step.grantSelection.grantRuleIndex);
    }
  }

  if (grantRuleIndexesToRemove.size > 0) {
    source.system ??= {};
    source.system.rules = rules.filter((_rule, index) => !grantRuleIndexesToRemove.has(index));
  }
}

export async function createSingletonGrantItems(
  actor: ActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: InsertFeatSelectionDependencies = DEFAULT_INSERT_DEPS
): Promise<void> {
  if (typeof actor.createEmbeddedDocuments !== "function") {
    return;
  }

  for (const step of steps) {
    if (
      step.kind !== "pick-item" ||
      !step.grantSelection ||
      !EXPLICIT_GRANT_SOURCE_ITEM_TYPES.has(step.grantSelection.sourceItemType) ||
      usesNativeGrantItemCreation(step)
    ) {
      continue;
    }

    const grantedSelection = draft.selections[step.slotId];
    if (!grantedSelection) {
      continue;
    }

    const actorItems = listActorItems(actor) as ActorItemLike[];
    const granter = actorItems.find((item) => itemMatchesSourceId(item, step.grantSelection!.selectorUuid));
    if (!granter?.id) {
      continue;
    }

    if (actorItems.some((item) => itemMatchesSourceId(item, grantedSelection.uuid))) {
      continue;
    }

    const source = await deps.createEmbeddedSource(grantedSelection, draft, steps);
    if (!source) {
      continue;
    }

    source.flags ??= {};
    source.flags.core ??= {};
    source.flags.core.sourceId = grantedSelection.uuid;
    source.flags.pf2e ??= {};
    source.flags.pf2e.grantedBy = {
      id: granter.id,
      onDelete: "cascade",
    };
    source.flags[MODULE_ID] = {
      ...(source.flags[MODULE_ID] ?? {}),
      importedBy: MODULE_ID,
      slotId: step.slotId,
    };

    const created = await actor.createEmbeddedDocuments("Item", [source]);
    const createdItem = Array.isArray(created) ? ((created[0] as ActorItemLike | undefined) ?? null) : null;
    if (!createdItem?.id || typeof actor.updateEmbeddedDocuments !== "function") {
      continue;
    }

    const granterSlotId = resolveExplicitGrantSourceSlotId(step.grantSelection.sourceItemType, draft, granter);
    await actor.updateEmbeddedDocuments("Item", [
      {
        _id: granter.id,
        ...(granterSlotId
          ? {
              [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
              [`flags.${MODULE_ID}.slotId`]: granterSlotId,
            }
          : {}),
        [`flags.pf2e.itemGrants.${step.grantSelection.flag}`]: {
          id: createdItem.id,
          onDelete: "detach",
          nested: null,
        },
      },
    ]);
  }
}

function resolveExplicitGrantSourceSlotId(
  sourceItemType: string,
  draft: DraftState,
  granter: ActorItemLike
): string | null {
  const draftSlotId =
    Object.values(draft.selections).find((selection) => selection.uuid === sourceIdOf(granter))?.slotId ?? null;
  if (draftSlotId) {
    return draftSlotId;
  }

  switch (sourceItemType) {
    case "ancestry":
    case "heritage":
    case "background":
      return `${sourceItemType}-level-1`;
    default:
      return null;
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
  const source = await deps.createEmbeddedSource(selection, draft, steps);
  if (!source) {
    return;
  }

  const slotData = resolveFeatSlotData(actor, selection, step);
  if (slotData) {
    applyFeatSlotData(source, slotData, step);
  }

  if (typeof actor.createEmbeddedDocuments === "function") {
    const inserted = await actor.createEmbeddedDocuments("Item", [source]);
    await stampSelectionFlags(actor, inserted, selection);
  }
}

function applyFeatSlotData(
  source: EmbeddedItemSource,
  slotData: { groupId: string; slotId: string | null },
  step: PendingStep | null
): void {
  source.system ??= {};
  source.system.location = slotData.slotId ?? slotData.groupId;
  source.system.level ??= {};
  if (typeof step?.level === "number") {
    source.system.level.taken = step.level;
  }
}

async function collectGrantedItemPreselectChoices(
  grantedSelection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies
): Promise<Record<string, string>> {
  const preselectChoices: Record<string, string> = {};

  for (const step of steps) {
    if (step.kind === "skill-training" && step.training && draft.skillTrainings[step.slotId]) {
      const training = draft.skillTrainings[step.slotId];
      for (const choiceRule of step.training.choiceRules) {
        const value = training.ruleChoices[choiceRule.key];
        if (choiceRule.persistence?.sourceUuid === grantedSelection.uuid && value) {
          preselectChoices[choiceRule.flag] = value;
        }
      }

      for (const loreChoice of step.training.loreChoices) {
        const value = training.loreChoices[loreChoice.key];
        if (loreChoice.persistence?.sourceUuid === grantedSelection.uuid && value) {
          preselectChoices[loreChoice.flag] = value;
        }
      }
    }

    if (step.kind === "spell-choice" && step.spellChoice?.sourceUuid === grantedSelection.uuid) {
      const spellSelections = draft.spellChoices[step.slotId] ?? [];
      const spellSelection = spellSelections[0];
      if (spellSelection) {
        const flag = await resolveGrantedSpellChoiceFlag(grantedSelection, deps);
        if (flag) {
          preselectChoices[flag] = await resolveSpellChoiceSelectionValue(spellSelection, deps);
        }
      }
    }

    if (step.kind === "singleton-choice" && step.singletonChoice?.sourceUuid === grantedSelection.uuid) {
      const value = draft.singletonChoices[step.slotId];
      if (typeof value === "string" && value.length > 0) {
        preselectChoices[step.singletonChoice.flag] = value;
      }
    }

    if (step.kind === "pick-item" && step.grantSelection?.selectorUuid === grantedSelection.uuid) {
      const nestedSelection = draft.selections[step.slotId];
      if (nestedSelection) {
        preselectChoices[step.grantSelection.flag] = nestedSelection.uuid;
      }
    }

    if (step.kind === "class-choice" && step.classChoice?.sourceUuid === grantedSelection.uuid) {
      const value = draft.classChoices[step.slotId];
      if (typeof value === "string" && value.length > 0) {
        preselectChoices[step.classChoice.flag] = value;
      }
    }
  }

  return preselectChoices;
}

async function resolveGrantedSpellChoiceFlag(
  grantedSelection: SelectionRef,
  deps: CreateEmbeddedSourceDependencies
): Promise<string | null> {
  const document = await deps.fetchSelectionDocument(grantedSelection);
  const source = document?.toObject();
  const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
  const rule = rules.find((entry) => isSpellChoiceRule(entry));
  return typeof rule?.flag === "string" ? rule.flag : null;
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

    const ruleIndex = rules.findIndex((rule) => isSpellChoiceRule(rule));
    const rule = ruleIndex >= 0 ? rules[ruleIndex] : null;
    const flag = typeof rule?.flag === "string" ? rule.flag : null;
    if (!flag) {
      continue;
    }

    const spellSlug = await resolveSpellChoiceSelectionValue(spellSelection, deps);
    applyRuleSelection(source, ruleIndex, flag, spellSlug);
  }
}

async function resolveSpellChoiceSelectionValue(
  spellSelection: SelectionRef,
  deps: CreateEmbeddedSourceDependencies
): Promise<string> {
  const spellDocument = await deps.fetchSelectionDocument(spellSelection);
  return (
    extractDocumentSlug(spellDocument) ??
    extractDocumentSlug(spellDocument?.toObject()) ??
    slugifyName(spellSelection.name) ??
    spellSelection.documentId
  );
}

function isSpellChoiceRule(rule: LooseRecord): boolean {
  const choices = rule.choices as { itemType?: unknown; slugsAsValues?: unknown } | null | undefined;
  return rule.key === "ChoiceSet" && typeof rule.flag === "string" && choices?.itemType === "spell";
}

function isLooseRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
    if (
      !item?.id ||
      hasConflictingItemType(item, selection) ||
      isPf2eGrantedChildItem(item) ||
      hasConflictingSourceId(item, selection.uuid)
    ) {
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

function isPf2eGrantedChildItem(item: ActorItemLike): boolean {
  const grantedBy = item.flags?.pf2e?.grantedBy;
  return !!grantedBy && typeof grantedBy === "object";
}

function hasConflictingItemType(item: ActorItemLike, selection: SelectionRef): boolean {
  return typeof item.type === "string" && item.type.length > 0 && item.type !== selection.itemType;
}

function hasConflictingSourceId(item: ActorItemLike, sourceId: string): boolean {
  const itemSourceId = sourceIdOf(item);
  return !!itemSourceId && itemSourceId !== sourceId;
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

export async function restoreSingletonSourceSlotFlags(actor: ActorLike, draft: DraftState): Promise<void> {
  if (typeof actor.updateEmbeddedDocuments !== "function") {
    return;
  }

  const actorItems = listActorItems(actor) as ActorItemLike[];
  const updates: Record<string, unknown>[] = [];
  for (const selection of Object.values(draft.selections)) {
    if (!SINGLETON_ITEM_TYPES.has(selection.itemType)) {
      continue;
    }

    const item = actorItems.find((entry) => itemMatchesSourceId(entry, selection.uuid));
    if (!item?.id || item.flags?.[MODULE_ID]?.slotId === selection.slotId) {
      continue;
    }

    updates.push({
      _id: item.id,
      [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
      [`flags.${MODULE_ID}.slotId`]: selection.slotId,
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}
