import { listActorItems } from "../build-state.js";
import { stripPreselectedClassBranchEntries } from "../class-branch-service.js";
import { stripPreselectedClassFeatureEntries } from "../class-feature-choice-service.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack-service.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);
const DEFAULT_CREATE_DEPS = {
    fetchSelectionDocument,
    stripPreselectedClassFeatureEntries,
    stripPreselectedClassBranchEntries,
};
const DEFAULT_INSERT_DEPS = {
    fetchSelectionDocument,
    createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};
export async function replaceSingletonItem(actor, selection, draft, steps, deps = DEFAULT_CREATE_DEPS) {
    const existing = listActorItems(actor).filter((item) => item?.type === selection.itemType);
    const existingIds = existing.map((item) => item.id).filter((id) => typeof id === "string");
    if (existingIds.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
        await actor.deleteEmbeddedDocuments("Item", existingIds);
    }
    const source = await createEmbeddedSource(selection, draft, steps, deps);
    if (source && typeof actor.createEmbeddedDocuments === "function") {
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}
export async function createEmbeddedSource(selection, draft, steps = [], deps = DEFAULT_CREATE_DEPS) {
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
        applyPendingGrantChoiceSelections(source, selection, draft, steps);
        applyPendingTrainingSelections(source, selection, draft, steps);
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
function applyPendingTrainingSelections(source, selection, draft, steps) {
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
function applyTrainingRuleSelection(source, selection, persistence, flag, value) {
    if (!persistence || persistence.sourceUuid !== selection.uuid) {
        return;
    }
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules[persistence.sourceRuleIndex]) {
        rules[persistence.sourceRuleIndex].selection = value;
    }
    source.flags ??= {};
    source.flags.pf2e ??= {};
    source.flags.pf2e.rulesSelections ??= {};
    source.flags.pf2e.rulesSelections[flag] = value;
}
function applyPendingGrantChoiceSelections(source, selection, draft, steps) {
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
            rule.selection = grantedSelection.uuid;
        }
        source.flags.pf2e.rulesSelections[step.grantSelection.flag] = grantedSelection.uuid;
    }
}
export async function insertFeatSelection(actor, selection, step, deps = DEFAULT_INSERT_DEPS) {
    const document = await deps.fetchSelectionDocument(selection);
    if (!document) {
        return;
    }
    const slotData = resolveFeatSlotData(actor, selection, step);
    if (typeof actor?.feats?.insertFeat === "function") {
        const inserted = await actor.feats.insertFeat(document, slotData);
        await stampSelectionFlags(actor, inserted, selection);
        return;
    }
    const source = await deps.createEmbeddedSource(selection);
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
function resolveFeatSlotData(actor, selection, step) {
    const groupId = resolveFeatGroupId(selection, step);
    if (!groupId) {
        return null;
    }
    const group = (typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId]);
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
function resolveFeatGroupId(selection, step) {
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
export async function stampSelectionFlags(actor, items, selection) {
    if (!Array.isArray(items) || items.length === 0 || typeof actor?.updateEmbeddedDocuments !== "function") {
        return;
    }
    const updates = [];
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
export function orderSelections(draft, steps) {
    const order = new Map();
    steps.forEach((step, index) => order.set(step.slotId, index));
    return Object.values(draft.selections).sort((left, right) => {
        return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
    });
}
export function singletonSelections(selections) {
    return selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType));
}
export function featSelections(selections) {
    return selections.filter((entry) => entry.itemType === "feat");
}
export function hasSourceId(actor, sourceId) {
    return listActorItems(actor).some((item) => itemMatchesSourceId(item, sourceId));
}
//# sourceMappingURL=selection-application.js.map