import { MODULE_ID } from "./constants.js";
export function inspectActor(actor) {
    const items = normalizeItems(actor);
    const level = clampLevel(Number(actor?.system?.details?.level?.value ?? 1));
    const namesByType = {};
    const sourceIds = new Set();
    const fulfilledStepIds = new Set();
    const singletonSlots = {
        ancestry: false,
        heritage: false,
        background: false,
        class: false,
        deity: false,
    };
    const featCounts = {
        ancestry: 0,
        class: 0,
        archetype: 0,
        skill: 0,
        general: 0,
    };
    for (const item of items) {
        const type = String(item?.type ?? "");
        const name = String(item?.name ?? "").trim();
        if (type) {
            namesByType[type] ??= [];
            if (name) {
                namesByType[type].push(name);
            }
        }
        if (type in singletonSlots) {
            singletonSlots[type] = true;
        }
        const sourceId = item?.flags?.core?.sourceId;
        if (typeof sourceId === "string" && sourceId) {
            sourceIds.add(sourceId);
        }
        const wayfinderSlotId = item?.flags?.[MODULE_ID]?.slotId;
        if (typeof wayfinderSlotId === "string" && wayfinderSlotId.length > 0) {
            fulfilledStepIds.add(wayfinderSlotId);
        }
        if (type === "feat") {
            const featType = String(item?.system?.featType?.value ?? item?.system?.category ?? "");
            if (featType in featCounts) {
                featCounts[featType] += 1;
            }
        }
    }
    for (const slotId of readCompletedStateStepIds(actor)) {
        fulfilledStepIds.add(slotId);
    }
    for (const slotId of readFulfilledFeatSlotIds(actor)) {
        fulfilledStepIds.add(slotId);
    }
    return {
        actorId: String(actor?.id ?? ""),
        level,
        isBlank: items.length === 0 && !hasAnySingleton(singletonSlots),
        singletonSlots,
        featCounts,
        fulfilledStepIds: Array.from(fulfilledStepIds).sort(),
        sourceIds: Array.from(sourceIds),
        namesByType,
        skillRanks: extractSkillRanks(actor),
    };
}
function extractSkillRanks(actor) {
    const skills = actor?.system?.skills;
    if (!skills || typeof skills !== "object") {
        return {};
    }
    const result = {};
    for (const [slug, data] of Object.entries(skills)) {
        const rank = Number(data?.rank ?? 0);
        result[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
    }
    return result;
}
function normalizeItems(actor) {
    if (Array.isArray(actor?.items)) {
        return actor.items;
    }
    if (Array.isArray(actor?.items?.contents)) {
        return actor.items.contents;
    }
    return [];
}
function readCompletedStateStepIds(actor) {
    const completedStepIds = actor?.flags?.[MODULE_ID]?.state?.completedStepIds;
    return Array.isArray(completedStepIds)
        ? completedStepIds.filter((slotId) => typeof slotId === "string" &&
            (slotId.startsWith("ability-boosts-level-") || slotId.startsWith("skill-increase-level-")))
        : [];
}
function readFulfilledFeatSlotIds(actor) {
    return [
        ...readFulfilledFeatSlotIdsForGroup(actor, "ancestry", "ancestry-feat"),
        ...readFulfilledFeatSlotIdsForGroup(actor, "class", "class-feat"),
        ...readFulfilledFeatSlotIdsForGroup(actor, "skill", "skill-feat"),
        ...readFulfilledFeatSlotIdsForGroup(actor, "general", "general-feat"),
    ];
}
function readFulfilledFeatSlotIdsForGroup(actor, groupId, slotKind) {
    const group = typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId];
    return Object.values(group?.slots ?? {}).flatMap((slot) => {
        const level = Number(slot?.level);
        return slot?.feat && Number.isFinite(level) && level >= 1 && level <= 20
            ? [`${slotKind}-level-${Math.floor(level)}`]
            : [];
    });
}
function clampLevel(level) {
    if (!Number.isFinite(level)) {
        return 1;
    }
    return Math.max(1, Math.min(20, Math.floor(level)));
}
function hasAnySingleton(singletonSlots) {
    return (singletonSlots.ancestry ||
        singletonSlots.heritage ||
        singletonSlots.background ||
        singletonSlots.class ||
        singletonSlots.deity);
}
//# sourceMappingURL=actor-inspector.js.map