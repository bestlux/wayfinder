import { listActorItems } from "./build-state.js";
import { MODULE_ID } from "./constants.js";
export async function applyClassBranchDraft(actor, draft, steps, deps) {
    const stepOrder = new Map(steps.map((step, index) => [step.slotId, index]));
    const orderedSteps = steps
        .filter((step) => step.kind === "class-branch" && step.branch)
        .sort((left, right) => (stepOrder.get(left.slotId) ?? 0) - (stepOrder.get(right.slotId) ?? 0));
    for (const step of orderedSteps) {
        const selection = draft.branchSelections[step.slotId];
        const branch = step.branch;
        if (!selection || !branch) {
            continue;
        }
        const selectorSelection = createBranchSelectorSelection(branch, step.slotId);
        let selectorItem = findItemBySourceId(actor, branch.selectorUuid);
        const createdSelector = !selectorItem?.id;
        if (!selectorItem?.id) {
            selectorItem = await createSelectedBranchSelector(actor, branch, selection, step.slotId, deps.createEmbeddedSource);
        }
        if (!selectorItem?.id) {
            continue;
        }
        const existingGranted = listActorItems(actor).find((item) => item?.flags?.pf2e?.grantedBy?.id === selectorItem.id) ?? null;
        const existingGrantedMatches = existingGranted && itemMatchesSourceId(existingGranted, selection.uuid);
        if (existingGranted && !existingGrantedMatches) {
            await actor.deleteEmbeddedDocuments("Item", [existingGranted.id]);
        }
        let grantedItem = existingGrantedMatches ? existingGranted : null;
        if (!grantedItem) {
            const source = await deps.createEmbeddedSource(selection);
            if (!source) {
                continue;
            }
            source.flags ??= {};
            source.flags.pf2e ??= {};
            source.flags.pf2e.grantedBy = {
                id: selectorItem.id,
                onDelete: "cascade",
            };
            const created = await actor.createEmbeddedDocuments("Item", [source]);
            grantedItem = Array.isArray(created) ? (created[0] ?? null) : null;
            if (!grantedItem?.id) {
                continue;
            }
        }
        const selectorDocument = createdSelector ? await deps.fetchSelectionDocument(selectorSelection) : null;
        const selectorRules = Array.isArray(selectorDocument?.system?.rules)
            ? cloneData(selectorDocument.system.rules)
            : Array.isArray(selectorItem.system?.rules)
                ? cloneData(selectorItem.system.rules)
                : [];
        const selectorRule = selectorRules[branch.selectorRuleIndex];
        if (selectorRule) {
            selectorRule.selection = selection.uuid;
        }
        const updates = [
            {
                _id: selectorItem.id,
                "system.rules": selectorRules,
                [`flags.pf2e.rulesSelections.${branch.flag}`]: selection.uuid,
                [`flags.${MODULE_ID}.slotId`]: step.slotId,
            },
        ];
        if (grantedItem?.id) {
            updates[0][`flags.pf2e.itemGrants.${branch.flag}`] = {
                id: grantedItem.id,
                onDelete: "detach",
                nested: null,
            };
            updates.push({
                _id: grantedItem.id,
                "flags.core.sourceId": selection.uuid,
                "flags.pf2e.grantedBy": {
                    id: selectorItem.id,
                    onDelete: "cascade",
                },
                [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
                [`flags.${MODULE_ID}.slotId`]: step.slotId,
            });
        }
        await actor.updateEmbeddedDocuments("Item", updates);
    }
}
export function stripPreselectedClassBranchEntries(classSource, draft, steps) {
    const selectedSelectorRefs = getSelectedBranchSteps(draft, steps).map((step) => step.branch);
    if (selectedSelectorRefs.length === 0 ||
        !classSource?.system?.items ||
        typeof classSource.system.items !== "object") {
        return;
    }
    const selectedSelectorUuids = new Set(selectedSelectorRefs
        .map((branch) => branch.selectorUuid)
        .filter((value) => typeof value === "string" && value.length > 0));
    const selectedSelectorDocumentIds = new Set(selectedSelectorRefs
        .map((branch) => branch.selectorDocumentId.trim().toLowerCase())
        .filter((value) => value.length > 0));
    const selectedSelectorNames = new Set(selectedSelectorRefs
        .map((branch) => branch.selectorName.trim().toLowerCase())
        .filter((value) => value.length > 0));
    classSource.system.items = Object.fromEntries(Object.entries(classSource.system.items).filter(([, entry]) => {
        const uuid = typeof entry?.uuid === "string" ? entry.uuid : null;
        const normalizedDocumentId = typeof uuid === "string"
            ? /^Compendium\.[^.]+\.[^.]+\.Item\.(.+)$/.exec(uuid)?.[1]?.trim().toLowerCase()
            : null;
        const normalizedName = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : null;
        return !((uuid && selectedSelectorUuids.has(uuid)) ||
            (normalizedDocumentId && selectedSelectorDocumentIds.has(normalizedDocumentId)) ||
            (normalizedName && selectedSelectorNames.has(normalizedName)));
    }));
}
export function createBranchSelectorSelection(branch, slotId) {
    return {
        slotId,
        packId: branch.selectorPackId,
        documentId: branch.selectorDocumentId,
        uuid: branch.selectorUuid,
        itemType: "feat",
        featType: "classfeature",
        name: branch.selectorName,
        level: null,
    };
}
function getSelectedBranchSteps(draft, steps) {
    return steps.filter((step) => step.kind === "class-branch" && !!step.branch && !!draft.branchSelections[step.slotId]);
}
async function createSelectedBranchSelector(actor, branch, selection, slotId, createEmbeddedSource) {
    const selectorSelection = createBranchSelectorSelection(branch, slotId);
    const selectorSource = await createEmbeddedSource(selectorSelection);
    if (!selectorSource) {
        return null;
    }
    selectorSource.system ??= {};
    selectorSource.system.rules = cloneData(Array.isArray(selectorSource.system.rules) ? selectorSource.system.rules : []);
    const selectorRule = selectorSource.system.rules[branch.selectorRuleIndex];
    if (selectorRule) {
        selectorRule.selection = selection.uuid;
    }
    // Prevent PF2E from auto-granting the chosen child during selector creation; Wayfinder owns that link step.
    selectorSource.system.rules = selectorSource.system.rules.filter((rule) => rule?.key !== "GrantItem");
    selectorSource.flags ??= {};
    selectorSource.flags.pf2e ??= {};
    selectorSource.flags.pf2e.rulesSelections ??= {};
    selectorSource.flags.pf2e.rulesSelections[branch.flag] = selection.uuid;
    selectorSource.flags[MODULE_ID] = {
        ...(selectorSource.flags[MODULE_ID] ?? {}),
        importedBy: MODULE_ID,
        slotId,
    };
    const classItem = listActorItems(actor).find((item) => item?.type === "class");
    if (classItem?.id) {
        selectorSource.system.location = classItem.id;
    }
    const created = await actor.createEmbeddedDocuments("Item", [selectorSource]);
    return Array.isArray(created) ? (created[0] ?? null) : null;
}
function findItemBySourceId(actor, sourceId) {
    return listActorItems(actor).find((item) => itemMatchesSourceId(item, sourceId)) ?? null;
}
function itemMatchesSourceId(item, sourceId) {
    return (item?.sourceId === sourceId ||
        item?.flags?.core?.sourceId === sourceId ||
        item?._stats?.compendiumSource === sourceId);
}
function cloneData(value) {
    if (typeof globalThis.structuredClone === "function") {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}
//# sourceMappingURL=class-branch-service.js.map