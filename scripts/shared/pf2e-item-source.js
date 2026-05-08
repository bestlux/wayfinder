import { MODULE_ID } from "../constants.js";
import { cloneData } from "./cloning.js";
export function stampImportedItemSource(source, stamp) {
    delete source._id;
    source._stats ??= {};
    source._stats.compendiumSource = stamp.sourceId;
    stampCoreSourceId(source, stamp.sourceId);
    stampModuleSource(source, stamp.slotId);
}
export function stampGrantedItemSource(source, stamp) {
    stampCoreSourceId(source, stamp.sourceId);
    source.flags ??= {};
    source.flags.pf2e ??= {};
    source.flags.pf2e.grantedBy = {
        id: stamp.granterId,
        onDelete: stamp.onDelete ?? "cascade",
    };
    stampModuleSource(source, stamp.slotId);
}
export function buildGrantedItemUpdate(itemId, stamp) {
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
export function buildItemGrantRecord(grantedItemId, options = {}) {
    const record = {
        id: grantedItemId,
        onDelete: options.onDelete ?? "detach",
    };
    if ("nested" in options) {
        record.nested = options.nested;
    }
    return record;
}
export function ensureRuleSelections(source) {
    source.flags ??= {};
    source.flags.pf2e ??= {};
    source.flags.pf2e.rulesSelections ??= {};
    return source.flags.pf2e.rulesSelections;
}
export function applyRuleSelectionToSource(source, sourceRuleIndex, flag, value) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules[sourceRuleIndex]) {
        rules[sourceRuleIndex].selection = value;
    }
    ensureRuleSelections(source)[flag] = value;
}
export function queueRuleSelectionUpdate(updatesByItemId, item, sourceRuleIndex, flag, value) {
    if (!item.id) {
        return;
    }
    const update = updatesByItemId.get(item.id) ??
        {
            _id: item.id,
            "system.rules": cloneData(Array.isArray(item.system?.rules) ? item.system.rules : []),
        };
    applyRuleSelectionToUpdate(update, sourceRuleIndex, flag, value);
    updatesByItemId.set(item.id, update);
}
function applyRuleSelectionToUpdate(update, sourceRuleIndex, flag, value) {
    const rules = update["system.rules"];
    if (rules[sourceRuleIndex]) {
        rules[sourceRuleIndex].selection = value;
    }
    update[`flags.pf2e.rulesSelections.${flag}`] = value;
}
function stampCoreSourceId(source, sourceId) {
    source.flags ??= {};
    source.flags.core ??= {};
    source.flags.core.sourceId = sourceId;
}
function stampModuleSource(source, slotId) {
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        ...(source.flags[MODULE_ID] ?? {}),
        importedBy: MODULE_ID,
        slotId,
    };
}
//# sourceMappingURL=pf2e-item-source.js.map