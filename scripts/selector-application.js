import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import { cloneData } from "./shared/cloning.js";
import { parseCompendiumItemUuid } from "./shared/compendium.js";
import { buildGrantedItemUpdate as buildGrantedItemSourceUpdate, buildItemGrantRecord, stampGrantedItemSource, } from "./shared/pf2e-item-source.js";
import { itemMatchesSourceId } from "./shared/source-id.js";
export function buildSelectorSelection(slotId, packId, documentId, uuid, name, itemType = "feat", featType = "classfeature") {
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
    if (plan.grantPlan) {
        selectorUpdate[`flags.pf2e.rulesSelections.${plan.grantPlan.flag}`] = plan.grantPlan.selection.uuid;
    }
    if (plan.grantPlan && !createdSelector) {
        // Existing actor-owned ChoiceSet sources must persist their selection before any granted item is created,
        // otherwise PF2E can still surface the native prompt during the grant creation update.
        await actor.updateEmbeddedDocuments("Item", [cloneData(selectorUpdate)]);
    }
    let grantedItemUpdate = null;
    if (plan.grantPlan) {
        const grantedItemResult = await ensureGrantedItem(actor, selectorItem, plan.grantPlan, deps.createEmbeddedSource);
        if (grantedItemResult.item?.id) {
            selectorUpdate[`flags.pf2e.itemGrants.${plan.grantPlan.flag}`] = buildItemGrantRecord(grantedItemResult.item.id, {
                nested: null,
            });
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
        const normalizedDocumentId = typeof uuid === "string" ? parseCompendiumItemUuid(uuid)?.documentId.trim().toLowerCase() : null;
        const normalizedName = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : null;
        return !((uuid && selectedUuids.has(uuid)) ||
            (normalizedDocumentId && selectedDocumentIds.has(normalizedDocumentId)) ||
            (normalizedDocumentId && selectedNames.has(normalizedDocumentId)) ||
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
    const selectorRules = cloneData(Array.isArray(selectorSource.system.rules) ? selectorSource.system.rules : []);
    const initialSelections = [...plan.ruleSelections];
    if (plan.grantPlan) {
        initialSelections.push({
            flag: plan.grantPlan.flag,
            ruleIndex: plan.grantPlan.selectorRuleIndex,
            value: plan.grantPlan.selection.uuid,
        });
    }
    applyRuleSelections(selectorRules, initialSelections);
    selectorSource.system.rules = pruneCreationRules(selectorRules, plan.omitSelectedRulesOnCreate ? new Set(initialSelections.map((selection) => selection.ruleIndex)) : new Set(), plan.grantPlan?.createRulePolicy ?? null);
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
function pruneCreationRules(rules, selectedRuleIndexes, policy) {
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
    stampGrantedItemSource(source, {
        sourceId: grantPlan.selection.uuid,
        slotId: grantPlan.slotId,
        granterId: selectorItemId,
    });
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
    return buildGrantedItemSourceUpdate(itemId, {
        sourceId: grantPlan.selection.uuid,
        slotId: grantPlan.slotId,
        granterId: selectorItemId,
    });
}
//# sourceMappingURL=selector-application.js.map