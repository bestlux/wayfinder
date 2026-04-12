import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import type { ClassChoiceMeta, ClassGrantMeta, DraftState, PendingStep, SelectionRef } from "./types.js";

interface ApplyClassFeatureChoiceDependencies {
  createEmbeddedSource: (selection: SelectionRef, draft?: DraftState, steps?: PendingStep[]) => Promise<any | null>;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<any | null>;
}

interface PendingFeatureGroup {
  sourceSelection: SelectionRef;
  grantStep: PendingStep | null;
  grantMeta: ClassGrantMeta | null;
  grantSelection: SelectionRef | null;
  choiceEntries: Array<{
    step: PendingStep;
    meta: ClassChoiceMeta;
    value: string;
  }>;
}

export async function applyClassFeatureChoiceDraft(
  actor: any,
  draft: DraftState,
  steps: PendingStep[],
  deps: ApplyClassFeatureChoiceDependencies
): Promise<void> {
  const groups = collectFeatureGroups(draft, steps);

  for (const group of groups) {
    let selectorItem = findItemBySourceId(actor, group.sourceSelection.uuid);
    const createdSelector = !selectorItem?.id;

    if (!selectorItem?.id) {
      selectorItem = await createSelectedFeatureItem(actor, group, deps.createEmbeddedSource);
    }

    if (!selectorItem?.id) {
      continue;
    }

    const updates: Record<string, unknown>[] = [];
    const selectorDocument = createdSelector ? await deps.fetchSelectionDocument(group.sourceSelection) : null;
    const selectorRules = Array.isArray(selectorDocument?.system?.rules)
      ? cloneData(selectorDocument.system.rules)
      : Array.isArray(selectorItem.system?.rules)
        ? cloneData(selectorItem.system.rules)
        : [];

    for (const entry of group.choiceEntries) {
      const rule = selectorRules[entry.meta.sourceRuleIndex];
      if (rule) {
        rule.selection = entry.value;
      }
    }

    if (group.grantMeta && group.grantSelection) {
      const rule = selectorRules[group.grantMeta.selectorRuleIndex];
      if (rule) {
        rule.selection = group.grantSelection.uuid;
      }
    }

    const selectorUpdate: Record<string, unknown> = {
      _id: selectorItem.id,
      "system.rules": selectorRules,
    };

    for (const entry of group.choiceEntries) {
      selectorUpdate[`flags.pf2e.rulesSelections.${entry.meta.flag}`] = entry.value;
    }

    if (group.grantMeta && group.grantSelection) {
      selectorUpdate[`flags.pf2e.rulesSelections.${group.grantMeta.flag}`] = group.grantSelection.uuid;
    }

    const selectorSlotId = group.grantStep?.slotId ?? group.choiceEntries[0]?.step.slotId;
    if (selectorSlotId) {
      selectorUpdate[`flags.${MODULE_ID}.slotId`] = selectorSlotId;
    }

    if (group.grantMeta && group.grantSelection) {
      const grantedItem = await ensureGrantedItem(
        actor,
        selectorItem,
        group.grantStep?.slotId ?? group.grantMeta.slotId,
        group.grantSelection,
        deps.createEmbeddedSource
      );
      if (grantedItem?.id) {
        selectorUpdate[`flags.pf2e.itemGrants.${group.grantMeta.flag}`] = {
          id: grantedItem.id,
          onDelete: "detach",
          nested: null,
        };
      }
    }

    updates.push(selectorUpdate);
    await actor.updateEmbeddedDocuments("Item", updates);
  }
}

export function stripPreselectedClassFeatureEntries(classSource: any, draft: DraftState, steps: PendingStep[]): void {
  const selectedFeatures = collectSelectedFeatureRefs(draft, steps);
  if (selectedFeatures.length === 0 || !classSource?.system?.items || typeof classSource.system.items !== "object") {
    return;
  }

  const selectedUuids = new Set(
    selectedFeatures
      .map((entry) => entry.uuid)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const selectedDocumentIds = new Set(
    selectedFeatures
      .map((entry) => entry.documentId.trim().toLowerCase())
      .filter((value): value is string => value.length > 0)
  );
  const selectedNames = new Set(
    selectedFeatures
      .map((entry) => entry.name.trim().toLowerCase())
      .filter((value): value is string => value.length > 0)
  );

  classSource.system.items = Object.fromEntries(
    Object.entries(classSource.system.items).filter(([, entry]: [string, any]) => {
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

function collectFeatureGroups(draft: DraftState, steps: PendingStep[]): PendingFeatureGroup[] {
  const groups = new Map<string, PendingFeatureGroup>();

  for (const step of steps) {
    if (step.kind === "pick-item" && step.grantSelection) {
      const selection = draft.selections[step.slotId];
      if (!selection) {
        continue;
      }

      const key = step.grantSelection.selectorUuid;
      const group = groups.get(key) ?? {
        sourceSelection: createSourceSelection(step.grantSelection, step.slotId),
        grantStep: null,
        grantMeta: null,
        grantSelection: null,
        choiceEntries: [],
      };
      group.grantStep = step;
      group.grantMeta = step.grantSelection;
      group.grantSelection = selection;
      groups.set(key, group);
      continue;
    }

    if (step.kind === "class-choice" && step.classChoice) {
      const value = draft.classChoices[step.slotId];
      if (!value) {
        continue;
      }

      const key = step.classChoice.sourceUuid;
      const group = groups.get(key) ?? {
        sourceSelection: createSourceSelection(step.classChoice, step.slotId),
        grantStep: null,
        grantMeta: null,
        grantSelection: null,
        choiceEntries: [],
      };
      group.choiceEntries.push({ step, meta: step.classChoice, value });
      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

function collectSelectedFeatureRefs(
  draft: DraftState,
  steps: PendingStep[]
): Array<{ uuid: string; documentId: string; name: string }> {
  const refs = new Map<string, { uuid: string; documentId: string; name: string }>();

  for (const step of steps) {
    if (step.kind === "pick-item" && step.grantSelection && draft.selections[step.slotId]) {
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

  return Array.from(refs.values());
}

async function createSelectedFeatureItem(
  actor: any,
  group: PendingFeatureGroup,
  createEmbeddedSource: ApplyClassFeatureChoiceDependencies["createEmbeddedSource"]
): Promise<any | null> {
  const selectorSource = await createEmbeddedSource(group.sourceSelection);
  if (!selectorSource) {
    return null;
  }

  selectorSource.system ??= {};
  selectorSource.system.rules = cloneData(
    Array.isArray(selectorSource.system.rules) ? selectorSource.system.rules : []
  );

  for (const entry of group.choiceEntries) {
    const rule = selectorSource.system.rules[entry.meta.sourceRuleIndex];
    if (rule) {
      rule.selection = entry.value;
    }
  }

  if (group.grantMeta && group.grantSelection) {
    const grantRule = selectorSource.system.rules[group.grantMeta.selectorRuleIndex];
    if (grantRule) {
      grantRule.selection = group.grantSelection.uuid;
    }

    selectorSource.system.rules = selectorSource.system.rules.filter(
      (_rule: any, index: number) => index !== group.grantMeta?.grantRuleIndex
    );
  }

  selectorSource.flags ??= {};
  selectorSource.flags.pf2e ??= {};
  selectorSource.flags.pf2e.rulesSelections ??= {};

  for (const entry of group.choiceEntries) {
    selectorSource.flags.pf2e.rulesSelections[entry.meta.flag] = entry.value;
  }

  if (group.grantMeta && group.grantSelection) {
    selectorSource.flags.pf2e.rulesSelections[group.grantMeta.flag] = group.grantSelection.uuid;
  }

  const selectorSlotId = group.grantStep?.slotId ?? group.choiceEntries[0]?.step.slotId;
  selectorSource.flags[MODULE_ID] = {
    ...(selectorSource.flags[MODULE_ID] ?? {}),
    importedBy: MODULE_ID,
    slotId: selectorSlotId,
  };

  const classItem = listActorItems(actor).find((item: any) => item?.type === "class");
  if (classItem?.id) {
    selectorSource.system.location = classItem.id;
  }

  const created = await actor.createEmbeddedDocuments("Item", [selectorSource]);
  return Array.isArray(created) ? (created[0] ?? null) : null;
}

async function ensureGrantedItem(
  actor: any,
  selectorItem: any,
  slotId: string,
  selection: SelectionRef,
  createEmbeddedSource: ApplyClassFeatureChoiceDependencies["createEmbeddedSource"]
): Promise<any | null> {
  const existingGranted =
    listActorItems(actor).find((item: any) => item?.flags?.pf2e?.grantedBy?.id === selectorItem.id) ?? null;
  const existingMatches = existingGranted && itemMatchesSourceId(existingGranted, selection.uuid);
  if (existingGranted && !existingMatches) {
    await actor.deleteEmbeddedDocuments("Item", [existingGranted.id]);
  }

  if (existingMatches) {
    await actor.updateEmbeddedDocuments("Item", [
      {
        _id: existingGranted.id,
        "flags.core.sourceId": selection.uuid,
        "flags.pf2e.grantedBy": {
          id: selectorItem.id,
          onDelete: "cascade",
        },
        [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
        [`flags.${MODULE_ID}.slotId`]: slotId,
      },
    ]);
    return existingGranted;
  }

  const source = await createEmbeddedSource(selection);
  if (!source) {
    return null;
  }

  source.flags ??= {};
  source.flags.pf2e ??= {};
  source.flags.pf2e.grantedBy = {
    id: selectorItem.id,
    onDelete: "cascade",
  };

  const created = await actor.createEmbeddedDocuments("Item", [source]);
  return Array.isArray(created) ? (created[0] ?? null) : null;
}

function createSourceSelection(meta: ClassGrantMeta | ClassChoiceMeta, slotId: string): SelectionRef {
  return {
    slotId,
    packId: "selectorPackId" in meta ? meta.selectorPackId : meta.sourcePackId,
    documentId: "selectorDocumentId" in meta ? meta.selectorDocumentId : meta.sourceDocumentId,
    uuid: "selectorUuid" in meta ? meta.selectorUuid : meta.sourceUuid,
    itemType: "feat",
    featType: "classfeature",
    name: "selectorName" in meta ? meta.selectorName : meta.sourceName,
    level: null,
  };
}

function findItemBySourceId(actor: any, sourceId: string): any | null {
  return listActorItems(actor).find((item: any) => itemMatchesSourceId(item, sourceId)) ?? null;
}

function itemMatchesSourceId(item: any, sourceId: string): boolean {
  return (
    item?.sourceId === sourceId ||
    item?.flags?.core?.sourceId === sourceId ||
    item?._stats?.compendiumSource === sourceId
  );
}

function cloneData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
