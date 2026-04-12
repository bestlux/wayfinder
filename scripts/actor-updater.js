import { BOOST_LEVELS, getEffectiveBuildState, listActorItems } from "./build-state.js";
import { applyClassBranchDraft, stripPreselectedClassBranchEntries } from "./class-branch-service.js";
import { applyClassFeatureChoiceDraft, stripPreselectedClassFeatureEntries } from "./class-feature-choice-service.js";
import { MODULE_ID } from "./constants.js";
import { fetchSelectionDocument } from "./pack-service.js";
const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);
export async function applyDraftToActor(actor, draft, steps) {
    const selections = orderSelections(draft, steps);
    const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));
    for (const selection of selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType))) {
        await replaceSingletonItem(actor, selection, draft, steps);
    }
    const projectedTrainingRanks = await applyTrainingDraft(actor, draft, steps);
    await applyClassFeatureChoiceDraft(actor, draft, steps, {
        createEmbeddedSource,
        fetchSelectionDocument,
    });
    await applyClassBranchDraft(actor, draft, steps, {
        createEmbeddedSource,
        fetchSelectionDocument,
    });
    for (const selection of selections.filter((entry) => entry.itemType === "feat")) {
        if (hasSourceId(actor, selection.uuid)) {
            continue;
        }
        const step = stepsBySlotId.get(selection.slotId);
        await insertFeatSelection(actor, selection, step ?? null);
    }
    await applyBoostDraft(actor, draft);
    await applySkillIncreaseDraft(actor, draft, projectedTrainingRanks);
    const currentLevel = Number(actor?.system?.details?.level?.value ?? 1) || 1;
    if (draft.targetLevel > currentLevel) {
        await actor.update({
            "system.details.level.value": draft.targetLevel,
        });
    }
}
async function applyTrainingDraft(actor, draft, steps) {
    const projectedRanks = {};
    for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
        const rank = Number(data?.rank ?? 0);
        projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
    }
    const stepMap = new Map(steps.map((step) => [step.slotId, step]));
    const classUpdates = [];
    for (const [slotId, training] of Object.entries(draft.skillTrainings)) {
        const step = stepMap.get(slotId);
        if (step?.kind !== "skill-training" || !step.training) {
            continue;
        }
        const classItem = listActorItems(actor).find((item) => item?.type === "class");
        if (classItem?.id && step.training.choiceRules.length > 0) {
            const classRules = cloneData(Array.isArray(classItem.system?.rules) ? classItem.system.rules : []);
            const classUpdate = { _id: classItem.id };
            for (const choiceRule of step.training.choiceRules) {
                const selection = training.ruleChoices[choiceRule.flag];
                if (!selection) {
                    continue;
                }
                if (classRules[choiceRule.ruleIndex]) {
                    classRules[choiceRule.ruleIndex].selection = selection;
                }
                classUpdate[`flags.pf2e.rulesSelections.${choiceRule.flag}`] = selection;
                projectedRanks[selection] = Math.max(projectedRanks[selection] ?? 0, 1);
            }
            classUpdate["system.rules"] = classRules;
            classUpdates.push(classUpdate);
        }
        for (const slug of training.additional) {
            projectedRanks[slug] = Math.max(projectedRanks[slug] ?? 0, 1);
        }
    }
    if (classUpdates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", classUpdates);
    }
    const skillUpdates = Object.entries(projectedRanks)
        .filter(([slug, rank]) => {
        const current = Number(actor?.system?.skills?.[slug]?.rank ?? 0);
        return rank > current;
    })
        .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank]);
    if (skillUpdates.length > 0) {
        await actor.update(Object.fromEntries(skillUpdates));
    }
    return projectedRanks;
}
async function applySkillIncreaseDraft(actor, draft, baseRanks) {
    const projectedRanks = baseRanks ? { ...baseRanks } : {};
    if (!baseRanks) {
        for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
            const rank = Number(data?.rank ?? 0);
            projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
        }
    }
    const sortedEntries = Object.entries(draft.skillIncreases).sort(([left], [right]) => compareSkillIncreaseSlotIds(left, right));
    for (const [, slug] of sortedEntries) {
        if (typeof slug !== "string" || !slug) {
            continue;
        }
        const currentRank = projectedRanks[slug] ?? 0;
        projectedRanks[slug] = Math.min(4, currentRank + 1);
    }
    const updates = Object.entries(projectedRanks).map(([slug, rank]) => [`system.skills.${slug}.rank`, rank]);
    if (updates.length > 0) {
        await actor.update(Object.fromEntries(updates));
    }
}
function compareSkillIncreaseSlotIds(left, right) {
    const leftLevel = skillIncreaseLevelFromSlotId(left);
    const rightLevel = skillIncreaseLevelFromSlotId(right);
    if (leftLevel !== rightLevel) {
        return leftLevel - rightLevel;
    }
    return left.localeCompare(right);
}
function skillIncreaseLevelFromSlotId(slotId) {
    const match = /skill-increase-level-(\d+)/.exec(slotId);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
async function replaceSingletonItem(actor, selection, draft, steps) {
    const existing = Array.from(actor?.items ?? []).filter((item) => item.type === selection.itemType);
    if (existing.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", existing.map((item) => item.id));
    }
    const source = await createEmbeddedSource(selection, draft, steps);
    if (source) {
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}
async function createEmbeddedSource(selection, draft, steps = []) {
    const document = await fetchSelectionDocument(selection);
    if (!document) {
        return null;
    }
    const source = document.toObject();
    if (selection.itemType === "class" && draft) {
        stripPreselectedClassFeatureEntries(source, draft, steps);
        stripPreselectedClassBranchEntries(source, draft, steps);
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
async function insertFeatSelection(actor, selection, step) {
    const document = await fetchSelectionDocument(selection);
    if (!document) {
        return;
    }
    const slotData = resolveFeatSlotData(actor, selection, step);
    if (typeof actor?.feats?.insertFeat === "function") {
        const inserted = await actor.feats.insertFeat(document, slotData);
        await stampSelectionFlags(actor, inserted, selection);
        return;
    }
    const source = await createEmbeddedSource(selection);
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
    await actor.createEmbeddedDocuments("Item", [source]);
}
function resolveFeatSlotData(actor, selection, step) {
    const groupId = resolveFeatGroupId(selection, step);
    if (!groupId) {
        return null;
    }
    const group = typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId];
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
async function stampSelectionFlags(actor, items, selection) {
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
function orderSelections(draft, steps) {
    const order = new Map();
    steps.forEach((step, index) => order.set(step.slotId, index));
    return Object.values(draft.selections).sort((left, right) => {
        return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
    });
}
function hasSourceId(actor, sourceId) {
    return listActorItems(actor).some((item) => itemMatchesSourceId(item, sourceId));
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
async function applyBoostDraft(actor, draft) {
    const buildState = await getEffectiveBuildState(actor, draft);
    const updates = [];
    const ancestryItem = listActorItems(actor).find((item) => item?.type === "ancestry");
    if (ancestryItem && buildState.ancestry) {
        const ancestryUpdate = { _id: ancestryItem.id };
        if (buildState.ancestry.mode === "alternate") {
            ancestryUpdate["system.alternateAncestryBoosts"] = buildState.ancestry.alternateBoosts;
        }
        else {
            ancestryUpdate["system.-=alternateAncestryBoosts"] = null;
        }
        for (const [slot, value] of Object.entries(buildState.ancestry.selectedBoosts)) {
            ancestryUpdate[`system.boosts.${slot}.selected`] = value;
        }
        ancestryUpdate["system.voluntary.flaws"] = buildState.ancestry.voluntary.enabled
            ? buildState.ancestry.voluntary.flaws
            : [];
        if (buildState.ancestry.voluntary.enabled && buildState.ancestry.voluntary.legacy) {
            ancestryUpdate["system.voluntary.boost"] = buildState.ancestry.voluntary.boost;
        }
        else {
            ancestryUpdate["system.voluntary.-=boost"] = null;
        }
        updates.push(ancestryUpdate);
    }
    const backgroundItem = listActorItems(actor).find((item) => item?.type === "background");
    if (backgroundItem && buildState.background) {
        const backgroundUpdate = { _id: backgroundItem.id };
        for (const [slot, value] of Object.entries(buildState.background.selectedBoosts)) {
            backgroundUpdate[`system.boosts.${slot}.selected`] = value;
        }
        updates.push(backgroundUpdate);
    }
    const classItem = listActorItems(actor).find((item) => item?.type === "class");
    if (classItem && buildState.class) {
        updates.push({
            _id: classItem.id,
            "system.keyAbility.selected": buildState.class.selectedKeyAbility,
        });
    }
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
    const actorBoostUpdate = Object.fromEntries(BOOST_LEVELS.map((level) => [`system.build.attributes.boosts.${level}`, buildState.levelBoosts[level]]));
    await actor.update(actorBoostUpdate);
}
//# sourceMappingURL=actor-updater.js.map