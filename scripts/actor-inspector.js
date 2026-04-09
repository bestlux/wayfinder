export function inspectActor(actor) {
    const items = normalizeItems(actor);
    const level = clampLevel(Number(actor?.system?.details?.level?.value ?? 1));
    const namesByType = {};
    const sourceIds = new Set();
    const singletonSlots = {
        ancestry: false,
        heritage: false,
        background: false,
        class: false
    };
    const featCounts = {
        ancestry: 0,
        class: 0,
        archetype: 0,
        skill: 0,
        general: 0
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
        if (type === "feat") {
            const featType = String(item?.system?.featType?.value ?? item?.system?.category ?? "");
            if (featType in featCounts) {
                featCounts[featType] += 1;
            }
        }
    }
    return {
        actorId: String(actor?.id ?? ""),
        level,
        isBlank: items.length === 0 && !hasAnySingleton(singletonSlots),
        singletonSlots,
        featCounts,
        sourceIds: Array.from(sourceIds),
        namesByType
    };
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
function clampLevel(level) {
    if (!Number.isFinite(level)) {
        return 1;
    }
    return Math.max(1, Math.min(20, Math.floor(level)));
}
function hasAnySingleton(singletonSlots) {
    return singletonSlots.ancestry || singletonSlots.heritage || singletonSlots.background || singletonSlots.class;
}
//# sourceMappingURL=actor-inspector.js.map