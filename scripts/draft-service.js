const DRAFT_VERSION = 2;
const STATE_VERSION = 1;
export function createEmptyDraft(targetLevel = 1) {
    return {
        version: DRAFT_VERSION,
        targetLevel: clampLevel(targetLevel),
        selections: {},
        boosts: createEmptyBoostDraft(),
        manual: {},
        updatedAt: null
    };
}
export function createEmptyState() {
    return {
        version: STATE_VERSION,
        lastAppliedAt: null,
        lastTargetLevel: null,
        completedStepIds: []
    };
}
export function normalizeDraft(raw, fallbackTargetLevel) {
    const draft = isRecord(raw) ? raw : {};
    return {
        version: DRAFT_VERSION,
        targetLevel: clampLevel(typeof draft.targetLevel === "number" ? draft.targetLevel : fallbackTargetLevel),
        selections: sanitizeSelections(draft.selections),
        boosts: sanitizeBoosts(draft.boosts),
        manual: sanitizeManual(draft.manual),
        updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : null
    };
}
export function normalizeState(raw) {
    const state = isRecord(raw) ? raw : {};
    return {
        version: STATE_VERSION,
        lastAppliedAt: typeof state.lastAppliedAt === "string" ? state.lastAppliedAt : null,
        lastTargetLevel: typeof state.lastTargetLevel === "number" ? clampLevel(state.lastTargetLevel) : null,
        completedStepIds: Array.isArray(state.completedStepIds)
            ? state.completedStepIds.filter((value) => typeof value === "string")
            : []
    };
}
export function buildDraftPatch(draft) {
    return {
        ...draft,
        version: DRAFT_VERSION,
        updatedAt: new Date().toISOString()
    };
}
function createEmptyBoostDraft() {
    return {
        ancestry: {
            modeTouched: false,
            mode: "standard",
            selectedBoosts: {},
            alternateBoosts: [],
            voluntary: {
                touched: false,
                enabled: false,
                legacy: false,
                boost: null,
                flaws: []
            }
        },
        background: {
            selectedBoosts: {}
        },
        class: {
            keyAbility: null
        },
        levels: {}
    };
}
function sanitizeSelections(raw) {
    if (!isRecord(raw)) {
        return {};
    }
    const result = {};
    for (const slotId of Object.keys(raw)) {
        const value = raw[slotId];
        if (!isRecord(value)) {
            continue;
        }
        const selection = value;
        const packId = selection.packId;
        const documentId = selection.documentId;
        const uuid = selection.uuid;
        const name = selection.name;
        if (typeof packId !== "string" || typeof documentId !== "string" || typeof uuid !== "string" || typeof name !== "string") {
            continue;
        }
        result[slotId] = {
            slotId,
            packId,
            documentId,
            uuid,
            itemType: typeof selection.itemType === "string" ? selection.itemType : "",
            featType: typeof selection.featType === "string" ? selection.featType : null,
            name,
            level: typeof selection.level === "number" ? clampLevel(selection.level) : null
        };
    }
    return result;
}
function sanitizeManual(raw) {
    if (!isRecord(raw)) {
        return {};
    }
    const result = {};
    for (const stepId of Object.keys(raw)) {
        const value = raw[stepId];
        result[stepId] = value === true;
    }
    return result;
}
function sanitizeBoosts(raw) {
    const defaults = createEmptyBoostDraft();
    if (!isRecord(raw)) {
        return defaults;
    }
    const ancestry = isRecord(raw.ancestry) ? raw.ancestry : {};
    const background = isRecord(raw.background) ? raw.background : {};
    const classBoosts = isRecord(raw.class) ? raw.class : {};
    const levels = isRecord(raw.levels) ? raw.levels : {};
    const voluntary = isRecord(ancestry.voluntary) ? ancestry.voluntary : {};
    return {
        ancestry: {
            modeTouched: ancestry.modeTouched === true,
            mode: ancestry.mode === "alternate" ? "alternate" : "standard",
            selectedBoosts: sanitizeSelectedBoosts(ancestry.selectedBoosts),
            alternateBoosts: sanitizeAbilitySet(ancestry.alternateBoosts, 2),
            voluntary: {
                touched: voluntary.touched === true,
                enabled: voluntary.enabled === true,
                legacy: voluntary.legacy === true,
                boost: sanitizeAbility(voluntary.boost),
                flaws: sanitizeAbilitySequence(voluntary.flaws, voluntary.legacy === true ? 2 : 6)
            }
        },
        background: {
            selectedBoosts: sanitizeSelectedBoosts(background.selectedBoosts)
        },
        class: {
            keyAbility: sanitizeAbility(classBoosts.keyAbility)
        },
        levels: sanitizeLevelBoosts(levels)
    };
}
function sanitizeSelectedBoosts(raw) {
    if (!isRecord(raw)) {
        return {};
    }
    return Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
        const ability = sanitizeAbility(value);
        return ability || value === null ? [[key, ability]] : [];
    }));
}
function sanitizeLevelBoosts(raw) {
    return Object.fromEntries(Object.entries(raw).flatMap(([level, value]) => {
        if (!/^(1|5|10|15|20)$/.test(level)) {
            return [];
        }
        return [[level, sanitizeAbilitySet(value, 4)]];
    }));
}
function sanitizeAbility(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return isAbilityKey(normalized) ? normalized : null;
}
function sanitizeAbilitySet(raw, maxLength = 6) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return Array.from(new Set(raw
        .map((value) => sanitizeAbility(value))
        .filter((value) => value !== null))).slice(0, maxLength);
}
function sanitizeAbilitySequence(raw, maxLength = 6) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((value) => sanitizeAbility(value))
        .filter((value) => value !== null)
        .slice(0, maxLength);
}
function clampLevel(level) {
    if (!Number.isFinite(level)) {
        return 1;
    }
    return Math.min(20, Math.max(1, Math.floor(level)));
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isAbilityKey(value) {
    return ["str", "dex", "con", "int", "wis", "cha"].includes(value);
}
//# sourceMappingURL=draft-service.js.map