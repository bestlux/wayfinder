import { MODULE_ID } from "../constants.js";
import type { ActorItemLike, EmbeddedItemSource, LooseRecord } from "./actor-model.js";
import { cloneData } from "./cloning.js";

interface ImportedItemSourceStamp {
  sourceId: string;
  slotId: string;
}

interface GrantedItemSourceStamp extends ImportedItemSourceStamp {
  granterId: string;
  onDelete?: string;
}

interface ItemGrantRecordOptions {
  onDelete?: string;
  nested?: unknown;
}

export function stampImportedItemSource(source: EmbeddedItemSource, stamp: ImportedItemSourceStamp): void {
  delete source._id;
  source._stats ??= {};
  source._stats.compendiumSource = stamp.sourceId;
  stampCoreSourceId(source, stamp.sourceId);
  stampModuleSource(source, stamp.slotId);
}

export function stampGrantedItemSource(source: EmbeddedItemSource, stamp: GrantedItemSourceStamp): void {
  stampCoreSourceId(source, stamp.sourceId);
  source.flags ??= {};
  source.flags.pf2e ??= {};
  source.flags.pf2e.grantedBy = {
    id: stamp.granterId,
    onDelete: stamp.onDelete ?? "cascade",
  };
  stampModuleSource(source, stamp.slotId);
}

export function buildGrantedItemUpdate(itemId: string, stamp: GrantedItemSourceStamp): LooseRecord {
  return {
    _id: itemId,
    "flags.core.sourceId": stamp.sourceId,
    "flags.pf2e.grantedBy": {
      id: stamp.granterId,
      onDelete: stamp.onDelete ?? "cascade",
    },
    [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
    [`flags.${MODULE_ID}.slotId`]: stamp.slotId,
  };
}

export function buildItemGrantRecord(grantedItemId: string, options: ItemGrantRecordOptions = {}): LooseRecord {
  const record: LooseRecord = {
    id: grantedItemId,
    onDelete: options.onDelete ?? "detach",
  };
  if ("nested" in options) {
    record.nested = options.nested;
  }
  return record;
}

export function ensureRuleSelections(source: EmbeddedItemSource): Record<string, unknown> {
  source.flags ??= {};
  source.flags.pf2e ??= {};
  source.flags.pf2e.rulesSelections ??= {};
  return source.flags.pf2e.rulesSelections;
}

export function applyRuleSelectionToSource(
  source: EmbeddedItemSource,
  sourceRuleIndex: number,
  flag: string,
  value: string
): void {
  const rules = Array.isArray(source.system?.rules) ? (source.system.rules as LooseRecord[]) : [];
  if (rules[sourceRuleIndex]) {
    rules[sourceRuleIndex].selection = value;
  }

  ensureRuleSelections(source)[flag] = value;
}

export function queueRuleSelectionUpdate(
  updatesByItemId: Map<string, LooseRecord>,
  item: ActorItemLike,
  sourceRuleIndex: number,
  flag: string,
  value: string
): void {
  if (!item.id) {
    return;
  }

  const update =
    updatesByItemId.get(item.id) ??
    ({
      _id: item.id,
      "system.rules": cloneData(Array.isArray(item.system?.rules) ? item.system.rules : []),
    } satisfies LooseRecord);

  applyRuleSelectionToUpdate(update, sourceRuleIndex, flag, value);
  updatesByItemId.set(item.id, update);
}

function applyRuleSelectionToUpdate(update: LooseRecord, sourceRuleIndex: number, flag: string, value: string): void {
  const rules = update["system.rules"] as LooseRecord[];
  if (rules[sourceRuleIndex]) {
    rules[sourceRuleIndex].selection = value;
  }

  update[`flags.pf2e.rulesSelections.${flag}`] = value;
}

function stampCoreSourceId(source: EmbeddedItemSource, sourceId: string): void {
  source.flags ??= {};
  source.flags.core ??= {};
  source.flags.core.sourceId = sourceId;
}

function stampModuleSource(source: EmbeddedItemSource, slotId: string): void {
  source.flags ??= {};
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    importedBy: MODULE_ID,
    slotId,
  };
}
