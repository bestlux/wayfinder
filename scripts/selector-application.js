import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import { cloneData } from "./shared/cloning.js";
import { itemMatchesSourceId } from "./shared/source-id.js";
export function buildSelectorSelection(slotId, packId, documentId, uuid, name) {
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
export async function applySelectorApplication(actor, plan, deps) {
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
    const selectorUpdate = {
        _id: selectorItem.id,
        "system.rules": selectorRules,
    };
    if (plan.slotId) {
        selectorUpdate[`flags.${MODULE_ID}.slotId`] = plan.slotId;
    }
    for (const selection of plan.ruleSelections) {
        selectorUpdate[`flags.pf2e.rulesSelections.${selection.flag}`] = selection.value;
    }
    let grantedItemUpdate = null;
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
        if (grantedItemResult.reusedExistingItem &&
            grantedItemResult.update &&
            plan.grantPlan.updateExistingGrantImmediately) {
            await actor.updateEmbeddedDocuments("Item", [grantedItemResult.update]);
        }
        else {
            grantedItemUpdate = grantedItemResult.update;
        }
    }
    const updates = grantedItemUpdate ? [selectorUpdate, grantedItemUpdate] : [selectorUpdate];
    await actor.updateEmbeddedDocuments("Item", updates);
}
export function stripSelectedSelectorEntries(classSource, selectedRefs) {
    if (selectedRefs.length === 0 || !classSource?.system?.items || typeof classSource.system.items !== "object") {
        return;
    }
    const selectedUuids = new Set(selectedRefs
        .map((entry) => entry.uuid)
        .filter((value) => typeof value === "string" && value.length > 0));
    const selectedDocumentIds = new Set(selectedRefs
        .map((entry) => entry.documentId.trim().toLowerCase())
        .filter((value) => value.length > 0));
    const selectedNames = new Set(selectedRefs.map((entry) => entry.name.trim().toLowerCase()).filter((value) => value.length > 0));
    classSource.system.items = Object.fromEntries(Object.entries(classSource.system.items).filter(([, entry]) => {
        const uuid = typeof entry?.uuid === "string" ? entry.uuid : null;
        const normalizedDocumentId = typeof uuid === "string"
            ? /^Compendium\.[^.]+\.[^.]+\.Item\.(.+)$/.exec(uuid)?.[1]?.trim().toLowerCase()
            : null;
        const normalizedName = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : null;
        return !((uuid && selectedUuids.has(uuid)) ||
            (normalizedDocumentId && selectedDocumentIds.has(normalizedDocumentId)) ||
            (normalizedName && selectedNames.has(normalizedName)));
    }));
}
function findSelectorItemBySourceId(actor, sourceId) {
    return listActorItems(actor).find((item) => itemMatchesSourceId(item, sourceId)) ?? null;
}
async function createSelectorItem(actor, plan, createEmbeddedSource) {
    const selectorSource = await createEmbeddedSource(plan.selectorSelection);
    if (!selectorSource) {
        return null;
    }
    selectorSource.system ??= {};
    selectorSource.system.rules = cloneData(Array.isArray(selectorSource.system.rules) ? selectorSource.system.rules : []);
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
    const classItem = listActorItems(actor).find((item) => item?.type === "class");
    if (classItem?.id) {
        selectorSource.system.location = classItem.id;
    }
    const created = await actor.createEmbeddedDocuments("Item", [selectorSource]);
    return Array.isArray(created) ? (created[0] ?? null) : null;
}
async function loadSelectorRules(selectorItem, selectorSelection, createdSelector, deps) {
    const selectorDocument = createdSelector ? await deps.fetchSelectionDocument(selectorSelection) : null;
    if (Array.isArray(selectorDocument?.system?.rules)) {
        return cloneData(selectorDocument.system.rules);
    }
    if (Array.isArray(selectorItem.system?.rules)) {
        return cloneData(selectorItem.system.rules);
    }
    return [];
}
function applyRuleSelections(rules, selections) {
    for (const selection of selections) {
        const rule = rules[selection.ruleIndex];
        if (rule) {
            rule.selection = selection.value;
        }
    }
}
function pruneGrantRules(rules, policy) {
    if (policy === "remove-all-grant-items") {
        return rules.filter((rule) => rule?.key !== "GrantItem");
    }
    if (Array.isArray(policy) && policy.length > 0) {
        const blockedIndexes = new Set(policy);
        return rules.filter((_rule, index) => !blockedIndexes.has(index));
    }
    return rules;
}
async function ensureGrantedItem(actor, selectorItem, grantPlan, createEmbeddedSource) {
    const selectorItemId = typeof selectorItem.id === "string" ? selectorItem.id : null;
    if (!selectorItemId) {
        return { item: null, update: null, reusedExistingItem: false };
    }
    const existingGranted = listActorItems(actor).find((item) => item?.flags?.pf2e?.grantedBy?.id === selectorItemId) ??
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
            update: buildGrantedItemUpdate(existingGrantedId, selectorItemId, grantPlan),
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
    const createdItem = Array.isArray(created) ? (created[0] ?? null) : null;
    if (!createdItem?.id) {
        return { item: createdItem, update: null, reusedExistingItem: false };
    }
    return {
        item: createdItem,
        update: grantPlan.updateCreatedGrant ? buildGrantedItemUpdate(createdItem.id, selectorItemId, grantPlan) : null,
        reusedExistingItem: false,
    };
}
function buildGrantedItemUpdate(itemId, selectorItemId, grantPlan) {
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
//# sourceMappingURL=selector-application.js.map