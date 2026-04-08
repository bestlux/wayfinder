const DRAFT_VERSION = 1;
const STATE_VERSION = 1;
export function createEmptyDraft(targetLevel = 1) {
    return {
        version: DRAFT_VERSION,
        targetLevel: clampLevel(targetLevel),
        selections: {},
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
function clampLevel(level) {
    if (!Number.isFinite(level)) {
        return 1;
    }
    return Math.min(20, Math.max(1, Math.floor(level)));
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=draft-service.js.map