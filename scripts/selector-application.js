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
    const grantedItemUpdates = [];
    const createdItemIds = [];
    const replacedItemIds = [];
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
    }
    catch (error) {
        const rollbackErrors = [];
        if (selectorWasUpdated && selectorRollback) {
            try {
                await actor.updateEmbeddedDocuments("Item", [selectorRollback]);
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        const rollbackIds = Array.from(new Set([...createdItemIds, ...(createdSelector ? [selectorItem.id] : [])]));
        if (rollbackIds.length > 0) {
            try {
                await actor.deleteEmbeddedDocuments("Item", rollbackIds);
            }
            catch (rollbackError) {
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
function buildSelectorRollbackUpdate(selectorItem, plan, grantPlans) {
    const update = {
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
        }
        else {
            update[`flags.pf2e.rulesSelections.-=${flag}`] = null;
        }
    }
    for (const grantPlan of grantPlans) {
        if (Object.hasOwn(itemGrants, grantPlan.flag)) {
            update[`flags.pf2e.itemGrants.${grantPlan.flag}`] = cloneData(itemGrants[grantPlan.flag]);
        }
        else {
            update[`flags.pf2e.itemGrants.-=${grantPlan.flag}`] = null;
        }
    }
    const previousSlotId = selectorItem.flags?.[MODULE_ID]?.slotId;
    if (typeof previousSlotId === "string") {
        update[`flags.${MODULE_ID}.slotId`] = previousSlotId;
    }
    else if (plan.slotId) {
        update[`flags.${MODULE_ID}.-=slotId`] = null;
    }
    return update;
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
        throw new Error("Cannot create a selector grant without a persisted selector item.");
    }
    const existingGranted = findGrantedItemForPlan(actor, selectorItem, grantPlan);
    const existingGrantedId = typeof existingGranted?.id === "string" ? existingGranted.id : null;
    if (existingGranted && !existingGrantedId) {
        throw new Error(`Cannot replace ${grantPlan.selection.name}: the existing grant has no document ID.`);
    }
    const existingMatches = existingGranted && itemMatchesSourceId(existingGranted, grantPlan.selection.uuid);
    if (existingMatches) {
        let manualPreparation = { createdItemIds: [], updates: [] };
        if (grantPlan.adoptExistingSource) {
            const refreshedSource = await createEmbeddedSource(grantPlan.selection);
            manualPreparation = await createManualStaticGrantedItems(actor, existingGranted, refreshedSource ?? existingGranted, {
                parentSlotId: grantPlan.slotId,
                parentName: grantPlan.selection.name,
                createEmbeddedSource,
                replaceDescendantsOwnedById: null,
            });
        }
        return {
            item: existingGranted,
            update: buildGrantedItemUpdate(existingGrantedId, selectorItemId, grantPlan),
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
    const createdItem = Array.isArray(created) ? (created[0] ?? null) : null;
    if (!createdItem?.id) {
        throw new Error(`Cannot create ${grantPlan.selection.name}: Foundry returned no created item.`);
    }
    try {
        const manualPreparation = await createManualStaticGrantedItems(actor, createdItem, source, {
            parentSlotId: grantPlan.slotId,
            parentName: grantPlan.selection.name,
            createEmbeddedSource,
            replaceDescendantsOwnedById: existingGrantedId,
        });
        return {
            item: createdItem,
            update: grantPlan.updateCreatedGrant ? buildGrantedItemUpdate(createdItem.id, selectorItemId, grantPlan) : null,
            createdItemIds: [createdItem.id, ...manualPreparation.createdItemIds],
            replacedItemId: existingGrantedId,
            supplementalUpdates: manualPreparation.updates,
        };
    }
    catch (error) {
        try {
            await actor.deleteEmbeddedDocuments("Item", [createdItem.id]);
        }
        catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Failed to replace ${grantPlan.selection.name} safely.`, {
                cause: rollbackError,
            });
        }
        throw error;
    }
}
function assertResolvedUnconditionalChoiceSets(source, sourceName) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    const selections = source.flags?.pf2e?.rulesSelections ?? {};
    for (const [ruleIndex, rule] of rules.entries()) {
        if (rule?.key !== "ChoiceSet" || !isUnconditionalPredicate(rule.predicate)) {
            continue;
        }
        const flag = typeof rule.flag === "string" && rule.flag.length > 0 ? rule.flag : null;
        const resolvedByRule = isResolvedChoiceSelection(rule.selection);
        const resolvedByFlag = flag ? isResolvedChoiceSelection(selections[flag]) : false;
        if (!resolvedByRule && !resolvedByFlag) {
            throw new Error(`Cannot create ${sourceName}: unresolved unconditional ChoiceSet ${flag ? `"${flag}"` : `at rule ${ruleIndex}`}.`);
        }
    }
}
function isResolvedChoiceSelection(value) {
    if (typeof value === "string")
        return value.length > 0;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (typeof value === "boolean")
        return true;
    if (Array.isArray(value))
        return value.length > 0 && value.every(isStructuredChoiceValue);
    if (!isStructuredRecord(value))
        return false;
    const entries = Object.entries(value);
    return entries.length > 0 && entries.every(([, entry]) => isStructuredChoiceValue(entry));
}
function isStructuredChoiceValue(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isStructuredChoiceValue);
    return isStructuredRecord(value) && Object.values(value).every(isStructuredChoiceValue);
}
function isStructuredRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isUnconditionalPredicate(predicate) {
    return predicate === undefined || (Array.isArray(predicate) && predicate.length === 0);
}
export async function createManualStaticGrantedItems(actor, granter, granterSource, options) {
    const granterId = typeof granter.id === "string" ? granter.id : null;
    if (!granterId) {
        return { createdItemIds: [], updates: [] };
    }
    const grants = readManualStaticItemGrants(granterSource);
    if (grants.length === 0) {
        return { createdItemIds: [], updates: [] };
    }
    assertManualStaticGrantReconciliation(actor, granter, granterSource, options);
    const actorItems = listActorItems(actor);
    const granterUpdate = {
        _id: granterId,
    };
    const createdItemIds = [];
    try {
        for (const grant of grants) {
            const retainedMatches = actorItems.filter((item) => itemMatchesSourceId(item, grant.uuid) &&
                item.flags?.pf2e?.grantedBy?.id !== options.replaceDescendantsOwnedById);
            if (retainedMatches.length > 1) {
                throw new Error(`Cannot reconcile a static child for ${options.parentName}: ${grant.uuid} is ambiguous.`);
            }
            const retainedMatch = retainedMatches[0];
            if (retainedMatch) {
                if (!retainedMatch.id || retainedMatch.flags?.pf2e?.grantedBy?.id !== granterId) {
                    throw new Error(`Cannot reconcile a static child for ${options.parentName}: ${grant.uuid} has conflicting provenance.`);
                }
                granterUpdate[`flags.pf2e.itemGrants.${grant.key}`] = buildItemGrantRecord(retainedMatch.id);
                continue;
            }
            const selection = selectionFromManualStaticGrant(grant, options.parentSlotId);
            if (!selection) {
                throw new Error(`Cannot create a static child for ${options.parentName}: invalid UUID ${grant.uuid}.`);
            }
            const source = await options.createEmbeddedSource(selection);
            if (!source) {
                throw new Error(`Cannot create a static child for ${options.parentName}: ${grant.uuid} is unavailable.`);
            }
            applyManualChoiceSelections(source, grant.choices);
            stampGrantedItemSource(source, {
                sourceId: grant.uuid,
                slotId: selection.slotId,
                granterId,
            });
            const created = await actor.createEmbeddedDocuments("Item", [source]);
            const createdItem = Array.isArray(created) ? (created[0] ?? null) : null;
            if (!createdItem?.id) {
                throw new Error(`Cannot create a static child for ${options.parentName}: Foundry returned no item.`);
            }
            createdItemIds.push(createdItem.id);
            granterUpdate[`flags.pf2e.itemGrants.${grant.key}`] = buildItemGrantRecord(createdItem.id);
        }
        return {
            createdItemIds,
            updates: Object.keys(granterUpdate).length > 1 ? [granterUpdate] : [],
        };
    }
    catch (error) {
        if (createdItemIds.length > 0) {
            try {
                await actor.deleteEmbeddedDocuments("Item", createdItemIds);
            }
            catch (rollbackError) {
                throw new AggregateError([error, rollbackError], `Failed to create ${options.parentName} safely.`, {
                    cause: rollbackError,
                });
            }
        }
        throw error;
    }
}
export function assertManualStaticGrantReconciliation(actor, granter, granterSource, options) {
    const grants = readManualStaticItemGrants(granterSource);
    if (grants.length === 0)
        return;
    const granterId = typeof granter.id === "string" ? granter.id : null;
    if (!granterId) {
        throw new Error(`Cannot reconcile static children for ${options.parentName}: the parent has no document ID.`);
    }
    assertUniqueManualStaticGrants(grants, options.parentName);
    const actorItems = listActorItems(actor);
    for (const grant of grants) {
        const retainedMatches = actorItems.filter((item) => itemMatchesSourceId(item, grant.uuid) && item.flags?.pf2e?.grantedBy?.id !== options.replaceDescendantsOwnedById);
        if (retainedMatches.length > 1) {
            throw new Error(`Cannot reconcile a static child for ${options.parentName}: ${grant.uuid} is ambiguous.`);
        }
        const retainedMatch = retainedMatches[0];
        if (retainedMatch && (!retainedMatch.id || retainedMatch.flags?.pf2e?.grantedBy?.id !== granterId)) {
            throw new Error(`Cannot reconcile a static child for ${options.parentName}: ${grant.uuid} has conflicting provenance.`);
        }
        const parentLink = itemGrantLinkForFlag(granter, grant.key);
        if (!parentLink.present)
            continue;
        const linkedItem = parentLink.id ? actorItems.find((item) => item.id === parentLink.id) : null;
        if (!linkedItem ||
            !itemMatchesSourceId(linkedItem, grant.uuid) ||
            linkedItem.flags?.pf2e?.grantedBy?.id !== granterId ||
            retainedMatch?.id !== linkedItem.id) {
            throw new Error(`Cannot reconcile a static child for ${options.parentName}: grant key ${grant.key} has conflicting provenance.`);
        }
    }
}
export function assertManualStaticGrantSourcesAvailable(actor, granterSource, parentName) {
    const grants = readManualStaticItemGrants(granterSource);
    if (grants.length === 0)
        return;
    assertUniqueManualStaticGrants(grants, parentName);
    const actorItems = listActorItems(actor);
    for (const grant of grants) {
        if (actorItems.some((item) => itemMatchesSourceId(item, grant.uuid))) {
            throw new Error(`Cannot reconcile a static child for ${parentName}: ${grant.uuid} has conflicting provenance.`);
        }
    }
}
function assertUniqueManualStaticGrants(grants, parentName) {
    const keys = new Set();
    const sourceUuids = new Set();
    for (const grant of grants) {
        if (keys.has(grant.key)) {
            throw new Error(`Cannot create static children for ${parentName}: duplicate grant key ${grant.key}.`);
        }
        if (sourceUuids.has(grant.uuid)) {
            throw new Error(`Cannot create static children for ${parentName}: duplicate grant source ${grant.uuid}.`);
        }
        keys.add(grant.key);
        sourceUuids.add(grant.uuid);
    }
}
function itemGrantLinkForFlag(item, flag) {
    const grants = item.flags?.pf2e?.itemGrants;
    if (!grants || typeof grants !== "object" || Array.isArray(grants) || !Object.hasOwn(grants, flag)) {
        return { present: false, id: null };
    }
    const value = grants[flag];
    const id = value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string"
        ? value.id
        : null;
    return { present: true, id: id && id.length > 0 ? id : null };
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
export function readManualStaticItemGrants(source) {
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
export function selectionFromManualStaticGrant(grant, parentSlotId) {
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