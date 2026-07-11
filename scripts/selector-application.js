import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
import { cloneData } from "./shared/cloning.js";
import { parseCompendiumItemUuid } from "./shared/compendium.js";
import { applyRuleSelectionToSource, buildGrantedItemUpdate as buildGrantedItemSourceUpdate, buildItemGrantRecord, stampGrantedItemSource, } from "./shared/pf2e-item-source.js";
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
        applyRuleSelections(selectorRules, grantPlans.map((grantPlan) => ({
            flag: grantPlan.flag,
            ruleIndex: grantPlan.selectorRuleIndex,
            value: grantPlan.selection.uuid,
        })));
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
    for (const grantPlan of grantPlans) {
        selectorUpdate[`flags.pf2e.rulesSelections.${grantPlan.flag}`] = grantPlan.selection.uuid;
    }
    if (grantPlans.length > 0 && !createdSelector) {
        // Existing actor-owned ChoiceSet sources must persist their selection before any granted item is created,
        // otherwise PF2E can still surface the native prompt during the grant creation update.
        await actor.updateEmbeddedDocuments("Item", [cloneData(selectorUpdate)]);
    }
    const grantedItemUpdates = [];
    for (const grantPlan of grantPlans) {
        const grantedItemResult = await ensureGrantedItem(actor, selectorItem, grantPlan, deps.createEmbeddedSource);
        if (grantedItemResult.item?.id) {
            selectorUpdate[`flags.pf2e.itemGrants.${grantPlan.flag}`] = buildItemGrantRecord(grantedItemResult.item.id, {
                nested: null,
            });
        }
        if (grantedItemResult.reusedExistingItem && grantedItemResult.update && grantPlan.updateExistingGrantImmediately) {
            await actor.updateEmbeddedDocuments("Item", [grantedItemResult.update]);
        }
        else if (grantedItemResult.update) {
            grantedItemUpdates.push(grantedItemResult.update);
        }
    }
    const updates = [selectorUpdate, ...grantedItemUpdates];
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
    const grantPlans = normalizeGrantPlans(plan);
    for (const grantPlan of grantPlans) {
        initialSelections.push({
            flag: grantPlan.flag,
            ruleIndex: grantPlan.selectorRuleIndex,
            value: grantPlan.selection.uuid,
        });
    }
    applyRuleSelections(selectorRules, initialSelections);
    selectorSource.system.rules = pruneCreationRules(selectorRules, plan.omitSelectedRulesOnCreate ? new Set(initialSelections.map((selection) => selection.ruleIndex)) : new Set(), combineCreateRulePolicies(grantPlans));
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
    const classItem = listActorItems(actor).find((item) => item?.type === "class");
    if (classItem?.id) {
        selectorSource.system.location = classItem.id;
    }
    const created = await actor.createEmbeddedDocuments("Item", [selectorSource]);
    return Array.isArray(created) ? (created[0] ?? null) : null;
}
function normalizeGrantPlans(plan) {
    return [...(plan.grantPlan ? [plan.grantPlan] : []), ...(plan.grantPlans ?? [])];
}
function combineCreateRulePolicies(grantPlans) {
    if (grantPlans.some((grantPlan) => grantPlan.createRulePolicy === "remove-all-grant-items")) {
        return "remove-all-grant-items";
    }
    const blockedIndexes = grantPlans.flatMap((grantPlan) => Array.isArray(grantPlan.createRulePolicy) ? grantPlan.createRulePolicy : []);
    return blockedIndexes.length > 0 ? blockedIndexes : null;
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
    const existingGranted = findGrantedItemForPlan(actor, selectorItem, grantPlan);
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
        if (grantPlan.adoptExistingSource) {
            const refreshedSource = await createEmbeddedSource(grantPlan.selection);
            await createManualStaticGrantedItems(actor, existingGranted, refreshedSource ?? existingGranted, grantPlan, createEmbeddedSource);
        }
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
    await createManualStaticGrantedItems(actor, createdItem, source, grantPlan, createEmbeddedSource);
    return {
        item: createdItem,
        update: grantPlan.updateCreatedGrant ? buildGrantedItemUpdate(createdItem.id, selectorItemId, grantPlan) : null,
        reusedExistingItem: false,
    };
}
async function createManualStaticGrantedItems(actor, granter, granterSource, grantPlan, createEmbeddedSource) {
    const granterId = typeof granter.id === "string" ? granter.id : null;
    if (!granterId) {
        return;
    }
    const grants = readManualStaticItemGrants(granterSource);
    if (grants.length === 0) {
        return;
    }
    const actorItems = listActorItems(actor);
    const granterUpdate = {
        _id: granterId,
    };
    for (const grant of grants) {
        if (actorItems.some((item) => itemMatchesSourceId(item, grant.uuid))) {
            continue;
        }
        const selection = selectionFromManualStaticGrant(grant, grantPlan.slotId);
        if (!selection) {
            continue;
        }
        const source = await createEmbeddedSource(selection);
        if (!source) {
            continue;
        }
        applyManualChoiceSelections(source, grant.choices);
        stampGrantedItemSource(source, {
            sourceId: grant.uuid,
            slotId: selection.slotId,
            granterId,
        });
        const created = await actor.createEmbeddedDocuments("Item", [source]);
        const createdItem = Array.isArray(created) ? (created[0] ?? null) : null;
        if (createdItem?.id) {
            granterUpdate[`flags.pf2e.itemGrants.${grant.key}`] = buildItemGrantRecord(createdItem.id);
        }
    }
    if (Object.keys(granterUpdate).length > 1) {
        await actor.updateEmbeddedDocuments("Item", [granterUpdate]);
    }
}
function applyManualChoiceSelections(source, choices) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    for (const [flag, value] of Object.entries(choices)) {
        const ruleIndex = rules.findIndex((rule) => rule &&
            typeof rule === "object" &&
            !Array.isArray(rule) &&
            rule.key === "ChoiceSet" &&
            (rule.flag === flag || typeof rule.flag !== "string"));
        const rule = rules[ruleIndex];
        if (ruleIndex >= 0 && rule && typeof rule === "object" && !Array.isArray(rule)) {
            rule.flag = flag;
            applyRuleSelectionToSource(source, ruleIndex, flag, value);
        }
    }
}
function readManualStaticItemGrants(source) {
    const grants = source.flags?.[MODULE_ID]?.manualStaticItemGrants;
    if (!Array.isArray(grants)) {
        return [];
    }
    return grants.flatMap((grant) => {
        if (!grant ||
            typeof grant !== "object" ||
            Array.isArray(grant) ||
            typeof grant.key !== "string" ||
            typeof grant.uuid !== "string" ||
            !grant.choices ||
            typeof grant.choices !== "object" ||
            Array.isArray(grant.choices)) {
            return [];
        }
        return [
            {
                key: grant.key,
                uuid: grant.uuid,
                choices: Object.fromEntries(Object.entries(grant.choices).filter((entry) => typeof entry[1] === "string")),
            },
        ];
    });
}
function selectionFromManualStaticGrant(grant, parentSlotId) {
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
function itemTypeFromPackId(packId) {
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
function findGrantedItemForPlan(actor, selectorItem, grantPlan) {
    const selectorItemId = typeof selectorItem.id === "string" ? selectorItem.id : null;
    if (!selectorItemId) {
        return null;
    }
    const items = listActorItems(actor);
    const itemGrantId = itemGrantIdForFlag(selectorItem, grantPlan.flag);
    if (itemGrantId) {
        const linkedItem = items.find((item) => item?.id === itemGrantId) ?? null;
        if (linkedItem) {
            return linkedItem;
        }
    }
    const matchingSource = items.find((item) => item?.flags?.pf2e?.grantedBy?.id === selectorItemId && itemMatchesSourceId(item, grantPlan.selection.uuid));
    if (matchingSource) {
        return matchingSource;
    }
    if (grantPlan.adoptExistingSource) {
        const adoptableSource = items.find((item) => itemMatchesSourceId(item, grantPlan.selection.uuid));
        if (adoptableSource) {
            return adoptableSource;
        }
    }
    return (items.find((item) => item?.flags?.pf2e?.grantedBy?.id === selectorItemId && item?.flags?.[MODULE_ID]?.slotId === grantPlan.slotId) ?? null);
}
function itemGrantIdForFlag(selectorItem, flag) {
    const grants = selectorItem.flags?.pf2e?.itemGrants;
    if (!grants || typeof grants !== "object") {
        return null;
    }
    const grant = grants[flag];
    return typeof grant?.id === "string" && grant.id.length > 0 ? grant.id : null;
}
function buildGrantedItemUpdate(itemId, selectorItemId, grantPlan) {
    return buildGrantedItemSourceUpdate(itemId, {
        sourceId: grantPlan.selection.uuid,
        slotId: grantPlan.slotId,
        granterId: selectorItemId,
    });
}
//# sourceMappingURL=selector-application.js.map